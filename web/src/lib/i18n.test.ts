import { act, renderHook } from '@testing-library/react';
import {
  CATALOGS,
  currentLanguage,
  detectLanguage,
  fill,
  matchLanguage,
  setLanguage,
  t,
  translator,
  useLanguage,
} from '@/lib/i18n';
import { readJson } from '@/lib/storage';

// Every source file of the app: t('...') calls must all have their pt-BR line.
const sources = import.meta.glob<string>(['../**/*.{ts,tsx}', '!../**/*.test.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

const TRANSLATED_CALL = /\bt\(\s*'((?:[^'\\]|\\.)*)'/g;
const MINIMUM_EXPECTED_STRINGS = 40;

const usedStrings = new Set(
  Object.values(sources).flatMap((source) =>
    [...source.matchAll(TRANSLATED_CALL)].map((match) => (match[1] ?? '').replace(/\\'/g, "'")),
  ),
);

const placeholders = (text: string): string[] =>
  [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? '').sort((first, second) => first.localeCompare(second));

describe('i18n catalog', () => {
  it('finds the translated strings of the app', () => {
    expect(usedStrings.size).toBeGreaterThanOrEqual(MINIMUM_EXPECTED_STRINGS);
    expect(usedStrings.has('Start streaming')).toBe(true);
    expect(usedStrings.has('Watching the LAN Webcam')).toBe(true);
  });

  it.each(Object.entries(CATALOGS))('%s has a line for every string the app uses', (_language, catalog) => {
    expect([...usedStrings].filter((text) => !(text in catalog))).toEqual([]);
  });

  it.each(Object.entries(CATALOGS))('%s keeps the same {placeholders}', (_language, catalog) => {
    const mismatched = Object.entries(catalog).filter(
      ([english, translated]) => placeholders(english).join() !== placeholders(translated).join(),
    );

    expect(mismatched).toEqual([]);
  });

  it.each(Object.entries(CATALOGS))('%s has no line left unused', (_language, catalog) => {
    expect(Object.keys(catalog).filter((text) => !usedStrings.has(text))).toEqual([]);
  });
});

describe('language', () => {
  it.each([
    [['pt-BR', 'en'], 'pt-BR'],
    [['pt'], 'pt-BR'],
    [['pt-PT'], 'pt-BR'],
    [['en-US', 'pt-BR'], 'en'],
    [['es-MX'], 'es'],
    [['fr-CA'], 'fr'],
    [['zh-Hant-TW'], 'zh'],
    [['hi-IN'], 'hi'],
    [['ja_JP'], 'ja'],
    [['de'], 'en'],
    [[], 'en'],
  ])('browser languages %j give %s', (languages, expected) => {
    expect(detectLanguage('', languages)).toBe(expected);
  });

  it.each([
    ['?lang=en', ['pt-BR'], 'ja', 'en'],
    ['?lang=pt_BR', ['en-US'], null, 'pt-BR'],
    ['?lang=xx', ['en-US'], 'fr', 'fr'],
    ['', ['en-US'], 'ja', 'ja'],
    ['', ['es'], 42, 'es'],
  ])('%s with browser %j and saved %j gives %s', (search, languages, saved, expected) => {
    expect(detectLanguage(search, languages, saved)).toBe(expected);
  });

  it('matches nothing for an empty or unknown tag', () => {
    expect(matchLanguage(null)).toBeNull();
    expect(matchLanguage('')).toBeNull();
    expect(matchLanguage('klingon')).toBeNull();
  });

  it('fills placeholders and falls back to English', () => {
    const portuguese = translator('pt-BR');
    const english = translator('en');

    expect(portuguese('{count} camera(s) found', { count: 2 })).toBe('2 câmera(s) encontrada(s)');
    expect(translator('ja')('{count} camera(s) found', { count: 2 })).toBe('カメラが 2 台見つかりました');
    expect(english('{count} camera(s) found', { count: 2 })).toBe('2 camera(s) found');
    expect(portuguese('not in the catalog')).toBe('not in the catalog');
    expect(fill('{a} and {b}', { a: 1 })).toBe('1 and {b}');
  });

  it('switches the language in place, saves it and tells the components', () => {
    const before = currentLanguage();
    const { result } = renderHook(() => useLanguage());

    act(() => setLanguage('fr'));

    expect(result.current).toBe('fr');
    expect(t('Stop')).toBe('Arrêter');
    expect(document.documentElement.lang).toBe('fr');
    expect(readJson('local', 'language')).toBe('fr');

    act(() => setLanguage(before));

    expect(result.current).toBe(before);
  });
});
