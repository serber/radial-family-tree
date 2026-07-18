/** Visual & layout settings, adjustable from the side panel. */
export interface Settings {
  /** Extra arc length (px) reserved between neighbouring family blocks. */
  familySpacing: number;
  /** Card extent along the radial axis (px). */
  cardWidth: number;
  /** Card extent along the tangential axis (px). */
  cardHeight: number;
  fontSize: number;
  cornerRadius: number;
  /** Distance between generation rings (px), before decay. */
  generationGap: number;
  /** Multiplier applied to the gap for every generation from the 3rd on (0.5–1). */
  generationDecay: number;
  /** Radius of the first (children of root) ring. */
  firstRadius: number;
  /** Radius of the central root disc. */
  rootRadius: number;
  /** Gap between spouse cards inside one family block. */
  spouseGap: number;
  /** Length of the stub connecting a family block to its children fan-out. */
  junctionDepth: number;
  lineWidth: number;
  lineColor: string;
  maleColor: string;
  femaleColor: string;
  /** Derive the card outline from the fill (accentFor); overrides cardBorderColor. */
  autoCardBorder: boolean;
  /** Card outline color, used when autoCardBorder is off. */
  cardBorderColor: string;
  /** Background color of the drawing canvas (screen and export). */
  canvasColor: string;
  /** Extra scale for generations 1–2 (makes the core of the poster readable). */
  coreScale: number;
  showBothSpouses: boolean;
  curvedLines: boolean;
  showRings: boolean;
}

export const defaultSettings: Settings = {
  familySpacing: 10,
  cardWidth: 145,
  cardHeight: 25,
  fontSize: 12,
  cornerRadius: 0,
  generationGap: 100,
  generationDecay: 1,
  firstRadius: 140,
  rootRadius: 120,
  spouseGap: 0,
  junctionDepth: 16,
  lineWidth: 1.4,
  lineColor: '#b7bccb',
  maleColor: '#d8e7f8',
  femaleColor: '#fadbe7',
  autoCardBorder: true,
  cardBorderColor: '#8a8579',
  canvasColor: '#f7f4ee',
  coreScale: 1,
  showBothSpouses: true,
  curvedLines: true,
  showRings: true
};

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
