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
| Вытянутость (100% — круг) | `shapeStretch` | 100–300 % (step 5) | 100 % | Width : height of the chart; stored as 1.0–3.0. At 100 % the rings are circles; above it they become stadiums around a straight central spine — descendants stand in columns along the sides and fan out round the ends. ≈ 141 % matches a landscape A-sheet (see [layout.md](layout.md#shape-circle-or-stadium)) |
| Одиночную линию — в центр | `collapseChain` | on/off | on | While the top of the tree is a single line (root → only child → only child…, each with children of its own), those generations are listed in the core («→ Элем») and ring 1 starts at the first real branching (see [layout.md](layout.md#core-and-the-folded-line-of-descent)) |
| Зазор между карточками | `cardSpacing` | 0–160 | 10 | Minimum distance between neighbouring cards on a ring — guaranteed. Cards slide along their ring to get it; a ring whose own cards can't get it moves out just far enough, and the status bar names it (see [layout.md](layout.md#ring-floors)) |

## Rings («Кольца»)

One step slider per ring of the chart on screen — the group is rebuilt when
the number of rings changes (another file or root, «Одиночную линию — в
центр»). Density differs from tree to tree and ring to ring, so each label
also says how many cards sit on that ring («Кольцо 7 · 209 карточек»).

| Control | Key | Range | Default | Effect |
| --- | --- | --- | --- | --- |
| Кольцо N | `ringSteps[N−1]` | 60–600 px (more if «Плотно» went higher) | 215 for rings 1–2, 180 beyond (`defaultRingStep`) | Distance of ring N from ring N−1 (ring 1: from the core). Moves ring N and, keeping their own steps, every ring outside it |
| Плотно | — | button | — | Sets every step to the tightest this tree allows (`compactSteps`): one card plus its stub (`cardLength + 16 + 8`, 169 px at the defaults) unless the ring's own cards need more room round it, and ring 1 far enough out for a legible core. No card is shortened and no ring pushed |
| Сбросить | — | button | — | Back to the defaults |

`ringSteps` is empty by default and is cleared when another file is loaded:
steps tuned for one tree mean nothing for the next. Rings past its end use
their defaults.

A step moves exactly its own ring (and those outside it), in the direction it
is dragged — unless the ring's own cards don't fit at that distance, in which
case it stops at its floor and the status bar says «кольца N отодвинуты…».
Below one card plus its stub the cards would reach the next ring, so every
card is shortened, and the status bar says that too.

These sliders replace the earlier «Шаг колец 1–2», «Шаг колец с 3-го», «Рост
шага с каждым кольцом» and «Шаг двух внешних колец», which could only set
rings in fixed groups.

## Card («Карточка»)

| Panel label | Key | Range | Default | Effect |
| --- | --- | --- | --- | --- |
| Длина карточки | `cardLength` | 40–320 | 145 | Card extent along the **radial** axis. A request: when the rings are too close for cards that long, the layout draws them shorter and the status bar says so (see [layout.md](layout.md#card-length-limit)) |
| Толщина карточки | `cardThickness` | 8–140 | 25 | Card extent along the **tangential** axis |
| Размер шрифта | `fontSize` | 6–26 | 12 | Card name size, in SVG units. A name wider than the card is cut with «…» by its measured width; the full name stays in the tooltip |
| Жирный шрифт | `boldFont` | on/off | off | Card names at weight 700 instead of 400 |
| Скругление углов | `cornerRadius` | 0–30 | 0 | `rx` of the card rectangles; the entry strip is clipped to the same silhouette |
| Супруги без зазора | `tightSpouses` | on/off | on | Glues the cards of one block together whatever `cardSpacing` says. The marriage line lives in that gap, so at the default (on) it has zero length and is invisible |
| Показывать обоих супругов | `showBothSpouses` | on/off | on | When off, only the blood-line spouse remains — for a person married several times all the spouse cards collapse, and every marriage's children then hang off the one remaining card |

Neither card dimension ever moves a ring: radii are derived from the layout
settings alone, so resizing cards never reflows the generations. The flip side
is that cards give way to rings, not the other way round — a card longer than
the gap between two rings is shortened rather than allowed to reach into the
next one.

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
| core radius | `rootRadiusFor`, `src/layout/radial.ts` | derived | Fitted to the first ring: as large as the inner gap allows while leaving the first ring's cards room, capped at 55 % of that radius |
| `JUNCTION_DEPTH` | `src/layout/radial.ts` | 16 | Length of the stub from the marriage line to the fan-out point of child links |
| `SPOUSE_LINE_INSET` | `src/layout/radial.ts` | 6 | Inset of the marriage line from the cards' outer edge; the stub starts there |
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
   `format` — see `shapeStretch`, which stores 1.4 but shows «140 %»), `color`
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
from `palette.unknown`; the legend shows a third «Пол не указан» swatch only
when the drawn tree contains such cards. The sidebar legend syncs with the chosen colors via
the `--male`/`--female` CSS variables. Text and ring-guide colors are fixed in
the same `palette` constant and are deliberately not exposed in the panel.

Typography: the UI uses Manrope, the chart uses Spectral (both from Google
Fonts, loaded in `index.html`); `FONT_STACK` falls back to Georgia. The
export embeds Spectral into the serialized SVG — see [export.md](export.md).
