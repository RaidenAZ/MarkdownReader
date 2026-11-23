using System.IO;
using System.Text.Json;

namespace MarkdownReader.Services;

public sealed class PortableStateService
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { WriteIndented = true };
    public string DataDirectory { get; } = Path.Combine(AppContext.BaseDirectory, "data");
    private string StatePath => Path.Combine(DataDirectory, "state.json");

    public PortableState Load()
    {
        if (!File.Exists(StatePath))
            return new PortableState();

        try
        {
            var state = JsonSerializer.Deserialize<PortableState>(File.ReadAllText(StatePath), Json) ?? new();
            state.Recent = (state.Recent ?? []).Where(File.Exists).Take(12).ToList();
            state.Reading = (state.Reading ?? new()).Normalize();
            return state;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException)
        {
            return new PortableState();
        }
    }

    public void Save(PortableState state)
    {
        Directory.CreateDirectory(DataDirectory);
        File.WriteAllText(StatePath + ".tmp", JsonSerializer.Serialize(state, Json));
        File.Move(StatePath + ".tmp", StatePath, overwrite: true);
    }
}

public sealed class PortableState
{
    public List<string> Recent { get; set; } = [];
    public string? Workspace { get; set; }
    public WindowPlacement? Window { get; set; }
    public ReadingSettings Reading { get; set; } = new();
}

public sealed record WindowPlacement(double Left, double Top, double Width, double Height, bool Maximized);

public sealed record ReadingSettings(
    string Theme = "system",
    string Font = "sans",
    int FontSize = 17,
    int ContentWidth = 820,
    bool OutlineOpen = true,
    bool AutoPromoteRecent = false)
{
    public ReadingSettings Normalize() => this with
    {
        Theme = Theme is "light" or "dark" ? Theme : "system",
        Font = Font == "serif" ? Font : "sans",
        FontSize = Math.Clamp(FontSize, 13, 26),
        ContentWidth = ContentWidth == 0 ? 0 : Math.Clamp(ContentWidth, 620, 1800)
    };
}
