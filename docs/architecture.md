# Architecture

## Data flow

The app is a unidirectional pipeline. Each stage is a separate module with its
own input/output types, and no stage mutates the data of the previous one:

```
GEDCOM text ──parseGedcom──▶ GedcomData ──buildTree──▶ DescendantTree ──computeLayout──▶ Layout ──update──▶ SVG
                src/gedcom/                src/tree/                     src/layout/            src/render/
```

Changes are processed from the earliest affected stage only:

- a setting changed → recompute `Layout → SVG` only;
- another root family selected → from `DescendantTree`;
- a new file loaded → the whole pipeline.

## Modules

### `src/gedcom` — parser
`parseGedcom(raw): GedcomData` turns text into `Map<Individual>` and
`Map<Family>`. Two-phase parsing: lines are tokenized first
(`level / @xref@ / TAG / value`), then a small state machine assembles
INDI/FAM records. Details in [gedcom.md](gedcom.md).

### `src/tree` — descendant tree
`buildTree(data, rootFamilyId): DescendantTree` builds a tree whose node is a
**descendant together with every union they founded**, not a single family:

- spouses in a node are ordered blood-line first (`entrySpouseId`) — the one
  who is a child of the parent family — followed by one card per union;
- a child who founded several families (remarriages) stays **one** node: the
  extra spouses fan out beside them, and `marriages` lists each union in
  display order. Every union gets its own stub, so the children of each
  marriage hang off their own parents rather than off a shared point;
- each child records the union it descends from in `parentFamilyId`, which is
  what pairs a link with the right stub;
- a child with no union of their own becomes a leaf with id `single:<indiId>`;
- cycle protection (marriages between relatives): a visited-family set; on
  re-entry the family stays where it was first placed. A descendant whose every
  union is already drawn elsewhere still appears, as a `single:` leaf;
- the root couple has no blood line to pivot on, so both spouses get a card and
  the further unions of *either* of them extend the root node — otherwise those
  branches, and all their descendants, would be missing from the chart.

`listRootCandidates(data)` returns candidate root families: progenitors first
(neither spouse has a FAMC), sorted by descendant count within each group.

### `src/layout` — layout
`computeLayout(tree, settings): Layout` is a pure function and the only place
where geometry is computed. Knows nothing about DOM or D3. The algorithm is
described in [layout.md](layout.md).

### `src/render` — renderer
The `TreeRenderer` class owns the SVG scene:

- the skeleton (layers `rings → links → nodes → root`, zoom behavior,
  ResizeObserver) is built once in the constructor;
- `update(layout, settings)` re-renders the scene through keyed D3 joins —
  moving a slider updates attributes of existing elements without recreating
  the DOM;
- zoom/pan live on a persistent `.zoom-layer` group and survive any update;
  `fitToContent(maxRadius)` fits the tree into the window;
- **all styling is set via SVG presentation attributes, not CSS** — a
  deliberate decision: the serialized SVG is self-contained and the export
  does not depend on external styles;
- card labels are counter-rotated by 180° when the node angle falls into
  (90°, 270°), so names on the left half of the circle are never upside down.

### `src/export` — JPEG export
A native chain: “clone SVG → XMLSerializer → `<img>` → canvas → JPEG”, with
no third-party libraries. Details in [export.md](export.md).

### `src/ui` — settings panel
Controls are **generated** from the `controlGroups` descriptor array
(`ui/controls.ts`) instead of being hand-written in HTML. This eliminates the
whole class of “markup id drifted away from the handler” bugs. How to add a
new setting: see [settings.md](settings.md).

### `src/i18n` — translations
A thin wrapper over **intl-messageformat** — the same ICU engine and the same
`messages/en.json` / `messages/ru.json` convention as next-intl in the air360
portal (next-intl itself is Next.js/React-only, hence not used directly).
`t(key, values)` resolves dot-path keys with an English fallback; ICU plurals
cover Russian forms. The locale persists in `localStorage` (`radial-locale`),
defaults from `navigator.language`. Deep modules never format messages:
parser/tree/export throw `AppError` with a code (`src/errors.ts`), and the UI
layer translates via `errors.<code>`.

### `src/main.ts` — wiring
Owns the application state (`data`, `tree`, `layout`, `settings`) and wires
up the panel, file loading (button + drag & drop), root selection, export,
the status bar and the language switcher. On locale change every visible
string is re-applied: static texts via `data-i18n` attributes, the settings
panel is rebuilt (keeping collapsed states), selects are repopulated, the
chart re-renders for translated tooltips.

## Key decisions (and why)

| Decision | Motivation |
| --- | --- |
| Separate pipeline stages with typed boundaries | The previous implementation mixed parser, layout and rendering in one 1200-line IIFE; geometry was written directly into tree nodes |
| Layout as a pure function | Recomputing on every slider move is safe and cheap; the module is testable in Node without a browser |
| SVG skeleton built once, updates via joins | Previously every change recreated the whole scene including the zoom behavior |
| Styles as SVG attributes | Export serializes the SVG as-is; no CSS inlining required |
| Control descriptors | HTML and handlers cannot drift out of sync |
| Export without dom-to-image | The library was heavy and produced unpredictable scale; native serialization is deterministic |
