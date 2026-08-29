import { JSDOM } from "jsdom";
import { extractInlineColor } from "./utils.js";

const STRIP_SELECTOR = "script, style, svg, nav, noscript, iframe, canvas, footer, header, link[rel=stylesheet], form";

function resolveHref(href, baseUrl) {
  if (!href) return null;
  href = href.trim();
  if (!href || href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:") || href.startsWith("tel:")) return null;
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return null;
  }
}

function getVisibleText(el) {
  // collapse whitespace
  return (el.textContent || "").replace(/\s+/g, " ").trim();
}

export function parseHTML(html, baseUrl) {
  const dom = new JSDOM(html, {
    url: baseUrl,
    pretendToBeVisual: true,
    runScripts: "outside-only",
    resources: "usable",
  });

  const doc = dom.window.document;

  // Remove bloat
  doc.querySelectorAll(STRIP_SELECTOR).forEach((el) => el.remove());

  // Prefer article/main, fallback to body
  let root = doc.querySelector("article") || doc.querySelector("main") || doc.querySelector("[role=main]") || doc.body;
  if (!root) root = doc.body;

  const nodes = [];
  let linkId = 0;

  function pushNode(node) {
    nodes.push(node);
  }

  function walk(el, depth = 0) {
    if (!el || el.nodeType !== 1) return;
    const tag = el.tagName.toLowerCase();

    // Skip hidden
    const style = el.getAttribute("style") || "";
    if (/display\s*:\s*none/i.test(style) || /visibility\s*:\s*hidden/i.test(style)) return;

    const inlineColor = extractInlineColor(style);

    switch (tag) {
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6": {
        const text = getVisibleText(el);
        if (text) {
          const level = parseInt(tag[1], 10);
          pushNode({ type: "heading", level, text, color: inlineColor });
        }
        break;
      }
      case "p":
      case "blockquote":
      case "pre": {
        // Check if p contains only links or mixed content — treat as paragraph but preserve links inline
        // For simplicity, if it has <a> children, we decompose inline
        if (el.querySelector("a")) {
          const inline = decomposeInline(el, baseUrl, inlineColor);
          if (inline.length) pushNode({ type: "paragraph", inline });
        } else {
          const text = getVisibleText(el);
          if (text) {
            const isPre = tag === "pre";
            pushNode({ type: tag === "blockquote" ? "blockquote" : "paragraph", text, color: inlineColor, pre: isPre });
          }
        }
        break;
      }
      case "a": {
        // standalone link not inside p (e.g. nav-like but not stripped)
        const href = resolveHref(el.getAttribute("href"), baseUrl);
        const text = getVisibleText(el);
        if (text && href) {
          pushNode({ type: "paragraph", inline: [{ type: "link", text, href, id: linkId++, color: inlineColor }] });
        } else if (text) {
          pushNode({ type: "paragraph", text, color: inlineColor });
        }
        break;
      }
      case "button": {
        const text = getVisibleText(el);
        if (text) pushNode({ type: "button", text, color: inlineColor });
        break;
      }
      case "ul":
      case "ol": {
        const isOrdered = tag === "ol";
        let idx = 1;
        for (const li of el.children) {
          if (li.tagName.toLowerCase() !== "li") continue;
          const inline = decomposeInline(li, baseUrl, inlineColor);
          if (inline.length) {
            pushNode({ type: "listItem", ordered: isOrdered, index: idx, inline });
          } else {
            const text = getVisibleText(li);
            if (text) pushNode({ type: "listItem", ordered: isOrdered, index: idx, text, color: inlineColor });
          }
          idx++;
        }
        break;
      }
      case "table": {
        const rows = [];
        for (const tr of el.querySelectorAll("tr")) {
          const cells = [...tr.querySelectorAll("th, td")].map((c) => getVisibleText(c));
          if (cells.length) rows.push(cells);
        }
        if (rows.length) pushNode({ type: "table", rows });
        break;
      }
      case "br": {
        pushNode({ type: "paragraph", text: "" });
        break;
      }
      case "hr": {
        pushNode({ type: "hr" });
        break;
      }
      case "div":
      case "section":
      case "article":
      case "main":
      case "span":
      case "body": {
        // Recurse
        for (const child of [...el.children]) {
          walk(child, depth + 1);
        }
        // If div has direct text and no element children handled, capture text
        if (el.children.length === 0) {
          const text = getVisibleText(el);
          if (text) pushNode({ type: "paragraph", text, color: inlineColor });
        } else {
          // Also handle text nodes directly inside div that are not in p
          const directText = [...el.childNodes]
            .filter((n) => n.nodeType === 3 && n.textContent.trim())
            .map((n) => n.textContent.replace(/\s+/g, " ").trim())
            .join(" ");
          if (directText && !el.querySelector("p, h1, h2, h3, ul, ol, table")) {
            // avoid duplicate if already handled via inline decomposition below
            // Only push if no paragraph already covers it
          }
        }
        break;
      }
      default: {
        // For unknown tags, try to decompose inline or recurse
        if (el.children.length === 0) {
          const text = getVisibleText(el);
          if (text) pushNode({ type: "paragraph", text, color: inlineColor });
        } else {
          for (const child of [...el.children]) walk(child, depth + 1);
        }
        break;
      }
    }
  }

  function decomposeInline(container, baseUrl, parentColor) {
    // Returns array of {type:'text'|'link', text, href?, id?, color?}
    const parts = [];
    for (const node of container.childNodes) {
      if (node.nodeType === 3) {
        const t = node.textContent.replace(/\s+/g, " ").trim();
        if (t) parts.push({ type: "text", text: t, color: parentColor });
      } else if (node.nodeType === 1) {
        const tag = node.tagName.toLowerCase();
        if (tag === "a") {
          const href = resolveHref(node.getAttribute("href"), baseUrl);
          const text = getVisibleText(node);
          if (text && href) {
            parts.push({ type: "link", text, href, id: linkId++, color: parentColor });
          } else if (text) {
            parts.push({ type: "text", text, color: parentColor });
          }
        } else if (tag === "b" || tag === "strong") {
          const text = getVisibleText(node);
          if (text) parts.push({ type: "text", text, bold: true, color: parentColor });
        } else if (tag === "i" || tag === "em") {
          const text = getVisibleText(node);
          if (text) parts.push({ type: "text", text, italic: true, color: parentColor });
        } else if (tag === "br") {
          parts.push({ type: "text", text: "\n" });
        } else {
          // nested element
          const inner = getVisibleText(node);
          if (inner) parts.push({ type: "text", text: inner, color: parentColor });
          // also check for nested links inside
          if (node.querySelector && node.querySelector("a")) {
            // fallback: re-decompose recursively if needed
          }
        }
      }
    }
    return parts;
  }

  walk(root);

  // Collapse consecutive empty paragraphs
  const filtered = [];
  for (const n of nodes) {
    if (n.type === "paragraph" && !n.text && !n.inline) continue;
    filtered.push(n);
  }

  // If nothing parsed, fallback to body text
  if (filtered.length === 0) {
    const fallback = getVisibleText(root);
    if (fallback) {
      const chunks = fallback.split(/\n\s*\n/).slice(0, 50);
      for (const c of chunks) {
        const t = c.trim();
        if (t) filtered.push({ type: "paragraph", text: t.slice(0, 500) });
      }
    }
  }

  return filtered;
}
