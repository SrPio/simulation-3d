import { sweep, type Box2, type Floor, type Point2 } from '../world/collisions.ts';

/** Ground speeds (m/s) the in-place walk/run clips were authored for (see the rig manifest). */
export const WALK_CLIP_SPEED = 0.8035714285714285;
export const RUN_CLIP_SPEED = 2.131578947368421;
export type Gait = 'walk' | 'run' | 'jump';
/** An in-place jump clip (rig manifest): its length, the fraction with the feet off the floor and the hop length. */
export type JumpSpec = { duration: number; air: [number, number]; distance: number };
/**
 * Alternative locomotion clips retargeted from Quaternius' Universal Animation Libraries (CC0): walk/run
 * with their authored ground speeds, jumps with their timing (see the interactions manifest).
 */
export const CLIP_ALTERNATIVES: Readonly<Record<string, { gait: Gait; speed?: number; jump?: JumpSpec }>> = {
  walk_ual: { gait: 'walk', speed: 0.8273764095805362 },
  run_ual_jog: { gait: 'run', speed: 5.2108531055844995 },
  run_ual_sprint: { gait: 'run', speed: 2.9406575122562426 },
  jump_ual: { gait: 'jump', jump: { duration: 1.6666666666666667, air: [0.12, 0.48], distance: 0.9 } },
};
/** Clips that play while walking, running and jumping when the model has them (otherwise the procedural ones). */
export const DEFAULT_GAIT_CLIPS: Readonly<Record<Gait, string>> = { walk: 'walk_ual', run: 'run_ual_sprint', jump: 'jump_ual' };
/** One-shot clip played in place with F: the character throws a laptop. */
export const THROW_CLIP = 'throw_ual';
/**
 * The hand that holds the laptop until it leaves it, and when (seconds into THROW_CLIP): above the head and
 * already in front of it, whipping forward. The rig's side names are mirrored: hand_L is the character's right hand.
 */
export const THROW_HAND = 'hand_L';
export const THROW_RELEASE = 0.53;
/** Launch speed of the thrown laptop (m/s) along the character's facing and upwards. */
export const THROW_SPEED = { forward: 5.5, up: 1.8 };
/**
 * The laptop leaves the right hand, off to the side of the body: it flies towards the point this far ahead on the line
 * the character faces, so what stands straight ahead (a target) is what it hits.
 */
export const THROW_AIM = 4.0;

/** Horizontal launch direction from the release point to the aim point THROW_AIM ahead of `from` along `yaw`. */
export function throwDirection(from: { x: number; z: number }, yaw: number, release: { x: number; z: number }): { x: number; z: number } {
  const aim = { x: from.x + Math.sin(yaw) * THROW_AIM - release.x, z: from.z + Math.cos(yaw) * THROW_AIM - release.z };
  const length = Math.hypot(aim.x, aim.z);
  return length > 0.5 ? { x: aim.x / length, z: aim.z / length } : { x: Math.sin(yaw), z: Math.cos(yaw) };
}
/**
 * Charged strikes (J punches, K kicks; manifest `strike`, seconds into the clip): the clip plays to `ready`; while
 * the key stays down the charge moves it from `ready` towards `windup` (the fist or leg drawing back, see
 * strikeAmount); on release it jumps to the same pose in the swing (`strikeLaunch`, between `windup` and `release`)
 * and plays on, and at `hit` the striking bone pushes what is in front of it. punch_ual is UAL's Punch_Cross with
 * an added pull-back; neither library has a kick, so `kick` is a procedural ball kick. As with the throw, the rig's
 * side names are mirrored: hand_L and foot_L are the character's right hand and foot.
 */
export type StrikeKind = 'punch' | 'kick';
export type StrikeSpec = { clip: string; bone: string; ready: number; windup: number; release: number; hit: number; reach: number };
export const STRIKES: Readonly<Record<StrikeKind, StrikeSpec>> = {
  punch: { clip: 'punch_ual', bone: 'hand_L', ready: 0.26666666666666666, windup: 0.7333333333333333, release: 0.8333333333333334, hit: 1.0333333333333334, reach: 0.15 },
  kick: { clip: 'kick', bone: 'foot_L', ready: 0.22, windup: 0.67, release: 0.78, hit: 0.8350000000000001, reach: 0.25 },
};
/** How far the limb has drawn back (0…1) after charging for `held` seconds: quick at first, straining towards the end. */
export function strikeAmount(held: number): number {
  const charge = Math.min(Math.max(held / STRIKE_CHARGE, 0), 1);
  return 1 - (1 - charge) ** 2;
}
/** Clip time of the charge pose for `held` seconds of holding. */
export function strikeCharge(spec: StrikeSpec, held: number): number {
  return spec.ready + strikeAmount(held) * (spec.windup - spec.ready);
}
/** Clip time in the swing with the same pose as strikeCharge(spec, held): where the blow continues on release. */
export function strikeLaunch(spec: StrikeSpec, held: number): number {
  return spec.release - strikeAmount(held) * (spec.release - spec.windup);
}
/** Seconds of holding that charge a strike fully; a tap strikes at power STRIKE_MIN_POWER. */
export const STRIKE_CHARGE = 1.2;
export const STRIKE_MIN_POWER = 0.25;
/** Power of a strike (STRIKE_MIN_POWER … 1) after charging for `held` seconds. */
export function strikePower(held: number): number {
  const charge = Math.min(Math.max(held / STRIKE_CHARGE, 0), 1);
  return STRIKE_MIN_POWER + (1 - STRIKE_MIN_POWER) * charge;
}
/** The character moves this many times faster than the clips were authored for; the clips play faster to keep the feet planted. */
export const SPEED_SCALE = 2;
export const WALK_SPEED = WALK_CLIP_SPEED * SPEED_SCALE;
export const RUN_SPEED = RUN_CLIP_SPEED * SPEED_SCALE;
/** The in-place jump clip (rig manifest): its length, the fraction with the feet off the floor and the hop length. */
export const JUMP: JumpSpec = { duration: 0.8, air: [0.26, 0.7], distance: 0.45 };
/** Peak height of the feet during the jump, for what the character touches in the air (the clip draws the hop itself). */
export const JUMP_HEIGHT = 0.55;
/** A jump started while moving keeps the ground speed and skips most of the crouch: the clip starts this long before take-off. */
export const MOVING_JUMP_LEAD = 0.06;
/** Seconds a moving jump stays in its landing before the walk or run takes over again (keys still held). */
export const LANDING_HOLD = 0.06;
export const CHARACTER_RADIUS = 0.3;
export const MAX_STEP = 0.05;

export type MoveIntent = { forward: number; right: number; run: boolean };
export type Locomotion = 'idle' | 'walk' | 'run' | 'jump';

/**
 * Kinematic ground controller on the XZ plane (three.js Y-up; the character faces +Z at yaw 0).
 * Input is relative to the camera: `forward` follows the view direction projected on the floor.
 */
export class CharacterController {
  position: Point2;
  yaw: number;
  speed = 0;
  /** Authored ground speeds of the clips that play while walking and running (procedural or an alternative). */
  walkClipSpeed = WALK_CLIP_SPEED;
  runClipSpeed = RUN_CLIP_SPEED;
  /** Timing of the jump clip in use (procedural or an alternative); only changes between jumps. */
  jumpSpec: JumpSpec = JUMP;
  readonly radius: number;
  private readonly spawn: { position: Point2; yaw: number };
  private readonly boxes: readonly Box2[];
  private readonly floor: Floor;
  /** Seconds into the current jump, or undefined on the ground. */
  private jumpTime?: number;
  private jumpSpeed = 0;
  /** The jump was started while walking or running: it keeps going and ends at landing if keys are still held. */
  private movingJump = false;

  constructor(spawn: { position: Point2; yaw: number }, boxes: readonly Box2[], floor: Floor, radius = CHARACTER_RADIUS) {
    this.spawn = { position: { ...spawn.position }, yaw: spawn.yaw };
    this.boxes = boxes;
    this.floor = floor;
    this.radius = radius;
    this.position = { ...spawn.position };
    this.yaw = spawn.yaw;
  }

  reset(): void {
    this.position = { ...this.spawn.position };
    this.yaw = this.spawn.yaw;
    this.speed = 0;
    this.jumpTime = undefined;
    this.movingJump = false;
  }

  get jumping(): boolean {
    return this.jumpTime !== undefined;
  }

  /**
   * Jump along the current facing; refused while already in the air. Standing, it is a hop that covers its
   * distance while airborne. Moving, it keeps the walk or run speed throughout, starts just before take-off
   * (see `jumpStart`) and hands back to the walk or run on landing while keys are held.
   */
  jump(): boolean {
    if (this.jumping) return false;
    const jump = this.jumpSpec;
    const air = (jump.air[1] - jump.air[0]) * jump.duration;
    this.movingJump = this.speed > 0.3;
    this.jumpTime = this.movingJump ? Math.max(0, jump.air[0] * jump.duration - MOVING_JUMP_LEAD) : 0;
    this.jumpSpeed = Math.max(jump.distance / air, this.speed);
    if (!this.movingJump) this.speed = 0;
    return true;
  }

  /** Seconds into the jump clip where the current jump started (the viewer starts the clip there). */
  get jumpStart(): number {
    return this.movingJump ? Math.max(0, this.jumpSpec.air[0] * this.jumpSpec.duration - MOVING_JUMP_LEAD) : 0;
  }

  /** Direction on the floor for an intent, given the camera azimuth (radians around +Y, 0 = looking from +Z). */
  static direction(intent: MoveIntent, cameraAzimuth: number): Point2 {
    // Camera looks towards -(sin a, cos a); screen-right is (cos a, -sin a).
    const fx = -Math.sin(cameraAzimuth);
    const fz = -Math.cos(cameraAzimuth);
    const x = fx * intent.forward + Math.cos(cameraAzimuth) * intent.right;
    const z = fz * intent.forward - Math.sin(cameraAzimuth) * intent.right;
    const length = Math.hypot(x, z);
    return length > 1e-6 ? { x: x / length, z: z / length } : { x: 0, z: 0 };
  }

  update(dt: number, intent: MoveIntent, cameraAzimuth: number): Locomotion {
    const step = Math.min(Math.max(dt, 0), MAX_STEP);
    if (this.jumpTime !== undefined) return this.hop(step, intent, cameraAzimuth);
    const direction = CharacterController.direction(intent, cameraAzimuth);
    const moving = direction.x !== 0 || direction.z !== 0;
    const target = moving ? (intent.run ? RUN_SPEED : WALK_SPEED) : 0;
    // Exponential approach: quick but not instant starts and stops, independent of frame rate.
    this.speed += (target - this.speed) * (1 - Math.exp(-step * 10));
    if (!moving && this.speed < 0.02) this.speed = 0;
    if (moving) {
      const desired = Math.atan2(direction.x, direction.z);
      let turn = desired - this.yaw;
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      this.yaw += turn * (1 - Math.exp(-step * 14));
    }
    if (this.speed > 0) {
      const heading = moving ? direction : { x: Math.sin(this.yaw), z: Math.cos(this.yaw) };
      const delta = { x: heading.x * this.speed * step, z: heading.z * this.speed * step };
      this.position = sweep(this.position, delta, this.radius, this.boxes, this.floor);
    }
    return this.locomotion();
  }

  /**
   * A standing jump's crouch and landing stay in place; the forward motion happens while the feet are off the
   * floor. A moving jump also keeps its ground speed before take-off and, after landing, either hands back to
   * the walk or run (keys held) or slows to a stop.
   */
  private hop(step: number, intent: MoveIntent, cameraAzimuth: number): Locomotion {
    const start = this.jumpTime!;
    const { duration, air } = this.jumpSpec;
    const end = Math.min(start + step, duration);
    const [takeOff, landing] = air.map((fraction) => fraction * duration);
    const airborne = Math.max(0, Math.min(end, landing) - Math.max(start, takeOff));
    let travel = this.jumpSpeed * airborne;
    if (this.movingJump) {
      const grounded = end - start - airborne;
      if (end > landing) {
        const direction = CharacterController.direction(intent, cameraAzimuth);
        const moving = direction.x !== 0 || direction.z !== 0;
        if (moving && end >= landing + LANDING_HOLD) {
          // Keys still held: back to the walk or run at the speed the jump carried (update() adjusts it from there).
          this.jumpTime = undefined;
          this.movingJump = false;
          return this.locomotion();
        }
        if (!moving) this.speed *= Math.exp(-grounded * 8);
      }
      travel += this.speed * grounded;
    }
    if (travel > 0) {
      this.position = sweep(this.position, { x: Math.sin(this.yaw) * travel, z: Math.cos(this.yaw) * travel }, this.radius, this.boxes, this.floor);
    }
    this.jumpTime = end >= duration ? undefined : end;
    if (!this.jumping) {
      this.movingJump = false;
      if (this.speed < 0.05) this.speed = 0;
    }
    return this.jumping ? 'jump' : this.locomotion();
  }

  /** Whether the feet are off the floor right now (the character cannot enter sign zones mid-air). */
  get airborne(): boolean {
    if (this.jumpTime === undefined) return false;
    const { duration, air } = this.jumpSpec;
    const fraction = this.jumpTime / duration;
    return fraction > air[0] && fraction < air[1];
  }

  /** Height of the feet above the floor right now: an arc while airborne, 0 otherwise. */
  get lift(): number {
    if (!this.airborne) return 0;
    const { duration, air } = this.jumpSpec;
    const fraction = (this.jumpTime! / duration - air[0]) / (air[1] - air[0]);
    return JUMP_HEIGHT * Math.sin(Math.PI * fraction);
  }

  locomotion(): Locomotion {
    if (this.jumping) return 'jump';
    if (this.speed < 0.05) return 'idle';
    return this.speed > (WALK_SPEED + RUN_SPEED) / 2 ? 'run' : 'walk';
  }

  /** Playback rate that keeps the clip's feet matched to the actual ground speed. */
  clipRate(): number {
    const clipSpeed = this.locomotion() === 'run' ? this.runClipSpeed : this.walkClipSpeed;
    return this.jumping || this.speed < 0.05 ? 1 : Math.min(Math.max(this.speed / clipSpeed, 0.5), 1.25 * SPEED_SCALE);
  }
}
