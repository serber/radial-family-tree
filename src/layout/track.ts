import type { Point } from './radial.ts';

/**
 * The shape every generation ring follows: all points at distance `d` from the
 * spine, the segment [-half, half] on the x axis — a stadium (two half circles
 * joined by straight sides). `half = 0` makes it a circle, so the round chart is
 * just the special case.
 *
 * A stadium, unlike an ellipse, keeps the same shape when offset: every ring is
 * again a stadium around the same spine, so the gap between two rings is the
 * same all the way round, and all rings share their normals. That is what lets
 * descendants stand in straight columns along the sides and fan out round the
 * ends, like a hand-drawn genealogy on a wide sheet.
 *
 * Positions are addressed by *piece* and fraction within it. The pieces, in
 * order (angles as in SVG: y down, so increasing angle runs clockwise):
 *   0  left end, upper quarter   — arc around (-half, 0), angle −π … −π/2
 *   1  top side                  — x from −half to half, y = −d
 *   2  right end                 — arc around (half, 0), angle −π/2 … π/2
 *   3  bottom side               — x from half to −half, y = d
 *   4  left end, lower quarter   — arc around (-half, 0), angle π/2 … π
 * The same (piece, fraction) lies on the same normal on every ring.
 */
export interface Track {
  /** Half the length of the straight sides; 0 for a circle. */
  half: number;
  /**
   * Distance whose ring defines the shared coordinate `u` ∈ [0, 1): arc length
   * along that ring, as a fraction of its perimeter. Only weighs the ends
   * against the sides; any positive value gives a valid coordinate.
   */
  ref: number;
}

export interface TrackSpot {
  piece: number;
  /** Position within the piece, 0…1. */
  f: number;
}

const PIECES = 5;
const CAPS: Record<number, { cx: 1 | -1; from: number; sweep: number }> = {
  0: { cx: -1, from: -Math.PI, sweep: Math.PI / 2 },
  2: { cx: 1, from: -Math.PI / 2, sweep: Math.PI },
  4: { cx: -1, from: Math.PI / 2, sweep: Math.PI / 2 }
};

function pieceLength(track: Track, piece: number, d: number): number {
  const cap = CAPS[piece];
  return cap ? cap.sweep * Math.max(d, 0) : 2 * track.half;
}

/** Length of the ring at distance `d`. */
export function perimeter(track: Track, d: number): number {
  return 2 * Math.PI * Math.max(d, 0) + 4 * track.half;
}

/** Arc length along the ring at `d` → piece and fraction. `s` wraps around. */
export function spotAt(track: Track, s: number, d: number): TrackSpot {
  const total = perimeter(track, d);
  if (total <= 0) return { piece: 0, f: 0 };
  let rest = ((s % total) + total) % total;
  for (let piece = 0; piece < PIECES; piece += 1) {
    const length = pieceLength(track, piece, d);
    if (rest < length || piece === PIECES - 1) {
      return { piece, f: length > 0 ? Math.min(rest / length, 1) : 0 };
    }
    rest -= length;
  }
  return { piece: 0, f: 0 };
}

/** Piece and fraction → arc length along the ring at `d`. */
export function arcAt(track: Track, spot: TrackSpot, d: number): number {
  let s = 0;
  for (let piece = 0; piece < spot.piece; piece += 1) s += pieceLength(track, piece, d);
  return s + spot.f * pieceLength(track, spot.piece, d);
}

/** Shared coordinate u ∈ [0, 1) → piece and fraction. */
export function spotOfU(track: Track, u: number): TrackSpot {
  return spotAt(track, u * perimeter(track, track.ref), track.ref);
}

/** Piece and fraction → shared coordinate u. */
export function uOfSpot(track: Track, spot: TrackSpot): number {
  const total = perimeter(track, track.ref);
  return total > 0 ? arcAt(track, spot, track.ref) / total : 0;
}

/** The point at `spot` on the ring at distance `d`, and the outward normal's angle there. */
export function locate(track: Track, spot: TrackSpot, d: number): { point: Point; normal: number } {
  const cap = CAPS[spot.piece];
  if (cap) {
    const angle = cap.from + spot.f * cap.sweep;
    return {
      point: { x: cap.cx * track.half + Math.cos(angle) * d, y: Math.sin(angle) * d },
      normal: angle
    };
  }
  if (spot.piece === 1) {
    return { point: { x: -track.half + spot.f * 2 * track.half, y: -d }, normal: -Math.PI / 2 };
  }
  return { point: { x: track.half - spot.f * 2 * track.half, y: d }, normal: Math.PI / 2 };
}

/** Nearest spine point → where `point` sits: its piece, fraction and distance. */
export function project(track: Track, point: Point): TrackSpot & { d: number } {
  const { half } = track;
  if (half > 0 && Math.abs(point.x) <= half) {
    const f = (point.x + half) / (2 * half);
    return point.y < 0 ? { piece: 1, f, d: -point.y } : { piece: 3, f: 1 - f, d: point.y };
  }
  // On one of the round ends (for a circle, both ends share the center).
  const cx = half > 0 ? Math.sign(point.x) * half : 0;
  const dx = point.x - cx;
  const angle = Math.atan2(point.y, dx); // (−π, π]
  const d = Math.hypot(dx, point.y);
  if (angle >= -Math.PI / 2 && angle <= Math.PI / 2 && (half <= 0 || point.x > 0)) {
    return { piece: 2, f: clamp01((angle + Math.PI / 2) / Math.PI), d };
  }
  // The left end is split where atan2 wraps, at angle ±π.
  if (angle < 0) return { piece: 0, f: clamp01((angle + Math.PI) / (Math.PI / 2)), d };
  return { piece: 4, f: clamp01((angle - Math.PI / 2) / (Math.PI / 2)), d };
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

/** SVG path of the ring at distance `d` (a circle when `half` is 0). */
export function trackPath(track: Track, d: number): string {
  const { half } = track;
  if (half <= 0) {
    return `M ${-d} 0 A ${d} ${d} 0 1 1 ${d} 0 A ${d} ${d} 0 1 1 ${-d} 0 Z`;
  }
  return (
    `M ${-half} ${-d} L ${half} ${-d} A ${d} ${d} 0 0 1 ${half} ${d} ` +
    `L ${-half} ${d} A ${d} ${d} 0 0 1 ${-half} ${-d} Z`
  );
}

/**
 * Points of a link from `start` to `end`, drawn in track coordinates: the
 * distance from the spine grows evenly while the position along the rings turns
 * along a smoothstep. The line leaves and arrives along the normals and bends
 * *along* the rings between, so it never cuts across the middle. Every link of
 * one generation band spans the same distances, so links whose ends keep their
 * order along the rings keep it all the way — they never cross.
 */
export function linkPoints(track: Track, start: Point, end: Point): Point[] {
  const a = project(track, start);
  const b = project(track, end);
  const u0 = uOfSpot(track, a);
  let du = uOfSpot(track, b) - u0;
  du -= Math.round(du); // the shorter way round
  const travel = Math.abs(du) * perimeter(track, (a.d + b.d) / 2);
  if (travel < 0.5) return [start, end];

  // Enough samples that the spline follows the ring; a short link needs few.
  const samples = Math.min(Math.max(Math.ceil(travel / 30), 6), 64);
  const points: Point[] = [start];
  for (let i = 1; i < samples; i += 1) {
    const t = i / samples;
    const u = u0 + du * t * t * (3 - 2 * t);
    points.push(locate(track, spotOfU(track, ((u % 1) + 1) % 1), a.d + (b.d - a.d) * t).point);
  }
  points.push(end);
  return points;
}
