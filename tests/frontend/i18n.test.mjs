import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PT_BR, detectLanguage, fill, translator } from '../../i18n.js';

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

// Every English string the page translates: t('...') calls and data-i18n / data-i18n-html elements.
const usedStrings = new Set([
  ...[...html.matchAll(/\bt\('((?:[^'\\]|\\.)*)'/g)].map((match) => match[1].replace(/\\'/g, "'")),
  ...[...html.matchAll(/<(\w+)\b[^>]*\sdata-i18n(?:-html)?(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g)]
    .map((match) => match[2].trim()),
]);

const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

test('the page uses translated strings', () => {
  assert.ok(usedStrings.size > 20, `found only ${usedStrings.size}`);
  assert.ok(usedStrings.has('Start streaming'));
  assert.ok(usedStrings.has('{count} camera(s) found'));
});

test('every string on the page has a pt-BR line', () => {
  const missing = [...usedStrings].filter((text) => !(text in PT_BR));
  assert.deepEqual(missing, []);
});

test('pt-BR lines keep the same {placeholders}', () => {
  for (const [english, portuguese] of Object.entries(PT_BR)) {
    assert.deepEqual(placeholders(portuguese), placeholders(english), english);
  }
});

test('no pt-BR line is left unused', () => {
  const unused = Object.keys(PT_BR).filter((text) => !usedStrings.has(text));
  assert.deepEqual(unused, []);
});

test('language follows the first browser language: pt* is pt-BR, anything else English', () => {
  assert.equal(detectLanguage('', ['pt-BR', 'en']), 'pt-BR');
  assert.equal(detectLanguage('', ['pt']), 'pt-BR');
  assert.equal(detectLanguage('', ['pt-PT']), 'pt-BR');
  assert.equal(detectLanguage('', ['en-US', 'pt-BR']), 'en');
  assert.equal(detectLanguage('', ['es']), 'en');
  assert.equal(detectLanguage('', []), 'en');
});

test('?lang= overrides the browser', () => {
  assert.equal(detectLanguage('?lang=en', ['pt-BR']), 'en');
  assert.equal(detectLanguage('?lang=pt-BR', ['en-US']), 'pt-BR');
  assert.equal(detectLanguage('?lang=pt_BR', ['en-US']), 'pt-BR');
});

test('translator fills placeholders and falls back to English', () => {
  const portuguese = translator('pt-BR');
  const english = translator('en');
  assert.equal(portuguese('{count} camera(s) found', { count: 2 }), '2 câmera(s) encontrada(s)');
  assert.equal(english('{count} camera(s) found', { count: 2 }), '2 camera(s) found');
  assert.equal(portuguese('not in the catalog'), 'not in the catalog');
  assert.equal(fill('{a} and {b}', { a: 1 }), '1 and {b}');
});
