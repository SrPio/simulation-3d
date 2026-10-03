import { sweep, type Box2, type Floor, type Point2 } from '../world/collisions.ts';

/** Ground speeds (m/s) the in-place walk/run clips were authored for (see the rig manifest). */
export const WALK_SPEED = 0.8035714285714285;
export const RUN_SPEED = 2.131578947368421;
/** The in-place jump clip (rig manifest): its length, the fraction with the feet off the floor and the hop length. */
export const JUMP = { duration: 0.8, air: [0.26, 0.7] as [number, number], distance: 0.45 };
/** Peak height of the feet during the jump, for what the character touches in the air (the clip draws the hop itself). */
export const JUMP_HEIGHT = 0.4;
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
  readonly radius: number;
  private readonly spawn: { position: Point2; yaw: number };
  private readonly boxes: readonly Box2[];
  private readonly floor: Floor;
  /** Seconds into the current jump, or undefined on the ground. */
  private jumpTime?: number;
  private jumpSpeed = 0;

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
  }

  get jumping(): boolean {
    return this.jumpTime !== undefined;
  }

  /** Start a short forward hop along the current facing; refused while already in the air. */
  jump(): boolean {
    if (this.jumping) return false;
    this.jumpTime = 0;
    // The hop covers JUMP.distance while airborne; a run carries some of its extra speed into it.
    const air = (JUMP.air[1] - JUMP.air[0]) * JUMP.duration;
    this.jumpSpeed = Math.max(JUMP.distance / air, this.speed * 0.8);
    this.speed = 0;
    return true;
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
    if (this.jumpTime !== undefined) return this.hop(step);
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

  /** Crouch and landing stay in place; the forward motion happens while the feet are off the floor. */
  private hop(step: number): Locomotion {
    const start = this.jumpTime!;
    const end = Math.min(start + step, JUMP.duration);
    const [takeOff, landing] = JUMP.air.map((fraction) => fraction * JUMP.duration);
    const airborne = Math.max(0, Math.min(end, landing) - Math.max(start, takeOff));
    if (airborne > 0) {
      const travel = this.jumpSpeed * airborne;
      this.position = sweep(this.position, { x: Math.sin(this.yaw) * travel, z: Math.cos(this.yaw) * travel }, this.radius, this.boxes, this.floor);
    }
    this.jumpTime = end >= JUMP.duration ? undefined : end;
    return this.jumping ? 'jump' : 'idle';
  }

  /** Whether the feet are off the floor right now (the character cannot enter sign zones mid-air). */
  get airborne(): boolean {
    if (this.jumpTime === undefined) return false;
    const fraction = this.jumpTime / JUMP.duration;
    return fraction > JUMP.air[0] && fraction < JUMP.air[1];
  }

  /** Height of the feet above the floor right now: an arc while airborne, 0 otherwise. */
  get lift(): number {
    if (!this.airborne) return 0;
    const fraction = (this.jumpTime! / JUMP.duration - JUMP.air[0]) / (JUMP.air[1] - JUMP.air[0]);
    return JUMP_HEIGHT * Math.sin(Math.PI * fraction);
  }

  locomotion(): Locomotion {
    if (this.jumping) return 'jump';
    if (this.speed < 0.05) return 'idle';
    return this.speed > (WALK_SPEED + RUN_SPEED) / 2 ? 'run' : 'walk';
  }

  /** Playback rate that keeps the clip's feet matched to the actual ground speed. */
  clipRate(): number {
    const clipSpeed = this.locomotion() === 'run' ? RUN_SPEED : WALK_SPEED;
    return this.jumping || this.speed < 0.05 ? 1 : Math.min(Math.max(this.speed / clipSpeed, 0.5), 1.25);
  }
}
