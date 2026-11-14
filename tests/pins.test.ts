import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { test } from 'node:test';
import { Texture } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MESSAGES, type MessageKey } from '../src/core/i18n.ts';
import { PINS, PINS_KEY, PIN_REACH, PinBook, albumPins, pinEdition, pinReached, pinsOnMap, readPins } from '../src/core/pins.ts';
import { takeChristmas } from '../src/scene/christmasDress.ts';
import { readOutside } from '../src/scene/outsideData.ts';
import { overlaps } from '../src/world/collisions.ts';

const day = (year: number, month: number, date: number) => new Date(year, month - 1, date, 12);

/** A localStorage stand-in. */
function memory(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value), items };
}

async function load(file: string) {
  const data = await readFile(new URL(`../public/models/${file}.glb`, import.meta.url));
  const loader = new GLTFLoader();
  loader.register(() => ({ name: 'EXT_texture_webp', loadTexture: () => Promise.resolve(new Texture()) }));
  return (await loader.parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.length), '')).scene;
}

test('the Christmas 2026 pin lies on the map only during that Christmas, and only until it is got', () => {
  const empty = readPins(undefined);
  assert.equal(pinEdition('christmas', day(2026, 12, 3)), '2026');
  assert.equal(pinEdition('christmas', day(2027, 1, 4)), '2026');
  assert.deepEqual(pinsOnMap(empty, 'christmas', day(2026, 12, 3)).map((pin) => pin.id), ['christmas-snowman']);
  assert.deepEqual(pinsOnMap(empty, 'christmas', day(2027, 1, 4)).map((pin) => pin.id), ['christmas-snowman'], 'the season runs into January');
  assert.deepEqual(pinsOnMap(empty, 'christmas', day(2027, 12, 3)), [], 'not the next Christmas');
  assert.deepEqual(pinsOnMap(empty, 'halloween', day(2026, 10, 30)), []);
  assert.deepEqual(pinsOnMap(empty, 'none', day(2026, 12, 3)), []);
  // Forced on with ?navidad=1 before December: that year's Christmas.
  assert.deepEqual(pinsOnMap(empty, 'christmas', day(2026, 11, 13)).map((pin) => pin.id), ['christmas-snowman']);
  const got = { got: { 'christmas-snowman': 1 }, cover: {} };
  assert.deepEqual(pinsOnMap(got, 'christmas', day(2026, 12, 3)), []);
});

test('a pin got is kept for good: in later seasons, and even when this version of the page no longer knows it', () => {
  const storage = memory();
  const book = new PinBook(storage);
  const heard: string[] = [];
  book.onChange((id) => heard.push(id));
  assert.equal(book.collect('christmas-snowman', 1000), true);
  assert.equal(book.collect('christmas-snowman', 2000), false, 'once');
  assert.equal(book.collect('nobody', 2000), false);
  assert.deepEqual(heard, ['christmas-snowman']);
  const again = readPins(storage);
  assert.equal(again.got['christmas-snowman'], 1000);
  // A year later, with no event on, the album still shows it.
  assert.deepEqual(albumPins(again, 'none', day(2027, 8, 1)).map(({ pin, got }) => [pin.id, got]), [['christmas-snowman', 1000]]);
  // While it can still be found, the album shows an empty slot for it.
  assert.deepEqual(albumPins(readPins(undefined), 'christmas', day(2026, 12, 3)).map(({ pin, got }) => [pin.id, got]), [['christmas-snowman', undefined]]);
  assert.deepEqual(albumPins(readPins(undefined), 'none', day(2026, 8, 3)), []);
  // A pin from some other version of the page stays stored.
  const other = memory({ [PINS_KEY]: JSON.stringify({ got: { 'future-pin': 5, bad: 'x' }, cover: { 'future-pin': { x: 0.5, y: 0.5, turn: 3 } } }) });
  const kept = new PinBook(other);
  kept.collect('christmas-snowman', 9);
  assert.deepEqual(JSON.parse(other.items.get(PINS_KEY)!).got, { 'future-pin': 5, 'christmas-snowman': 9 });
  assert.deepEqual(readPins(memory({ [PINS_KEY]: 'not json' })), { got: {}, cover: {} });
});

test('pins stick on the cover where they are dropped, inside it, and come off again; only pins got', () => {
  const storage = memory();
  const book = new PinBook(storage);
  book.place('christmas-snowman', { x: 0.4, y: 0.5, turn: 5 });
  assert.deepEqual(book.state.cover, {}, 'not got yet');
  book.collect('christmas-snowman', 1);
  book.place('christmas-snowman', { x: 1.4, y: -2, turn: 90 });
  assert.deepEqual(readPins(storage).cover['christmas-snowman'], { x: 1, y: 0, turn: 30 });
  book.place('christmas-snowman', { x: 0.3, y: 0.7, turn: -6 });
  assert.deepEqual(readPins(storage).cover['christmas-snowman'], { x: 0.3, y: 0.7, turn: -6 });
  book.place('christmas-snowman', undefined);
  assert.deepEqual(readPins(storage).cover, {});
  // A stored place for a pin not got is dropped.
  assert.deepEqual(readPins(memory({ [PINS_KEY]: JSON.stringify({ got: {}, cover: { 'christmas-snowman': { x: 0.5, y: 0.5, turn: 0 } } }) })).cover, {});
});

test('every pin has its picture (a small WebP), its texts in both languages, and lies where the character can walk', async () => {
  const outside = await load('outside');
  outside.add(takeChristmas(await load('christmas')).world);
  for (const name of ['circuit', 'colombia', 'univalle', 'experience', 'boxing']) outside.add(await load(name));
  const data = readOutside(outside);
  const ids = new Set<string>();
  for (const pin of PINS) {
    assert.ok(!ids.has(pin.id), `${pin.id}: one of a kind`);
    ids.add(pin.id);
    assert.match(pin.image, /^pins\/[a-z0-9-]+\.webp$/);
    const file = await readFile(new URL(`../public/${pin.image}`, import.meta.url));
    assert.equal(file.subarray(8, 12).toString('ascii'), 'WEBP', `${pin.id}: a WebP`);
    assert.ok((await stat(new URL(`../public/${pin.image}`, import.meta.url))).size < 60_000, `${pin.id}: light`);
    for (const language of ['es', 'en'] as const) {
      for (const part of ['name', 'from']) assert.ok(MESSAGES[language][`pins.${pin.id}.${part}` as MessageKey], `${pin.id}.${part} in ${language}`);
    }
    assert.ok(pin.at.x > data.bounds.minX + 1 && pin.at.x < data.bounds.maxX - 1 && pin.at.z > data.bounds.minZ + 1 && pin.at.z < data.bounds.maxZ - 1, `${pin.id}: on the map`);
    assert.equal(overlaps(pin.at, PIN_REACH * 0.6, data.boxes)?.name, undefined, `${pin.id}: nothing stands on it`);
    assert.ok(Math.abs(pin.at.x) > 4 || Math.abs(pin.at.z) > 4, `${pin.id}: outside the room`);
    assert.equal(pinReached(pin, pin.at.x + PIN_REACH * 0.9, pin.at.z), true);
    assert.equal(pinReached(pin, pin.at.x + PIN_REACH * 1.1, pin.at.z), false);
  }
});
