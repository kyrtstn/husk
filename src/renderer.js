import { wordWrap } from "./utils.js";

function blessedColorTag(color) {
  if (!color) return "";
  return `{${color}-fg}`;
}
function blessedCloseColor(color) {
  if (!color) return "";
  return `{/${color}-fg}`;
}

function renderInline(parts, width, cursorId, lineMap, startLine) {
  // Returns {text, linesCount}
  let out = "";
  let linksInPara = [];
  let curLine = startLine;

  // Build a single string with blessed tags, then word-wrap manually per visual length
  // For cursor support, we need to know which line each link appears on
  let plain = "";
  let tagged = "";
  const linkRanges = []; // {id, href, text, start, end}
  let pos = 0;

  for (const p of parts) {
    if (p.type === "link") {
      const before = plain.length;
      plain += p.text;
      // tagged version with blessed
      const colOpen = p.color ? `{${p.color}-fg}` : "";
      const colClose = p.color ? `{/${p.color}-fg}` : "";
      // bold/italic not needed separately
      const isFocused = p.id === cursorId;
      const open = isFocused ? "{inverse}" : "{underline}{blue-fg}";
      const close = isFocused ? "{/inverse}" : "{/blue-fg}{/underline}";
      const segment = `${open}${colOpen}${escapeBlessed(p.text)}${colClose}${close}`;
      tagged += (tagged ? " " : "") + segment;
      plain += " ";
      pos += p.text.length + 1;
      linkRanges.push({ id: p.id, href: p.href, text: p.text, start: before, end: before + p.text.length });
    } else {
      const txt = p.text === "\n" ? "\n" : p.text;
      if (txt === "\n") {
        plain += "\n";
        tagged += "\n";
        pos += 1;
        continue;
      }
      const colOpen = p.color ? `{${p.color}-fg}` : "";
      const colClose = p.color ? `{/${p.color}-fg}` : "";
      const bOpen = p.bold ? "{bold}" : "";
      const bClose = p.bold ? "{/bold}" : "";
      const iOpen = p.italic ? "{italic}" : "";
      const iClose = p.italic ? "{/italic}" : "";
      plain += (plain ? " " : "") + txt;
      tagged += (tagged ? " " : "") + `${bOpen}${iOpen}${colOpen}${escapeBlessed(txt)}${colClose}${iClose}${bClose}`;
      pos += txt.length + 1;
    }
  }

  // Wrap tagged string while keeping tags invisible for width calc
  // We wrap based on plain text, but we need to slice tagged accordingly — simplistic: wrap plain then re-apply?
  // Instead: split plain into wrapped lines, then for each line extract substring and map links

  // For performance and simplicity on low-end: wrap plain, then render tagged per line by re-building
  // But to keep cursor highlight, we do per-word tagged mapping — easier: wrap using plain, then generate lines with tagged fallback

  const wrappedPlainLines = wordWrap(plain, width).split("\n");
  let taggedLines = [];

  // Reconstruct tagged lines by consuming tagged tokens — approximate by using plain lines lengths
  // This is not perfect but sufficient for low-end
  // We will produce bullet prefix separately

  return {
    plain,
    tagged,
    wrappedPlainLines,
    linkRanges,
  };
}

function escapeBlessed(str) {
  return str.replace(/\{/g, "\\{").replace(/\}/g, "\\}");
}

export function renderContent(nodes, { width = 80, cursorId = -1 } = {}) {
  const effectiveWidth = Math.max(20, width - 2);
  let lines = [];
  let links = []; // flat list {id, href, text, line}
  let lineIndex = 0;

  function pushLines(str) {
    const ls = str.split("\n");
    for (const l of ls) {
      lines.push(l);
      lineIndex++;
    }
  }

  for (const node of nodes) {
    switch (node.type) {
      case "heading": {
        const level = node.level || 1;
        const prefix = level === 1 ? "█ " : level === 2 ? "▓ " : "▒ ";
        const color = node.color ? `{${node.color}-fg}` : "{bold}{white-fg}";
        const close = node.color ? `{/${node.color}-fg}` : "{/white-fg}{/bold}";
        const decor = level === 1 ? "{underline}" : "";
        const decorClose = level === 1 ? "{/underline}" : "";
        const raw = prefix + node.text.toUpperCase();
        const wrapped = wordWrap(raw, effectiveWidth).split("\n");
        for (const w of wrapped) {
          pushLines(`${decor}${color}${escapeBlessed(w)}${close}${decorClose}`);
        }
        pushLines("");
        break;
      }
      case "paragraph": {
        if (node.inline && node.inline.length) {
          const { plain, tagged, wrappedPlainLines, linkRanges } = renderInline(node.inline, effectiveWidth, cursorId, links, lineIndex);
          // Build wrapped lines with tags — we need to distribute tagged tokens across wrapped lines
          // Simple approach: if no links needing highlight, just wrap tagged naively?
          // Use plain wrapping to count lines, then for each plain line produce corresponding tagged segment
          // For now produce lines from tagged word-wrapped by stripping tags for width calc
          const strippedTag = tagged.replace(/\{[^}]+\}/g, "").replace(/\\\{/g, "{").replace(/\\\}/g, "}");
          const taggedWrapped = wordWrapWithTags(tagged, effectiveWidth);
          for (const tl of taggedWrapped) {
            lines.push(tl);
            lineIndex++;
          }
          // Map links to lines by searching
          for (const r of linkRanges) {
            // Find which line the link text appears on (approx)
            let foundLine = -1;
            for (let i = 0; i < taggedWrapped.length; i++) {
              const stripped = taggedWrapped[i].replace(/\{[^}]+\}/g, "").replace(/\\\{/g, "{").replace(/\\\}/g, "}");
              if (stripped.includes(r.text)) { foundLine = lineIndex - taggedWrapped.length + i; break; }
            }
            links.push({ id: r.id, href: r.href, text: r.text, line: foundLine >= 0 ? foundLine : lineIndex - 1 });
          }
          pushLines("");
        } else {
          const colOpen = node.color ? `{${node.color}-fg}` : "";
          const colClose = node.color ? `{/${node.color}-fg}` : "";
          const wrapped = wordWrap(node.text, effectiveWidth).split("\n");
          for (const w of wrapped) {
            pushLines(`${colOpen}${escapeBlessed(w)}${colClose}`);
          }
          pushLines("");
        }
        break;
      }
      case "blockquote": {
        const wrapped = wordWrap(node.text, effectiveWidth - 4).split("\n");
        for (const w of wrapped) {
          pushLines(`{gray-fg}│ ${escapeBlessed(w)}{/gray-fg}`);
        }
        pushLines("");
        break;
      }
      case "listItem": {
        const bullet = node.ordered ? `${node.index}.` : "•";
        const prefix = ` ${bullet} `;
        const avail = effectiveWidth - prefix.length;
        if (node.inline && node.inline.length) {
          const { tagged, linkRanges } = renderInline(node.inline, avail, cursorId);
          const taggedWrapped = wordWrapWithTags(prefix + tagged.replace(/^\s+/, ""), effectiveWidth);
          // Actually re-wrap correctly
          for (const tl of taggedWrapped) {
            lines.push(tl);
            lineIndex++;
          }
          for (const r of linkRanges) {
            links.push({ id: r.id, href: r.href, text: r.text, line: lineIndex - taggedWrapped.length });
          }
        } else {
          const colOpen = node.color ? `{${node.color}-fg}` : "";
          const colClose = node.color ? `{/${node.color}-fg}` : "";
          const wrapped = wordWrap(node.text, avail).split("\n");
          wrapped.forEach((w, i) => {
            const p = i === 0 ? prefix : " ".repeat(prefix.length);
            pushLines(`${colOpen}${p}${escapeBlessed(w)}${colClose}`);
          });
        }
        pushLines("");
        break;
      }
      case "table": {
        for (const row of node.rows) {
          const line = row.join("  │  ");
          const wrapped = wordWrap(line, effectiveWidth).split("\n");
          for (const w of wrapped) pushLines(`{cyan-fg}${escapeBlessed(w)}{/cyan-fg}`);
        }
        pushLines("");
        break;
      }
      case "button": {
        const isFocused = links.length === cursorId; // not used
        // Buttons not yet in link list, make them navigable? Treat as link with no href
        const colOpen = node.color ? `{${node.color}-fg}` : "";
        const colClose = node.color ? `{/${node.color}-fg}` : "";
        pushLines(`${colOpen}{inverse} [ ${escapeBlessed(node.text)} ] {/inverse}${colClose}`);
        pushLines("");
        break;
      }
      case "hr": {
        pushLines("{gray-fg}" + "─".repeat(Math.min(effectiveWidth, 40)) + "{/gray-fg}");
        pushLines("");
        break;
      }
      default:
        break;
    }
  }

  // Ensure links sorted by line for navigation
  links.sort((a, b) => a.line - b.line || a.id - b.id);
  // Deduplicate by id
  const seen = new Set();
  const deduped = [];
  for (const l of links) if (!seen.has(l.id)) { seen.add(l.id); deduped.push(l); }

  const text = lines.join("\n");
  return { text, links: deduped, lines };
}

function wordWrapWithTags(tagged, width) {
  // Wrap by measuring visible length (tags zero width)
  const words = tagged.split(/(\s+)/); // keep spaces
  let lines = [];
  let cur = "";
  let curLen = 0;

  function visibleLen(s) {
    return s.replace(/\{[^}]+\}/g, "").replace(/\\\{/g, "{").replace(/\\\}/g, "}").length;
  }

  for (const w of words) {
    if (w === "") continue;
    if (w === "\n") {
      lines.push(cur);
      cur = "";
      curLen = 0;
      continue;
    }
    const isSpace = /^\s+$/.test(w);
    if (isSpace) {
      // only add if not at line start
      if (curLen === 0) continue;
      // check if next word would overflow
      continue; // spaces handled via join
    }
    const vlen = visibleLen(w);
    const sepLen = curLen > 0 ? 1 : 0;
    if (curLen + sepLen + vlen > width) {
      if (cur) lines.push(cur);
      // If single word longer than width, hard split
      if (vlen > width) {
        // split visible chars but keep tags — fallback: push as is (will overflow slightly)
        cur = w;
        curLen = vlen;
      } else {
        cur = w;
        curLen = vlen;
      }
    } else {
      cur = cur ? cur + " " + w : w;
      curLen += sepLen + vlen;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}
