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

function extractMeta(doc) {
  const title = (doc.querySelector("title")?.textContent || "").trim().slice(0,120);
  const desc = (doc.querySelector('meta[name="description"]')?.getAttribute("content") || doc.querySelector('meta[property="og:description"]')?.getAttribute("content") || "").trim().slice(0,220);
  const ogImage = doc.querySelector('meta[property="og:image"]')?.getAttribute("content") || "";
  return { title, desc, ogImage };
}

const INLINE_TAGS = new Set(["a","b","strong","i","em","cite","u","code","span","font","label","small","abbr","mark","time","img","br","input","textarea","button","select","q","kbd","samp","var","sub","sup","s","strike","del","ins"]);
function isInlineTag(tag){ return INLINE_TAGS.has(tag); }

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

  // Detect challenge / bot pages early
  const titleText = (doc.querySelector("title")?.textContent || "").toLowerCase();
  const bodyTextLower = (doc.body?.textContent || "").toLowerCase();
  const isChallenge = titleText.includes("just a moment") || titleText.includes("attention required") || bodyTextLower.includes("cf-challenge") || bodyTextLower.includes("anomaly-modal") || bodyTextLower.includes("please turn javascript on");
  if (isChallenge) {
    // Return special challenge node instead of empty
  }

  // Heuristic: find main content container by scoring text length
  const candidates = [
    doc.querySelector("main"),
    doc.querySelector("article"),
    doc.querySelector("[role=main]"),
    doc.querySelector("#content"),
    doc.querySelector("#mw-content-text"),
    doc.querySelector("#main"),
    doc.querySelector(".content"),
    doc.querySelector("#primary"),
    doc.body,
  ].filter(Boolean);

  // Also score all divs/sections with >500 chars, but filter out nav-heavy sidebars later via penalty
  const extra = [...doc.querySelectorAll("div, section, article, main, react-app")].filter((el) => {
    const len = getVisibleText(el).length;
    return len > 600 && len < 40000;
  });
  for (const e of extra.slice(0, 10)) if (!candidates.includes(e)) candidates.push(e);

  let root = doc.body;
  let bestScore = -1;
  for (const c of candidates) {
    const txtLen = getVisibleText(c).length;
    const linkCount = c.querySelectorAll("a").length;
    const isSemantic = /^(MAIN|ARTICLE)$/.test(c.tagName) || c.getAttribute("role") === "main" || c.id === "mw-content-text" || c.id === "content";
    const linkPenalty = isSemantic ? 10 : 25;
    const score = txtLen - linkCount * linkPenalty + (isSemantic ? 4000 : 0);
    if (score > bestScore) {
      bestScore = score;
      root = c;
    }
  }
  if (!root) root = doc.body;

  const meta = extractMeta(doc);
  const nodes = [];
  // Inject beautiful title/desc as first nodes if available and not inside root's heading already
  if (meta.title) {
    nodes.push({ type: "siteHeader", text: meta.title, desc: meta.desc, url: baseUrl });
  }
  // If challenge detected, inject helpful card
  const lowerTitle = (meta.title||"").toLowerCase();
  const isBlocked = lowerTitle.includes("just a moment") || lowerTitle.includes("attention required") || html.toLowerCase().includes("anomaly-modal");
  if (isBlocked) {
    nodes.push({ type: "challenge", text: "This site is protected by Cloudflare / bot protection and requires JavaScript.", url: baseUrl });
  }
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
      case "th":
      case "react-app":
      case "main-app":
      case "app": {
        // For containers: if they have block children, recurse; else treat as paragraph with inline.
        // Use inlineTag check: any non-inline child counts as block container
        const hasBlockChild = [...el.children].some((c) => !isInlineTag(c.tagName.toLowerCase()));
        // Special: tables/center/react-app always considered block containers even if heuristic misses
        const alwaysBlock = ["div","section","article","main","aside","figure","header","footer","nav","center","table","tbody","thead","tfoot","tr","body","react-app","main-app","app"].includes(tag);
        if ((hasBlockChild || alwaysBlock) && el.children.length>0) {
          // For large mega-divs that would otherwise collapse to single paragraph, force split if text huge
          // But still recurse to preserve cards
          for (const child of [...el.children]) walk(child);
        } else {
          const inline = decomposeInline(el, inlineColor);
          if (inline.length) {
            const txtJoin = inline.map((p) => p.text).join(" ").trim();
            if (txtJoin) pushNode({ type: "paragraph", inline });
          } else {
            const t = getVisibleText(el);
            if (t) pushNode({ type: "paragraph", text: t, color: inlineColor });
          }
        }
        break;
      }
      case "table":
      case "tbody":
      case "thead":
      case "tfoot": {
        const isInsideCenter = !!el.closest("center");
        const allTrs = [...el.querySelectorAll("tr")].slice(0,120);
        const isLayout = isInsideCenter || (allTrs.length>8 && !el.querySelector("th"));
        if(isLayout && allTrs.length>3){
          let emitted=0;
          for(const tr of allTrs){
            if(isHidden(tr)) continue;
            const inline = decomposeInline(tr, inlineColor);
            let effectiveInline = inline;
            if(effectiveInline.length===0){
              for(const td of tr.querySelectorAll("td")){
                const tdInline = decomposeInline(td, inlineColor);
                if(tdInline.length) effectiveInline.push(...tdInline);
              }
            }
            if(effectiveInline.length){
              const txt = effectiveInline.map(p=>p.text).join(" ").trim();
              if(txt.length>10){
                pushNode({ type: "paragraph", inline: effectiveInline });
                emitted++;
                if(emitted>60) break;
              }
            }
          }
          if(emitted>0) break;
        }
        // DEBUG
        // console.log("TABLE debug", el.tagName, allTrs.length, el.querySelector("th")? "has th":"no th");
        const rows = [];
        for (const tr of el.querySelectorAll(":scope > tr, :scope > thead > tr, :scope > tbody > tr, :scope > tfoot > tr")) {
          const cells = [...tr.children].filter(c=> ["td","th"].includes(c.tagName.toLowerCase())).map((c) => {
            const inl = decomposeInline(c, inlineColor);
            if (inl.length) return inl.map((p) => p.text).join(" ");
            return getVisibleText(c);
          });
          if (cells.some((c) => c)) rows.push(cells);
        }
        if (rows.length===0){
          for (const tr of el.querySelectorAll("tr")) {
            const cells = [...tr.querySelectorAll("th, td")].map((c) => {
              const inl = decomposeInline(c, inlineColor);
              if (inl.length) return inl.map((p) => p.text).join(" ");
              return getVisibleText(c);
            });
            if (cells.some((c) => c)) rows.push(cells);
          }
        }
        if (rows.length && rows.length<60) {
          pushNode({ type: "table", rows });
        } else if (rows.length) {
          for(let i=0;i<rows.length;i+=20){
            pushNode({ type: "table", rows: rows.slice(i,i+20) });
          }
        } else {
          const inline = decomposeInline(el, inlineColor);
          if(inline.length) pushNode({ type:"paragraph", inline });
          else {
            const t = getVisibleText(el);
            if (t) pushNode({ type: "paragraph", text: t, color: inlineColor });
          }
        }
        break;
      }
      case "tr": {
        // Standalone row (when table already handled, ignore)
        const cells = [...el.children].filter(c=> ["td","th"].includes(c.tagName.toLowerCase())).map(c=> getVisibleText(c));
        if(cells.some(c=>c)) pushNode({ type: "table", rows:[cells] });
        else {
          const inline=decomposeInline(el, inlineColor);
          if(inline.length) pushNode({type:"paragraph", inline});
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

  const hasContent = nodes.some(n=> n.type!=="siteHeader" && n.type!=="challenge");
  // If root produced no real nodes (only header), fallback walk body comprehensively
  if (!hasContent && root !== doc.body) {
    for (const child of [...doc.body.children]) walk(child);
  }

  // If still empty, last resort: extract all <a> as paragraph links plus text chunks
  if (!nodes.some(n=> n.type!=="siteHeader" && n.type!=="challenge")) {
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
    // Keep structural nodes that don't have text (tables, hrs, headers)
    if (n.type === "table" || n.type === "hr" || n.type === "siteHeader" || n.type === "challenge") {
      filtered.push(n);
      continue;
    }
    let txt = n.text || (n.inline ? n.inline.map((p) => p.text).join(" ") : "");
    if (n.type === "table" && n.rows) txt = n.rows.flat().join(" ");
    txt = (txt || "").trim();
    if (!txt) continue;
    if (txt === prevText) continue;
    prevText = txt;
    filtered.push(n);
  }

  // If still empty but we had links, ensure at least something
  if (filtered.length === 0 && nodes.length) return nodes;

  return filtered;
}
