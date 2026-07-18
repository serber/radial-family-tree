import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

/**
 * Generates dist/en/index.html — the crawlable English entry point
 * (https://gedtree.ru/en/) — from the built Russian dist/index.html, so
 * there is a single source page and the English copy can never drift
 * structurally. Text comes from messages/en.json (the same catalog the
 * runtime uses); head metadata is defined below. Every replacement is
 * required to match, so editing the Russian head without updating this
 * file fails the build instead of silently shipping mixed languages.
 */

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const enCatalog = JSON.parse(
  readFileSync(resolve(scriptsDir, '../messages/en.json'), 'utf8')
) as Record<string, unknown>;

const ORIGIN = 'https://gedtree.ru';
const EN_URL = `${ORIGIN}/en/`;

const DESCRIPTION =
  'Free online family tree visualizer for GEDCOM files: a radial (circular) descendant chart, flexible styling and JPEG export for printing a poster. Your file is processed right in the browser and never uploaded anywhere.';
const KEYWORDS =
  'family tree, genealogy, ancestry, GEDCOM, GEDCOM viewer, GEDCOM visualization, radial family tree, circular family tree, descendant chart, family tree poster, genealogy chart, family tree maker';
const OG_TITLE = 'Radial Family Tree — GEDCOM Visualizer';
const OG_DESCRIPTION =
  'Upload a GEDCOM file and get a beautiful circular family tree chart with JPEG export for printing. Free, no signup, your data never leaves the browser.';
const TWITTER_DESCRIPTION =
  'Circular family tree chart from a GEDCOM file with JPEG export for poster printing.';
const NOSCRIPT =
  'Radial Family Tree is a free online GEDCOM family tree visualizer. Load a file exported from any genealogy application (MyHeritage, Gramps, Family Tree Builder, Ancestry and others) and get a circular descendant chart with JPEG export for poster printing. JavaScript must be enabled to use the app.';

const JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  name: 'Radial Family Tree',
  alternateName: 'Радиальное семейное дерево',
  url: EN_URL,
  description:
    'Online genealogy tree visualizer for GEDCOM files: a radial descendant chart with JPEG export for poster printing. Data is processed locally in the browser.',
  image: `${ORIGIN}/og-image.jpg`,
  applicationCategory: 'UtilitiesApplication',
  operatingSystem: 'Any',
  browserRequirements: 'Requires JavaScript',
  inLanguage: ['en', 'ru'],
  isAccessibleForFree: true,
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  featureList: [
    'Load GEDCOM files (processed entirely in the browser)',
    'Radial (circular) descendant chart',
    'Adjustable geometry, cards and colors',
    'JPEG export in A3–A0 print formats, Full HD and 4K'
  ]
};

function lookup(catalog: unknown, path: string): string | null {
  let node: unknown = catalog;
  for (const part of path.split('.')) {
    if (node === null || typeof node !== 'object') return null;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : null;
}

function replaceOnce(html: string, pattern: RegExp, replacement: string, what: string): string {
  if (!pattern.test(html)) {
    throw new Error(`en-page: could not find ${what} in dist/index.html — update scripts/enPagePlugin.ts`);
  }
  return html.replace(pattern, replacement);
}

function setMeta(html: string, attr: 'name' | 'property', id: string, content: string): string {
  return replaceOnce(
    html,
    new RegExp(`(<meta[^>]*${attr}="${id}"[^>]*content=")[^"]*(")`),
    `$1${content}$2`,
    `<meta ${attr}="${id}">`
  );
}

function toEnglish(html: string): string {
  html = replaceOnce(html, /<html lang="ru">/, '<html lang="en">', '<html lang="ru">');
  const title = lookup(enCatalog, 'app.title') ?? OG_TITLE;
  html = replaceOnce(html, /<title>[^<]*<\/title>/, `<title>${title}</title>`, '<title>');

  html = setMeta(html, 'name', 'description', DESCRIPTION);
  html = setMeta(html, 'name', 'keywords', KEYWORDS);
  html = setMeta(html, 'property', 'og:title', OG_TITLE);
  html = setMeta(html, 'property', 'og:description', OG_DESCRIPTION);
  html = setMeta(html, 'property', 'og:url', EN_URL);
  html = setMeta(html, 'property', 'og:locale', 'en_US');
  html = setMeta(html, 'property', 'og:locale:alternate', 'ru_RU');
  html = setMeta(html, 'name', 'twitter:title', OG_TITLE);
  html = setMeta(html, 'name', 'twitter:description', TWITTER_DESCRIPTION);
  html = replaceOnce(
    html,
    /(<link rel="canonical" href=")[^"]*/,
    `$1${EN_URL}`,
    'canonical link'
  );
  html = replaceOnce(
    html,
    /<script type="application\/ld\+json">[\s\S]*?<\/script>/,
    `<script type="application/ld+json">\n      ${JSON.stringify(JSON_LD, null, 2).replace(/\n/g, '\n      ')}\n    </script>`,
    'JSON-LD block'
  );
  html = replaceOnce(
    html,
    /<noscript>[\s\S]*?<\/noscript>/,
    `<noscript>\n      <p>\n        ${NOSCRIPT}\n      </p>\n    </noscript>`,
    'noscript block'
  );

  // Static UI text: same data-i18n keys the runtime uses, resolved from en.json.
  html = html.replace(
    /(data-i18n="([^"]+)"[^>]*>)([^<]*)/g,
    (_match, open: string, key: string, text: string) => open + (lookup(enCatalog, key) ?? text)
  );

  // The page lives one level deeper, so Vite's `./` asset URLs need one more hop.
  html = html.replace(/(href|src)="\.\//g, '$1="../');
  return html;
}

export function enPagePlugin(): Plugin {
  let outDir = '';
  return {
    name: 'en-page',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const html = readFileSync(resolve(outDir, 'index.html'), 'utf8');
      mkdirSync(resolve(outDir, 'en'), { recursive: true });
      writeFileSync(resolve(outDir, 'en/index.html'), toEnglish(html));
    }
  };
}
