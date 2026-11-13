import { sweep, type Box2, type Floor } from './collisions.ts';

/**
 * Riding the snow hoverboard (Christmas, unlocked by destroying every snowman). It floats a little over the ground with
 * a slow bob, goes faster than running and is steered with the same camera-relative direction as walking: the board
 * turns towards it at a rate that drops with speed (wide carves) and speeds up with how far the stick or keys push.
 * Its velocity lags behind the heading, so turning hard makes it drift before the grip straightens it out. Space hops it;
 * it follows ramps and flies off their tops. Pure state and numbers, no three.js, so tests drive it directly.
 */
export const BOARD = {
  /**
   * Height of the deck's top over the ground (m): low, so the pads (0.1 m under the top) float just clear of the snow;
   * and the bob's size (m, small enough that they never touch it) and rate (rad/s).
   */
  hover: 0.15,
  bob: 0.012,
  bobRate: 2.4,
  /** Top speed (m/s, about 1.7 times running), pushing acceleration and how fast it slows coasting or braking (m/s²). */
  maxSpeed: 7.2,
  accel: 5.2,
  coast: 0.8,
  drag: 0.06,
  brake: 7,
  /** Turn rate towards the wanted direction (rad/s) standing and at top speed. */
  turnRate: 4.2,
  turnAtSpeed: 1.7,
  /** Asked to go this far off the heading or more (rad), it brakes as it turns round. */
  reverse: 2.2,
  /** How fast sideways sliding is damped (per second): low, so turns drift. */
  grip: 2.6,
  /** Collision circle round the board. */
  radius: 0.5,
  /** The hop's upward speed (m/s) and gravity (m/s²). */
  jump: 4.8,
  gravity: 13,
  /** The landing's knee dip: a damped spring (stiffness, damping) kicked by the fall speed. */
  dipStiffness: 70,
  dipDamping: 11,
  dipGain: 0.09,
  /** The deck's bank into turns (rad per rad/s of turning times m/s), its limit and how fast it follows. */
  bankGain: 0.05,
  bankLimit: 0.35,
  bankRate: 8,
} as const;

export type BoardInput = {
  /** Wanted direction on the ground (world x, z), of length 0…1 (how far the keys or stick push). */
  x: number;
  z: number;
};

export type BoardState = {
  x: number;
  z: number;
  /** Heading about +Y: the nose points at (sin heading, cos heading). */
  heading: number;
  vx: number;
  vz: number;
  /** Height of the board's base (the ground under it, without the hover) over the outside ground, and its vertical speed. */
  y: number;
  vy: number;
  airborne: boolean;
  /** Turn rate last step (rad/s, + to the left), sideways speed (m/s, the drift) and the deck's bank (rad). */
  turn: number;
  slide: number;
  bank: number;
  /** The knees' landing dip (m, + is lower) and its rate. */
  dip: number;
  dipRate: number;
  /** Forward speed last step and the smoothed forward acceleration (m/s²), for the rider's lean. */
  lastForward: number;
  accel: number;
  /** Seconds riding, for the bob. */
  clock: number;
};

export type BoardWorld = {
  boxes: readonly Box2[];
  floor: Floor;
  /** Ground height (outside ground plus ramps) under a point, relative to the outside ground. */
  ground: (x: number, z: number) => number;
};

export function boardAt(x: number, z: number, heading: number, speed = 0, y = 0): BoardState {
  return {
    x, z, heading, vx: Math.sin(heading) * speed, vz: Math.cos(heading) * speed, y, vy: 0, airborne: false,
    turn: 0, slide: 0, bank: 0, dip: 0, dipRate: 0, lastForward: speed, accel: 0, clock: 0,
  };
}

export function boardSpeed(state: BoardState): number {
  return Math.hypot(state.vx, state.vz);
}

/** Height of the deck's top over the board's base right now: the hover plus the bob (none while flying). */
export function deckHeight(state: BoardState, still = false): number {
  return BOARD.hover + (still || state.airborne ? 0 : Math.sin(state.clock * BOARD.bobRate) * BOARD.bob);
}

/** Hop: refused in the air. */
export function boardJump(state: BoardState): boolean {
  if (state.airborne) return false;
  state.airborne = true;
  state.vy = BOARD.jump;
  state.dipRate -= 1.2;
  return true;
}

/** Advance the board by `dt` seconds (sub-stepped). Returns how hard it hit something (m/s lost), 0 if not. */
export function boardStep(state: BoardState, input: BoardInput, dt: number, world: BoardWorld): number {
  const steps = Math.max(1, Math.ceil(dt / (1 / 60)));
  let impact = 0;
  for (let i = 0; i < steps; i++) impact = Math.max(impact, subStep(state, input, dt / steps, world));
  return impact;
}

const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

function subStep(state: BoardState, input: BoardInput, dt: number, world: BoardWorld): number {
  state.clock += dt;
  const push = Math.min(Math.hypot(input.x, input.z), 1);
  const fx = Math.sin(state.heading);
  const fz = Math.cos(state.heading);
  let forward = state.vx * fx + state.vz * fz;
  let side = state.vx * fz - state.vz * fx;
  const before = state.heading;
  if (push > 0.05) {
    // Turn the nose towards the wanted direction, slower the faster it goes.
    const off = wrap(Math.atan2(input.x, input.z) - state.heading);
    const fast = Math.min(Math.abs(forward) / BOARD.maxSpeed, 1);
    const rate = (BOARD.turnRate + (BOARD.turnAtSpeed - BOARD.turnRate) * fast) * (state.airborne ? 0.4 : 1);
    state.heading += Math.sign(off) * Math.min(Math.abs(off), rate * dt);
    if (!state.airborne) {
      if (Math.abs(off) >= BOARD.reverse && forward > 0.5) forward = Math.max(0, forward - BOARD.brake * dt);
      else {
        const wanted = BOARD.maxSpeed * push * Math.max(0, Math.cos(off));
        if (forward < wanted) forward = Math.min(forward + BOARD.accel * push * dt, wanted);
      }
    }
  }
  if (!state.airborne) {
    // Coasting: a little friction (it floats) and drag; the sideways slide fades with the grip.
    const slowing = (push > 0.05 ? 0 : BOARD.coast) + BOARD.drag * Math.abs(forward);
    forward = forward > 0 ? Math.max(0, forward - slowing * dt) : Math.min(0, forward + slowing * dt);
    side *= Math.exp(-BOARD.grip * dt);
    // The turn carries the old motion on: what was forward is now partly sideways (the drift).
    const nx = Math.sin(state.heading);
    const nz = Math.cos(state.heading);
    const turned = state.heading - before;
    side += forward * Math.sin(turned);
    forward *= Math.cos(turned);
    state.vx = forward * nx + side * nz;
    state.vz = forward * nz - side * nx;
  }
  state.turn = dt > 0 ? (state.heading - before) / dt : 0;
  state.slide = side;
  state.heading = wrap(state.heading);
  // Move with collisions: blocked, it keeps only what slides along the wall.
  const from = { x: state.x, z: state.z };
  const wanted = { x: state.vx * dt, z: state.vz * dt };
  const after = sweep(from, wanted, BOARD.radius, world.boxes, world.floor);
  const moved = { x: after.x - from.x, z: after.z - from.z };
  let impact = 0;
  if (Math.hypot(wanted.x - moved.x, wanted.z - moved.z) > 1e-4 && dt > 0) {
    const kept = { x: moved.x / dt, z: moved.z / dt };
    impact = Math.hypot(state.vx - kept.x, state.vz - kept.z);
    state.vx = kept.x * 0.9;
    state.vz = kept.z * 0.9;
  }
  state.x = after.x;
  state.z = after.z;
  // Height: follow the ground (ramps, the room's step) or fly.
  const ground = world.ground(state.x, state.z);
  if (state.airborne) {
    state.vy -= BOARD.gravity * dt;
    state.y += state.vy * dt;
    if (state.y <= ground && state.vy <= 0) {
      state.dipRate += Math.min(-state.vy, 8) * BOARD.dipGain * BOARD.dipStiffness * 0.1;
      state.y = ground;
      state.vy = 0;
      state.airborne = false;
    }
  } else {
    const rise = dt > 0 ? (ground - state.y) / dt : 0;
    if (ground < state.y - 0.02 && state.vy > 0.5) state.airborne = true; // off a ramp's top
    else {
      state.vy = rise;
      state.y = ground;
    }
  }
  // The knees' dip, the deck's bank into the turn and the smoothed acceleration.
  state.dipRate += (-state.dip * BOARD.dipStiffness - state.dipRate * BOARD.dipDamping) * dt;
  state.dip += state.dipRate * dt;
  const speed = Math.hypot(state.vx, state.vz);
  const bankTarget = Math.max(-BOARD.bankLimit, Math.min(BOARD.bankLimit, state.turn * speed * BOARD.bankGain));
  state.bank += (bankTarget - state.bank) * (1 - Math.exp(-dt * BOARD.bankRate));
  const newForward = state.vx * Math.sin(state.heading) + state.vz * Math.cos(state.heading);
  const accel = dt > 0 ? (newForward - state.lastForward) / dt : 0;
  state.lastForward = newForward;
  state.accel += (accel - state.accel) * (1 - Math.exp(-dt * 10));
  return impact;
}

/**
 * Getting on and off with the jump clip (`air`: the fractions of its length between take-off and landing): how far
 * through the hop the character is, 0 before take-off and 1 once landed, eased so the rise and the turn start and end
 * gently.
 */
export function hopFraction(time: number, duration: number, air: readonly [number, number]): number {
  const [up, down] = air;
  const t = Math.min(Math.max((time / duration - up) / (down - up), 0), 1);
  return t * t * (3 - 2 * t);
}

/** The character stands across the board (left foot forward, like a regular skateboarder): it faces the nose's right. */
export const STANCE_TURN = -Math.PI / 2;
