#!/usr/bin/env node
import { fetchPage } from "./src/fetcher.js";
import { parseHTML } from "./src/parser.js";
import { createUI } from "./src/ui.js";
import { normalizeUrl } from "./src/utils.js";

const DEFAULT_URL = "https://example.com";

let ui;

async function loadUrl(input, { isBack = false } = {}) {
  const url = normalizeUrl(input);
  if (!url) {
    ui.showError(`Invalid URL: "${input}"\n\nTry: https://example.com or example.com`, input);
    ui.clearStatus();
    return;
  }

  ui.showLoading(url);
  ui.setStatus("Loading...", "yellow");

  try {
    const { html, finalUrl } = await fetchPage(url);
    // Non-blocking parse: yield to event loop
    await new Promise((r) => setImmediate(r));
    const nodes = parseHTML(html, finalUrl);

    if (!isBack) {
      ui.setContent(nodes, finalUrl);
    } else {
      ui.setContentNoHistory(nodes, finalUrl);
    }
    ui.clearStatus();
  } catch (err) {
    ui.showError(`${err.message}\n\nPress / to try another URL, r to reload, b to go back.`, url);
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
