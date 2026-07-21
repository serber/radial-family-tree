import type { DescendantTree, PersonRef, TreeNode } from '../tree/build.ts';
import type { Settings } from '../settings.ts';

export interface Point {
  x: number;
  y: number;
}

/** Card rectangle in the node's local frame: +x points away from the center, +y is tangential. */
export interface CardSlot {
  person: PersonRef;
  isEntry: boolean;
  /** Union this spouse belongs to; null on the blood-line card, which belongs to all of them. */
  familyId: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where one union's child links leave the family block (local frame). */
export interface StubSlot {
  familyId: string;
  start: Point;
  junction: Point;
}

export interface PlacedNode {
  node: TreeNode;
  isRoot: boolean;
  angle: number;
  radius: number;
  position: Point;
  rotationDeg: number;
  cards: CardSlot[];
  /** One stub per union that has children — empty for root and childless leaves. */
  stubs: StubSlot[];
}

export interface PlacedLink {
  /** Id of the child node — stable key for D3 joins. */
  id: string;
  start: Point;
  end: Point;
  /** Unit tangent directions used to shape the curve. */
  startDir: Point;
  endDir: Point;
}

export interface Layout {
  nodes: PlacedNode[];
  links: PlacedLink[];
  rings: number[];
  /** Radius of the central root disc — derived, not a setting. */
  rootRadius: number;
  /** Outer extent of the drawing, for fit-to-view and export. */
  maxRadius: number;
}

/** Length of the stub connecting a family block to its children fan-out. */
const JUNCTION_DEPTH = 16;

/** Inset of the marriage line from the cards' outer edge; the child stub starts here. */
export const SPOUSE_LINE_INSET = 6;

const polar = (angle: number, radius: number): Point => ({
  x: Math.cos(angle) * radius,
  y: Math.sin(angle) * radius
});

const localToGlobal = (origin: Point, angle: number, point: Point): Point => {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: origin.x + point.x * cos - point.y * sin,
    y: origin.y + point.x * sin + point.y * cos
  };
};

/**
 * Ring radii per generation, derived purely from the layout settings — card
 * size deliberately plays no part, so resizing cards never moves a ring.
 * The first two gaps come from `innerRingGap`; from ring 3 on each gap is the
 * previous one times `ringGrowth`, because every further ring holds more cards.
 */
function generationRadii(maxGeneration: number, settings: Settings): number[] {
  const radii = [0];
  for (let gen = 1; gen <= maxGeneration; gen += 1) {
    const gap =
      gen <= 2 ? settings.innerRingGap : settings.ringGap * settings.ringGrowth ** (gen - 3);
    radii.push((radii[gen - 1] ?? 0) + gap);
  }
  return radii;
}

/** Root disc: as large as the inner gap allows while leaving the first ring's cards room. */
function rootRadiusFor(firstRingRadius: number, settings: Settings): number {
  const clearance = 8;
  const roomy = firstRingRadius - settings.cardLength / 2 - JUNCTION_DEPTH - clearance;
  return Math.max(Math.min(firstRingRadius * 0.55, roomy), 12);
}

function visibleSpouses(node: TreeNode, settings: Settings): PersonRef[] {
  if (settings.showBothSpouses || node.spouses.length <= 1) return node.spouses;
  // Spouses are ordered blood-line first, so "one spouse" means the blood line.
  return node.spouses.slice(0, 1);
}

/** Gap between the two spouse cards of one family block. */
function spouseGap(settings: Settings): number {
  return settings.tightSpouses ? 0 : settings.cardSpacing;
}

/** Tangential size of the family block (all visible spouse cards + gaps). */
function blockSize(node: TreeNode, settings: Settings): number {
  const count = Math.max(visibleSpouses(node, settings).length, 1);
  return count * settings.cardThickness + (count - 1) * spouseGap(settings);
}

/**
 * Two angular appetites per subtree, both measured in radians on the node's ring:
 *  - `need`: bare cards, touching. Below this they overlap — this is the only
 *    quantity allowed to push the rings outwards.
 *  - `want`: cards plus the requested `cardSpacing`. A wish, funded from whatever
 *    free angle the circle happens to have.
 */
interface Demand {
  need: number;
  want: number;
}

/** Angular span the node itself occupies on its ring. */
function ownDemand(node: TreeNode, radius: number, settings: Settings): Demand {
  // The root sits at radius 0 and draws no cards — it claims no arc of its own.
  if (node.generation === 0) return { need: 0, want: 0 };
  const r = Math.max(radius, 1);
  const block = blockSize(node, settings);
  return { need: block / r, want: (block + settings.cardSpacing) / r };
}

/** Bottom-up pass: how much of the circle each subtree needs, and would like. */
function computeDemands(
  tree: DescendantTree,
  radiusOf: (generation: number) => number,
  settings: Settings
): { demands: Map<TreeNode, Demand>; root: Demand } {
  const demands = new Map<TreeNode, Demand>();
  const walk = (node: TreeNode): Demand => {
    const own = ownDemand(node, radiusOf(node.generation), settings);
    let childNeed = 0;
    let childWant = 0;
    for (const child of node.children) {
      const d = walk(child);
      childNeed += d.need;
      childWant += d.want;
    }
    const demand: Demand = node.children.length
      ? { need: Math.max(own.need, childNeed), want: Math.max(own.want, childWant) }
      : own;
    demands.set(node, demand);
    return demand;
  };
  return { demands, root: walk(tree.root) };
}

export function computeLayout(tree: DescendantTree, settings: Settings): Layout {
  const full = 2 * Math.PI;
  const baseRadii = generationRadii(tree.maxGeneration, settings);
  const needAt = (scale: number) =>
    computeDemands(tree, (generation) => (baseRadii[generation] ?? 0) * scale, settings).root.need;

  // Rings only ever grow to stop cards from *overlapping* — `cardSpacing` is
  // never a reason to. When even bare cards don't fit the circle, find the
  // smallest factor that makes them fit by bisection (demand falls as ~1/radius):
  // anything less would overlap, anything more wastes the sheet.
  let scale = 1;
  if (needAt(1) > full) {
    let hi = 2;
    while (hi < 4096 && needAt(hi) > full) hi *= 2;
    let lo = 1;
    for (let i = 0; i < 40; i += 1) {
      const mid = (lo + hi) / 2;
      if (needAt(mid) > full) lo = mid;
      else hi = mid;
    }
    scale = hi;
  }

  const scaled = baseRadii.map((r) => r * scale);

  // Total circumference each ring wants for full `cardSpacing`, and the bare
  // minimum its cards occupy. Both are radius-independent (pure px along the arc).
  const wantArc: number[] = baseRadii.map(() => 0);
  const walkArcs = (node: TreeNode): void => {
    if (node.generation > 0) {
      wantArc[node.generation]! += blockSize(node, settings) + settings.cardSpacing;
    }
    node.children.forEach(walkArcs);
  };
  walkArcs(tree.root);

  // Grow a ring only when its own cards can't get the requested spacing within
  // the full circle — and only up to GROWTH_CAP× its base radius. Inner rings
  // that already have room keep their radius; a crowded outer ring pushes itself
  // (and everything beyond it, to preserve the gaps) outward, never the reverse.
  const GROWTH_CAP = 1.5;
  const radii = [0];
  for (let gen = 1; gen <= tree.maxGeneration; gen += 1) {
    const base = scaled[gen] ?? 0;
    const gap = base - (scaled[gen - 1] ?? 0);
    const wantRadius = Math.min((wantArc[gen] ?? 0) / full, base * GROWTH_CAP);
    radii.push(Math.max(base, wantRadius, (radii[gen - 1] ?? 0) + gap));
  }

  const radiusOf = (generation: number) => radii[generation] ?? 0;
  const { demands } = computeDemands(tree, radiusOf, settings);
  const rootRadius = rootRadiusFor(radiusOf(1), settings);

  const demandOf = (node: TreeNode): Demand => demands.get(node) ?? { need: 0, want: 0 };

  /**
   * Splits a parent's angular window between its children. Every child is first
   * guaranteed the angle it needs not to overlap; the leftover then buys as much
   * of the requested `cardSpacing` as it covers, shared in proportion to how much
   * each child asked for. The fraction is solved *per parent*, not once globally,
   * so a packed branch cannot starve a sparse one on the other side of the tree —
   * each region spends the slack that sits above it.
   */
  const splitWindow = (children: TreeNode[], window: number): number[] => {
    const ds = children.map(demandOf);
    const needSum = ds.reduce((sum, d) => sum + d.need, 0);
    const wantSum = ds.reduce((sum, d) => sum + d.want, 0);

    if (wantSum <= 1e-9) return ds.map(() => window / Math.max(children.length, 1));
    // Roomier than asked for: hand out the wishes and spread the rest on top.
    if (wantSum <= window) return ds.map((d) => (window * d.want) / wantSum);
    // Tight: cover the needs, then fund the spacing wishes as far as it goes.
    const room = window - needSum;
    if (room <= 0) return ds.map((d) => (window * d.need) / Math.max(needSum, 1e-9));
    const fill = room / (wantSum - needSum);
    return ds.map((d) => d.need + (d.want - d.need) * fill);
  };

  const nodes: PlacedNode[] = [];
  const links: PlacedLink[] = [];

  // Top-down: split each node's angular window between children proportionally.
  const place = (node: TreeNode, start: number, end: number): PlacedNode => {
    const placed = placeNode(node, (start + end) / 2, radiusOf(node.generation), settings);
    nodes.push(placed);

    const spans = splitWindow(node.children, end - start);
    let cursor = start;
    node.children.forEach((child, i) => {
      const span = spans[i] ?? 0;
      const placedChild = place(child, cursor, cursor + span);
      links.push(makeLink(placed, placedChild, rootRadius));
      cursor += span;
    });
    return placed;
  };
  place(tree.root, -Math.PI, Math.PI);

  return {
    nodes,
    links,
    rings: radii.slice(1),
    rootRadius,
    maxRadius: radiusOf(tree.maxGeneration) + settings.cardLength / 2 + JUNCTION_DEPTH
  };
}

function placeNode(node: TreeNode, angle: number, radius: number, settings: Settings): PlacedNode {
  const isRoot = node.generation === 0;
  const position = polar(angle, radius);

  if (isRoot) {
    return {
      node,
      isRoot,
      angle,
      radius,
      position: { x: 0, y: 0 },
      rotationDeg: 0,
      cards: [],
      stubs: []
    };
  }

  const spouses = visibleSpouses(node, settings);
  const width = settings.cardLength;
  const height = settings.cardThickness;
  const total = blockSize(node, settings);

  // Matched by spouse id rather than by position: a union whose second spouse is
  // missing from the file contributes no card, which would shift any index pairing.
  const unionOfSpouse = (personId: string): string | null =>
    node.marriages.find((m) => m.spouseId === personId)?.familyId ?? null;

  let cursor = -total / 2;
  const cards: CardSlot[] = spouses.map((person) => {
    const card: CardSlot = {
      person,
      isEntry: person.id === node.entrySpouseId,
      familyId: person.id === node.entrySpouseId ? null : unionOfSpouse(person.id),
      x: -width / 2,
      y: cursor,
      width,
      height
    };
    cursor += height + spouseGap(settings);
    return card;
  });
  if (cards.length && !cards.some((c) => c.isEntry)) {
    cards[0]!.isEntry = true;
  }

  const centerOf = (card: CardSlot): number => card.y + card.height / 2;
  const entryCard = cards.find((c) => c.isEntry) ?? cards[0];
  const unionsWithChildren = new Set(
    node.children.map((c) => c.parentFamilyId).filter((id): id is string => id !== null)
  );

  // One stub per union that produced children, leaving from the seam between that
  // union's two parents at the cards' outer edge, where the marriage line runs.
  // The seam is measured against the *preceding* card, not the blood-line one: with
  // cards stacked [person, wife 1, wife 2] the second union parts from between the
  // two wives, so each marriage fans its descendants out from its own pair.
  let previousCard = entryCard;
  const stubs: StubSlot[] = node.marriages
    .map((m) => {
      const spouseCard = m.spouseId ? cards.find((c) => c.person.id === m.spouseId) : undefined;
      const y =
        spouseCard && previousCard
          ? (centerOf(previousCard) + centerOf(spouseCard)) / 2
          : previousCard
            ? centerOf(previousCard)
            : 0;
      if (spouseCard) previousCard = spouseCard;
      return {
        familyId: m.familyId,
        start: { x: width / 2 - SPOUSE_LINE_INSET, y },
        junction: { x: width / 2 + JUNCTION_DEPTH, y }
      };
    })
    // Filtered only after the walk, so a childless union still shifts the seam.
    .filter((s) => unionsWithChildren.has(s.familyId));

  return {
    node,
    isRoot,
    angle,
    radius,
    position,
    rotationDeg: (angle * 180) / Math.PI,
    cards,
    stubs
  };
}

function makeLink(parent: PlacedNode, child: PlacedNode, rootRadius: number): PlacedLink {
  const entryCard = child.cards.find((c) => c.isEntry) ?? child.cards[0];
  const end = entryCard
    ? localToGlobal(child.position, child.angle, { x: entryCard.x, y: entryCard.y + entryCard.height / 2 })
    : child.position;
  const endDir = { x: -Math.cos(child.angle), y: -Math.sin(child.angle) };

  if (parent.isRoot) {
    const dist = Math.hypot(end.x, end.y) || 1;
    const dir = { x: end.x / dist, y: end.y / dist };
    return {
      id: child.node.id,
      start: { x: dir.x * rootRadius, y: dir.y * rootRadius },
      end,
      startDir: dir,
      endDir
    };
  }

  // Hang off the stub of the union this child actually descends from.
  const stub = parent.stubs.find((s) => s.familyId === child.node.parentFamilyId) ?? parent.stubs[0];
  const junction = stub?.junction ?? { x: 0, y: 0 };
  return {
    id: child.node.id,
    start: localToGlobal(parent.position, parent.angle, junction),
    end,
    startDir: { x: Math.cos(parent.angle), y: Math.sin(parent.angle) },
    endDir
  };
}
