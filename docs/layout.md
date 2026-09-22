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
times `ringGrowth` (≥ 1, default 1 — the gaps **grow** outward, never decay).
Crowding is handled by the ring floors below, so growth is only a look.

These radii are what the sliders ask for. A ring moves further out only when
its *own* cards don't fit it (see [Ring floors](#ring-floors)); it is never
pulled in, and no ring ever moves because another one is crowded.

## Angular extent of a block

Everything below measures a family block by the angle it occupies on its ring:

```
spouseGap = tightSpouses ? 0 : cardSpacing
block     = N·cardThickness + (N−1)·spouseGap    // N — visible cards in the block
inner     = radius − cardLength/2                // the cards' inner edge
halfSpan(block, clearance) = atan(block/2 / inner)
                           + asin(clearance / hypot(inner, block/2))
```

Cards are flat rectangles, not ring segments, so a block is widest *in angle*
at its inner corners `(inner, ±block/2)`. The first term is the corner's angle
off the block's axis; the second turns the bounding ray further until it is
`clearance` away from that corner, measured perpendicular to the ray. Points
further out only get further from the ray. So two blocks whose sectors
`±halfSpan(…, cardSpacing/2)` touch are exactly `cardSpacing` apart at their
nearest corners, and blocks with disjoint sectors never overlap. (Measuring at
the ring radius, `block / radius`, lets neighbours collide at their inner
corners.)

## Ring floors

`ringFloor` finds, for each ring alone, the smallest radius at which the sum of
its blocks' spans `Σ 2·halfSpan(block, cardSpacing/2)` fits `2π` — by
bisection, since the spans fall with radius. Then

```
r(g) = max(r(g−1) + gap(g), floor(g))
```

so a ring either sits at its slider-given step from the previous one, or — if
its own cards need more room — just far enough out for them, and the rings
beyond keep their steps to it. These rings are reported as `Layout.pushedRings`
and the status bar names them, so a slider that seems to have stopped working
explains itself.

This is local on purpose. An earlier version scaled *all* radii by one factor
whenever the tree didn't fit, which coupled the sliders the wrong way round:
lowering «Шаг колец с 3-го» inflated rings 1–2, and lowering «Шаг колец 1–2»
made the whole chart larger. `cardSpacing` also grew rings through a separate,
capped per-ring pass that jumped and was not monotone.

## Angles, in two steps

### 1. Ideal angles: sectors, top-down

Each subtree reports two appetites on its own ring — `need` (bare cards,
`clearance = 0`) and `want` (with `cardSpacing`):

```
need(node) = children ? max(own.need, Σ need(child)) : own.need
want(node) = children ? max(own.want, Σ want(child)) : own.want
```

The core gets the whole ring (`u` from 0 to 1); every node is centered in its window,
and `splitWindow` divides that sector between the children: each child first
gets its `need`, the leftover goes towards the `want`s in proportion, and if
the window is roomier than the total `want` the surplus is spread
proportionally. The split is solved **per parent**, so a packed branch cannot
starve a sparse one on the other side of the tree.

This yields each node's *ideal* angle — centered over its own family. It does
not guarantee spacing: a sector runs through every ring, so where an outer
ring is packed, the cards of an inner ring get squeezed together even though
their own ring is almost empty.

### 2. Spreading each ring

`spreadRing` then fixes every ring on its own. Keeping the nodes' circular
order, it moves them along the ring so that neighbours `i`, `i+1` are at least
`halfSpanᵢ + halfSpanᵢ₊₁` apart, with the smallest total squared shift from
the ideal angles:

- with cumulative offsets `c` (`c₀ = 0`, `cᵢ₊₁ = cᵢ + dᵢ`) the positions are
  `xᵢ = yᵢ + cᵢ`, and the constraints become "`y` is non-decreasing" — an
  isotonic regression of `idealᵢ − cᵢ`, solved by pool-adjacent-violators;
- closing the ring adds `y_last − y_first ≤ slack` (the free length); with a
  constant bound the solution is the unbounded one clipped to `[a, a + slack]`,
  and the best `a` is found by ternary search (the cost is convex in `a`);
- the ring is cut at the widest gap between ideal positions.

The ring floors sized every ring for exactly these spans, so `slack ≥ 0` and
the spread always succeeds: **every two neighbouring blocks are at least
`cardSpacing` apart, on every ring**. A block moves only as far as its
neighbours force it to; on a roomy ring nothing moves at all.

## Card length limit

Rings never move for cards, so cards give way to rings instead. A card, its
child stub and some clearance must fit between two rings, and the first ring's
cards must leave room for the smallest core:

```
limit = min( 2·(r(1) − 12 − JUNCTION_DEPTH − 8),         // core ≥ 12
             r(g) − r(g−1) − JUNCTION_DEPTH − 8  for g ≥ 2 )   // RING_CLEARANCE = 8
cardLength_drawn = min(cardLength, limit)
```

The limit is taken on the final rings, floors included, and the two depend on
each other: a longer card needs more angle (its inner edge sits lower), which
may push rings out, which leaves room for a longer card. Both only grow, so
`computeLayout` iterates to a fixed point (at most 8 rounds, starting from the
base radii) and always recomputes the rings for the final length. The drawn
length is returned as `Layout.cardLength`; when it is below the setting, the
status bar tells the user the cards were shortened.

The core radius is derived, not configured: `rootRadiusFor` takes the largest
radius that still leaves the first ring's cards room
(`r(1) − cardLength/2 − JUNCTION_DEPTH − 8`), capped at 55 % of `r(1)` and
floored at 12.

## Shape: circle or stadium

`src/layout/track.ts` defines the shape the rings follow. A ring is every
point at distance `d` from the **spine**, the segment `[-half, half]` on the
x axis — a stadium: two half circles joined by straight sides. `half = 0` is
the circle, so the round chart is a special case of the same code.

`half` comes from «Вытянутость» (`shapeStretch`, width : height of the outer
ring): `half = (shapeStretch − 1) · outer`, where `outer` is the base
distance of the outermost ring plus half a card and the stub.

A stadium, unlike an ellipse, stays a stadium when offset: every ring is again
a stadium around the same spine, the gap between two rings is the same all the
way round, and all rings share their normals. So along the straight sides
descendants stand in straight columns and round the ends they fan out — the
way a genealogy is drawn by hand on a wide sheet (the design follows one such
chart, a 13-generation tree drawn as a racetrack). It also fills a landscape
print sheet, which a circle cannot.

Positions are addressed by **piece** (upper left quarter, top side, right end,
bottom side, lower left quarter) and a fraction within it; the same
(piece, fraction) lies on the same normal on every ring. The shared coordinate
`u ∈ [0, 1)` is arc length along a reference ring (the outermost ring's inner
edge) as a fraction of its perimeter; on a circle it is simply the angle.
Everything in the sections above is measured along rings rather than in
angles:

- a block's room along its ring (`halfRoom`) is `halfSpan · ρ` round the ends
  and `b/2 + clearance` along the sides; on a stadium a block gets the larger,
  since it may sit on either or straddle the joint;
- ring floors compare the sum of rooms with the stadium perimeter
  `2πρ + 4·half`;
- `spreadRing` works in arc length along each ring's inner edge;
- sector windows are in `u`.

## Core and the folded line of descent

The center is the **core** (`Layout.core`): a disc, or a pill on a stadium,
of radius `rootRadius`, cut into one horizontal band per line of text.

With «Одиночную линию — в центр» (`collapseChain`, on by default) the core
also takes the top of the tree while it is a single line: root → its only
child → that one's only child…, as long as that child has children of its
own. Those generations are listed in the core as «→ Элем», and the rings start
at the first generation that actually branches. Without it a lone son sits
alone on ring 1 with his sons spread round the whole chart, joined to him by
lines half a circle long.

Ring numbers (`pushedRings`, the status bar) count from the core: ring 1 is
the first generation outside it.

## Coordinate systems

The global system is SVG with the origin at the center of the spine (the
viewBox is centered at `0,0`).

Cards are described in the **node-local frame**:

- `+x` — along the ring's outward normal (radially, on a circle);
- `+y` — along the ring.

The renderer applies `translate(position) rotate(angleDeg)` to the node
group — the layout itself does no rotation, it only records `rotationDeg`
(the normal's direction). `cardLength` is the card's extent along the normal,
`cardThickness` along the ring. The block of cards is centered on the node
axis along `y`.

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
- **Core** — links start on the core's edge, on the child's normal; the core
  has no stubs.

Names are the renderer's job: a name wider than `cardLength − 12` is cut
with «…» by its width measured on a canvas at the chart font (re-measured when
the web font finishes loading), and the text is clipped to the card silhouette
as a backstop for fonts taller than the card.

## Links

`linkPoints` (`track.ts`) samples each link in track coordinates: the
distance from the spine grows evenly from the parent's junction to the child's
entry while `u` turns along a smoothstep; the renderer joins the points with a
Catmull-Rom spline. The line leaves and arrives along the normals and bends
*along* the rings, so it never cuts across the middle however far round the
child sits. Between two consecutive generations every link spans the same
distances, so links whose ends keep their order keep it all the way: **links
of one band never cross**. (The earlier Cartesian Bézier did: on a
973-person file it crossed 50 times at the defaults and ran two links through
the center; on the bundled sample, 41 crossings and 3 links through cards.
Now: 0 of each, on circles and stadiums alike.)

## Result

```ts
interface Layout {
  nodes: PlacedNode[];   // position, rotation, cards, stubs
  links: PlacedLink[];   // start/end and the sampled course of each line
  rings: number[];       // distance of each ring's card centerline, ring 1 first
  track: Track;          // { half, ref } — the shape; half = 0 is a circle
  core: Core;            // root spouses, folded chain, radius of the core
  extent: { halfWidth; halfHeight }; // for fit-to-view and export
  cardLength: number;    // card extent actually drawn (≤ the setting)
  pushedRings: number[]; // rings moved out past their slider step by a ring floor
}
```

`extent.halfHeight` is the outermost ring's distance plus `cardLength/2 +
JUNCTION_DEPTH` (with the drawn card length); `halfWidth` adds `track.half`.

Keys for D3 joins: node id for nodes — the id of the person's **first** union
(`@F1@`) or `single:@I5@` for a leaf; child node id for links; person id for
the cards inside a node; family id for the stubs inside a node.
