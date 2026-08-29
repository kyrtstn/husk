const DEFAULT_TIMEOUT = 15000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Husk/0.1";

export async function fetchPage(url, { timeout = DEFAULT_TIMEOUT } = {}) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  // Build browser-like headers to bypass naive bot blocks. Keep Accept broad.
  const headers = {
    "User-Agent": USER_AGENT,
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    Connection: "keep-alive",
  };

  try {
    // First try HTTPS, fallback to HTTP for weird localhost / old sites is handled by caller
    const res = await fetch(url, {
      signal: controller.signal,
      headers,
      redirect: "follow",
    });

    // Handle non-2xx with more detail
    if (!res.ok) {
      // For 403/429 cloudflare often returns HTML anyway; treat 403 as soft error but still try to parse if body looks like html
      const text = await res.text().catch(() => "");
      const isHtml = /<html|<!doctype/i.test(text);
      if (isHtml && text.length > 500) {
        // Return anyway — many WAF blocks return HTML that we can still render
        return { html: text, finalUrl: res.url || url, status: res.status, fromError: true };
      }
      const snippet = text.slice(0, 800).replace(/\s+/g, " ").trim();
      throw new Error(`HTTP ${res.status} ${res.statusText}${snippet ? " — " + snippet.slice(0, 400) : ""}`);
    }

    const ct = (res.headers.get("content-type") || "").toLowerCase();

    // Handle various content types — render best effort
    // text/html, text/plain, application/xhtml, text/*, application/json (show raw)
    const buffer = await res.arrayBuffer();
    let html;
    // Detect charset from header or meta
    const charsetMatch = ct.match(/charset=([^;]+)/i);
    const charset = charsetMatch ? charsetMatch[1].trim() : "utf-8";
    try {
      const decoder = new TextDecoder(charset, { fatal: false });
      html = decoder.decode(buffer);
    } catch {
      html = new TextDecoder("utf-8").decode(buffer);
    }

    // If JSON or plain text, wrap in <pre>
    if (ct.includes("application/json")) {
      try {
        const obj = JSON.parse(html);
        html = `<pre>${escapeHtml(JSON.stringify(obj, null, 2))}</pre>`;
      } catch {
        html = `<pre>${escapeHtml(html)}</pre>`;
      }
    } else if (ct.includes("text/plain")) {
      html = `<pre>${escapeHtml(html)}</pre>`;
    } else if (!ct.includes("html") && !ct.includes("xml") && !ct.includes("text")) {
      // Unknown binary? Still try to show as text if decode produced something
      if (html && /<html/i.test(html)) {
        // keep as is
      } else if (html && html.length > 0 && html.length < 50000) {
        html = `<pre>${escapeHtml(html.slice(0, 20000))}</pre>`;
      } else {
        throw new Error(`Unsupported content-type: ${ct || "unknown"} (binary)`);
      }
    }

    // Basic fix: if html is empty but status was 2xx, treat as error
    if (!html || html.trim().length < 20) {
      throw new Error("Empty response (site may require JavaScript)");
    }

    return { html, finalUrl: res.url || url, status: res.status };
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(`Timeout after ${timeout}ms fetching ${url}`);
    }
    if (err.message && err.message.includes("fetch")) {
      throw new Error(`Network error: ${err.message} — check URL or try http://`);
    }
    throw err;
  } finally {
    clearTimeout(id);
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
