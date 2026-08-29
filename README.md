# Husk — Lightweight CLI Browser

A lightweight CLI web browser for low-end devices and terminal environments. Fetches pages, parses with `jsdom`, and renders a clean text UI with `blessed`.

## Features
- **TUI Layout**: Top URL bar, scrollable viewport, bottom shortcuts bar
- **Smart rendering**: strips `<script>`, `<style>`, `<svg>`, `<nav>` etc., renders headings, paragraphs, lists, tables, blockquotes
- **ANSI styling**: `<b>`, `<i>`, `<a>`, headings + inline `color:` CSS → `blessed` tags
- **Cursor navigation**: `↑`/`↓` (or `k`/`j`) to move between links, `Enter` to follow `href`
- **History**: `b` to go back, `r` to reload

## Install
```bash
npm install
```

Requires Node `>=18` (built-in `fetch`).

## Usage
```bash
node index.js https://example.com
# or
npm start -- https://example.com
```

Make executable:
```bash
chmod +x index.js
./index.js https://news.ycombinator.com
```

## Shortcuts
| Key | Action |
|-----|--------|
| `↑` `↓` / `k` `j` | Move cursor between links |
| `Enter` | Open focused link |
| `/` or `Ctrl+L` | Focus URL bar |
| `Enter` (in URL bar) | Navigate |
| `b` / `Esc` | Back |
| `r` / `Ctrl+R` | Reload |
| `q` / `Ctrl+C` | Quit |
| Mouse wheel | Scroll viewport |

## Project Structure
```
index.js      # entry, navigation + fetch orchestration
src/fetcher.js # fetchPage with timeout + UA
src/parser.js  # jsdom DOM stripping + readable extraction
src/renderer.js# blessed-tag rendering + word-wrap + link mapping
src/ui.js      # blessed screen layout + cursor state
src/utils.js   # URL normalize, wrap, color helpers
```

## Performance Notes
- `fetch` timeout 10s via `AbortController`
- `setImmediate` yields before parse so UI stays responsive
- No heavy deps; `blessed` + `jsdom` only
- Word-wrap respects terminal width, hard-breaks long tokens

## License
MIT
