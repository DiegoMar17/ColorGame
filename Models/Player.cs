namespace ColorGame.Models;

public class Player
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string ConnectionId { get; set; } = "";
    public string Name { get; set; } = "";
    public string Role { get; set; } = "Player"; // "Admin" or "Player"
    public double AccumulatedSeconds { get; set; } = 0;
}
