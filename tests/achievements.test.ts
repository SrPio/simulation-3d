import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GOALS, PROGRESS_KEY, RULES, SIGNS, earned, readProgress, saveProgress, trackProgress, type Snapshot } from '../src/core/achievements.ts';
import { STAMPS } from '../src/core/stamps.ts';
import { MESSAGES } from '../src/core/i18n.ts';

/** The host at the start: nothing done (the values the viewer sets on load). */
const idle: Snapshot = {
  elevation: '0.00', desktop: 'closed', shout: 'none', rubik: 'scrambled', sign: 'none', pins: '0', bullseyes: undefined, bricks: '0', lap: 'none',
  konami: undefined, bags: 'js:0,ts:0', strikePower: undefined, chairJumps: undefined, board: undefined, broken: '0', halloween: 'off', christmas: 'off',
};

test('every sticker has a rule and a name and a hint in both languages', () => {
  assert.deepEqual(Object.keys(RULES).sort(), STAMPS.map((stamp) => stamp.id).sort());
  for (const language of ['es', 'en'] as const) {
    for (const stamp of STAMPS) {
      for (const part of ['name', 'hint']) assert.ok((MESSAGES[language] as Record<string, string>)[`stamps.${stamp.id}.${part}`], `${language} ${stamp.id}.${part}`);
    }
  }
});

test('nothing is earned at the start', () => {
  assert.deepEqual(earned(idle, { signs: [] }, {}), []);
});

test('each achievement shows in the page state', () => {
  const cases: [string, Snapshot][] = [
    ['first-steps', { elevation: '-0.12' }],
    ['devos', { desktop: 'open' }],
    ['tourist', { shout: 'bust' }],
    ['colombia', { shout: 'colombia' }],
    ['experience', { rubik: 'solved' }],
    ['sled-run', { minigame: 'over' }],
    ['sled-1000', { mgScore: String(GOALS.sledScore) }],
    ['strike', { pins: '10' }],
    ['bullseye', { bullseyes: '1' }],
    ['demolition', { bricks: String(GOALS.bricks) }],
    ['lap', { lap: '42.3' }],
    ['konami', { konami: '1' }],
    ['heavyweight', { bags: 'js:31,ts:2', strikePower: '1.00' }],
    ['liftoff', { chairJumps: '1' }],
    ['hoverboard', { board: 'ready' }],
    ['splinters', { broken: '2' }],
    ['festive', { christmas: 'on' }],
  ];
  for (const [id, change] of cases) assert.deepEqual(earned({ ...idle, ...change }, { signs: [] }, {}), [id], id);
  // Close but not quite.
  for (const change of [{ lap: 'running' }, { pins: '9' }, { bags: 'js:31', strikePower: '0.40' }, { bags: 'js:8', strikePower: '1.00' }, { mgScore: '999' }, { elevation: '0.30' }, { board: 'locked' }]) {
    assert.deepEqual(earned({ ...idle, ...change }, { signs: [] }, {}), [], JSON.stringify(change));
  }
});

test('the three signs add up across visits, and a sticker already got is not earned again', () => {
  const store = new Map<string, string>();
  const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) };
  const progress = readProgress(storage);
  for (const sign of SIGNS.slice(0, 2)) assert.equal(trackProgress({ ...idle, sign }, progress), true);
  assert.equal(trackProgress({ ...idle, sign: 'github' }, progress), false, 'once each');
  assert.equal(trackProgress({ ...idle, sign: 'reset-bowling' }, progress), false, 'reset zones do not count');
  assert.deepEqual(earned(idle, progress, {}), []);
  saveProgress(storage, progress);
  const later = readProgress(storage);
  trackProgress({ ...idle, sign: SIGNS[2] }, later);
  assert.deepEqual(earned(idle, later, {}), ['connected']);
  assert.deepEqual(earned(idle, later, { connected: 1 }), []);
  store.set(PROGRESS_KEY, '{bad');
  assert.deepEqual(readProgress(storage), { signs: [] });
  assert.deepEqual(readProgress({ getItem: () => { throw new Error('blocked'); } }), { signs: [] });
});
