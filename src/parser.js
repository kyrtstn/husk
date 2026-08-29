import { JSDOM } from "jsdom";
import { extractInlineColor } from "./utils.js";
import { getNodeStyle } from "./css.js";
import { fetchAllCss } from "./fetcher.js";
const STRIP_SELECTOR = "script, noscript, svg, canvas, template, iframe, object, embed, [hidden], [aria-hidden='true']";
function resolveHref(href, baseUrl) {
  if (!href) return null;
  href = href.trim();
  if (!href || href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("data:")) return null;
  try { return new URL(href, baseUrl).href; } catch { return null; }
}
function getVisibleText(el) { return (el.textContent || "").replace(/\s+/g, " ").trim(); }
function isHidden(el, win) {
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === "style" || tag === "link" || tag === "meta" || tag === "title") return true;
  if (el.hidden) return true;
  const attr = el.getAttribute ? (el.getAttribute("style")||"") : "";
  if (/display\s*:\s*none/i.test(attr) || /visibility\s*:\s*hidden/i.test(attr) || /opacity\s*:\s*0/i.test(attr)) return true;
  // Note: do not check computed display:none here - it hides Gmail on Google due to responsive CSS
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
export async function parseHTML(html, baseUrl) {
  // Extract stylesheet hrefs before JSDOM to avoid double-fetch via JSDOM resource loader
  const linkHrefs = [...html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*href=["']([^"']+)["']/gi)].map(m=>m[1]).slice(0,3);
  let cssTexts = [];
  if (linkHrefs.length) {
    try { cssTexts = await fetchAllCss(linkHrefs, baseUrl); } catch {}
  }
  const dom = new JSDOM(html, { url: baseUrl, pretendToBeVisual: true, runScripts: "outside-only", resources: "usable" });
  const doc = dom.window.document;
  const win = dom.window;
  // Inject fetched CSS (with error handling for modern syntax)
  for (const css of cssTexts) {
    try { const style = doc.createElement("style"); style.textContent = css; doc.head.appendChild(style); } catch {}
  }
  doc.querySelectorAll(STRIP_SELECTOR).forEach((el) => el.remove());
  // Also remove any remaining stylesheet links to prevent JSDOM background fetch
  doc.querySelectorAll('link[rel="stylesheet"]').forEach(el=> el.remove());
  const baseTag = doc.querySelector("base[href]");
  const effectiveBase = baseTag ? new URL(baseTag.getAttribute("href"), baseUrl).href : baseUrl;
  const titleText = (doc.querySelector("title")?.textContent || "").toLowerCase();
  const bodyTextLower = (doc.body?.textContent || "").toLowerCase();
  const isChallenge = titleText.includes("just a moment") || titleText.includes("attention required") || bodyTextLower.includes("cf-challenge") || bodyTextLower.includes("anomaly-modal") || bodyTextLower.includes("please turn javascript on");
  const candidates = [doc.querySelector("main"),doc.querySelector("article"),doc.querySelector("[role=main]"),doc.querySelector("#content"),doc.querySelector("#mw-content-text"),doc.querySelector("#main"),doc.querySelector(".content"),doc.querySelector("#primary"),doc.body].filter(Boolean);
  const extra = [...doc.querySelectorAll("div, section, article, main, react-app")].filter((el) => { const len = getVisibleText(el).length; return len > 600 && len < 40000; });
  for (const e of extra.slice(0, 10)) if (!candidates.includes(e)) candidates.push(e);
  let root = doc.body;
  let bestScore = -1;
  for (const c of candidates) {
    const txtLen = getVisibleText(c).length;
    const linkCount = c.querySelectorAll("a").length;
    const isSemantic = /^(MAIN|ARTICLE)$/.test(c.tagName) || c.getAttribute("role") === "main" || c.id === "mw-content-text" || c.id === "content";
    const linkPenalty = isSemantic ? 10 : 25;
    const score = txtLen - linkCount * linkPenalty + (isSemantic ? 4000 : 0);
    if (score > bestScore) { bestScore = score; root = c; }
  }
  if (!root) root = doc.body;
  const meta = extractMeta(doc);
  const nodes = [];
  if (meta.title) nodes.push({ type: "siteHeader", text: meta.title, desc: meta.desc, url: baseUrl });
  const lowerTitle = (meta.title||"").toLowerCase();
  const isBlocked = lowerTitle.includes("just a moment") || lowerTitle.includes("attention required") || html.toLowerCase().includes("anomaly-modal");
  if (isBlocked) nodes.push({ type: "challenge", text: "This site is protected by Cloudflare / bot protection and requires JavaScript.", url: baseUrl });
  let linkId = 0;
  function pushNode(n){ nodes.push(n); }
  function decomposeInline(el, parentStyle) {
    const parts = [];
    for (const child of [...el.childNodes]) {
      if (child.nodeType === 3) {
        const t = child.textContent.replace(/\s+/g, " ").trim();
        if (t) { const s = parentStyle || {}; parts.push({ type: "text", text: t, color: s.fg, style: s }); }
      } else if (child.nodeType === 1) {
        if (isHidden(child, win)) continue;
        const tag = child.tagName.toLowerCase();
        const cs = getNodeStyle(child, win);
        const mergedStyle = { ...parentStyle, ...cs, fg: cs.fg || parentStyle?.fg };
        if (tag === "a") {
          const href = resolveHref(child.getAttribute("href"), effectiveBase);
          const text = getVisibleText(child);
          if (text && href) parts.push({ type: "link", text, href, id: linkId++, color: mergedStyle.fg, style: mergedStyle });
          else if (text) parts.push({ type: "text", text, color: mergedStyle.fg, style: mergedStyle });
          else {
            const img = child.querySelector("img");
            if (img) { const alt = img.getAttribute("alt") || img.getAttribute("title") || "[image]"; if (href) parts.push({ type: "link", text: alt, href, id: linkId++, color: mergedStyle.fg, style: mergedStyle }); }
          }
        } else if (tag === "img") {
          const alt = child.getAttribute("alt") || child.getAttribute("title") || "";
          const src = child.getAttribute("src") || "";
          const txt = alt ? `[IMG: ${alt}]` : src ? `[IMG]` : "";
          if (txt) parts.push({ type: "text", text: txt, color: mergedStyle.fg, style: mergedStyle });
        } else if (tag === "br") { parts.push({ type: "text", text: "\n" });
        } else if (tag === "b" || tag === "strong") {
          const inner = decomposeInline(child, { ...mergedStyle, bold: true });
          if (inner.length) parts.push(...inner); else { const t=getVisibleText(child); if(t) parts.push({type:"text", text:t, bold:true, color:mergedStyle.fg, style:{...mergedStyle,bold:true}}); }
        } else if (tag === "i" || tag === "em" || tag === "cite") {
          const inner = decomposeInline(child, { ...mergedStyle, italic:true });
          if (inner.length) parts.push(...inner); else { const t=getVisibleText(child); if(t) parts.push({type:"text", text:t, italic:true, color:mergedStyle.fg, style:{...mergedStyle,italic:true}}); }
        } else if (tag === "u") { const inner = decomposeInline(child, { ...mergedStyle, underline:true }); parts.push(...inner);
        } else if (tag === "code") { const t = getVisibleText(child); if (t) parts.push({ type: "text", text: t, code:true, color: mergedStyle.fg, style: mergedStyle });
        } else if (["span","font","label","small","abbr","mark","time","q","kbd"].includes(tag)) {
          const inner = decomposeInline(child, mergedStyle);
          if (inner.length) parts.push(...inner); else { const t=getVisibleText(child); if(t) parts.push({type:"text", text:t, color:mergedStyle.fg, style:mergedStyle}); }
        } else {
          if (child.querySelector && child.querySelector("a, img, b, strong, i, em, code, span")) {
            const inner = decomposeInline(child, mergedStyle);
            if (inner.length) parts.push(...inner); else { const t=getVisibleText(child); if(t) parts.push({type:"text", text:t, color:mergedStyle.fg, style:mergedStyle}); }
          } else { const t=getVisibleText(child); if(t) parts.push({type:"text", text:t, color:mergedStyle.fg, style:mergedStyle}); }
        }
      }
    }
    return parts;
  }
  function walk(el) {
    if (!el || el.nodeType !== 1) return;
    if (isHidden(el, win)) return;
    const tag = el.tagName.toLowerCase();
    const style = getNodeStyle(el, win);
    if (style.display === "none") return;
    switch (tag) {
      case "h1": case "h2": case "h3": case "h4": case "h5": case "h6": { const text = getVisibleText(el); if (text) pushNode({ type: "heading", level: parseInt(tag[1],10), text, color: style.fg, style }); break; }
      case "p": case "blockquote": case "pre": case "address": case "figcaption": {
        const inline = decomposeInline(el, style);
        if (inline.length) {
          if (tag==="blockquote") pushNode({ type:"blockquote", inline, text: inline.map(p=>p.text).join(" "), color: style.fg, style });
          else if (tag==="pre") pushNode({ type:"pre", inline, text: getVisibleText(el), color: style.fg, style });
          else pushNode({ type:"paragraph", inline, style });
        } else { const t=getVisibleText(el); if(t) pushNode({ type: tag==="blockquote"?"blockquote":tag==="pre"?"pre":"paragraph", text:t, color: style.fg, style }); }
        break;
      }
      case "a": {
        const href = resolveHref(el.getAttribute("href"), effectiveBase);
        const inline = decomposeInline(el, style);
        if (inline.length) {
          const hasLink = inline.some(p=>p.type==="link");
          if (hasLink) pushNode({ type:"paragraph", inline, style });
          else if (href) { const text = inline.map(p=>p.text).join(" ").trim() || getVisibleText(el); if(text) pushNode({ type:"paragraph", inline:[{type:"link", text, href, id:linkId++, color: style.fg, style}], style }); }
          else { const t=getVisibleText(el); if(t) pushNode({ type:"paragraph", text:t, color: style.fg, style }); }
        } else {
          const text=getVisibleText(el);
          const img=el.querySelector("img");
          const imgAlt=img? img.getAttribute("alt")||"[image]":"";
          const finalText=text||imgAlt;
          if(finalText && href) pushNode({ type:"paragraph", inline:[{type:"link", text:finalText, href, id:linkId++, color: style.fg, style}], style });
          else if(finalText) pushNode({ type:"paragraph", text:finalText, color: style.fg, style });
        }
        break;
      }
      case "img": { const alt=el.getAttribute("alt")||el.getAttribute("title")||""; const txt=alt?`[IMG: ${alt}]`:"[IMG]"; pushNode({ type:"paragraph", text:txt, color: style.fg, style }); break; }
      case "form": {
        const inputs = [...el.querySelectorAll("input, textarea, select")].filter(inp=>{
          const t=(inp.getAttribute("type")||"text").toLowerCase();
          if(t==="hidden" || t==="submit" || t==="button" || t==="reset" || t==="image") return false;
          if(isHidden(inp, win)) return false;
          return true;
        }).map(inp=>{
          const type=(inp.getAttribute("type")||"text").toLowerCase();
          const placeholder = inp.getAttribute("placeholder") || inp.getAttribute("aria-label") || inp.getAttribute("title") || "";
          const value = inp.getAttribute("value") || "";
          const aria = inp.getAttribute("aria-label") || "";
          let label = placeholder || aria;
          if(!label) { const name = inp.getAttribute("name")||""; if(name && name.length<20 && !name.includes(" ") ) label = name; else label = (type==="search" ? "Search" : "Ara"); }
          const inpStyle = getNodeStyle(inp, win);
          return { type, placeholder: label, value, style: inpStyle, ariaLabel: aria };
        });
        const buttons = [...el.querySelectorAll("button, input[type=submit], input[type=button]")].filter(b=> !isHidden(b, win)).map(b=>{
          const text=getVisibleText(b) || b.getAttribute("value") || b.getAttribute("aria-label") || "";
          if(!text || text.length>60 || text.includes(".") || text.includes("{")) return null;
          const href=b.getAttribute("href")||b.getAttribute("formaction");
          const resolved=href? resolveHref(href, effectiveBase):null;
          const bStyle=getNodeStyle(b, win);
          return { text: text.trim(), href:resolved, style: bStyle };
        }).filter(Boolean);
        if(inputs.length===0 && buttons.length===0){ const t=getVisibleText(el); if(t) pushNode({ type:"paragraph", text:t, color: style.fg, style }); }
        else pushNode({ type:"form", inputs, buttons, style, action: el.getAttribute("action") || "" });
        break;
      }
      case "input": case "textarea": {
        const type=(el.getAttribute("type")||"text").toLowerCase();
        if(type==="hidden") break;
        if(type==="submit" || type==="button") { const text=el.getAttribute("value")||el.getAttribute("aria-label")||type; pushNode({ type:"button", text, color: style.fg, style }); break; }
        const placeholder = el.getAttribute("placeholder") || el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("value") || el.getAttribute("name") || "";
        const label = placeholder || el.getAttribute("aria-label") || type;
        pushNode({ type:"form", inputs:[{type, placeholder: label, value: el.getAttribute("value")||"", style, ariaLabel: el.getAttribute("aria-label")||""}], buttons:[], style });
        break;
      }
      case "button": case "select": {
        const text=getVisibleText(el) || el.getAttribute("value") || el.getAttribute("aria-label") || tag;
        const href=el.getAttribute("href")||el.getAttribute("formaction");
        const resolved=href? resolveHref(href, effectiveBase):null;
        if(resolved) pushNode({ type:"paragraph", inline:[{type:"link", text, href:resolved, id:linkId++, style}], style });
        else {
          // Make button focusable via cursor - assign linkId even without href
          const btnId = linkId++;
          pushNode({ type:"button", text, color: style.fg, style, id: btnId, href: resolved || null });
        }
        break;
      }
      case "ul": case "ol": {
        const isOrdered=tag==="ol";
        let idx=1;
        for(const li of [...el.children].filter(c=>c.tagName.toLowerCase()==="li")){
          if(isHidden(li, win)) continue;
          const liStyle=getNodeStyle(li, win);
          const clr=liStyle.fg || style.fg;
          const inline=decomposeInline(li, liStyle);
          if(inline.length) pushNode({ type:"listItem", ordered:isOrdered, index:idx, inline, style: liStyle });
          else { const t=getVisibleText(li); if(t) pushNode({ type:"listItem", ordered:isOrdered, index:idx, text:t, color: clr, style: liStyle }); }
          idx++;
        }
        break;
      }
      case "li": {
        const inline=decomposeInline(el, style);
        if(inline.length) pushNode({ type:"listItem", ordered:false, index:1, inline, style });
        else { const t=getVisibleText(el); if(t) pushNode({ type:"listItem", ordered:false, index:1, text:t, color: style.fg, style }); }
        break;
      }
      case "nav": {
        const inline=decomposeInline(el, style);
        if(inline.length) pushNode({ type:"nav", inline, style });
        else { const t=getVisibleText(el); if(t) pushNode({ type:"nav", text:t, style }); }
        break;
      }
      case "footer": {
        const inline=decomposeInline(el, style);
        if(inline.length) pushNode({ type:"footer", inline, style });
        else { const t=getVisibleText(el); if(t) pushNode({ type:"footer", text:t, style }); }
        break;
      }
      case "aside": {
        const inline=decomposeInline(el, style);
        if(inline.length) pushNode({ type:"aside", inline, style });
        else { const t=getVisibleText(el); if(t) pushNode({ type:"aside", text:t, style }); }
        break;
      }
      case "figure": {
        const inline=decomposeInline(el, style);
        const caption=el.querySelector("figcaption") ? getVisibleText(el.querySelector("figcaption")) : "";
        if(inline.length) pushNode({ type:"figure", inline, caption, style });
        else { const t=getVisibleText(el); if(t) pushNode({ type:"figure", text:t, caption, style }); }
        break;
      }
      case "header": {
        const inline=decomposeInline(el, style);
        if(inline.length) pushNode({ type:"header", inline, style });
        else { const t=getVisibleText(el); if(t) pushNode({ type:"header", text:t, style }); }
        break;
      }
      case "br": { pushNode({type:"paragraph", text:"", style}); break; }
      case "hr": { pushNode({type:"hr", style}); break; }
      case "div": case "section": case "article": case "main": case "span": case "body": case "fieldset": case "details": case "summary": case "center": case "td": case "th": case "react-app": case "main-app": case "app": {
        const hasBlockChild=[...el.children].some(c=> !isInlineTag(c.tagName.toLowerCase()));
        const alwaysBlock=["div","section","article","main","aside","figure","header","footer","nav","center","table","tbody","thead","tfoot","tr","body","react-app","main-app","app"].includes(tag);
        const isStyledCard = style.bg || style.border || (style.padding && style.padding.some(v=>v>0)) || (style.margin && style.margin.some(v=>v>1));
        if(isStyledCard && !hasBlockChild && el.children.length===0){
          const inline=decomposeInline(el, style);
          if(inline.length){ pushNode({ type:"card", inline, text: inline.map(p=>p.text).join(" "), style }); }
          else { const t=getVisibleText(el); if(t) pushNode({ type:"card", text:t, style }); }
          break;
        }
        if((hasBlockChild || alwaysBlock) && el.children.length>0){
          for(const child of [...el.children]) walk(child);
        } else {
          const inline=decomposeInline(el, style);
          if(inline.length){ const txtJoin=inline.map(p=>p.text).join(" ").trim(); if(txtJoin) pushNode({ type: isStyledCard?"card":"paragraph", inline, text: txtJoin, style }); }
          else { const t=getVisibleText(el); if(t) pushNode({ type: isStyledCard?"card":"paragraph", text:t, color: style.fg, style }); }
        }
        break;
      }
      case "table": case "tbody": case "thead": case "tfoot": {
        const isInsideCenter=!!el.closest("center");
        const directRows=[...el.querySelectorAll(":scope > tr, :scope > tbody > tr")];
        const allTrs=[...el.querySelectorAll("tr")].slice(0,120);
        const isLayout=isInsideCenter || (directRows.length>6 && !el.querySelector("th")) || (allTrs.length>12 && !el.querySelector("th") && directRows.length===0);
        if(isLayout && (directRows.length>2 || allTrs.length>3)){
          let emitted=0;
          const rowsToEmit = directRows.length? directRows : allTrs;
          for(const tr of rowsToEmit.slice(0,80)){
            if(isHidden(tr, win)) continue;
            const trStyle=getNodeStyle(tr, win);
            const inline=decomposeInline(tr, trStyle);
            let effectiveInline=inline;
            if(effectiveInline.length===0){
              for(const td of tr.querySelectorAll(":scope > td, :scope > th")){
                if(isHidden(td, win)) continue;
                const tdStyle=getNodeStyle(td, win);
                const tdInline=decomposeInline(td, tdStyle);
                if(tdInline.length) effectiveInline.push(...tdInline);
              }
              if(effectiveInline.length===0){
                for(const td of tr.querySelectorAll("td")){
                  const tdInline=decomposeInline(td, trStyle);
                  if(tdInline.length) effectiveInline.push(...tdInline);
                }
              }
            }
            if(effectiveInline.length){
              const txt=effectiveInline.map(p=>p.text).join(" ").trim();
              if(txt.length>10){ pushNode({ type:"paragraph", inline:effectiveInline, style: trStyle }); emitted++; if(emitted>60) break; }
            }
          }
          if(emitted>0) break;
        }
        const rows=[];
        for(const tr of el.querySelectorAll(":scope > tr, :scope > thead > tr, :scope > tbody > tr, :scope > tfoot > tr")){
          const cells=[...tr.children].filter(c=> ["td","th"].includes(c.tagName.toLowerCase())).map((c)=>{
            const st=getNodeStyle(c, win);
            const inl=decomposeInline(c, st);
            if(inl.length) return inl.map(p=>p.text).join(" ");
            return getVisibleText(c);
          });
          if(cells.some(c=>c)) rows.push(cells);
        }
        if(rows.length===0){
          for(const tr of el.querySelectorAll("tr")){
            const cells=[...tr.querySelectorAll("th, td")].map((c)=>{
              const st=getNodeStyle(c, win);
              const inl=decomposeInline(c, st);
              if(inl.length) return inl.map(p=>p.text).join(" ");
              return getVisibleText(c);
            });
            if(cells.some(c=>c)) rows.push(cells);
          }
        }
        if(rows.length && rows.length<60) pushNode({ type:"table", rows, style });
        else if(rows.length){ for(let i=0;i<rows.length;i+=20) pushNode({ type:"table", rows: rows.slice(i,i+20), style }); }
        else {
          const inline=decomposeInline(el, style);
          if(inline.length) pushNode({ type:"paragraph", inline, style });
          else { const t=getVisibleText(el); if(t) pushNode({ type:"paragraph", text:t, color: style.fg, style }); }
        }
        break;
      }
      case "tr": {
        const cells=[...el.children].filter(c=> ["td","th"].includes(c.tagName.toLowerCase())).map(c=> getVisibleText(c));
        if(cells.some(c=>c)) pushNode({ type:"table", rows:[cells], style });
        else { const inline=decomposeInline(el, style); if(inline.length) pushNode({type:"paragraph", inline, style}); }
        break;
      }
      case "code": { const t=getVisibleText(el); if(t) pushNode({ type:"paragraph", text:t, color: style.fg, style, code:true }); break; }
      default: {
        const inline=decomposeInline(el, style);
        if(inline.length && inline.join("").length < 1000) pushNode({ type:"paragraph", inline, style });
        else {
          if(el.children.length===0){ const t=getVisibleText(el); if(t) pushNode({ type:"paragraph", text:t, color: style.fg, style }); }
          else for(const child of [...el.children]) walk(child);
        }
        break;
      }
    }
  }
  walk(root);
  const hasContent=nodes.some(n=> n.type!=="siteHeader" && n.type!=="challenge");
  if(!hasContent && root !== doc.body){ for(const child of [...doc.body.children]) walk(child); }
  if(!nodes.some(n=> n.type!=="siteHeader" && n.type!=="challenge")){
    const allLinks=[...doc.querySelectorAll("a[href]")].slice(0,100).map((a)=>{
      const href=resolveHref(a.getAttribute("href"), effectiveBase);
      const text=getVisibleText(a);
      if(href && text) return { type:"paragraph", inline:[{type:"link", text, href, id:linkId++}], style:{} };
      return null;
    }).filter(Boolean);
    if(allLinks.length) nodes.push(...allLinks);
    const bodyText=getVisibleText(doc.body);
    if(bodyText){ const chunks=bodyText.split(/\s{2,}|\n+/).filter(s=>s.trim().length>20).slice(0,30); for(const c of chunks) nodes.push({ type:"paragraph", text:c.trim().slice(0,800), style:{} }); }
  }
  if(!hasContent){
    const forms=[...doc.querySelectorAll("form")];
    for(const f of forms){
      const fStyle=getNodeStyle(f, win);
      const inputs=[...f.querySelectorAll("input")].filter(inp=> (inp.getAttribute("type")||"text")!=="hidden" && !isHidden(inp, win)).map(inp=>{
        const type=(inp.getAttribute("type")||"text").toLowerCase();
        if(type==="submit"||type==="button"||type==="reset") return null;
        const ph=inp.getAttribute("placeholder")||inp.getAttribute("aria-label")||inp.getAttribute("title")||"";
        return { type, placeholder: ph|| (type==="search"?"Search":""), value: inp.getAttribute("value")||"", style: getNodeStyle(inp, win), ariaLabel: inp.getAttribute("aria-label")||"" };
      }).filter(Boolean);
      if(inputs.length) nodes.push({ type:"form", inputs, buttons:[], style: fStyle, action: f.getAttribute("action")||"" });
    }
  }
  const filtered=[];
  let prevText="";
  for(const n of nodes){
    if(["table","hr","siteHeader","challenge","form","card","nav","footer","aside","figure","header"].includes(n.type)) {
      // Filter CSS garbage inside card/nav etc.
      const txtCheck = (n.text || (n.inline? n.inline.map(p=>p.text).join(" "): ""));
      if(txtCheck && txtCheck.includes("{") && txtCheck.includes("}") && txtCheck.includes(";") && txtCheck.includes(".")){
        // looks like CSS code, skip
        continue;
      }
      filtered.push(n);
      continue;
    }
    let txt=n.text || (n.inline? n.inline.map(p=>p.text).join(" ") : "");
    if(n.type==="table" && n.rows) txt=n.rows.flat().join(" ");
    txt=(txt||"").trim();
    if(!txt) continue;
    // Filter CSS garbage: looks like CSS code
    if(txt.includes("{") && txt.includes("}") && txt.includes(";") && (txt.includes(".") || txt.includes("@")) && txt.length>30 && txt.split(";").length>3) continue;
    if(txt===prevText) continue;
    prevText=txt;
    filtered.push(n);
  }
  if(filtered.length===0 && nodes.length) return nodes;
  return filtered;
}
