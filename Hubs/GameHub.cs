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

    public async Task StartGame(string roomCode, int maxRounds = 3)
    {
        var room = _roomService.GetRoom(roomCode);
        if (room == null || room.Admin?.ConnectionId != Context.ConnectionId) return;

        if (room.GamePlayers.Count < 2)
        {
            await Clients.Caller.SendAsync("StartError", "Se necesitan al menos 2 jugadores.");
            return;
        }

        // Full reset at the beginning of a tournament
        _roomService.FullReset(roomCode);
        room = _roomService.GetRoom(roomCode)!;

        room.MaxRounds = maxRounds;
        room.CurrentRound = 1;
        room.Game.IsStarted = true;
        room.Game.CurrentPlayerIndex = 0;

        // Shuffle turn order (Fisher-Yates)
        room.Game.TurnOrder = room.GamePlayers.Select(p => p.ConnectionId).ToList();
        var rng = new Random();
        int n = room.Game.TurnOrder.Count;
        while (n > 1)
        {
            n--;
            int k = rng.Next(n + 1);
            (room.Game.TurnOrder[k], room.Game.TurnOrder[n]) = (room.Game.TurnOrder[n], room.Game.TurnOrder[k]);
        }

        // Initialize tracking
        foreach (var p in room.GamePlayers)
            room.Game.PlayerColors[p.Name] = new List<string>();

        var allPlayerNames = room.Players.Select(p => p.Name).ToList();
        var firstPlayerName = room.GamePlayers.First(p => p.ConnectionId == room.Game.TurnOrder[0]).Name;

        await Clients.Group(roomCode).SendAsync("GameStarted", firstPlayerName, allPlayerNames, room.CurrentRound, room.MaxRounds);
    }

    public async Task SubmitColor(string roomCode, string color, double elapsedSeconds)
    {
        var room = _roomService.GetRoom(roomCode);
        if (room == null || !room.Game.IsStarted || room.Game.IsOver) return;

        if (room.Game.TurnOrder.Count == 0 || room.Game.CurrentPlayerIndex >= room.Game.TurnOrder.Count) return;

        var currentConnectionId = room.Game.TurnOrder[room.Game.CurrentPlayerIndex];
        var currentPlayer = room.GamePlayers.FirstOrDefault(p => p.ConnectionId == currentConnectionId);
        if (currentPlayer == null || currentPlayer.ConnectionId != Context.ConnectionId) return;

        var normalizedColor = color.Trim().ToLowerInvariant();
        currentPlayer.AccumulatedSeconds += elapsedSeconds;
        room.Game.TotalSeconds += elapsedSeconds;
        room.Game.PlayerColors[currentPlayer.Name].Add(color);

        if (room.Game.UsedColors.Contains(normalizedColor))
        {
            // === GAME OVER for this round ===
            room.Game.IsOver = true;
            room.Game.LoserName = currentPlayer.Name;
            room.Game.LosingColor = color;

            // Award points: loser = 0, others = max(1, round(10 - accumulatedSeconds))
            // Increment streaks for non-losers, reset for loser
            foreach (var p in room.GamePlayers)
            {
                if (p.Name == currentPlayer.Name)
                {
                    p.CurrentStreak = 0;
                    // loser gets 0 points this round
                }
                else
                {
                    p.CurrentStreak++;
                    int roundPoints = Math.Max(1, (int)Math.Round(10.0 - p.AccumulatedSeconds));
                    p.TotalPoints += roundPoints;
                }
            }

            var scores = room.GamePlayers
                .OrderByDescending(p => p.TotalPoints)
                .Select(p => new
                {
                    Name = p.Name,
                    AccumulatedSeconds = p.AccumulatedSeconds,
                    Colors = room.Game.PlayerColors.ContainsKey(p.Name) ? room.Game.PlayerColors[p.Name] : new List<string>(),
                    TotalPoints = p.TotalPoints,
                    CurrentStreak = p.CurrentStreak,
                    RoundPoints = p.Name == currentPlayer.Name ? 0 : Math.Max(1, (int)Math.Round(10.0 - p.AccumulatedSeconds))
                })
                .ToList();

            bool isTournamentOver = room.CurrentRound >= room.MaxRounds;

            if (isTournamentOver)
            {
                // Find tournament champion (most points, exclude loser if tied)
                var champion = room.GamePlayers.OrderByDescending(p => p.TotalPoints).First();
                var podium = room.GamePlayers
                    .OrderByDescending(p => p.TotalPoints)
                    .Select(p => new { Name = p.Name, TotalPoints = p.TotalPoints, CurrentStreak = p.CurrentStreak })
                    .ToList();

                await Clients.Group(roomCode).SendAsync("TournamentOver", currentPlayer.Name, color, room.Game.TotalSeconds, scores, champion.Name, podium, room.CurrentRound, room.MaxRounds);
            }
            else
            {
                await Clients.Group(roomCode).SendAsync("GameOver", currentPlayer.Name, color, room.Game.TotalSeconds, scores, room.CurrentRound, room.MaxRounds);
            }
        }
        else
        {
            room.Game.UsedColors.Add(normalizedColor);
            room.Game.CurrentPlayerIndex = (room.Game.CurrentPlayerIndex + 1) % room.Game.TurnOrder.Count;
            var nextConnectionId = room.Game.TurnOrder[room.Game.CurrentPlayerIndex];
            var nextPlayer = room.GamePlayers.FirstOrDefault(p => p.ConnectionId == nextConnectionId);

            // Pass streaks info on each turn
            var streaks = room.GamePlayers.Select(p => new { Name = p.Name, Streak = p.CurrentStreak, TotalPoints = p.TotalPoints }).ToList();
            await Clients.Group(roomCode).SendAsync("NextTurn", nextPlayer?.Name, color, currentPlayer.Name, streaks);
        }
    }

    public async Task ResetGame(string roomCode)
    {
        var room = _roomService.GetRoom(roomCode);
        if (room == null || room.Admin?.ConnectionId != Context.ConnectionId) return;

        room.CurrentRound++;
        _roomService.ResetGame(roomCode);

        // Re-shuffle turn order
        room.Game.TurnOrder = room.GamePlayers.Select(p => p.ConnectionId).ToList();
        var rng = new Random();
        int n = room.Game.TurnOrder.Count;
        while (n > 1)
        {
            n--;
            int k = rng.Next(n + 1);
            (room.Game.TurnOrder[k], room.Game.TurnOrder[n]) = (room.Game.TurnOrder[n], room.Game.TurnOrder[k]);
        }

        foreach (var p in room.GamePlayers)
            room.Game.PlayerColors[p.Name] = new List<string>();

        room.Game.IsStarted = true;
        room.Game.CurrentPlayerIndex = 0;

        var firstConnectionId = room.Game.TurnOrder[0];
        var firstPlayer = room.GamePlayers.First(p => p.ConnectionId == firstConnectionId);
        var allPlayerNames = room.Players.Select(p => p.Name).ToList();
        var currentScores = room.GamePlayers
            .OrderByDescending(p => p.TotalPoints)
            .Select(p => new { Name = p.Name, TotalPoints = p.TotalPoints, CurrentStreak = p.CurrentStreak })
            .ToList();

        await Clients.Group(roomCode).SendAsync("GameReset", allPlayerNames, firstPlayer.Name, room.CurrentRound, room.MaxRounds, currentScores);
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
                    room.Game.TurnOrder.Count > 0 &&
                    room.Game.CurrentPlayerIndex < room.Game.TurnOrder.Count &&
                    room.Game.TurnOrder[room.Game.CurrentPlayerIndex] == Context.ConnectionId;

                if (room.Game.IsStarted)
                    room.Game.TurnOrder.Remove(Context.ConnectionId);

                _roomService.RemovePlayerByConnection(Context.ConnectionId);

                if (isAdmin)
                {
                    await Clients.Group(roomCode).SendAsync("AdminLeft");
                }
                else
                {
                    var updatedList = room.Players.Select(p => p.Name).ToList();
                    await Clients.Group(roomCode).SendAsync("PlayerLeft", player?.Name, updatedList);

                    if (isCurrentTurn && room.Game.TurnOrder.Count > 0 && !room.Game.IsOver)
                    {
                        if (room.Game.CurrentPlayerIndex >= room.Game.TurnOrder.Count)
                            room.Game.CurrentPlayerIndex = 0;
                        var nextConnectionId = room.Game.TurnOrder[room.Game.CurrentPlayerIndex];
                        var nextPlayer = room.Players.FirstOrDefault(p => p.ConnectionId == nextConnectionId);
                        await Clients.Group(roomCode).SendAsync("NextTurn", nextPlayer?.Name, "N/A (Desconectado)", player?.Name, new List<object>());
                    }
                    else if (isCurrentTurn && room.Game.TurnOrder.Count == 0 && !room.Game.IsOver)
                    {
                        room.Game.IsOver = true;
                    }
                }
            }
        }
        await base.OnDisconnectedAsync(exception);
    }
}
