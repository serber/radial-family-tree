# Radial layout algorithm

All computation lives in `src/layout/radial.ts` — the pure function
`computeLayout(tree, settings): Layout`. Input: the family tree and settings.
Output: finished geometry — placed nodes, link lines, rings and the outer
radius. It mutates nothing and touches neither DOM nor D3.

## Generation rings

Base radii come from the layout settings alone — card size deliberately plays
no part, so resizing cards never moves a ring:

```
r(0) = 0                                        // root at the center
r(g) = r(g-1) + gap(g)

gap(g) = innerRingGap                           for g ≤ 2
gap(g) = ringGap · ringGrowth^(g-3)             for g ≥ 3
```

So the first two steps are both `innerRingGap` (the sparse core, tuned
separately for readability), and from ring 3 on each gap is the previous one
times `ringGrowth`. `ringGrowth` is ≥ 1 — every further ring holds more cards,
so the gaps **grow** outward rather than decaying.

These radii are a starting point; the two corrections below may push them out,
never pull them in.

## Two tree passes

### 1. Bottom-up: angular demand

Each subtree reports two angular appetites, both measured in radians on the
node's own ring:

```
spouseGap = tightSpouses ? 0 : cardSpacing
block     = N·cardThickness + (N−1)·spouseGap    // N — visible cards in the block
need      = block / max(radius, 1)               // bare cards, touching
want      = (block + cardSpacing) / max(radius, 1)

need(node) = children ? max(own.need, Σ need(child)) : own.need
want(node) = children ? max(own.want, Σ want(child)) : own.want
```

The distinction carries the whole policy: **`need` is the only quantity
allowed to push the rings outwards** — below it cards would overlap. `want` is
a wish for `cardSpacing`, funded from whatever free angle the circle happens
to have. The root sits at radius 0 and draws no cards, so its own demand is
zero.

`max` means a node claims as much space as either itself or its subtree
needs — whichever is larger.

### 2. Top-down: angle assignment

The root gets the full circle `[-π, π]`; every node is centered in its sector,
and `splitWindow` divides that sector between the children:

- every child is first guaranteed its `need`;
- the leftover buys as much of the requested spacing as it covers, shared in
  proportion to how much each child asked for (`need + (want − need)·fill`);
- if the window is roomier than the total `want`, the surplus is spread
  proportionally to `want` — the tree always fills the whole circle.

The fill fraction is solved **per parent**, not once globally, so a packed
branch cannot starve a sparse one on the other side of the tree: each region
spends the slack sitting above it.

## Ring auto-expansion

Two independent corrections, applied in this order:

- **Global scale (anti-overlap).** If the root's `need` at the base radii
  exceeds `2π`, bare cards cannot fit the circle at all. Angular demand falls
  as roughly `1/radius`, so the smallest sufficient factor is found by
  doubling an upper bound (capped at 4096×) and then 40 bisection steps. All
  radii are multiplied by it — anything less would overlap, anything more
  wastes the sheet.
- **Per-ring growth (spacing wishes).** For each ring the total arc its cards
  would like (`Σ block + cardSpacing`, radius-independent px along the arc) is
  divided by `2π`. A ring grows towards that radius only if it is larger than
  the ring's base, and only up to `GROWTH_CAP` (1.5×) of that base. A ring
  that already has room keeps its radius; a crowded ring pushes itself — and
  everything beyond it, so the gaps are preserved — outward, never the reverse.

Result: blocks never overlap regardless of tree size, and the settings only
ever get looser, never violated.

The central disc is derived, not configured: `rootRadiusFor` takes the largest
radius that still leaves the first ring's cards room
(`r(1) − cardLength/2 − JUNCTION_DEPTH − 8`), capped at 55 % of `r(1)` and
floored at 12.

## Coordinate systems

The global system is SVG with the origin at the root (the viewBox is centered
at `0,0`). Node position: `(cos α · r, sin α · r)`.

Cards are described in the **node-local frame**:

- `+x` — radially outward from the center;
- `+y` — tangential (along the ring).

The renderer applies `translate(position) rotate(angleDeg)` to the node
group — the layout itself does no rotation, it only records `rotationDeg`.
`cardLength` is the card's radial extent, `cardThickness` the tangential one.
The block of cards is centered on the node axis along `y`.

## Connection points

- **Entry** (end of the link from the parent) — the middle of the inner edge
  of the blood-line spouse's card (`isEntry`).
- **Stub to children** — one per union that produced children (`stubs`), a
  short segment running outward by `JUNCTION_DEPTH` from the marriage line at
  the outer card edge. It starts on the seam between that union's spouse card
  and the card before it: the blood-line person for the first union, the
  previous spouse for every one after. So with cards stacked
  `[person, wife 1, wife 2]` the second union's descendants part from between
  the two wives, not from the middle of the block, and each marriage fans its
  own children out from its own pair. A link picks its stub by the child's
  `parentFamilyId`. A childless union still consumes its seam, so the unions
  after it stay aligned with their own spouse cards.
- **Root** — links start on the root disc circumference, in the direction of
  the child; the root has no stubs.

Line shapes are the renderer's job: every link is a cubic Bézier whose control
points are laid along the radial directions of parent and child, with
`tension = min(0.35 · dist, 0.6 · ringGap)`.

## Result

```ts
interface Layout {
  nodes: PlacedNode[];   // position, rotation, cards, stubs
  links: PlacedLink[];   // start/end + unit directions for the curves
  rings: number[];       // ring radii 1..maxGeneration
  rootRadius: number;    // derived radius of the central disc
  maxRadius: number;     // outer extent — for fit-to-view and export
}
```

`maxRadius` is `r(maxGeneration) + cardLength/2 + JUNCTION_DEPTH`.

Keys for D3 joins: node id for nodes — the id of the person's **first** union
(`@F1@`) or `single:@I5@` for a leaf; child node id for links; person id for
the cards inside a node; family id for the stubs inside a node.
