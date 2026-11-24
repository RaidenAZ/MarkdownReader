import {
  a as createJavaScriptRegexEngine, b as createHighlighterCore, c as createCssVariablesTheme,
  d as attention, f as fromMarkdown, g as gfm, k as katex, m as math, p as typescript, q as json,
  r as gfmFromMarkdown, s as shellscript, v as mathFromMarkdown
} from "./vendor/vendor.js";

const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const byId = id => document.getElementById(id);
const article = byId("article");
const manuscript = byId("manuscript");
const page = byId("page");
const outlineShell = byId("outline-shell");
const outlineCard = byId("outline-card");
const outlinePill = byId("outline-pill");
const outlineItems = byId("outline-items");
const welcome = byId("welcome");
const query = byId("query");
const widthToast = byId("width-toast");
const panels = { find: byId("find-panel"), typography: byId("typography-panel"), theme: byId("theme-panel") };
const notice = byId("notice");
const matches = new Highlight();
const currentMatch = new Highlight();
CSS.highlights.set("folio-find", matches);
CSS.highlights.set("folio-current", currentMatch);

let activeDocument;
let blocks = [];
let headings = [];
let reading = { theme: "system", font: "sans", fontSize: 17, contentWidth: 820, outlineOpen: true, autoPromoteRecent: false };
let findIndex = -1;
let noticeTimer;
let widthToastTimer;
let scrollFrame;

const bridge = window.chrome.webview;
const send = (action, fields) => bridge.postMessage({ action, ...fields });
const numberFormat = new Intl.NumberFormat("zh-CN");
const dateFormat = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" });
const alertInfo = {
  NOTE: ["备注", "ⓘ"], TIP: ["提示", "✦"], IMPORTANT: ["重要", "◇"], WARNING: ["警告", "⚠"], CAUTION: ["注意", "⊘"]
};

const bracketMath = {
  name: "folioBracketMath",
  tokenize(effects, ok, nok) {
    let closing;
    return start;
    function start(code) {
      effects.enter("folioBracketMath");
      effects.consume(code);
      return open;
    }
    function open(code) {
      if (code !== 40 && code !== 91) return nok(code);
      closing = code === 40 ? 41 : 93;
      effects.consume(code);
      return inside;
    }
    function inside(code) {
      if (code === null || code < -2) return nok(code);
      effects.consume(code);
      return code === 92 ? escape : inside;
    }
    function escape(code) {
      if (code === closing) {
        effects.consume(code);
        effects.exit("folioBracketMath");
        return ok;
      }
      if (code !== 92) return inside(code);
      effects.consume(code);
      return inside;
    }
  }
};
const parseOptions = {
  extensions: [gfm(), math(), { text: { 42: attention, 92: bracketMath, 95: attention } }],
  mdastExtensions: [
    gfmFromMarkdown(), mathFromMarkdown(),
    {
      enter: {
        folioBracketMath(token) {
          const source = this.sliceSerialize(token);
          this.enter({ type: source[1] === "[" ? "bracketMath" : "inlineMath", value: source.slice(2, -2).trim() }, token);
        }
      },
      exit: { folioBracketMath(token) { this.exit(token); } }
    }
  ]
};

const languageModules = new Set(
  "asciidoc bat bibtex c clojure cmake cpp csharp css csv dart diff dotenv elixir erlang fish fsharp go graphql groovy haskell hcl html http ini java javascript julia kotlin latex less log lua make markdown mdx nix perl php powershell proto python r rst ruby rust scala scss sql svelte swift system-verilog toml vb verilog vue xml yaml".split(" ")
);
const aliases = new Map(Object.entries({
  js: "javascript", mjs: "javascript", cjs: "javascript", ts: "typescript", mts: "typescript", cts: "typescript",
  sh: "shellscript", bash: "shellscript", zsh: "shellscript", shell: "shellscript",
  py: "python", rb: "ruby", rs: "rust", cs: "csharp", "c#": "csharp", "c++": "cpp", "f#": "fsharp",
  fs: "fsharp", ps1: "powershell", pwsh: "powershell", md: "markdown", yml: "yaml", tex: "latex",
  adoc: "asciidoc", cmd: "bat", clj: "clojure", erl: "erlang", ex: "elixir", gql: "graphql", hs: "haskell",
  tf: "hcl", kt: "kotlin", jl: "julia", makefile: "make", pl: "perl", protobuf: "proto",
  rest: "rst", sv: "system-verilog", systemverilog: "system-verilog", vbnet: "vb"
}));
const languageLabels = new Map(Object.entries({
  asciidoc: "AsciiDoc", bat: "Batch", bibtex: "BibTeX", c: "C", clojure: "Clojure", cmake: "CMake",
  cpp: "C++", csharp: "C#", css: "CSS", csv: "CSV", dart: "Dart", diff: "Diff", dotenv: "Dotenv",
  elixir: "Elixir", erlang: "Erlang", fish: "Fish", fsharp: "F#", go: "Go", graphql: "GraphQL",
  groovy: "Groovy", haskell: "Haskell", hcl: "HCL", html: "HTML", http: "HTTP", ini: "INI",
  java: "Java", javascript: "JavaScript", json: "JSON", julia: "Julia", kotlin: "Kotlin", latex: "LaTeX",
  less: "Less", log: "Log", lua: "Lua", make: "Makefile", markdown: "Markdown", mdx: "MDX", nix: "Nix",
  perl: "Perl", php: "PHP", powershell: "PowerShell", proto: "Protobuf", python: "Python", r: "R",
  rst: "reST", ruby: "Ruby", rust: "Rust", scala: "Scala", scss: "SCSS", shellscript: "Shell",
  sql: "SQL", svelte: "Svelte", swift: "Swift", "system-verilog": "SystemVerilog", toml: "TOML",
  typescript: "TypeScript", vb: "VB", verilog: "Verilog", vue: "Vue", xml: "XML", yaml: "YAML"
}));
const iconSvg = paths => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "13.5");
  svg.setAttribute("height", "13.5");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.4");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const d of paths) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
};
const embedded = new Map(Object.entries({ typescript, json, shellscript }));
const grammarLoads = new Map();
const highlighter = createHighlighterCore({
  themes: [createCssVariablesTheme()], langs: [], engine: createJavaScriptRegexEngine()
});

function renderCode(block) {
  const frame = element("div", "code-block");
  const toolbar = element("div", "code-toolbar");
  const label = (block.lang || "").toLowerCase();
  const language = aliases.get(label) ?? label;
  const langName = languageLabels.get(language) ?? (block.lang ? block.lang : "Plain");
  const lines = block.value.split("\n");
  const foldable = lines.length > 26;

  const langTag = element("span", "code-lang", langName);
  const copy = element("button", "code-tool");
  copy.type = "button";
  copy.title = "复制代码";
  copy.setAttribute("aria-label", "复制代码");
  const setCopyIcon = copied => {
    copy.classList.toggle("is-copied", copied);
    copy.replaceChildren(iconSvg(copied
      ? ["M3.2 8.5L6.5 11.8L12.8 4.6"]
      : ["M5.8 5.8H12.2A1.3 1.3 0 0 1 13.5 7.1V12.2A1.3 1.3 0 0 1 12.2 13.5H5.8A1.3 1.3 0 0 1 4.5 12.2V7.1A1.3 1.3 0 0 1 5.8 5.8Z",
         "M10.5 4.5V3.6A1.1 1.1 0 0 0 9.4 2.5H3.6A1.1 1.1 0 0 0 2.5 3.6V9.4A1.1 1.1 0 0 0 3.6 10.5H4.5"]));
  };
  setCopyIcon(false);

  const wrapToggle = element("button", "code-tool");
  wrapToggle.type = "button";
  wrapToggle.title = "切换自动换行";
  wrapToggle.setAttribute("aria-label", "切换自动换行");
  wrapToggle.setAttribute("aria-pressed", "false");
  wrapToggle.append(iconSvg(["M2.8 4.2H13.2", "M2.8 8H11A2.1 2.1 0 0 1 11 12.2H7.2", "M9 10.4L7.1 12.2L9 14", "M2.8 12.2H4.8"]));
  wrapToggle.addEventListener("click", () => {
    const wrapped = frame.classList.toggle("is-wrapped");
    wrapToggle.setAttribute("aria-pressed", String(wrapped));
  });

  const pre = element("pre");
  const code = element("code");
  code.textContent = block.value;
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(block.value);
      setCopyIcon(true);
      setTimeout(() => setCopyIcon(false), 1400);
    } catch {
      showNotice("无法访问剪贴板");
    }
  });
  toolbar.append(langTag, element("i", "code-tool-sep"), copy, wrapToggle);
  pre.append(code);
  frame.append(toolbar, pre);

  if (foldable) {
    frame.classList.add("is-collapsed");
    const foldToggle = element("button", "code-tool");
    foldToggle.type = "button";
    const expandBar = element("button", "code-expand");
    expandBar.type = "button";
    const syncFold = collapsed => {
      frame.classList.toggle("is-collapsed", collapsed);
      foldToggle.title = collapsed ? `展开全部（共 ${lines.length} 行）` : "收起长代码";
      foldToggle.setAttribute("aria-label", foldToggle.title);
      foldToggle.setAttribute("aria-pressed", String(!collapsed));
      foldToggle.replaceChildren(iconSvg(collapsed
        ? ["M5 6.2L8 3.2L11 6.2", "M5 9.8L8 12.8L11 9.8"]
        : ["M5 3.8L8 6.8L11 3.8", "M5 12.2L8 9.2L11 12.2"]));
      expandBar.textContent = collapsed ? `展开全部代码（共 ${lines.length} 行）` : "收起代码";
    };
    syncFold(true);
    const toggleFold = () => syncFold(!frame.classList.contains("is-collapsed"));
    foldToggle.addEventListener("click", toggleFold);
    expandBar.addEventListener("click", toggleFold);
    toolbar.append(foldToggle);
    frame.append(expandBar);
  }

  if (language === "diff") {
    frame.classList.add("is-diff");
    code.replaceChildren(...lines.flatMap((line, index) => [...(index ? ["\n"] : []), element("span",
      `code-line ${/^(?:\+\+\+|---|@@|diff |index )/.test(line) ? "diff-context" :
        line.startsWith("+") ? "added" : line.startsWith("-") ? "removed" : ""}`, line)]));
    return frame;
  }
  if (!languageModules.has(language) && !embedded.has(language)) return frame;

  if (!grammarLoads.has(language)) {
    grammarLoads.set(language, (async () => {
      const engine = await highlighter;
      if (!engine.getLoadedLanguages().includes(language)) {
        const grammar = embedded.get(language) ?? (await import(`./vendor/langs/${language}.js`)).default;
        await engine.loadLanguage(grammar);
      }
      return engine;
    })());
  }
  grammarLoads.get(language).then(engine => {
    const { tokens } = engine.codeToTokens(block.value, { lang: language, theme: "css-variables" });
    const fragment = document.createDocumentFragment();
    for (const [index, line] of tokens.entries()) {
      if (index) fragment.append("\n");
      const row = element("span", "code-line");
      for (const token of line) {
        const part = element("span", "", token.content);
        part.style.color = token.color || "";
        if (token.fontStyle > 0) {
          if (token.fontStyle & 1) part.style.fontStyle = "italic";
          if (token.fontStyle & 2) part.style.fontWeight = "bold";
          if (token.fontStyle & 4) part.style.textDecoration = "underline";
        }
        row.append(part);
      }
      fragment.append(row);
    }
    code.replaceChildren(fragment);
    if (panels.find.open) findInPage();
  }).catch(error => { console.warn(`无法高亮 ${language}`, error); });
  return frame;
}

function renderNode(node, definitions) {
  const render = child => renderNode(child, definitions);
  const wrap = (tag, children = node.children) => {
    const target = element(tag);
    target.append(...children.map(render));
    return target;
  };
  switch (node.type) {
    case "text": return document.createTextNode(node.value);
    case "paragraph":
      return node.children.length === 1 && node.children[0].type === "bracketMath" ?
        render({ ...node.children[0], type: "math" }) : wrap("p");
    case "heading": return wrap(`h${node.depth}`);
    case "strong": return wrap("strong");
    case "emphasis": return wrap("em");
    case "delete": return wrap("del");
    case "break": return element("br");
    case "thematicBreak": return element("hr");
    case "inlineCode": return element("code", "", node.value);
    case "code": return renderCode(node);
    case "inlineMath":
    case "bracketMath":
    case "math": {
      const block = node.type === "math";
      const target = element(block ? "div" : "span", block ? "math-display" : "math-inline");
      katex.render(node.value, target, { displayMode: block, throwOnError: false, trust: false });
      return target;
    }
    case "list": {
      const list = wrap(node.ordered ? "ol" : "ul");
      if (node.ordered && node.start !== 1) list.start = node.start;
      return list;
    }
    case "listItem": {
      const item = wrap("li");
      if (node.checked === null || node.checked === undefined) return item;
      item.className = "task-item";
      const checkbox = element("input");
      checkbox.type = "checkbox";
      checkbox.checked = node.checked;
      checkbox.disabled = true;
      item.prepend(checkbox);
      return item;
    }
    case "blockquote": {
      const first = node.children[0];
      const text = first?.type === "paragraph" && first.children[0]?.type === "text" ? first.children[0].value : "";
      const marker = text.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?: *\n| *$)/i);
      if (!marker) return wrap("blockquote");
      const [title, icon] = alertInfo[marker[1].toUpperCase()];
      const alert = element("aside", `alert ${marker[1].toLowerCase()}`);
      const heading = element("div", "alert-title");
      const symbol = element("span", "", icon);
      symbol.setAttribute("aria-hidden", "true");
      heading.append(symbol, title);
      const rest = text.slice(marker[0].length);
      const children = [...(rest ? [{ type: "text", value: rest }] : []), ...first.children.slice(1)];
      alert.append(heading, ...(children.length ? [wrap("p", children)] : []), ...node.children.slice(1).map(render));
      return alert;
    }
    case "table": {
      const wrapper = element("div", "table-scroll");
      const table = element("table");
      const header = table.createTHead();
      const body = table.createTBody();
      for (const [index, row] of node.children.entries()) {
        const target = (index === 0 ? header : body).insertRow();
        for (const [column, cell] of row.children.entries()) {
          const entry = wrap(index === 0 ? "th" : "td", cell.children);
          if (index === 0) entry.scope = "col";
          if (node.align[column]) entry.style.textAlign = node.align[column];
          target.append(entry);
        }
      }
      wrapper.append(table);
      return wrapper;
    }
    case "linkReference":
    case "link": {
      const link = node.type === "linkReference" ? definitions.get(node.identifier) : node;
      const target = wrap("a");
      if (link?.title) target.title = link.title;
      if (link?.url.startsWith("#") || /^(https?:\/\/|mailto:)/i.test(link?.url ?? "")) target.href = link.url;
      return target;
    }
    case "imageReference":
    case "image": {
      const image = node.type === "imageReference" ? definitions.get(node.identifier) : node;
      const target = element("img");
      target.alt = node.alt;
      if (image?.title) target.title = image.title;
      if (image?.url && !/^(?:[a-z][\w+.-]*:|[\\/])/i.test(image.url)) {
        let relative = image.url;
        try { relative = decodeURIComponent(relative); } catch (error) {
          if (!(error instanceof URIError)) throw error;
        }
        target.src = `https://media.folio.local/image?${encodeURIComponent(relative)}`;
      }
      return target;
    }
    case "html": return element("span", "", node.value);
    default: return node.children ? wrap("span") : document.createTextNode(node.value ?? "");
  }
}

function renderDocument(incoming, live) {
  live = live && activeDocument?.path === incoming.path;
  activeDocument = incoming;
  welcome.hidden = true;
  manuscript.hidden = false;

  const nodes = fromMarkdown(incoming.text, parseOptions).children;
  const definitions = new Map();
  function prepareNodes(tree) {
    for (const node of tree) {
      if (node.type === "definition" && !definitions.has(node.identifier)) definitions.set(node.identifier, node);
      if (node.type === "paragraph") {
        const source = incoming.text.slice(node.position.start.offset, node.position.end.offset);
        if (/^\\\[[ \t]*\r?\n/.test(source) && /\r?\n[ \t]*\\\]$/.test(source)) {
          node.type = "math";
          node.value = source.slice(2, -2).trim();
          delete node.children;
        }
      }
      if (node.children) prepareNodes(node.children);
    }
  }
  prepareNodes(nodes);
  const next = nodes.filter(node => node.type !== "definition").map(node => ({
    node,
    signature: JSON.stringify(node, (key, value) => {
      if (key === "position") return undefined;
      if (key === "identifier" && definitions.has(value)) {
        const definition = definitions.get(value);
        return [value, definition.url, definition.title];
      }
      return value;
    })
  }));

  const viewportTop = manuscript.getBoundingClientRect().top;
  const anchorIndex = live && manuscript.scrollTop > 0
    ? blocks.findIndex(block => block.element.getBoundingClientRect().bottom > viewportTop)
    : -1;
  const anchor = blocks[anchorIndex]?.element;
  const anchorOffset = anchor?.getBoundingClientRect().top;

  if (live) {
    let prefix = 0;
    let previousEnd = blocks.length;
    let nextEnd = next.length;
    while (prefix < Math.min(previousEnd, nextEnd) && blocks[prefix].signature === next[prefix].signature) {
      next[prefix].element = blocks[prefix].element;
      prefix++;
    }
    while (previousEnd > prefix && nextEnd > prefix && blocks[previousEnd - 1].signature === next[nextEnd - 1].signature) {
      next[--nextEnd].element = blocks[--previousEnd].element;
    }
    const remaining = new Map();
    for (const block of blocks.slice(prefix, previousEnd)) {
      if (!remaining.has(block.signature)) remaining.set(block.signature, []);
      remaining.get(block.signature).push(block.element);
    }
    for (const block of next.slice(prefix, nextEnd)) block.element = remaining.get(block.signature)?.shift();
  }

  const retained = new Set(next.map(block => block.element));
  for (const block of blocks) if (!retained.has(block.element)) block.element.remove();
  for (const [index, block] of next.entries()) {
    if (!block.element) {
      block.element = renderNode(block.node, definitions);
      if (live) {
        block.element.classList.add("live-change");
        setTimeout(() => block.element.classList.remove("live-change"), 3700);
      }
    }
    if (article.children[index] !== block.element) article.insertBefore(block.element, article.children[index] ?? null);
  }

  const minutes = Math.max(1, Math.ceil(((incoming.text.match(/\p{Script=Han}/gu) ?? []).length / 380) +
    ((incoming.text.match(/[a-z0-9]+/gi) ?? []).length / 230)));
  byId("metadata").textContent = `${dateFormat.format(new Date(incoming.updated))} · 约 ${numberFormat.format(minutes)} 分钟阅读`;
  updateOutline();
  if (!live || anchorIndex < 0) manuscript.scrollTop = 0;
  if (anchor && next.length > 0) {
    const priorAnchor = blocks.slice(0, anchorIndex).reverse().find(block => retained.has(block.element));
    const fallback = priorAnchor
      ? next.findIndex(block => block.element === priorAnchor.element) + anchorIndex - blocks.indexOf(priorAnchor)
      : anchorIndex;
    const restored = anchor.isConnected ? anchor : next[Math.min(fallback, next.length - 1)].element;
    manuscript.scrollTop += restored.getBoundingClientRect().top - anchorOffset;
  }
  blocks = next;
  refreshActiveHeading();
  if (panels.find.open) findInPage();
}

function updateOutline() {
  const ids = new Set();
  headings = [];
  const links = document.createDocumentFragment();
  for (const heading of article.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
    const text = heading.textContent.trim();
    const slug = text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}\p{M}_ -]/gu, "").replace(/ +/g, "-") || "section";
    let id = slug;
    for (let occurrence = 1; ids.has(id); occurrence++) id = `${slug}-${occurrence}`;
    ids.add(id);
    heading.id = id;
    const level = Number(heading.tagName[1]);
    if (level > 4) continue;
    const link = element("a");
    link.append(element("span", "", text || "未命名标题"));
    link.href = `#${encodeURIComponent(id)}`;
    link.title = text;
    link.style.setProperty("--level", level - 1);
    links.append(link);
    headings.push({ heading, link });
  }
  outlineItems.replaceChildren(links);
  outlineShell.hidden = headings.length === 0;
  syncOutlineLayout();
}

function refreshActiveHeading() {
  if (!headings.length) return;
  const top = manuscript.getBoundingClientRect().top + 55;
  let active = headings[0];
  for (const entry of headings) {
    if (entry.heading.getBoundingClientRect().top > top) break;
    active = entry;
  }
  const previous = outlineItems.querySelector("[aria-current]");
  if (previous === active.link) return;
  previous?.removeAttribute("aria-current");
  active.link.setAttribute("aria-current", "location");
  active.link.scrollIntoView({ block: "nearest" });
}

manuscript.addEventListener("scroll", () => {
  if (scrollFrame) return;
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = undefined;
    refreshActiveHeading();
  });
}, { passive: true });

function findInPage(jump = false) {
  matches.clear();
  const search = query.value.trim();
  if (search) {
    const pattern = new RegExp(RegExp.escape(search), "giu");
    for (const block of article.children) {
      const parts = [];
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
        acceptNode: node => node.parentElement.closest(".code-toolbar, .code-expand, .katex-mathml, [aria-hidden]:not(.katex-html, .katex-html *)")
          ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
      });
      while (walker.nextNode()) parts.push(walker.currentNode);
      const text = parts.map(node => node.data).join("");
      let index = 0;
      let offset = 0;
      for (const match of text.matchAll(pattern)) {
        const end = match.index + match[0].length;
        while (offset + parts[index].length <= match.index) offset += parts[index++].length;
        const range = new Range();
        range.setStart(parts[index], match.index - offset);
        while (offset + parts[index].length < end) offset += parts[index++].length;
        range.setEnd(parts[index], end - offset);
        matches.add(range);
      }
    }
  }
  findIndex = jump ? 0 : Math.max(0, Math.min(findIndex, matches.size - 1));
  highlightMatch(jump);
}

function highlightMatch(jump) {
  currentMatch.clear();
  const selected = [...matches][findIndex];
  byId("find-count").textContent = query.value.trim() ? `${selected ? findIndex + 1 : 0} / ${matches.size}` : "";
  byId("find-previous").disabled = byId("find-next").disabled = matches.size === 0;
  if (!selected) return;
  currentMatch.add(selected);
  if (jump) {
    selected.startContainer.parentElement?.closest(".code-block.is-collapsed")?.querySelector(".code-expand")?.click();
    const match = selected.getBoundingClientRect();
    const view = manuscript.getBoundingClientRect();
    if (match.top < view.top + 16 || match.bottom > view.bottom - 16)
      manuscript.scrollTop += match.top - view.top - manuscript.clientHeight * .34;
  }
}

function nextMatch(direction) {
  if (!matches.size) return;
  findIndex = (findIndex + direction + matches.size) % matches.size;
  highlightMatch(true);
}

function applySettings(settings, dark) {
  reading = { contentWidth: 820, outlineOpen: true, autoPromoteRecent: false, ...settings };
  const root = document.documentElement;
  root.dataset.theme = dark ? "dark" : "light";
  root.dataset.font = reading.font;
  const fullWidth = reading.contentWidth === 0;
  root.dataset.fullwidth = String(fullWidth);
  if (!fullWidth) root.style.setProperty("--content-width", `${reading.contentWidth}px`);
  root.style.setProperty("--reading-size", `${reading.fontSize}px`);
  byId("font-size").value = reading.fontSize;
  byId("font-size-value").textContent = reading.fontSize;
  for (const button of document.querySelectorAll("[data-setting]"))
    button.setAttribute("aria-pressed", String(String(reading[button.dataset.setting]) === button.dataset.value));
  for (const button of document.querySelectorAll("[data-width]")) {
    const preset = Number(button.dataset.width);
    const active = preset === 0
      ? reading.contentWidth === 0
      : reading.contentWidth > 0 && Math.abs(reading.contentWidth - preset) <= 40;
    button.setAttribute("aria-pressed", String(active));
  }
  byId("promote-recent-switch")?.setAttribute("aria-checked", String(Boolean(reading.autoPromoteRecent)));
  syncOutlineLayout();
}

function syncOutlineLayout() {
  const hasOutline = activeDocument && headings.length > 0;
  outlineShell.hidden = !hasOutline;
  if (!hasOutline) {
    manuscript.style.setProperty("--outline-clearance", "0px");
    return;
  }
  const open = Boolean(reading.outlineOpen);
  outlineCard.hidden = !open;
  outlinePill.hidden = open;
  manuscript.style.setProperty("--outline-clearance", open && window.innerWidth > 960 ? "256px" : "0px");
}

function showWidthToast(label) {
  clearTimeout(widthToastTimer);
  widthToast.textContent = label;
  widthToast.hidden = false;
  widthToastTimer = setTimeout(() => { widthToast.hidden = true; }, 1100);
}

function showPanel(name) {
  if (name === "find" && !activeDocument) return;
  const panel = panels[name];
  for (const other of Object.values(panels)) if (other !== panel) other.close();
  if (!panel.open) panel.show();
  if (panel === panels.find) {
    query.focus();
    query.select();
    findInPage();
  }
}

function showNotice(message) {
  clearTimeout(noticeTimer);
  notice.textContent = message;
  notice.hidden = false;
  noticeTimer = setTimeout(() => { notice.hidden = true; }, 5000);
}

function setOutlineOpen(open) {
  reading = { ...reading, outlineOpen: open };
  syncOutlineLayout();
  send("settings", { reading });
}

document.addEventListener("click", event => {
  const button = event.target.closest("button");
  if (button?.dataset.action) send(button.dataset.action, { path: button.dataset.path });
  if (button?.hasAttribute("data-close")) button.closest("dialog").close();
  if (button?.dataset.setting) {
    const { setting, value } = button.dataset;
    reading = { ...reading, [setting]: value };
    send("settings", { reading });
  }
  if (button?.dataset.width !== undefined) {
    const contentWidth = Number(button.dataset.width);
    reading = { ...reading, contentWidth };
    applySettings(reading, document.documentElement.dataset.theme === "dark");
    send("settings", { reading });
  }
  const anchor = event.target.closest("a");
  if (!anchor) return;
  const target = anchor.getAttribute("href");
  if (!target) return;
  event.preventDefault();
  if (target.startsWith("#")) {
    const heading = [...article.querySelectorAll("h1, h2, h3, h4, h5, h6")].find(node =>
      node.id === target.slice(1) || encodeURIComponent(node.id) === target.slice(1));
    heading?.scrollIntoView({ block: "start" });
    if (window.innerWidth <= 920) setOutlineOpen(false);
    return;
  }
  send("externalLink", { url: anchor.href });
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape") for (const panel of Object.values(panels)) panel.close();
  if (!event.ctrlKey || event.altKey || event.metaKey) return;
  const key = event.key.toLowerCase();
  if (key === "f") showPanel("find");
  else if (key === "o") send("openFile");
  else if (key === "home") send("home");
  else if (key === "b") send("toggleSidebar");
  else return;
  event.preventDefault();
});

byId("font-size").addEventListener("input", event => {
  reading = { ...reading, fontSize: event.target.valueAsNumber };
  applySettings(reading, document.documentElement.dataset.theme === "dark");
});
byId("font-size").addEventListener("change", () => send("settings", { reading }));
byId("outline-collapse").addEventListener("click", () => setOutlineOpen(false));
outlinePill.addEventListener("click", () => setOutlineOpen(true));
byId("promote-recent-switch").addEventListener("click", () => {
  reading = { ...reading, autoPromoteRecent: !reading.autoPromoteRecent };
  applySettings(reading, document.documentElement.dataset.theme === "dark");
  send("settings", { reading });
});
window.addEventListener("resize", syncOutlineLayout);

for (const rail of document.querySelectorAll(".resize-rail")) {
  const direction = Number(rail.dataset.resize);
  rail.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    event.preventDefault();
    rail.setPointerCapture(event.pointerId);
    document.body.classList.add("is-resizing");
    const startX = event.clientX;
    const startWidth = page.getBoundingClientRect().width;
    const maxAvailable = Math.max(620, manuscript.clientWidth - 16);
    const onMove = moveEvent => {
      const nextWidth = Math.round(Math.min(maxAvailable, Math.max(620, startWidth + (moveEvent.clientX - startX) * direction * 2)));
      reading = { ...reading, contentWidth: nextWidth };
      applySettings(reading, document.documentElement.dataset.theme === "dark");
      showWidthToast(`阅读视幅 ${nextWidth}px`);
    };
    const onEnd = () => {
      document.body.classList.remove("is-resizing");
      rail.removeEventListener("pointermove", onMove);
      rail.removeEventListener("pointerup", onEnd);
      rail.removeEventListener("pointercancel", onEnd);
      send("settings", { reading });
    };
    rail.addEventListener("pointermove", onMove);
    rail.addEventListener("pointerup", onEnd);
    rail.addEventListener("pointercancel", onEnd);
  });
  rail.addEventListener("dblclick", () => {
    reading = { ...reading, contentWidth: 820 };
    applySettings(reading, document.documentElement.dataset.theme === "dark");
    showWidthToast("已恢复默认视幅 820px");
    send("settings", { reading });
  });
}

query.addEventListener("input", () => findInPage(true));
query.addEventListener("keydown", event => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  nextMatch(event.shiftKey ? -1 : 1);
});
byId("find-previous").addEventListener("click", () => nextMatch(-1));
byId("find-next").addEventListener("click", () => nextMatch(1));
panels.find.addEventListener("close", () => {
  matches.clear();
  currentMatch.clear();
});

bridge.addEventListener("message", event => {
  const message = event.data;
  switch (message.type) {
    case "settings": applySettings(message.reading, message.dark); break;
    case "panel": showPanel(message.panel); break;
    case "error": showNotice(message.message); break;
    case "document": renderDocument(message.document, message.live); break;
    case "home":
      activeDocument = undefined;
      blocks = [];
      headings = [];
      article.replaceChildren();
      manuscript.hidden = true;
      outlineShell.hidden = true;
      manuscript.style.setProperty("--outline-clearance", "0px");
      welcome.hidden = false;
      panels.find.close();
      break;
    case "recent":
      byId("recent-section").hidden = message.recent.length === 0;
      byId("recent-list").replaceChildren(...message.recent.map(recent => {
        const item = element("li", "recent-item");
        const button = element("button", "recent-link");
        button.dataset.action = "openRecent";
        button.dataset.path = recent.path;
        button.title = recent.path;
        const folder = recent.path.replace(/[\\/][^\\/]+$/, "");
        button.append(element("span", "", recent.displayName || recent.name), element("small", "", folder));
        const remove = element("button", "recent-remove", "×");
        remove.type = "button";
        remove.dataset.action = "removeRecent";
        remove.dataset.path = recent.path;
        remove.title = "移除此条记录";
        remove.setAttribute("aria-label", "移除此条记录");
        item.append(button, remove);
        return item;
      }));
      break;
  }
});
send("ready");
