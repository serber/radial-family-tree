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

- `src/gedcom/parser.ts` — tokenizes lines, then a context state machine builds `Map<Individual>/Map<Family>`. References to missing people get stub records rather than failing.
- `src/tree/build.ts` — descendant tree from a chosen root family. A node is a descendant plus *all* their unions: someone with several FAMS stays one card with their spouses fanned out beside them (`marriages`), each union keeping its own children, and each child recording its `parentFamilyId`. The root couple has no blood line, so further unions of *either* root spouse extend the root node. Childless/unmarried children become `single:` leaf nodes; a visited-set guards against cycles (cousin marriages) — first placement wins, and a descendant whose unions are all placed elsewhere degrades to a `single:` leaf. Spouses are ordered blood-line first (`entrySpouseId`). `listRootCandidates` sorts progenitors (no FAMC on either spouse) first, then by descendant count.
- `src/layout/radial.ts` — pure function `computeLayout(tree, settings)`; mutates nothing, returns all geometry. Two passes: bottom-up angular weights (`weight = max(ownRequiredAngle, Σ children)`), then top-down proportional angle assignment over [-π, π]. Card coordinates are in a node-local frame: **+x radially outward, +y tangential**; the renderer applies `translate(position) rotate(angleDeg)`.
- `src/render/renderer.ts` — `TreeRenderer` builds the SVG skeleton once (constructor), then `update(layout, settings)` re-renders everything through keyed D3 joins; zoom state lives on a persistent `.zoom-layer` group and survives updates. All styling is set as SVG presentation attributes (not CSS) so serialization for export is self-contained. Text is counter-rotated 180° when a node's angle falls in (90°, 270°) so names never render upside down. The root disc is a pie of one wedge per person, which at the usual two collapses to the familiar top/bottom halves.
- `src/export/exportJpeg.ts` — clones the SVG, strips the zoom transform, sets a viewBox from `layout.maxRadius`, then XMLSerializer → blob URL → `<img>` → canvas → JPEG. No external libraries; keep it that way (the old project's dom-to-image dependency was a known defect).
- `src/ui/controls.ts` — the settings panel is generated from `controlGroups` descriptors. To add a setting: extend `Settings` + `defaultSettings` in `src/settings.ts`, add a descriptor here, and consume it in layout/renderer. Never hand-write control markup in index.html; the descriptor approach exists to prevent HTML↔JS id drift.
- `src/main.ts` — owns app state (`data`, `tree`, `layout`, `settings`) and wiring. Settings changes recompute only `Layout → SVG`; root-family changes rebuild from `DescendantTree`.

Settings semantics worth knowing: `cardLength` is the card's *radial* extent and `cardThickness` its *tangential* extent (neither ever moves a ring); `innerRingGap` is the gap for both of the first two rings, keeping the sparse core readable; `ringGap` is the base gap from ring 3 on and `ringGrowth` (≥ 1) multiplies it once per generation, so outer rings spread *wider*, never tighter; `cardSpacing` is a wish funded from spare angle, not a guarantee; `tightSpouses` glues a block's cards together, which is why the marriage line is invisible by default; `canvasColor` is the chart background on screen and in export. The root disc radius, `JUNCTION_DEPTH` (16) and `SPOUSE_LINE_INSET` (6) are derived/fixed in `src/layout/radial.ts`, not settings. `PRINT_SIZES` mixes landscape 300 DPI print formats (A3–A0) with screen presets (Full HD, 4K, square). Full table: `docs/settings.md`.

Design language (from a Claude Design mockup, July 2026): warm paper palette (bg `#efece4`, panels `#faf8f3`), teal accent `--acc: #0f766e`, UI font Manrope, chart font Spectral (Google Fonts; the export inlines Spectral as data URIs — see `chartFontCss` in `src/export/exportJpeg.ts`). The entry strip is derived from the card's fill color (`accentFor` — same hue, darker and calmer); the card stroke is not derived, it comes from the `borderColor` setting.
