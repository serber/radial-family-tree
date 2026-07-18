# Radial Family Tree (GEDCOM)

GEDCOM file visualizer: the descendant tree is laid out on radial generation
rings with the root couple at the center. Built with D3.js, Vite and
TypeScript. The UI is bilingual (English/Russian) with a language switcher.

## Running

```bash
npm install
npm run dev      # dev server with hot reload
npm run build    # typecheck + build into dist/
npm run preview  # local preview of the build
```

## Features

- GEDCOM loading (button or drag & drop), built-in sample
  (`examples/example-large.ged`).
- Root family selection from a list (progenitors first, sorted by descendant
  count).
- Adjustable geometry (radii, spacing, generation decay) and styling (cards,
  colors, font, lines) — everything recomputes live, zoom is preserved.
- Names never render upside down on the left half of the circle; card
  tooltips show life years; a marriage line connects spouse cards.
- Zoom/pan, fit-to-view.
- Print-ready JPEG export A2/A1/A0 (300 DPI) — native SVG serialization, no
  third-party libraries.

## Architecture

```
src/
  gedcom/    GEDCOM parser → Map<Individual>, Map<Family>
  tree/      descendant tree from the selected root family
  layout/    pure radial layout computation (no tree/DOM mutation)
  render/    D3 renderer: keyed joins, incremental updates, zoom
  export/    SVG → canvas → JPEG for print
  ui/        settings panel generated from descriptors
  main.ts    app state and module wiring
```

The data flow is unidirectional: `GEDCOM → GedcomData → DescendantTree →
Layout → SVG`. A settings change recomputes only `Layout → SVG`; a root
change starts from `DescendantTree`.

Detailed documentation lives in [docs/](docs/README.md): architecture, layout
algorithm, GEDCOM support, settings reference, export and development.
