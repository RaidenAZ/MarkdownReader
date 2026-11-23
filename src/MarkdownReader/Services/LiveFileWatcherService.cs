using System.IO;
using System.Windows.Threading;

namespace MarkdownReader.Services;

public sealed class LiveFileWatcherService : IDisposable
{
    private readonly FileSystemWatcher watcher;
    private readonly DispatcherTimer debounce;
    private bool disposed;

    public LiveFileWatcherService(string directory, string filter, bool recursive, NotifyFilters notifications, Action changed)
    {
        debounce = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(120) };
        debounce.Tick += (_, _) =>
        {
            debounce.Stop();
            changed();
        };

        watcher = new FileSystemWatcher(directory, filter)
        {
            IncludeSubdirectories = recursive,
            NotifyFilter = notifications
        };
        watcher.Changed += Queue;
        watcher.Created += Queue;
        watcher.Deleted += Queue;
        watcher.Renamed += Queue;
        watcher.EnableRaisingEvents = true;
    }

    private void Queue(object sender, FileSystemEventArgs args) =>
        debounce.Dispatcher.InvokeAsync(() =>
        {
            if (disposed)
                return;

            debounce.Stop();
            debounce.Start();
        });

    public static async Task<string> ReadAsync(string path)
    {
        for (var attempt = 0; ; attempt++)
        {
            try
            {
                await using var stream = File.Open(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
                using var reader = new StreamReader(stream);
                return await reader.ReadToEndAsync();
            }
            catch (IOException) when (attempt < 5)
            {
                await Task.Delay(60);
            }
        }
    }

    public void Dispose()
    {
        disposed = true;
        watcher.Dispose();
        debounce.Stop();
    }
}
