import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HINTS, HintRules, LAPTOP_FOUND_KEY, readLaptopFound, saveLaptopFound, type HintId, type HintSituation } from '../src/home/toastRules.ts';

const base: HintSituation = { started: true, blocked: false, prompt: 'none', seatedIdle: false, laptopFound: false };

/** Run the rules for `seconds` in half-second steps; the hints shown, with when. */
function run(rules: HintRules, seconds: number, situation: (time: number) => Partial<HintSituation> = () => ({})): { id: HintId; at: number }[] {
  const shown: { id: HintId; at: number }[] = [];
  for (let time = 0; time < seconds; time += 0.5) {
    const id = rules.step(0.5, { ...base, ...situation(time) });
    if (id) shown.push({ id, at: time });
  }
  return shown;
}

test('the first invitation comes after a while of play, once', () => {
  const shown = run(new HintRules(), 300);
  assert.deepEqual(shown.map((hint) => hint.id), ['laptop-intro']);
  assert.ok(Math.abs(shown[0].at - HINTS.introAfter) <= 0.5);
});

test('nothing before START, once the laptop was found, or while something covers the world', () => {
  assert.deepEqual(run(new HintRules(), 120, () => ({ started: false })), []);
  assert.deepEqual(run(new HintRules(), 120, () => ({ laptopFound: true, prompt: 'bench', seatedIdle: true })), []);
  assert.deepEqual(run(new HintRules(), 120, () => ({ blocked: true, prompt: 'bench' })), []);
  // Time covered by the menu does not count towards the first invitation.
  const late = run(new HintRules(), 120, (time) => ({ blocked: time < 60 }));
  assert.ok(late[0].at >= 60 + HINTS.introAfter - 0.5);
});

test('near a seat with a laptop: at most one invitation every few minutes; never at the office chair', () => {
  const near = run(new HintRules(), 400, () => ({ prompt: 'bench' })).filter((hint) => hint.id === 'laptop-seat');
  assert.ok(near.length >= 2);
  for (let index = 1; index < near.length; index++) assert.ok(near[index].at - near[index - 1].at >= HINTS.seatEvery - 0.5);
  assert.deepEqual(run(new HintRules(), 30, () => ({ prompt: 'office' })), []);
});

test('sitting with the laptop closed points out the key once, and hints keep a gap between them', () => {
  const shown = run(new HintRules(), 200, () => ({ seatedIdle: true }));
  assert.deepEqual(shown.map((hint) => hint.id), ['laptop-seated']);
  assert.ok(Math.abs(shown[0].at - HINTS.seatedAfter) <= 0.5);
  const mixed = run(new HintRules(), 60, (time) => ({ prompt: 'bed', seatedIdle: time > 2 }));
  for (let index = 1; index < mixed.length; index++) assert.ok(mixed[index].at - mixed[index - 1].at >= HINTS.gap - 0.5);
});

test('the found mark is stored and blocked storage is tolerated', () => {
  const store = new Map<string, string>();
  const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) };
  assert.equal(readLaptopFound(storage), false);
  saveLaptopFound(storage);
  assert.equal(store.get(LAPTOP_FOUND_KEY), '1');
  assert.equal(readLaptopFound(storage), true);
  const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  assert.equal(readLaptopFound(blocked), false);
  assert.doesNotThrow(() => saveLaptopFound(blocked));
  assert.equal(readLaptopFound(undefined), false);
});
