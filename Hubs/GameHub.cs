using Microsoft.AspNetCore.SignalR;
using ColorGame.Services;
using ColorGame.Models;

namespace ColorGame.Hubs;

public class GameHub : Hub
{
    private readonly RoomService _roomService;

    public GameHub(RoomService roomService)
    {
        _roomService = roomService;
    }

    public async Task CreateRoom(string adminName)
    {
        var room = _roomService.CreateRoom(adminName, Context.ConnectionId);
        await Groups.AddToGroupAsync(Context.ConnectionId, room.Code);
        await Clients.Caller.SendAsync("RoomCreated", room.Code);
    }

    public async Task JoinRoom(string roomCode, string playerName)
    {
        var (room, error) = _roomService.JoinRoom(roomCode, playerName, Context.ConnectionId);
        if (error != null)
        {
            await Clients.Caller.SendAsync("JoinError", error);
            return;
        }

        await Groups.AddToGroupAsync(Context.ConnectionId, room!.Code);
        var playerNames = room.Players.Select(p => p.Name).ToList();
        await Clients.Caller.SendAsync("JoinedRoom", room.Code, playerNames);
        await Clients.GroupExcept(room.Code, Context.ConnectionId).SendAsync("PlayerJoined", playerName, playerNames);
    }

    public async Task StartGame(string roomCode)
    {
        var room = _roomService.GetRoom(roomCode);
        if (room == null || room.Admin?.ConnectionId != Context.ConnectionId) return;

        if (room.GamePlayers.Count < 2)
        {
            await Clients.Caller.SendAsync("StartError", "Se necesitan al menos 2 jugadores.");
            return;
        }

        room.Game.IsStarted = true;
        room.Game.CurrentPlayerIndex = 0;

        var allPlayerNames = room.Players.Select(p => p.Name).ToList();
        var firstPlayerName = room.GamePlayers[0].Name;

        await Clients.Group(roomCode).SendAsync("GameStarted", firstPlayerName, allPlayerNames);
    }

    public async Task SubmitColor(string roomCode, string color, double elapsedSeconds)
    {
        var room = _roomService.GetRoom(roomCode);
        if (room == null || !room.Game.IsStarted || room.Game.IsOver) return;

        var currentPlayer = room.GamePlayers[room.Game.CurrentPlayerIndex];
        if (currentPlayer.ConnectionId != Context.ConnectionId) return;

        var normalizedColor = color.Trim().ToLowerInvariant();
        currentPlayer.AccumulatedSeconds += elapsedSeconds;
        room.Game.TotalSeconds += elapsedSeconds;

        if (room.Game.UsedColors.Contains(normalizedColor))
        {
            room.Game.IsOver = true;
            room.Game.LoserName = currentPlayer.Name;
            room.Game.LosingColor = color;

            var scores = room.GamePlayers
                .OrderBy(p => p.AccumulatedSeconds)
                .Select(p => new { Name = p.Name, AccumulatedSeconds = p.AccumulatedSeconds })
                .ToList();

            // We can serialize as anonymous objects in SignalR
            await Clients.Group(roomCode).SendAsync("GameOver", currentPlayer.Name, color, room.Game.TotalSeconds, scores);
        }
        else
        {
            room.Game.UsedColors.Add(normalizedColor);
            room.Game.CurrentPlayerIndex = (room.Game.CurrentPlayerIndex + 1) % room.GamePlayers.Count;
            var nextPlayer = room.GamePlayers[room.Game.CurrentPlayerIndex];

            await Clients.Group(roomCode).SendAsync("NextTurn", nextPlayer.Name, color, currentPlayer.Name);
        }
    }

    public async Task ResetGame(string roomCode)
    {
        var room = _roomService.GetRoom(roomCode);
        if (room == null || room.Admin?.ConnectionId != Context.ConnectionId) return;

        _roomService.ResetGame(roomCode);
        var playerNames = room.Players.Select(p => p.Name).ToList();
        await Clients.Group(roomCode).SendAsync("GameReset", playerNames);
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        var roomCode = _roomService.GetRoomCodeByConnection(Context.ConnectionId);
        if (roomCode != null)
        {
            var room = _roomService.GetRoom(roomCode);
            if (room != null)
            {
                var player = room.Players.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId);
                bool isAdmin = player?.Role == "Admin";
                bool isCurrentTurn = room.Game.IsStarted && !room.Game.IsOver && 
                    room.GamePlayers.Count > 0 && 
                    room.GamePlayers.Count > room.Game.CurrentPlayerIndex &&
                    room.GamePlayers[room.Game.CurrentPlayerIndex].ConnectionId == Context.ConnectionId;

                _roomService.RemovePlayerByConnection(Context.ConnectionId);

                if (isAdmin)
                {
                    await Clients.Group(roomCode).SendAsync("AdminLeft");
                }
                else
                {
                    var updatedList = room.Players.Select(p => p.Name).ToList();
                    await Clients.Group(roomCode).SendAsync("PlayerLeft", player?.Name, updatedList);

                    if (isCurrentTurn && room.GamePlayers.Count > 0 && !room.Game.IsOver)
                    {
                        // Adjust index if necessary
                        if (room.Game.CurrentPlayerIndex >= room.GamePlayers.Count)
                        {
                            room.Game.CurrentPlayerIndex = 0;
                        }
                        var nextPlayer = room.GamePlayers[room.Game.CurrentPlayerIndex];
                        await Clients.Group(roomCode).SendAsync("NextTurn", nextPlayer.Name, "N/A (Desconectado)", player?.Name);
                    }
                    else if (isCurrentTurn && room.GamePlayers.Count == 0 && !room.Game.IsOver)
                    {
                        room.Game.IsOver = true;
                    }
                }
            }
        }
        await base.OnDisconnectedAsync(exception);
    }
}
