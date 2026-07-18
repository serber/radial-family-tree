import './style.css';
import { AppError } from './errors.ts';
import { parseGedcom } from './gedcom/parser.ts';
import { sampleGedcom } from './gedcom/sample.ts';
import type { GedcomData } from './gedcom/types.ts';
import { applyStaticTranslations, getLocale, onLocaleChange, setLocale, t, type Locale } from './i18n/index.ts';
import { buildTree, listRootCandidates, type DescendantTree } from './tree/build.ts';
import { computeLayout, type Layout } from './layout/radial.ts';
import { TreeRenderer } from './render/renderer.ts';
import { downloadBlob, renderJpeg } from './export/exportJpeg.ts';
import { PRINT_SIZES, defaultSettings, type PrintSize, type Settings } from './settings.ts';
import { buildSettingsPanel } from './ui/controls.ts';

const settings: Settings = { ...defaultSettings };
let data: GedcomData | null = null;
let tree: DescendantTree | null = null;
let layout: Layout | null = null;

const el = {
  chart: document.getElementById('chart') as HTMLDivElement,
  status: document.getElementById('status') as HTMLSpanElement,
  fileInput: document.getElementById('fileInput') as HTMLInputElement,
  sampleBtn: document.getElementById('sampleBtn') as HTMLButtonElement,
  rootSelect: document.getElementById('rootSelect') as HTMLSelectElement,
  settingsPanel: document.getElementById('settingsPanel') as HTMLDivElement,
  printSizeSelect: document.getElementById('printSizeSelect') as HTMLSelectElement,
  exportBtn: document.getElementById('exportBtn') as HTMLButtonElement,
  fitBtn: document.getElementById('fitBtn') as HTMLButtonElement,
  langSwitch: document.getElementById('langSwitch') as HTMLDivElement
};

const renderer = new TreeRenderer(el.chart);

function errorMessage(error: unknown): string {
  if (error instanceof AppError) return t(`errors.${error.code}`, error.params);
  return (error as Error).message;
}

function setStatus(message: string, isError = false): void {
  el.status.textContent = message;
  el.status.classList.toggle('error', isError);
}

function showStats(): void {
  if (!tree) return;
  setStatus(
    t('status.stats', {
      people: tree.peopleCount,
      families: tree.nodeCount,
      generations: tree.maxGeneration + 1
    })
  );
}

function rerender(): void {
  // Keep the sidebar legend swatches in sync with the card colors.
  document.documentElement.style.setProperty('--male', settings.maleColor);
  document.documentElement.style.setProperty('--female', settings.femaleColor);
  if (!tree) return;
  layout = computeLayout(tree, settings);
  renderer.update(layout, settings);
}

function selectRoot(familyId: string, fit: boolean): void {
  if (!data) return;
  try {
    tree = buildTree(data, familyId);
    rerender();
    if (fit && layout) renderer.fitToContent(layout.maxRadius, false);
    showStats();
  } catch (error) {
    setStatus(t('status.error', { message: errorMessage(error) }), true);
  }
}

function populateRootSelect(): void {
  if (!data) return;
  const selected = el.rootSelect.value;
  const candidates = listRootCandidates(data);
  el.rootSelect.replaceChildren(
    ...candidates.map((candidate) => {
      const option = document.createElement('option');
      option.value = candidate.familyId;
      option.textContent = t('status.rootOption', { label: candidate.label, count: candidate.descendants });
      return option;
    })
  );
  el.rootSelect.disabled = candidates.length === 0;
  if (candidates.some((c) => c.familyId === selected)) el.rootSelect.value = selected;
}

function loadGedcom(text: string): void {
  try {
    data = parseGedcom(text);
  } catch (error) {
    setStatus(t('status.error', { message: errorMessage(error) }), true);
    return;
  }

  populateRootSelect();
  const first = el.rootSelect.options[0];
  if (first) {
    el.rootSelect.value = first.value;
    selectRoot(first.value, true);
  }
}

function readFile(file: File): void {
  const reader = new FileReader();
  reader.onload = () => loadGedcom(String(reader.result));
  reader.onerror = () => setStatus(t('status.readFileError'), true);
  reader.readAsText(file, 'utf-8');
}

function setupDataInputs(): void {
  el.fileInput.addEventListener('change', () => {
    const file = el.fileInput.files?.[0];
    if (file) readFile(file);
    el.fileInput.value = '';
  });

  el.sampleBtn.addEventListener('click', () => loadGedcom(sampleGedcom));

  el.rootSelect.addEventListener('change', () => selectRoot(el.rootSelect.value, true));

  // Drag & drop of a .ged file onto the chart.
  el.chart.addEventListener('dragover', (event) => {
    event.preventDefault();
    el.chart.classList.add('dragover');
  });
  el.chart.addEventListener('dragleave', () => el.chart.classList.remove('dragover'));
  el.chart.addEventListener('drop', (event) => {
    event.preventDefault();
    el.chart.classList.remove('dragover');
    const file = event.dataTransfer?.files?.[0];
    if (file) readFile(file);
  });
}

function sizeLabel(size: PrintSize): string {
  return t(`printSizes.${size.key}`);
}

function populatePrintSizes(): void {
  const selected = el.printSizeSelect.value || 'a1';
  el.printSizeSelect.replaceChildren(
    ...PRINT_SIZES.map((size) => {
      const option = document.createElement('option');
      option.value = size.key;
      option.textContent = sizeLabel(size);
      return option;
    })
  );
  el.printSizeSelect.value = PRINT_SIZES.some((s) => s.key === selected) ? selected : 'a1';
}

function setupExport(): void {
  populatePrintSizes();

  el.exportBtn.addEventListener('click', async () => {
    if (!layout) {
      setStatus(t('status.loadFirst'), true);
      return;
    }
    const size = PRINT_SIZES.find((s) => s.key === el.printSizeSelect.value) ?? PRINT_SIZES[0]!;
    el.exportBtn.disabled = true;
    setStatus(t('status.exporting', { size: sizeLabel(size) }));
    try {
      const blob = await renderJpeg(renderer.element, layout.maxRadius, size, settings.canvasColor);
      downloadBlob(blob, `family-tree-${size.key}.jpg`);
      setStatus(t('status.saved', { size: sizeLabel(size) }));
    } catch (error) {
      console.error(error);
      setStatus(t('status.exportError', { message: errorMessage(error) }), true);
    } finally {
      el.exportBtn.disabled = false;
    }
  });
}

/** Re-applies every visible string in the current locale. */
function applyLocale(): void {
  document.documentElement.lang = getLocale();
  document.title = t('app.title');
  applyStaticTranslations();
  el.langSwitch.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
    button.classList.toggle('active', button.dataset['lang'] === getLocale());
  });
  buildSettingsPanel(el.settingsPanel, settings, rerender);
  populatePrintSizes();
  populateRootSelect();
  rerender(); // card tooltips contain translated life-year labels
  showStats();
}

function setupLangSwitch(): void {
  el.langSwitch.addEventListener('click', (event) => {
    const lang = (event.target as HTMLElement).closest('button')?.dataset['lang'];
    if (lang === 'en' || lang === 'ru') setLocale(lang as Locale);
  });
  onLocaleChange(applyLocale);
}

setupDataInputs();
setupExport();
setupLangSwitch();
el.fitBtn.addEventListener('click', () => {
  if (layout) renderer.fitToContent(layout.maxRadius);
});

applyLocale();
loadGedcom(sampleGedcom);
