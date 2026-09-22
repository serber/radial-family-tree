/** Visual & layout settings, adjustable from the side panel. */
export interface Settings {
  // ---- Layout -------------------------------------------------------------
  /**
   * Width : height of the chart. 1 draws circles; above 1 the rings become
   * stadiums (half circles joined by straight sides) around a central spine.
   */
  shapeStretch: number;
  /**
   * Fold a single line of descent at the top (root → only child → only child…)
   * into the central core, so the first ring holds the first real branching.
   */
  collapseChain: boolean;
  /**
   * Step (px) of each ring from the previous one — ring 1 from the core — as
   * set by hand. Rings past the end of the list use `defaultRingStep`. Kept per
   * ring because density differs from tree to tree and ring to ring.
   */
  ringSteps: number[];
  /** Arc length (px) kept free between neighbouring cards on a ring. */
  cardSpacing: number;

  // ---- Card ---------------------------------------------------------------
  /** Card extent along the radial axis (px). Never affects ring radii. */
  cardLength: number;
  /** Card extent along the tangential axis (px). Never affects ring radii. */
  cardThickness: number;
  fontSize: number;
  /** Render card names in bold. */
  boldFont: boolean;
  cornerRadius: number;
  /** Glue spouse cards together: no gap between them, whatever cardSpacing says. */
  tightSpouses: boolean;
  showBothSpouses: boolean;

  // ---- Style --------------------------------------------------------------
  maleColor: string;
  femaleColor: string;
  /** Card outline color. */
  borderColor: string;
  lineColor: string;
  lineWidth: number;
  /** Dashed generation rings. */
  showRings: boolean;
  /** Color of the dashed generation rings. */
  ringColor: string;
  /** Background color of the drawing canvas (screen and export). */
  canvasColor: string;
}

export const defaultSettings: Settings = {
  shapeStretch: 1,
  collapseChain: true,
  ringSteps: [],
  cardSpacing: 10,

  cardLength: 145,
  cardThickness: 25,
  fontSize: 12,
  boldFont: false,
  cornerRadius: 0,
  tightSpouses: true,
  showBothSpouses: true,

  maleColor: '#d8e7f8',
  femaleColor: '#fadbe7',
  borderColor: '#b7bccb',
  lineColor: '#b7bccb',
  lineWidth: 1.4,
  showRings: true,
  ringColor: '#d9d2c2',
  canvasColor: '#f7f4ee'
};

/**
 * Step of ring `ring` (1-based) when none is set: roomier for the first two,
 * where few cards sit and the core needs space.
 */
export function defaultRingStep(ring: number): number {
  return ring <= 2 ? 215 : 180;
}

/** The step ring `ring` (1-based) actually asks for: set by hand, or the default. */
export function ringStep(settings: Pick<Settings, 'ringSteps'>, ring: number): number {
  return settings.ringSteps[ring - 1] ?? defaultRingStep(ring);
}

export interface PrintSize {
  /** Also the i18n key of the visible label: `printSizes.<key>`. */
  key: string;
  width: number;
  height: number;
}

/** Export canvas presets: landscape print formats at 300 DPI plus screen sizes. */
export const PRINT_SIZES: readonly PrintSize[] = [
  { key: 'a3', width: 4961, height: 3508 },
  { key: 'a2', width: 7016, height: 4961 },
  { key: 'a1', width: 9933, height: 7016 },
  { key: 'a0', width: 14043, height: 9933 },
  { key: 'fullhd', width: 1920, height: 1080 },
  { key: '4k', width: 3840, height: 2160 },
  { key: 'square', width: 2400, height: 2400 }
];
