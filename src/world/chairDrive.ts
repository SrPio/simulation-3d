import { sweep, type Box2, type Floor } from './collisions.ts';

/**
 * Riding the office chair like a little wheeled vehicle. W pushes forward, S brakes and then rolls back slowly,
 * A and D turn the heading (more the faster it rolls; an office chair still swivels a bit standing). The casters
 * let it slide sideways a little before grip straightens it out. The upper part (seat, back and rider) is a damped
 * pendulum on the gas lift: it leans back when speeding up, forward when braking, sideways in turns, and bobs on landing.
 * Pure state and numbers, no three.js, so tests drive it directly.
 */
export const DRIVE = {
  maxSpeed: 5.5,
  reverseSpeed: 2.2,
  accel: 4.2,
  brake: 9,
  /** Rolling resistance (m/s²) and air drag (per second, times speed). */
  rolling: 0.7,
  drag: 0.12,
  /** Turn rate at full lock (rad/s) once rolling at `turnSpeed`, and the swivel standing still. */
  turnRate: 2.3,
  turnSpeed: 2.2,
  swivel: 0.6,
  /** How fast sideways sliding is damped (per second). */
  grip: 5.5,
  /** Collision circle round the base. */
  radius: 0.55,
  gravity: 9.82,
} as const;

/**
 * The nitro: two shaken soda bottles strapped to the chair spray backwards and push it on, faster than the legs can,
 * for as long as their fizz lasts (`burn` seconds from full), then refill in `refill` seconds once it is let go. It lights
 * again only with at least `restart` of a bottle. Lighting it kicks the seat back.
 */
export const NITRO = { accel: 8, maxSpeed: 9.5, burn: 2.5, refill: 6, restart: 0.25, kick: 2.4 } as const;

/** The seat's pendulum: stiffness, damping, how much an acceleration of 1 m/s² leans it (rad) and its limit. */
export const SWAY = { stiffness: 38, damping: 5.5, gain: 0.035, lateralGain: 0.02, limit: (12 * Math.PI) / 180, landing: 0.9 } as const;

export type DriveInput = {
  /** 1 forward (W), -1 back (S), 0 coasting. */
  throttle: number;
  /** 1 left (A), -1 right (D). */
  steer: number;
  /** The nitro button held (Space). */
  nitro?: boolean;
};

export type ChairState = {
  x: number;
  z: number;
  /** Heading about +Y: forward is (sin yaw, cos yaw), like the character. */
  yaw: number;
  /** Velocity on the ground (m/s). */
  vx: number;
  vz: number;
  /** Height of the base above the outside ground and its vertical speed; airborne after leaving a ramp. */
  y: number;
  vy: number;
  airborne: boolean;
  /** Seat lean forward (+) / back (-) and sideways, with their rates (rad, rad/s). */
  pitch: number;
  pitchRate: number;
  roll: number;
  rollRate: number;
  /** Forward speed last step, for the acceleration that drives the sway. */
  lastForward: number;
  /** Distance rolled (m), for the wheels' spin, and the casters' common swivel (yaw towards the motion). */
  rolled: number;
  casterYaw: number;
  /** What is left in the bottles, 0…1, and whether they are spraying now. */
  fuel: number;
  boosting: boolean;
};

export type DriveWorld = {
  boxes: readonly Box2[];
  floor: Floor;
  /** Ground height (outside ground plus ramps) under a point, relative to the outside ground. */
  ground: (x: number, z: number) => number;
};

export function chairAt(x: number, z: number, yaw: number): ChairState {
  return { x, z, yaw, vx: 0, vz: 0, y: 0, vy: 0, airborne: false, pitch: 0, pitchRate: 0, roll: 0, rollRate: 0, lastForward: 0, rolled: 0, casterYaw: yaw, fuel: 1, boosting: false };
}

/** Forward (signed) speed along the heading. */
export function forwardSpeed(state: ChairState): number {
  return state.vx * Math.sin(state.yaw) + state.vz * Math.cos(state.yaw);
}

const approach = (value: number, target: number, step: number) => (value < target ? Math.min(value + step, target) : Math.max(value - step, target));

/** Advance the chair by `dt` seconds (sub-stepped for long frames). Returns how hard it hit something (m/s lost), 0 if not. */
export function driveStep(state: ChairState, input: DriveInput, dt: number, world: DriveWorld): number {
  const steps = Math.max(1, Math.ceil(dt / (1 / 60)));
  let impact = 0;
  for (let i = 0; i < steps; i++) impact = Math.max(impact, subStep(state, input, dt / steps, world));
  return impact;
}

function subStep(state: ChairState, input: DriveInput, dt: number, world: DriveWorld): number {
  const fx = Math.sin(state.yaw);
  const fz = Math.cos(state.yaw);
  let forward = state.vx * fx + state.vz * fz;
  let side = state.vx * fz - state.vz * fx;
  const throttle = Math.max(-1, Math.min(1, input.throttle));
  const steer = Math.max(-1, Math.min(1, input.steer));
  // The nitro burns while held and there is fizz left; the bottles refill only once it is let go, and light again with a little in them.
  const lit = !!input.nitro && state.fuel > 0 && (state.boosting || state.fuel >= NITRO.restart);
  if (lit && !state.boosting) state.pitchRate -= NITRO.kick;
  state.boosting = lit;
  if (lit) state.fuel = Math.max(0, state.fuel - dt / NITRO.burn);
  else if (!input.nitro) state.fuel = Math.min(1, state.fuel + dt / NITRO.refill);
  if (!state.airborne) {
    // Engine (legs, really): forward up to maxSpeed; S brakes hard while rolling forward, then backs off slowly.
    if (throttle > 0) forward = forward < 0 ? approach(forward, 0, DRIVE.brake * dt) : Math.min(forward + DRIVE.accel * throttle * dt, Math.max(forward, DRIVE.maxSpeed));
    else if (throttle < 0) forward = forward > 0 ? approach(forward, 0, DRIVE.brake * dt) : Math.max(forward - DRIVE.accel * 0.6 * -throttle * dt, Math.min(forward, -DRIVE.reverseSpeed));
    // The spray pushes forwards whatever the legs do, up to the nitro's own top speed.
    if (lit) forward = forward < NITRO.maxSpeed ? Math.min(forward + NITRO.accel * dt, NITRO.maxSpeed) : forward;
    forward = approach(forward, 0, (DRIVE.rolling + DRIVE.drag * Math.abs(forward)) * dt);
    side *= Math.exp(-DRIVE.grip * dt);
    // Steering: proportional to rolling speed (reversed when backing up), plus a slow swivel standing still.
    const rolling = Math.min(Math.abs(forward) / DRIVE.turnSpeed, 1);
    const turn = steer * (DRIVE.turnRate * rolling * Math.sign(forward || 1) + DRIVE.swivel * (1 - rolling));
    state.yaw += turn * dt;
    // The turn carries part of the old motion sideways: the casters slide before they grip.
    const nx = Math.sin(state.yaw);
    const nz = Math.cos(state.yaw);
    side += (forward * (fx * nz - fz * nx)) * 0.35;
    state.vx = forward * nx + side * nz;
    state.vz = forward * nz - side * nx;
  }
  const before = { x: state.x, z: state.z };
  const wanted = { x: state.vx * dt, z: state.vz * dt };
  const after = sweep(before, wanted, DRIVE.radius, world.boxes, world.floor);
  let impact = 0;
  const moved = { x: after.x - before.x, z: after.z - before.z };
  const lost = Math.hypot(wanted.x - moved.x, wanted.z - moved.z);
  if (lost > 1e-4 && dt > 0) {
    // Blocked: keep only the velocity that went through (sliding along the wall), the rest is the knock.
    const kept = { x: moved.x / dt, z: moved.z / dt };
    impact = Math.hypot(state.vx - kept.x, state.vz - kept.z);
    state.vx = kept.x * 0.92;
    state.vz = kept.z * 0.92;
  }
  state.x = after.x;
  state.z = after.z;
  // Height: follow the ground (ramps) or fly off it.
  const ground = world.ground(state.x, state.z);
  if (state.airborne) {
    state.vy -= DRIVE.gravity * dt;
    state.y += state.vy * dt;
    if (state.y <= ground) {
      // Landing: the seat dips forward with the fall speed.
      state.pitchRate += Math.min(-state.vy, 6) * SWAY.landing;
      state.y = ground;
      state.vy = 0;
      state.airborne = false;
    }
  } else {
    const rise = (ground - state.y) / dt;
    // Leaving the top of a ramp faster than gravity can pull the base down: it takes off with the ramp's climb rate.
    if (ground < state.y - 0.02 && state.vy > 0.5) {
      state.airborne = true;
    } else {
      state.vy = rise;
      state.y = ground;
    }
  }
  // Sway: the seat leans against the acceleration (back when speeding up) and outwards in turns.
  const newForward = state.vx * Math.sin(state.yaw) + state.vz * Math.cos(state.yaw);
  const accel = dt > 0 ? (newForward - state.lastForward) / dt : 0;
  state.lastForward = newForward;
  const yawRate = steer * newForward;
  const pitchTarget = Math.max(-SWAY.limit, Math.min(SWAY.limit, -accel * SWAY.gain));
  const rollTarget = Math.max(-SWAY.limit, Math.min(SWAY.limit, yawRate * SWAY.lateralGain * DRIVE.turnRate));
  state.pitchRate += ((pitchTarget - state.pitch) * SWAY.stiffness - state.pitchRate * SWAY.damping) * dt;
  state.rollRate += ((rollTarget - state.roll) * SWAY.stiffness - state.rollRate * SWAY.damping) * dt;
  state.pitch = Math.max(-SWAY.limit * 1.5, Math.min(SWAY.limit * 1.5, state.pitch + state.pitchRate * dt));
  state.roll = Math.max(-SWAY.limit * 1.5, Math.min(SWAY.limit * 1.5, state.roll + state.rollRate * dt));
  // Wheels and casters.
  const speed = Math.hypot(state.vx, state.vz);
  state.rolled += speed * dt;
  if (speed > 0.05) {
    // Casters trail their wheels behind the motion: they swivel towards the direction of travel.
    const motion = Math.atan2(state.vx, state.vz);
    let delta = motion - state.casterYaw;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    state.casterYaw += delta * (1 - Math.exp(-dt * (3 + speed * 2)));
  }
  return impact;
}
