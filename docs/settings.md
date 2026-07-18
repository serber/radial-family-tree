# Settings reference

All settings live in the `Settings` type (`src/settings.ts`); the panel is
generated from the `controlGroups` descriptors (`src/ui/controls.ts`).
Changing any setting recomputes the layout and updates the SVG; zoom state is
preserved. Panel labels come from `messages/{en,ru}.json` (`controls.*`
keys); the Russian variants are listed below next to each key.

## Geometry («Геометрия»)

| Panel label | Key | Range | Default | Effect |
| --- | --- | --- | --- | --- |
| Радиус первого круга | `firstRadius` | 60–400 | 140 | Radius of the first generation ring |
| Расстояние между поколениями | `generationGap` | 80–400 | 100 | Base step between rings |
| Сжатие радиуса | `generationDecay` | 50–100 % | 100 % | Gap multiplier per generation from the 3rd on; stored as 0.5–1.0. Compresses only the part of the gap above the anti-overlap minimum (≈ `cardWidth + junctionDepth + 8`, i.e. ~169 px at defaults) — with the default `generationGap` of 100 the rings already sit at that minimum and the slider has no visible effect until the generation spacing is raised above it (or the cards are made narrower) |
| Радиус корневого узла | `rootRadius` | 20–200 | 120 | Size of the central disc with the root couple |
| Расстояние между семьями | `familySpacing` | 0–160 | 10 | Arc reserve between neighboring blocks on a ring |
| Промежуток между супругами | `spouseGap` | 0–40 | 0 | Gap between cards inside a family block; the marriage line is drawn in it at the inner edge (invisible at 0) |
| Отступ линии к детям | `junctionDepth` | 0–80 | 16 | Length of the stub from the card to the fan-out point of child links |

## Cards («Карточки»)

| Panel label | Key | Range | Default | Effect |
| --- | --- | --- | --- | --- |
| Ширина карточки | `cardWidth` | 40–320 | 145 | Radial extent of a card |
| Высота карточки | `cardHeight` | 12–140 | 25 | Tangential extent of a card |
| Размер шрифта | `fontSize` | 6–26 | 12 | Scales together with `coreScale` |
| Скругление углов | `cornerRadius` | 0–30 | 0 | `rx` of the rectangles |
| Масштаб 1–2 поколений | `coreScale` | 1.0–3.0× | 1.0× | Enlarges the poster core: cards, font and spacing of generations 1–2 |
| Цвет карточек — мужчины | `maleColor` | color | `#d8e7f8` | Fill of male cards; the strip accent is derived automatically (darker, calmer) |
| Цвет карточек — женщины | `femaleColor` | color | `#fadbe7` | Same for female cards |
| Границы в тон заливки | `autoCardBorder` | on/off | on | When on, the card outline is derived from the fill (`accentFor`); when off, `cardBorderColor` is used |
| Цвет границ карточек | `cardBorderColor` | color | `#8a8579` | Card and root-medallion outline; has effect only when `autoCardBorder` is off |
| Показывать обоих супругов | `showBothSpouses` | on/off | on | When off, only the blood-line spouse remains |

## Lines and background («Линии и фон»)

| Panel label | Key | Range | Default | Effect |
| --- | --- | --- | --- | --- |
| Толщина линий | `lineWidth` | 0.2–6 | 1.4 | Link lines, stubs and the marriage line |
| Цвет линий | `lineColor` | color | `#b7bccb` | |
| Цвет полотна | `canvasColor` | color | `#f7f4ee` | Chart background, on screen and in the export |
| Гладкие линии | `curvedLines` | on/off | on | Cubic Béziers instead of straight lines |
| Кольца поколений | `showRings` | on/off | on | Dashed guide circles |

Note: card “width” and “height” are relative to the radius, not the screen —
a card 145 wide is stretched **from the center outward**. More on coordinate
systems in [layout.md](layout.md).

## Adding a new setting

1. Add a field to the `Settings` interface and a value to `defaultSettings`
   (`src/settings.ts`).
2. Add a descriptor to the appropriate `controlGroups` group
   (`src/ui/controls.ts`): `range` (with optional `toValue`/`toDisplay`/
   `format` — see `generationDecay`), `color` or `toggle`.
3. Consume the value in `computeLayout` and/or `TreeRenderer.update`.

No need to touch `index.html` — the panel is built from descriptors, and key
types are checked by the compiler.

## Colors and font

Male/female card fills are configurable via the pickers (see above); the
accent color of the blood-line strip is not chosen separately — it is derived
from the fill (same hue, darker and less saturated, `accentFor` in
`src/render/palette.ts`). The card stroke and the root medallion outline use
the same derived color while `autoCardBorder` is on, or the explicit
`cardBorderColor` when it is off. The sidebar legend syncs with the chosen
colors via the `--male`/`--female` CSS variables. Text and ring colors, plus
the gray for unknown sex, are fixed in the `palette` constant there and are
deliberately not exposed in the panel.

Typography: the UI uses Manrope, the chart uses Spectral (both from Google
Fonts, loaded in `index.html`); `FONT_STACK` falls back to Georgia. The
export embeds Spectral into the serialized SVG — see [export.md](export.md).
