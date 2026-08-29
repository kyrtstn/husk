import blessed from "blessed";
import { renderContent } from "./renderer.js";

export function createUI({ onNavigate, onQuit } = {}) {
  const screen = blessed.screen({
    smartCSR: true,
    title: "Husk — CLI Browser",
    fullUnicode: true,
    autoPadding: true,
  });

  const topBar = blessed.textbox({
    parent: screen,
    top: 0,
    left: 0,
    height: 3,
    width: "100%",
    border: { type: "line" },
    label: " URL (press / to focus, Enter to go) ",
    style: {
      fg: "white",
      bg: "black",
      border: { fg: "cyan" },
      label: { fg: "cyan" },
      focus: { border: { fg: "yellow" } },
    },
    inputOnFocus: true,
    keys: true,
    mouse: true,
  });

  const statusBox = blessed.box({
    parent: screen,
    top: 0,
    right: 2,
    height: 1,
    width: "shrink",
    content: "",
    style: { fg: "yellow", bg: "black" },
    tags: true,
  });

  const viewport = blessed.box({
    parent: screen,
    top: 3,
    left: 0,
    width: "100%",
    height: "100%-6",
    border: { type: "line" },
    label: " Husk ",
    scrollable: true,
    alwaysScroll: true,
    keys: true,
    vi: true,
    mouse: true,
    scrollbar: { ch: " ", style: { bg: "cyan" } },
    style: {
      fg: "white",
      bg: "black",
      border: { fg: "gray" },
      label: { fg: "green" },
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
    content: " {cyan-fg}↑/↓{/} Navigate  {cyan-fg}Enter{/} Open  {cyan-fg}/{/} URL  {cyan-fg}b{/} Back  {cyan-fg}r{/} Reload  {cyan-fg}q{/} Quit ",
    padding: { left: 1 },
  });

  // State
  let nodes = [];
  let links = [];
  let lines = [];
  let cursorIdx = 0;
  let history = [];
  let currentUrl = "";
  let viewportWidth = viewport.width;

  function setStatus(msg, color = "yellow") {
    statusBox.setContent(`{${color}-fg}${msg}{/${color}-fg}`);
    screen.render();
  }
  function clearStatus() {
    statusBox.setContent("");
    screen.render();
  }

  function render() {
    const width = typeof viewport.width === "number" ? viewport.width : 80;
    // blessed width is not reliable before render; fallback to screen.width
    const avail = Math.max(40, (screen.width || 80) - 4);
    const result = renderContent(nodes, { width: avail, cursorId: links[cursorIdx]?.id ?? -1 });
    viewport.setContent(result.text || "{gray-fg}(empty page){/gray-fg}");
    links = result.links;
    lines = result.lines;

    // Clamp cursor
    if (links.length === 0) cursorIdx = 0;
    else if (cursorIdx >= links.length) cursorIdx = links.length - 1;
    else if (cursorIdx < 0) cursorIdx = 0;

    // Update bottom bar with position
    const pos = links.length ? ` Link ${cursorIdx + 1}/${links.length} ` : " No links ";
    const href = links[cursorIdx]?.href ? links[cursorIdx].href.slice(0, 40) : "";
    bottomBar.setContent(
      ` {cyan-fg}↑/↓{/} Navigate  {cyan-fg}Enter{/} Open  {cyan-fg}/{/} URL  {cyan-fg}b{/} Back  {cyan-fg}r{/} Reload  {cyan-fg}q{/} Quit  {gray-fg}${pos}{/gray-fg}{yellow-fg}${href}{/yellow-fg}`
    );

    // Scroll to cursor
    if (links.length && links[cursorIdx]) {
      const targetLine = links[cursorIdx].line;
      const h = typeof viewport.height === "number" ? viewport.height : 20;
      const visible = Math.max(5, h - 2);
      const top = viewport.getScroll();
      if (targetLine < top) viewport.scrollTo(targetLine);
      else if (targetLine >= top + visible) viewport.scrollTo(targetLine - visible + 1);
    }

    screen.render();
  }

  function setContent(newNodes, url) {
    nodes = newNodes;
    if (url && url !== currentUrl) {
      if (currentUrl) history.push(currentUrl);
      currentUrl = url;
      topBar.setValue(url);
    }
    cursorIdx = 0;
    links = [];
    render();
  }

  function setContentNoHistory(newNodes, url) {
    nodes = newNodes;
    if (url) {
      currentUrl = url;
      topBar.setValue(url);
    }
    cursorIdx = 0;
    links = [];
    render();
  }

  function showError(message, url) {
    nodes = [
      { type: "heading", level: 1, text: "Error" },
      { type: "paragraph", text: message },
      ...(url ? [{ type: "paragraph", text: `URL: ${url}` }] : []),
    ];
    links = [];
    cursorIdx = 0;
    render();
  }

  function showLoading(url) {
    setStatus("Loading...", "yellow");
    nodes = [{ type: "paragraph", text: `Loading ${url} ...` }];
    render();
  }

  function moveCursor(delta) {
    if (links.length === 0) return;
    cursorIdx = Math.max(0, Math.min(links.length - 1, cursorIdx + delta));
    render();
  }

  // Keys
  screen.key(["q", "C-c"], () => {
    if (onQuit) onQuit();
    else process.exit(0);
  });

  screen.key(["/", "C-l"], () => {
    topBar.focus();
    screen.render();
  });

  screen.key(["up", "k"], () => moveCursor(-1));
  screen.key(["down", "j"], () => moveCursor(1));

  screen.key(["enter"], () => {
    if (screen.focused === topBar) return; // textbox handles
    const link = links[cursorIdx];
    if (link && onNavigate) onNavigate(link.href);
  });

  screen.key(["b", "escape"], () => {
    if (history.length && onNavigate) {
      const prev = history.pop();
      onNavigate(prev, { isBack: true });
    }
  });

  screen.key(["r", "C-r"], () => {
    if (currentUrl && onNavigate) onNavigate(currentUrl);
  });

  viewport.key(["up", "k"], () => moveCursor(-1));
  viewport.key(["down", "j"], () => moveCursor(1));

  topBar.on("submit", (value) => {
    viewport.focus();
    if (value.trim() && onNavigate) onNavigate(value.trim());
  });

  topBar.on("cancel", () => viewport.focus());

  // Mouse for viewport
  viewport.on("wheeldown", () => {
    viewport.scroll(3);
    screen.render();
  });
  viewport.on("wheelup", () => {
    viewport.scroll(-3);
    screen.render();
  });

  screen.on("resize", () => render());

  // Focus
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
