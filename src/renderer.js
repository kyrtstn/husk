import { wordWrap } from "./utils.js";

function escapeBlessed(str) {
  return String(str).replace(/\{/g, "\\{").replace(/\}/g, "\\}");
}

function styleToTags(style) {
  let open = "", close = "";
  if (!style) return { open, close };
  if (style.bold) { open += "{bold}"; close = "{/bold}" + close; }
  if (style.italic) { open += "{italic}"; close = "{/italic}" + close; }
  if (style.underline) { open += "{underline}"; close = "{/underline}" + close; }
  if (style.fg) { open += `{${style.fg}-fg}`; close = `{/${style.fg}-fg}` + close; }
  if (style.bg) { open += `{${style.bg}-bg}`; close = `{/${style.bg}-bg}` + close; }
  return { open, close };
}

function styleOpen(p) {
  let s = "";
  if (p.bold) s += "{bold}";
  if (p.italic) s += "{italic}";
  if (p.underline) s += "{underline}";
  if (p.code) s += "{green-fg}";
  if (p.color) s += `{${p.color}-fg}`;
  else if (p.style?.fg) s += `{${p.style.fg}-fg}`;
  if (p.style?.bg) s += `{${p.style.bg}-bg}`;
  if (p.style?.bold) s += "{bold}";
  if (p.style?.italic) s += "{italic}";
  if (p.style?.underline) s += "{underline}";
  return s;
}
function styleClose(p) {
  let s = "";
  if (p.style?.underline) s += "{/underline}";
  if (p.style?.italic) s += "{/italic}";
  if (p.style?.bold) s += "{/bold}";
  if (p.style?.bg) s += `{/${p.style.bg}-bg}`;
  if (p.color) s += `{/${p.color}-fg}`;
  else if (p.style?.fg) s += `{/${p.style.fg}-fg}`;
  if (p.underline) s += "{/underline}";
  if (p.italic) s += "{/italic}";
  if (p.bold) s += "{/bold}";
  if (p.code) s += "{/green-fg}";
  return s;
}

function linkTags(isFocused, p) {
  if (isFocused) return { open: "{inverse}{yellow-fg}{bold}", close: "{/bold}{/yellow-fg}{/inverse}" };
  // Honor style but default cyan
  const fg = p.style?.fg || p.color || "cyan";
  return { open: `{underline}{${fg}-fg}`, close: `{/${fg}-fg}{/underline}` };
}

function wrapInline(inline, width, cursorId) {
  const targetId = cursorId;
  const tokens = [];
  for (const p of inline) {
    if (p.text === "\n") { tokens.push({ text: "\n", isNewline: true, src: p }); continue; }
    const words = p.text.split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    for (const w of words) tokens.push({ text: w, src: p });
  }
  const lines = [];
  let cur = ""; let curLen = 0;
  const linkLineMap = new Map();
  function flush(){ if(cur!==""||lines.length===0) lines.push(cur); cur=""; curLen=0; }
  for (const tok of tokens) {
    if (tok.isNewline) { flush(); continue; }
    const p = tok.src;
    const isLink = p.type === "link";
    const isFocused = isLink && p.id === targetId;
    let taggedWord;
    if (isLink) {
      const { open, close } = linkTags(isFocused, p);
      taggedWord = `${open}${escapeBlessed(tok.text)}${close}`;
    } else {
      taggedWord = `${styleOpen(p)}${escapeBlessed(tok.text)}${styleClose(p)}`;
    }
    const vlen = tok.text.length;
    const sepLen = curLen>0?1:0;
    if (curLen + sepLen + vlen > width) {
      if (cur) lines.push(cur);
      cur = taggedWord; curLen = vlen;
      if (isLink && !linkLineMap.has(p.id)) linkLineMap.set(p.id, lines.length);
    } else {
      cur = cur ? cur + " " + taggedWord : taggedWord;
      curLen += sepLen + vlen;
      if (isLink && !linkLineMap.has(p.id)) linkLineMap.set(p.id, lines.length);
    }
  }
  if (cur) lines.push(cur);
  if (!lines.length) lines.push("");
  if (targetId !== -999 && targetId !== -1 && targetId !== undefined) {
    const idx = linkLineMap.get(targetId);
    if (idx!==undefined && idx < lines.length) {
      lines[idx] = `{inverse}{yellow-fg}{bold} ▸ {/yellow-fg}{/bold}{/inverse} ` + lines[idx];
    }
  }
  const links=[];
  for(const [id,off] of linkLineMap){
    const src=inline.find(p=>p.type==="link"&&p.id===id);
    if(src) links.push({id, href:src.href, text:src.text, lineOffset:off});
  }
  return { lines, links };
}

const headingStyles = {
  1: { fg: "cyan",    prefix: "◈ ", deco: "━", bold: true, underline: true },
  2: { fg: "magenta", prefix: "▣ ", deco: "─", bold: true },
  3: { fg: "yellow",  prefix: "◆ ", deco: "·", bold: true },
  4: { fg: "green",   prefix: "▸ ", deco: "",  bold: true },
  5: { fg: "white",   prefix: "• ", deco: "",  bold: false },
  6: { fg: "gray",    prefix: "· ", deco: "",  bold: false },
};

function applyBlockStyle(text, style, width) {
  if (!style) return text;
  const { open, close } = styleToTags(style);
  if (open) return `${open}${text}${close}`;
  return text;
}

function renderBorder(contentLines, style, width) {
  if (!style || !style.border) return contentLines;
  const borderColor = style.border.color || "gray";
  const w = Math.min(width, 60);
  const top = `{${borderColor}-fg}┌${"─".repeat(w)}┐{/${borderColor}-fg}`;
  const bottom = `{${borderColor}-fg}└${"─".repeat(w)}┘{/${borderColor}-fg}`;
  const bg = style.bg ? `{${style.bg}-bg}` : "";
  const bgClose = style.bg ? `{/${style.bg}-bg}` : "";
  const lines = [top];
  for (const l of contentLines) {
    // Apply bg to content line
    const inner = bg ? `${bg}${l}${bgClose}` : l;
    lines.push(`{${borderColor}-fg}│{/${borderColor}-fg} ${inner} {${borderColor}-fg}│{/${borderColor}-fg}`);
  }
  lines.push(bottom);
  return lines;
}

export function renderContent(nodes, { width = 80, cursorId = -1, useCursorIndex = false } = {}) {
  const effectiveWidth = Math.max(32, width - 2);
  let lines = []; let links = []; let lineIndex = 0;
  const globalOrderedIds=[]; const seenGlobal=new Set();
  for(const n of nodes){
    if(n.inline) for(const p of n.inline) if(p.type==="link"&&!seenGlobal.has(p.id)){ seenGlobal.add(p.id); globalOrderedIds.push(p.id);}
    if(n.type==="form" && n.inputs) {
      for(const inp of n.inputs) {
        // forms have no links but preserve?
      }
    }
  }
  let globalTargetId=cursorId;
  if(typeof cursorId==="number"&&cursorId>=0){
    if(!seenGlobal.has(cursorId)&&cursorId<globalOrderedIds.length) globalTargetId=globalOrderedIds[cursorId];
    else if(seenGlobal.has(cursorId)&&useCursorIndex && cursorId<globalOrderedIds.length) globalTargetId=globalOrderedIds[cursorId];
  }
  const push = s => { lines.push(s); lineIndex++; };
  const pushEmpty = () => { lines.push(""); lineIndex++; };
  const pushWithSpacing = (contentLines, style) => {
    // margin top
    const mt = style?.margin ? style.margin[0] : 0;
    const mb = style?.margin ? style.margin[2] : 0;
    for(let i=0;i<mt;i++) pushEmpty();
    for(const l of contentLines) push(l);
    for(let i=0;i<mb;i++) pushEmpty();
  };
  const hrDecor = (w) => {
    const pat = "─";
    const mid = " ◇ ";
    const total = Math.min(w, 56);
    const left = pat.repeat(Math.floor((total-mid.length)/2));
    const right = pat.repeat(Math.ceil((total-mid.length)/2));
    return `{gray-fg}${left}{/gray-fg}{yellow-fg}${mid}{/yellow-fg}{gray-fg}${right}{/gray-fg}`;
  };

  for(const node of nodes){
    const style = node.style || {};
    // handle position label for absolute/fixed
    const posLabel = style.position && style.position!=="static" ? ` {gray-fg}[${style.position}]{\/gray-fg}` : "";
    switch(node.type){
      case "siteHeader": {
        const w = effectiveWidth;
        const title = node.text || "Untitled";
        const desc = node.desc || "";
        const url = node.url || "";
        const headerStyle = style.bg ? style : { bg: null, fg: "cyan", bold:true };
        push(`{cyan-fg}╔${"═".repeat(Math.min(w, 60))}╗{/cyan-fg}`);
        const tLine = ` ♔ ${title} `;
        const pad = Math.max(0, Math.floor((Math.min(w,60)-tLine.length)/2));
        push(`{cyan-fg}║{/cyan-fg}${" ".repeat(pad)}{bold}{cyan-fg}${escapeBlessed(tLine)}{/cyan-fg}{/bold}${" ".repeat(Math.max(0,Math.min(w,60)-pad-tLine.length))}{cyan-fg}║{/cyan-fg}`);
        push(`{cyan-fg}╚${"═".repeat(Math.min(w, 60))}╝{/cyan-fg}`);
        if(desc){
          const w2 = wordWrap(desc, effectiveWidth).split("\n");
          for(const wl of w2) push(`{gray-fg}{italic} ${escapeBlessed(wl)} {/italic}{/gray-fg}`);
        }
        if(url){
          const short = url.length> (w-4) ? url.slice(0,w-7)+"..." : url;
          push(`{gray-fg}↳ ${escapeBlessed(short)}{/gray-fg}`);
        }
        pushEmpty();
        push(hrDecor(w));
        pushEmpty();
        break;
      }
      case "challenge": {
        push(`{black-bg}{red-fg}{bold} ⚠  Protected Site {/bold}{/red-fg}{/black-bg}`);
        push(`{red-fg}┌${"─".repeat(effectiveWidth-2)}┐{/red-fg}`);
        const msg = node.text;
        for(const l of wordWrap(msg, effectiveWidth-4).split("\n")) push(`{red-fg}│{/red-fg} {yellow-fg}${escapeBlessed(l)}{/yellow-fg}`);
        push(`{gray-fg}  Try a text-friendly alternative or open in desktop browser.{/gray-fg}`);
        push(`{red-fg}└${"─".repeat(effectiveWidth-2)}┘{/red-fg}`);
        pushEmpty();
        break;
      }
      case "card": {
        // Card with CSS fidelity: bg, border, padding
        const txt = node.text || (node.inline? node.inline.map(p=>p.text).join(" ") : "");
        const inline = node.inline || [];
        const pad = style.padding ? style.padding[1] : 1;
        const w = effectiveWidth - (style.padding? style.padding[1]+style.padding[3]:2) - 2;
        const borderColor = style.border?.color || (style.bg ? style.bg : "gray");
        if(inline.length){
          const base=lineIndex;
          // If card has bg, we need to render its content with bg
          const {lines:wLines, links:lns}=wrapInline(inline, w, globalTargetId);
          const contentLines = wLines;
          // Add card border if styled
          if(style.border || style.bg){
            push(`{${borderColor}-fg}┌${"─".repeat(Math.min(w+2, effectiveWidth-2))}┐{/${borderColor}-fg}`);
            for(const l of contentLines){
              const bgOpen = style.bg ? `{${style.bg}-bg}` : "";
              const bgClose = style.bg ? `{/${style.bg}-bg}` : "";
              push(`{${borderColor}-fg}│{/${borderColor}-fg} ${bgOpen}${l}${bgClose} {${borderColor}-fg}│{/${borderColor}-fg}`);
            }
            push(`{${borderColor}-fg}└${"─".repeat(Math.min(w+2, effectiveWidth-2))}┘{/${borderColor}-fg}`);
            // adjust links
            for(const l of lns) links.push({id:l.id, href:l.href, text:l.text, line: base+1 + l.lineOffset});
          } else {
            for(const l of contentLines) push(l);
            for(const l of lns) links.push({id:l.id, href:l.href, text:l.text, line: base + l.lineOffset});
          }
        } else {
          const wrapped=wordWrap(txt, w).split("\n");
          if(style.border || style.bg){
            push(`{${borderColor}-fg}┌${"─".repeat(Math.min(w+2, effectiveWidth-2))}┐{/${borderColor}-fg}`);
            for(const wl of wrapped) {
              const bgOpen = style.bg ? `{${style.bg}-bg}` : "";
              const bgClose = style.bg ? `{/${style.bg}-bg}` : "";
              push(`{${borderColor}-fg}│{/${borderColor}-fg} ${bgOpen}${escapeBlessed(wl)}${bgClose} {${borderColor}-fg}│{/${borderColor}-fg}`);
            }
            push(`{${borderColor}-fg}└${"─".repeat(Math.min(w+2, effectiveWidth-2))}┘{/${borderColor}-fg}`);
          } else {
            for(const wl of wrapped) push(escapeBlessed(wl));
          }
        }
        pushEmpty();
        break;
      }
      case "form": {
        // Beautiful form rendering with true CSS fidelity for every site, not just Turkish Google
        const w = effectiveWidth;
        const action = node.action || "";
        push(`{cyan-fg}┌─ {white-fg}form{/white-fg} ${action? `{gray-fg}${escapeBlessed(action.slice(0,30))}{/gray-fg}`:""} ─┐{/cyan-fg}`);
        const formStyle = style;
        for(const inp of node.inputs){
          const inpStyle = inp.style || {};
          const placeholder = inp.placeholder || inp.ariaLabel || "Search";
          const isSearch = inp.type==="search" || inp.type==="text" || placeholder.toLowerCase().includes("ara") || placeholder.toLowerCase().includes("search");
          const icon = isSearch ? "🔍 " : "▸ ";
          const ph = placeholder || "Enter text";
          // Input box with CSS fidelity: bg, border, padding
          const bg = inpStyle.bg || formStyle.bg || "white";
          const fg = inpStyle.fg || "black";
          const borderColor = inpStyle.border?.color || "gray";
          const inboxWidth = Math.min(w-6, 40);
          const displayText = ph.length > inboxWidth-4 ? ph.slice(0,inboxWidth-7)+"..." : ph;
          const padded = displayText.padEnd(inboxWidth-4, " ");
          // Render input as boxed field
          push(`{${borderColor}-fg}│{/gray-fg} {${borderColor}-fg}┌${"─".repeat(inboxWidth)}┐{/${borderColor}-fg}`);
          push(`{${borderColor}-fg}│{/gray-fg} {${borderColor}-fg}│{/${borderColor}-fg} {${bg}-bg}{${fg}-fg} ${icon}${escapeBlessed(padded)} {/${fg}-fg}{/${bg}-bg}{${borderColor}-fg}│{/${borderColor}-fg}`);
          push(`{${borderColor}-fg}│{/gray-fg} {${borderColor}-fg}└${"─".repeat(inboxWidth)}┘{/${borderColor}-fg}`);
        }
        if(node.buttons && node.buttons.length){
          let btnLine = "";
          for(const b of node.buttons){
            const bStyle = b.style || {};
            const bg = bStyle.bg || "blue";
            const fg = bStyle.fg || "white";
            const txt = b.text || "Submit";
            btnLine += ` {${bg}-bg}{${fg}-fg}  ${escapeBlessed(txt)}  {/${fg}-fg}{/${bg}-bg}  `;
          }
          // Wrap button line
          const btnWrapped = wordWrap(btnLine.replace(/\{[^}]+\}/g,""), w-4).split("\n");
          // Need to keep tags, so render directly
          push(`{gray-fg}│{/gray-fg} ${btnLine.trim()}`);
        }
        push(`{cyan-fg}└${"─".repeat(w-2)}┘{/cyan-fg}`);
        pushEmpty();
        break;
      }
      case "heading": {
        const level = Math.min(6, Math.max(1, node.level||1));
        const sty = headingStyles[level];
        let fg = style.fg || sty.fg;
        const isStyled = style.fg || style.bg;
        const raw = `${sty.prefix}${node.text}`;
        // Handle textAlign from CSS
        let wrapped = wordWrap(raw, effectiveWidth).split("\n");
        if(style.align==="center"){
          wrapped = wrapped.map(l=>{
            const pad = Math.max(0, Math.floor((effectiveWidth - l.length)/2));
            return " ".repeat(pad)+l;
          });
        } else if(style.align==="right"){
          wrapped = wrapped.map(l=> " ".repeat(Math.max(0, effectiveWidth - l.length)) + l);
        }
        if(level===1 && !isStyled){
          push(`{${fg}-fg}${"━".repeat(Math.min(effectiveWidth, 50))}{/${fg}-fg}`);
        }
        // Apply bg if present
        const bgPart = style.bg ? `{${style.bg}-bg}` : "";
        const bgClose = style.bg ? `{/${style.bg}-bg}` : "";
        for(const w of wrapped){
          const open = `{bold}{${fg}-fg}` + bgPart + (sty.underline? "{underline}": "");
          const close = (sty.underline? "{/underline}":"") + bgClose + `{/${fg}-fg}{/bold}`;
          let line = `${open}${escapeBlessed(w)}${close}`;
          // Apply padding/margin as spacing
          if(style.padding) line = " ".repeat(style.padding[3]) + line;
          push(line);
        }
        if(level===1 && !isStyled){
          push(`{${fg}-fg}${"━".repeat(Math.min(effectiveWidth, 50))}{/${fg}-fg}`);
        } else if(level===2 && !isStyled){
          push(`{gray-fg}${"─".repeat(Math.min(effectiveWidth, 36))}{/gray-fg}`);
        }
        // Margin bottom
        const mb = style.margin ? style.margin[2] : 0;
        for(let i=0;i<mb;i++) pushEmpty();
        pushEmpty();
        break;
      }
      case "paragraph": {
        if(node.inline && node.inline.length){
          const isStoryCard = /^\d+\.$/.test((node.inline[0]?.text || "").trim()) && node.inline.some(p=>p.type==="link");
          const base=lineIndex;
          if(isStoryCard){
            const num = node.inline[0].text.trim();
            push(`{gray-fg}┌─ {yellow-fg}${escapeBlessed(num)}{/yellow-fg} ─┐{/gray-fg}`);
          }
          // Apply style width adjustment for padding
          const padLeft = style.padding ? style.padding[3] : 0;
          const padRight = style.padding ? style.padding[1] : 0;
          const w = effectiveWidth - padLeft - padRight - (isStoryCard?4:0);
          const marginTop = style.margin ? style.margin[0] : 0;
          const marginBottom = style.margin ? style.margin[2] : 0;
          for(let i=0;i<marginTop;i++) pushEmpty();
          const {lines:wLines, links:lns}=wrapInline(node.inline.slice(isStoryCard?1:0), w, globalTargetId);
          const bgOpen = style.bg ? `{${style.bg}-bg}` : "";
          const bgClose = style.bg ? `{/${style.bg}-bg}` : "";
          const fgOpen = style.fg ? `{${style.fg}-fg}` : "";
          const fgClose = style.fg ? `{/${style.fg}-fg}` : "";
          for(const l of wLines){
            let out = l;
            // Apply bg/fg for paragraph block
            if(style.bg || style.fg){
              out = `${bgOpen}${fgOpen}${l}${fgClose}${bgClose}`;
            }
            // Apply textAlign
            if(style.align==="center"){
              const stripped = out.replace(/\{[^}]+\}/g,"");
              const pad = Math.max(0, Math.floor((effectiveWidth - stripped.length)/2));
              out = " ".repeat(pad) + out;
            } else if(style.align==="right"){
              const stripped = out.replace(/\{[^}]+\}/g,"");
              const pad = Math.max(0, effectiveWidth - stripped.length);
              out = " ".repeat(pad) + out;
            }
            if(padLeft) out = " ".repeat(padLeft) + out;
            if(isStoryCard) push(`{gray-fg}│{/gray-fg} ${out}`);
            else push(out);
          }
          if(isStoryCard) push(`{gray-fg}└${"─".repeat(Math.min(w, 40))}┘{/gray-fg}`);
          const offset = isStoryCard ? 1 : 0;
          for(const l of lns) links.push({id:l.id, href:l.href, text:l.text, line: base + offset + l.lineOffset + marginTop});
          for(let i=0;i<marginBottom;i++) pushEmpty();
          pushEmpty();
        } else {
          // Plain text with style
          const txt = node.text || "";
          const padLeft = style.padding ? style.padding[3] : 0;
          const marginTop = style.margin ? style.margin[0] : 0;
          const marginBottom = style.margin ? style.margin[2] : 0;
          for(let i=0;i<marginTop;i++) pushEmpty();
          const bgOpen = style.bg ? `{${style.bg}-bg}` : "";
          const bgClose = style.bg ? `{/${style.bg}-bg}` : "";
          const fgOpen = style.fg ? `{${style.fg}-fg}` : (node.color? `{${node.color}-fg}`: "");
          const fgClose = style.fg ? `{/${style.fg}-fg}` : (node.color? `{/${node.color}-fg}`: "");
          let wrapped = wordWrap(txt, effectiveWidth - padLeft).split("\n");
          if(style.align==="center") wrapped = wrapped.map(l=> " ".repeat(Math.max(0, Math.floor((effectiveWidth - l.length)/2))) + l);
          for(const w of wrapped) push(`${" ".repeat(padLeft)}${bgOpen}${fgOpen}${escapeBlessed(w)}${fgClose}${bgClose}`);
          for(let i=0;i<marginBottom;i++) pushEmpty();
          pushEmpty();
        }
        break;
      }
      case "pre": {
        const text = node.text || (node.inline? node.inline.map(p=>p.text).join(" "): "");
        const borderColor = style.border?.color || "gray";
        const bg = style.bg || null;
        push(`{${borderColor}-fg}┌─ {green-fg}code{/green-fg} ${"─".repeat(Math.max(0,effectiveWidth-9))}┐{/${borderColor}-fg}`);
        for(const rl of text.split("\n")){
          const wrapped=wordWrap(rl||" ", effectiveWidth-4).split("\n");
          for(const w of wrapped){
            const bgOpen = bg ? `{${bg}-bg}` : "";
            const bgClose = bg ? `{/${bg}-bg}` : "";
            push(`{${borderColor}-fg}│{/${borderColor}-fg} ${bgOpen}{green-fg}${escapeBlessed(w)}{/green-fg}${bgClose}`);
          }
        }
        push(`{${borderColor}-fg}└${"─".repeat(effectiveWidth-2)}┘{/${borderColor}-fg}`);
        pushEmpty();
        break;
      }
      case "blockquote": {
        const inline=node.inline || [{type:"text", text:node.text}];
        const base=lineIndex;
        const borderColor = style.border?.color || "yellow";
        const w = effectiveWidth - 6 - (style.padding? style.padding[1]+style.padding[3]:0);
        const {lines:wLines, links:lns}=wrapInline(inline, w, globalTargetId);
        push(`{${borderColor}-fg}┌─ {gray-fg}quote{/gray-fg} ─┐{/${borderColor}-fg}`);
        for(const l of wLines){
          const bgOpen = style.bg ? `{${style.bg}-bg}` : "";
          const bgClose = style.bg ? `{/${style.bg}-bg}` : "";
          push(`{${borderColor}-fg}┃{/${borderColor}-fg} ${bgOpen}{gray-fg}{italic}${l}{/italic}{/gray-fg}${bgClose}`);
        }
        push(`{${borderColor}-fg}└${"─".repeat(Math.min(effectiveWidth-2,28))}┘{/${borderColor}-fg}`);
        for(const l of lns) links.push({id:l.id, href:l.href, text:l.text, line: base+1 + l.lineOffset});
        pushEmpty();
        break;
      }
      case "listItem": {
        const bullet = node.ordered ? `{yellow-fg}${node.index}.{/yellow-fg}` : `{cyan-fg}●{/cyan-fg}`;
        const prefixLen = node.ordered ? String(node.index).length+2 : 2;
        const avail = effectiveWidth - prefixLen -1 - (style.padding? style.padding[1]+style.padding[3]:0);
        if(node.inline && node.inline.length){
          const base=lineIndex;
          const {lines:wLines, links:lns}=wrapInline(node.inline, avail, globalTargetId);
          const bgOpen = style.bg ? `{${style.bg}-bg}` : "";
          const bgClose = style.bg ? `{/${style.bg}-bg}` : "";
          wLines.forEach((l,idx)=>{
            const pref = idx===0 ? `${bullet} ` : " ".repeat(prefixLen+1);
            push(bgOpen + pref + l + bgClose);
          });
          for(const l of lns) links.push({id:l.id, href:l.href, text:l.text, line: base + l.lineOffset});
        } else {
          const txt = node.text || "";
          const colOpen = style.fg? `{${style.fg}-fg}`: (node.color? `{${node.color}-fg}`:"");
          const colClose = style.fg? `{/${style.fg}-fg}`: (node.color? `{/${node.color}-fg}`:"");
          const wrapped=wordWrap(txt, avail).split("\n");
          wrapped.forEach((w,i)=>{
            const pref=i===0? `${bullet} ` : " ".repeat(prefixLen+1);
            push(`${colOpen}${pref}${escapeBlessed(w)}${colClose}`);
          });
        }
        pushEmpty();
        break;
      }
      case "table": {
        const rows=node.rows;
        const borderColor = style.border?.color || style.fg || "cyan";
        const colCount=Math.max(...rows.map(r=>r.length));
        const colWidths=Array(colCount).fill(0);
        for(const row of rows) row.forEach((cell,i)=> colWidths[i]=Math.max(colWidths[i], Math.min(cell.length, 28)));
        let total=colWidths.reduce((a,b)=>a+b,0)+(colCount-1)*3;
        if(total>effectiveWidth){
          const scale=(effectiveWidth-(colCount-1)*3)/colWidths.reduce((a,b)=>a+b,0);
          for(let i=0;i<colWidths.length;i++) colWidths[i]=Math.max(6, Math.floor(colWidths[i]*scale));
        }
        const top = "┌" + colWidths.map(w=>"─".repeat(w+2)).join("┬") + "┐";
        const mid = "├" + colWidths.map(w=>"─".repeat(w+2)).join("┼") + "┤";
        const bot = "└" + colWidths.map(w=>"─".repeat(w+2)).join("┴") + "┘";
        push(`{${borderColor}-fg}${top}{/${borderColor}-fg}`);
        rows.forEach((row,rIdx)=>{
          const isHeader=rIdx===0;
          const cells=row.map((c,i)=>{
            const w=colWidths[i]||10;
            let v=c.slice(0,w).padEnd(w," ");
            return isHeader ? `{bold}{white-fg}${escapeBlessed(v)}{/white-fg}{/bold}` : escapeBlessed(v);
          });
          const inner = cells.map((c,i)=> ` ${c} `).join(`{${borderColor}-fg}│{/${borderColor}-fg}`);
          const bg = isHeader? (style.bg? `{${style.bg}-bg}`:"{blue-bg}") : (style.bg? `{${style.bg}-bg}`:"");
          const bgClose = isHeader || style.bg ? (style.bg? `{/${style.bg}-bg}`:"{/blue-bg}") : "";
          // Fix bgClose logic
          const headerBg = isHeader ? (style.bg ? `{${style.bg}-bg}` : "{blue-bg}") : (style.bg ? `{${style.bg}-bg}` : "");
          const headerBgClose = isHeader ? (style.bg ? `{/${style.bg}-bg}` : "{/blue-bg}") : (style.bg ? `{/${style.bg}-bg}` : "");
          if(isHeader) push(`{${borderColor}-fg}│{/${borderColor}-fg}${headerBg}${inner}${headerBgClose}{${borderColor}-fg}│{/${borderColor}-fg}`);
          else push(`{${borderColor}-fg}│{/${borderColor}-fg}${inner}{${borderColor}-fg}│{/${borderColor}-fg}`);
          if(isHeader) push(`{${borderColor}-fg}${mid}{/${borderColor}-fg}`);
        });
        push(`{${borderColor}-fg}${bot}{/${borderColor}-fg}`);
        pushEmpty();
        break;
      }
      case "nav": {
        // Beautiful horizontal nav - like site's top bar
        const inline = node.inline || [];
        const bg = style.bg ? `{${style.bg}-bg}` : "{black-bg}";
        const bgClose = style.bg ? `{/${style.bg}-bg}` : "{/black-bg}";
        const fg = style.fg || "cyan";
        if(inline.length){
          const base=lineIndex;
          const navWidth = effectiveWidth - 4;
          const {lines:wLines, links:lns}=wrapInline(inline, navWidth, globalTargetId);
          push(`${bg}{${fg}-fg}┌${"─".repeat(navWidth+2)}┐{/${fg}-fg}${bgClose}`);
          for(const l of wLines){
            push(`${bg}{${fg}-fg}│{/${fg}-fg}${bg} ${l} {/${fg}-fg}${bgClose}${bg}{${fg}-fg}│{/${fg}-fg}${bgClose}`);
          }
          push(`${bg}{${fg}-fg}└${"─".repeat(navWidth+2)}┘{/${fg}-fg}${bgClose}`);
          for(const l of lns) links.push({id:l.id, href:l.href, text:l.text, line: base+1 + l.lineOffset});
        } else {
          const txt=node.text||"";
          for(const w of wordWrap(txt, effectiveWidth-4).split("\n")) push(`{${fg}-fg}${escapeBlessed(w)}{/${fg}-fg}`);
        }
        pushEmpty();
        break;
      }
      case "footer": {
        const inline=node.inline || [];
        const fg=style.fg||"gray";
        push(`{${fg}-fg}${"━".repeat(effectiveWidth)}{/${fg}-fg}`);
        if(inline.length){
          const base=lineIndex;
          const {lines:wLines, links:lns}=wrapInline(inline, effectiveWidth, globalTargetId);
          for(const l of wLines) push(`{${fg}-fg}${l}{/${fg}-fg}`);
          for(const l of lns) links.push({id:l.id, href:l.href, text:l.text, line: base + l.lineOffset});
        } else {
          const txt=node.text||"";
          for(const w of wordWrap(txt, effectiveWidth).split("\n")) push(`{${fg}-fg}${escapeBlessed(w)}{/${fg}-fg}`);
        }
        push(`{${fg}-fg}${"━".repeat(effectiveWidth)}{/${fg}-fg}`);
        pushEmpty();
        break;
      }
      case "aside": {
        const inline=node.inline || [];
        const borderColor=style.border?.color || style.fg || "yellow";
        const bg=style.bg ? `{${style.bg}-bg}` : "";
        const bgClose=style.bg ? `{/${style.bg}-bg}` : "";
        push(`{${borderColor}-fg}┌─ {gray-fg}aside{/gray-fg} ─┐{/${borderColor}-fg}`);
        if(inline.length){
          const base=lineIndex;
          const w=effectiveWidth-6;
          const {lines:wLines, links:lns}=wrapInline(inline, w, globalTargetId);
          for(const l of wLines) push(`{${borderColor}-fg}│{/${borderColor}-fg} ${bg}${l}${bgClose}`);
          for(const l of lns) links.push({id:l.id, href:l.href, text:l.text, line: base+1 + l.lineOffset});
        } else {
          const txt=node.text||"";
          for(const w of wordWrap(txt, effectiveWidth-6).split("\n")) push(`{${borderColor}-fg}│{/${borderColor}-fg} ${escapeBlessed(w)}`);
        }
        push(`{${borderColor}-fg}└${"─".repeat(effectiveWidth-2)}┘{/${borderColor}-fg}`);
        pushEmpty();
        break;
      }
      case "figure": {
        const inline=node.inline || [];
        const caption=node.caption || "";
        if(inline.length){
          const base=lineIndex;
          const {lines:wLines, links:lns}=wrapInline(inline, effectiveWidth, globalTargetId);
          for(const l of wLines) push(l);
          for(const l of lns) links.push({id:l.id, href:l.href, text:l.text, line: base + l.lineOffset});
        } else {
          const txt=node.text||"";
          for(const w of wordWrap(txt, effectiveWidth).split("\n")) push(escapeBlessed(w));
        }
        if(caption){
          push(`{gray-fg}{italic}─ ${escapeBlessed(caption)} ─{/italic}{/gray-fg}`);
        }
        pushEmpty();
        break;
      }
      case "header": {
        const inline=node.inline || [];
        const fg=style.fg||"white";
        const bg=style.bg ? `{${style.bg}-bg}` : "";
        const bgClose=style.bg ? `{/${style.bg}-bg}` : "";
        if(inline.length){
          const base=lineIndex;
          const {lines:wLines, links:lns}=wrapInline(inline, effectiveWidth-2, globalTargetId);
          for(const l of wLines) push(`${bg}{bold}{${fg}-fg}${l}{/${fg}-fg}{/bold}${bgClose}`);
          for(const l of lns) links.push({id:l.id, href:l.href, text:l.text, line: base + l.lineOffset});
        } else {
          const txt=node.text||"";
          for(const w of wordWrap(txt, effectiveWidth).split("\n")) push(`{bold}{${fg}-fg}${escapeBlessed(w)}{/${fg}-fg}{/bold}`);
        }
        push(`{gray-fg}${"─".repeat(effectiveWidth)}{/gray-fg}`);
        pushEmpty();
        break;
      }
      case "button": {
        const txt=escapeBlessed(node.text);
        const bg = style.bg || "blue";
        const fg = style.fg || "white";
        const borderColor = style.border?.color || fg;
        push(`  {${bg}-bg}{${fg}-fg}  ${txt}  {/${fg}-fg}{/${bg}-bg} {gray-fg}[button]{/gray-fg}`);
        pushEmpty();
        break;
      }
      case "hr": {
        const c = style.fg || style.border?.color || "gray";
        const total = Math.min(effectiveWidth, 56);
        push(`{${c}-fg}${"─".repeat(total)}{/${c}-fg}`);
        pushEmpty();
        break;
      }
      default: break;
    }
  }
  links.sort((a,b)=> a.line-b.line || a.id-b.id);
  const seen=new Set(); const deduped=[];
  for(const l of links) if(!seen.has(l.id)){ seen.add(l.id); deduped.push(l); }
  const text=lines.join("\n");
  return { text, links: deduped, lines };
}
