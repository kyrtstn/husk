import { wordWrap } from "./utils.js";

function escapeBlessed(str) {
  return String(str).replace(/\{/g, "\\{").replace(/\}/g, "\\}");
}

function styleOpen(p) {
  let s = "";
  if (p.bold) s += "{bold}";
  if (p.italic) s += "{italic}";
  if (p.underline) s += "{underline}";
  if (p.code) s += "{green-fg}";
  if (p.color) s += `{${p.color}-fg}`;
  return s;
}
function styleClose(p) {
  let s = "";
  if (p.color) s += `{/${p.color}-fg}`;
  if (p.code) s += "{/green-fg}";
  if (p.underline) s += "{/underline}";
  if (p.italic) s += "{/italic}";
  if (p.bold) s += "{/bold}";
  return s;
}

function linkTags(isFocused, p) {
  if (isFocused) {
    return { open: "{inverse}{yellow-fg}{bold}", close: "{/bold}{/yellow-fg}{/inverse}" };
  } else {
    // Beautiful unfocused: cyan underline with subtle bg
    return { open: "{underline}{cyan-fg}", close: "{/cyan-fg}{/underline}" };
  }
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
      // Add subtle icon for link: unfocused gets "›" prefix? Keep inline to preserve width, so glyph added at line level only
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

export function renderContent(nodes, { width = 80, cursorId = -1, useCursorIndex = false } = {}) {
  const effectiveWidth = Math.max(32, width - 2);
  let lines = []; let links = []; let lineIndex = 0;
  const globalOrderedIds=[]; const seenGlobal=new Set();
  for(const n of nodes){ if(n.inline) for(const p of n.inline) if(p.type==="link"&&!seenGlobal.has(p.id)){ seenGlobal.add(p.id); globalOrderedIds.push(p.id);} }
  let globalTargetId=cursorId;
  if(typeof cursorId==="number"&&cursorId>=0){
    if(!seenGlobal.has(cursorId)&&cursorId<globalOrderedIds.length) globalTargetId=globalOrderedIds[cursorId];
    else if(seenGlobal.has(cursorId)&&useCursorIndex && cursorId<globalOrderedIds.length) globalTargetId=globalOrderedIds[cursorId];
  }
  const push = s => { lines.push(s); lineIndex++; };
  const pushEmpty = () => { lines.push(""); lineIndex++; };
  const hrDecor = (w) => {
    const pat = "─";
    const mid = " ◇ ";
    const total = Math.min(w, 56);
    const left = pat.repeat(Math.floor((total-mid.length)/2));
    const right = pat.repeat(Math.ceil((total-mid.length)/2));
    return `{gray-fg}${left}{/gray-fg}{yellow-fg}${mid}{/yellow-fg}{gray-fg}${right}{/gray-fg}`;
  };

  for(const node of nodes){
    switch(node.type){
      case "siteHeader": {
        const w = effectiveWidth;
        const title = node.text || "Untitled";
        const desc = node.desc || "";
        const url = node.url || "";
        // Top double border
        push(`{cyan-fg}╔${"═".repeat(Math.min(w, 60))}╗{/cyan-fg}`);
        // Title centered with icon
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
        // separator
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
      case "heading": {
        const level = Math.min(6, Math.max(1, node.level||1));
        const sty = headingStyles[level];
        const fg = sty.fg;
        const decoChar = sty.deco;
        // Beautiful heading: prefix + text, with color and bold
        const raw = `${sty.prefix}${node.text}`;
        const wrapped = wordWrap(raw, effectiveWidth).split("\n");
        // For h1, add top decoration
        if(level===1){
          push(`{${fg}-fg}${"━".repeat(Math.min(effectiveWidth, 50))}{/${fg}-fg}`);
        }
        for(const w of wrapped){
          const open = `{bold}{${fg}-fg}` + (sty.underline? "{underline}": "");
          const close = (sty.underline? "{/underline}":"") + `{/${fg}-fg}{/bold}`;
          push(`${open}${escapeBlessed(w)}${close}`);
        }
        if(level===1){
          push(`{${fg}-fg}${"━".repeat(Math.min(effectiveWidth, 50))}{/${fg}-fg}`);
        } else if(level===2){
          push(`{gray-fg}${"─".repeat(Math.min(effectiveWidth, 36))}{/gray-fg}`);
        }
        pushEmpty();
        break;
      }
      case "paragraph": {
        if(node.inline && node.inline.length){
          // Detect HN/story-like card: starts with "1." etc.
          const isStoryCard = /^\d+\.$/.test((node.inline[0]?.text || "").trim()) && node.inline.some(p=>p.type==="link");
          const base=lineIndex;
          if(isStoryCard){
            // Beautiful card for ranked items
            const num = node.inline[0].text.trim();
            push(`{gray-fg}┌─ {yellow-fg}${escapeBlessed(num)}{/yellow-fg} ─┐{/gray-fg}`);
          }
          // Use slightly indented width for card
          const w = isStoryCard ? effectiveWidth-4 : effectiveWidth;
          const {lines:wLines, links:lns}=wrapInline(node.inline.slice(isStoryCard?1:0), w, globalTargetId);
          for(const l of wLines){
            if(isStoryCard) push(`{gray-fg}│{/gray-fg} ${l}`);
            else push(l);
          }
          if(isStoryCard) push(`{gray-fg}└${"─".repeat(Math.min(w, 40))}┘{/gray-fg}`);
          // Adjust line offsets for card borders
          const offset = isStoryCard ? 1 : 0;
          for(const l of lns) links.push({id:l.id, href:l.href, text:l.text, line: base + offset + l.lineOffset});
          pushEmpty();
        } else {
          const colOpen = node.color? `{${node.color}-fg}`: "";
          const colClose = node.color? `{/${node.color}-fg}`: "";
          for(const w of wordWrap(node.text, effectiveWidth).split("\n")) push(`${colOpen}${escapeBlessed(w)}${colClose}`);
          pushEmpty();
        }
        break;
      }
      case "pre": {
        const text = node.text || (node.inline? node.inline.map(p=>p.text).join(" "): "");
        push(`{gray-fg}┌─ {green-fg}code{/green-fg} ${"─".repeat(Math.max(0,effectiveWidth-9))}┐{/gray-fg}`);
        for(const rl of text.split("\n")){
          const wrapped=wordWrap(rl||" ", effectiveWidth-4).split("\n");
          for(const w of wrapped) push(`{gray-fg}│{/gray-fg} {green-fg}${escapeBlessed(w)}{/green-fg}`);
        }
        push(`{gray-fg}└${"─".repeat(effectiveWidth-2)}┘{/gray-fg}`);
        pushEmpty();
        break;
      }
      case "blockquote": {
        const inline=node.inline || [{type:"text", text:node.text}];
        const base=lineIndex;
        const {lines:wLines, links:lns}=wrapInline(inline, effectiveWidth-6, globalTargetId);
        // Add left border with beautiful style
        push(`{yellow-fg}┌─ {gray-fg}quote{/gray-fg} ─┐{/yellow-fg}`);
        for(const l of wLines){
          push(`{yellow-fg}┃{/yellow-fg} {gray-fg}{italic}${l}{/italic}{/gray-fg}`);
        }
        push(`{yellow-fg}└${"─".repeat(Math.min(effectiveWidth-2,28))}┘{/yellow-fg}`);
        for(const l of lns) links.push({id:l.id, href:l.href, text:l.text, line: base+1 + l.lineOffset});
        pushEmpty();
        break;
      }
      case "listItem": {
        const bullet = node.ordered ? `{yellow-fg}${node.index}.{/yellow-fg}` : `{cyan-fg}●{/cyan-fg}`;
        const prefixLen = node.ordered ? String(node.index).length+2 : 2;
        const avail = effectiveWidth - prefixLen -1;
        if(node.inline && node.inline.length){
          const base=lineIndex;
          const {lines:wLines, links:lns}=wrapInline(node.inline, avail, globalTargetId);
          wLines.forEach((l,idx)=>{
            const pref = idx===0 ? `${bullet} ` : " ".repeat(prefixLen+1);
            push(pref + l);
          });
          for(const l of lns) links.push({id:l.id, href:l.href, text:l.text, line: base + l.lineOffset});
        } else {
          const colOpen=node.color? `{${node.color}-fg}`:"";
          const colClose=node.color? `{/${node.color}-fg}`:"";
          const wrapped=wordWrap(node.text, avail).split("\n");
          wrapped.forEach((w,i)=>{
            const pref=i===0? `${bullet} ` : " ".repeat(prefixLen+1);
            push(`${colOpen}${pref}${escapeBlessed(w)}${colClose}`);
          });
        }
        // Add subtle spacing after list group? Keep single empty, but renderer already pushes empty per item; groups will have spaces.
        pushEmpty();
        break;
      }
      case "table": {
        const rows=node.rows;
        const colCount=Math.max(...rows.map(r=>r.length));
        const colWidths=Array(colCount).fill(0);
        for(const row of rows) row.forEach((cell,i)=> colWidths[i]=Math.max(colWidths[i], Math.min(cell.length, 28)));
        let total=colWidths.reduce((a,b)=>a+b,0)+(colCount-1)*3;
        if(total>effectiveWidth){
          const scale=(effectiveWidth-(colCount-1)*3)/colWidths.reduce((a,b)=>a+b,0);
          for(let i=0;i<colWidths.length;i++) colWidths[i]=Math.max(6, Math.floor(colWidths[i]*scale));
        }
        // Top border
        const top = "┌" + colWidths.map(w=>"─".repeat(w+2)).join("┬") + "┐";
        const mid = "├" + colWidths.map(w=>"─".repeat(w+2)).join("┼") + "┤";
        const bot = "└" + colWidths.map(w=>"─".repeat(w+2)).join("┴") + "┘";
        push(`{cyan-fg}${top}{/cyan-fg}`);
        rows.forEach((row,rIdx)=>{
          const isHeader=rIdx===0;
          const cells=row.map((c,i)=>{
            const w=colWidths[i]||10;
            let v=c.slice(0,w).padEnd(w," ");
            return isHeader ? `{bold}{white-fg}${escapeBlessed(v)}{/white-fg}{/bold}` : escapeBlessed(v);
          });
          const inner = cells.map((c,i)=> ` ${c} `).join("{cyan-fg}│{/cyan-fg}");
          const bg = isHeader? "{blue-bg}" : "";
          const bgClose = isHeader? "{/blue-bg}" : "";
          push(`{cyan-fg}│{/cyan-fg}${bg}${inner}${bgClose}{cyan-fg}│{/cyan-fg}`);
          if(isHeader) push(`{cyan-fg}${mid}{/cyan-fg}`);
        });
        push(`{cyan-fg}${bot}{/cyan-fg}`);
        pushEmpty();
        break;
      }
      case "button": {
        const txt=escapeBlessed(node.text);
        // Beautiful pill button
        push(`  {black-bg}{white-fg}  ${txt}  {/white-fg}{/black-bg} {gray-fg}[button]{/gray-fg}`);
        pushEmpty();
        break;
      }
      case "hr": {
        push(hrDecor(effectiveWidth));
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
