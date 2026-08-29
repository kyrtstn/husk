import blessed from "blessed";
import { renderContent } from "./renderer.js";

export function createUI({ onNavigate, onQuit } = {}) {
  const screen = blessed.screen({
    smartCSR: true,
    title: "Husk — CLI Browser",
    fullUnicode: true,
    autoPadding: true,
    dockBorders: true,
  });

  const topBar = blessed.textbox({
    parent: screen,
    top: 0,
    left: 0,
    height: 3,
    width: "100%",
    border: { type: "line" },
    label: " ◈ Husk — type URL or search, / to focus ",
    style: {
      fg: "white",
      bg: "black",
      border: { fg: "cyan" },
      label: { fg: "cyan", bold: true },
      focus: { border: { fg: "yellow" }, fg: "yellow" },
    },
    inputOnFocus: true,
    keys: true,
    mouse: true,
    padding: { left: 1, right: 1 },
  });

  const statusBox = blessed.box({
    parent: screen,
    top: 1,
    right: 2,
    height: 1,
    width: "shrink",
    content: "",
    style: { fg: "yellow", bg: "black" },
    tags: true,
    align: "right",
  });

  const viewport = blessed.box({
    parent: screen,
    top: 3,
    left: 0,
    width: "100%",
    height: "100%-6",
    border: { type: "line" },
    label: " Husk ◈ {gray-fg}beautiful lite browser{/gray-fg} ",
    scrollable: true,
    alwaysScroll: true,
    keys: true,
    vi: true,
    mouse: true,
    scrollbar: { ch: "▐", track: { ch: " " }, style: { bg: "cyan", fg: "black" } },
    style: {
      fg: "white",
      bg: "black",
      border: { fg: "gray" },
      label: { fg: "cyan", bold: true },
      scrollbar: { bg: "cyan" },
    },
    tags: true,
    padding: { left: 1, right: 1 },
  });

  const bottomBar = blessed.box({
    parent: screen,
    bottom: 0,
    left: 0,
    width: "100%",
    height: 3,
    border: { type: "line" },
    style: { fg: "white", bg: "black", border: { fg: "cyan" } },
    tags: true,
    content: " {cyan-fg}↑/↓{/cyan-fg} Navigate  {cyan-fg}Enter{/cyan-fg} Open  {cyan-fg}↵{/cyan-fg}  {cyan-fg}/{/cyan-fg} URL  {cyan-fg}b{/cyan-fg} Back  {cyan-fg}r{/cyan-fg} Reload  {cyan-fg}q{/cyan-fg} Quit  {gray-fg}│{/gray-fg} {yellow-fg}▸{/yellow-fg} shows cursor",
    padding: { left: 1 },
  });

  // State
  let nodes = [];
  let links = [];
  let lines = [];
  let cursorIdx = 0;
  let history = [];
  let currentUrl = "";

  function setStatus(msg, color = "yellow") {
    statusBox.setContent(`{${color}-fg}${msg}{/${color}-fg}`);
    screen.render();
  }
  function clearStatus() {
    statusBox.setContent("");
    screen.render();
  }

  function render() {
    // Pass cursor position index, not id — renderer now highlights by nth link
    const avail = Math.max(40, (screen.width || 80) - 4);
    // Clamp cursor before render so first paint has glyph
    if (links.length > 0) {
      if (cursorIdx < 0) cursorIdx = 0;
      if (cursorIdx >= links.length) cursorIdx = links.length - 1;
    } else {
      cursorIdx = 0;
    }

    // If nodes empty but links empty, still render
    // We need to determine which link index to highlight. For first render links is previous result.
    // Use cursorIdx as index, not id, to fix chicken-egg bug.
    // To avoid empty, we can pass pending cursorIdx to renderer via new API: cursorIndex
    // But renderer currently expects cursorId; we updated to cursorIndex semantics — handle both
    // We'll pass cursorLinkIndex via cursorId param: if renderer detects integer < links.length style, it will treat as position
    // Instead we updated renderer to use cursorPosition semantics — let's adapt: renderer now expects cursorId as link id, but we now pass position?
    // Simpler: we changed renderer to use cursorId as position index of distinct link in appearance order.
    // Links length before render is old links, but we use cursorIdx directly as position, not id lookup.
    const result = renderContent(nodes, { width: avail, cursorId: cursorIdx, useCursorIndex: true });

    // Patch: our renderer currently treats cursorId as id if large, but since ids are 0..n-1 sequential, index==id for first page may coincide.
    // Actually we changed renderer to map linkIndex -> highlight. We kept param name cursorId but semantics changed to position.
    // Let's ensure we pass correct: if renderer expects position, cursorIdx is correct for initial 0 highlight.
    // To keep backwards compat, renderer now handles both: if cursorId < totalLinksCount approximation, highlight nth distinct.

    viewport.setContent(result.text || "{gray-fg}(empty page — site may be JS-only or blocked){/gray-fg}\n{gray-fg}Try: / to enter URL, r to reload{/gray-fg}");
    links = result.links;
    lines = result.lines;

    // Clamp again after new links computed
    if (links.length === 0) cursorIdx = 0;
    else if (cursorIdx >= links.length) cursorIdx = links.length - 1;
    else if (cursorIdx < 0) cursorIdx = 0;

    // If we highlighted correctly, we need second pass? No — our first pass used old cursorIdx which equals new position for 0, so glyph visible.
    // But if highlight used position semantics, first render already highlighted correctly.
    // If we want to re-render to sync after links assigned, only needed if cursor moved and highlight was off by id vs index.
    // To ensure highlight is always accurate, if links were empty before but now has links, we highlighted with cursorIdx=0 already correctly.

    // Update bottom bar with position and href preview
    const pos = links.length ? ` Link ${cursorIdx + 1}/${links.length} ` : " No links ";
    const href = links[cursorIdx]?.href ? links[cursorIdx].href.slice(0, 55) : (nodes.length ? `${nodes.length} blocks` : "—");
    const urlShort = currentUrl ? currentUrl.slice(0, 60) : "";
    bottomBar.setContent(
      ` {cyan-fg}↑/↓{/} Navigate  {cyan-fg}Enter{/} Open  {cyan-fg}/{/} URL  {cyan-fg}b{/} Back  {cyan-fg}r{/} Reload  {cyan-fg}q{/} Quit  {gray-fg}${pos}{/gray-fg}{yellow-fg}${escapeBlessed(href)}{/yellow-fg}`
    );
    viewport.setLabel(` Husk — {gray-fg}${escapeBlessed(urlShort) || "no page"}{/gray-fg} `);

    // Scroll to cursor line
    if (links.length && links[cursorIdx]) {
      const targetLine = links[cursorIdx].line;
      const h = typeof viewport.height === "number" && viewport.height > 5 ? viewport.height : (screen.height ? screen.height - 6 : 24);
      const visible = Math.max(5, h - 2);
      const top = viewport.getScroll();
      if (targetLine < top + 1) viewport.scrollTo(Math.max(0, targetLine - 1));
      else if (targetLine >= top + visible - 1) viewport.scrollTo(targetLine - visible + 2);
    } else {
      // No links — ensure top
      if (nodes.length > 0 && lineIndexDidNotInit()) viewport.scrollTo(0);
    }

    screen.render();
  }

  function lineIndexDidNotInit() {
    return viewport.getScroll() > 0 && lines.length < 10;
  }

  function escapeBlessed(s) {
    return String(s).replace(/\{/g, "\\{").replace(/\}/g, "\\}");
  }

  function setContent(newNodes, url) {
    nodes = newNodes;
    if (url && url !== currentUrl) {
      if (currentUrl) history.push(currentUrl);
      currentUrl = url;
      topBar.setValue(url);
    }
    cursorIdx = 0;
    // Reset viewport scroll top before render
    viewport.scrollTo(0);
    render();
    // Second immediate render ensures cursor glyph appears on first paint even if links empty before
    // Already handled by render's first pass, but ensure scroll stays at top then cursor scrolled
    if (links.length > 0) {
      // Re-render once more to sync highlight if id vs index mismatch (id sequential may equal index, but safe)
      // No need to double render now that renderer uses index; kept for safety
      screen.render();
    }
  }

  function setContentNoHistory(newNodes, url) {
    nodes = newNodes;
    if (url) {
      currentUrl = url;
      topBar.setValue(url);
    }
    cursorIdx = 0;
    viewport.scrollTo(0);
    render();
  }

  function showError(message, url) {
    nodes = [
      { type: "heading", level: 1, text: "Error" },
      { type: "paragraph", text: message },
      ...(url ? [{ type: "paragraph", text: `URL: ${url}` }] : []),
      { type: "paragraph", text: "Press / to enter a new URL, r to retry, b to go back." },
    ];
    links = [];
    cursorIdx = 0;
    viewport.scrollTo(0);
    render();
  }

  function showLoading(url) {
    setStatus("Loading...", "yellow");
    nodes = [{ type: "paragraph", text: `Loading ${url} ...` }];
    // Keep history? no
    render();
  }

  function moveCursor(delta) {
    if (links.length === 0) {
      // No links: allow scrolling as fallback
      viewport.scroll(delta > 0 ? 3 : -3);
      screen.render();
      return;
    }
    const prev = cursorIdx;
    cursorIdx = Math.max(0, Math.min(links.length - 1, cursorIdx + delta));
    if (prev !== cursorIdx) {
      render();
    }
  }

  // Keys
  screen.key(["q", "C-c"], () => {
    if (onQuit) onQuit();
    else process.exit(0);
  });

  screen.key(["/", "C-l"], () => {
    topBar.focus();
    topBar.readInput(() => {});
    screen.render();
  });

  // Direct up/down global to ensure cursor works even when viewport not focused
  screen.key(["up", "k"], () => moveCursor(-1));
  screen.key(["down", "j"], () => moveCursor(1));
  screen.key(["pageup"], () => {
    viewport.scroll(-Math.max(5, (viewport.height | 0) - 2));
    screen.render();
  });
  screen.key(["pagedown", "space"], () => {
    viewport.scroll(Math.max(5, (viewport.height | 0) - 2));
    screen.render();
  });
  screen.key(["home"], () => {
    viewport.scrollTo(0);
    if (links.length) { cursorIdx = 0; render(); }
    else screen.render();
  });
  screen.key(["end"], () => {
    viewport.scrollTo(lines.length);
    if (links.length) { cursorIdx = links.length - 1; render(); }
    else screen.render();
  });

  screen.key(["enter"], () => {
    if (screen.focused === topBar) return;
    const link = links[cursorIdx];
    if (link) {
      if (link.href) onNavigate(link.href);
      else setStatus(`Button: ${link.text} (no link)`, "yellow");
    }
  });
  screen.key(["tab"], () => moveCursor(1));
  screen.key(["S-tab"], () => moveCursor(-1));

  screen.key(["b", "escape"], () => {
    if (history.length && onNavigate) {
      const prev = history.pop();
      onNavigate(prev, { isBack: true });
    } else {
      setStatus("No history", "gray");
      setTimeout(clearStatus, 1500);
    }
  });

  screen.key(["r", "C-r"], () => {
    if (currentUrl && onNavigate) onNavigate(currentUrl);
    else setStatus("No URL to reload", "gray");
  });

  topBar.on("submit", (value) => {
    viewport.focus();
    if (value.trim() && onNavigate) onNavigate(value.trim());
  });

  topBar.on("cancel", () => viewport.focus());

  // Mouse: clicking on viewport attempts to find nearest link under click line
  viewport.on("click", (data) => {
    if (!links.length) return;
    // data is mouse event with y relative? blessed reports? approximate by scroll + y
    const y = data.y - (viewport.atop || 3) - 1 + viewport.getScroll();
    // Find link with line closest to y
    let best = null;
    let bestDist = Infinity;
    for (const l of links) {
      const d = Math.abs(l.line - y);
      if (d < bestDist) { bestDist = d; best = l; }
    }
    if (best && bestDist < 5) {
      const idx = links.findIndex((x) => x.id === best.id);
      if (idx >= 0) {
        cursorIdx = idx;
        render();
        // optional auto-open on double click? For now just focus
      }
    }
  });

  viewport.on("wheeldown", () => {
    viewport.scroll(3);
    screen.render();
  });
  viewport.on("wheelup", () => {
    viewport.scroll(-3);
    screen.render();
  });

  screen.on("resize", () => render());

  viewport.focus();

  return {
    screen,
    topBar,
    viewport,
    bottomBar,
    setContent,
    setContentNoHistory,
    showError,
    showLoading,
    setStatus,
    clearStatus,
    getCurrentUrl: () => currentUrl,
    getHistory: () => [...history],
    setHistory: (h) => (history = [...h]),
    setCurrentUrl: (u) => (currentUrl = u),
    render,
  };
}
