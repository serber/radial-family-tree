import { hsl } from 'd3';
import type { Sex } from '../gedcom/types.ts';
import { t } from '../i18n/index.ts';
import type { Settings } from '../settings.ts';

/** Chart typography is serif (Spectral); the export embeds it, Georgia is the fallback. */
export const FONT_STACK = "'Spectral', Georgia, 'Times New Roman', serif";

export const palette = {
  text: '#26324a',
  ring: '#d9d2c2',
  rootHalo: '#e6e0d3',
  unknown: { fill: '#e9e6dd', accent: '#8a8579' }
} as const;

const accentCache = new Map<string, string>();

/** Derives the accent (entry strip) color from a card fill: same hue, darker and calmer. */
function accentFor(fill: string): string {
  let accent = accentCache.get(fill);
  if (!accent) {
    const c = hsl(fill);
    c.s = Number.isNaN(c.s) ? 0 : Math.min(c.s * 0.75, 1);
    c.l = Math.min(Math.max(c.l * 0.66, 0.25), 0.72);
    accent = c.formatHex();
    accentCache.set(fill, accent);
  }
  return accent;
}

export function sexColors(
  sex: Sex,
  settings: Pick<Settings, 'maleColor' | 'femaleColor'>
): { fill: string; accent: string } {
  if (sex === 'M') return { fill: settings.maleColor, accent: accentFor(settings.maleColor) };
  if (sex === 'F') return { fill: settings.femaleColor, accent: accentFor(settings.femaleColor) };
  return palette.unknown;
}

export function lifeSpanLabel(birthYear: number | null, deathYear: number | null): string | null {
  if (birthYear !== null && deathYear !== null) return `${birthYear}–${deathYear}`;
  if (birthYear !== null) return t('life.born', { year: birthYear });
  if (deathYear !== null) return t('life.died', { year: deathYear });
  return null;
}
