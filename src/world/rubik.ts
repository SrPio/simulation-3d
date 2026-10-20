/**
 * The years-of-experience Rubik's cube (pure: no three.js). 27 cubies on integer coordinates -1…1 with an integer
 * rotation each; a move turns one outer layer a quarter turn. The cube keeps the moves that scrambled it, so solving
 * is undoing them in reverse: when the character comes near the cube unscrambles one turn at a time and then lights
 * the number; when it walks away the number goes out and the cube scrambles itself again, slower.
 */

/** 0 x, 1 y, 2 z. */
export type Axis = 0 | 1 | 2;
export type Vec3i = [number, number, number];
/** Row-major 3×3 rotation with entries -1, 0, 1. */
export type Mat3i = [number, number, number, number, number, number, number, number, number];
/** A quarter turn of the layer at `layer` (-1 or 1) along `axis`, `turn` +1 counter-clockwise seen from +axis. */
export type Move = { axis: Axis; layer: -1 | 1; turn: 1 | -1 };
export type Cubie = { home: Vec3i; at: Vec3i; rotation: Mat3i };
export type RubikPhase = 'scrambled' | 'solving' | 'solved' | 'scrambling';

export const RUBIK = {
  /** Turns that scramble it, at load and again after the character leaves. */
  scramble: 14,
  /** Seconds per turn while solving, and per turn plus pause while scrambling again. */
  solveTurn: 0.16,
  scrambleTurn: 0.3,
  scramblePause: 0.45,
  /** Wait after the number goes out before it scrambles again. */
  scrambleDelay: 0.8,
  /** Seconds for the number to light up and to go out. */
  revealTime: 1.1,
  hideTime: 0.5,
  /** The character is near within `reach` metres of the pedestal's middle; it leaves past `reach + margin`. */
  reach: 2.9,
  margin: 0.5,
};

const IDENTITY: Mat3i = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** The quarter-turn rotation about an axis (+1 counter-clockwise seen from the axis' positive end). */
export function quarter(axis: Axis, turn: 1 | -1): Mat3i {
  const s = turn;
  if (axis === 0) return [1, 0, 0, 0, 0, -s, 0, s, 0];
  if (axis === 1) return [0, 0, s, 0, 1, 0, -s, 0, 0];
  return [0, -s, 0, s, 0, 0, 0, 0, 1];
}

function multiply(a: Mat3i, b: Mat3i): Mat3i {
  const out = new Array<number>(9) as Mat3i;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return out;
}

function apply(m: Mat3i, [x, y, z]: Vec3i): Vec3i {
  return [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z];
}

export const inverse = (move: Move): Move => ({ ...move, turn: -move.turn as 1 | -1 });

export function solvedCubies(): Cubie[] {
  const cubies: Cubie[] = [];
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
    cubies.push({ home: [x, y, z], at: [x, y, z], rotation: [...IDENTITY] });
  }
  return cubies;
}

/** Whether a cubie lies in the layer a move turns. */
export const inLayer = (cubie: Cubie, move: Move): boolean => cubie.at[move.axis] === move.layer;

/** Turn the move's layer a quarter turn. */
export function turnLayer(cubies: Cubie[], move: Move): void {
  const r = quarter(move.axis, move.turn);
  for (const cubie of cubies) {
    if (!inLayer(cubie, move)) continue;
    cubie.at = apply(r, cubie.at);
    cubie.rotation = multiply(r, cubie.rotation);
  }
}

/** Every cubie home and unturned (the centres too, so the number on the front reads upright). */
export const isSolved = (cubies: readonly Cubie[]): boolean =>
  cubies.every((cubie) => cubie.at.every((value, i) => value === cubie.home[i]) && cubie.rotation.every((value, i) => value === IDENTITY[i]));

/** A small seeded generator (mulberry32), so the scrambles are the same in the tests. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random turn that does not turn the same layer as the previous one (which could undo it). */
export function randomMove(random: () => number, previous?: Move): Move {
  for (;;) {
    const move: Move = { axis: Math.floor(random() * 3) as Axis, layer: random() < 0.5 ? -1 : 1, turn: random() < 0.5 ? -1 : 1 };
    if (!previous || move.axis !== previous.axis || move.layer !== previous.layer) return move;
  }
}

/** The turn under way: how far it has gone (0…1) of `duration` seconds. */
export type Turning = { move: Move; elapsed: number; duration: number; solving: boolean };

/** Whether the character is near the cube, with hysteresis. */
export const nearCube = (distance: number, wasNear: boolean): boolean => distance < RUBIK.reach + (wasNear ? RUBIK.margin : 0);

/** Smooth start and stop of a turn. */
export const easeTurn = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

export class RubikPuzzle {
  readonly cubies = solvedCubies();
  /** The moves that scrambled it, undone from the end. */
  readonly history: Move[] = [];
  turning?: Turning;
  /** How lit the number on the front is (0…1). */
  reveal = 0;
  private wait = 0;
  private readonly random: () => number;

  constructor(seed = 5) {
    this.random = seeded(seed);
    for (let i = 0; i < RUBIK.scramble; i++) this.push(randomMove(this.random, this.history.at(-1)));
  }

  get phase(): RubikPhase {
    if (this.reveal > 0 || (!this.history.length && !this.turning)) return 'solved';
    if (this.turning) return this.turning.solving ? 'solving' : 'scrambling';
    return 'scrambled';
  }

  /** The turn under way and how far it has gone (eased), for drawing the turning layer. */
  get angle(): number {
    if (!this.turning) return 0;
    return easeTurn(this.turning.elapsed / this.turning.duration) * this.turning.move.turn * Math.PI / 2;
  }

  private push(move: Move): void {
    turnLayer(this.cubies, move);
    this.history.push(move);
  }

  /**
   * Advance by `delta` seconds. Near: undo the scramble a turn at a time, then light the number. Away: put the number
   * out, wait, then scramble again a turn at a time up to RUBIK.scramble turns. `instant` (reduced motion) skips the
   * turning and the fades. Returns the turns that finished in this step (for a click each).
   */
  update(delta: number, near: boolean, instant = false): number {
    let finished = 0;
    if (this.turning) {
      this.turning.elapsed += delta;
      if (instant || this.turning.elapsed >= this.turning.duration) {
        turnLayer(this.cubies, this.turning.move);
        this.turning = undefined;
        finished++;
      }
      return finished;
    }
    if (near) {
      this.wait = RUBIK.scrambleDelay;
      if (this.history.length) {
        const move = inverse(this.history.pop()!);
        if (instant) {
          // Reduced motion: solved at once, the number lit at once.
          turnLayer(this.cubies, move);
          while (this.history.length) turnLayer(this.cubies, inverse(this.history.pop()!));
          this.reveal = 1;
          return 1;
        }
        this.turning = { move, elapsed: 0, duration: RUBIK.solveTurn, solving: true };
      } else {
        this.reveal = instant ? 1 : Math.min(1, this.reveal + delta / RUBIK.revealTime);
      }
      return finished;
    }
    if (this.reveal > 0) {
      this.reveal = instant ? 0 : Math.max(0, this.reveal - delta / RUBIK.hideTime);
      return finished;
    }
    if (this.history.length >= RUBIK.scramble) return finished;
    this.wait -= delta;
    if (this.wait > 0) return finished;
    const move = randomMove(this.random, this.history.at(-1));
    this.history.push(move);
    if (instant) {
      turnLayer(this.cubies, move);
      return 1;
    }
    this.turning = { move, elapsed: 0, duration: RUBIK.scrambleTurn, solving: false };
    this.wait = RUBIK.scramblePause;
    return finished;
  }
}
