import { PT_BR, detectLanguage, fill, translator } from '@/lib/i18n';

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
    expect(usedStrings.has('👀 Watching the LAN Webcam')).toBe(true);
  });

  it('has a pt-BR line for every string the app uses', () => {
    expect([...usedStrings].filter((text) => !(text in PT_BR))).toEqual([]);
  });

  it('keeps the same {placeholders} in pt-BR', () => {
    const mismatched = Object.entries(PT_BR).filter(
      ([english, portuguese]) => placeholders(english).join() !== placeholders(portuguese).join(),
    );

    expect(mismatched).toEqual([]);
  });

  it('has no pt-BR line left unused', () => {
    expect(Object.keys(PT_BR).filter((text) => !usedStrings.has(text))).toEqual([]);
  });
});

describe('language', () => {
  it.each([
    [['pt-BR', 'en'], 'pt-BR'],
    [['pt'], 'pt-BR'],
    [['pt-PT'], 'pt-BR'],
    [['en-US', 'pt-BR'], 'en'],
    [['es'], 'en'],
    [[], 'en'],
  ])('browser languages %j give %s', (languages, expected) => {
    expect(detectLanguage('', languages)).toBe(expected);
  });

  it.each([
    ['?lang=en', ['pt-BR'], 'en'],
    ['?lang=pt-BR', ['en-US'], 'pt-BR'],
    ['?lang=pt_BR', ['en-US'], 'pt-BR'],
  ])('%s overrides the browser', (search, languages, expected) => {
    expect(detectLanguage(search, languages)).toBe(expected);
  });

  it('fills placeholders and falls back to English', () => {
    const portuguese = translator('pt-BR');
    const english = translator('en');

    expect(portuguese('{count} camera(s) found', { count: 2 })).toBe('2 câmera(s) encontrada(s)');
    expect(english('{count} camera(s) found', { count: 2 })).toBe('2 camera(s) found');
    expect(portuguese('not in the catalog')).toBe('not in the catalog');
    expect(fill('{a} and {b}', { a: 1 })).toBe('1 and {b}');
  });
});
