# Folio · Markdown 阅读器架构设计与实施进度

> **项目定位**：面向 Windows 11 的免安装绿色 Markdown 阅读器与 AI Agent 实时共创手稿台（Living Manuscript on Mica）。  
> **核心原则**：零安装、绝不篡改系统 `.md` 默认文件关联、便携式记录历史状态、出版级排版质感、毫秒级无损响应外部 Agent 编辑。

---

## 1. 背景与核心诉求

日常查阅本地大量 Markdown 文档，以及配合 AI Coding Agent 实时编写/修改文档时，现有工具存在明显短板：
- **系统自带记事本**：渲染样式简陋，缺乏公式、语法高亮、提示块等现代排版能力，长文阅读体验差。
- **重型桌面客户端（Typora / Obsidian 等）**：普遍需要安装，容易写入注册表或劫持系统默认 `.md` 打开方式，体量偏重。

因此，本项目确立以下**核心交付标准**：
1. **免安装绿色文件夹形态**：直接解压或放在任意目录即可双击运行，**零注册表写入、不修改系统文件关联**；同时利用同级便携目录（`data/state.json`）持久化保存最近打开的文档、文件夹工作区及个人阅读偏好。
2. **多途径便捷导入**：支持「打开单文件」、「打开文件夹（生成侧边文档树）」、「窗口拖拽直接导入」、「命令行参数启动」以及初始欢迎页的「最近查阅列表」一键续读。
3. **AI Agent 实时联动（Live Reload）**：当外部 Agent 编辑并保存 `.md` 文件时，自动捕获文件变更（兼容临时文件原子替换写入），在**锁定当前阅读滚动位置不跳动**的前提下完成差量更新，并在新修改的段落侧边提供克制的视觉呼吸提示。
4. **高质量全特性渲染**：原生级离线支持 **LaTeX 数学公式（KaTeX）**、**多语言代码块语法高亮与 Diff 视图（Shiki）**、**GFM Notice / Callout 提示块**、优雅引用块、表格、任务列表以及本地相对路径图片。

---

## 2. 技术架构方案

结合本机环境（Windows 11 Build 26300 + `.NET 10 SDK 10.0.115` + 系统内置 `Edge WebView2 Runtime`），采用 **C# (.NET 10) + WPF-UI + 透明 WebView2 混合双层架构**：

```text
┌───────────────────────────────────────────────────────────────────────────┐
│  Native Host Layer: C# (.NET 10) + WPF-UI 4.3 + CommunityToolkit.Mvvm     │
│  - 原生 Win11 DWM Mica / Mica Alt 云母透光窗口与沉浸式无边框标题栏          │
│  - 便携状态管理 (PortableStateService -> ./data/state.json & ./data/wv2)  │
│  - 防抖动 + 原子写兼容监听 (LiveFileWatcher: LastWrite | FileName | Size)  │
│  - WebView2 虚拟主机映射 (https://folio.local/ 零跨域加载离线引擎与本地图)  │
└─────────────────────────────────────┬─────────────────────────────────────┘
                                      │ PostWebMessageAsJson (双向内存通道)
┌─────────────────────────────────────▼─────────────────────────────────────┐
│  Editorial Canvas Layer: Transparent WebView2 (DefaultBackgroundColor=0)  │
│  - AST 解析核: micromark + mdast-util-from-markdown (GFM + Math + CJK)    │
│  - 数学公式核: KaTeX 离线引擎 + 22 款本地 WOFF2 数学字体                   │
│  - 代码高亮核: Shiki Core (JS Engine) + 59 种编程语言离线语法包 + Diff 渲染 │
│  - 提示与结构: GitHub Alerts (> [!NOTE] 等) / 引用块 / 右侧滚动跟随大纲    │
│  - 差量热更新: 块级 DOM 比对更新 + 滚动锚点保持 + Agent 修改段落侧边微光   │
└───────────────────────────────────────────────────────────────────────────┘
```

### 关键工程决策说明
- **为什么选择 WPF-UI 4.3 而非 WinUI 3**：WPF-UI 在 `.NET 10` 下可直接输出纯净的绿色文件夹版本，无需安装 MSIX 包或额外的 Windows App Runtime，彻底杜绝抢占默认打开方式的问题，同时完整调用 Win11 原生 `Mica` 材质。
- **100% 离线零 CDN 依赖**：所有前端排版引擎（解析器、KaTeX、Shiki 59 语言包、数学字体）均内置于程序目录 `Assets/Web/vendor` 中，断网或内网受限环境下依然秒开渲染。
- **本地相对路径图片无缝解析**：阅读某个 `.md` 文档时，C# 宿主动态将该文档所在目录映射至虚拟主机路径（或拦截本地图片资源流），使得 `./images/diagram.png` 或 Windows 相对路径图片无需任何浏览器权限弹窗即可直接显示。

---

## 3. 视觉与排版设计规范（遵循 `frontend-design`）

### 3.1 设计母题：「云母之上的活页手稿台（Living Manuscript on Mica）」
摒弃千篇一律的“灰底套白卡片阴影（SaaS Card 套路）”与浮夸渐变，让 WebView2 画布背景保持透明，直接呼吸在原生 Windows 11 Mica 云母材质之上；仅用克制的 `1px` 细线（Hairline Rule）与精准的字号比例建立秩序，**让正文排版成为唯一主角**。

### 3.2 核心色彩 Token（双模云母调色板）

| Token 名称 | 浅色模式 (Daylight Mica) | 深色模式 (Obsidian Mica Alt) | 用途说明 |
| :--- | :--- | :--- | :--- |
| `Canvas Surface` | 原生 Mica + `#F7F8FA` (65% 罩染) | 原生 Mica Alt + `#14161A` | 主阅读区通透基底，透出桌面漫反射质感 |
| `Graphite Ink` | `#181A1F` | `#E6E8EC` | 正文主墨色，高对比度且避免纯黑/纯白刺眼 |
| `Slate Muted` | `#5E6673` | `#949BA6` | 次级元数据、未激活大纲项、代码块行号与引文旁注 |
| `Hairline Rule` | `#DDE2EA` | `#282C34` | 1px 结构分割线与表格细框，不加虚浮阴影 |
| `Cobalt Accent` | `#2563EB` | `#60A5FA` | 链接、激活态大纲游标与键盘焦点环 |
| `Live Jade` | `#0D9488` | `#2DD4BF` | **唯一动态焦点**：Agent 实时监听圆点及新修改段落左侧 2px 呼吸提示线 |

### 3.3 字体排印与阅读体验（Typography & Callouts）
- **字体组合**：
  - **现代无衬线模式（默认）**：`Segoe UI Variable`（利用 Display / Text 光学字重）搭配中文 `Microsoft YaHei UI` / `HarmonyOS Sans SC`。
  - **书刊衬线模式（一键切换）**：Windows 原生屏幕阅读衬线体 `Sitka Text` 搭配中文衬线排印，行高提升至 `1.78`，适合深度长文阅读。
  - **等宽代码字体**：`Cascadia Code` / `Consolas`，字号 `0.88em`，配语言标识与一键复制反馈。
- **行宽与对齐**：正文严格左对齐（Left-aligned），标准模式锁定 **`68ch`（约 720px）** 黄金阅读视幅，并提供「宽屏模式」以便查阅宽幅数据表格与代码对比。
- **Notice / Callout 专项设计**：支持 `> [!NOTE]`、`> [!TIP]`、`> [!IMPORTANT]`、`> [!WARNING]`、`> [!CAUTION]` 五类语义化提示块。采用左侧语义色细边线 + 极低饱和度同色系半透明底衬 + 简洁线性图标标题，清晰醒目而不破坏阅读心流。

### 3.4 空间布局结构

```text
+----------------------------------------------------------------------------------+
| [图标] Folio    design-spec.md  [● 实时监听中]        [查找] [Aa] [主题] [_][□][X] | <- 38px 沉浸式 Mica 标题栏
+--------------------+---------------------------------------------+---------------+
| 工作区 / 最近打开   |                                             | 本文大纲      |
|                    |  # 一级标题作为开篇锚点                      |               |
| ▾ 当前文件夹       |  更新于刚刚 · 约 5 分钟阅读                  | 核心背景      |
|   README.md        |  ─────────────────────────────────────────  | 技术架构方案 ◄| <- 1px 钴蓝游标跟随
| ● design-spec.md   |                                             |   关键决策    |
|   notes/           |  正文直接呈现在通透云母层上，保持 68ch 舒适  | 视觉设计规范  |
|                    |  视幅，支持行内公式 $E=mc^2$ 与独立公式块。  | 实施进度清单  |
| ▾ 最近查阅         |                                             |               |
|   api-guide.md     |  ┃ [Agent 刚修改的段落] 左侧浮现 2px 青玉色  |               |
|                    |  ┃ 微光边线，数秒后安静隐去，滚动位置零跳动  |               |
| [+ 文件] [+ 文件夹]|                                             |               |
+--------------------+---------------------------------------------+---------------+
  可折叠侧栏 (240px)     主阅读画布（无卡片外框，支持初始欢迎台）     悬浮大纲 (200px)
```

---

## 4. 实施计划与当前进度

### ✅ 已完成部分（Phase 1：工程基建与离线渲染资源就绪）
1. **本机环境与离线源配置**：
   - 验证 Windows 11 原生 Mica 支持、`.NET 10.0.115` SDK 与系统内置 `WebView2 Runtime (157.0.4341.60)`。
   - 建立解决方案 [`MarkdownReader.sln`](<MarkdownReader.sln>)、离线包源配置 [`NuGet.Config`](<NuGet.Config>) 及主工程 [`MarkdownReader.csproj`](<src/MarkdownReader/MarkdownReader.csproj>)。
   - 完成 `WPF-UI 4.3.0`、`Microsoft.Web.WebView2 1.0.3179.45`、`CommunityToolkit.Mvvm 8.4.2` 本地包还原验证（耗时约 4 秒，零外网依赖）。
2. **全套离线排版与高亮引擎抽取（`Assets/Web/vendor`）**：
   - 核心解析与数学包：就绪 [`vendor.js`](<src/MarkdownReader/Assets/Web/vendor/vendor.js>)（内置 `micromark` + `mdast-util-from-markdown` GFM/Math/CJK 扩展、`KaTeX` 核心、`Shiki` 核心引擎）。
   - 数学公式样式与字体：就绪 [`katex.css`](<src/MarkdownReader/Assets/Web/vendor/katex.css>) 及 `Assets/Web/vendor/fonts/` 下的 **22 个 WOFF2 字体文件**。
   - 多语言代码高亮语法库：在 `Assets/Web/vendor/langs/` 下完成 **59 种编程语言语法模块**（含 C#、C/C++、Python、Rust、Go、TypeScript/JS、SQL、PowerShell、LaTeX、Diff、Markdown、YAML 等）的去哈希规范化与相对导入路径修复。

### ✅ 已完成部分（Phase 2–4 及 Codex / Fluent 视觉精修）

- **Phase 2：WPF 原生云母宿主与核心服务层（C#）** ✅
  - 实现 `PortableStateService`：在程序同级 `data/state.json` 读写最近打开文档列表、上次打开的文件夹、窗口尺寸位置、主题（跟随系统/浅色/深色）与字号/字体/页宽配置；将 WebView2 用户数据目录重定向至 `./data/webview2` 确保纯粹便携。
  - 实现 `LiveFileWatcherService`：封装 `FileSystemWatcher`，监听目标文档及目录变动，内置 **120ms 防抖** 与 **文件占用重试读取机制**（完美应对 AI Agent 先写临时文件再 Rename 覆盖或短时文件锁场景）。
  - 实现 `WorkspaceTreeService`：递归扫描导入文件夹中的 `.md` / `.markdown` 文档结构，支持快速过滤。
  - 构建 `MainWindow.xaml`（`FluentWindow`）：原生 Mica 背景、自定义沉浸标题栏、可折叠左侧「最近查阅 / 文件夹树」侧栏、文件与文件夹选择对话框、全局窗口拖拽导入（Drag & Drop）及命令行启动参数解析。

- **Phase 3：高精度透明排版核与交互界面（Web Canvas）** ✅
  - 编写 `Assets/Web/index.html`、`styles.css`、`renderer.js`：
    - **初始欢迎页（Empty State）**：未打开文档时展示清爽的拖拽导入引导区、打开文件/文件夹快捷入口、最近打开文档卡片列表，以及一键体验「内置全特性排版示例文档」按钮。
    - **全语法渲染管线**：MDAST 转高精度语义 HTML，支持标题锚点提取、KaTeX 行内 `$...$` / 块级 `$$...$$`（及 `\(...\)`、`\[...\]`）公式渲染、Shiki 59 语言动态高亮 + 一键复制 + Unified Diff 增删着色、5 类 GFM Notice 提示块、精致引用与自适应表格。
    - **Agent 实时差量同步**：接收 C# 推送的最新 Markdown 源码，按顶层块比对更新 DOM，严格保持当前阅读滚动锚点，并对新增/修改块施加左侧青玉微光提示。
    - **阅读辅助工具与视觉体验**：内嵌圆角画布（Codex / Fluent 2 风格）、右侧圆角毛玻璃自适应悬浮大纲（支持折叠为胶囊并解决了多行长标题裁切问题）、左右双侧柔和渐变拉伸线支持无级调节阅读宽度、可选「点击旧文档时自动置顶」开关、多尺寸应用图标 `Assets/app.ico`。

- **Phase 4：绿色文件夹编译发布与全流程实测** ✅
  - 执行 Release 编译产出免安装绿色文件夹（如 `./publish/MarkdownReader/`），内置一份涵盖公式、代码块、Diff、5 种 Notice 提示块、引用与表格的演示文档。
  - 启动程序进行真机运行截图自检（遵循 `frontend-design` 审美标准检查留白、对比度与排版细节），并模拟 Agent 实时修改 `.md` 文件验证无感热刷新效果。
