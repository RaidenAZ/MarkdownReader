const mathEnvs = new Set([
  "equation", "equation*", "align", "align*", "gather", "gather*",
  "multline", "multline*", "flalign", "flalign*", "alignat", "alignat*", "displaymath"
]);
const theoremLabels = {
  theorem: "定理", lemma: "引理", proposition: "命题", corollary: "推论",
  definition: "定义", remark: "注", example: "例", axiom: "公理",
  conjecture: "猜想", proof: "证明", abstract: "摘要"
};
const sectionDepth = {
  part: 1, chapter: 1, section: 2, subsection: 3, subsubsection: 4, paragraph: 5, subparagraph: 6
};

function stripComments(source) {
  return source.replace(/\r\n?/g, "\n").split("\n").map(line => {
    for (let i = 0; i < line.length; i++) {
      if (line[i] === "%" && (i === 0 || line[i - 1] !== "\\")) return line.slice(0, i);
    }
    return line;
  }).join("\n");
}

function readGroup(text, start, open = "{", close = "}") {
  if (text[start] !== open) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "\\" && i + 1 < text.length) { i++; continue; }
    if (text[i] === open) depth++;
    else if (text[i] === close && --depth === 0) return { content: text.slice(start + 1, i), end: i + 1 };
  }
  return null;
}

function skipSpaces(text, index) {
  while (index < text.length && /\s/.test(text[index])) index++;
  return index;
}

function extractMacros(preamble) {
  const textMacros = {};
  const mathMacros = {};
  const pattern = /\\(?:re)?newcommand\*?\s*\{?(\\[a-zA-Z]+)\}?\s*(?:\[(\d+)\])?\s*\{/g;
  let match;
  while ((match = pattern.exec(preamble)) !== null) {
    const args = Number(match[2] || 0);
    const body = readGroup(preamble, match.index + match[0].length - 1);
    if (!body) continue;
    mathMacros[match[1]] = body.content;
    if (args === 0) textMacros[match[1]] = body.content;
  }
  const opPattern = /\\DeclareMathOperator(\*?)\s*\{?(\\[a-zA-Z]+)\}?\s*\{/g;
  while ((match = opPattern.exec(preamble)) !== null) {
    const body = readGroup(preamble, match.index + match[0].length - 1);
    if (body) mathMacros[match[2]] = `\\operatorname${match[1]}{${body.content}}`;
  }
  return { textMacros, mathMacros };
}

function extractMeta(source) {
  const readCommand = name => {
    const match = new RegExp(`\\\\${name}\\s*\\{`).exec(source);
    if (!match) return "";
    return readGroup(source, match.index + match[0].length - 1)?.content.trim() ?? "";
  };
  return {
    title: readCommand("title"),
    author: readCommand("author").replace(/\\and\b/g, " · ").replace(/\\\\/g, " · "),
    date: readCommand("date").replace(/\\today\b/g, "")
  };
}

function findMatchingEnd(text, envName, fromIndex) {
  const token = new RegExp(`\\\\(begin|end)\\s*\\{${envName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\}`, "g");
  token.lastIndex = fromIndex;
  let depth = 1;
  let match;
  while ((match = token.exec(text)) !== null) {
    depth += match[1] === "begin" ? 1 : -1;
    if (depth === 0) return { bodyEnd: match.index, end: token.lastIndex };
  }
  return null;
}

function textNode(value) { return { type: "text", value }; }

function parseInline(input, macros) {
  const nodes = [];
  let buffer = "";
  const flush = () => {
    if (!buffer) return;
    nodes.push(textNode(buffer.replace(/~/g, "\u00a0").replace(/``/g, "“").replace(/''/g, "”").replace(/---/g, "—").replace(/--/g, "–")));
    buffer = "";
  };
  const push = node => { flush(); nodes.push(node); };

  let i = 0;
  while (i < input.length) {
    if (input[i] === "$" && input[i + 1] !== "$") {
      let end = i + 1;
      while (end < input.length && !(input[end] === "$" && input[end - 1] !== "\\")) end++;
      if (end < input.length) {
        push({ type: "inlineMath", value: input.slice(i + 1, end).trim() });
        i = end + 1;
        continue;
      }
    }
    if (input.startsWith("\\(", i)) {
      const end = input.indexOf("\\)", i + 2);
      if (end !== -1) {
        push({ type: "inlineMath", value: input.slice(i + 2, end).trim() });
        i = end + 2;
        continue;
      }
    }
    if (input[i] === "\\") {
      if (input[i + 1] === "\\") {
        push({ type: "break" });
        i += 2;
        continue;
      }
      if (input[i + 1] === " " || input[i + 1] === "," || input[i + 1] === ";" || input[i + 1] === ":") {
        buffer += " ";
        i += 2;
        continue;
      }
      if (/[%$#&_{}]/.test(input[i + 1] || "")) {
        buffer += input[i + 1];
        i += 2;
        continue;
      }
      const cmdMatch = /^\\([a-zA-Z]+)\*?/.exec(input.slice(i));
      if (cmdMatch) {
        const cmd = cmdMatch[1];
        let cursor = skipSpaces(input, i + cmdMatch[0].length);
        if (cmd === "verb" && i + 5 < input.length) {
          const delim = input[i + 5];
          const end = input.indexOf(delim, i + 6);
          if (end !== -1) {
            push({ type: "inlineCode", value: input.slice(i + 6, end) });
            i = end + 1;
            continue;
          }
        }
        if (cmd === "textbf" || cmd === "bf") {
          const grp = readGroup(input, cursor);
          if (grp) { push({ type: "strong", children: parseInline(grp.content, macros) }); i = grp.end; continue; }
        }
        if (cmd === "textit" || cmd === "emph" || cmd === "it") {
          const grp = readGroup(input, cursor);
          if (grp) { push({ type: "emphasis", children: parseInline(grp.content, macros) }); i = grp.end; continue; }
        }
        if (cmd === "texttt" || cmd === "code") {
          const grp = readGroup(input, cursor);
          if (grp) { push({ type: "inlineCode", value: grp.content }); i = grp.end; continue; }
        }
        if (cmd === "sout" || cmd === "st") {
          const grp = readGroup(input, cursor);
          if (grp) { push({ type: "delete", children: parseInline(grp.content, macros) }); i = grp.end; continue; }
        }
        if (cmd === "url") {
          const grp = readGroup(input, cursor);
          if (grp) { push({ type: "link", url: grp.content.trim(), children: [textNode(grp.content.trim())] }); i = grp.end; continue; }
        }
        if (cmd === "href") {
          const urlGrp = readGroup(input, cursor);
          const textGrp = urlGrp ? readGroup(input, skipSpaces(input, urlGrp.end)) : null;
          if (urlGrp && textGrp) {
            push({ type: "link", url: urlGrp.content.trim(), children: parseInline(textGrp.content, macros) });
            i = textGrp.end;
            continue;
          }
        }
        if (cmd === "includegraphics") {
          const opt = readGroup(input, cursor, "[", "]");
          if (opt) cursor = skipSpaces(input, opt.end);
          const grp = readGroup(input, cursor);
          if (grp) {
            push({ type: "image", url: grp.content.trim(), alt: grp.content.trim() });
            i = grp.end;
            continue;
          }
        }
        if (cmd === "cite" || cmd === "citep" || cmd === "citet") {
          const opt = readGroup(input, cursor, "[", "]");
          if (opt) cursor = skipSpaces(input, opt.end);
          const grp = readGroup(input, cursor);
          if (grp) {
            push({ type: "inlineCode", value: `[${grp.content.trim()}]` });
            i = grp.end;
            continue;
          }
        }
        if (cmd === "ref" || cmd === "eqref" || cmd === "autoref") {
          const grp = readGroup(input, cursor);
          if (grp) {
            const refText = cmd === "eqref" ? `(${grp.content.trim()})` : grp.content.trim();
            push({ type: "inlineCode", value: refText });
            i = grp.end;
            continue;
          }
        }
        if (cmd === "footnote") {
          const grp = readGroup(input, cursor);
          if (grp) {
            push({ type: "emphasis", children: [textNode("（注："), ...parseInline(grp.content, macros), textNode("）")] });
            i = grp.end;
            continue;
          }
        }
        if (cmd === "label" || cmd === "index" || cmd === "hspace" || cmd === "vspace" || cmd === "centering" || cmd === "noindent") {
          const grp = readGroup(input, cursor);
          i = grp ? grp.end : i + cmdMatch[0].length;
          continue;
        }
        if (macros[`\\${cmd}`]) {
          const expanded = macros[`\\${cmd}`];
          push(...parseInline(expanded, macros));
          i += cmdMatch[0].length;
          continue;
        }
        const grp = readGroup(input, cursor);
        if (grp && ["textrm", "textsf", "textsc", "underline", "textcolor", "text"].includes(cmd)) {
          const contentGrp = cmd === "textcolor" ? readGroup(input, skipSpaces(input, grp.end)) : grp;
          if (contentGrp) {
            push(...parseInline(contentGrp.content, macros));
            i = contentGrp.end;
            continue;
          }
        }
        i += cmdMatch[0].length;
        continue;
      }
    }
    if (input[i] === "{" || input[i] === "}") { i++; continue; }
    buffer += input[i++];
  }
  flush();
  return nodes.length ? nodes : [textNode("")];
}

function parseList(body, ordered, macros) {
  const parts = body.split(/\\item\b/).slice(1);
  return {
    type: "list",
    ordered,
    start: 1,
    children: parts.map(raw => {
      let text = raw.trim();
      const opt = readGroup(text, 0, "[", "]");
      if (opt) text = `\\textbf{${opt.content}} ${text.slice(opt.end).trim()}`;
      return {
        type: "listItem",
        children: [{ type: "paragraph", children: parseInline(text.replace(/\s+/g, " "), macros) }]
      };
    })
  };
}

function parseTabular(body, macros) {
  const cleaned = body.replace(/\\(?:hline|toprule|midrule|bottomrule|cline\{[^}]*\})/g, "").trim();
  const rows = cleaned.split(/\\\\/).map(row => row.trim()).filter(Boolean);
  if (!rows.length) return { type: "code", lang: "latex", value: body.trim() };
  return {
    type: "table",
    align: [],
    children: rows.map(row => ({
      type: "tableRow",
      children: row.split(/(?<!\\)&/).map(cell => ({
        type: "tableCell",
        children: parseInline(cell.trim(), macros)
      }))
    }))
  };
}

function parseBlocks(body, macros) {
  const blocks = [];
  let paragraph = [];
  const flushParagraph = () => {
    const text = paragraph.join(" ").trim();
    paragraph = [];
    if (!text) return;
    blocks.push({ type: "paragraph", children: parseInline(text, macros) });
  };

  let i = 0;
  while (i < body.length) {
    while (i < body.length && (body[i] === " " || body[i] === "\t")) i++;
    if (i >= body.length) break;
    if (body[i] === "\n") {
      flushParagraph();
      i++;
      continue;
    }

    if (body.startsWith("$$", i)) {
      const end = body.indexOf("$$", i + 2);
      if (end !== -1) {
        flushParagraph();
        blocks.push({ type: "math", value: body.slice(i + 2, end).trim() });
        i = end + 2;
        continue;
      }
    }
    if (body.startsWith("\\[", i)) {
      const end = body.indexOf("\\]", i + 2);
      if (end !== -1) {
        flushParagraph();
        blocks.push({ type: "math", value: body.slice(i + 2, end).trim() });
        i = end + 2;
        continue;
      }
    }

    const secMatch = /^\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\s*/.exec(body.slice(i));
    if (secMatch) {
      let cursor = i + secMatch[0].length;
      const opt = readGroup(body, cursor, "[", "]");
      if (opt) cursor = skipSpaces(body, opt.end);
      const grp = readGroup(body, cursor);
      if (grp) {
        flushParagraph();
        blocks.push({ type: "heading", depth: sectionDepth[secMatch[1]], children: parseInline(grp.content.trim(), macros) });
        i = grp.end;
        continue;
      }
    }

    if (/^\\(?:maketitle|tableofcontents|newpage|clearpage|pagebreak|par)\b/.test(body.slice(i))) {
      flushParagraph();
      const m = /^\\[a-zA-Z]+/.exec(body.slice(i));
      if (m[0] === "\\newpage" || m[0] === "\\clearpage") blocks.push({ type: "thematicBreak" });
      i += m[0].length;
      continue;
    }

    const beginMatch = /^\\begin\s*\{([^}]+)\}/.exec(body.slice(i));
    if (beginMatch) {
      const env = beginMatch[1].trim();
      const afterBegin = i + beginMatch[0].length;
      const endInfo = findMatchingEnd(body, env, afterBegin);
      if (endInfo) {
        flushParagraph();
        let envBody = body.slice(afterBegin, endInfo.bodyEnd);
        const opt = readGroup(envBody, skipSpaces(envBody, 0), "[", "]");
        const optTitle = opt ? opt.content.trim() : "";
        if (opt && !mathEnvs.has(env) && env !== "tabular") envBody = envBody.slice(opt.end);

        if (mathEnvs.has(env)) {
          const bare = env.replace(/\*$/, "");
          const cleanedMath = envBody.replace(/\\label\s*\{[^}]*\}/g, "").trim();
          const wrapped = bare === "equation" || bare === "displaymath"
            ? cleanedMath
            : `\\begin{${bare}*} ${cleanedMath} \\end{${bare}*}`;
          blocks.push({ type: "math", value: wrapped });
        } else if (env === "itemize" || env === "enumerate" || env === "description") {
          blocks.push(parseList(envBody, env === "enumerate", macros));
        } else if (env === "verbatim" || env === "lstlisting" || env === "minted") {
          let codeLang = "latex";
          if (env === "minted") {
            const langGrp = readGroup(envBody, skipSpaces(envBody, 0));
            if (langGrp) {
              codeLang = langGrp.content.trim().toLowerCase();
              envBody = envBody.slice(langGrp.end);
            }
          } else {
            const langMatch = /language\s*=\s*([a-zA-Z0-9#+-]+)/i.exec(optTitle);
            if (langMatch) codeLang = langMatch[1].toLowerCase();
          }
          blocks.push({ type: "code", lang: codeLang, value: envBody.replace(/^\n|\n$/g, "") });
        } else if (env === "quote" || env === "quotation") {
          blocks.push({ type: "blockquote", children: parseBlocks(envBody.trim(), macros) });
        } else if (env === "tabular") {
          const colSpec = readGroup(envBody, skipSpaces(envBody, 0));
          blocks.push(parseTabular(colSpec ? envBody.slice(colSpec.end) : envBody, macros));
        } else if (env === "figure" || env === "table" || env === "center") {
          const captionMatch = /\\caption\s*\{/.exec(envBody);
          let caption = "";
          if (captionMatch) {
            const capGrp = readGroup(envBody, captionMatch.index + captionMatch[0].length - 1);
            if (capGrp) {
              caption = capGrp.content.trim();
              envBody = envBody.slice(0, captionMatch.index) + envBody.slice(capGrp.end);
            }
          }
          blocks.push(...parseBlocks(envBody.trim(), macros));
          if (caption) blocks.push({ type: "blockquote", children: [{ type: "paragraph", children: parseInline(`\\textbf{图/表注：} ${caption}`, macros) }] });
        } else if (theoremLabels[env.toLowerCase()]) {
          const label = theoremLabels[env.toLowerCase()];
          const heading = optTitle ? `${label}（${optTitle}）` : label;
          const inner = parseBlocks(envBody.trim(), macros);
          blocks.push({
            type: "blockquote",
            children: [{ type: "paragraph", children: [{ type: "strong", children: [textNode(heading)] }] }, ...inner]
          });
        } else {
          blocks.push({ type: "code", lang: "latex", value: body.slice(i, endInfo.end).trim() });
        }
        i = endInfo.end;
        continue;
      }
    }

    const nextLine = body.indexOf("\n", i);
    const end = nextLine === -1 ? body.length : nextLine;
    const line = body.slice(i, end).trim();
    if (line) paragraph.push(line);
    i = nextLine === -1 ? body.length : nextLine + 1;
  }
  flushParagraph();
  return blocks;
}

export function parseLatexToMdast(rawText) {
  const cleaned = stripComments(rawText);
  const docStart = /\\begin\s*\{document\}/.exec(cleaned);
  const docEnd = /\\end\s*\{document\}/.exec(cleaned);
  const preamble = docStart ? cleaned.slice(0, docStart.index) : "";
  const body = docStart
    ? cleaned.slice(docStart.index + docStart[0].length, docEnd ? docEnd.index : cleaned.length)
    : cleaned;

  const { textMacros, mathMacros } = extractMacros(preamble);
  const meta = extractMeta(cleaned);
  const nodes = [];
  if (meta.title) nodes.push({ type: "heading", depth: 1, children: parseInline(meta.title, textMacros) });
  const subtitle = [meta.author, meta.date].filter(Boolean).join(" · ");
  if (subtitle) nodes.push({ type: "blockquote", children: [{ type: "paragraph", children: parseInline(subtitle, textMacros) }] });
  nodes.push(...parseBlocks(body.trim(), textMacros));
  return { children: nodes, macros: mathMacros };
}
