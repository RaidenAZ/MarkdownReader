# Folio · 架构设计、实现现状与演进规划

> **当前版本**：`v1.1.0`（已落地可发布绿色便携版）  
> **项目定位**：面向 Windows 11 的免安装绿色 Markdown / LaTeX 阅读器与 AI Agent 实时共创手稿台（Living Manuscript on Mica）。  
> **核心约束**：零安装、零注册表写入、绝不劫持系统 `.md` / `.tex` 文件关联、100% 离线渲染、所有状态与缓存收敛在程序同级 `./data/` 目录。

---

## 1. 产品原则与硬性约束

在后续所有迭代中，以下原则视为不可破坏的架构边界：

1. **纯粹绿色便携**：运行态数据严格收敛在程序同级的 `./data/state.json` 与 `./data/webview2/`；禁止写注册表或修改系统文件关联。
2. **100% 离线零构建链依赖**：`src/MarkdownReader/Assets/Web/vendor/` 内置全部解析器、数学字体与 59 语言高亮模块，克隆仓库后无需 Node.js / `npm install` 即可直接 `dotnet build / publish`。
3. **零第三方字体打包负担**：正文字体与代码字体通过 C# 原生枚举用户本机已安装字体（`Fonts.SystemFontFamilies`），不在仓库中分发第三方 `.ttf/.woff2` 字体文件，彻底规避 OFL 等字体分发合规风险。
4. **面向 AI Agent 协作的稳定性**：外部编辑采用防抖 + 抗文件锁重试读取 + 顶层块级 DOM 差量更新，严守**阅读滚动锚点零跳动**。

---

## 2. 当前系统架构总览

项目采用 **C# (.NET 10 / WPF-UI 4.3) 原生宿主 + 透明 `WebView2CompositionControl` 排版核** 的双层混合架构，前后端通过 `PostWebMessageAsJson` 内存双向通信，安全边界由离线 CSP 与受控虚拟主机严格隔离。

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ Native Host Layer: C# (.NET 10, net10.0-windows10.0.17763.0) + WPF-UI 4.3   │
│                                                                             │
│  MainWindow.xaml / .cs (FluentWindow)                                       │
│   ├─ 原生 Win11 Mica(浅) / Tabbed(深) 外壳 + 40px 沉浸标题栏 + 多尺寸 app.ico │
│   ├─ 左侧可折叠导航栏 (228px): 工作区目录树 + 最近查阅(单删/清空/右键/动态色)  │
│   ├─ 内嵌圆角阅读画布容器 (SheetContainer, 10px 圆角半透明纸面)               │
│   ├─ 虚拟主机 https://folio.local -> Assets/Web (Deny 跨域)                  │
│   ├─ 受控图片流代理 https://media.folio.local/image?<relPath>                │
│   └─ 本机字体枚举 SendFonts() -> 中英双语标签 + 图标字体过滤                  │
│                                                                             │
│  Services/                                                                  │
│   ├─ PortableStateService.cs  -> ./data/state.json 原子写(.tmp->Move)与归一化 │
│   ├─ LiveFileWatcherService.cs-> 120ms 防抖 + IOException 60ms×5 重试读取    │
│   └─ WorkspaceTreeService.cs  -> 递归扫描 .md/.markdown/.tex（跳过隐藏/链接） │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ PostWebMessageAsJson (Web JSON)
┌──────────────────────────────────────▼──────────────────────────────────────┐
│ Editorial Canvas Layer: Transparent WebView2 (Assets/Web/)                  │
│                                                                             │
│  index.html + styles.css + renderer.js + latex.js (原生 ES Module)          │
│   ├─ AST 解析: micromark + mdast-util-from-markdown (GFM/Math/CJK/\[...\]扩展)│
│   ├─ LaTeX 流式解析: latex.js -> MDAST（复用 KaTeX/Shiki/大纲/热同步/宏展开） │
│   ├─ 数学引擎: KaTeX 离线引擎 + 22 款本地 WOFF2 字体                         │
│   ├─ 代码块引擎: Shiki Core (JS Regex, CSS Variables 主题) + 59 语言懒加载   │
│   │   └─ Notion 风格悬浮胶囊工具栏(复制/自动换行/长代码>26行自动折叠) + Diff │
│   ├─ 图表引擎: Mermaid 12.3 离线懒加载(mermaid.min.js) + 双模主题 + 容错回退 │
│   ├─ 缩放灯箱: 通用毛玻璃灯箱(#lightbox)，支持 Mermaid 与正文图片滚轮缩放拖拽│
│   ├─ 差量热同步: 顶层块签名首尾匹配 + 视口锚点补偿 + 3.6s 青玉侧边微光        │
│   ├─ 阅读辅助: 悬浮毛玻璃圆角大纲(H1-H4, 可折胶囊) / 左右隐形边缘拖拽调宽     │
│   └─ 交互浮层: CSS Highlight 查找 / Aa 排版(字体+进度记忆开关) / 主题面板    │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.1 目录与模块职责清单

| 路径 | 职责说明 |
| :--- | :--- |
| `MarkdownReader.sln` | 解决方案入口 |
| `src/MarkdownReader/MarkdownReader.csproj` | `.NET 10` WPF 工程配置（`v1.1.0`、内嵌 `app.ico`、`Assets/Web` 同步复制到输出/发布目录） |
| `src/MarkdownReader/App.xaml(.cs)` | WPF-UI 主题字典加载与命令行启动参数解析（支持传入单文件或文件夹路径） |
| `src/MarkdownReader/MainWindow.xaml(.cs)` | 窗口布局、侧栏交互、WebView2 宿主安全策略、消息分发、文件/工作区监听调度 |
| `src/MarkdownReader/Services/PortableStateService.cs` | 便携状态模型（含 `ReadingProgress` 进度字典与 `ReadingSettings`）与原子持久化 |
| `src/MarkdownReader/Services/LiveFileWatcherService.cs` | 文件/目录变更监听、120ms `DispatcherTimer` 防抖与抗锁重试读取 |
| `src/MarkdownReader/Services/WorkspaceTreeService.cs` | 文件夹内文档树构建（仅保留含 `.md`/`.markdown`/`.tex` 的非空目录） |
| `src/MarkdownReader/Assets/app.ico` / `app-icon.png` | 多尺寸应用图标（16–256px）及展示图 |
| `src/MarkdownReader/Assets/Web/index.html` | 严格 CSP、欢迎页、阅读纸面、悬浮大纲、三类 `<dialog>` 浮层与通用缩放灯箱 |
| `src/MarkdownReader/Assets/Web/styles.css` | 浅/深双模 CSS Token、排版细节、Notion 代码块、Mermaid 卡片与灯箱样式 |
| `src/MarkdownReader/Assets/Web/renderer.js` | Markdown/LaTeX 统一渲染管线、Mermaid 懒加载与灯箱、阅读进度记忆、块级热同步与大纲/查找 |
| `src/MarkdownReader/Assets/Web/latex.js` | 离线 LaTeX → MDAST 流式解析器（章节、公式环境、学术定理框、表格、代码、宏展开与优雅降级） |
| `src/MarkdownReader/Assets/Web/example.md` | 内置全特性排版样张（含公式、代码、Diff、提示块、表格、本地插图与 Mermaid 图表） |
| `src/MarkdownReader/Assets/Web/vendor/` | 预构建离线 `vendor.js`、`mermaid.min.js`（v12.3.0 MIT）、`katex.css`、22 数学字体与 59 种 Shiki 语言模块 |

---

## 3. 前后端通信协议与数据契约

后续新增功能若涉及 C# 与 WebView2 交互，请沿用以下统一 JSON 契约（`JsonSerializerDefaults.Web`，小驼峰命名）：

### 3.1 Host -> Web 消息（`type` 字段）
| `type` | 载荷关键字段 | 用途 |
| :--- | :--- | :--- |
| `fonts` | `fonts: [{ css, label }]` | 首次 `ready` 时下发本机可用字体列表 |
| `settings` | `reading: ReadingSettings, dark: bool` | 同步主题状态、排版参数、字体与大纲开关 |
| `recent` | `recent: [{ path, isActive, name, displayName }]` | 同步欢迎页「最近查阅」列表 |
| `document` | `document: { path, name, text, updated, isExample, format }, live: bool, progress?: number` | 首次打开（`live=false`，按需携带上次阅读进度比例 `0–1`）或 Agent 热更新（`live=true`）；`format` 为 `"markdown"` 或 `"latex"` |
| `home` | 无 | 切回初始欢迎页并清空当前文档状态 |
| `panel` | `panel: "find" \| "typography" \| "theme"` | 切换对应顶部浮层（重复点击自动 Toggle 关闭） |
| `error` | `message: string` | 底部毛玻璃 Toast 提示错误 |

### 3.2 Web -> Host 消息（`action` 字段）
| `action` | 载荷关键字段 | 用途 |
| :--- | :--- | :--- |
| `ready` | 无 | Web 初始化就绪，触发 Host 下发字体、设置、最近列表与待渲染文档 |
| `openFile` / `openFolder` / `example` / `home` / `toggleSidebar` | 无 | 触发原生文件/目录选择器、打开样张、回首页或折叠侧栏 |
| `openRecent` / `removeRecent` / `clearRecent` | `path?` | 打开、单条移除或清空最近查阅记录 |
| `settings` | `reading: ReadingSettings` | 持久化阅读设置（Host 端执行 `Normalize()` 校验后写盘） |
| `progress` | `path: string, ratio: number` | 滚动节流（500ms）或切页/退出时上报阅读进度比例（仅 `rememberProgress=true` 且非样张生效） |
| `externalLink` | `url` | 仅允许 `http` / `https` / `mailto` 由系统默认浏览器安全打开 |

### 3.3 持久化状态结构（`./data/state.json`）
```json
{
  "recent": ["最多 12 条本地 Markdown 绝对路径"],
  "readingProgress": { "最多 50 篇本地文档绝对路径": 0.42 },
  "workspace": "上次打开的工作区目录路径或 null",
  "window": { "left": 0, "top": 0, "width": 1180, "height": 800, "maximized": false },
  "reading": {
    "theme": "system | light | dark",
    "font": "sans | serif",
    "fontSize": 17,
    "contentWidth": 820,
    "outlineOpen": true,
    "autoPromoteRecent": false,
    "rememberProgress": false,
    "bodyFont": "",
    "codeFont": ""
  }
}
```
> `contentWidth` 有效范围为 `620–1800`（单位 `px`），`0` 表示自适应满宽。`bodyFont` / `codeFont` 经 `CleanFontName` 清洗，空字符串表示使用默认预设。`readingProgress` 按滚动比例存储（顶部 `< 40px` 自动清除），避免字号/视幅变化导致定位偏移。

### 3.4 安全与沙箱边界
- **严格 CSP**：`default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: https://media.folio.local; base-uri 'none'; form-action 'none'`（放行 `data:` 仅用于 Mermaid 生成的内联 SVG/图元，绝不开放任何外网域）。
- **导航锁定**：`NavigationStarting` 拦截除 `https://folio.local/index.html` 外的一切跳转；`NewWindowRequested` 一律取消；外链经协议白名单校验后交由操作系统打开。
- **本地图片代理**：`ServeImage` 仅接受当前打开文档的相对路径（拒绝绝对路径、`:`、`\0`）且扩展名在图片白名单内（`.png/.jpg/.jpeg/.gif/.webp/.svg/.bmp/.ico/.avif`），返回 `Cache-Control: no-store` 以支持图片实时更新。

---

## 4. 视觉与交互设计现状（Codex + Fluent 2 融合风格）

相比最初的纯平云母草图，当前视觉体系已完成向 **Codex 桌面端 + Windows 11 Fluent 2** 的演进定型：

- **双层空间层次**：
  - 外框采用原生 `Mica`（浅色）/ `Tabbed`（深色）与 40px 无边框幽灵图标标题栏，侧栏（228px）直接融入云母基底，全部文字与树节点绑定 `DynamicResource` 确保浅/深色切换即时联动。
  - 主阅读区采用内嵌 `10px` 圆角半透明纸面容器（`SheetContainer`：浅色 `rgba(252,252,253,0.84)`、深色 `rgba(24,26,31,0.77)` + 极细 1px 边框），视觉干净聚焦。
- **自由视幅与隐形导轨**：
  - 支持 `Aa` 面板三档预设（标准 `760px` / 舒展 `980px` / 自适应满宽 `0`）与正文左右 24px 边缘拖拽无级调节（`620–1800px`，双击恢复 `820px`）。
  - 左右拉伸渐变提示线默认完全隐形（`opacity: 0`），仅鼠标悬停热区或拖拽时柔和显现，保证阅读零干扰。
- **悬浮毛玻璃大纲（Floating Outline Card）**：
  - 右侧固定 `236px` 圆角毛玻璃悬浮卡，高度随标题数量自适应，支持一键收起为右上角轻量胶囊。
  - 标题文本包裹于内部 `<span>` 承载 2 行截断（`line-height: 1.42`），彻底杜绝长标题第三行像素溢出。
- **Notion 风格紧凑代码块**：
  - 取消固定通栏顶栏，改为悬停时右上角浮现毛玻璃胶囊工具栏（美化语言名 + 一键复制 + 自动换行切换 + 折叠切换）。
  - 行高 `1.66`、字号 `0.82em`、内边距 `18px 20px`，中文字体回退补齐 `Microsoft YaHei UI`；超过 `26` 行的长代码默认折叠至 `400px`（`Ctrl+F` 搜索命中折叠内部时自动展开）。
- **高效面板与历史管理**：
  - 顶部三枚浮层按钮支持重复点击 Toggle 关闭，排版/主题面板支持点击外部空白区域自动收起。
  - 「最近查阅」在左侧导航栏与欢迎页双端同步，支持单条悬停 `×` 移除、右键菜单移除、一键清空以及可选「点击旧文档时自动置顶」（默认关闭）。
- **Mermaid 离线图表与通用缩放灯箱**：
  - 仅在文档包含 ```` ```mermaid ```` 块时才动态加载本地 `vendor/mermaid.min.js`，零常驻启动开销；切换浅/深色主题时自动按 Folio 调色板重绘。
  - 悬浮胶囊工具栏支持「图表 / 源码切换」「复制源码」「放大查看」；AI 流式编辑语法未闭合时静默回退源码展示，保存闭合后自动恢复图表。
  - 点击 Mermaid 图表或正文任意图片可呼出全屏毛玻璃灯箱（`#lightbox`），支持滚轮缩放（25%–500%）、鼠标拖拽平移、双击重置 1:1 及 `Esc` / 点击空白关闭。
- **LaTeX (`.tex`) 离线流式阅读**：
  - 通过 `latex.js` 将 `.tex` 实时转换为与 Markdown 共用的 MDAST 节点，原生享有 KaTeX 数学渲染（含单文件 `\newcommand` / `\DeclareMathOperator` 宏透传）、Shiki 代码高亮（`lstlisting`/`minted`/`verbatim`）、本地图片代理（`\includegraphics`）、右侧悬浮大纲、字体/视幅切换与 Agent 块级热同步；遇到 TikZ 等复杂自定义环境自动降级为可折叠 LaTeX 源码块。

---

## 5. 迭代进展记录

| 阶段 | 核心交付内容 | 状态 |
| :--- | :--- | :--- |
| **Phase 1：工程基建与离线核** | `.NET 10` 工程搭建、`WPF-UI 4.3` / `WebView2` 集成、离线抽取 `micromark` + `KaTeX`（22 字体）+ `Shiki`（59 语言） | ✅ 已完成 |
| **Phase 2：原生云母宿主与服务层** | `PortableStateService`、`LiveFileWatcherService`、`WorkspaceTreeService`、`MainWindow` 侧栏/拖拽/命令行参数 | ✅ 已完成 |
| **Phase 3：排版画布与实时同步** | 全语法渲染管线、顶层块级差量热更新与锚点保持、页内查找、欢迎页与排版样张 | ✅ 已完成 |
| **Phase 4：视觉精修与功能完善** | Codex/Fluent 2 圆角纸面改版、悬浮大纲与长标题修复、隐形边缘调宽、Notion 风格代码块（含自动换行/折叠/行距调优）、本机正文与代码字体自由选择、最近查阅增删清空与可选置顶、浮层 Toggle/外部点击关闭、深色模式侧栏动态色修复、多尺寸 `app.ico` | ✅ 已完成 |
| **Phase 5：开源发布准备** | `.gitignore` / `.gitattributes` / `LICENSE` / `README.md` 补全与 Release 绿色包验证 | ✅ 已完成 |
| **Phase 6（v1.1）：阅读记忆、Mermaid 与 LaTeX 支持** | 可选阅读进度记忆（默认关闭，`Aa` 面板开关）、Mermaid 12.3 离线懒加载渲染与通用图片/图表缩放灯箱、`.tex` 离线流式阅读引擎 `latex.js` | ✅ 已完成 |

---

## 6. 后续演进建议（Roadmap）

以下方向按投入产出比与对核心极简定位的契合度排序，可作为后续迭代候选：

1. **多标签页或分屏对照（可选轻量模式）**：在保持单文档极简默认体验的前提下，探索轻量标签栏或双栏对照阅读（适合同时对比多份架构文档或 Diff 稿）。
2. **导出 PDF / 打印样式优化**：利用 WebView2 原生 `PrintToPdfAsync` 配合 `@media print` 规则，一键导出干净的出版级 PDF（自动隐藏悬浮大纲与交互工具栏）。
3. **工作区体验增强**：支持在侧栏树中高亮当前打开文档、显示文件相对修改时间或「在资源管理器中定位」右键操作。
4. **LaTeX 进阶能力**：按需扩展 `\input` / `\include` 同目录多文件内联展开、`\label` + `\ref` 文内锚点跳转与 `.bib` 参考文献悬浮预览。
