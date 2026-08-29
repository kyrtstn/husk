import { JSDOM } from "jsdom";
import { extractInlineColor } from "./utils.js";

// Only strip truly non-content. Keep header/footer/form for link discovery but de-prioritize later.
// nav is required by spec but we keep its links if main content is empty.
const STRIP_SELECTOR = "script, style, noscript, svg, canvas, template, iframe, link[rel=stylesheet], meta[name], object, embed, [hidden], [aria-hidden='true']";

function resolveHref(href, baseUrl) {
  if (!href) return null;
  href = href.trim();
  if (!href || href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("data:")) return null;
  // filter out anchor-only after resolution? keep resolved for fidelity but skip hash-only earlier
  try {
    const u = new URL(href, baseUrl);
    // Avoid url fragments only
    if (u.hash && u.pathname === new URL(baseUrl).pathname && u.search === new URL(baseUrl).search) {
      // still allow but might be anchor
    }
    return u.href;
  } catch {
    return null;
  }
}

function getVisibleText(el) {
  return (el.textContent || "").replace(/\s+/g, " ").trim();
}

function isHidden(el) {
  const style = (el.getAttribute && el.getAttribute("style")) || "";
  if (/display\s*:\s*none/i.test(style) || /visibility\s*:\s*hidden/i.test(style) || /opacity\s*:\s*0/i.test(style)) return true;
  if (el.hidden) return true;
  return false;
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

  // Remove comment nodes implicitly via query, also remove very large style/script left
  // Handle <base> for correct href resolution (JSDOM already uses url option)
  const baseTag = doc.querySelector("base[href]");
  const effectiveBase = baseTag ? new URL(baseTag.getAttribute("href"), baseUrl).href : baseUrl;

  // Heuristic: find main content container by scoring text length
  const candidates = [
    doc.querySelector("main"),
    doc.querySelector("article"),
    doc.querySelector("[role=main]"),
    doc.querySelector("#content"),
    doc.querySelector("#main"),
    doc.querySelector(".content"),
    doc.querySelector("#primary"),
    doc.body,
  ].filter(Boolean);

  // Also score all divs with >500 chars
  const extra = [...doc.querySelectorAll("div, section, article, main")].filter((el) => {
    const len = getVisibleText(el).length;
    return len > 600 && len < 40000;
  });
  for (const e of extra.slice(0, 8)) if (!candidates.includes(e)) candidates.push(e);

  let root = doc.body;
  let bestScore = -1;
  for (const c of candidates) {
    const txtLen = getVisibleText(c).length;
    const linkCount = c.querySelectorAll("a").length;
    // Score: text length minus link penalty (nav-heavy penalized), plus bonus for semantic tags
    const isSemantic = /^(MAIN|ARTICLE)$/.test(c.tagName) || c.getAttribute("role") === "main";
    const score = txtLen - linkCount * 20 + (isSemantic ? 500 : 0);
    if (score > bestScore) {
      bestScore = score;
      root = c;
    }
  }
  if (!root) root = doc.body;

  const nodes = [];
  let linkId = 0;

  function pushNode(n) {
    nodes.push(n);
  }

  // Recursive inline decomposition that captures nested links correctly
  function decomposeInline(el, parentColor) {
    const parts = [];
    for (const child of [...el.childNodes]) {
      if (child.nodeType === 3) {
        // Text node
        const t = child.textContent.replace(/\s+/g, " ").trim();
        if (t) parts.push({ type: "text", text: t, color: parentColor });
        else if (child.textContent.includes("\n")) {
          // ignore pure whitespace
        }
      } else if (child.nodeType === 1) {
        if (isHidden(child)) continue;
        const tag = child.tagName.toLowerCase();
        if (tag === "a") {
          const href = resolveHref(child.getAttribute("href"), effectiveBase);
          const text = getVisibleText(child);
          if (text && href) parts.push({ type: "link", text, href, id: linkId++, color: parentColor });
          else if (text) parts.push({ type: "text", text, color: parentColor });
          else {
            // Image link with no text but img alt
            const img = child.querySelector("img");
            if (img) {
              const alt = img.getAttribute("alt") || img.getAttribute("title") || "[image]";
              if (href) parts.push({ type: "link", text: alt, href, id: linkId++, color: parentColor });
            }
          }
        } else if (tag === "img") {
          const alt = child.getAttribute("alt") || child.getAttribute("title") || "";
          const src = child.getAttribute("src") || "";
          const txt = alt ? `[IMG: ${alt}]` : src ? `[IMG]` : "";
          if (txt) parts.push({ type: "text", text: txt, color: parentColor });
        } else if (tag === "br") {
          parts.push({ type: "text", text: "\n" });
        } else if (tag === "b" || tag === "strong") {
          const inner = decomposeInline(child, parentColor);
          for (const p of inner) p.bold = true;
          parts.push(...inner);
          if (inner.length === 0) {
            const t = getVisibleText(child);
            if (t) parts.push({ type: "text", text: t, bold: true, color: parentColor });
          }
        } else if (tag === "i" || tag === "em" || tag === "cite") {
          const inner = decomposeInline(child, parentColor);
          for (const p of inner) p.italic = true;
          parts.push(...inner);
          if (inner.length === 0) {
            const t = getVisibleText(child);
            if (t) parts.push({ type: "text", text: t, italic: true, color: parentColor });
          }
        } else if (tag === "u") {
          const inner = decomposeInline(child, parentColor);
          for (const p of inner) p.underline = true;
          parts.push(...inner);
        } else if (tag === "code") {
          const t = getVisibleText(child);
          if (t) parts.push({ type: "text", text: t, code: true, color: parentColor });
        } else if (tag === "span" || tag === "font" || tag === "label" || tag === "small" || tag === "abbr" || tag === "mark" || tag === "time") {
          // Generic inline wrapper — recurse
          const inner = decomposeInline(child, parentColor);
          if (inner.length) parts.push(...inner);
          else {
            const t = getVisibleText(child);
            if (t) parts.push({ type: "text", text: t, color: parentColor });
          }
        } else {
          // Block-level or unknown inline — if it contains text/links, recurse; else capture text
          if (child.querySelector && child.querySelector("a, img, b, strong, i, em, code, span")) {
            const inner = decomposeInline(child, parentColor);
            if (inner.length) parts.push(...inner);
            else {
              const t = getVisibleText(child);
              if (t) parts.push({ type: "text", text: t, color: parentColor });
            }
          } else {
            const t = getVisibleText(child);
            if (t) parts.push({ type: "text", text: t, color: parentColor });
          }
        }
      }
    }
    return parts;
  }

  function walk(el) {
    if (!el || el.nodeType !== 1) return;
    if (isHidden(el)) return;
    const tag = el.tagName.toLowerCase();
    const style = el.getAttribute("style") || "";
    const inlineColor = extractInlineColor(style);

    // Skip if inside nav/footer that we already de-scored? but still walk root if root is body we may walk nav
    // Do not skip header/footer anymore, but mark them as secondary if root is body and we have main
    // We already selected best root, so walking root will include secondary content only if body is root.

    switch (tag) {
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6": {
        const text = getVisibleText(el);
        if (text) pushNode({ type: "heading", level: parseInt(tag[1], 10), text, color: inlineColor });
        break;
      }
      case "p":
      case "blockquote":
      case "pre":
      case "address":
      case "figcaption": {
        const inline = decomposeInline(el, inlineColor);
        if (inline.length) {
          if (tag === "blockquote") pushNode({ type: "blockquote", inline, text: inline.map((p) => p.text).join(" "), color: inlineColor });
          else if (tag === "pre") pushNode({ type: "pre", inline, text: getVisibleText(el), color: inlineColor });
          else pushNode({ type: "paragraph", inline });
        } else {
          const t = getVisibleText(el);
          if (t) pushNode({ type: tag === "blockquote" ? "blockquote" : tag === "pre" ? "pre" : "paragraph", text: t, color: inlineColor });
        }
        break;
      }
      case "a": {
        // Standalone link (often block)
        const href = resolveHref(el.getAttribute("href"), effectiveBase);
        const inline = decomposeInline(el, inlineColor);
        if (inline.length) {
          // If inline already contains links, flatten
          const hasLink = inline.some((p) => p.type === "link");
          if (hasLink) pushNode({ type: "paragraph", inline });
          else if (href) {
            const text = inline.map((p) => p.text).join(" ").trim() || getVisibleText(el);
            if (text) pushNode({ type: "paragraph", inline: [{ type: "link", text, href, id: linkId++, color: inlineColor }] });
          } else {
            const t = getVisibleText(el);
            if (t) pushNode({ type: "paragraph", text: t, color: inlineColor });
          }
        } else {
          const text = getVisibleText(el);
          const img = el.querySelector("img");
          const imgAlt = img ? img.getAttribute("alt") || "[image]" : "";
          const finalText = text || imgAlt;
          if (finalText && href) pushNode({ type: "paragraph", inline: [{ type: "link", text: finalText, href, id: linkId++, color: inlineColor }] });
          else if (finalText) pushNode({ type: "paragraph", text: finalText, color: inlineColor });
        }
        break;
      }
      case "img": {
        const alt = el.getAttribute("alt") || el.getAttribute("title") || "";
        const txt = alt ? `[IMG: ${alt}]` : "[IMG]";
        pushNode({ type: "paragraph", text: txt, color: inlineColor });
        break;
      }
      case "input":
      case "textarea": {
        const placeholder = el.getAttribute("placeholder") || el.getAttribute("value") || el.getAttribute("name") || "";
        const type = el.getAttribute("type") || "text";
        if (type === "hidden") break;
        const label = placeholder ? `${tag} [${placeholder}]` : `${tag}`;
        pushNode({ type: "paragraph", text: label, color: inlineColor });
        break;
      }
      case "button":
      case "select": {
        const text = getVisibleText(el) || el.getAttribute("value") || el.getAttribute("placeholder") || tag;
        // Make button navigable if it looks like link, else just text
        const href = el.getAttribute("href") || el.getAttribute("formaction");
        const resolved = href ? resolveHref(href, effectiveBase) : null;
        if (resolved) pushNode({ type: "paragraph", inline: [{ type: "link", text, href: resolved, id: linkId++ }] });
        else pushNode({ type: "button", text, color: inlineColor });
        break;
      }
      case "ul":
      case "ol": {
        const isOrdered = tag === "ol";
        let idx = 1;
        for (const li of [...el.children].filter((c) => c.tagName.toLowerCase() === "li")) {
          if (isHidden(li)) continue;
          const clr = extractInlineColor(li.getAttribute("style") || "") || inlineColor;
          const inline = decomposeInline(li, clr);
          if (inline.length) pushNode({ type: "listItem", ordered: isOrdered, index: idx, inline });
          else {
            const t = getVisibleText(li);
            if (t) pushNode({ type: "listItem", ordered: isOrdered, index: idx, text: t, color: clr });
          }
          idx++;
        }
        // Handle nested lists after
        break;
      }
      case "li": {
        // In case li appears outside ul/ol (malformed)
        const inline = decomposeInline(el, inlineColor);
        if (inline.length) pushNode({ type: "listItem", ordered: false, index: 1, inline });
        else {
          const t = getVisibleText(el);
          if (t) pushNode({ type: "listItem", ordered: false, index: 1, text: t, color: inlineColor });
        }
        break;
      }
      case "table": {
        const rows = [];
        for (const tr of el.querySelectorAll("tr")) {
          const cells = [...tr.querySelectorAll("th, td")].map((c) => {
            const inl = decomposeInline(c, inlineColor);
            if (inl.length) return inl.map((p) => p.text).join(" ");
            return getVisibleText(c);
          });
          if (cells.some((c) => c)) rows.push(cells);
        }
        if (rows.length) pushNode({ type: "table", rows });
        else {
          // fallback: text
          const t = getVisibleText(el);
          if (t) pushNode({ type: "paragraph", text: t, color: inlineColor });
        }
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
      case "aside":
      case "figure":
      case "header":
      case "footer":
      case "nav":
      case "span":
      case "body":
      case "form":
      case "fieldset":
      case "details":
      case "summary":
      case "center":
      case "td":
      case "th": {
        // For containers: if they have block children, recurse; else treat as paragraph with inline.
        const blockTags = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "table", "blockquote", "pre", "div", "section", "article", "aside", "figure", "hr", "header", "footer", "nav", "form"]);
        const hasBlockChild = [...el.children].some((c) => blockTags.has(c.tagName.toLowerCase()));
        if (hasBlockChild) {
          for (const child of [...el.children]) walk(child);
          // Also capture stray text nodes directly in container that have links? Already handled via block recursion but check:
          const strayLinks = [...el.childNodes].filter((n) => n.nodeType === 1 && n.tagName.toLowerCase() === "a");
          // Walk already handled via children, so nothing extra
        } else {
          const inline = decomposeInline(el, inlineColor);
          if (inline.length) {
            // Only push if not empty and not just whitespace and contains meaningful content
            const txtJoin = inline.map((p) => p.text).join(" ").trim();
            if (txtJoin) pushNode({ type: "paragraph", inline });
          } else {
            const t = getVisibleText(el);
            if (t) pushNode({ type: "paragraph", text: t, color: inlineColor });
          }
          // Recurse for any nested block that wasn't captured? Already captured via inline, but ensure children not double-counted
        }
        break;
      }
      case "code": {
        const t = getVisibleText(el);
        if (t) pushNode({ type: "paragraph", text: t, color: inlineColor, code: true });
        break;
      }
      default: {
        // Fallback: try inline decompose else recurse
        const inline = decomposeInline(el, inlineColor);
        if (inline.length && inline.join("").length < 1000) {
          pushNode({ type: "paragraph", inline });
        } else {
          if (el.children.length === 0) {
            const t = getVisibleText(el);
            if (t) pushNode({ type: "paragraph", text: t, color: inlineColor });
          } else {
            for (const child of [...el.children]) walk(child);
          }
        }
        break;
      }
    }
  }

  walk(root);

  // If root produced no nodes (empty article etc), fallback walk body comprehensively
  if (nodes.length === 0 && root !== doc.body) {
    for (const child of [...doc.body.children]) walk(child);
  }

  // If still empty, last resort: extract all <a> as paragraph links plus text chunks
  if (nodes.length === 0) {
    const allLinks = [...doc.querySelectorAll("a[href]")].slice(0, 100).map((a) => {
      const href = resolveHref(a.getAttribute("href"), effectiveBase);
      const text = getVisibleText(a);
      if (href && text) return { type: "paragraph", inline: [{ type: "link", text, href, id: linkId++ }] };
      return null;
    }).filter(Boolean);
    if (allLinks.length) nodes.push(...allLinks);
    const bodyText = getVisibleText(doc.body);
    if (bodyText) {
      const chunks = bodyText.split(/\s{2,}|\n+/).filter((s) => s.trim().length > 20).slice(0, 30);
      for (const c of chunks) nodes.push({ type: "paragraph", text: c.trim().slice(0, 800) });
    }
  }

  // Deduplicate consecutive identical paragraphs (common in div soup)
  const filtered = [];
  let prevText = "";
  for (const n of nodes) {
    let txt = n.text || (n.inline ? n.inline.map((p) => p.text).join(" ") : "");
    txt = txt.trim();
    if (!txt) continue;
    // Skip if duplicate of previous (exact)
    if (txt === prevText) continue;
    // Merge duplicate headings etc.
    prevText = txt;
    filtered.push(n);
  }

  // If still empty but we had links, ensure at least something
  if (filtered.length === 0 && nodes.length) return nodes;

  return filtered;
}
