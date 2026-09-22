import { curveCatmullRom, line, select, zoom, zoomIdentity } from 'd3';
import type { Selection, ZoomBehavior } from 'd3';
import { SPOUSE_LINE_INSET } from '../layout/radial.ts';
import type { CardSlot, Core, Layout, PlacedLink, PlacedNode, Point, StubSlot } from '../layout/radial.ts';
import { trackPath } from '../layout/track.ts';
import type { PersonRef } from '../tree/build.ts';
import type { Settings } from '../settings.ts';
import { FONT_STACK, lifeSpanLabel, palette, sexColors } from './palette.ts';

type GSelection = Selection<SVGGElement, unknown, null, undefined>;

/** One line of text in the core, on its own colored band. */
interface CoreRow {
  key: string;
  people: PersonRef[];
  text: string;
}

/** There is one core per chart, so its clip path can have a fixed id. */
const CORE_CLIP_ID = 'core-clip';

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

/** Character cap for the root disc labels, whose font size is fitted to the name instead. */
function truncateName(name: string): string {
  return name.length > MAX_NAME_CHARS ? `${name.slice(0, MAX_NAME_CHARS - 3)}…` : name;
}

/** Free space kept at each end of a card's name; covers the entry strip. */
const NAME_PADDING = 6;

let measureContext: CanvasRenderingContext2D | null = null;
const fittedNames = new Map<string, string>();

/**
 * The name as it fits `maxWidth` at this font — whole, or cut with an ellipsis.
 * Measured on a canvas rather than on the SVG text: no layout reflow per card,
 * and the canvas lays the same font out to the same width.
 */
function fitName(name: string, maxWidth: number, fontSize: number, fontWeight: number): string {
  const key = `${fontWeight}|${fontSize}|${Math.round(maxWidth)}|${name}`;
  const cached = fittedNames.get(key);
  if (cached !== undefined) return cached;

  measureContext ??= document.createElement('canvas').getContext('2d');
  let fitted = name;
  if (measureContext) {
    measureContext.font = `${fontWeight} ${fontSize}px ${FONT_STACK}`;
    const width = (text: string) => measureContext!.measureText(text).width;
    if (width(name) > maxWidth) {
      // Longest prefix that still fits together with the ellipsis.
      let lo = 0;
      let hi = name.length;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (width(`${name.slice(0, mid).trimEnd()}…`) <= maxWidth) lo = mid;
        else hi = mid - 1;
      }
      fitted = lo > 0 ? `${name.slice(0, lo).trimEnd()}…` : '';
    }
  }
  fittedNames.set(key, fitted);
  return fitted;
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

const smoothLine = line<Point>()
  .x((p) => p.x)
  .y((p) => p.y)
  .curve(curveCatmullRom.alpha(0.5));

/** The link's sampled course (see `linkPoints` in the layout), smoothed through every point. */
function linkPath(link: PlacedLink): string {
  return smoothLine(link.points) ?? '';
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
  /** Last rendered scene, redrawn when a web font finishes loading. */
  private last: { layout: Layout; settings: Settings } | null = null;

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

    // Names are fitted by measuring the font; until Spectral arrives that is
    // the fallback serif, so measure again once it (or its bold face) loads.
    document.fonts?.addEventListener('loadingdone', () => {
      fittedNames.clear();
      if (this.last) this.update(this.last.layout, this.last.settings);
    });
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
    this.last = { layout, settings };
    this.svg.style('background-color', settings.canvasColor ?? null);
    this.renderRings(layout, settings);
    this.renderLinks(layout, settings);
    this.renderFamilies(layout, settings);
    this.renderRoot(layout, settings);
  }

  /** Scales and centers the drawing so the whole tree is visible. */
  fitToContent(extent: Layout['extent'], animate = true): void {
    const padding = 24;
    const k = Math.min(
      (this.viewWidth - padding * 2) / Math.max(extent.halfWidth * 2, 1),
      (this.viewHeight - padding * 2) / Math.max(extent.halfHeight * 2, 1),
      1.5
    );
    const transform = zoomIdentity.scale(Math.max(k, 0.03));
    const target = animate ? this.svg.transition().duration(400) : this.svg;
    target.call(this.zoomBehavior.transform, transform);
  }

  private renderRings(layout: Layout, settings: Settings): void {
    this.ringLayer
      .selectAll<SVGPathElement, number>('path')
      .data(settings.showRings ? layout.rings : [])
      .join('path')
      .attr('d', (d) => trackPath(layout.track, d))
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
      .attr('d', (d) => linkPath(d));
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
        // The name sits in its own clipped group: the text carries a rotation,
        // and a clip on it would rotate along.
        g.append('g').attr('class', 'card-label').append('text').attr('class', 'card-name');
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

    // Backstop for what width fitting can't catch — a font taller than the card.
    cardSel.select<SVGGElement>('g.card-label').attr('clip-path', (d) => `url(#${cardClipId(d)})`);

    const fontWeight = settings.boldFont ? 700 : 400;
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
      .attr('font-weight', fontWeight)
      .attr('fill', palette.text)
      .text((d) =>
        fitName(d.card.person.name, d.card.width - 2 * NAME_PADDING, settings.fontSize, fontWeight)
      );

    cardSel.select('title').text((d) => personTitle(d.card.person));
  }

  /**
   * The core: a disc (circle) or pill (stadium) cut into one horizontal band per
   * line of text — each root spouse, then each generation folded into the core
   * («→ Элем»). For the usual couple that is the familiar top and bottom halves.
   */
  private renderRoot(layout: Layout, settings: Settings): void {
    const { core, track } = layout;
    const rows: CoreRow[] = [
      ...core.people.map((person) => ({ key: person.id, people: [person], text: person.name })),
      ...core.chain.map((people) => ({
        key: people.map((p) => p.id).join('+'),
        people,
        text: `→ ${people.map((p) => p.name).join(' + ')}`
      }))
    ];

    const rootSel = this.rootLayer
      .selectAll<SVGGElement, Core>('g.root-node')
      .data(rows.length ? [core] : [])
      .join((enter) => {
        const g = enter.append('g').attr('class', 'root-node');
        g.append('clipPath').attr('id', CORE_CLIP_ID).append('path');
        g.append('path').attr('class', 'halo');
        g.append('g').attr('class', 'bands').attr('clip-path', `url(#${CORE_CLIP_ID})`);
        g.append('path').attr('class', 'outline');
        g.append('g').attr('class', 'labels');
        g.append('title');
        return g;
      });
    if (rootSel.empty()) return;

    const r = core.radius;
    const shape = trackPath(track, r);
    const m = rows.length;
    const bandHeight = (2 * r) / m;
    const bandTop = (i: number) => -r + i * bandHeight;
    const bandMiddle = (i: number) => bandTop(i) + bandHeight / 2;
    /** Half the core's width at height y: the straight part plus the round end's chord. */
    const halfWidthAt = (y: number) => track.half + Math.sqrt(Math.max(r * r - y * y, 0));

    rootSel.select('clipPath path').attr('d', shape);
    rootSel
      .select<SVGPathElement>('path.halo')
      .attr('d', trackPath(track, r + 5))
      .attr('fill', '#ffffff')
      .attr('stroke', palette.rootHalo)
      .attr('stroke-width', 1);

    rootSel
      .select('g.bands')
      .selectAll<SVGRectElement, CoreRow>('rect')
      .data(rows, (d) => d.key)
      .join('rect')
      .attr('x', -(track.half + r))
      .attr('y', (_d, i) => bandTop(i))
      .attr('width', 2 * (track.half + r))
      .attr('height', bandHeight)
      .attr('fill', (d) => sexColors(d.people[0]?.sex ?? 'U', settings).fill);

    rootSel
      .select('g.bands')
      .selectAll<SVGLineElement, number>('line')
      .data(rows.slice(1).map((_d, i) => bandTop(i + 1)))
      .join('line')
      .attr('x1', (y) => -halfWidthAt(y))
      .attr('x2', (y) => halfWidthAt(y))
      .attr('y1', (y) => y)
      .attr('y2', (y) => y)
      .attr('stroke', '#ffffff')
      .attr('stroke-width', 1.5);

    rootSel
      .select<SVGPathElement>('path.outline')
      .attr('d', shape)
      .attr('fill', 'none')
      .attr('stroke', sexColors(rows[0]!.people[0]?.sex ?? 'U', settings).border)
      .attr('stroke-width', 1.2);

    // One font size for every row, as large as the band height allows and small
    // enough that each row fits the core's width at its own height.
    const byHeight = m > 1 ? bandHeight * 0.4 : r * 0.55;
    const byWidth = Math.min(
      ...rows.map((row, i) => (halfWidthAt(bandMiddle(i)) * 2 * 0.8) / (Math.max(row.text.length, 1) * 0.58))
    );
    const fontSize = Math.max(Math.min(byWidth, byHeight), 5);

    rootSel
      .select('g.labels')
      .selectAll<SVGTextElement, CoreRow>('text')
      .data(rows, (d) => d.key)
      .join('text')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('y', (_d, i) => (m > 1 ? bandMiddle(i) : 0))
      .attr('font-size', fontSize)
      .attr('font-weight', 600)
      .attr('fill', palette.text)
      .text((d) => truncateName(d.text));

    rootSel
      .select('title')
      .text([...core.people.map(personTitle), ...core.chain.map((people) => people.map(personTitle).join(' + '))].join('\n'));
  }
}
