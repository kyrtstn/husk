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

const cssColorMap = {
  black: "black",
  red: "red",
  green: "green",
  yellow: "yellow",
  blue: "blue",
  magenta: "magenta",
  cyan: "cyan",
  white: "white",
  gray: "gray",
  grey: "gray",
  orange: "yellow",
  purple: "magenta",
};

export function cssColorToBlessed(color) {
  if (!color) return null;
  color = color.trim().toLowerCase();
  // hex -> approximate
  if (color.startsWith("#")) {
    const hex = color.slice(1);
    // very lightweight approximation
    if (hex.length === 3 || hex.length === 6) {
      const r = parseInt(hex.length === 3 ? hex[0] + hex[0] : hex.slice(0, 2), 16);
      const g = parseInt(hex.length === 3 ? hex[1] + hex[1] : hex.slice(2, 4), 16);
      const b = parseInt(hex.length === 3 ? hex[2] + hex[2] : hex.slice(4, 6), 16);
      if (r > 200 && g < 100 && b < 100) return "red";
      if (r < 100 && g > 150 && b < 100) return "green";
      if (r < 100 && g < 100 && b > 150) return "blue";
      if (r > 200 && g > 200 && b < 100) return "yellow";
      if (r > 150 && g < 100 && b > 150) return "magenta";
      if (r < 100 && g > 150 && b > 150) return "cyan";
      if (r > 200 && g > 200 && b > 200) return "white";
      if (r < 80 && g < 80 && b < 80) return "black";
      return "white";
    }
  }
  if (color.startsWith("rgb")) {
    const m = color.match(/\d+/g);
    if (m && m.length >= 3) {
      const [r, g, b] = m.map(Number);
      return cssColorToBlessed(`#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`);
    }
  }
  return cssColorMap[color] || null;
}

export function extractInlineColor(styleAttr) {
  if (!styleAttr) return null;
  const m = styleAttr.match(/color\s*:\s*([^;]+)/i);
  if (m) return cssColorToBlessed(m[1].trim());
  return null;
}
