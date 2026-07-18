# Radial layout algorithm

All computation lives in `src/layout/radial.ts` — the pure function
`computeLayout(tree, settings): Layout`. Input: the family tree and settings.
Output: finished geometry — placed nodes, link lines, rings and the outer
radius.

## Generation rings

Radius of generation `g`:

- `g = 0` → `0` (root at the center);
- `g = 1` → `firstRadius`;
- each further step equals `generationGap` multiplied by `generationDecay`
  for every generation starting from the third:

```
r(0) = 0
r(1) = firstRadius
r(g) = r(g-1) + generationGap · decay^(g-2)   for g ≥ 2
```

The decay (`< 1`) matters for large trees: outer generations are more
numerous, and equal spacing would inflate the poster.

## Two tree passes

### 1. Bottom-up: angular weights

Every node needs a minimal angular span on its ring so family blocks never
overlap:

```
block     = N·cardHeight·scale + (N−1)·spouseGap        // N — visible spouses
arc       = block + familySpacing·scale
ownAngle  = arc / max(radius, firstRadius)
weight    = max(ownAngle, Σ weight(children))           // leaf: ownAngle
```

`scale` equals `coreScale` for generations 1–2 and `1` beyond. Dividing arc
length by radius converts it to an angle; for the root the radius is replaced
by `firstRadius` to avoid division by zero.

The meaning of `max`: a node claims as much space as either itself or its
subtree needs — whichever is larger.

### 2. Top-down: angle assignment

The root gets the full circle `[-π, π]`. Every node is centered in its
sector, and the sector is split between children proportionally to their
weights. When the weight sum is smaller than the sector, subtrees stretch
uniformly — the tree always fills the whole circle.

### Ring auto-expansion

The ring radii derived from settings are a **minimum**, guarded in two ways:

- **Radially**: every ring gap is clamped to at least the card radial extent
  (plus `junctionDepth` and clearance), and the first ring clears the root
  disc — cards of neighbouring generations can never overlap radially even
  when `generationGap < cardWidth`.
- **Angularly**: when the root weight exceeds `2π` (large trees would
  compress blocks into overlap), all radii are multiplied by
  `rootWeight / 2π` and the weights are recomputed — angular demand scales
  roughly as `1/radius`, so up to 4 iterations converge.

Result: family blocks never overlap regardless of tree size; the settings
only get looser, never violated.

## Coordinate systems

The global system is SVG with the origin at the root (the viewBox is centered
at `0,0`). Node position: `(cos α · r, sin α · r)`.

Spouse cards are described in the **node-local frame**:

- `+x` — radially outward from the center;
- `+y` — tangential (along the ring).

The renderer applies `translate(position) rotate(angleDeg)` to the node
group — the layout itself does no rotation, it only records `rotationDeg`.
`cardWidth` is the card's radial extent, `cardHeight` the tangential one.
The spouse block is centered on the node axis along `y`.

## Connection points

- **Entry** (end of the link from the parent) — the middle of the inner edge
  of the blood-line spouse's card (`isEntry`).
- **Stub to children** — a short segment from the outer edge of the
  blood-line spouse's card outward by `junctionDepth`; all child links start
  from its end (`junction`).
- **Root** — links start on the root disc circumference, in the direction of
  the child.

Line shapes are the renderer's job: straight (`L`) or cubic Béziers whose
control points are laid along the radial directions of parent and child
(`tension = min(0.35·dist, 0.6·generationGap)`).

## Result

```ts
interface Layout {
  nodes: PlacedNode[];   // position, rotation, cards, connection points
  links: PlacedLink[];   // start/end + unit directions for the curves
  rings: number[];       // ring radii 1..maxGeneration
  maxRadius: number;     // outer extent — for fit-to-view and export
}
```

Keys for D3 joins: family id for nodes (`@F1@` / `single:@I5@`), child node
id for links.
