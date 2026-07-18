import { IntlMessageFormat } from 'intl-messageformat';
import en from '../../messages/en.json';
import ru from '../../messages/ru.json';

/**
 * Minimal i18n built on intl-messageformat — the same ICU engine and
 * messages/<locale>.json convention as next-intl in the air360 portal
 * (which itself is Next.js-only, hence not usable here directly).
 */

export type Locale = 'en' | 'ru';
export const LOCALES: readonly Locale[] = ['en', 'ru'];

const STORAGE_KEY = 'radial-locale';
const catalogs: Record<Locale, unknown> = { en, ru };

let currentLocale: Locale = resolveInitialLocale();
const formatterCache = new Map<string, IntlMessageFormat>();
const listeners = new Set<() => void>();

function resolveInitialLocale(): Locale {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'en' || stored === 'ru') return stored;
  return navigator.language?.toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

function lookup(catalog: unknown, path: string): string | null {
  let node: unknown = catalog;
  for (const part of path.split('.')) {
    if (node === null || typeof node !== 'object') return null;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : null;
}

export function getLocale(): Locale {
  return currentLocale;
}

export function setLocale(locale: Locale): void {
  if (locale === currentLocale) return;
  currentLocale = locale;
  localStorage.setItem(STORAGE_KEY, locale);
  formatterCache.clear();
  for (const listener of listeners) listener();
}

/** Subscribes to locale switches; the callback should re-apply all visible text. */
export function onLocaleChange(listener: () => void): void {
  listeners.add(listener);
}

/** Translates a dot-path key; missing keys fall back to English, then to the key itself. */
export function t(key: string, values?: Record<string, string | number>): string {
  const message = lookup(catalogs[currentLocale], key) ?? lookup(catalogs.en, key);
  if (message === null) return key;
  if (!values) return message;
  let formatter = formatterCache.get(key);
  if (!formatter) {
    formatter = new IntlMessageFormat(message, currentLocale);
    formatterCache.set(key, formatter);
  }
  return String(formatter.format(values));
}

/** Replaces textContent of every element carrying a data-i18n="key" attribute. */
export function applyStaticTranslations(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((element) => {
    const key = element.dataset['i18n'];
    if (key) element.textContent = t(key);
  });
}
