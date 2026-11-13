/**
 * The chair downhill (the laptop's first minigame): the office chair races down a slope in three lanes, the obstacles
 * of the circuit's works come up the hill, soda bottles light the nitro. Pure rules, no three.js: the view reads the
 * state after each step and its `events`, tests drive it in Node.
 *
 * Track coordinates: `distance` is how far the chair has come down the slope (m); an obstacle's `at` is its distance
 * along the same line, so it is `at - distance` metres ahead of the chair. Lanes are 0 (left) … 2 (right), `x` is the
 * chair's position across them in lanes.
 */

export const SLED = {
  lanes: 3,
  /** Width of a lane on the slope (m), for the view. */
  laneWidth: 2.5,
  lives: 3,
  /** Speed down the slope (m/s): it starts at `start` and grows by `gain` each second up to `max`. */
  speed: { start: 9, max: 21, gain: 0.11 },
  /** How quickly the speed follows its target (1/s), and what is kept after a crash. */
  ease: 1.6,
  crashSlow: 0.55,
  /** Seconds to slide over by one lane. */
  laneTime: 0.17,
  /** A hit counts within this distance along the track (m) and across (lanes) of an obstacle or bottle. */
  hit: { depth: 0.8, across: 0.55 },
  /** Seconds the chair blinks and goes through obstacles after a crash. */
  recover: 1.6,
  /** A bottle lights the nitro for `time` seconds: `speed` times faster, `points` times the points, smashing through. */
  nitro: { time: 3.2, speed: 1.55, points: 3 },
  /** Bonus points for a bottle and for an obstacle smashed with the nitro. */
  bonus: { bottle: 25, smash: 40 },
  /** Points per metre down the slope (before multipliers). */
  perMetre: 1,
  /** Every `every` seconds without crashing the multiplier rises by `step`, up to `max`. */
  combo: { every: 10, step: 0.5, max: 3 },
  /** Rows are made this far ahead of the chair (m) and dropped this far behind it. */
  ahead: 90,
  behind: 8,
  /** The first row's distance (m). */
  first: 30,
  /**
   * Gap between rows (m): at least `min`, and at least the fastest speed it may be met at times `reaction` (enough to
   * slide two lanes over), plus up to `extra`.
   */
  gap: { min: 9, reaction: 0.62, extra: 9 },
  /** Two lanes blocked in a row: the chance grows from `from` by `per` each metre, up to `max`. */
  double: { from: 0.15, per: 1 / 2500, max: 0.6 },
  /** A bottle every so many rows (inclusive range), in a free lane of the row. */
  bottleRows: [4, 8],
} as const;

/** What blocks a lane, all from the circuit's works (circuit.glb). */
export const OBSTACLE_KINDS = ['cones', 'drums', 'jersey', 'fence', 'tyres', 'pipe', 'barrow', 'works', 'sacks'] as const;
export type ObstacleKind = (typeof OBSTACLE_KINDS)[number];

export type Obstacle = { id: number; lane: number; at: number; kind: ObstacleKind; hit: boolean };
export type Bottle = { id: number; lane: number; at: number; taken: boolean };

export type SledEvent =
  | { type: 'crash'; id: number }
  | { type: 'smash'; id: number }
  | { type: 'bottle'; id: number }
  | { type: 'nitro-end' }
  | { type: 'over' };

export type SledPhase = 'ready' | 'playing' | 'over';

export type SledRun = {
  phase: SledPhase;
  time: number;
  distance: number;
  speed: number;
  /** The lane the chair is heading for, and where it is across the lanes now. */
  lane: number;
  x: number;
  lives: number;
  /** Seconds left of blinking after a crash, and of nitro. */
  recover: number;
  nitro: number;
  /** Seconds without crashing (the multiplier grows with it). */
  streak: number;
  score: number;
  obstacles: Obstacle[];
  bottles: Bottle[];
  /** Where the next row goes, how many rows were made, and the row of the next bottle. */
  nextRow: number;
  rows: number;
  bottleRow: number;
  /** The random generator's state (mulberry32). */
  seed: number;
  nextId: number;
  /** What happened in the last step. */
  events: SledEvent[];
};

/** mulberry32: a small seeded generator, so a seed always makes the same slope. */
function random(run: SledRun): number {
  run.seed = (run.seed + 0x6d2b79f5) | 0;
  let t = run.seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const between = (run: SledRun, [low, high]: readonly [number, number]) => low + Math.floor(random(run) * (high - low + 1));

export function newRun(seed = Date.now()): SledRun {
  const run: SledRun = {
    phase: 'ready', time: 0, distance: 0, speed: SLED.speed.start, lane: 1, x: 1, lives: SLED.lives, recover: 0, nitro: 0, streak: 0, score: 0,
    obstacles: [], bottles: [], nextRow: SLED.first, rows: 0, bottleRow: 0, seed: seed | 0, nextId: 1, events: [],
  };
  run.bottleRow = between(run, SLED.bottleRows);
  fill(run);
  return run;
}

export function startRun(run: SledRun): void {
  if (run.phase === 'ready') run.phase = 'playing';
}

/** The speed the chair heads for: growing with time, faster with the nitro. */
export function targetSpeed(run: SledRun): number {
  const base = Math.min(SLED.speed.max, SLED.speed.start + SLED.speed.gain * run.time);
  return base * (run.nitro > 0 ? SLED.nitro.speed : 1);
}

/** The points multiplier: the streak without crashing, times the nitro's. */
export function multiplier(run: SledRun): number {
  const combo = Math.min(SLED.combo.max, 1 + Math.floor(run.streak / SLED.combo.every) * SLED.combo.step);
  return combo * (run.nitro > 0 ? SLED.nitro.points : 1);
}

/** Move one lane left (-1) or right (+1); false past the edges or when the run is not on. */
export function steer(run: SledRun, direction: -1 | 1): boolean {
  if (run.phase !== 'playing') return false;
  const lane = Math.max(0, Math.min(SLED.lanes - 1, run.lane + direction));
  if (lane === run.lane) return false;
  run.lane = lane;
  return true;
}

/** Make rows of obstacles up to SLED.ahead in front of the chair. Each row leaves at least one lane free. */
function fill(run: SledRun): void {
  while (run.nextRow < run.distance + SLED.ahead) {
    const at = run.nextRow;
    const double = Math.min(SLED.double.max, SLED.double.from + at * SLED.double.per);
    const count = random(run) < double ? 2 : 1;
    const lanes = [0, 1, 2];
    // Shuffle, then the first `count` are blocked and the rest free.
    for (let i = lanes.length - 1; i > 0; i--) {
      const j = Math.floor(random(run) * (i + 1));
      [lanes[i], lanes[j]] = [lanes[j], lanes[i]];
    }
    for (const lane of lanes.slice(0, count)) {
      run.obstacles.push({ id: run.nextId++, lane, at, kind: OBSTACLE_KINDS[Math.floor(random(run) * OBSTACLE_KINDS.length)], hit: false });
    }
    run.rows += 1;
    if (run.rows >= run.bottleRow) {
      const free = lanes.slice(count);
      run.bottles.push({ id: run.nextId++, lane: free[Math.floor(random(run) * free.length)], at, taken: false });
      run.bottleRow = run.rows + between(run, SLED.bottleRows);
    }
    // The fastest the next row may be met at: full speed so far, with the nitro on.
    const fastest = Math.min(SLED.speed.max, SLED.speed.start + SLED.speed.gain * (run.time + 6)) * SLED.nitro.speed;
    run.nextRow = at + Math.max(SLED.gap.min, fastest * SLED.gap.reaction) + random(run) * SLED.gap.extra;
  }
}

/** Advance the run by `dt` seconds; `events` lists what happened. */
export function stepRun(run: SledRun, dt: number): void {
  run.events = [];
  if (run.phase !== 'playing' || dt <= 0) return;
  dt = Math.min(dt, 0.1);
  run.time += dt;
  run.streak += dt;
  run.speed += (targetSpeed(run) - run.speed) * (1 - Math.exp(-dt * SLED.ease));
  // Slide across towards the lane.
  const slide = dt / SLED.laneTime;
  run.x += Math.max(-slide, Math.min(slide, run.lane - run.x));
  const travelled = run.speed * dt;
  run.score += travelled * SLED.perMetre * multiplier(run);
  run.distance += travelled;
  if (run.recover > 0) run.recover = Math.max(0, run.recover - dt);
  if (run.nitro > 0) {
    run.nitro = Math.max(0, run.nitro - dt);
    if (run.nitro === 0) run.events.push({ type: 'nitro-end' });
  }
  for (const bottle of run.bottles) {
    if (bottle.taken || Math.abs(bottle.at - run.distance) > SLED.hit.depth || Math.abs(bottle.lane - run.x) > SLED.hit.across) continue;
    bottle.taken = true;
    run.nitro = SLED.nitro.time;
    run.score += SLED.bonus.bottle;
    run.events.push({ type: 'bottle', id: bottle.id });
  }
  for (const obstacle of run.obstacles) {
    if (obstacle.hit || Math.abs(obstacle.at - run.distance) > SLED.hit.depth || Math.abs(obstacle.lane - run.x) > SLED.hit.across) continue;
    if (run.nitro > 0) {
      obstacle.hit = true;
      run.score += SLED.bonus.smash;
      run.events.push({ type: 'smash', id: obstacle.id });
    } else if (run.recover <= 0) {
      obstacle.hit = true;
      run.lives -= 1;
      run.recover = SLED.recover;
      run.streak = 0;
      run.speed *= SLED.crashSlow;
      run.events.push({ type: 'crash', id: obstacle.id });
      if (run.lives <= 0) {
        run.phase = 'over';
        run.events.push({ type: 'over' });
        return;
      }
    }
  }
  const gone = run.distance - SLED.behind;
  run.obstacles = run.obstacles.filter((obstacle) => obstacle.at > gone);
  run.bottles = run.bottles.filter((bottle) => bottle.at > gone);
  fill(run);
}

/** The score as shown and stored: whole points. */
export const points = (run: SledRun): number => Math.floor(run.score);

/** The best score and the last few, newest first, kept in localStorage. */
export type SledRecord = { best: number; runs: number[] };
export const SLED_KEY = 'simulation-3d:sled-best';
const KEEP_RUNS = 5;

export function readSledRecord(storage: Pick<Storage, 'getItem'> | undefined): SledRecord {
  try {
    const value = JSON.parse(storage?.getItem(SLED_KEY) ?? 'null') as Partial<SledRecord> | null;
    const best = Number(value?.best);
    const runs = Array.isArray(value?.runs) ? value.runs.map(Number).filter((run) => Number.isFinite(run) && run >= 0).slice(0, KEEP_RUNS) : [];
    return { best: Number.isFinite(best) && best > 0 ? Math.floor(best) : 0, runs };
  } catch {
    return { best: 0, runs: [] };
  }
}

/** Add a finished run's score; `best` says whether it beat the stored record. Storage failures are ignored. */
export function saveSledScore(storage: Pick<Storage, 'getItem' | 'setItem'> | undefined, score: number): { record: SledRecord; best: boolean } {
  const before = readSledRecord(storage);
  const best = score > before.best;
  const record = { best: Math.max(before.best, score), runs: [score, ...before.runs].slice(0, KEEP_RUNS) };
  try {
    storage?.setItem(SLED_KEY, JSON.stringify(record));
  } catch {
    // Blocked storage: the record lasts for this page only.
  }
  return { record, best };
}
