import type { DescendantTree, PersonRef, TreeNode } from '../tree/build.ts';
import type { Settings } from '../settings.ts';
import {
  arcAt,
  linkPoints,
  locate,
  perimeter,
  project,
  spotAt,
  spotOfU,
  type Track
} from './track.ts';

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
  /** The node the rings grow from — drawn as the central core, not as cards. */
  isRoot: boolean;
  /** Direction of the outward normal at the node (radians); its local +x axis. */
  angle: number;
  /** Distance from the spine (from the center, for a circle). */
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
  /** Parent's junction (or the core's edge). */
  start: Point;
  /** Middle of the inner edge of the child's blood-line card. */
  end: Point;
  /** The line itself, `start` … `end`, bent along the rings (see `linkPoints`). */
  points: Point[];
}

/** The central core: the root couple, plus the line of descent folded into it. */
export interface Core {
  /** The root family's spouses — one wedge (circle) or band (stadium) each. */
  people: PersonRef[];
  /** Each folded generation's visible people, top down; empty unless `collapseChain`. */
  chain: PersonRef[][];
  /** Distance of the core's edge from the spine — derived, not a setting. */
  radius: number;
}

export interface Layout {
  nodes: PlacedNode[];
  links: PlacedLink[];
  /** Distance of each ring's card centerline from the spine, ring 1 first. */
  rings: number[];
  /** Shape of the rings: a circle when `track.half` is 0, else a stadium. */
  track: Track;
  core: Core;
  /** Half the drawing's width and height, for fit-to-view and export. */
  extent: { halfWidth: number; halfHeight: number };
  /**
   * Radial card extent actually drawn: `settings.cardLength`, shortened when the
   * rings are too close together for cards that long.
   */
  cardLength: number;
  /**
   * Rings (1 = innermost) that sit further out than the gap settings put them,
   * because their own cards (with `cardSpacing`) didn't fit there.
   */
  pushedRings: number[];
}

/** Length of the stub connecting a family block to its children fan-out. */
const JUNCTION_DEPTH = 16;

/** Smallest core radius; the core never shrinks below it. */
const MIN_ROOT_RADIUS = 12;

/** Free radial room between one ring's child junctions and the next ring's cards. */
const RING_CLEARANCE = 8;

/** Inset of the marriage line from the cards' outer edge; the child stub starts here. */
export const SPOUSE_LINE_INSET = 6;

const localToGlobal = (origin: Point, angle: number, point: Point): Point => {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: origin.x + point.x * cos - point.y * sin,
    y: origin.y + point.x * sin + point.y * cos
  };
};

/**
 * Ring distances per depth, derived purely from the layout settings — card
 * size deliberately plays no part, so resizing cards never moves a ring.
 * The first two gaps come from `innerRingGap`; from ring 3 on each gap is the
 * previous one times `ringGrowth`.
 */
function generationRadii(maxDepth: number, settings: Settings): number[] {
  const radii = [0];
  for (let depth = 1; depth <= maxDepth; depth += 1) {
    const gap =
      depth <= 2 ? settings.innerRingGap : settings.ringGap * settings.ringGrowth ** (depth - 3);
    radii.push((radii[depth - 1] ?? 0) + gap);
  }
  return radii;
}

/**
 * Longest card that keeps neighbouring rings apart. Cards never move a ring, so
 * when the rings sit closer than the cards are long, the cards give way: each
 * card, its child stub and some clearance must fit between two rings, and the
 * first ring's cards must leave room for the smallest core.
 */
function cardLengthLimit(radii: number[]): number {
  let limit = Infinity;
  const first = radii[1];
  if (first !== undefined) {
    limit = 2 * (first - MIN_ROOT_RADIUS - JUNCTION_DEPTH - RING_CLEARANCE);
  }
  for (let depth = 2; depth < radii.length; depth += 1) {
    const gap = (radii[depth] ?? 0) - (radii[depth - 1] ?? 0);
    limit = Math.min(limit, gap - JUNCTION_DEPTH - RING_CLEARANCE);
  }
  return Math.max(limit, 10);
}

/** Core: as large as the inner gap allows while leaving the first ring's cards room. */
function rootRadiusFor(firstRingRadius: number, settings: Settings): number {
  const roomy = firstRingRadius - settings.cardLength / 2 - JUNCTION_DEPTH - RING_CLEARANCE;
  return Math.max(Math.min(firstRingRadius * 0.55, roomy), MIN_ROOT_RADIUS);
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
 * Half the angle a block needs so that it stays `clearance` away from the rays
 * bounding its sector. Cards are flat rectangles, not ring segments, so they
 * are widest in angle at their inner corners (ρ = inner radius, ±b/2): the
 * corner sits atan(b/2 / ρ) off the axis, and the ray must clear it by
 * `clearance` measured perpendicular to the ray — asin(clearance / |corner|).
 * Points further out only get further from the ray. Two blocks with touching
 * sectors are therefore exactly 2·clearance apart at their nearest corners.
 */
function halfSpan(block: number, clearance: number, inner: number): number {
  const rho = Math.max(inner, 1e-6);
  const corner = Math.hypot(rho, block / 2);
  return Math.atan(block / 2 / rho) + Math.asin(Math.min(clearance / corner, 1));
}

/**
 * Half the room a block takes along its ring, measured as arc length on the
 * cards' inner edge (distance ρ from the spine). Round the ends that is the
 * angular half span times ρ; along a straight side, where neighbours stand
 * parallel, it is plain b/2 + clearance. On a stadium a block may sit on either
 * (or cross from one to the other), so it gets the larger of the two.
 */
function halfRoom(track: Track, block: number, clearance: number, inner: number): number {
  const rho = Math.max(inner, 1e-6);
  const round = halfSpan(block, clearance, rho) * rho;
  return track.half > 0 ? Math.max(round, block / 2 + clearance) : round;
}

/**
 * Two appetites per subtree, as fractions of the whole ring (the shared
 * coordinate `u` runs 0…1 once round):
 *  - `need`: bare cards, touching;
 *  - `want`: cards plus the requested `cardSpacing`.
 * They only shape the *ideal* positions (who sits over whom); overlap and
 * spacing are guaranteed afterwards, ring by ring, by `ringFloor` and `spreadRing`.
 */
interface Demand {
  need: number;
  want: number;
}

/**
 * Smallest distance at which one ring's cards, on their own, fit round it with
 * full `cardSpacing` between them. Their room shrinks with distance while the
 * ring grows, so bisect.
 */
function ringFloor(track: Track, blocks: number[], settings: Settings): number {
  if (blocks.length === 0) return 0;
  const half = settings.cardLength / 2;
  const clearance = settings.cardSpacing / 2;
  const fits = (d: number) => {
    let total = 0;
    for (const block of blocks) total += 2 * halfRoom(track, block, clearance, d - half);
    return total <= perimeter(track, d - half);
  };
  // Both atan(x) ≤ x and asin(x) ≤ πx/2, so from here on the rooms fit a circle,
  // and a stadium only adds its sides.
  const arc = blocks.reduce((sum, b) => sum + b + (Math.PI * settings.cardSpacing) / 2, 0);
  let hi = half + arc / (2 * Math.PI) + 1;
  let lo = half;
  if (fits(lo)) return lo;
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

/**
 * The top of the chart: the root, followed — when `collapseChain` is on — by
 * every only child that has children of its own. They all go into the core,
 * and the rings start at the first generation that actually branches. (A lone
 * son at the top would otherwise sit alone on the first ring, with his sons
 * spread all round the chart, joined to him by lines half a circle long.)
 */
function coreChain(tree: DescendantTree, settings: Settings): TreeNode[] {
  const chain = [tree.root];
  let node = tree.root;
  while (settings.collapseChain && node.children.length === 1 && node.children[0]!.children.length) {
    node = node.children[0]!;
    chain.push(node);
  }
  return chain;
}

export function computeLayout(tree: DescendantTree, requested: Settings): Layout {
  const chain = coreChain(tree, requested);
  const top = chain[chain.length - 1]!;
  const depthOf = (node: TreeNode) => node.generation - top.generation;
  const maxDepth = tree.maxGeneration - top.generation;

  // Every card below the core, by ring.
  const rings: TreeNode[][] = Array.from({ length: maxDepth + 1 }, () => []);
  const collect = (node: TreeNode): void => {
    if (node !== top) rings[depthOf(node)]!.push(node);
    node.children.forEach(collect);
  };
  collect(top);

  const baseRadii = generationRadii(maxDepth, requested);
  // The straight sides make the outer ring `shapeStretch` times as wide as tall.
  const outer = (baseRadii[maxDepth] ?? 0) + requested.cardLength / 2 + JUNCTION_DEPTH;
  const half = Math.max(requested.shapeStretch - 1, 0) * outer;

  /**
   * Final ring distances for a card length. Each ring sits at its settings-given
   * gap from the previous one unless its *own* cards need more room — then it
   * moves out just far enough, and the rings beyond keep their gaps to it. A
   * crowded ring therefore never inflates the rings inside it.
   */
  const ringRadii = (settings: Settings): number[] => {
    const track: Track = { half, ref: 1 };
    const radii = [0];
    for (let depth = 1; depth <= maxDepth; depth += 1) {
      const gap = (baseRadii[depth] ?? 0) - (baseRadii[depth - 1] ?? 0);
      const blocks = rings[depth]!.map((node) => blockSize(node, settings));
      radii.push(Math.max((radii[depth - 1] ?? 0) + gap, ringFloor(track, blocks, settings)));
    }
    return radii;
  };

  // Card length and ring distances depend on each other: a longer card needs
  // more room (its inner edge sits lower), which may push rings out, which leaves
  // room for a longer card. Both only grow, so iterate to a fixed point starting
  // from the base distances. Rings are always recomputed for the final length,
  // so the result is valid even if the loop stops early.
  const withLength = (length: number): Settings => ({ ...requested, cardLength: length });
  let cardLength = Math.min(requested.cardLength, cardLengthLimit(baseRadii));
  let radii = ringRadii(withLength(cardLength));
  for (let i = 0; i < 8 && cardLength < requested.cardLength; i += 1) {
    const longer = Math.min(requested.cardLength, cardLengthLimit(radii));
    if (longer <= cardLength + 0.5) break;
    cardLength = longer;
    radii = ringRadii(withLength(cardLength));
  }
  const settings = withLength(cardLength);
  const pushedRings: number[] = [];
  for (let depth = 1; depth < radii.length; depth += 1) {
    const gap = (baseRadii[depth] ?? 0) - (baseRadii[depth - 1] ?? 0);
    if ((radii[depth] ?? 0) > (radii[depth - 1] ?? 0) + gap + 0.5) pushedRings.push(depth);
  }

  const radiusOf = (node: TreeNode) => radii[depthOf(node)] ?? 0;
  const innerOf = (node: TreeNode) => radiusOf(node) - settings.cardLength / 2;
  // The shared coordinate is weighed on the outermost ring's inner edge, where
  // the cards are usually most crowded, so that is where ideal spacing is truest.
  const track: Track = {
    half,
    ref: Math.max((radii[maxDepth] ?? 0) - settings.cardLength / 2, 1)
  };
  const rootRadius = rootRadiusFor(radii[1] ?? MIN_ROOT_RADIUS * 4, settings);
  const clearance = settings.cardSpacing / 2;

  // Bottom-up: how much of its own ring each subtree needs, and would like.
  const demands = new Map<TreeNode, Demand>();
  const walk = (node: TreeNode): Demand => {
    let own: Demand = { need: 0, want: 0 };
    if (node !== top) {
      const inner = innerOf(node);
      const ring = perimeter(track, inner);
      const block = blockSize(node, settings);
      own = {
        need: (2 * halfRoom(track, block, 0, inner)) / ring,
        want: (2 * halfRoom(track, block, clearance, inner)) / ring
      };
    }
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
  walk(top);
  const demandOf = (node: TreeNode): Demand => demands.get(node) ?? { need: 0, want: 0 };

  /**
   * Splits a parent's window between its children: first each child's bare
   * `need`, then the leftover towards their `want`, in proportion to how much
   * each asked for. Solved *per parent*, so a packed branch cannot starve a
   * sparse one on the other side of the tree. The windows only set ideal
   * positions — `spreadRing` enforces the actual spacing.
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

  // Top-down: split each node's window between its children. This gives every
  // node its *ideal* position u — centered over its own family.
  const ideal = new Map<TreeNode, number>();
  const assign = (node: TreeNode, start: number, end: number): void => {
    ideal.set(node, (start + end) / 2);
    const spans = splitWindow(node.children, end - start);
    let cursor = start;
    node.children.forEach((child, i) => {
      const span = spans[i] ?? 0;
      assign(child, cursor, cursor + span);
      cursor += span;
    });
  };
  assign(top, 0, 1);

  // Windows reach through every ring, so where an outer ring is packed the
  // cards of the inner rings get squeezed too, though their own ring is roomy.
  // Each ring is therefore spread on its own: cards slide along its inner edge,
  // as little as possible, until neighbours are `cardSpacing` apart.
  // `ringFloor` sized every ring for exactly that, so the spread always succeeds.
  const placedAt = new Map<TreeNode, { position: Point; normal: number }>();
  rings.forEach((ring, depth) => {
    if (depth === 0 || ring.length === 0) return;
    const inner = (radii[depth] ?? 0) - settings.cardLength / 2;
    const arcs = ring.map((node) => arcAt(track, spotOfU(track, ideal.get(node) ?? 0), inner));
    const halves = ring.map((node) => halfRoom(track, blockSize(node, settings), clearance, inner));
    const spread = spreadRing(arcs, halves, perimeter(track, inner));
    ring.forEach((node, i) => {
      const at = locate(track, spotAt(track, spread[i] ?? 0, inner), radii[depth] ?? 0);
      placedAt.set(node, { position: at.point, normal: at.normal });
    });
  });

  const nodes: PlacedNode[] = [];
  const links: PlacedLink[] = [];
  const place = (node: TreeNode): PlacedNode => {
    const placed =
      node === top
        ? rootNode(node)
        : placeNode(node, placedAt.get(node)!, radiusOf(node), settings);
    nodes.push(placed);
    for (const child of node.children) {
      links.push(makeLink(track, placed, place(child), rootRadius));
    }
    return placed;
  };
  place(top);

  const reach = (radii[maxDepth] ?? rootRadius) + (maxDepth > 0 ? cardLength / 2 + JUNCTION_DEPTH : 0);
  return {
    nodes,
    links,
    rings: radii.slice(1),
    track,
    core: {
      people: tree.root.spouses,
      chain: chain.slice(1).map((node) => visibleSpouses(node, settings)),
      radius: rootRadius
    },
    extent: { halfWidth: half + reach, halfHeight: reach },
    cardLength,
    pushedRings
  };
}

/**
 * Moves the nodes of one ring along it, keeping their circular order, so that
 * neighbours i and i+1 are at least `halves[i] + halves[i+1]` apart, while the
 * total squared shift from `ideals` is as small as possible. All values are arc
 * lengths on a ring of length `period`.
 *
 * With cumulative offsets c (c₀ = 0, cᵢ₊₁ = cᵢ + dᵢ) the positions are
 * xᵢ = yᵢ + cᵢ and the spacing constraints become "y is non-decreasing" — an
 * isotonic regression of zᵢ = idealᵢ − cᵢ, solved by pool-adjacent-violators.
 * Closing the ring adds y_last − y_first ≤ slack (the free length); with a
 * constant bound the solution is the unbounded one clipped to [a, a + slack],
 * and the best offset `a` is found by ternary search (the cost is convex in a).
 * The ring is cut at the widest gap between ideals, where nothing is crowded.
 */
function spreadRing(ideals: number[], halves: number[], period: number): number[] {
  const n = ideals.length;
  if (n <= 1) return ideals.slice();

  const norm = (a: number) => ((a % period) + period) % period;
  const order = ideals.map((_, i) => i).sort((a, b) => norm(ideals[a]!) - norm(ideals[b]!));
  let cut = 0;
  let widest = -1;
  for (let k = 0; k < n; k += 1) {
    const prev = norm(ideals[order[(k - 1 + n) % n]!]!);
    const gap = norm(norm(ideals[order[k]!]!) - prev) || (k === 0 ? period : 0);
    if (gap > widest) {
      widest = gap;
      cut = k;
    }
  }
  const seq = [...order.slice(cut), ...order.slice(0, cut)];

  // Unwrapped ideal positions, increasing from the cut.
  const start = norm(ideals[seq[0]!]!);
  const t = seq.map((i) => start + norm(norm(ideals[i]!) - start));
  const c = [0];
  for (let k = 1; k < n; k += 1) {
    c.push(c[k - 1]! + halves[seq[k - 1]!]! + halves[seq[k]!]!);
  }
  const wrap = halves[seq[n - 1]!]! + halves[seq[0]!]!;
  const slack = Math.max(period - c[n - 1]! - wrap, 0);
  const z = t.map((value, k) => value - c[k]!);

  // Pool-adjacent-violators: runs sharing one fitted value (their mean), merged
  // with the previous run while the means would decrease.
  const sums: number[] = [];
  const counts: number[] = [];
  const mean = (run: number) => sums[run]! / counts[run]!;
  for (const value of z) {
    sums.push(value);
    counts.push(1);
    while (sums.length > 1 && mean(sums.length - 2) > mean(sums.length - 1)) {
      const sum = sums.pop()!;
      const count = counts.pop()!;
      sums[sums.length - 1]! += sum;
      counts[counts.length - 1]! += count;
    }
  }
  const fit: number[] = [];
  sums.forEach((_, run) => {
    for (let k = 0; k < counts[run]!; k += 1) fit.push(mean(run));
  });

  let y = fit;
  if (fit[n - 1]! - fit[0]! > slack) {
    const clipAt = (a: number) => fit.map((v) => Math.min(Math.max(v, a), a + slack));
    const cost = (a: number) => clipAt(a).reduce((sum, v, k) => sum + (v - z[k]!) ** 2, 0);
    let lo = fit[0]!;
    let hi = fit[n - 1]! - slack;
    for (let i = 0; i < 100; i += 1) {
      const m1 = lo + (hi - lo) / 3;
      const m2 = hi - (hi - lo) / 3;
      if (cost(m1) <= cost(m2)) hi = m2;
      else lo = m1;
    }
    y = clipAt((lo + hi) / 2);
  }

  const result = new Array<number>(n);
  seq.forEach((i, k) => {
    result[i] = y[k]! + c[k]!;
  });
  return result;
}

function rootNode(node: TreeNode): PlacedNode {
  return { node, isRoot: true, angle: 0, radius: 0, position: { x: 0, y: 0 }, rotationDeg: 0, cards: [], stubs: [] };
}

function placeNode(
  node: TreeNode,
  at: { position: Point; normal: number },
  radius: number,
  settings: Settings
): PlacedNode {
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
    isRoot: false,
    angle: at.normal,
    radius,
    position: at.position,
    rotationDeg: (at.normal * 180) / Math.PI,
    cards,
    stubs
  };
}

function makeLink(track: Track, parent: PlacedNode, child: PlacedNode, rootRadius: number): PlacedLink {
  const entryCard = child.cards.find((c) => c.isEntry) ?? child.cards[0];
  const end = entryCard
    ? localToGlobal(child.position, child.angle, { x: entryCard.x, y: entryCard.y + entryCard.height / 2 })
    : child.position;

  let start: Point;
  if (parent.isRoot) {
    // Straight out of the core, along the child's normal.
    start = locate(track, project(track, end), rootRadius).point;
  } else {
    // Hang off the stub of the union this child actually descends from.
    const stub = parent.stubs.find((s) => s.familyId === child.node.parentFamilyId) ?? parent.stubs[0];
    start = localToGlobal(parent.position, parent.angle, stub?.junction ?? { x: 0, y: 0 });
  }
  return { id: child.node.id, start, end, points: linkPoints(track, start, end) };
}
