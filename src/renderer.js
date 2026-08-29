import { wordWrap } from "./utils.js";

function escapeBlessed(str) {
  return String(str).replace(/\{/g, "\\{").replace(/\}/g, "\\}");
}

function visibleLen(s) {
  return s.replace(/\{[^}]+\}/g, "").replace(/\\\{/g, "{").replace(/\\\}/g, "}").length;
}

function styleOpen(p) {
  let s = "";
  if (p.bold) s += "{bold}";
  if (p.italic) s += "{italic}";
  if (p.underline) s += "{underline}";
  if (p.code) s += "{gray-fg}";
  if (p.color) s += `{${p.color}-fg}`;
  return s;
}
function styleClose(p) {
  let s = "";
  if (p.color) s += `{/${p.color}-fg}`;
  if (p.code) s += "{/gray-fg}";
  if (p.underline) s += "{/underline}";
  if (p.italic) s += "{/italic}";
  if (p.bold) s += "{/bold}";
  return s;
}

function linkTags(isFocused, p) {
  let open = "";
  let close = "";
  if (isFocused) {
    // Visible cursor: inverse + yellow bg + black fg + bold prefix will be handled at line level
    open = "{inverse}{yellow-fg}";
    // Keep link color inside? Inverse overrides
    if (p && p.color) open += `{${p.color}-fg}`;
    close = (p && p.color ? `{/${p.color}-fg}` : "") + "{/yellow-fg}{/inverse}";
  } else {
    open = "{underline}{blue-fg}";
    if (p && p.color) open += `{${p.color}-fg}`;
    close = (p && p.color ? `{/${p.color}-fg}` : "") + "{/blue-fg}{/underline}";
  }
  return { open, close };
}

// Wraps inline parts (array of {type, text, href?, id?, color?, bold?, italic?}) into blessed-tagged lines.
// Returns { lines: string[], links: [{id, href, text, line}] } where line is 0-based offset within this block (caller adds base).
function wrapInline(inline, width, cursorId) {
  // cursorId here is already resolved to global target id (or -1 for none). Just match id equality.
  const targetId = cursorId;

  // Tokenize into words preserving style. Link text may have spaces -> split
  const tokens = [];
  for (const p of inline) {
    if (p.text === "\n") {
      tokens.push({ text: "\n", isNewline: true, src: p });
      continue;
    }
    // split p.text by spaces, keep words
    const words = p.text.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    for (const w of words) {
      tokens.push({ text: w, src: p });
    }
  }

  const lines = [];
  let cur = "";
  let curLen = 0;
  const linkLineMap = new Map(); // id -> first line index

  function flush() {
    if (cur !== "" || lines.length === 0) {
      lines.push(cur);
    }
    cur = "";
    curLen = 0;
  }

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.isNewline) {
      flush();
      continue;
    }
    const p = tok.src;
    const isLink = p.type === "link";
    const isFocused = isLink && p.id === targetId;
    let taggedWord;
    if (isLink) {
      const { open, close } = linkTags(isFocused, p);
      // For focused, prepend cursor glyph visual — but only first word of that link gets glyph to avoid repetition
      // We'll add glyph at line start handling instead of here? Keep simple: just highlight.
      taggedWord = `${open}${escapeBlessed(tok.text)}${close}`;
    } else {
      const open = styleOpen(p);
      const close = styleClose(p);
      taggedWord = `${open}${escapeBlessed(tok.text)}${close}`;
    }

    const vlen = tok.text.length;
    const sepLen = curLen > 0 ? 1 : 0;
    if (curLen + sepLen + vlen > width) {
      // line full, flush
      if (cur) lines.push(cur);
      cur = taggedWord;
      curLen = vlen;
      // If link, record its first line if not yet
      if (isLink && !linkLineMap.has(p.id)) linkLineMap.set(p.id, lines.length); // next line index
    } else {
      cur = cur ? cur + " " + taggedWord : taggedWord;
      curLen += sepLen + vlen;
      if (isLink && !linkLineMap.has(p.id)) linkLineMap.set(p.id, lines.length);
    }

    // Special: after placing focused link's first word, we could add cursor glyph at line start later
  }
  if (cur) lines.push(cur);
  if (lines.length === 0) lines.push("");

  // Post-process: for focused link, prepend cursor glyph on its line for visibility
  // Find which line contains focused link
  if (targetId !== -999) {
    const idx = linkLineMap.get(targetId);
    if (idx !== undefined && idx < lines.length) {
      // Prepend "▸ " with inverse to make literally visible like w3m cursor. Keep inside line so scrolling tracks.
      // We prepend outside tags so glyph always visible even if line wrapped
      lines[idx] = `{inverse}{yellow-fg} ▸ {/yellow-fg}{/inverse} ` + lines[idx];
      // Adjust other lines to have indent for alignment
      // Not needed; just glyph on focused line is sufficient and stands out.
    }
  }

  const links = [];
  for (const [id, lineOffset] of linkLineMap) {
    const src = inline.find((p) => p.type === "link" && p.id === id);
    if (src) links.push({ id, href: src.href, text: src.text, lineOffset });
  }
  return { lines, links };
}

export function renderContent(nodes, { width = 80, cursorId = -1, useCursorIndex = false } = {}) {
  const effectiveWidth = Math.max(30, width - 2);
  let lines = [];
  let links = [];
  let lineIndex = 0;
  // Precompute global link order for cursor position mapping
  const globalOrderedIds = [];
  const seenGlobal = new Set();
  for (const n of nodes) {
    const inlines = [];
    if (n.inline) inlines.push(...n.inline);
    // tables are not links, etc.
    for (const p of inlines) if (p.type === "link" && !seenGlobal.has(p.id)) { seenGlobal.add(p.id); globalOrderedIds.push(p.id); }
  }
  let globalTargetId = cursorId;
  // If useCursorIndex or cursorId as position (0..n-1) but not matching any id, map to globalOrderedIds
  if (typeof cursorId === "number" && cursorId >= 0) {
    if (!seenGlobal.has(cursorId) && cursorId < globalOrderedIds.length) {
      globalTargetId = globalOrderedIds[cursorId];
    } else if (seenGlobal.has(cursorId) && useCursorIndex) {
      // caller explicitly wants position semantics: map position -> id
      if (cursorId < globalOrderedIds.length) globalTargetId = globalOrderedIds[cursorId];
    }
  }

  function pushLines(strs) {
    for (const s of strs) {
      lines.push(s);
      lineIndex++;
    }
  }

  function pushEmpty() {
    lines.push("");
    lineIndex++;
  }

  for (const node of nodes) {
    switch (node.type) {
      case "heading": {
        const level = node.level || 1;
        const prefix = level === 1 ? "█ " : level === 2 ? "▓ " : level === 3 ? "▒ " : "░ ";
        const color = node.color ? `{${node.color}-fg}` : "{bold}{white-fg}";
        const close = node.color ? `{/${node.color}-fg}` : "{/white-fg}{/bold}";
        const decor = level === 1 ? "{underline}" : "";
        const decorClose = level === 1 ? "{/underline}" : "";
        const raw = prefix + node.text.toUpperCase();
        const wrapped = wordWrap(raw, effectiveWidth).split("\n");
        for (const w of wrapped) {
          pushLines([`${decor}${color}${escapeBlessed(w)}${close}${decorClose}`]);
        }
        pushEmpty();
        break;
      }
      case "paragraph": {
        if (node.inline && node.inline.length) {
          const base = lineIndex;
          const { lines: wLines, links: lns } = wrapInline(node.inline, effectiveWidth, globalTargetId);
          for (const l of wLines) {
            lines.push(l);
            lineIndex++;
          }
          for (const l of lns) {
            links.push({ id: l.id, href: l.href, text: l.text, line: base + l.lineOffset });
          }
          pushEmpty();
        } else {
          const colOpen = node.color ? `{${node.color}-fg}` : "";
          const colClose = node.color ? `{/${node.color}-fg}` : "";
          const suffix = node.code ? " {gray-fg}(code){/gray-fg}" : "";
          const wrapped = wordWrap(node.text, effectiveWidth).split("\n");
          for (const w of wrapped) {
            pushLines([`${colOpen}${escapeBlessed(w)}${colClose}`]);
          }
          if (suffix) {
            // append code marker?
          }
          pushEmpty();
        }
        break;
      }
      case "pre": {
        // Preformatted: preserve line breaks but still wrap if too long
        const text = node.text || (node.inline ? node.inline.map((p) => p.text).join(" ") : "");
        const rawLines = text.split("\n");
        for (const rl of rawLines) {
          const wrapped = wordWrap(rl || " ", effectiveWidth).split("\n");
          for (const w of wrapped) {
            pushLines([`{gray-fg}${escapeBlessed(w)}{/gray-fg}`]);
          }
        }
        pushEmpty();
        break;
      }
      case "blockquote": {
        const inline = node.inline || [{ type: "text", text: node.text }];
        const base = lineIndex;
        const { lines: wLines, links: lns } = wrapInline(inline, effectiveWidth - 4, globalTargetId);
        for (const l of wLines) {
          lines.push(`{gray-fg}│ {/gray-fg}${l}`);
          lineIndex++;
        }
        for (const l of lns) links.push({ id: l.id, href: l.href, text: l.text, line: base + l.lineOffset });
        pushEmpty();
        break;
      }
      case "listItem": {
        const bullet = node.ordered ? `${node.index}.` : "•";
        const prefixLen = bullet.length + 2; // "• "
        const avail = effectiveWidth - prefixLen;
        if (node.inline && node.inline.length) {
          const base = lineIndex;
          const { lines: wLines, links: lns } = wrapInline(node.inline, avail, globalTargetId);
          wLines.forEach((l, idx) => {
            const pref = idx === 0 ? `{yellow-fg}${bullet}{/yellow-fg} ` : " ".repeat(prefixLen);
            lines.push(pref + l);
            lineIndex++;
          });
          for (const l of lns) links.push({ id: l.id, href: l.href, text: l.text, line: base + l.lineOffset });
        } else {
          const colOpen = node.color ? `{${node.color}-fg}` : "";
          const colClose = node.color ? `{/${node.color}-fg}` : "";
          const wrapped = wordWrap(node.text, avail).split("\n");
          wrapped.forEach((w, i) => {
            const pref = i === 0 ? `${bullet} ` : " ".repeat(prefixLen);
            lines.push(`${colOpen}${pref}${escapeBlessed(w)}${colClose}`);
            lineIndex++;
          });
        }
        pushEmpty();
        break;
      }
      case "table": {
        // Render table with borders, like site fidelity
        const rows = node.rows;
        // Compute column widths based on effectiveWidth
        const colCount = Math.max(...rows.map((r) => r.length));
        const colWidths = Array(colCount).fill(0);
        for (const row of rows) {
          row.forEach((cell, i) => {
            colWidths[i] = Math.max(colWidths[i], Math.min(cell.length, 30));
          });
        }
        // Normalize to fit
        let total = colWidths.reduce((a, b) => a + b, 0) + (colCount - 1) * 3;
        if (total > effectiveWidth) {
          const scale = (effectiveWidth - (colCount - 1) * 3) / colWidths.reduce((a, b) => a + b, 0);
          for (let i = 0; i < colWidths.length; i++) colWidths[i] = Math.max(5, Math.floor(colWidths[i] * scale));
        }
        rows.forEach((row, rIdx) => {
          const isHeader = rIdx === 0;
          const cells = row.map((c, i) => {
            const w = colWidths[i] || 10;
            let v = c.slice(0, w).padEnd(w, " ");
            return isHeader ? `{bold}${escapeBlessed(v)}{/bold}` : escapeBlessed(v);
          });
          const line = cells.join(" {gray-fg}│{/gray-fg} ");
          lines.push(isHeader ? `{cyan-fg}${line}{/cyan-fg}` : line);
          lineIndex++;
          if (isHeader) {
            const sep = colWidths.map((w) => "─".repeat(w)).join("─┼─");
            lines.push(`{gray-fg}${sep}{/gray-fg}`);
            lineIndex++;
          }
        });
        pushEmpty();
        break;
      }
      case "button": {
        const txt = escapeBlessed(node.text);
        const border = node.color ? `{${node.color}-fg}` : "{black-fg}";
        const borderClose = node.color ? `{/${node.color}-fg}` : "{/black-fg}";
        lines.push(`${border}[{/}${borderClose} {inverse} ${txt} {/inverse} ${border}[{/}${borderClose}`);
        lineIndex++;
        pushEmpty();
        break;
      }
      case "hr": {
        lines.push("{gray-fg}" + "─".repeat(Math.min(effectiveWidth, 60)) + "{/gray-fg}");
        lineIndex++;
        pushEmpty();
        break;
      }
      default:
        break;
    }
  }

  // Sort links by line for ↑/↓ order; stable by id
  links.sort((a, b) => a.line - b.line || a.id - b.id);
  const seen = new Set();
  const deduped = [];
  for (const l of links) if (!seen.has(l.id)) { seen.add(l.id); deduped.push(l); }

  // Ensure cursorId link exists — if cursorId is -1 but links exist, caller should have passed first link's id
  const text = lines.join("\n");
  return { text, links: deduped, lines };
}
