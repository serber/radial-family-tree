import { t } from '../i18n/index.ts';
import type { Settings } from '../settings.ts';

type KeysOfType<T, V> = { [K in keyof T]-?: T[K] extends V ? K : never }[keyof T];
export type NumericSettingKey = KeysOfType<Settings, number>;
export type BooleanSettingKey = KeysOfType<Settings, boolean>;
export type ColorSettingKey = KeysOfType<Settings, string>;

export interface RangeControl {
  kind: 'range';
  key: NumericSettingKey;
  /** i18n key of the visible label. */
  labelKey: string;
  /** Bounds in display units (see toValue/toDisplay). */
  min: number;
  max: number;
  step?: number;
  /** Maps display units → stored value (e.g. 85% → 0.85). Identity by default. */
  toValue?: (display: number) => number;
  toDisplay?: (value: number) => number;
  format?: (display: number) => string;
}

export interface ColorControl {
  kind: 'color';
  key: ColorSettingKey;
  labelKey: string;
}

export interface ToggleControl {
  kind: 'toggle';
  key: BooleanSettingKey;
  labelKey: string;
}

export type ControlDef = RangeControl | ColorControl | ToggleControl;

export interface ControlGroup {
  titleKey: string;
  open?: boolean;
  controls: ControlDef[];
}

export const controlGroups: ControlGroup[] = [
  {
    titleKey: 'groups.layout',
    open: true,
    controls: [
      { kind: 'range', key: 'ringGap', labelKey: 'controls.ringGap', min: 60, max: 500 },
      {
        kind: 'range',
        key: 'ringGrowth', labelKey: 'controls.ringGrowth',
        min: 100,
        max: 160,
        toValue: (v) => v / 100,
        toDisplay: (v) => Math.round(v * 100),
        format: (v) => `${v}%`
      },
      { kind: 'range', key: 'innerRingGap', labelKey: 'controls.innerRingGap', min: 60, max: 600 },
      { kind: 'range', key: 'cardSpacing', labelKey: 'controls.cardSpacing', min: 0, max: 160 }
    ]
  },
  {
    titleKey: 'groups.card',
    open: true,
    controls: [
      { kind: 'range', key: 'cardLength', labelKey: 'controls.cardLength', min: 40, max: 320 },
      { kind: 'range', key: 'cardThickness', labelKey: 'controls.cardThickness', min: 8, max: 140 },
      { kind: 'range', key: 'fontSize', labelKey: 'controls.fontSize', min: 6, max: 26 },
      { kind: 'toggle', key: 'boldFont', labelKey: 'controls.boldFont' },
      { kind: 'range', key: 'cornerRadius', labelKey: 'controls.cornerRadius', min: 0, max: 30 },
      { kind: 'toggle', key: 'tightSpouses', labelKey: 'controls.tightSpouses' },
      { kind: 'toggle', key: 'showBothSpouses', labelKey: 'controls.showBothSpouses' }
    ]
  },
  {
    titleKey: 'groups.style',
    open: true,
    controls: [
      { kind: 'color', key: 'maleColor', labelKey: 'controls.maleColor' },
      { kind: 'color', key: 'femaleColor', labelKey: 'controls.femaleColor' },
      { kind: 'color', key: 'borderColor', labelKey: 'controls.borderColor' },
      { kind: 'color', key: 'lineColor', labelKey: 'controls.lineColor' },
      { kind: 'range', key: 'lineWidth', labelKey: 'controls.lineWidth', min: 0.2, max: 6, step: 0.1 },
      { kind: 'toggle', key: 'showRings', labelKey: 'controls.showRings' },
      { kind: 'color', key: 'ringColor', labelKey: 'controls.ringColor' },
      { kind: 'color', key: 'canvasColor', labelKey: 'controls.canvasColor' }
    ]
  }
];

/**
 * Builds the settings panel DOM; every change writes into `settings` and calls `onChange`.
 * Idempotent: re-running (e.g. after a locale switch) replaces the previous panel
 * and keeps each group's collapsed/expanded state.
 */
export function buildSettingsPanel(
  container: HTMLElement,
  settings: Settings,
  onChange: () => void
): void {
  const previousOpen = [...container.querySelectorAll('details')].map((d) => d.open);
  container.replaceChildren();

  controlGroups.forEach((group, index) => {
    const details = document.createElement('details');
    details.className = 'panel';
    details.open = previousOpen[index] ?? group.open ?? false;

    const summary = document.createElement('summary');
    summary.textContent = t(group.titleKey);
    details.append(summary);

    const body = document.createElement('div');
    body.className = 'panel__body';
    for (const def of group.controls) {
      body.append(createControl(def, settings, onChange));
    }
    details.append(body);
    container.append(details);
  });
}

function createControl(def: ControlDef, settings: Settings, onChange: () => void): HTMLElement {
  switch (def.kind) {
    case 'range':
      return createRange(def, settings, onChange);
    case 'color':
      return createColor(def, settings, onChange);
    case 'toggle':
      return createToggle(def, settings, onChange);
  }
}

function controlShell(label: string): { root: HTMLLabelElement; head: HTMLDivElement; output: HTMLOutputElement } {
  const root = document.createElement('label');
  root.className = 'control';
  const head = document.createElement('div');
  head.className = 'control__head';
  const span = document.createElement('span');
  span.textContent = label;
  const output = document.createElement('output');
  head.append(span, output);
  root.append(head);
  return { root, head, output };
}

function createRange(def: RangeControl, settings: Settings, onChange: () => void): HTMLElement {
  const toDisplay = def.toDisplay ?? ((v: number) => v);
  const toValue = def.toValue ?? ((v: number) => v);
  const format = def.format ?? ((v: number) => String(v));

  const { root, output } = controlShell(t(def.labelKey));
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(def.min);
  input.max = String(def.max);
  input.step = String(def.step ?? 1);
  input.value = String(toDisplay(settings[def.key]));
  output.textContent = format(toDisplay(settings[def.key]));

  input.addEventListener('input', () => {
    const display = Number(input.value);
    if (Number.isNaN(display)) return;
    settings[def.key] = toValue(display);
    output.textContent = format(display);
    onChange();
  });

  root.append(input);
  return root;
}

function createColor(def: ColorControl, settings: Settings, onChange: () => void): HTMLElement {
  const { root, output } = controlShell(t(def.labelKey));
  const input = document.createElement('input');
  input.type = 'color';
  input.value = settings[def.key];
  output.textContent = settings[def.key];

  input.addEventListener('input', () => {
    settings[def.key] = input.value;
    output.textContent = input.value;
    onChange();
  });

  root.append(input);
  return root;
}

function createToggle(def: ToggleControl, settings: Settings, onChange: () => void): HTMLElement {
  const root = document.createElement('label');
  root.className = 'control control--toggle';
  const span = document.createElement('span');
  span.textContent = t(def.labelKey);

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = settings[def.key];
  const switchEl = document.createElement('span');
  switchEl.className = 'switch';

  input.addEventListener('change', () => {
    settings[def.key] = input.checked;
    onChange();
  });

  root.append(span, input, switchEl);
  return root;
}
