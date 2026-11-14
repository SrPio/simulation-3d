import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  RAMP_KINDS, SLED, SLED_KEY, multiplier, newRun, points, rampSurface, readSledRecord, saveSledScore, startRun, steer, stepRun, targetSpeed, trick, trickPoints,
  type Ramp, type SledRun,
} from '../src/minigames/sledRun/sledRun.ts';

/** Step at 60 fps for up to `seconds`, until `until` says stop or the run ends. */
function play(run: SledRun, seconds: number, until?: (run: SledRun) => boolean): void {
  for (let t = 0; t < seconds && run.phase === 'playing'; t += 1 / 60) {
    stepRun(run, 1 / 60);
    if (until?.(run)) return;
  }
}

/** The wall's row after a long ramp, if any: every lane blocked SLED.wall.after past its lip. */
const wallAfter = (run: SledRun, ramp: Ramp) => run.obstacles.filter((obstacle) => Math.abs(obstacle.at - ramp.at - SLED.wall.after) < 1e-9);

/**
 * A dodging driver: heads for a long ramp's lane when a wall follows it, else for the nearest lane that is free in the
 * next row it has not passed yet; it does not steer while climbing, nor into the side of a ramp it would crash into.
 */
function dodge(run: SledRun): void {
  if (run.climbing) return;
  const ramp = run.ramps
    .filter((candidate) => candidate.at - SLED.ramps[candidate.kind].length > run.distance - 0.5 && wallAfter(run, candidate).length === SLED.lanes)
    .sort((a, b) => a.at - b.at)[0];
  const ahead = run.obstacles.filter((obstacle) => obstacle.at > run.distance - 1).sort((a, b) => a.at - b.at);
  let target = run.lane;
  if (ramp && (!ahead[0] || ramp.at < ahead[0].at)) target = ramp.lane;
  else {
    const row = ahead.filter((obstacle) => obstacle.at === ahead[0]?.at);
    const blocked = new Set(row.map((obstacle) => obstacle.lane));
    if (!blocked.has(run.lane) || blocked.size === SLED.lanes) return;
    target = [0, 1, 2].filter((lane) => !blocked.has(lane)).sort((a, b) => Math.abs(a - run.lane) - Math.abs(b - run.lane))[0];
  }
  if (target === run.lane) return;
  const next = run.lane + (target > run.lane ? 1 : -1);
  const beside = run.ramps.some((candidate) => candidate.lane === next && rampSurface(candidate, run.distance + 1) > SLED.clear * 0.8);
  if (!beside) steer(run, target > run.lane ? 1 : -1);
}

test('every row of obstacles leaves a lane free, except a wall right after a long ramp, and rows are far enough apart to reach it', () => {
  for (const seed of [1, 7, 42, 2026]) {
    const run = newRun(seed);
    startRun(run);
    const rows = new Map<number, Set<number>>();
    const lips = new Map<number, Ramp>();
    /** The speed each row (or ramp foot) was met at. */
    const met = new Map<number, number>();
    for (let i = 0; i < 60 * 240 && run.phase === 'playing'; i++) {
      run.lives = SLED.lives; // never ends: the rows keep coming
      const before = run.distance;
      stepRun(run, 1 / 60);
      for (const obstacle of run.obstacles) {
        rows.set(obstacle.at, (rows.get(obstacle.at) ?? new Set()).add(obstacle.lane));
        // A wall is jumped over from its ramp, not driven up to.
        const wall = run.obstacles.filter((other) => other.at === obstacle.at).length === SLED.lanes;
        if (!wall && obstacle.at > before && obstacle.at <= run.distance) met.set(obstacle.at, run.speed);
      }
      for (const ramp of run.ramps) {
        lips.set(ramp.at, ramp);
        const foot = ramp.at - SLED.ramps[ramp.kind].length;
        if (foot > before && foot <= run.distance) met.set(foot, run.speed);
      }
    }
    assert.ok(run.rows > 100, `rows made: ${run.rows}`);
    assert.ok(lips.size > 10, `ramps: ${lips.size}`);
    for (const kind of RAMP_KINDS) assert.ok([...lips.values()].some((ramp) => ramp.kind === kind), `a ${kind} ramp`);
    const ramps = [...lips.values()].sort((a, b) => a.at - b.at);
    assert.equal(ramps[0].kind, 'long', 'the first ramp is a long one');
    const long = ramps.filter((ramp) => ramp.kind === 'long').length;
    assert.ok(long / ramps.length > 0.35, `long ramps: ${long} of ${ramps.length}`);
    let walls = 0;
    for (const [at, lanes] of rows) {
      if (lanes.size < SLED.lanes) continue;
      walls += 1;
      assert.equal(lips.get(at - SLED.wall.after)?.kind, 'long', 'a wall comes only right after a long ramp');
    }
    assert.ok(walls > 0, 'some walls');
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
  assert.deepEqual(newRun(99).ramps, newRun(99).ramps);
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
    run.hearts = [];
    run.ramps = [];
    run.obstacles = run.obstacles.filter((obstacle) => run.obstacles.filter((other) => other.at === obstacle.at).length < SLED.lanes);
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

test('a driver who dodges keeps every life, jumping the walls from their ramps', () => {
  let walls = 0;
  for (const seed of [21, 22, 23]) {
    const run = newRun(seed);
    startRun(run);
    for (let i = 0; i < 60 * 120 && run.phase === 'playing'; i++) {
      dodge(run);
      const before = run.distance;
      stepRun(run, 1 / 60);
      const lanes = new Set(run.obstacles.filter((obstacle) => obstacle.at > before && obstacle.at <= run.distance).map((obstacle) => obstacle.lane));
      if (lanes.size === SLED.lanes) walls += 1;
    }
    assert.equal(run.lives, SLED.lives, `seed ${seed}`);
    assert.ok(run.jumps > 0, `jumps: ${run.jumps}`);
    assert.ok(points(run) > 1000);
  }
  assert.ok(walls > 0, 'some walls jumped');
});

/** A run with nothing on the slope but what the test puts there. */
function emptyRun(seed = 31): SledRun {
  const run = newRun(seed);
  startRun(run);
  Object.assign(run, { obstacles: [], bottles: [], hearts: [], ramps: [], nextRow: 1e9 });
  return run;
}

test('a ramp climbed from its foot throws the chair over what is below, and the landing pays its bonus', () => {
  for (const kind of RAMP_KINDS) {
    const run = emptyRun();
    const lip = run.distance + 6 + SLED.ramps[kind].length;
    run.ramps = [{ id: 50, lane: run.lane, at: lip, kind }];
    // The small ramp is a hop for points; the others fly over what stands just past their lip.
    if (kind !== 'ramp') run.obstacles = [{ id: 51, lane: run.lane, at: lip + 1.2, kind: 'drums', hit: false }];
    let peak = 0;
    let climbed = false;
    let launched = false;
    for (let i = 0; i < 60 * 4 && !run.events.some((event) => event.type === 'land'); i++) {
      stepRun(run, 1 / 60);
      if (run.climbing) climbed = true;
      if (run.events.some((event) => event.type === 'launch' && event.kind === kind)) launched = true;
      peak = Math.max(peak, run.height);
    }
    assert.ok(climbed && launched, kind);
    assert.ok(peak > SLED.ramps[kind].height, `${kind} flies higher than its lip`);
    const land = run.events.find((event) => event.type === 'land');
    assert.equal(land?.type === 'land' && land.points, SLED.ramps[kind].bonus * multiplier(run));
    assert.equal(run.jumps, 1);
    assert.equal(run.height, 0);
    assert.equal(run.lives, SLED.lives, `${kind}: the drums under the jump are cleared`);
  }
});

test("the long ramp's jump clears its wall from the slowest to the fastest the chair can go, and lands past it", () => {
  for (const speed of [SLED.speed.start * SLED.crashSlow, SLED.speed.start, SLED.speed.max * SLED.nitro.speed]) {
    const run = emptyRun();
    const lip = run.distance + 1 + SLED.ramps.long.length;
    run.ramps = [{ id: 60, lane: run.lane, at: lip, kind: 'long' }];
    let lowest = Infinity;
    let landed = 0;
    for (let i = 0; i < 60 * 6 && !landed; i++) {
      run.speed = speed;
      run.time = 0;
      stepRun(run, 1 / 60);
      if (Math.abs(run.distance - lip - SLED.wall.after) <= SLED.hit.depth) lowest = Math.min(lowest, run.height);
      if (run.events.some((event) => event.type === 'land')) landed = run.distance;
    }
    assert.ok(lowest >= SLED.clear, `${speed.toFixed(1)} m/s: ${lowest.toFixed(2)} m over the wall`);
    assert.ok(landed > lip + SLED.wall.after + SLED.hit.depth, `${speed.toFixed(1)} m/s lands at ${(landed - lip).toFixed(1)} m past the lip`);
  }
});

test("driving into a tall ramp's side crashes, onto a low one climbs it, and steering off a ramp drops the chair", () => {
  const run = emptyRun();
  const lip = run.distance + 8;
  run.ramps = [{ id: 70, lane: 2, at: lip, kind: 'long' }];
  for (let i = 0; i < 600 && run.distance < lip - 1.5; i++) stepRun(run, 1 / 60);
  steer(run, 1);
  for (let i = 0; i < 30 && !run.events.some((event) => event.type === 'crash'); i++) stepRun(run, 1 / 60);
  assert.equal(run.lives, SLED.lives - 1, "the long ramp's side is a wall");

  const low = emptyRun();
  const lowLip = low.distance + 8;
  low.ramps = [{ id: 71, lane: 2, at: lowLip, kind: 'ramp' }];
  for (let i = 0; i < 600 && low.distance < lowLip - 1.5; i++) stepRun(low, 1 / 60);
  steer(low, 1);
  for (let i = 0; i < 20; i++) stepRun(low, 1 / 60);
  assert.equal(low.lives, SLED.lives);
  assert.ok(low.air || low.climbing, 'onto the low ramp from the side');

  const off = emptyRun();
  const offLip = off.distance + 4 + SLED.ramps.jump.length;
  off.ramps = [{ id: 72, lane: off.lane, at: offLip, kind: 'jump' }];
  for (let i = 0; i < 600 && off.distance < offLip - 1.6; i++) stepRun(off, 1 / 60);
  assert.equal(off.climbing, 72);
  steer(off, 1);
  let fell = false;
  for (let i = 0; i < 60 && !off.events.some((event) => event.type === 'land'); i++) {
    stepRun(off, 1 / 60);
    if (off.events.some((event) => event.type === 'launch' && event.kind === null)) fell = true;
  }
  assert.ok(fell, 'off the side, not the lip');
  assert.equal(off.jumps, 0, 'no bonus for falling off');
});

test('hearts come only while a life is missing, give it back, and pay points with every life left', () => {
  const full = newRun(12);
  startRun(full);
  for (let i = 0; i < 60 * 60; i++) {
    full.lives = SLED.lives;
    full.recover = 1;
    stepRun(full, 1 / 60);
  }
  assert.equal(full.hearts.length, 0, 'no hearts with every life');

  const hurt = newRun(12);
  startRun(hurt);
  let made = 0;
  for (let i = 0; i < 60 * 60; i++) {
    hurt.lives = 1;
    hurt.recover = 1;
    const before = new Set(hurt.hearts.map((heart) => heart.id));
    stepRun(hurt, 1 / 60);
    made += hurt.hearts.filter((heart) => !before.has(heart.id)).length;
  }
  assert.ok(made >= 2, `hearts made: ${made}`);
  const blocked = (heart: { lane: number; at: number }) => hurt.obstacles.some((obstacle) => obstacle.at === heart.at && obstacle.lane === heart.lane);
  assert.ok(hurt.hearts.every((heart) => !blocked(heart)), 'in a free lane');

  const run = emptyRun();
  run.lives = 1;
  run.hearts = [{ id: 80, lane: run.lane, at: run.distance + 2, taken: false }, { id: 81, lane: run.lane, at: run.distance + 12, taken: false }];
  const [first, second] = run.hearts;
  play(run, 0.5);
  assert.equal(run.lives, 2);
  assert.equal(first.taken, true);
  assert.equal(second.taken, false);
  run.lives = SLED.lives;
  const score = run.score;
  play(run, 1.2);
  assert.equal(second.taken, true);
  assert.equal(run.lives, SLED.lives, 'never more than the start');
  assert.ok(run.score - score >= SLED.bonus.heart);
});

test('pickups high above the chair in a jump are out of reach', () => {
  const run = emptyRun();
  run.air = true;
  run.height = 3;
  run.vy = 8;
  run.bottles = [{ id: 90, lane: run.lane, at: run.distance + 1, taken: false }];
  run.hearts = [{ id: 91, lane: run.lane, at: run.distance + 1, taken: false }];
  run.lives = 2;
  play(run, 0.15);
  assert.equal(run.bottles[0].taken, false);
  assert.equal(run.hearts[0].taken, false);
  assert.equal(run.lives, 2);
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

/** Off the lip of a ramp of `kind` in front of the chair: the run just launched. */
function launched(kind: Ramp['kind'], speed = SLED.speed.start): SledRun {
  const run = emptyRun();
  run.ramps = [{ id: 40, lane: run.lane, at: run.distance + 1 + SLED.ramps[kind].length, kind }];
  for (let i = 0; i < 600 && !run.air; i++) {
    run.speed = speed;
    stepRun(run, 1 / 60);
  }
  assert.ok(run.air && run.jump === kind);
  return run;
}

/** Fly to the landing, at a steady speed; the landing's event. */
function fly(run: SledRun, speed = SLED.speed.start, during?: (run: SledRun) => void) {
  for (let i = 0; i < 600 && run.air; i++) {
    during?.(run);
    run.speed = speed;
    stepRun(run, 1 / 60);
  }
  return run.events.find((event) => event.type === 'land');
}

test('tricks only start in the air off a ramp, one at a time', () => {
  const ground = emptyRun();
  assert.equal(trick(ground, 'spin'), false, 'not on the ground');
  const fallen = emptyRun();
  Object.assign(fallen, { air: true, height: 1, jump: null });
  assert.equal(trick(fallen, 'spin'), false, "not falling off a ramp's side");
  const run = launched('long');
  assert.equal(trick(run, 'flip'), true);
  assert.equal(trick(run, 'spin'), false, 'one at a time');
  for (let t = 0; t < SLED.tricks.flip.time + 0.02; t += 1 / 60) stepRun(run, 1 / 60);
  assert.equal(run.trick, null);
  assert.deepEqual(run.done, ['flip']);
  assert.equal(trick(run, 'spin'), true, 'the next one after it');
});

test('tricks done pay on landing, each further one in the jump more', () => {
  assert.equal(trickPoints(['spin', 'flip']), SLED.tricks.spin.points + SLED.tricks.flip.points * 2);
  const run = launched('long');
  const land = fly(run, SLED.speed.start, (state) => {
    if (!state.trick && state.done.length < 2) trick(state, 'spin');
  });
  assert.ok(land?.type === 'land');
  assert.deepEqual(land.tricks, ['spin', 'spin']);
  assert.equal(land.points, (SLED.ramps.long.bonus + trickPoints(['spin', 'spin'])) * multiplier(run));
  assert.equal(run.tricks, 2);
  assert.equal(run.lives, SLED.lives);
});

test('landing in the middle of a trick is a crash; nearly round is clean', () => {
  // The small ramp's hop is too short for a whole flip.
  const short = launched('ramp');
  trick(short, 'flip');
  const bailed = fly(short);
  assert.ok(bailed?.type === 'land' && bailed.points === 0);
  assert.ok(short.events.some((event) => event.type === 'bail'));
  assert.equal(short.lives, SLED.lives - 1);
  assert.equal(short.tricks, 0);

  // A spin started just late enough to be past `clean` at the landing counts.
  const late = launched('jump');
  const air = { left: Infinity };
  const land = fly(late, SLED.speed.start, (state) => {
    // Seconds left in the air, from the height and the upward speed.
    air.left = (state.vy + Math.sqrt(state.vy ** 2 + 2 * SLED.gravity * state.height)) / SLED.gravity;
    if (!state.trick && !state.done.length && air.left <= SLED.tricks.spin.time * (SLED.clean + 0.1)) trick(state, 'spin');
  });
  assert.ok(land?.type === 'land');
  assert.deepEqual(land.tricks, ['spin']);
  assert.equal(late.lives, SLED.lives);
});
