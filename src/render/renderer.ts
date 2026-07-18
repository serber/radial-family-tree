import { arc, select, zoom, zoomIdentity } from 'd3';
import type { Selection, ZoomBehavior } from 'd3';
import type { CardSlot, Layout, PlacedLink, PlacedNode, Point } from '../layout/radial.ts';
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
  if (!settings.curvedLines) {
    return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
  }
  const dist = Math.hypot(end.x - start.x, end.y - start.y) || 1;
  const tension = Math.min(dist * 0.35, settings.generationGap * 0.6);
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
    this.update({ nodes: [], links: [], rings: [], maxRadius: 0 }, defaultSettings);
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
      .attr('stroke', palette.ring)
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

    // Stub from the entry card to the fan-out point of child links.
    nodeSel
      .selectAll<SVGLineElement, PlacedNode>('line.stub')
      .data(
        (d) => (d.stubStart && d.junctionLocal ? [d] : []),
        (d) => d.node.id
      )
      .join('line')
      .attr('class', 'stub')
      .attr('x1', (d) => d.stubStart!.x)
      .attr('y1', (d) => d.stubStart!.y)
      .attr('x2', (d) => d.junctionLocal!.x)
      .attr('y2', (d) => d.junctionLocal!.y)
      .attr('stroke', settings.lineColor)
      .attr('stroke-width', settings.lineWidth)
      .attr('stroke-linecap', 'round');

    // Marriage line between spouse cards, at their inner (start) edge.
    nodeSel
      .selectAll<SVGPathElement, { from: CardSlot; to: CardSlot }>('path.spouse-link')
      .data(
        (d) => d.cards.slice(1).map((card, i) => ({ from: d.cards[i]!, to: card })),
        (d) => d.to.person.id
      )
      .join('path')
      .attr('class', 'spouse-link')
      .attr('d', (d) => {
        const y1 = d.from.y + d.from.height - 0.5;
        const y2 = d.to.y + 0.5;
        const x = d.from.x + 6;
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
      .attr('stroke', (d) => sexColors(d.card.person.sex, settings).accent)
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
      .attr('font-size', (d) => settings.fontSize * (d.card.height / settings.cardHeight))
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
        g.append('path').attr('class', 'half-top');
        g.append('path').attr('class', 'half-bottom');
        g.append('line').attr('class', 'divider');
        g.append('circle').attr('class', 'outline');
        g.append('text').attr('class', 'label-top');
        g.append('text').attr('class', 'label-bottom');
        g.append('title');
        return g;
      });
    if (rootSel.empty()) return;

    const r = settings.rootRadius;
    const primary = spouses[0]!;
    const secondary = spouses.length > 1 ? spouses[1]! : null;

    rootSel
      .select<SVGCircleElement>('circle.halo')
      .attr('r', r + 5)
      .attr('fill', '#ffffff')
      .attr('stroke', palette.rootHalo)
      .attr('stroke-width', 1);
    const half = arc<{ start: number; end: number }>()
      .innerRadius(0)
      .outerRadius(r)
      .startAngle((d) => d.start)
      .endAngle((d) => d.end);

    // d3.arc angles are clockwise from 12 o'clock: top half is [-π/2, π/2].
    rootSel
      .select<SVGPathElement>('path.half-top')
      .attr('d', half({ start: -Math.PI / 2, end: Math.PI / 2 }))
      .attr('fill', sexColors(primary.sex, settings).fill);

    rootSel
      .select<SVGPathElement>('path.half-bottom')
      .attr('d', half({ start: Math.PI / 2, end: (Math.PI * 3) / 2 }))
      .attr('fill', secondary ? sexColors(secondary.sex, settings).fill : sexColors(primary.sex, settings).fill);

    rootSel
      .select<SVGLineElement>('line.divider')
      .attr('display', secondary ? null : 'none')
      .attr('x1', -r)
      .attr('x2', r)
      .attr('stroke', '#ffffff')
      .attr('stroke-width', 1.5);

    rootSel
      .select<SVGCircleElement>('circle.outline')
      .attr('r', r)
      .attr('fill', 'none')
      .attr('stroke', sexColors(primary.sex, settings).accent)
      .attr('stroke-width', 1.2);

    const fontSize = Math.max(settings.fontSize, r / 5);
    rootSel
      .select<SVGTextElement>('text.label-top')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('y', secondary ? -r * 0.42 : 0)
      .attr('font-size', fontSize)
      .attr('font-weight', 600)
      .attr('fill', palette.text)
      .text(truncateName(primary.name));

    rootSel
      .select<SVGTextElement>('text.label-bottom')
      .attr('display', secondary ? null : 'none')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('y', r * 0.42)
      .attr('font-size', fontSize)
      .attr('font-weight', 600)
      .attr('fill', palette.text)
      .text(secondary ? truncateName(secondary.name) : '');

    rootSel
      .select('title')
      .text([primary, secondary].filter((p): p is PersonRef => p !== null).map(personTitle).join('\n'));
  }
}
