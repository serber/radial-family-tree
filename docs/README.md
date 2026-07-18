# Documentation

Radial family tree visualizer for GEDCOM files. The descendant tree is laid
out on generation rings around the root couple; the result can be tuned for
print and exported as JPEG (up to A0, 300 DPI).

## Contents

| Document | Covers |
| --- | --- |
| [architecture.md](architecture.md) | Modules, data flow, key decisions |
| [layout.md](layout.md) | Radial layout algorithm: weights, angles, coordinate systems |
| [gedcom.md](gedcom.md) | Supported GEDCOM subset and parser behavior |
| [settings.md](settings.md) | Reference for every panel setting |
| [export.md](export.md) | How the print-ready JPEG export works |
| [development.md](development.md) | Running, building, verifying changes |
| [deployment.md](deployment.md) | Deploying and updating on an Ubuntu server (nginx) |

## Quick start

```bash
npm install
npm run dev
```

Open the dev server URL, click «Пример» (sample) or drag & drop your own
`.ged` file onto the canvas. The root family can be changed in the dropdown —
progenitors (couples with no recorded parents) are listed first.
