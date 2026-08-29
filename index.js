#!/usr/bin/env node
import { fetchPage } from "./src/fetcher.js";
import { parseHTML } from "./src/parser.js";
import { createUI } from "./src/ui.js";
import { normalizeUrl, buildSearchUrl } from "./src/utils.js";

const DEFAULT_URL = "https://example.com";

let ui;

async function loadUrl(input, { isBack = false } = {}) {
  let url = normalizeUrl(input);
  const isSearch = !url && input && input.trim() && !/^\s*https?:\/\//i.test(input);
  if (!url) {
    if (isSearch) {
      url = buildSearchUrl(input);
      ui.setStatus(`Searching for "${input.trim()}"...`, "cyan");
    } else {
      ui.showError(`Invalid URL: "${input}"\n\nTry: https://example.com  •  example.com  •  or type a search like "husk browser"`, input);
      ui.clearStatus();
      return;
    }
  }

  ui.showLoading(url);
  ui.setStatus("Loading...", "yellow");

  try {
    let html, finalUrl;
    try {
      const res = await fetchPage(url);
      html = res.html;
      finalUrl = res.finalUrl;
    } catch (firstErr) {
      // Try http fallback if https failed (common on localhost / old sites)
      if (url.startsWith("https://")) {
        const httpUrl = url.replace(/^https:\/\//, "http://");
        try {
          ui.setStatus(`Retrying via http...`, "yellow");
          const res2 = await fetchPage(httpUrl);
          html = res2.html;
          finalUrl = res2.finalUrl;
        } catch {
          throw firstErr;
        }
      } else {
        throw firstErr;
      }
    }
    // Non-blocking parse: yield to event loop
    await new Promise((r) => setImmediate(r));
    const nodes = await parseHTML(html, finalUrl);

    if (!isBack) {
      ui.setContent(nodes, finalUrl);
    } else {
      ui.setContentNoHistory(nodes, finalUrl);
    }
    ui.clearStatus();
  } catch (err) {
    // Provide more helpful hint for JS-only sites
    let hint = "Press / to try another URL, r to reload, b to go back.";
    if (err.message.includes("Empty response") || err.message.includes("JS-only") || err.message.includes("JavaScript")) {
      hint += "\nThis site may be heavily JS-rendered. Try the lite/text version if available.";
    }
    if (err.message.includes("Unsupported content")) hint += "\nTry opening in a desktop browser for binary content.";
    ui.showError(`${err.message}\n\n${hint}`, url);
    ui.clearStatus();
    ui.setStatus("Error", "red");
    setTimeout(() => ui.clearStatus(), 3000);
  }
}

function main() {
  const startUrl = process.argv[2] || DEFAULT_URL;

  ui = createUI({
    onNavigate: (href, opts) => loadUrl(href, opts || {}),
    onQuit: () => process.exit(0),
  });

  ui.screen.render();
  loadUrl(startUrl);
}

main();
