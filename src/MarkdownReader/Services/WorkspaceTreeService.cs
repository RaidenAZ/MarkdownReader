using System.IO;

namespace MarkdownReader.Services;

public sealed record WorkspaceEntry(string Name, string Path, bool IsFile, IReadOnlyList<WorkspaceEntry> Children);

public static class WorkspaceTreeService
{
    private static readonly EnumerationOptions Options = new()
    {
        IgnoreInaccessible = true,
        AttributesToSkip = FileAttributes.ReparsePoint | FileAttributes.Hidden | FileAttributes.System
    };

    public static bool IsMarkdown(string path) =>
        Path.GetExtension(path).Equals(".md", StringComparison.OrdinalIgnoreCase) ||
        Path.GetExtension(path).Equals(".markdown", StringComparison.OrdinalIgnoreCase);

    public static WorkspaceEntry Scan(string path) => new(
        Path.GetFileName(Path.TrimEndingDirectorySeparator(path)) is { Length: > 0 } name ? name : path,
        path,
        false,
        Directory.EnumerateDirectories(path, "*", Options)
            .Order(StringComparer.OrdinalIgnoreCase)
            .Select(Scan)
            .Where(entry => entry.Children.Count > 0)
            .Concat(Directory.EnumerateFiles(path, "*", Options)
                .Where(IsMarkdown)
                .Order(StringComparer.OrdinalIgnoreCase)
                .Select(file => new WorkspaceEntry(Path.GetFileName(file), file, true, [])))
            .ToArray());
}
