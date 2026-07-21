# Settings reference

All settings live in the `Settings` type (`src/settings.ts`); the panel is
generated from the `controlGroups` descriptors (`src/ui/controls.ts`).
Changing any setting recomputes the layout and updates the SVG; zoom state is
preserved. Panel labels come from `messages/{en,ru}.json` (`controls.*` and
`groups.*` keys); the Russian variants are listed below next to each key.

The three tables below mirror the three panel groups, in panel order.

## Layout («Компоновка»)

| Panel label | Key | Range | Default | Effect |
| --- | --- | --- | --- | --- |
| Расстояние между кольцами | `ringGap` | 60–500 | 180 | Base gap between rings, applied from ring 3 on |
| Рост внешних колец | `ringGrowth` | 100–160 % | 112 % | Multiplier applied to the gap once per generation from ring 3 on; stored as 1.0–1.6. Outer rings hold more cards, so each gap is *larger* than the previous one — this grows the chart, it never compresses it |
| Расстояние между кольцами 1 и 2 | `innerRingGap` | 60–600 | 215 | Gap used for both of the first two steps (root→1 and 1→2). Keeps the sparse core readable independently of `ringGap` |
| Расстояние между карточками | `cardSpacing` | 0–160 | 10 | Arc length kept free between neighbouring cards on a ring. A wish, not a guarantee: it is funded from whatever free angle the circle has (see [layout.md](layout.md)) |

## Card («Карточка»)

| Panel label | Key | Range | Default | Effect |
| --- | --- | --- | --- | --- |
| Длина карточки | `cardLength` | 40–320 | 145 | Card extent along the **radial** axis |
| Толщина карточки | `cardThickness` | 8–140 | 25 | Card extent along the **tangential** axis |
| Размер шрифта | `fontSize` | 6–26 | 12 | Card name size, in SVG units |
| Жирный шрифт | `boldFont` | on/off | off | Card names at weight 700 instead of 400 |
| Скругление углов | `cornerRadius` | 0–30 | 0 | `rx` of the card rectangles; the entry strip is clipped to the same silhouette |
| Супруги без зазора | `tightSpouses` | on/off | on | Glues the cards of one block together whatever `cardSpacing` says. The marriage line lives in that gap, so at the default (on) it has zero length and is invisible |
| Показывать обоих супругов | `showBothSpouses` | on/off | on | When off, only the blood-line spouse remains — for a person married several times all the spouse cards collapse, and every marriage's children then hang off the one remaining card |

Neither card dimension ever moves a ring: radii are derived from the layout
settings alone, so resizing cards never reflows the generations.

## Style («Стиль»)

| Panel label | Key | Range | Default | Effect |
| --- | --- | --- | --- | --- |
| Цвет карточки — мужчина | `maleColor` | color | `#d8e7f8` | Fill of male cards; the entry-strip accent is derived from it automatically |
| Цвет карточки — женщина | `femaleColor` | color | `#fadbe7` | Same for female cards |
| Цвет рамки | `borderColor` | color | `#b7bccb` | Card outline, for every sex |
| Цвет линии | `lineColor` | color | `#b7bccb` | Links, stubs and the marriage line |
| Толщина линии | `lineWidth` | 0.2–6 (step 0.1) | 1.4 | Same three |
| Кольца поколений | `showRings` | on/off | on | Dashed guide circles, one per generation |
| Цвет колец | `ringColor` | color | `#d9d2c2` | Color of those circles |
| Цвет полотна | `canvasColor` | color | `#f7f4ee` | Chart background, on screen and in the export |

Note: card “length” and “thickness” are relative to the radius, not the
screen — a card 145 long is stretched **from the center outward**. More on
coordinate systems in [layout.md](layout.md).

## Not settings

Some geometry that looks tunable is deliberately fixed in code — it exists to
keep the drawing correct rather than to be styled:

| Constant | Where | Value | Meaning |
| --- | --- | --- | --- |
| root disc radius | `rootRadiusFor`, `src/layout/radial.ts` | derived | Fitted to the first ring: as large as the inner gap allows while leaving the first ring's cards room, capped at 55 % of that radius |
| `JUNCTION_DEPTH` | `src/layout/radial.ts` | 16 | Length of the stub from the marriage line to the fan-out point of child links |
| `SPOUSE_LINE_INSET` | `src/layout/radial.ts` | 6 | Inset of the marriage line from the cards' outer edge; the stub starts there |
| `GROWTH_CAP` | `computeLayout` | 1.5 | How far a crowded ring may push itself out beyond its base radius |
| text, ring guide and unknown-sex colors | `palette`, `src/render/palette.ts` | fixed | Not exposed in the panel on purpose |

## Export sizes

`PRINT_SIZES` (`src/settings.ts`) is the canvas preset list for the JPEG
export, not part of `Settings`. Each `key` doubles as the i18n key of the
visible label (`printSizes.<key>`). See [export.md](export.md).

| Key | Size (px) | Kind |
| --- | --- | --- |
| `a3` | 4961×3508 | landscape print, 300 DPI |
| `a2` | 7016×4961 | landscape print, 300 DPI |
| `a1` | 9933×7016 | landscape print, 300 DPI |
| `a0` | 14043×9933 | landscape print, 300 DPI |
| `fullhd` | 1920×1080 | screen |
| `4k` | 3840×2160 | screen |
| `square` | 2400×2400 | screen |

## Adding a new setting

1. Add a field to the `Settings` interface and a value to `defaultSettings`
   (`src/settings.ts`).
2. Add a descriptor to the appropriate `controlGroups` group
   (`src/ui/controls.ts`): `range` (with optional `toValue`/`toDisplay`/
   `format` — see `ringGrowth`, which stores 1.12 but shows «112 %»), `color`
   or `toggle`.
3. Add the label under `controls.<key>` in both `messages/en.json` and
   `messages/ru.json` — the descriptor carries a `labelKey`, never literal text.
4. Consume the value in `computeLayout` and/or `TreeRenderer.update`.

No need to touch `index.html` — the panel is built from descriptors, and key
types are checked by the compiler: `NumericSettingKey`, `BooleanSettingKey`
and `ColorSettingKey` are derived from `Settings`, so a control can only point
at a field of the matching type.

## Colors and font

Male/female card fills are configurable via the pickers (see above); the
accent color of the blood-line strip is not chosen separately — it is derived
from the fill (same hue, darker and less saturated, `accentFor` in
`src/render/palette.ts`, memoised per fill). The card stroke is *not* derived:
it always comes from `borderColor`. Cards of unknown sex use a fixed gray pair
from `palette.unknown`. The sidebar legend syncs with the chosen colors via
the `--male`/`--female` CSS variables. Text and ring-guide colors are fixed in
the same `palette` constant and are deliberately not exposed in the panel.

Typography: the UI uses Manrope, the chart uses Spectral (both from Google
Fonts, loaded in `index.html`); `FONT_STACK` falls back to Georgia. The
export embeds Spectral into the serialized SVG — see [export.md](export.md).
