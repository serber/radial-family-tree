# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Radial GEDCOM family tree visualizer (Vite + TypeScript + D3, no framework). UI is bilingual en/ru: `messages/{en,ru}.json` in the next-intl convention (ICU syntax, Russian plurals), formatted by `intl-messageformat` via `src/i18n` — next-intl itself is Next-only and deliberately not used. All UI strings go through `t()`; deep modules throw `AppError` codes (`src/errors.ts`) instead of message strings; new controls take `labelKey`, not text. This is a from-scratch rewrite of `../radial-family-tree-vizualizer` (kept as reference only — don't modify it).

Detailed docs live in `docs/` (English — keep them that way): architecture, layout algorithm, GEDCOM subset, settings reference, export, development, deployment (Ubuntu/nginx). Keep them in sync when changing the corresponding code.

## Commands

```bash
npm run dev        # dev server with HMR
npm run build      # tsc --noEmit (strict) + vite build → dist/
npm run preview    # serve the built dist/
npx tsc --noEmit   # typecheck only
```

There is no test framework or linter. Verification is done by:
- running parser/tree/layout modules directly in Node (Node 24 runs .ts files natively; the modules are DOM-free by design);
- driving the app in headless Chrome / puppeteer-core with screenshots (`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --headless=new`), including the JPEG export path via intercepting `URL.createObjectURL`. Sample data: `examples/example-large.ged` (bundled default demo — 489 people, synthetic, including two second marriages).

## Architecture

Unidirectional pipeline, one module per stage:

```
GEDCOM text → GedcomData → DescendantTree → Layout → SVG
  gedcom/       tree/          layout/       render/
```

- `src/gedcom/decode.ts` — file bytes → text: BOM / UTF-16 pattern, then valid UTF-8, then the `CHAR` label (ANSEL has its own decoder, code pages go to `TextDecoder`), then a windows-1251 vs 1252 guess. The label is untrustworthy, so bytes win over it.
- `src/gedcom/parser.ts` — tokenizes lines, then a context state machine builds `Map<Individual>/Map<Family>`. References to missing people get stub records rather than failing. The first `NAME` is primary (later ones never overwrite it); a date's year is its *first* 3–4 digit number; `famcId` is the birth family (`PEDI` adopted/foster skipped); a person without a `SEX` tag takes it from their family role (HUSB → M, WIFE → F).
- `src/tree/build.ts` — descendant tree from a chosen root family. A node is a descendant plus *all* their unions: someone with several FAMS stays one card with their spouses fanned out beside them (`marriages`), each union keeping its own children, and each child recording its `parentFamilyId`. The root couple has no blood line, so further unions of *either* root spouse extend the root node. Childless/unmarried children become `single:` leaf nodes; a visited-set guards against cycles (cousin marriages) — first placement wins, and a descendant whose unions are all placed elsewhere degrades to a `single:` leaf. Spouses are ordered blood-line first (`entrySpouseId`). `listRootCandidates` sorts progenitors (no FAMC on either spouse) first, then by descendant count.
- `src/layout/track.ts` — the ring shape: all points at distance d from the spine [-half, half] — a stadium, or a circle at half = 0. Positions are (piece, fraction), normal-aligned across rings; `u` ∈ [0,1) is the shared coordinate; `linkPoints` samples links in these coordinates (never crossing within a band). Stadium, not ellipse: offsets of a stadium stay stadiums with uniform gaps.
- `src/layout/radial.ts` — pure function `computeLayout(tree, settings)`; mutates nothing, returns all geometry. With `collapseChain`, the top single line of descent (root → only child with children → …) folds into the core and ring 1 starts at the first branching. Ring radii come from the gap settings, each ring pushed out only as far as its own cards need (`ringFloor`); then bottom-up demand (`max(own, Σ children)`, as fractions of the ring) and a top-down window split over u ∈ [0, 1) give each node its *ideal* position; then `spreadRing` slides each ring's nodes (in arc length along its inner edge) into their final, overlap-free, `cardSpacing`-apart places. Card coordinates are in a node-local frame: **+x along the ring's outward normal, +y along the ring**; the renderer applies `translate(position) rotate(angleDeg)`.
- `src/render/renderer.ts` — `TreeRenderer` builds the SVG skeleton once (constructor), then `update(layout, settings)` re-renders everything through keyed D3 joins; zoom state lives on a persistent `.zoom-layer` group and survives updates. All styling is set as SVG presentation attributes (not CSS) so serialization for export is self-contained. Text is counter-rotated 180° when a node's angle falls in (90°, 270°) so names never render upside down. The core (`Layout.core`) is a disc or pill cut into one horizontal band per text row — root spouses, then the folded chain «→ name»; at the usual couple that is the familiar top/bottom halves. Links are drawn from the layout's `points` (track coordinates: distance linear, u smoothstep; Catmull-Rom through samples): they bend along the rings, never cross the center, and never cross each other within a generation band — do not go back to Cartesian Béziers, which crossed dozens of times on large files.
- `src/export/exportJpeg.ts` — clones the SVG, strips the zoom transform, sets a viewBox from `layout.extent` (a stadium is wider than tall), then XMLSerializer → blob URL → `<img>` → canvas → JPEG. No external libraries; keep it that way (the old project's dom-to-image dependency was a known defect).
- `src/ui/controls.ts` — the settings panel is generated from `controlGroups` descriptors. To add a setting: extend `Settings` + `defaultSettings` in `src/settings.ts`, add a descriptor here, and consume it in layout/renderer. Never hand-write control markup in index.html; the descriptor approach exists to prevent HTML↔JS id drift.
- `src/main.ts` — owns app state (`data`, `tree`, `layout`, `settings`) and wiring. Settings changes recompute only `Layout → SVG`; root-family changes rebuild from `DescendantTree`.

Settings semantics worth knowing: `shapeStretch` is width : height (1 = circle; >1 = stadium with `half = (k − 1) · outer`); all ring measures are arc lengths along the track, never raw angles; `cardLength` is the card's *radial* extent and `cardThickness` its *tangential* extent (neither ever moves a ring — instead the layout shortens cards that would reach the next ring, returns the drawn length as `Layout.cardLength`, and the status bar says so; angular demand is measured at the cards' *inner* edge, which is what makes them overlap-free); card names are cut by measured width (canvas `measureText`), not by character count; ring steps are per ring (`ringSteps`, empty = defaults 215 for rings 1–2 and 180 beyond via `defaultRingStep`/`ringStep` in `src/settings.ts`; cleared on loading another file); the «Кольца» panel group has one slider per ring of the current layout (`Layout.ringCards` gives the count and the card numbers in the labels; `main.ts` rebuilds the panel when it changes) plus «Плотно» (`compactSteps`: tightest steps with no card shortened and no ring pushed) and «Сбросить»; each step moves only its own ring and those outside it — a ring leaves its slider position only when its *own* cards don't fit (`ringFloor`), never because another ring is crowded (there is no global scale factor any more; it coupled the sliders backwards), and such rings are reported in `Layout.pushedRings` / the status bar; `cardSpacing` is a guarantee: sectors give each node its *ideal* angle, then `spreadRing` slides each ring's nodes (order kept, least-squares shift, isotonic regression) until neighbours are `cardSpacing` apart; `tightSpouses` glues a block's cards together, which is why the marriage line is invisible by default; `canvasColor` is the chart background on screen and in export. The core radius, `JUNCTION_DEPTH` (16) and `SPOUSE_LINE_INSET` (6) are derived/fixed in `src/layout/radial.ts`, not settings. `PRINT_SIZES` mixes landscape 300 DPI print formats (A3–A0) with screen presets (Full HD, 4K, square). Full table: `docs/settings.md`.

Design language (from a Claude Design mockup, July 2026): warm paper palette (bg `#efece4`, panels `#faf8f3`), teal accent `--acc: #0f766e`, UI font Manrope, chart font Spectral (Google Fonts; the export inlines Spectral as data URIs — see `chartFontCss` in `src/export/exportJpeg.ts`). The entry strip is derived from the card's fill color (`accentFor` — same hue, darker and calmer); the card stroke is not derived, it comes from the `borderColor` setting.
