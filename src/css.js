import { cssColorToBlessed, extractInlineColor } from "./utils.js";

// Convert px to terminal cells (approx 8px per cell)
export function pxToCells(px) {
  if (!px) return 0;
  if (typeof px === "number") return Math.max(0, Math.round(px / 8));
  const s = String(px).trim().toLowerCase();
  if (s === "auto" || s === "none" || s === "") return 0;
  if (s.endsWith("px")) return Math.max(0, Math.round(parseFloat(s) / 8));
  if (s.endsWith("rem") || s.endsWith("em")) return Math.max(0, Math.round(parseFloat(s) * 2));
  if (s.endsWith("%")) return 0; // handled as percent elsewhere
  const n = parseFloat(s);
  return isNaN(n) ? 0 : Math.max(0, Math.round(n / 8));
}

export function parseSpacing(value) {
  if (!value) return [0,0,0,0];
  const parts = String(value).trim().split(/\s+/).map(p=>pxToCells(p));
  if (parts.length===1) return [parts[0], parts[0], parts[0], parts[0]];
  if (parts.length===2) return [parts[0], parts[1], parts[0], parts[1]];
  if (parts.length===3) return [parts[0], parts[1], parts[2], parts[1]];
  if (parts.length>=4) return [parts[0], parts[1], parts[2], parts[3]];
  return [0,0,0,0];
}

export function parseBorder(value) {
  if (!value || value==="none" || value==="0") return null;
  // e.g. "1px solid #dadce0" or "1px solid rgb(218, 220, 224)"
  const colorMatch = value.match(/(#[0-9a-fA-F]{3,8}|rgb\([^)]+\)|rgba\([^)]+\)|[a-z]+)/i);
  let color = null;
  if (colorMatch) {
    // find last color-like token
    const candidates = value.match(/(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|\b(?:red|blue|green|yellow|black|white|gray|grey|cyan|magenta)\b)/gi);
    if (candidates) color = candidates[candidates.length-1];
  }
  const widthMatch = value.match(/(\d+)px/);
  const width = widthMatch ? parseInt(widthMatch[1],10) : 1;
  if (width===0) return null;
  return { width: width>0?1:0, color: color ? cssColorToBlessed(color) : "gray" };
}

// Extract full style object from computed + inline
export function getNodeStyle(el, win) {
  if (!el || !win) return {};
  let cs = null;
  try {
    cs = win.getComputedStyle(el);
  } catch {}
  const inline = el.getAttribute ? (el.getAttribute("style")||"") : "";
  
  function get(prop, fallback="") {
    let v = "";
    if (cs) {
      try { v = cs.getPropertyValue(prop) || ""; } catch {}
    }
    if (!v || v==="") {
      // fallback to inline parsing
      const m = inline.match(new RegExp(`${prop}\\s*:\\s*([^;]+)`, "i"));
      if (m) v = m[1].trim();
    }
    return v || fallback;
  }

  const style = {};
  // colors
  const color = get("color");
  const bg = get("background-color") || get("background");
  // jsdom computed may return "canvastext" etc for default - filter
  if (color && !color.includes("canvas") && color!=="rgba(0, 0, 0, 0)") {
    const blessed = cssColorToBlessed(color);
    if (blessed) style.fg = blessed;
  } else if (inline) {
    const ic = extractInlineColor(inline);
    if (ic) style.fg = ic;
  }
  if (bg && bg!=="rgba(0, 0, 0, 0)" && bg!=="transparent" && !bg.includes("canvas")) {
    // background may be like "rgb(255, 255, 255)" or "#fff"
    // Try to extract first color token
    const bgColor = bg.split(" ")[0];
    const blessedBg = cssColorToBlessed(bgColor) || cssColorToBlessed(bg);
    if (blessedBg) style.bg = blessedBg;
  }
  // font
  const fw = get("font-weight");
  if (fw && (fw==="bold" || fw==="700" || parseInt(fw,10)>=600)) style.bold = true;
  const fs = get("font-style");
  if (fs && fs.includes("italic")) style.italic = true;
  const td = get("text-decoration") || get("text-decoration-line");
  if (td && td.includes("underline")) style.underline = true;
  // alignment
  const ta = get("text-align");
  if (ta && ["center","right","justify"].includes(ta)) style.align = ta;
  const va = get("vertical-align");
  if (va) style.valign = va;
  // display / position
  const display = get("display");
  if (display) style.display = display;
  const position = get("position");
  if (position && position!=="static") style.position = position;
  const top = get("top");
  const left = get("left");
  const right = get("right");
  const bottom = get("bottom");
  if (top && top!=="auto") style.top = top;
  if (left && left!=="auto") style.left = left;
  if (right && right!=="auto") style.right = right;
  if (bottom && bottom!=="auto") style.bottom = bottom;
  // sizing
  const width = get("width");
  const height = get("height");
  if (width && width!=="auto") style.width = width;
  if (height && height!=="auto") style.height = height;
  // spacing
  const padding = get("padding");
  const margin = get("margin");
  if (padding) style.padding = parseSpacing(padding);
  else {
    const pt = get("padding-top"), pr = get("padding-right"), pb = get("padding-bottom"), pl = get("padding-left");
    if (pt||pr||pb||pl) style.padding = [pxToCells(pt), pxToCells(pr), pxToCells(pb), pxToCells(pl)];
  }
  if (margin) style.margin = parseSpacing(margin);
  else {
    const mt = get("margin-top"), mr = get("margin-right"), mb = get("margin-bottom"), ml = get("margin-left");
    if (mt||mr||mb||ml) style.margin = [pxToCells(mt), pxToCells(mr), pxToCells(mb), pxToCells(ml)];
  }
  // border
  const border = get("border");
  const borderTop = get("border-top");
  const borderColor = get("border-color");
  if (border && border!=="none") style.border = parseBorder(border);
  else if (borderTop && borderTop!=="none") style.border = parseBorder(borderTop);
  else if (borderColor) {
    // if border-color present but no width, assume 1px
    const bc = cssColorToBlessed(borderColor);
    if (bc) style.border = { width:1, color: bc };
  }
  // font size for heading scale
  const fontSize = get("font-size");
  if (fontSize) style.fontSize = fontSize;
  // opacity
  const opacity = get("opacity");
  if (opacity && parseFloat(opacity) < 0.3) style.hidden = true;

  return style;
}

export function styleToBlessedTags(style) {
  let open = "", close = "";
  if (!style) return { open, close };
  if (style.bold) { open += "{bold}"; close = "{/bold}" + close; }
  if (style.italic) { open += "{italic}"; close = "{/italic}" + close; }
  if (style.underline) { open += "{underline}"; close = "{/underline}" + close; }
  if (style.fg) { open += `{${style.fg}-fg}`; close = `{/${style.fg}-fg}` + close; }
  if (style.bg) { open += `{${style.bg}-bg}`; close = `{/${style.bg}-bg}` + close; }
  return { open, close };
}
