# Folio · LaTeX 离线渲染「错题本」与排查指南

> 本文档记录 Folio（`src/MarkdownReader/Assets/Web/latex.js` + `KaTeX` 离线流式阅读引擎）在真实学术 `.tex` 文档（`testmath.tex`、`sample2e.tex`、`apssamp.tex`）压测中遇到过的典型渲染问题、根因分析、修复策略与后续排查方法。

---

## 1. 核心定位与「真问题 vs 伪问题」甄别

在排查 `.tex` 渲染效果时，先区分两类表面相似但性质完全不同的现象：

- **情况 A（真报错 / 漏解析）**：公式区域出现 KaTeX 红色未定义命令（如 `\abs`、`\eval`、`\hdotsfor`）、正文出现原始转义字符（如 `M\"obius`、`\@`），或本应渲染为公式/定理的环境被误降级成了代码框。
- **情况 B（原文自带源码示例，非渲染失败）**：类似 AMS 官方样本 `testmath.tex` 这类「文档本身就在教你怎么写 LaTeX」的文件，正文里会在每个渲染好的公式下方**故意写一个 `\begin{verbatim}...\end{verbatim}`** 来展示刚才那段公式的 LaTeX 源码（如 `\begin{multline}...\end{multline}`、`\[v^k_i=...\begin{cases}...\]`、`\det\mathbf{K}(i|i)=...`）。Folio 把 `verbatim` 渲染成语法高亮代码块是**完全符合原文语义的预期行为**，不能误当作“公式渲染失败”。

---

## 2. 已踩过的坑与修复方案清单

### 问题 1：导言区 `\let` 宏别名与带可选默认参数的 `\newcommand` 丢失（导致大面积 `\abs` / `\norm` / `\eval` 报红）
- **现象**：`testmath.tex` 全文出现 46 处 `\abs` 报红、1 处 `\norm` 报红、5 处 `\eval` 报红。
- **根因**：
  1. 文档导言区使用 TeX 原语 `\let\abs=\envert`、`\let\norm=\enVert` 给宏起别名，原解析器只扫了 `\newcommand`，未提取 `\let`。
  2. `\newcommand{\eval}[2][\right]{\relax \ifx#1\right\relax \left.\fi#2#1\rvert}` 带有 `[default]` 可选参数和 `\ifx...\fi` 条件判断，KaTeX 的 `macros` 选项原生不支持带默认可选参数的宏与 `\ifx` 原语。
- **修复方案**（`latex.js` → `extractMacros` & `preprocessMath`）：
  1. 增加 `\let\alias=\target` 解析，同步复制 `mathMacros` 与 `textMacros` 映射。
  2. 识别 `\newcommand{\cmd}[n][default]{body}` 中的可选默认参数，先将 `\ifx#1\right\left.\fi` 归一化为 `\left.` 并替换默认参数，将 2 参宏降维为 KaTeX 可直接执行的 1 参宏；同时在 `preprocessMath` 中剥离调用处的 `\eval[...]` 可选参数。

### 问题 2：AMS 高级数学环境与命令在 KaTeX 中缺失或名称不兼容
- **现象**：`multline`/`multline*`、`flalign`、`eqnarray` 报 `No such environment`；`\iiiint`、`\idotsint`、`\Hat`/`\Check`/`\Tilde`、`\hdotsfor`、`\sideset`、`\leftroot`/`\uproot`、`\theequation`、`\alt`/`\agt`/`\openone`、`\text{...\ref{...}}` 报 `Undefined control sequence`。
- **根因**：KaTeX 覆盖了绝大多数标准 LaTeX 数学语法，但对部分 AMS / REVTeX 扩展环境与排版微调命令未内建实现。
- **修复方案**（`latex.js` → `builtinMathMacros` / `preprocessMath` / `parseBlocks`）：
  - **环境映射**：`multline*` → `gathered`；`flalign*` / `eqnarray*` → `align*`（同时将 `eqnarray` 三列 `& = &` 规整为 `align` 的 `&= `）；支持 `math` 环境。
  - **内置兼容宏表**：补充 `\iiiint`、`\idotsint`、`\Hat`–`\Vec`、`\theequation`、`\alt`、`\agt`、`\openone` 等常用宏映射。
  - **数学预处理**：在送入 KaTeX 前剥离 `\label{...}`、`\nonumber`、`\leftroot`/`\uproot`、`\shoveleft`/`\shoveright`；将 `\hdotsfor{N}` 展开为 `N` 列 `\dots`；将 `\sideset{L}{R}\op` 近似为 `{}^{L}\op^{R}`；清洗 `\text{}` 内嵌套的 `\ref{...}` 与 `\cn{...}`。
  - **KaTeX 宽松模式**：在 `renderer.js` 中为 `katex.render` 开启 `strict: false`，避免非致命排版警告干扰正常渲染。

### 问题 3：正文拉丁重音转义失效（`M\"obius`）与字母重音误伤普通命令（`\cn` / `\cite`）
- **现象**：第一轮解析中正文直接露出 `M\"obius`；补齐重音表后，如果把符号重音（`\"`、`\'`）和字母重音（`\c`、`\v`）混在同一分支，会按单字符匹配把 `\cn{...}` 的 `\c` 截断，吞掉命令名并留下残缺字符 `nboldsymbol`。
- **根因**：TeX 中 `\"o` 是「反斜杠 + 标点符号」组成的控制符号（Control Symbol），而 `\c{c}` 是「反斜杠 + 完整字母命令名」组成的控制序列（Control Sequence），二者词法边界完全不同。
- **修复方案**（`latex.js` → `symbolAccentTable` / `cmdAccentTable`）：
  - 严格拆分 `symbolAccentTable`（`"`、`'`、`` ` ``、`^`、`~`、`=`）和 `cmdAccentTable`（`c`、`v`）：前者在反斜杠后立即按 1 字符匹配，后者只在完整解析出 `cmdMatch` 且整个命令名恰好等于 `c` 或 `v` 时才触发。

### 问题 4：自定义带参文本宏（`\pkg{amsmath}` / `\cn{boldsymbol}` / `\thmref{...}`）丢失内容或吞掉后续空格
- **现象**：
  1. `\newcommand{\pkg}[1]{{\protect\ntt#1}}` 展开后变成 `\protect\nttamsmath`，`\ntt` 与参数粘连，再用 `\b` 单词边界正则无法匹配，导致整段文本消失。
  2. 读取完宏观参数 `{...}` 后直接执行了 `skipSpaces`，导致 `` `amsmath` Package `` 粘连成 `` `amsmath`Package ``。
- **修复方案**（`latex.js` → `parseInline`）：
  - 判断等宽文本宏时放宽 `\ntt`/`\ttfamily` 的右边界匹配，将展开后的纯文本转为 `inlineCode` 节点。
  - 分离 `argCursor`（用于寻找下一个参数）与 `endCursor`（记录最后一个参数的右花括号位置），展开结束后令 `i = endCursor`，完整保留原始词间空格。

### 问题 5：`\verb` 与行内 `\[...\]` 抢占冲突
- **现象**：`apssamp.tex` 中出现 `\verb+$...$+` 时，原逻辑先检测 `$` 导致把 `\verb+` 误拆进数学公式，触发 KaTeX 报错 `\verb ended by end of line`。
- **根因**：`parseInline` 中 `$` 的分支排在 `\verb` 之前。
- **修复方案**：将 `\verb<delim>...<delim>` 提升到 `parseInline` 最优先匹配位置，并在行内兜底处理偶发出现的 `\[...\]`。

### 问题 6：`stripComments` 误杀 `\\` 后的注释与 `verbatim` 内的 `%`
- **现象**：
  1. 数学矩阵中 `\\ % comment` 因 `%` 前一个是 `\`，简单的 `line[i - 1] !== "\\"` 误判为转义百分号 `\%`，导致注释泄漏进公式。
  2. 如果 `verbatim` 代码示例里包含 `%` 注释，全局按行去注释会破坏原始代码示例。
- **修复方案**（`latex.js` → `stripComments`）：
  - 维护 `inVerbatim` 状态机，跳过 `verbatim` / `lstlisting` / `minted` 环境内部。
  - 遇到 `%` 时向前统计连续反斜杠个数 `bs`：仅当 `bs % 2 === 0` 时才是注释，偶数反斜杠（如 `\\`）后的 `%` 正确剥离，奇数反斜杠（如 `\%`）安全保留。

### 问题 7：文档体内的 TeX 底层宏块、花括号分组与常见学术环境未识别
- **现象**：
  - `\newtheorem{thm}{Theorem}` 自定义缩写环境（`thm`/`lem`/`prop`/`cor`/`defn`/`rem`/`ax`/`notation`）未识别，被降级为代码框。
  - `{\setlength{\multlinegap}{0pt} \begin{multline*}...\end{multline*}}` 或 `{\Large \[...\]}` 外层包了花括号导致无法识别为块级公式。
  - `\makeatletter...\makeatother`、`\iffalse...\fi`、`\markboth` 等 TeX 排版控制语句泄漏到正文。
  - `thebibliography`、`subequations`、`widetext`、`ruledtabular`、`figure*`/`table*`、`verse`、`em`、`acknowledgments` 被降级为代码框。
- **修复方案**：
  - 在导言区动态扫描 `\newtheorem` 注册环境中文/英文标题映射。
  - 块级解析遇到 `{...}` 且内部含 `\begin{` / `\[` / `$$` 时，剥离前置样式指令后递归进入 `parseBlocks`。
  - 跳过 `\makeatletter...\makeatother`、`\iffalse...\fi` 及 `\markboth`/`\setlength`/`\renewcommand` 等控制命令；将 `thebibliography` 渲染为「References」列表，将 `subequations` 等透明包装环境递归解包。

---

## 3. 以后遇到新的 `.tex` 渲染问题怎么快速排查？

在项目根目录运行下面这条单行 Node 回归脚本，可在 1 秒内把任意 `.tex` 文件的全部 KaTeX 报错、意外降级块和正文残留反斜杠一次性扫出来：

```powershell
node --input-type=module -e '
globalThis.document = { compatMode: "CSS1Compat", createElement: () => ({ style: {} }) };
const fs = await import("node:fs");
const { parseLatexToMdast } = await import("./src/MarkdownReader/Assets/Web/latex.js");
const { k: katex } = await import("./src/MarkdownReader/Assets/Web/vendor/vendor.js");
const raw = fs.readFileSync("你的文档路径.tex", "utf8");
const { children, macros } = parseLatexToMdast(raw);
let errs = 0, mathNodes = 0;
function walk(n) {
  if (!n) return;
  if (n.type === "math" || n.type === "inlineMath") {
    mathNodes++;
    try { katex.renderToString(n.value, { displayMode: n.type === "math", throwOnError: true, strict: false, trust: false, macros: { ...macros } }); }
    catch (e) { errs++; console.log("MATH ERR:", e.message, "\n  ", n.value.slice(0, 120)); }
  }
  if (n.type === "text" && /\\/.test(n.value)) console.log("STRAY TEXT:", n.value.slice(0, 100));
  if (n.children) n.children.forEach(walk);
}
children.forEach(walk);
console.log({ topBlocks: children.length, mathNodes, errs });
'
```

**排查顺序建议**：
1. 先看 `MATH ERR`：若是 `Undefined control sequence`，优先查原文导言区是否用了新的宏定义语法（`\def`、`\DeclarePairedDelimiter` 等），或补入 `builtinMathMacros` / `preprocessMath`。
2. 再看 `STRAY TEXT`：正文若露出 `\xxx`，确认是控制符号还是控制序列，补入 `parseInline`。
3. 最后看正文里出现的代码块：先核对原 `.tex` 对应行是否本身就是 `\begin{verbatim}` 示例代码；若不是，再把对应环境名补入 `parseBlocks` 或 `defaultTheoremLabels`。
