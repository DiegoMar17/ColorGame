namespace ColorGame.Models;

public class GameState
{
    public bool IsStarted { get; set; } = false;
    public bool IsOver { get; set; } = false;
    public int CurrentPlayerIndex { get; set; } = 0;
    public List<string> UsedColors { get; set; } = new();
    
    // Turn order using Connection IDs
    public List<string> TurnOrder { get; set; } = new();
    
    // Track exactly which colors each player inputted
    public Dictionary<string, List<string>> PlayerColors { get; set; } = new();

    public string? LoserName { get; set; }
    public string? LosingColor { get; set; }
    public double TotalSeconds { get; set; } = 0;
}
