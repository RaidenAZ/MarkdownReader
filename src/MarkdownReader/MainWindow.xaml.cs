using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Markup;
using System.Windows.Media;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;
using MarkdownReader.Services;
using Wpf.Ui.Appearance;
using FluentWindow = Wpf.Ui.Controls.FluentWindow;
using WindowBackdropType = Wpf.Ui.Controls.WindowBackdropType;

namespace MarkdownReader;

public partial class MainWindow : FluentWindow
{
    private const string CanvasUrl = "https://folio.local/index.html";
    private const string MediaUrl = "https://media.folio.local/image";
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private static readonly HashSet<string> ImageTypes = new(StringComparer.OrdinalIgnoreCase)
        { ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico", ".avif" };
    private readonly PortableStateService storage = new();
    private readonly PortableState state;
    private readonly string? startupPath;
    private LiveFileWatcherService? documentWatcher;
    private LiveFileWatcherService? workspaceWatcher;
    private WorkspaceEntry? workspace;
    private Document? document;
    private int documentRequest;
    private int workspaceRequest;
    private bool canvasReady;
    private bool followsSystem;

    private sealed record Document(string? Path, string Name, string Text, DateTime Updated, bool IsExample);
    private sealed record RecentDocument(string Path, bool IsActive)
    {
        public string Name => System.IO.Path.GetFileName(Path);
        public string DisplayName => System.IO.Path.GetFileNameWithoutExtension(Path) is { Length: > 0 } stem ? stem : Name;
        [JsonIgnore] public Visibility ActiveVisibility => IsActive ? Visibility.Visible : Visibility.Collapsed;
    }

    public MainWindow(string? startupPath)
    {
        this.startupPath = startupPath;
        state = storage.Load();
        InitializeComponent();
        if (state.Window is { } placement &&
            new Rect(placement.Left, placement.Top, Math.Max(0, placement.Width), Math.Max(0, placement.Height))
                .IntersectsWith(new Rect(SystemParameters.VirtualScreenLeft, SystemParameters.VirtualScreenTop,
                    SystemParameters.VirtualScreenWidth, SystemParameters.VirtualScreenHeight)))
        {
            WindowStartupLocation = WindowStartupLocation.Manual;
            (Left, Top, Width, Height) = (placement.Left, placement.Top, Math.Max(MinWidth, placement.Width), Math.Max(MinHeight, placement.Height));
            if (placement.Maximized)
                WindowState = WindowState.Maximized;
        }
        UpdateRecent();
    }

    private async void InitializeWindow(object sender, RoutedEventArgs args)
    {
        Loaded -= InitializeWindow;
        ApplicationThemeManager.Changed += OnThemeChanged;
        ApplyTheme();

        try
        {
            Directory.CreateDirectory(storage.DataDirectory);
            var environment = await CoreWebView2Environment.CreateAsync(
                userDataFolder: System.IO.Path.Combine(storage.DataDirectory, "webview2"));
            await Canvas.EnsureCoreWebView2Async(environment);
            var core = Canvas.CoreWebView2;
            core.Settings.AreHostObjectsAllowed = false;
            core.Settings.AreDefaultScriptDialogsEnabled = false;
            core.Settings.AreBrowserAcceleratorKeysEnabled = false;
            core.SetVirtualHostNameToFolderMapping("folio.local", System.IO.Path.Combine(AppContext.BaseDirectory, "Assets", "Web"),
                CoreWebView2HostResourceAccessKind.Deny);
            core.NavigationStarting += (_, navigation) => navigation.Cancel = navigation.Uri.Split('#')[0] != CanvasUrl;
            core.NewWindowRequested += (_, request) => request.Handled = true;
            core.AddWebResourceRequestedFilter("https://media.folio.local/*", CoreWebView2WebResourceContext.Image,
                CoreWebView2WebResourceRequestSourceKinds.Document);
            core.WebResourceRequested += ServeImage;
            core.WebMessageReceived += ReceiveMessage;
            core.Navigate(CanvasUrl);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or InvalidOperationException
            or System.Runtime.InteropServices.COMException or WebView2RuntimeNotFoundException)
        {
            ShowError($"无法启动阅读画布：{error.Message}");
        }

        if (state.Workspace is { } folder && Directory.Exists(folder))
            await OpenWorkspace(folder);
        if (!string.IsNullOrWhiteSpace(startupPath))
            await Import(startupPath);
    }

    private void ApplyTheme()
    {
        var follow = state.Reading.Theme == "system";
        if (follow && !followsSystem)
            SystemThemeWatcher.Watch(this, WindowBackdropType.Mica, false);
        if (!follow && followsSystem)
            SystemThemeWatcher.UnWatch(this);
        followsSystem = follow;
        var dark = state.Reading.Theme == "dark" || (follow && ApplicationThemeManager.GetSystemTheme() == SystemTheme.Dark);
        var theme = dark ? ApplicationTheme.Dark : ApplicationTheme.Light;
        ApplicationThemeManager.Apply(theme);
        UpdateTheme(theme);
    }

    private void OnThemeChanged(ApplicationTheme theme, Color accent) => UpdateTheme(theme);

    private void UpdateTheme(ApplicationTheme theme)
    {
        var dark = theme == ApplicationTheme.Dark;
        WindowBackdropType = dark ? WindowBackdropType.Tabbed : WindowBackdropType.Mica;
        WatchDot.Fill = new SolidColorBrush(dark ? Color.FromRgb(45, 212, 191) : Color.FromRgb(13, 148, 136));
        SheetContainer.Background = new SolidColorBrush(dark
            ? Color.FromArgb(196, 24, 26, 31)
            : Color.FromArgb(214, 252, 252, 253));
        SheetContainer.BorderBrush = new SolidColorBrush(dark
            ? Color.FromArgb(36, 255, 255, 255)
            : Color.FromArgb(22, 15, 23, 42));
        SendSettings();
    }

    private void Send<T>(T message)
    {
        if (canvasReady)
            Canvas.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(message, Json));
    }

    private void SendSettings() => Send(new
    {
        type = "settings",
        reading = state.Reading,
        dark = ApplicationThemeManager.GetAppTheme() == ApplicationTheme.Dark
    });

    private async void ReceiveMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        if (args.Source.Split('#')[0] != CanvasUrl)
            return;

        using var json = JsonDocument.Parse(args.WebMessageAsJson);
        var message = json.RootElement;
        if (message.ValueKind != JsonValueKind.Object ||
            !message.TryGetProperty("action", out var action) || action.ValueKind != JsonValueKind.String)
            return;

        switch (action.GetString())
        {
            case "ready":
                canvasReady = true;
                SendFonts();
                SendSettings();
                UpdateRecent();
                if (document is { } current)
                    Send(new { type = "document", document = current, live = false });
                break;
            case "openFile":
                ChooseFile(this, new RoutedEventArgs());
                break;
            case "openFolder":
                ChooseFolder(this, new RoutedEventArgs());
                break;
            case "home":
                GoHome();
                break;
            case "toggleSidebar":
                ToggleSidebar(this, new RoutedEventArgs());
                break;
            case "openRecent" when message.TryGetProperty("path", out var recent) && recent.ValueKind == JsonValueKind.String:
                if (state.Recent.FirstOrDefault(path => path == recent.GetString()) is { } path)
                    await OpenDocument(path);
                break;
            case "removeRecent" when message.TryGetProperty("path", out var removed) && removed.ValueKind == JsonValueKind.String:
                RemoveRecent(removed.GetString()!);
                break;
            case "clearRecent":
                ClearRecent();
                break;
            case "example":
                await OpenDocument(System.IO.Path.Combine(AppContext.BaseDirectory, "Assets", "Web", "example.md"), example: true);
                break;
            case "settings" when message.TryGetProperty("reading", out var reading):
                try
                {
                    if (reading.Deserialize<ReadingSettings>(Json) is not { } settings)
                        break;
                    state.Reading = settings.Normalize();
                    ApplyTheme();
                    SaveState();
                }
                catch (JsonException)
                {
                }
                break;
            case "externalLink" when message.TryGetProperty("url", out var link) && link.ValueKind == JsonValueKind.String:
                if (Uri.TryCreate(link.GetString(), UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https" or "mailto")
                {
                    try
                    {
                        Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
                    }
                    catch (System.ComponentModel.Win32Exception error)
                    {
                        ShowError($"无法打开链接：{error.Message}");
                    }
                }
                break;
        }
    }

    private void SendFonts()
    {
        var en = XmlLanguage.GetLanguage("en-us");
        var zh = XmlLanguage.GetLanguage("zh-cn");
        var fonts = Fonts.SystemFontFamilies
            .Select(family =>
            {
                var css = family.FamilyNames.TryGetValue(en, out var english) ? english : family.Source;
                var label = family.FamilyNames.TryGetValue(zh, out var chinese) && chinese != css ? $"{chinese} ({css})" : css;
                return new { css, label };
            })
            .Where(font => !font.css.StartsWith("Global ", StringComparison.OrdinalIgnoreCase) &&
                !font.css.Contains("Icons", StringComparison.OrdinalIgnoreCase) &&
                !font.css.Contains("MDL2", StringComparison.OrdinalIgnoreCase) &&
                font.css is not ("Marlett" or "Symbol" or "Webdings" or "Wingdings" or "Wingdings 2" or "Wingdings 3"))
            .DistinctBy(font => font.css, StringComparer.OrdinalIgnoreCase)
            .OrderBy(font => font.label, StringComparer.CurrentCultureIgnoreCase)
            .ToArray();
        Send(new { type = "fonts", fonts });
    }

    private void ServeImage(object? sender, CoreWebView2WebResourceRequestedEventArgs args)
    {
        var uri = new Uri(args.Request.Uri);
        var relative = Uri.UnescapeDataString(uri.Query.TrimStart('?')).Replace('/', '\\');
        if (document?.Path is { } path && uri.GetLeftPart(UriPartial.Path) == MediaUrl &&
            !System.IO.Path.IsPathRooted(relative) && relative.IndexOfAny([':', '\0']) < 0 &&
            ImageTypes.Contains(System.IO.Path.GetExtension(relative)))
        {
            try
            {
                var source = System.IO.Path.GetFullPath(relative, System.IO.Path.GetDirectoryName(path)!);
                var contentType = System.IO.Path.GetExtension(source).ToLowerInvariant() switch
                {
                    ".svg" => "image/svg+xml",
                    ".jpg" or ".jpeg" => "image/jpeg",
                    ".ico" => "image/x-icon",
                    var extension => $"image/{extension[1..]}"
                };
                args.Response = Canvas.CoreWebView2.Environment.CreateWebResourceResponse(
                    File.Open(source, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete),
                    200, "OK", $"Content-Type: {contentType}\r\nCache-Control: no-store");
                return;
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException)
            {
            }
        }
        args.Response = Canvas.CoreWebView2.Environment.CreateWebResourceResponse(Stream.Null, 404, "Not Found", "");
    }

    private async Task Import(string path)
    {
        if (Directory.Exists(path))
        {
            await OpenWorkspace(System.IO.Path.GetFullPath(path));
            return;
        }
        if (File.Exists(path) && WorkspaceTreeService.IsMarkdown(path))
        {
            await OpenDocument(System.IO.Path.GetFullPath(path));
            return;
        }
        ShowError($"无法打开：{path}");
    }

    private async Task OpenDocument(string path, bool example = false)
    {
        var request = ++documentRequest;
        try
        {
            var text = await LiveFileWatcherService.ReadAsync(path);
            if (request != documentRequest)
                return;

            documentWatcher?.Dispose();
            documentWatcher = example ? null : new LiveFileWatcherService(
                System.IO.Path.GetDirectoryName(path)!, System.IO.Path.GetFileName(path), false,
                NotifyFilters.LastWrite | NotifyFilters.FileName | NotifyFilters.Size, async () => await ReloadDocument(path));
            document = new Document(path, example ? "Folio 排版样张" : System.IO.Path.GetFileName(path),
                text, File.GetLastWriteTimeUtc(path), example);
            var shortTitle = example ? document.Name : System.IO.Path.GetFileNameWithoutExtension(path);
            DocumentName.Text = string.IsNullOrEmpty(shortTitle) ? document.Name : shortTitle;
            TitleSeparator.Visibility = Visibility.Visible;
            DocumentName.ToolTip = example ? null : path;
            Title = $"{document.Name} · Folio";
            SetWatchStatus(!example);
            Send(new { type = "document", document, live = false });
            if (example)
            {
                UpdateRecent();
                return;
            }

            var existingIndex = state.Recent.FindIndex(recent => StringComparer.OrdinalIgnoreCase.Equals(recent, path));
            if (existingIndex < 0)
            {
                state.Recent.Insert(0, path);
                if (state.Recent.Count > 12)
                    state.Recent.RemoveAt(12);
            }
            else if (state.Reading.AutoPromoteRecent && existingIndex > 0)
            {
                state.Recent.RemoveAt(existingIndex);
                state.Recent.Insert(0, path);
            }
            UpdateRecent();
            SaveState();
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            if (request == documentRequest)
                ShowError($"无法读取 {System.IO.Path.GetFileName(path)}：{error.Message}");
        }
    }

    private async Task ReloadDocument(string path)
    {
        var original = document;
        if (original?.Path != path)
            return;

        var request = documentRequest;
        try
        {
            var text = await LiveFileWatcherService.ReadAsync(path);
            if (request != documentRequest || document?.Path != path)
                return;

            SetWatchStatus(true);
            if (document.Text == text)
                return;

            document = document with { Text = text, Updated = File.GetLastWriteTimeUtc(path) };
            Send(new { type = "document", document, live = true });
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            if (request == documentRequest && document?.Path == path)
                SetWatchStatus(false, "等待文件恢复");
        }
    }

    private async Task OpenWorkspace(string path, bool refresh = false)
    {
        if (!refresh)
        {
            workspaceWatcher?.Dispose();
            workspaceWatcher = null;
        }
        var request = ++workspaceRequest;
        try
        {
            var entries = await Task.Run(() => WorkspaceTreeService.Scan(path));
            if (request != workspaceRequest)
                return;

            if (!refresh)
            {
                workspaceWatcher = new LiveFileWatcherService(path, "*", true,
                    NotifyFilters.FileName | NotifyFilters.DirectoryName, async () => await OpenWorkspace(path, refresh: true));
                state.Workspace = path;
                Sidebar.Visibility = Visibility.Visible;
                SaveState();
            }
            workspace = entries;
            RenderWorkspace();
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            if (request == workspaceRequest && !refresh)
                ShowError($"无法打开文件夹：{error.Message}");
        }
    }

    private void RenderWorkspace()
    {
        WorkspaceSection.Visibility = workspace is null ? Visibility.Collapsed : Visibility.Visible;
        if (workspace is null)
        {
            WorkspaceTree.Items.Clear();
            return;
        }

        WorkspaceTitle.Text = workspace.Name;
        WorkspaceTitle.ToolTip = workspace.Path;
        var totalFiles = CountFiles(workspace);
        WorkspaceFilter.Visibility = totalFiles > 5 || WorkspaceFilter.Text.Length > 0 ? Visibility.Visible : Visibility.Collapsed;
        var filter = WorkspaceFilter.Text.Trim();
        var previousRoot = (WorkspaceTree.Items.Count == 0 ? null : ((TreeViewItem)WorkspaceTree.Items[0]).Tag as WorkspaceEntry)?.Path;
        var expanded = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        CollectExpanded(WorkspaceTree.Items);
        WorkspaceTree.Items.Clear();
        foreach (var child in workspace.Children)
            if (Build(child) is { } childItem)
                WorkspaceTree.Items.Add(childItem);
        WorkspaceHint.Visibility = WorkspaceTree.Items.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        WorkspaceHint.Text = filter.Length > 0 ? "没有匹配的文档" : "文件夹内没有 Markdown 文档";

        static int CountFiles(WorkspaceEntry entry) =>
            (entry.IsFile ? 1 : 0) + entry.Children.Sum(CountFiles);

        void CollectExpanded(ItemCollection items)
        {
            foreach (TreeViewItem item in items)
            {
                if (item.IsExpanded)
                    expanded.Add(((WorkspaceEntry)item.Tag).Path);
                CollectExpanded(item.Items);
            }
        }

        TreeViewItem? Build(WorkspaceEntry entry)
        {
            if (entry.IsFile && !entry.Name.Contains(filter, StringComparison.OrdinalIgnoreCase))
                return null;
            var label = entry.IsFile && System.IO.Path.GetFileNameWithoutExtension(entry.Name) is { Length: > 0 } stem ? stem : entry.Name;
            var item = new TreeViewItem
            {
                Header = label,
                Tag = entry,
                ToolTip = entry.Path,
                FontSize = 12.5,
                Padding = new Thickness(4, 3, 4, 3)
            };
            foreach (var child in entry.Children)
                if (Build(child) is { } childItem)
                    item.Items.Add(childItem);

            if (!entry.IsFile && item.Items.Count == 0)
                return null;

            item.IsExpanded = !entry.IsFile && (filter.Length > 0 || expanded.Contains(entry.Path) ||
                (entry == workspace && previousRoot != entry.Path));
            return item;
        }
    }

    private void CloseWorkspace(object sender, RoutedEventArgs args)
    {
        workspaceRequest++;
        workspaceWatcher?.Dispose();
        workspaceWatcher = null;
        workspace = null;
        state.Workspace = null;
        WorkspaceFilter.Text = "";
        RenderWorkspace();
        SaveState();
    }

    private void GoHome()
    {
        documentRequest++;
        documentWatcher?.Dispose();
        documentWatcher = null;
        document = null;
        DocumentName.Text = "";
        TitleSeparator.Visibility = Visibility.Collapsed;
        DocumentName.ToolTip = null;
        Title = "Folio";
        SetWatchStatus(false);
        UpdateRecent();
        Send(new { type = "home" });
    }

    private void UpdateRecent()
    {
        var activePath = document is { IsExample: false } ? document.Path : null;
        var recent = state.Recent
            .Select(path => new RecentDocument(path, StringComparer.OrdinalIgnoreCase.Equals(path, activePath)))
            .ToArray();
        RecentEmptyHint.Visibility = recent.Length == 0 ? Visibility.Visible : Visibility.Collapsed;
        ClearRecentButton.Visibility = recent.Length == 0 ? Visibility.Collapsed : Visibility.Visible;
        RecentFiles.ItemsSource = recent;
        Send(new { type = "recent", recent });
    }

    private void RemoveRecent(string path)
    {
        if (state.Recent.RemoveAll(recent => StringComparer.OrdinalIgnoreCase.Equals(recent, path)) == 0)
            return;
        UpdateRecent();
        SaveState();
    }

    private void ClearRecent()
    {
        if (state.Recent.Count == 0)
            return;
        state.Recent.Clear();
        UpdateRecent();
        SaveState();
    }

    private void SetWatchStatus(bool active, string message = "")
    {
        var text = active ? "实时同步" : message;
        WatchStatus.Text = text;
        WatchBadge.Visibility = string.IsNullOrEmpty(text) ? Visibility.Collapsed : Visibility.Visible;
        WatchDot.Visibility = active ? Visibility.Visible : Visibility.Collapsed;
    }

    private void ShowError(string message)
    {
        if (canvasReady)
        {
            Send(new { type = "error", message });
            return;
        }
        HostError.Text = message;
        HostError.Visibility = Visibility.Visible;
    }

    private void SaveState()
    {
        try
        {
            storage.Save(state);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            ShowError($"无法保存阅读状态：{error.Message}");
        }
    }

    private void SaveWindowPlacement(object? sender, System.ComponentModel.CancelEventArgs args)
    {
        var bounds = RestoreBounds;
        if (!bounds.IsEmpty)
            state.Window = new WindowPlacement(bounds.Left, bounds.Top, bounds.Width, bounds.Height, WindowState == WindowState.Maximized);
        SaveState();
    }

    private void CloseWindow(object? sender, EventArgs args)
    {
        documentRequest++;
        workspaceRequest++;
        canvasReady = false;
        if (followsSystem)
            SystemThemeWatcher.UnWatch(this);
        ApplicationThemeManager.Changed -= OnThemeChanged;
        documentWatcher?.Dispose();
        workspaceWatcher?.Dispose();
        Canvas.Dispose();
    }

    private async void ChooseFile(object sender, RoutedEventArgs args)
    {
        var dialog = new OpenFileDialog { Filter = "Markdown (*.md;*.markdown)|*.md;*.markdown" };
        if (dialog.ShowDialog(this) == true)
            await OpenDocument(dialog.FileName);
    }

    private async void ChooseFolder(object sender, RoutedEventArgs args)
    {
        var dialog = new OpenFolderDialog { Title = "打开 Markdown 工作区" };
        if (dialog.ShowDialog(this) == true)
            await OpenWorkspace(dialog.FolderName);
    }

    private async void OpenRecentFile(object sender, RoutedEventArgs args) => await OpenDocument((string)((FrameworkElement)sender).Tag);
    private void RemoveRecentFile(object sender, RoutedEventArgs args) => RemoveRecent((string)((FrameworkElement)sender).Tag);
    private void ClearRecentFiles(object sender, RoutedEventArgs args) => ClearRecent();
    private void ReturnHome(object sender, RoutedEventArgs args) => GoHome();
    private void FilterWorkspace(object sender, TextChangedEventArgs args) => RenderWorkspace();
    private async void SelectWorkspaceFile(object sender, RoutedPropertyChangedEventArgs<object> args)
    {
        if (args.NewValue is TreeViewItem { Tag: WorkspaceEntry { IsFile: true } entry })
            await OpenDocument(entry.Path);
    }
    private void ToggleSidebar(object sender, RoutedEventArgs args)
    {
        var show = Sidebar.Visibility != Visibility.Visible;
        Sidebar.Visibility = show ? Visibility.Visible : Visibility.Collapsed;
        SheetContainer.Margin = show ? new Thickness(0, 0, 8, 8) : new Thickness(8, 0, 8, 8);
    }
    private void OpenFind(object sender, RoutedEventArgs args) => Send(new { type = "panel", panel = "find" });
    private void OpenTypography(object sender, RoutedEventArgs args) => Send(new { type = "panel", panel = "typography" });
    private void OpenTheme(object sender, RoutedEventArgs args) => Send(new { type = "panel", panel = "theme" });

    private void OnWindowKey(object sender, KeyEventArgs args)
    {
        if (Keyboard.Modifiers != ModifierKeys.Control)
            return;

        switch (args.Key)
        {
            case Key.O: ChooseFile(sender, args); break;
            case Key.F: OpenFind(sender, args); break;
            case Key.B: ToggleSidebar(sender, args); break;
            case Key.Home: GoHome(); break;
            default: return;
        }
        args.Handled = true;
    }

    private void DragOverWindow(object sender, DragEventArgs args)
    {
        args.Effects = args.Data.GetData(DataFormats.FileDrop) is string[] { Length: > 0 } paths &&
            (Directory.Exists(paths[0]) || WorkspaceTreeService.IsMarkdown(paths[0])) ? DragDropEffects.Copy : DragDropEffects.None;
        args.Handled = true;
    }

    private async void DropOnWindow(object sender, DragEventArgs args)
    {
        args.Handled = true;
        if (args.Data.GetData(DataFormats.FileDrop) is string[] { Length: > 0 } paths)
            await Import(paths[0]);
    }
}
