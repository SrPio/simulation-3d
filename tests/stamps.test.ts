import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SLOTS_PER_PAGE, STAMPS, STAMPS_KEY, STAMP_SECTIONS, StampBook, readStamps, stampCount, unlockStamp } from '../src/core/stamps.ts';
import { ACTION_ICONS } from '../src/ui/silhouettes.ts';

const memory = () => {
  const store = new Map<string, string>();
  return { store, getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) };
};

test('every section fills one page of slots with unique ids and known art', () => {
  assert.equal(STAMPS.length, STAMP_SECTIONS.length * SLOTS_PER_PAGE);
  assert.equal(new Set(STAMPS.map((stamp) => stamp.id)).size, STAMPS.length);
  for (const section of STAMP_SECTIONS) assert.equal(STAMPS.filter((stamp) => stamp.section === section).length, SLOTS_PER_PAGE);
  for (const stamp of STAMPS) assert.ok(stamp.art === 'head' || stamp.art in ACTION_ICONS, stamp.art);
});

test('a sticker unlocks once, is stored with its date and counted', () => {
  const storage = memory();
  const book = new StampBook(storage);
  const heard: string[] = [];
  const stop = book.onUnlock((id) => heard.push(id));
  assert.equal(book.unlock('first-steps'), true);
  assert.equal(book.unlock('first-steps'), false, 'only once');
  assert.equal(book.unlock('nope'), false, 'unknown ids are refused');
  assert.deepEqual(heard, ['first-steps']);
  assert.ok(readStamps(storage)['first-steps'] > 0);
  assert.deepEqual(stampCount(book.state, 'world'), { got: 1, total: SLOTS_PER_PAGE });
  assert.deepEqual(stampCount(book.state), { got: 1, total: STAMPS.length });
  stop();
  book.unlock('strike');
  assert.deepEqual(heard, ['first-steps'], 'no word after stopping');
  assert.deepEqual(Object.keys(new StampBook(storage).state).sort(), ['first-steps', 'strike']);
});

test('bad stored values and blocked storage do not break the album', () => {
  const storage = memory();
  storage.store.set(STAMPS_KEY, JSON.stringify({ 'first-steps': 5, 'devos': 'x', ghost: 9, 'sled-run': -3 }));
  assert.deepEqual(readStamps(storage), { 'first-steps': 5 });
  storage.store.set(STAMPS_KEY, '[1,2]');
  assert.deepEqual(readStamps(storage), {});
  storage.store.set(STAMPS_KEY, '{oops');
  assert.deepEqual(readStamps(storage), {});
  const blocked = { getItem: (): string | null => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  const state = readStamps(blocked);
  assert.deepEqual(state, {});
  assert.equal(unlockStamp(blocked, state, 'tape', 42), true);
  assert.deepEqual(state, { 'tape': 42 });
  assert.deepEqual(readStamps(undefined), {});
});
