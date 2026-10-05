import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MESSAGES, getLanguage, initialLanguage, onLanguage, setLanguage, t } from '../src/core/i18n.ts';

test('Spanish and English have the same texts, none empty, with the same placeholders', () => {
  const es = Object.keys(MESSAGES.es).sort();
  assert.deepEqual(Object.keys(MESSAGES.en).sort(), es);
  const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
  for (const key of es) {
    const [spanish, english] = [MESSAGES.es[key as keyof typeof MESSAGES.es], MESSAGES.en[key as keyof typeof MESSAGES.en]];
    assert.ok(spanish.trim() && english.trim(), key);
    assert.deepEqual(placeholders(english), placeholders(spanish), key);
  }
});

test('the first visit follows the browser language; a stored choice wins', () => {
  assert.equal(initialLanguage(null, ['es-CO', 'en']), 'es');
  assert.equal(initialLanguage(null, ['es']), 'es');
  assert.equal(initialLanguage(null, ['en-US', 'es']), 'en');
  assert.equal(initialLanguage(null, ['pt-BR']), 'en');
  assert.equal(initialLanguage(null, []), 'en');
  assert.equal(initialLanguage('es', ['en-US']), 'es');
  assert.equal(initialLanguage('fr', ['es-ES']), 'es');
});

test('switching the language changes every t() text and tells the listeners once', () => {
  const heard: string[] = [];
  const stop = onLanguage((language) => heard.push(language));
  setLanguage('es');
  assert.equal(t('prompt.sit', { seat: t('seat.chair') }), 'E: sentarse en la silla');
  setLanguage('en');
  assert.equal(getLanguage(), 'en');
  assert.equal(t('prompt.sit', { seat: t('seat.chair') }), 'E: sit on the chair');
  setLanguage('en');
  stop();
  setLanguage('es');
  assert.deepEqual(heard, ['en']);
  assert.equal(t('floor.playground'), 'ZONA DE JUEGOS');
  assert.equal(t('floor.playground', {}, 'en'), 'PLAYGROUND');
});
