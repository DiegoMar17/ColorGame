namespace ColorGame.Models;

public class GameState
{
    public bool IsStarted { get; set; } = false;
    public bool IsOver { get; set; } = false;
    public int CurrentPlayerIndex { get; set; } = 0;
    public List<string> UsedColors { get; set; } = new();
    public string? LoserName { get; set; }
    public string? LosingColor { get; set; }
    public double TotalSeconds { get; set; } = 0;
}
