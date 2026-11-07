/*
 * UI strings. English is the source text and the key; each catalog in ./locales holds one language.
 * The language comes from ?lang=..., else from the choice saved in this browser, else from the
 * browser's first preferred language, else English. Changing it re-renders the app in place (the
 * camera keeps streaming). i18n.test.ts fails on a missing line, on different {placeholders} or on
 * a line that is no longer used, in any catalog.
 */
import { useSyncExternalStore } from 'react';
import { ES } from '@/lib/locales/es';
import { FR } from '@/lib/locales/fr';
import { HI } from '@/lib/locales/hi';
import { JA } from '@/lib/locales/ja';
import { PT_BR } from '@/lib/locales/ptBR';
import { ZH } from '@/lib/locales/zh';
import { readJson, writeJson } from '@/lib/storage';

export { PT_BR };

// Each language under its own name, so anyone finds theirs whatever the page shows now.
export const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'pt-BR', name: 'Português (BR)' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'zh', name: '中文' },
  { code: 'hi', name: 'हिन्दी' },
  { code: 'ja', name: '日本語' },
] as const;

export type Language = (typeof LANGUAGES)[number]['code'];
export type TranslationValues = Record<string, string | number>;
export type Translate = (text: string, values?: TranslationValues) => string;

export const CATALOGS: Readonly<Record<Exclude<Language, 'en'>, Readonly<Record<string, string>>>> = {
  'pt-BR': PT_BR,
  es: ES,
  fr: FR,
  zh: ZH,
  hi: HI,
  ja: JA,
};

const LANGUAGE_STORAGE = 'language';

/** "pt", "pt-PT", "es-MX", "zh-Hant", "ja_JP"... to one of ours, or null. */
export function matchLanguage(tag: string | null | undefined): Language | null {
  const primary = (tag ?? '').toLowerCase().split(/[-_]/)[0];
  if (primary === 'pt') {
    return 'pt-BR';
  }

  return LANGUAGES.find((language) => language.code === primary)?.code ?? null;
}

export function detectLanguage(search: string, languages: readonly string[], saved: unknown = null): Language {
  const forced = matchLanguage(new URLSearchParams(search).get('lang'));
  const chosen = typeof saved === 'string' ? matchLanguage(saved) : null;

  return forced ?? chosen ?? matchLanguage(languages[0]) ?? 'en';
}

export const fill = (text: string, values: TranslationValues = {}): string =>
  text.replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? String(values[name]) : match));

export const translator =
  (language: Language): Translate =>
  (text, values) =>
    fill(language === 'en' ? text : (CATALOGS[language][text] ?? text), values);

let current: Language = detectLanguage(
  window.location.search,
  navigator.languages,
  readJson('local', LANGUAGE_STORAGE),
);
const listeners = new Set<() => void>();

export const currentLanguage = (): Language => current;

export function setLanguage(language: Language): void {
  current = language;
  document.documentElement.lang = language;
  writeJson('local', LANGUAGE_STORAGE, language);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

/** The language now; the component re-renders when someone picks another one. */
export const useLanguage = (): Language => useSyncExternalStore(subscribe, currentLanguage);

export const t: Translate = (text, values) => translator(current)(text, values);
