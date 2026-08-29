export function normalizeUrl(input) {
  if (!input) return null;
  let url = input.trim();
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) {
    try {
      return new URL(url).href;
    } catch {
      return null;
    }
  }
  // If looks like domain/path without protocol
  if (/^[a-zA-Z0-9.-]+\.[a-z]{2,}(\/.*)?$/.test(url) || url.startsWith("localhost") || url.startsWith("127.") || url.startsWith("192.")) {
    try {
      return new URL("https://" + url).href;
    } catch {
      return null;
    }
  }
  // Otherwise treat as search query → use DuckDuckGo Lite (fast, low JS, good for low-end)
  // Caller can use buildSearchUrl if they want to detect query case; but here we return null to signal search.
  return null;
}

export function isValidUrl(str) {
  return normalizeUrl(str) !== null;
}

export function buildSearchUrl(query) {
  if (!query) return null;
  const q = query.trim();
  if (!q) return null;
  const asUrl = normalizeUrl(q);
  if (asUrl) return asUrl;
  // Use html.duckduckgo which is more resilient on low-end and less captcha than lite
  return `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
}

export function looksLikeUrl(input) {
  return !!normalizeUrl(input);
}

export function wordWrap(text, width) {
  if (width <= 0) return text;
  const words = text.split(/\s+/);
  let lines = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > width) {
      if (cur) lines.push(cur);
      if (w.length > width) {
        // hard break long word
        for (let i = 0; i < w.length; i += width) {
          lines.push(w.slice(i, i + width));
        }
        cur = "";
      } else {
        cur = w;
      }
    } else {
      cur = cur ? cur + " " + w : w;
    }
  }
  if (cur) lines.push(cur);
  return lines.join("\n");
}

const cssNamedToHex = {
  black: "#000000", silver: "#c0c0c0", gray: "#808080", grey: "#808080", white: "#ffffff",
  maroon: "#800000", red: "#ff0000", purple: "#800080", fuchsia: "#ff00ff", magenta: "#ff00ff",
  green: "#008000", lime: "#00ff00", olive: "#808000", yellow: "#ffff00", navy: "#000080",
  blue: "#0000ff", teal: "#008080", aqua: "#00ffff", cyan: "#00ffff", orange: "#ffa500",
  aliceblue: "#f0f8ff", antiquewhite: "#faebd7", aquamarine: "#7fffd4", azure: "#f0ffff",
  beige: "#f5f5dc", bisque: "#ffe4c4", blanchedalmond: "#ffebcd", blueviolet: "#8a2be2",
  brown: "#a52a2a", burlywood: "#deb887", cadetblue: "#5f9ea0", chartreuse: "#7fff00",
  chocolate: "#d2691e", coral: "#ff7f50", cornflowerblue: "#6495ed", cornsilk: "#fff8dc",
  crimson: "#dc143c", darkblue: "#00008b", darkcyan: "#008b8b", darkgoldenrod: "#b8860b",
  darkgray: "#a9a9a9", darkgrey: "#a9a9a9", darkgreen: "#006400", darkkhaki: "#bdb76b",
  darkmagenta: "#8b008b", darkolivegreen: "#556b2f", darkorange: "#ff8c00", darkorchid: "#9932cc",
  darkred: "#8b0000", darksalmon: "#e9967a", darkseagreen: "#8fbc8f", darkslateblue: "#483d8b",
  darkslategray: "#2f4f4f", darkslategrey: "#2f4f4f", darkturquoise: "#00ced1", darkviolet: "#9400d3",
  deeppink: "#ff1493", deepskyblue: "#00bfff", dimgray: "#696969", dimgrey: "#696969",
  dodgerblue: "#1e90ff", firebrick: "#b22222", floralwhite: "#fffaf0", forestgreen: "#228b22",
  gainsboro: "#dcdcdc", ghostwhite: "#f8f8ff", gold: "#ffd700", goldenrod: "#daa520",
  greenyellow: "#adff2f", honeydew: "#f0fff0", hotpink: "#ff69b4", indianred: "#cd5c5c",
  indigo: "#4b0082", ivory: "#fffff0", khaki: "#f0e68c", lavender: "#e6e6fa",
  lavenderblush: "#fff0f5", lawngreen: "#7cfc00", lemonchiffon: "#fffacd", lightblue: "#add8e6",
  lightcoral: "#f08080", lightcyan: "#e0ffff", lightgoldenrodyellow: "#fafad2", lightgray: "#d3d3d3",
  lightgrey: "#d3d3d3", lightgreen: "#90ee90", lightpink: "#ffb6c1", lightsalmon: "#ffa07a",
  lightseagreen: "#20b2aa", lightskyblue: "#87cefa", lightslategray: "#778899",
  lightslategrey: "#778899", lightsteelblue: "#b0c4de", lightyellow: "#ffffe0", limegreen: "#32cd32",
  linen: "#faf0e6", mediumaquamarine: "#66cdaa", mediumblue: "#0000cd", mediumorchid: "#ba55d3",
  mediumpurple: "#9370db", mediumseagreen: "#3cb371", mediumslateblue: "#7b68ee",
  mediumspringgreen: "#00fa9a", mediumturquoise: "#48d1cc", mediumvioletred: "#c71585",
  midnightblue: "#191970", mintcream: "#f5fffa", mistyrose: "#ffe4e1", moccasin: "#ffe4b5",
  navajowhite: "#ffdead", oldlace: "#fdf5e6", olivedrab: "#6b8e23", orangered: "#ff4500",
  orchid: "#da70d6", palegoldenrod: "#eee8aa", palegreen: "#98fb98", paleturquoise: "#afeeee",
  palevioletred: "#db7093", papayawhip: "#ffefd5", peachpuff: "#ffdab9", peru: "#cd853f",
  pink: "#ffc0cb", plum: "#dda0dd", powderblue: "#b0e0e6", rosybrown: "#bc8f8f",
  royalblue: "#4169e1", saddlebrown: "#8b4513", salmon: "#fa8072", sandybrown: "#f4a460",
  seagreen: "#2e8b57", seashell: "#fff5ee", sienna: "#a0522d", skyblue: "#87ceeb",
  slateblue: "#6a5acd", slategray: "#708090", slategrey: "#708090", snow: "#fffafa",
  springgreen: "#00ff7f", steelblue: "#4682b4", tan: "#d2b48c", thistle: "#d8bfd8",
  tomato: "#ff6347", turquoise: "#40e0d0", violet: "#ee82ee", wheat: "#f5deb3",
  whitesmoke: "#f5f5f5", yellowgreen: "#9acd32",
  transparent: null, currentcolor: null, inherit: null, initial: null, unset: null,
};

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h/30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n)-3, Math.min(9-k(n), 1)));
  const toHex = x => Math.round(x*255).toString(16).padStart(2,"0");
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

let blessedColors = null;
function getBlessedPalette() {
  if (blessedColors) return blessedColors;
  blessedColors = [];
  const xterm = ['#000000','#cd0000','#00cd00','#cdcd00','#0000ee','#cd00cd','#00cdcd','#e5e5e5','#7f7f7f','#ff0000','#00ff00','#ffff00','#5c5cff','#ff00ff','#00ffff','#ffffff'];
  for(let i=0;i<16;i++) {
    const hex=xterm[i];
    const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
    blessedColors.push([r,g,b]);
  }
  for(let r=0;r<6;r++) for(let g=0;g<6;g++) for(let b=0;b<6;b++) {
    blessedColors.push([r?r*40+55:0, g?g*40+55:0, b?b*40+55:0]);
  }
  for(let g=0;g<24;g++){ const l=g*10+8; blessedColors.push([l,l,l]); }
  return blessedColors;
}
function hexToBlessedIndex(hex) {
  const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
  const palette=getBlessedPalette();
  let best=0, bestDist=Infinity;
  for(let i=0;i<palette.length;i++){
    const [pr,pg,pb]=palette[i];
    const d=Math.pow(30*(r-pr),2)+Math.pow(59*(g-pg),2)+Math.pow(11*(b-pb),2);
    if(d<bestDist){ bestDist=d; best=i; }
  }
  return String(best);
}

export function cssColorToBlessed(color) {
  if (!color) return null;
  color = color.trim().toLowerCase();
  if (color === "transparent" || color === "currentcolor" || color === "inherit" || color === "initial" || color === "unset") return null;
  let hex=null;
  if (color.startsWith("#")) {
    hex=color;
    if (/^#[0-9a-f]{3}$/.test(hex)) hex = "#" + hex[1]+hex[1]+hex[2]+hex[2]+hex[3]+hex[3];
    else if (/^#[0-9a-f]{4}$/.test(hex)) hex = "#" + hex[1]+hex[1]+hex[2]+hex[2]+hex[3]+hex[3];
    else if (/^#[0-9a-f]{8}$/.test(hex)) hex = hex.slice(0,7);
    if (!/^#[0-9a-f]{6}$/.test(hex)) return null;
  } else if (color.startsWith("rgb")) {
    const nums = color.match(/[\d.]+/g);
    if (nums && nums.length >= 3) {
      const [r,g,b] = nums.map(n=> Math.max(0, Math.min(255, Math.round(parseFloat(n)))));
      hex=`#${r.toString(16).padStart(2,"0")}${g.toString(16).padStart(2,"0")}${b.toString(16).padStart(2,"0")}`;
    }
  } else if (color.startsWith("hsl")) {
    const nums = color.match(/[\d.]+/g);
    if (nums && nums.length >= 3) {
      const h = parseFloat(nums[0]) % 360;
      const s = parseFloat(nums[1]);
      const l = parseFloat(nums[2]);
      hex=hslToHex(h,s,l);
    }
  } else if (cssNamedToHex[color] !== undefined) {
    hex=cssNamedToHex[color];
    if(!hex) return null;
  } else if (/^[0-9a-f]{6}$/.test(color)) hex=`#${color}`;
  if(!hex) return null;
  // Return 256 index for blessed to use via {256-fg} etc. But blessed tags expect name or number
  // We return the index as string, which blessed will handle via colors.convert
  // However for true hex support, we can return hex and let blessed's program handle via match
  // But to avoid cache poisoning, we return the index directly
  try {
    return hexToBlessedIndex(hex);
  } catch {
    return hex;
  }
}

export function extractInlineColor(styleAttr) {
  if (!styleAttr) return null;
  const m = styleAttr.match(/color\s*:\s*([^;]+)/i);
  if (m) return cssColorToBlessed(m[1].trim());
  return null;
}
