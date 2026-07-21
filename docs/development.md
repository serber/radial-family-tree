# Development

## Commands

```bash
npm install
npm run dev        # Vite dev server with hot reload
npm run build      # tsc --noEmit (strict typecheck) + build into dist/
npm run preview    # serve the built dist/ locally
npx tsc --noEmit   # typecheck only
```

The build is static (`base: './'` in `vite.config.ts`) — `dist/` can be
served from any static hosting or opened from the file system.

## Stack

- **TypeScript** in strict mode (`strict`, `noUncheckedIndexedAccess`).
- **D3 v7** — only select/join, zoom and arc; the layout is custom (see
  [layout.md](layout.md)).
- **Vite 6** — dev server and build.
- No test framework, no linter.

## Verifying changes

### DOM-free modules

`gedcom/`, `tree/`, `layout/` deliberately do not depend on DOM/D3 — they run
directly in Node (Node ≥ 23 executes TypeScript without transpilation):

```bash
node --eval "
import('./src/gedcom/parser.ts').then(async ({ parseGedcom }) => {
  const { readFileSync } = await import('node:fs');
  const data = parseGedcom(readFileSync('examples/example-large.ged', 'utf-8'));
  console.log(data.individuals.size, data.families.size);
});
"
```

Useful layout invariants to check: coordinates are finite (no NaN); angular
spans of neighboring blocks on the same ring do not overlap; every stub sits
exactly on a seam between two adjacent cards of its block; every child's
`parentFamilyId` matches one of its parent's stubs; every individual reachable
from the root has a card somewhere in the layout. Re-run these after any
change to `tree/` or `layout/` rather than eyeballing a screenshot — a
misattached branch is invisible at full-tree zoom.

### The whole app

Screenshot in headless Chrome:

```bash
npx vite --port 5199 &
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --window-size=1600,1000 --virtual-time-budget=6000 \
  --screenshot=/tmp/app.png http://localhost:5199/
```

For click scenarios (file upload, export) the repo has no browser driver
installed — no `puppeteer`, `playwright` or `chromium-cli`. Rather than adding
one, start Chrome with `--remote-debugging-port=9222` and drive it over the
DevTools protocol from Node's built-in `WebSocket`: fetch
`http://localhost:9222/json` for the page target, then `Runtime.evaluate` to
act on the page and `Page.captureScreenshot` (with a `clip` and a `scale`) to
grab a magnified crop of one node. To load a `.ged` through the real file
input, build a `File`, put it on a `DataTransfer`, assign `input.files` and
dispatch a `change` event.

The export blob is best captured by wrapping `URL.createObjectURL` (the link
is revoked right after the click, so a `fetch(blobUrl)` after the fact won't
work).

Note: d3 transitions (the fit-to-view animation) do not finish in headless
screenshots — that's why the auto-fit on load is instant, and only the
button is animated.

### Test data

- `examples/example-large.ged` — the default demo, bundled via a Vite `?raw`
  import in `src/gedcom/sample.ts` (loaded on startup and by the «Пример»
  button): 489 people, 130 families, 7 generations, 1–4 children per family
  (359 is the node count, not the family count — the two used to be conflated).
  Two of those families are second marriages, put at different depths so the
  remarriage rendering shows up in the default demo: Матвей Щербаков (`@I3@`,
  ring 1) and Антон Кузнецов (`@I98@`, ring 3) each have two wives and children
  by both. Use them to check that the spouses fan out beside a single card and
  that every marriage gets its own stub.

## Structure

```
messages/         en.json + ru.json — ICU message catalogs (next-intl convention)
src/
  settings.ts     Settings type, defaults, print sizes
  errors.ts       AppError with translation codes
  i18n/           t(), locale switching (intl-messageformat)
  gedcom/         GEDCOM parser (types, parser, sample)
  tree/           descendant tree (build)
  layout/         radial layout (radial)
  render/         TreeRenderer + palette (renderer, palette)
  export/         JPEG export (exportJpeg)
  ui/             descriptors and panel generation (controls)
  main.ts         state and wiring
  style.css       app styles (do not affect the SVG scene)
```

The neighboring folder `../radial-family-tree-vizualizer` is the previous
implementation, kept as reference; do not modify it.
