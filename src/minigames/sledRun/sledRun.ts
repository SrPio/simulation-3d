/**
 * The chair downhill (the laptop's first minigame): the office chair races down a slope in three lanes, the obstacles
 * of the circuit's works come up the hill, soda bottles light the nitro. Pure rules, no three.js: the view reads the
 * state after each step and its `events`, tests drive it in Node.
 *
 * Track coordinates: `distance` is how far the chair has come down the slope (m); an obstacle's `at` is its distance
 * along the same line, so it is `at - distance` metres ahead of the chair. Lanes are 0 (left) … 2 (right), `x` is the
 * chair's position across them in lanes.
 *
 * Ramps stand in a lane with their lip at `at`, rising from `at - length`: a chair that climbs one from its foot flies
 * off the lip and over whatever is below it (`height`, m above the slope); steering stays on in the air. After some
 * long ramps a wall blocks every lane, cleared only by that jump. Hearts give a lost life back.
 *
 * Tricks: in the air off a ramp the chair can spin round (`spin`) or flip over backwards (`flip`), one at a time; each
 * done pays on landing, more for each further trick in the same jump, but landing in the middle of one is a crash.
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
  /** Bonus points for a bottle, an obstacle smashed with the nitro, and a heart taken with every life left. */
  bonus: { bottle: 25, smash: 40, heart: 50 },
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
  /** A heart every so many rows while a life is missing (inclusive range): it gives one back. */
  heartRows: [12, 20],
  /** Over this height (m) the chair flies over the obstacles; pickups are reached below `reach`. */
  clear: 0.9,
  reach: 1.8,
  /** Pull down in the air (m/s²): stronger than real, so the jumps feel snappy. */
  gravity: 19,
  /**
   * The ramps (m): `length` from the foot to the lip, `height` of the lip, `lift` the upward speed off the lip (m/s, the
   * same at any speed, so a jump always lasts about as long and only flies further when faster), `bonus` on landing.
   * `ramp` and `jump` are the circuit's own two ramps; `long` is longer and steeper.
   */
  ramps: {
    ramp: { length: 3.0, height: 0.5, lift: 2.6, bonus: 20 },
    jump: { length: 2.6, height: 0.9, lift: 4.2, bonus: 40 },
    long: { length: 5.6, height: 2.2, lift: 6.4, bonus: 80 },
  },
  /**
   * A ramp every so many rows (inclusive range), and the chance of each kind: about half are long, a big jump every
   * ten rows or so. The first, at row `firstRamp`, is always long, so the big jump shows early.
   */
  rampRows: [4, 7],
  firstRamp: 3,
  rampKinds: { ramp: 0.2, jump: 0.3, long: 0.5 },
  /**
   * After a long ramp, with this chance, a wall across every lane `after` m past the lip (its front is under the jump
   * at any speed the chair can have there, and the chair lands past it): only the jump gets over it.
   */
  wall: { chance: 0.65, after: 3 },
  /**
   * Tricks: `time` (s) a whole turn takes, `points` for it (the n-th trick of one jump pays n times). A landing counts as
   * clean when the trick in hand is past `clean` of its turn (it is finished in a blink); before that it is a crash.
   */
  tricks: {
    spin: { time: 0.45, points: 60 },
    flip: { time: 0.6, points: 100 },
  },
  clean: 0.8,
} as const;

/** What blocks a lane, all from the circuit's works (circuit.glb). */
export const OBSTACLE_KINDS = ['cones', 'drums', 'jersey', 'fence', 'tyres', 'pipe', 'barrow', 'works', 'sacks'] as const;
export type ObstacleKind = (typeof OBSTACLE_KINDS)[number];

export type RampKind = keyof typeof SLED.ramps;
export const RAMP_KINDS = Object.keys(SLED.ramps) as RampKind[];
/** What a wall across the three lanes is made of. */
const WALL_KINDS: readonly ObstacleKind[] = ['jersey', 'fence', 'drums', 'tyres'];

export type Obstacle = { id: number; lane: number; at: number; kind: ObstacleKind; hit: boolean };
export type Bottle = { id: number; lane: number; at: number; taken: boolean };
export type Heart = Bottle;
export type TrickKind = keyof typeof SLED.tricks;
/** The trick in the air: which, and how far round it has turned (0…1). */
export type Trick = { kind: TrickKind; turn: number };
/** `at` is the lip; the ramp rises from `at - SLED.ramps[kind].length`. */
export type Ramp = { id: number; lane: number; at: number; kind: RampKind };

export type SledEvent =
  | { type: 'crash'; id: number }
  | { type: 'smash'; id: number }
  | { type: 'bottle'; id: number }
  | { type: 'heart'; id: number }
  | { type: 'launch'; kind: RampKind | null }
  | { type: 'land'; kind: RampKind | null; points: number; tricks: TrickKind[] }
  | { type: 'trick-done'; kind: TrickKind }
  | { type: 'bail'; kind: TrickKind }
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
  hearts: Heart[];
  ramps: Ramp[];
  /** Height above the slope (m) and upward speed (m/s); `air` while flying, off which ramp (null: fell off its side). */
  height: number;
  vy: number;
  air: boolean;
  jump: RampKind | null;
  /** The ramp being climbed (its id), 0 on the ground or in the air. */
  climbing: number;
  /** Jumps landed. */
  jumps: number;
  /** The trick turning now, the tricks finished in this jump, and every trick landed in the run. */
  trick: Trick | null;
  done: TrickKind[];
  tricks: number;
  /** Where the next row goes, how many rows were made, and the rows of the next bottle, heart and ramp. */
  nextRow: number;
  rows: number;
  bottleRow: number;
  heartRow: number;
  rampRow: number;
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
    obstacles: [], bottles: [], hearts: [], ramps: [], height: 0, vy: 0, air: false, jump: null, climbing: 0, jumps: 0, trick: null, done: [], tricks: 0,
    nextRow: SLED.first, rows: 0, bottleRow: 0, heartRow: 0, rampRow: SLED.firstRamp, seed: seed | 0, nextId: 1, events: [],
  };
  run.bottleRow = between(run, SLED.bottleRows);
  run.heartRow = between(run, SLED.heartRows);
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

/** Start a trick: only in the air off a ramp's lip and with no other trick turning; false otherwise. */
export function trick(run: SledRun, kind: TrickKind): boolean {
  if (run.phase !== 'playing' || !run.air || !run.jump || run.trick) return false;
  run.trick = { kind, turn: 0 };
  return true;
}

/** The points the tricks of one jump pay (before the multiplier): the n-th one n times its own. */
export function trickPoints(tricks: readonly TrickKind[]): number {
  return tricks.reduce((sum, kind, i) => sum + SLED.tricks[kind].points * (i + 1), 0);
}

/** The fastest the rows being made now may be met at: full speed so far, with the nitro on. */
function fastest(run: SledRun): number {
  return Math.min(SLED.speed.max, SLED.speed.start + SLED.speed.gain * (run.time + 6)) * SLED.nitro.speed;
}

/** A ramp kind by its chances. */
function pickRamp(run: SledRun): RampKind {
  let roll = random(run);
  for (const kind of RAMP_KINDS) {
    roll -= SLED.rampKinds[kind];
    if (roll < 0) return kind;
  }
  return RAMP_KINDS[RAMP_KINDS.length - 1];
}

/**
 * Make rows up to SLED.ahead in front of the chair. An obstacle row leaves at least one lane free; a ramp row is a ramp
 * in one lane (its foot where the row goes), and after a long one maybe a wall across every lane that only its jump
 * clears.
 */
function fill(run: SledRun): void {
  while (run.nextRow < run.distance + SLED.ahead) {
    let end = run.nextRow;
    if (run.rows + 1 >= run.rampRow) {
      const kind = run.rows + 1 === SLED.firstRamp ? 'long' : pickRamp(run);
      const lane = Math.floor(random(run) * SLED.lanes);
      const lip = run.nextRow + SLED.ramps[kind].length;
      run.ramps.push({ id: run.nextId++, lane, at: lip, kind });
      end = lip;
      if (kind === 'long' && random(run) < SLED.wall.chance) {
        end = lip + SLED.wall.after;
        const wall = WALL_KINDS[Math.floor(random(run) * WALL_KINDS.length)];
        for (let i = 0; i < SLED.lanes; i++) run.obstacles.push({ id: run.nextId++, lane: i, at: end, kind: wall, hit: false });
      }
      run.rows += 1;
      run.rampRow = run.rows + between(run, SLED.rampRows);
    } else {
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
      const free = lanes.slice(count);
      if (run.rows >= run.bottleRow) {
        const lane = free.splice(Math.floor(random(run) * free.length), 1)[0];
        run.bottles.push({ id: run.nextId++, lane, at, taken: false });
        run.bottleRow = run.rows + between(run, SLED.bottleRows);
      }
      // A heart only while a life is missing, in a free lane the bottle did not take (else it waits a row).
      if (run.rows >= run.heartRow && run.lives < SLED.lives && free.length > 0) {
        run.hearts.push({ id: run.nextId++, lane: free[Math.floor(random(run) * free.length)], at, taken: false });
        run.heartRow = run.rows + between(run, SLED.heartRows);
      }
    }
    run.nextRow = end + Math.max(SLED.gap.min, fastest(run) * SLED.gap.reaction) + random(run) * SLED.gap.extra;
  }
}

/** Lose a life: slower, the streak gone, blinking for a while; false when it was the last. */
function crash(run: SledRun, id: number): boolean {
  run.lives -= 1;
  run.recover = SLED.recover;
  run.streak = 0;
  run.speed *= SLED.crashSlow;
  run.events.push({ type: 'crash', id });
  if (run.lives > 0) return true;
  run.phase = 'over';
  run.events.push({ type: 'over' });
  return false;
}

/** The height of a ramp's surface `distance` m down the slope (0 off its length). */
export function rampSurface(ramp: Ramp, distance: number): number {
  const spec = SLED.ramps[ramp.kind];
  const along = distance - (ramp.at - spec.length);
  return along < 0 || along > spec.length ? 0 : (spec.height * along) / spec.length;
}

/**
 * Up and down: climbing a ramp lifts the chair along it and the lip throws it up; steering off a ramp's side drops it;
 * in the air it falls and lands. Driving into the side of a ramp where it is taller than SLED.clear is a crash (not
 * while blinking or with the nitro). False when that crash ended the run.
 */
function verticalStep(run: SledRun, before: number, dt: number): boolean {
  if (run.air) {
    run.vy -= SLED.gravity * dt;
    run.height += run.vy * dt;
    if (run.trick) {
      run.trick.turn += dt / SLED.tricks[run.trick.kind].time;
      if (run.trick.turn >= 1) {
        run.done.push(run.trick.kind);
        run.events.push({ type: 'trick-done', kind: run.trick.kind });
        run.trick = null;
      }
    }
    if (run.height > 0) return true;
    run.height = 0;
    run.vy = 0;
    run.air = false;
    const kind = run.jump;
    run.jump = null;
    const turning = run.trick;
    run.trick = null;
    if (turning && turning.turn >= SLED.clean) run.done.push(turning.kind);
    const tricks = run.done;
    run.done = [];
    if (turning && turning.turn < SLED.clean) {
      // Landed sideways or upside down: the tricks of this jump are lost, and (unless blinking) a life with them.
      run.events.push({ type: 'bail', kind: turning.kind });
      run.events.push({ type: 'land', kind, points: 0, tricks: [] });
      return run.recover > 0 || crash(run, 0);
    }
    const points = kind ? (SLED.ramps[kind].bonus + trickPoints(tricks)) * multiplier(run) : 0;
    if (kind) run.jumps += 1;
    run.tricks += tricks.length;
    run.score += points;
    run.events.push({ type: 'land', kind, points, tricks });
    return true;
  }
  const climbed = run.ramps.find((ramp) => ramp.id === run.climbing);
  if (climbed) {
    if (run.distance >= climbed.at) {
      // Off the lip.
      run.climbing = 0;
      run.air = true;
      run.jump = climbed.kind;
      run.height = SLED.ramps[climbed.kind].height;
      run.vy = SLED.ramps[climbed.kind].lift;
      run.events.push({ type: 'launch', kind: climbed.kind });
      return true;
    }
    if (Math.abs(climbed.lane - run.x) <= SLED.hit.across) {
      run.height = rampSurface(climbed, run.distance);
      return true;
    }
    // Steered off its side: falls from where it was.
    run.climbing = 0;
    run.air = true;
    run.jump = null;
    run.vy = 0;
    run.events.push({ type: 'launch', kind: null });
    return true;
  }
  run.height = 0;
  for (const ramp of run.ramps) {
    if (Math.abs(ramp.lane - run.x) > SLED.hit.across) continue;
    const foot = ramp.at - SLED.ramps[ramp.kind].length;
    if (run.distance < foot || run.distance >= ramp.at) continue;
    // Up it goes: from the foot, onto a low part from the side, or anyhow while blinking or with the nitro.
    run.climbing = ramp.id;
    run.height = rampSurface(ramp, run.distance);
    const fromSide = before > foot && run.height > SLED.clear && run.recover <= 0 && run.nitro <= 0;
    return fromSide ? crash(run, ramp.id) : true;
  }
  return true;
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
  const before = run.distance;
  run.distance += travelled;
  if (run.recover > 0) run.recover = Math.max(0, run.recover - dt);
  if (run.nitro > 0) {
    run.nitro = Math.max(0, run.nitro - dt);
    if (run.nitro === 0) run.events.push({ type: 'nitro-end' });
  }
  if (!verticalStep(run, before, dt)) return;
  const low = run.height < SLED.reach;
  for (const heart of run.hearts) {
    if (!low || heart.taken || Math.abs(heart.at - run.distance) > SLED.hit.depth || Math.abs(heart.lane - run.x) > SLED.hit.across) continue;
    heart.taken = true;
    if (run.lives < SLED.lives) run.lives += 1;
    else run.score += SLED.bonus.heart;
    run.events.push({ type: 'heart', id: heart.id });
  }
  for (const bottle of run.bottles) {
    if (!low || bottle.taken || Math.abs(bottle.at - run.distance) > SLED.hit.depth || Math.abs(bottle.lane - run.x) > SLED.hit.across) continue;
    bottle.taken = true;
    run.nitro = SLED.nitro.time;
    run.score += SLED.bonus.bottle;
    run.events.push({ type: 'bottle', id: bottle.id });
  }
  for (const obstacle of run.obstacles) {
    if (obstacle.hit || run.height >= SLED.clear || Math.abs(obstacle.at - run.distance) > SLED.hit.depth || Math.abs(obstacle.lane - run.x) > SLED.hit.across) continue;
    if (run.nitro > 0) {
      obstacle.hit = true;
      run.score += SLED.bonus.smash;
      run.events.push({ type: 'smash', id: obstacle.id });
    } else if (run.recover <= 0) {
      obstacle.hit = true;
      if (!crash(run, obstacle.id)) return;
    }
  }
  const gone = run.distance - SLED.behind;
  run.obstacles = run.obstacles.filter((obstacle) => obstacle.at > gone);
  run.bottles = run.bottles.filter((bottle) => bottle.at > gone);
  run.hearts = run.hearts.filter((heart) => heart.at > gone);
  run.ramps = run.ramps.filter((ramp) => ramp.at > gone || ramp.id === run.climbing);
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
