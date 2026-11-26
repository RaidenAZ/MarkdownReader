<div align="center">
  <img src="../src/MarkdownReader/Assets/app-icon.png" width="96" height="96" alt="Folio Icon" />
  <h1>MarkdownReader</h1>
  <p><strong>Living Manuscript on Mica · 面向 Windows 11 与 AI 协作时代的便携式 Markdown 阅读器</strong></p>
</div>

---

**MarkdownReader** 是一款专为沉浸阅读与 AI Agent 实时协作场景设计的轻量级桌面 Markdown / LaTeX 阅读器。它基于 **WPF-UI (Fluent 2 / Mica)** 与 **透明 WebView2 排版引擎** 构建，在零外网依赖、免安装纯绿色的前提下，提供媲美现代书刊的排版品质与毫秒级无感热同步体验。

## ✨ 核心特性

- **Codex / Fluent 2 原生云母美学**
  - 采用 Windows 11 原生 **Mica / Tabbed** 材质外框与沉浸式无边框标题栏，搭配内嵌式微圆角阅读画布，支持**跟随系统 / 浅色 / 深色**三态无缝切换。
- **AI Agent 毫秒级无感实时同步（Live Sync）**
  - 内置 `120ms` 防抖与文件锁重试机制，完美兼容各类 AI 编码助手（Codex、Claude Code、Cursor 等）高频写入或临时文件原子替换。
  - 采用**顶层块级差量更新（Block-level Diff）**，外部修改保存瞬间更新正文，**严格锁定当前阅读滚动位置零跳动**，并在新增/变更段落左侧浮现柔和青玉色微光提示。
- **全离线高精度书刊级排版**
  - **完整语法支持**：基于 `micromark` + `mdast` 支持完整 GFM 表格、任务列表、删除线与自动链接。
  - **LaTeX 文档（`.tex`）流式阅读**：支持直接打开、拖入或在工作区浏览 `.tex` 文档，离线解析标题/作者/摘要、章节大纲、数学环境（`equation`/`align`/`gather` 等）、单文件宏定义、定理框、表格与代码块，复杂环境自动降级为可折叠源码。
  - **LaTeX 数学公式**：内置离线 `KaTeX` 引擎与 22 套本地 WOFF2 字体，原生支持 `$...$`、`$$...$$`、`\(...\)` 与 `\[...\]`。
  - **Mermaid 离线图表与通用缩放灯箱**：内置离线 `Mermaid 12.3` 按需懒加载渲染（自动适配浅/深色主题、支持源码切换与 AI 流式写作容错）；点击 Mermaid 图表或正文图片均可进入毛玻璃灯箱滚轮缩放与拖拽审阅。
  - **59 种语言语法高亮**：内置 `Shiki` 引擎，支持代码双主题着色、Unified Diff 增删高亮与一键复制。
  - **语义化提示块**：原生渲染 GitHub 风格 `[!NOTE]`、`[!TIP]`、`[!IMPORTANT]`、`[!WARNING]`、`[!CAUTION]` 五类 Callout。
- **自由顺手的阅读与工作区体验**
  - **无级视幅拖拽**：除了「标准 / 舒展 / 自适应满宽」预设外，鼠标移至正文左右边缘即可呼出柔和渐变导轨，自由拖拽调节阅读宽度（双击恢复默认舒适视幅）。
  - **本机字体自由定制**：自动枚举本机已安装字体（零第三方字体打包与许可证负担），支持在 `Aa` 排版面板独立自选**正文字体**与**代码等宽字体**（如 `JetBrains Mono`、`Fira Code`、`霞鹜文楷` 等）。
  - **毛玻璃悬浮大纲**：右侧自动提取 `H1–H4` 生成自适应高度的圆角毛玻璃目录卡，支持滚动高亮跟随与一键折叠为轻量胶囊。
  - **工作区、历史与进度记忆**：支持拖拽导入单文件或整个文档文件夹目录树（带实时筛选），「最近查阅」支持单条移除、批量清空与可选自动置顶，并可在 `Aa` 面板按需开启「记忆阅读进度」。
- **纯粹绿色便携（Zero Registry Pollution）**
  - 免安装解压即用，**绝不写入系统注册表、不劫持系统默认 `.md` 文件关联**。
  - 所有阅读偏好、最近记录与 WebView2 运行缓存均收敛保存在程序同级的 `./data/` 目录下，拷贝文件夹即可完整迁移。

## ⌨️ 常用快捷键

| 快捷键 | 功能说明 |
| :--- | :--- |
| `Ctrl + O` | 打开本地 Markdown 文档 |
| `Ctrl + F` | 开启页内关键词查找（`Enter` / `Shift + Enter` 跳转上下匹配） |
| `Ctrl + B` | 展开 / 收起左侧导航栏 |
| `Ctrl + Home` | 返回起始欢迎页 |
| `双击正文左右边缘` | 恢复默认 `820px` 黄金阅读视幅 |

## 🛠️ 技术栈与工程结构

- **桌面宿主**：`.NET 10.0` (`net10.0-windows10.0.17763.0`) + `WPF` + `WPF-UI 4.3` + `CommunityToolkit.Mvvm`
- **渲染内核**：`WebView2CompositionControl`（虚拟主机映射 `https://folio.local` + 受控本地相对路径图片流代理，开启严格离线 CSP）
- **前端引擎**：原生 ES Modules + 本地离线打包 `vendor.js`（`micromark` / `KaTeX` / `Shiki`）

```text
MarkdownReader/
├── MarkdownReader.sln                  # 解决方案入口
├── DESIGN_AND_PLAN.md                  # 架构设计与视觉规范文档
└── src/MarkdownReader/
    ├── Assets/
    │   ├── app.ico / app-icon.png      # 多尺寸应用图标资源
    │   └── Web/                        # 离线排版前端资源
    │       ├── index.html              # 阅读器与浮层 DOM 结构
    │       ├── styles.css              # 主题令牌、排版与交互样式
    │       ├── renderer.js             # MDAST 渲染、Mermaid/灯箱、块级差量同步与大纲/查找
    │       ├── latex.js                # 离线 LaTeX (.tex) 流式解析器
    │       ├── example.md              # 内置全特性排版样张
    │       └── vendor/                 # 离线 KaTeX 字体、Mermaid 12.3、Shiki 59 语言语法与核心包
    ├── Services/
    │   ├── LiveFileWatcherService.cs   # 防抖与抗锁重试文件监听器
    │   ├── PortableStateService.cs     # 便携状态读写 (./data/state.json)
    │   └── WorkspaceTreeService.cs     # 文件夹 Markdown 目录树递归扫描
    ├── MainWindow.xaml                 # FluentWindow 云母主窗口与侧栏 UI
    └── MainWindow.xaml.cs              # 窗口宿主、WebView2 桥接与本地图片安全代理
```

## 🚀 开发环境准备与构建指南

### 1. 环境前置要求

- **操作系统**：Windows 10 (1809+) 或 **Windows 11**（推荐 Windows 11 以获得完整的原生 Mica 云母材质体验）
- **.NET SDK**：[.NET 10.0 SDK](https://dotnet.microsoft.com/download/dotnet/10.0) 或更高版本
- **WebView2 Runtime**：Windows 11 已系统内置；若在精简版 Windows 10 上运行，需安装 [Microsoft Edge WebView2 Evergreen Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)

> **💡 关于前端离线依赖**：`src/MarkdownReader/Assets/Web/vendor/` 已随仓库内置全部预构建的离线解析、公式字体与代码高亮语法模块，**克隆仓库后无需安装 Node.js 或执行 `npm install` 即可直接编译运行**。

### 2. 本地还原与开发调试

克隆仓库后，在项目根目录打开终端（PowerShell / Windows Terminal）：

```powershell
# 还原 NuGet 依赖
dotnet restore .\MarkdownReader.sln

# 启动 Debug 开发运行
dotnet run --project .\src\MarkdownReader\MarkdownReader.csproj
```

你也可以直接在命令行传入文件路径或文件夹路径启动预览：

```powershell
dotnet run --project .\src\MarkdownReader\MarkdownReader.csproj -- .\README.md
```

### 3. 构建免安装绿色发布包（Release）

- **自包含绿色版（推荐分发，目标机器无需安装 .NET Runtime）**：

```powershell
dotnet publish .\src\MarkdownReader\MarkdownReader.csproj `
  -c Release `
  -r win-x64 `
  --self-contained true `
  -o .\publish\MarkdownReader
```

- **框架依赖轻量版（体积更小，需目标机器已安装 .NET 10 Desktop Runtime）**：

```powershell
dotnet publish .\src\MarkdownReader\MarkdownReader.csproj `
  -c Release `
  -r win-x64 `
  --self-contained false `
  -o .\publish\MarkdownReader-Light
```

构建完成后，直接运行输出目录中的 `MarkdownReader.exe`，或将整个输出文件夹打包压缩即可分发给其他用户使用。

## 📄 License

Released under the MIT License.
