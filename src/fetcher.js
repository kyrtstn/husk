const DEFAULT_TIMEOUT = 10000;
const USER_AGENT = "Husk/0.1 (CLI Browser; Node.js)";

export async function fetchPage(url, { timeout = DEFAULT_TIMEOUT } = {}) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const snippet = body.slice(0, 500).replace(/\s+/g, " ").trim();
      throw new Error(`HTTP ${res.status} ${res.statusText}${snippet ? " — " + snippet : ""}`);
    }

    const contentType = res.headers.get("content-type") || "";
    if (contentType && !contentType.includes("text/html") && !contentType.includes("text/plain") && !contentType.includes("application/xhtml")) {
      // still try to read as text, but warn
    }

    const html = await res.text();
    return { html, finalUrl: res.url || url, status: res.status };
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(`Timeout after ${timeout}ms fetching ${url}`);
    }
    // network errors
    if (err.message && err.message.includes("fetch")) {
      throw new Error(`Network error: ${err.message}`);
    }
    throw err;
  } finally {
    clearTimeout(id);
  }
}
