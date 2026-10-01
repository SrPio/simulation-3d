import { sweep, type Box2, type Point2 } from '../world/collisions.ts';

/** Ground speeds (m/s) the in-place walk/run clips were authored for (see the rig manifest). */
export const WALK_SPEED = 0.7;
export const RUN_SPEED = 2.131578947368421;
export const CHARACTER_RADIUS = 0.3;
export const MAX_STEP = 0.05;

export type MoveIntent = { forward: number; right: number; run: boolean };
export type Locomotion = 'idle' | 'walk' | 'run';

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
  private readonly halfSize: number;

  constructor(spawn: { position: Point2; yaw: number }, boxes: readonly Box2[], halfSize: number, radius = CHARACTER_RADIUS) {
    this.spawn = { position: { ...spawn.position }, yaw: spawn.yaw };
    this.boxes = boxes;
    this.halfSize = halfSize;
    this.radius = radius;
    this.position = { ...spawn.position };
    this.yaw = spawn.yaw;
  }

  reset(): void {
    this.position = { ...this.spawn.position };
    this.yaw = this.spawn.yaw;
    this.speed = 0;
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
      this.position = sweep(this.position, delta, this.radius, this.boxes, this.halfSize);
    }
    return this.locomotion();
  }

  locomotion(): Locomotion {
    if (this.speed < 0.05) return 'idle';
    return this.speed > (WALK_SPEED + RUN_SPEED) / 2 ? 'run' : 'walk';
  }

  /** Playback rate that keeps the clip's feet matched to the actual ground speed. */
  clipRate(): number {
    const clipSpeed = this.locomotion() === 'run' ? RUN_SPEED : WALK_SPEED;
    return this.speed < 0.05 ? 1 : Math.min(Math.max(this.speed / clipSpeed, 0.5), 1.25);
  }
}
