import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { FAST_FRAME, QUALITY, SLOW_FRAME, nextPixelRatio, ratioRange, readPreferences, savePreferences } from '../src/core/quality.ts';

test('each quality stays within the display: never above its device pixel ratio', () => {
  assert.deepEqual(ratioRange('auto', 2), { min: 1, max: 1.5 });
  assert.deepEqual(ratioRange('auto', 1), { min: 1, max: 1 });
  assert.deepEqual(ratioRange('high', 3), { min: 2, max: 2 });
  assert.deepEqual(ratioRange('high', 1.25), { min: 1.25, max: 1.25 });
  assert.deepEqual(ratioRange('low', 2), { min: 0.75, max: 1 });
  assert.deepEqual(ratioRange('auto', Number.NaN), { min: 1, max: 1 });
  assert.equal(QUALITY.low.shadows, false);
  assert.ok(QUALITY.auto.shadows && QUALITY.high.shadows);
});

test('adaptive resolution steps down on slow frames, up with headroom, and holds in between', () => {
  const range = ratioRange('auto', 2);
  assert.equal(nextPixelRatio(1.5, SLOW_FRAME + 5, range), 1.25);
  assert.equal(nextPixelRatio(1, SLOW_FRAME + 5, range), 1);
  assert.equal(nextPixelRatio(1, FAST_FRAME - 4, range), 1.25);
  assert.equal(nextPixelRatio(1.5, FAST_FRAME - 4, range), 1.5);
  assert.equal(nextPixelRatio(1.25, 16.7, range), 1.25);
  // A ratio left over from another quality is brought into range first.
  assert.equal(nextPixelRatio(2, 16.7, range), 1.5);
  assert.equal(nextPixelRatio(1, 16.7, ratioRange('high', 2)), 2);
});

test('preferences survive a reload and tolerate missing, corrupt or blocked storage', () => {
  const store = new Map<string, string>();
  const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); } };
  assert.deepEqual(readPreferences(storage), { quality: 'auto', reducedMotion: null, language: null, sound: true });
  savePreferences(storage, { quality: 'low', reducedMotion: true, language: 'en', sound: false });
  assert.deepEqual(readPreferences(storage), { quality: 'low', reducedMotion: true, language: 'en', sound: false });
  store.set([...store.keys()][0], '{"quality":"ultra","reducedMotion":"yes","language":"fr"}');
  assert.deepEqual(readPreferences(storage), { quality: 'auto', reducedMotion: null, language: null, sound: true });
  store.set([...store.keys()][0], '{not json');
  assert.deepEqual(readPreferences(storage), { quality: 'auto', reducedMotion: null, language: null, sound: true });
  const blocked = { getItem: () => { throw new Error('SecurityError'); }, setItem: () => { throw new Error('QuotaExceededError'); } };
  assert.deepEqual(readPreferences(blocked), { quality: 'auto', reducedMotion: null, language: null, sound: true });
  assert.doesNotThrow(() => savePreferences(blocked, { quality: 'high', reducedMotion: false, language: 'es', sound: true }));
  assert.deepEqual(readPreferences(undefined), { quality: 'auto', reducedMotion: null, language: null, sound: true });
});

test('room and laptop embed their textures as WebP, keeping the downloads small', async () => {
  for (const [name, limit] of [['room', 1.5e6], ['laptop', 0.1e6]] as const) {
    const data = await readFile(new URL(`../public/models/${name}.glb`, import.meta.url));
    const document = JSON.parse(data.subarray(20, 20 + data.readUInt32LE(12)).toString());
    assert.ok(data.length < limit, `${name}.glb is ${data.length} bytes`);
    assert.ok(document.images.length > 0 && document.images.every((image: { mimeType: string }) => image.mimeType === 'image/webp'), name);
    assert.ok(document.extensionsRequired.includes('EXT_texture_webp'), name);
  }
});
