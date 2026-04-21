using ColorGame.Models;

namespace ColorGame.Services;

public class RoomService
{
    private readonly List<Room> _rooms = new();
    private readonly object _lock = new();
    private readonly Random _random = new();

    public Room CreateRoom(string adminName, string connectionId)
    {
        lock (_lock)
        {
            var code = _random.Next(100000, 999999).ToString();
            var room = new Room { Code = code };
            room.Players.Add(new Player
            {
                Name = adminName,
                ConnectionId = connectionId,
                Role = "Admin"
            });
            _rooms.Add(room);
            return room;
        }
    }

    public (Room? room, string? error) JoinRoom(string code, string playerName, string connectionId)
    {
        lock (_lock)
        {
            var room = _rooms.FirstOrDefault(r => r.Code == code);
            if (room == null) return (null, "La sala no existe.");
            if (room.Game.IsStarted) return (null, "El juego ya ha comenzado.");
            if (room.Players.Any(p => p.Name.Equals(playerName, StringComparison.OrdinalIgnoreCase)))
                return (null, "El nombre ya está en uso en esta sala.");

            room.Players.Add(new Player
            {
                Name = playerName,
                ConnectionId = connectionId,
                Role = "Player"
            });
            return (room, null);
        }
    }

    public Room? GetRoom(string code)
    {
        lock (_lock)
        {
            return _rooms.FirstOrDefault(r => r.Code == code);
        }
    }

    public string? GetRoomCodeByConnection(string connectionId)
    {
        lock (_lock)
        {
            return _rooms.FirstOrDefault(r => r.Players.Any(p => p.ConnectionId == connectionId))?.Code;
        }
    }

    public void RemovePlayerByConnection(string connectionId)
    {
        lock (_lock)
        {
            var room = _rooms.FirstOrDefault(r => r.Players.Any(p => p.ConnectionId == connectionId));
            if (room != null)
            {
                var player = room.Players.First(p => p.ConnectionId == connectionId);
                room.Players.Remove(player);
                if (room.Players.Count == 0)
                {
                    _rooms.Remove(room);
                }
            }
        }
    }

    /// <summary>
    /// Resets the game state for a new round, but preserves TotalPoints and Streaks.
    /// </summary>
    public void ResetGame(string code)
    {
        lock (_lock)
        {
            var room = GetRoom(code);
            if (room != null)
            {
                room.Game = new GameState();
                foreach (var player in room.Players)
                {
                    player.AccumulatedSeconds = 0;
                    // TotalPoints and CurrentStreak are intentionally NOT reset between rounds
                }
            }
        }
    }

    /// <summary>
    /// Full reset including points and streaks (used when admin starts a completely new tournament).
    /// </summary>
    public void FullReset(string code)
    {
        lock (_lock)
        {
            var room = GetRoom(code);
            if (room != null)
            {
                room.Game = new GameState();
                room.CurrentRound = 0;
                foreach (var player in room.Players)
                {
                    player.AccumulatedSeconds = 0;
                    player.TotalPoints = 0;
                    player.CurrentStreak = 0;
                }
            }
        }
    }
}
