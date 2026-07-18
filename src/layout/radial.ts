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
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlacedNode {
  node: TreeNode;
  isRoot: boolean;
  angle: number;
  radius: number;
  position: Point;
  rotationDeg: number;
  scale: number;
  cards: CardSlot[];
  /** Start of the child-link stub: outer edge of the entry card (local frame). Null for root/leaves. */
  stubStart: Point | null;
  /** Point where links to children begin (local frame). Null for root/leaves. */
  junctionLocal: Point | null;
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
  /** Outer extent of the drawing, for fit-to-view and export. */
  maxRadius: number;
}

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
 * Ring radii for each generation. The configured radii are a wish, not a law:
 * every gap is clamped so cards of neighbouring rings can never overlap
 * radially, and the first ring clears the root disc.
 */
function generationRadii(maxGeneration: number, settings: Settings): number[] {
  const clearance = 8;
  const scaleOf = (generation: number) => (generation <= 2 ? settings.coreScale : 1);
  const radii = [0];
  let gap = settings.generationGap;
  for (let gen = 1; gen <= maxGeneration; gen += 1) {
    const cardSpan = settings.cardWidth * scaleOf(gen);
    if (gen === 1) {
      const minFirst = settings.rootRadius + cardSpan / 2 + settings.junctionDepth + clearance;
      radii.push(Math.max(settings.firstRadius, minFirst));
    } else {
      const prevSpan = settings.cardWidth * scaleOf(gen - 1);
      const minGap = (cardSpan + prevSpan) / 2 + settings.junctionDepth + clearance;
      radii.push((radii[gen - 1] ?? 0) + Math.max(gap, minGap));
      gap *= settings.generationDecay;
    }
  }
  return radii;
}

function nodeScale(node: TreeNode, settings: Settings): number {
  return node.generation <= 2 ? settings.coreScale : 1;
}

function visibleSpouses(node: TreeNode, settings: Settings): PersonRef[] {
  if (settings.showBothSpouses || node.spouses.length <= 1) return node.spouses;
  // Spouses are ordered blood-line first, so "one spouse" means the blood line.
  return node.spouses.slice(0, 1);
}

/** Tangential size of the family block (all visible spouse cards + gaps). */
function blockSize(node: TreeNode, settings: Settings): number {
  const count = Math.max(visibleSpouses(node, settings).length, 1);
  const scale = nodeScale(node, settings);
  return count * settings.cardHeight * scale + (count - 1) * settings.spouseGap;
}

/** Minimal angular span the node needs on its ring so blocks never overlap. */
function requiredAngle(node: TreeNode, radius: number, settings: Settings): number {
  const arc = blockSize(node, settings) + settings.familySpacing * nodeScale(node, settings);
  return arc / Math.max(radius, settings.firstRadius, 1);
}

/** Bottom-up pass: how much of the circle each subtree needs at the given ring radii. */
function computeWeights(
  tree: DescendantTree,
  radiusOf: (generation: number) => number,
  settings: Settings
): { weights: Map<TreeNode, number>; rootWeight: number } {
  const weights = new Map<TreeNode, number>();
  const computeWeight = (node: TreeNode): number => {
    const own = requiredAngle(node, radiusOf(node.generation), settings);
    const childSum = node.children.reduce((sum, child) => sum + computeWeight(child), 0);
    const weight = node.children.length ? Math.max(own, childSum) : own;
    weights.set(node, weight);
    return weight;
  };
  return { weights, rootWeight: computeWeight(tree.root) };
}

export function computeLayout(tree: DescendantTree, settings: Settings): Layout {
  let radii = generationRadii(tree.maxGeneration, settings);
  const radiusOf = (generation: number) => radii[generation] ?? 0;

  // The ring radii from settings are a minimum. When the tree demands more
  // than the full circle (large trees), grow all rings until it fits —
  // angular demand scales roughly as 1/radius, so a few iterations converge.
  let { weights, rootWeight } = computeWeights(tree, radiusOf, settings);
  for (let i = 0; i < 4 && rootWeight > 2 * Math.PI; i += 1) {
    const factor = (rootWeight / (2 * Math.PI)) * 1.01;
    radii = radii.map((r) => r * factor);
    ({ weights, rootWeight } = computeWeights(tree, radiusOf, settings));
  }

  const nodes: PlacedNode[] = [];
  const links: PlacedLink[] = [];

  // Top-down: split each node's angular window between children proportionally.
  const place = (node: TreeNode, start: number, end: number): PlacedNode => {
    const placed = placeNode(node, (start + end) / 2, radiusOf(node.generation), settings);
    nodes.push(placed);

    const total = node.children.reduce((sum, child) => sum + (weights.get(child) ?? 0), 0);
    let cursor = start;
    for (const child of node.children) {
      const span = total > 0 ? (end - start) * ((weights.get(child) ?? 0) / total) : 0;
      const placedChild = place(child, cursor, cursor + span);
      links.push(makeLink(placed, placedChild, settings));
      cursor += span;
    }
    return placed;
  };
  place(tree.root, -Math.PI, Math.PI);

  const outerScale = tree.maxGeneration <= 2 ? settings.coreScale : 1;
  return {
    nodes,
    links,
    rings: radii.slice(1),
    maxRadius: radiusOf(tree.maxGeneration) + (settings.cardWidth * outerScale) / 2 + settings.junctionDepth
  };
}

function placeNode(node: TreeNode, angle: number, radius: number, settings: Settings): PlacedNode {
  const isRoot = node.generation === 0;
  const position = polar(angle, radius);
  const scale = nodeScale(node, settings);

  if (isRoot) {
    return {
      node,
      isRoot,
      angle,
      radius,
      position: { x: 0, y: 0 },
      rotationDeg: 0,
      scale,
      cards: [],
      stubStart: null,
      junctionLocal: null
    };
  }

  const spouses = visibleSpouses(node, settings);
  const width = settings.cardWidth * scale;
  const height = settings.cardHeight * scale;
  const total = blockSize(node, settings);

  let cursor = -total / 2;
  const cards: CardSlot[] = spouses.map((person) => {
    const card: CardSlot = {
      person,
      isEntry: person.id === node.entrySpouseId,
      x: -width / 2,
      y: cursor,
      width,
      height
    };
    cursor += height + settings.spouseGap;
    return card;
  });
  if (cards.length && !cards.some((c) => c.isEntry)) {
    cards[0]!.isEntry = true;
  }

  const entryCard = cards.find((c) => c.isEntry) ?? cards[0];
  const entryCenterY = entryCard ? entryCard.y + entryCard.height / 2 : 0;
  const hasChildren = node.children.length > 0;

  return {
    node,
    isRoot,
    angle,
    radius,
    position,
    rotationDeg: (angle * 180) / Math.PI,
    scale,
    cards,
    stubStart: hasChildren ? { x: width / 2, y: entryCenterY } : null,
    junctionLocal: hasChildren ? { x: width / 2 + settings.junctionDepth, y: entryCenterY } : null
  };
}

function makeLink(parent: PlacedNode, child: PlacedNode, settings: Settings): PlacedLink {
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
      start: { x: dir.x * settings.rootRadius, y: dir.y * settings.rootRadius },
      end,
      startDir: dir,
      endDir
    };
  }

  const junction = parent.junctionLocal ?? { x: 0, y: 0 };
  return {
    id: child.node.id,
    start: localToGlobal(parent.position, parent.angle, junction),
    end,
    startDir: { x: Math.cos(parent.angle), y: Math.sin(parent.angle) },
    endDir
  };
}
