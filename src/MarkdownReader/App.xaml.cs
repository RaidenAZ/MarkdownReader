using System.Windows;

namespace MarkdownReader;

public partial class App : Application
{
    private void Start(object sender, StartupEventArgs args)
    {
        MainWindow = new MainWindow(args.Args.FirstOrDefault());
        MainWindow.Show();
    }
}
