# JPEG export

Module: `src/export/exportJpeg.ts`. The export is fully native — no
`dom-to-image` or similar libraries (in the previous implementation such a
dependency produced unpredictable scale and added weight).

## Formats

`PRINT_SIZES` in `src/settings.ts` — landscape print formats at 300 DPI plus
screen presets:

| Key | Size | Pixels |
| --- | --- | --- |
| `a3` | A3 (300 DPI) | 4961 × 3508 |
| `a2` | A2 (300 DPI) | 7016 × 4961 |
| `a1` | A1 (300 DPI) | 9933 × 7016 |
| `a0` | A0 (300 DPI) | 14043 × 9933 |
| `fullhd` | Full HD | 1920 × 1080 |
| `4k` | 4K UHD | 3840 × 2160 |
| `square` | Square | 2400 × 2400 |

## How it works

```
live SVG ──clone──▶ clone without zoom transform ──viewBox from maxRadius──▶
XMLSerializer ──▶ Blob (image/svg+xml) ──▶ <img> ──▶ canvas (white bg) ──▶ toBlob('image/jpeg', 0.95)
```

1. **Cloning.** The live SVG is cloned whole; the `.zoom-layer` transform is
   removed from the clone — the export always shows the entire tree and does
   not depend on the on-screen zoom.
2. **Framing.** The content square side comes from `layout.maxRadius` (the
   layout's outer extent) with a 4 % margin; the square is then fitted into
   the print sheet proportions (contain, centered) — that becomes the clone's
   `viewBox`. The scale is deterministic: computed from geometry, not from
   screen state.
3. **Fonts.** The chart uses Spectral (a web font), and the rasterizing
   `<img>` cannot load external resources — so the export fetches the Google
   Fonts CSS once, inlines every font file as a `data:` URI and injects the
   result as a `<style>` into the clone (cached per session). If the fetch
   fails (offline), the serif fallback from `FONT_STACK` (Georgia) applies.
4. **Rasterization.** The serialized SVG is loaded as an `<img>` via a blob
   URL and drawn onto a print-sized canvas over a `canvasColor` fill (JPEG
   has no alpha channel).

This works only because the renderer styles everything with SVG presentation
attributes — the serialized document is self-contained and needs no external
CSS. **Preserve this property when changing the renderer**: any style applied
via a CSS class will be silently lost in the export (the embedded font CSS
from step 3 is the single deliberate exception).

## Limitations

- A0 is a ~139 MP canvas; current Chrome/Safari handle it, but it is close to
  canvas area limits. A larger format would require tiled rendering.
- Tooltips (`<title>`) do not appear in the raster — expected.
- File name: `family-tree-<key>.jpg`.
