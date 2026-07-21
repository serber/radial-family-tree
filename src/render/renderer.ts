import { arc, select, zoom, zoomIdentity } from 'd3';
import type { Selection, ZoomBehavior } from 'd3';
import { SPOUSE_LINE_INSET } from '../layout/radial.ts';
import type { CardSlot, Layout, PlacedLink, PlacedNode, Point, StubSlot } from '../layout/radial.ts';
import type { PersonRef } from '../tree/build.ts';
import { defaultSettings, type Settings } from '../settings.ts';
import { FONT_STACK, lifeSpanLabel, palette, sexColors } from './palette.ts';

type GSelection = Selection<SVGGElement, unknown, null, undefined>;

interface CardDatum {
  card: CardSlot;
  nodeId: string;
  /** Final on-screen angle of the parent node group, degrees. */
  nodeAngleDeg: number;
}

/** Unique DOM id for a card's clip path (a person can appear in several family nodes). */
function cardClipId(d: CardDatum): string {
  return `card-clip-${`${d.nodeId}-${d.card.person.id}`.replace(/[^\w-]/g, '_')}`;
}

const MAX_NAME_CHARS = 32;

function truncateName(name: string): string {
  return name.length > MAX_NAME_CHARS ? `${name.slice(0, MAX_NAME_CHARS - 3)}…` : name;
}

function personTitle(person: PersonRef): string {
  const span = lifeSpanLabel(person.birthYear, person.deathYear);
  return span ? `${person.name} (${span})` : person.name;
}

/** True when text rotated by `deg` would appear upside down. */
function needsFlip(deg: number): boolean {
  const normalized = ((deg % 360) + 360) % 360;
  return normalized > 90 && normalized < 270;
}

function linkPath(link: PlacedLink, settings: Settings): string {
  const { start, end, startDir, endDir } = link;
  const dist = Math.hypot(end.x - start.x, end.y - start.y) || 1;
  const tension = Math.min(dist * 0.35, settings.ringGap * 0.6);
  const c1: Point = { x: start.x + startDir.x * tension, y: start.y + startDir.y * tension };
  const c2: Point = { x: end.x + endDir.x * tension, y: end.y + endDir.y * tension };
  return `M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.x} ${end.y}`;
}

/**
 * Owns the SVG scene: builds the static skeleton once, then re-renders
 * any (layout, settings) pair through keyed D3 joins. Zoom state survives updates.
 */
export class TreeRenderer {
  private readonly svg: Selection<SVGSVGElement, unknown, null, undefined>;
  private readonly zoomLayer: GSelection;
  private readonly ringLayer: GSelection;
  private readonly linkLayer: GSelection;
  private readonly nodeLayer: GSelection;
  private readonly rootLayer: GSelection;
  private readonly zoomBehavior: ZoomBehavior<SVGSVGElement, unknown>;
  private viewWidth = 900;
  private viewHeight = 900;

  constructor(container: HTMLElement) {
    this.svg = select(container)
      .append('svg')
      .attr('xmlns', 'http://www.w3.org/2000/svg')
      .attr('font-family', FONT_STACK)
      .attr('class', 'chart-svg');

    this.zoomLayer = this.svg.append('g').attr('class', 'zoom-layer');
    this.ringLayer = this.zoomLayer.append('g').attr('class', 'rings');
    this.linkLayer = this.zoomLayer.append('g').attr('class', 'links');
    this.nodeLayer = this.zoomLayer.append('g').attr('class', 'nodes');
    this.rootLayer = this.zoomLayer.append('g').attr('class', 'root');

    this.zoomBehavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.03, 8])
      .on('zoom', (event) => {
        this.zoomLayer.attr('transform', event.transform.toString());
      });
    this.svg.call(this.zoomBehavior).on('dblclick.zoom', null);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      this.resize(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(container);
    this.resize(container.clientWidth, container.clientHeight);
  }

  get element(): SVGSVGElement {
    return this.svg.node()!;
  }

  private resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.viewWidth = width;
    this.viewHeight = height;
    this.svg
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', [-width / 2, -height / 2, width, height].join(' '));
  }

  update(layout: Layout, settings: Settings): void {
    this.svg.style('background-color', settings.canvasColor ?? null);
    this.renderRings(layout, settings);
    this.renderLinks(layout, settings);
    this.renderFamilies(layout, settings);
    this.renderRoot(layout, settings);
  }

  clear(): void {
    this.update({ nodes: [], links: [], rings: [], rootRadius: 0, maxRadius: 0 }, defaultSettings);
  }

  /** Scales and centers the drawing so the whole tree is visible. */
  fitToContent(maxRadius: number, animate = true): void {
    const padding = 24;
    const size = Math.max(maxRadius * 2, 1);
    const k = Math.min(
      (this.viewWidth - padding * 2) / size,
      (this.viewHeight - padding * 2) / size,
      1.5
    );
    const transform = zoomIdentity.scale(Math.max(k, 0.03));
    const target = animate ? this.svg.transition().duration(400) : this.svg;
    target.call(this.zoomBehavior.transform, transform);
  }

  private renderRings(layout: Layout, settings: Settings): void {
    this.ringLayer
      .selectAll<SVGCircleElement, number>('circle')
      .data(settings.showRings ? layout.rings : [])
      .join('circle')
      .attr('r', (d) => d)
      .attr('fill', 'none')
      .attr('stroke', settings.ringColor)
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '2 7');
  }

  private renderLinks(layout: Layout, settings: Settings): void {
    this.linkLayer
      .selectAll<SVGPathElement, PlacedLink>('path')
      .data(layout.links, (d) => d.id)
      .join('path')
      .attr('fill', 'none')
      .attr('stroke', settings.lineColor)
      .attr('stroke-width', settings.lineWidth)
      .attr('stroke-linecap', 'round')
      .attr('d', (d) => linkPath(d, settings));
  }

  private renderFamilies(layout: Layout, settings: Settings): void {
    const families = layout.nodes.filter((n) => !n.isRoot);

    const nodeSel = this.nodeLayer
      .selectAll<SVGGElement, PlacedNode>('g.family')
      .data(families, (d) => d.node.id)
      .join('g')
      .attr('class', 'family')
      .attr('transform', (d) => `translate(${d.position.x},${d.position.y}) rotate(${d.rotationDeg})`);

    // One stub per union with children, from its marriage line to the fan-out point.
    nodeSel
      .selectAll<SVGLineElement, StubSlot>('line.stub')
      .data(
        (d) => d.stubs,
        (d) => d.familyId
      )
      .join('line')
      .attr('class', 'stub')
      .attr('x1', (d) => d.start.x)
      .attr('y1', (d) => d.start.y)
      .attr('x2', (d) => d.junction.x)
      .attr('y2', (d) => d.junction.y)
      .attr('stroke', settings.lineColor)
      .attr('stroke-width', settings.lineWidth)
      .attr('stroke-linecap', 'round');

    // Marriage line between spouse cards, at their outer edge (towards the
    // descendants) — the child links branch out from its midpoint.
    nodeSel
      .selectAll<SVGPathElement, { from: CardSlot; to: CardSlot }>('path.spouse-link')
      .data(
        (d) => d.cards.slice(1).map((card, i) => ({ from: d.cards[i]!, to: card })),
        (d) => d.to.person.id
      )
      .join('path')
      .attr('class', 'spouse-link')
      .attr('d', (d) => {
        // Near the cards' outer edge (towards the descendants); the child stub
        // starts on this same line (stubStart.x = width/2 − SPOUSE_LINE_INSET).
        const x = d.from.x + d.from.width - SPOUSE_LINE_INSET;
        const y1 = d.from.y + d.from.height;
        const y2 = d.to.y;
        return `M ${x} ${y1} L ${x} ${y2}`;
      })
      .attr('stroke', settings.lineColor)
      .attr('stroke-width', settings.lineWidth)
      .attr('fill', 'none');

    const cardSel = nodeSel
      .selectAll<SVGGElement, CardDatum>('g.card')
      .data(
        (d) => d.cards.map((card) => ({ card, nodeId: d.node.id, nodeAngleDeg: d.rotationDeg })),
        (d) => d.card.person.id
      )
      .join((enter) => {
        const g = enter.append('g').attr('class', 'card');
        g.append('clipPath').attr('class', 'card-clip').append('rect');
        g.append('rect').attr('class', 'card-bg');
        g.append('rect').attr('class', 'entry-strip');
        g.append('text').attr('class', 'card-name');
        g.append('title');
        return g;
      });

    // Clip the entry strip to the card silhouette so it follows rounded corners.
    cardSel.select<SVGClipPathElement>('clipPath.card-clip').attr('id', cardClipId);
    cardSel
      .select<SVGRectElement>('clipPath.card-clip rect')
      .attr('x', (d) => d.card.x + 0.5)
      .attr('y', (d) => d.card.y + 0.5)
      .attr('width', (d) => Math.max(d.card.width - 1, 0))
      .attr('height', (d) => Math.max(d.card.height - 1, 0))
      .attr('rx', Math.max(settings.cornerRadius - 0.5, 0));

    cardSel
      .select<SVGRectElement>('rect.card-bg')
      .attr('x', (d) => d.card.x)
      .attr('y', (d) => d.card.y)
      .attr('width', (d) => d.card.width)
      .attr('height', (d) => d.card.height)
      .attr('rx', settings.cornerRadius)
      .attr('fill', (d) => sexColors(d.card.person.sex, settings).fill)
      .attr('stroke', (d) => sexColors(d.card.person.sex, settings).border)
      .attr('stroke-width', 1);

    cardSel
      .select<SVGRectElement>('rect.entry-strip')
      .attr('display', (d) => (d.card.isEntry ? null : 'none'))
      .attr('x', (d) => d.card.x + 0.5)
      .attr('y', (d) => d.card.y + 0.5)
      .attr('width', 4)
      .attr('height', (d) => Math.max(d.card.height - 1, 0))
      .attr('clip-path', (d) => `url(#${cardClipId(d)})`)
      .attr('fill', (d) => sexColors(d.card.person.sex, settings).accent);

    cardSel
      .select<SVGTextElement>('text.card-name')
      .attr('transform', (d) => {
        const cx = d.card.x + d.card.width / 2;
        const cy = d.card.y + d.card.height / 2;
        const flip = needsFlip(d.nodeAngleDeg) ? ' rotate(180)' : '';
        return `translate(${cx},${cy})${flip}`;
      })
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('font-size', settings.fontSize)
      .attr('font-weight', settings.boldFont ? 700 : 400)
      .attr('fill', palette.text)
      .text((d) => truncateName(d.card.person.name));

    cardSel.select('title').text((d) => personTitle(d.card.person));
  }

  private renderRoot(layout: Layout, settings: Settings): void {
    const root = layout.nodes.find((n) => n.isRoot);
    const spouses = root?.node.spouses ?? [];

    const rootSel = this.rootLayer
      .selectAll<SVGGElement, PlacedNode>('g.root-node')
      .data(root && spouses.length ? [root] : [])
      .join((enter) => {
        const g = enter.append('g').attr('class', 'root-node');
        g.append('circle').attr('class', 'halo');
        g.append('g').attr('class', 'slices');
        g.append('g').attr('class', 'dividers');
        g.append('circle').attr('class', 'outline');
        g.append('g').attr('class', 'labels');
        g.append('title');
        return g;
      });
    if (rootSel.empty()) return;

    const r = layout.rootRadius;
    const primary = spouses[0]!;
    // The disc is cut into one wedge per person, so a root ancestor who married
    // more than once shows every spouse instead of just the first.
    const n = spouses.length;
    const sliceAngle = (2 * Math.PI) / n;
    // d3.arc angles are clockwise from 12 o'clock, so at n = 2 the boundaries land
    // left and right and the two wedges are the familiar top and bottom halves.
    const boundary = (i: number): number => -Math.PI / 2 + i * sliceAngle;

    rootSel
      .select<SVGCircleElement>('circle.halo')
      .attr('r', r + 5)
      .attr('fill', '#ffffff')
      .attr('stroke', palette.rootHalo)
      .attr('stroke-width', 1);

    const wedge = arc<{ start: number; end: number }>()
      .innerRadius(0)
      .outerRadius(r)
      .startAngle((d) => d.start)
      .endAngle((d) => d.end);

    rootSel
      .select('g.slices')
      .selectAll<SVGPathElement, PersonRef>('path')
      .data(spouses, (d) => d.id)
      .join('path')
      .attr('d', (_d, i) => wedge({ start: boundary(i), end: boundary(i + 1) }))
      .attr('fill', (d) => sexColors(d.sex, settings).fill);

    rootSel
      .select('g.dividers')
      .selectAll<SVGLineElement, number>('line')
      .data(n > 1 ? spouses.map((_d, i) => boundary(i)) : [])
      .join('line')
      .attr('x1', 0)
      .attr('y1', 0)
      .attr('x2', (a) => Math.sin(a) * r)
      .attr('y2', (a) => -Math.cos(a) * r)
      .attr('stroke', '#ffffff')
      .attr('stroke-width', 1.5);

    rootSel
      .select<SVGCircleElement>('circle.outline')
      .attr('r', r)
      .attr('fill', 'none')
      .attr('stroke', sexColors(primary.sex, settings).border)
      .attr('stroke-width', 1.2);

    // Fit the longest name inside the disc so it never reaches the edge: bound the
    // size by the available chord width (widest name) and by the disc height, which
    // every extra stacked label divides further.
    const longest = Math.max(...spouses.map((p) => p.name.length), 1);
    const byWidth = (r * 1.3) / (longest * 0.58);
    const byHeight = n > 1 ? (r * 0.8) / n : r * 0.55;
    const fontSize = Math.max(Math.min(byWidth, byHeight), 5);
    const step = (r * 1.68) / n;

    rootSel
      .select('g.labels')
      .selectAll<SVGTextElement, PersonRef>('text')
      .data(spouses, (d) => d.id)
      .join('text')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('y', (_d, i) => (n > 1 ? (i - (n - 1) / 2) * step : 0))
      .attr('font-size', fontSize)
      .attr('font-weight', 600)
      .attr('fill', palette.text)
      .text((d) => truncateName(d.name));

    rootSel.select('title').text(spouses.map(personTitle).join('\n'));
  }
}
