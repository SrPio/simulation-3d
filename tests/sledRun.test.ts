import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SLED, SLED_KEY, multiplier, newRun, points, readSledRecord, saveSledScore, startRun, steer, stepRun, targetSpeed, type SledRun,
} from '../src/minigames/sledRun/sledRun.ts';

/** Step at 60 fps for up to `seconds`, until `until` says stop or the run ends. */
function play(run: SledRun, seconds: number, until?: (run: SledRun) => boolean): void {
  for (let t = 0; t < seconds && run.phase === 'playing'; t += 1 / 60) {
    stepRun(run, 1 / 60);
    if (until?.(run)) return;
  }
}

/** A dodging driver: heads for the nearest lane that is free in the next row it has not passed yet. */
function dodge(run: SledRun): void {
  const ahead = run.obstacles.filter((obstacle) => obstacle.at > run.distance - 1).sort((a, b) => a.at - b.at);
  const row = ahead.filter((obstacle) => obstacle.at === ahead[0]?.at);
  const blocked = new Set(row.map((obstacle) => obstacle.lane));
  if (!blocked.has(run.lane)) return;
  const free = [0, 1, 2].filter((lane) => !blocked.has(lane)).sort((a, b) => Math.abs(a - run.lane) - Math.abs(b - run.lane))[0];
  steer(run, free > run.lane ? 1 : -1);
}

test('every row of obstacles leaves a lane free, and rows are far enough apart to reach it', () => {
  for (const seed of [1, 7, 42, 2026]) {
    const run = newRun(seed);
    startRun(run);
    const rows = new Map<number, Set<number>>();
    /** The speed each row was met at. */
    const met = new Map<number, number>();
    for (let i = 0; i < 60 * 240 && run.phase === 'playing'; i++) {
      run.lives = SLED.lives; // never ends: the rows keep coming
      const before = run.distance;
      stepRun(run, 1 / 60);
      for (const obstacle of run.obstacles) {
        rows.set(obstacle.at, (rows.get(obstacle.at) ?? new Set()).add(obstacle.lane));
        if (obstacle.at > before && obstacle.at <= run.distance) met.set(obstacle.at, run.speed);
      }
    }
    assert.ok(run.rows > 100, `rows made: ${run.rows}`);
    for (const lanes of rows.values()) assert.ok(lanes.size <= SLED.lanes - 1, 'a row blocks every lane');
    const starts = [...met.keys()].sort((a, b) => a - b);
    for (let i = 1; i < starts.length; i++) {
      // Time between two rows: enough to slide two lanes over, with a moment to see it.
      const seconds = (starts[i] - starts[i - 1]) / met.get(starts[i])!;
      assert.ok(seconds >= SLED.laneTime * 2 + 0.15, `${seconds.toFixed(2)} s between rows`);
    }
  }
});

test('the same seed makes the same slope', () => {
  assert.deepEqual(newRun(99).obstacles, newRun(99).obstacles);
  assert.notDeepEqual(newRun(100).obstacles, newRun(99).obstacles);
});

test('nothing moves before the start, and the speed grows with time up to the limit', () => {
  const run = newRun(3);
  stepRun(run, 1);
  assert.equal(run.distance, 0);
  startRun(run);
  const early = targetSpeed(run);
  for (let i = 0; i < 60 * 200; i++) {
    run.lives = SLED.lives;
    run.nitro = 0;
    stepRun(run, 1 / 60);
  }
  assert.ok(targetSpeed(run) > early);
  assert.equal(targetSpeed(run), SLED.speed.max);
});

test('steering moves one lane at a time within the three', () => {
  const run = newRun(5);
  assert.equal(steer(run, 1), false, 'not before the start');
  startRun(run);
  assert.equal(steer(run, -1), true);
  assert.equal(run.lane, 0);
  assert.equal(steer(run, -1), false);
  steer(run, 1);
  steer(run, 1);
  assert.equal(run.lane, 2);
  assert.equal(steer(run, 1), false);
  stepRun(run, SLED.laneTime / 2);
  assert.ok(run.x > 1 && run.x < 2, 'it slides over');
  play(run, 0.5);
  assert.equal(run.x, 2);
});

test('a crash costs a life, slows the chair and gives a moment to recover; three crashes end the run', () => {
  const run = newRun(11);
  startRun(run);
  const crashes: number[] = [];
  for (let i = 0; i < 60 * 300 && run.phase === 'playing'; i++) {
    run.bottles = [];
    const before = run.speed;
    stepRun(run, 1 / 60);
    if (run.events.some((event) => event.type === 'crash')) {
      crashes.push(run.time);
      assert.ok(run.speed < before * 0.7, 'the crash slows the chair');
      assert.equal(run.streak, 0);
      if (run.phase === 'playing') assert.equal(run.recover, SLED.recover);
    }
  }
  assert.equal(crashes.length, SLED.lives);
  assert.equal(run.phase, 'over');
  assert.equal(run.lives, 0);
  assert.ok(run.events.some((event) => event.type === 'over'));
  for (let i = 1; i < crashes.length; i++) assert.ok(crashes[i] - crashes[i - 1] >= SLED.recover - 1e-9, 'no crash while recovering');
  const distance = run.distance;
  stepRun(run, 1);
  assert.equal(run.distance, distance, 'the run stops when it is over');
});

test('a driver who dodges keeps every life', () => {
  for (const seed of [21, 22, 23]) {
    const run = newRun(seed);
    startRun(run);
    for (let i = 0; i < 60 * 120 && run.phase === 'playing'; i++) {
      dodge(run);
      stepRun(run, 1 / 60);
    }
    assert.equal(run.lives, SLED.lives, `seed ${seed}`);
    assert.ok(points(run) > 1000);
  }
});

test('a bottle lights the nitro: faster, three times the points, smashing through without losing a life', () => {
  const run = newRun(8);
  startRun(run);
  run.obstacles = [];
  run.bottles = [{ id: 900, lane: run.lane, at: run.distance + 2, taken: false }];
  run.nextRow = 1e9;
  play(run, 2, (state) => state.nitro > 0);
  assert.ok(run.events.some((event) => event.type === 'bottle'));
  assert.equal(multiplier(run), SLED.nitro.points);
  assert.ok(targetSpeed(run) > SLED.speed.start * 1.4);
  run.obstacles = [{ id: 901, lane: run.lane, at: run.distance + 3, kind: 'drums', hit: false }];
  play(run, 1, (state) => state.obstacles[0]?.hit === true);
  assert.ok(run.events.some((event) => event.type === 'smash'));
  assert.equal(run.lives, SLED.lives);
  play(run, SLED.nitro.time + 0.5, (state) => state.nitro === 0);
  assert.ok(run.events.some((event) => event.type === 'nitro-end'));
  assert.equal(multiplier(run), 1);
});

test('points grow with distance and with time without crashing', () => {
  const run = newRun(4);
  startRun(run);
  run.obstacles = [];
  run.bottles = [];
  run.nextRow = 1e9;
  play(run, 5);
  assert.ok(Math.abs(run.score - run.distance) < 1e-6, 'one point a metre at first');
  play(run, SLED.combo.every);
  assert.equal(multiplier(run), 1 + SLED.combo.step);
  run.streak = 1000;
  assert.equal(multiplier(run), SLED.combo.max);
});

test('the record keeps the best score and the last five, and survives blocked storage', () => {
  const store = new Map<string, string>();
  const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) };
  assert.deepEqual(readSledRecord(storage), { best: 0, runs: [] });
  assert.equal(saveSledScore(storage, 120).best, true);
  assert.equal(saveSledScore(storage, 80).best, false);
  for (const score of [10, 20, 30, 40]) saveSledScore(storage, score);
  assert.deepEqual(readSledRecord(storage), { best: 120, runs: [40, 30, 20, 10, 80] });
  store.set(SLED_KEY, '{nope');
  assert.deepEqual(readSledRecord(storage), { best: 0, runs: [] });
  const blocked = { getItem: (): string | null => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  assert.deepEqual(readSledRecord(blocked), { best: 0, runs: [] });
  assert.deepEqual(saveSledScore(blocked, 50), { record: { best: 50, runs: [50] }, best: true });
  assert.deepEqual(readSledRecord(undefined), { best: 0, runs: [] });
});
