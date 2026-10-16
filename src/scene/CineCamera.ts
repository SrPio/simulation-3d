import { PerspectiveCamera, Vector3 } from 'three';

/**
 * Camera shots for recording videos of the room page (`?cine`): a perspective camera that frames the character
 * from close, far, low, above, beside or round it, while the game's isometric camera keeps running underneath
 * (the keys still move the character relative to it). Offsets are in the shot's frame: x to the right, y up,
 * z forwards, where forwards is the character's facing (smoothed), a fixed world direction or a turning angle.
 */
export type CineShot = 'face' | 'shoulder' | 'low' | 'top' | 'side' | 'wide' | 'orbit' | 'push' | 'pull' | 'quarter';

/** The shots in the order of the number keys 1…9 (the three-quarter shot is on Q). */
export const CINE_SHOTS: readonly CineShot[] = ['face', 'shoulder', 'low', 'top', 'side', 'wide', 'orbit', 'push', 'pull'];

export type Frame = 'follow' | 'fixed' | 'world' | 'spin';
type Triple = readonly [number, number, number];

interface ShotSpec {
  frame: Frame;
  /** Where the camera stands, in the frame (x right, y up, z forwards), from the character's feet. */
  offset: Triple;
  /** Where it looks, in the same frame. */
  aim: Triple;
  /** Vertical field of view in degrees. */
  fov: number;
  /** How fast the camera catches up with the moving character (1/s). */
  rate: number;
  /** For push and pull: the offset and aim at the end of the move, reached after `travel` seconds. */
  to?: { offset: Triple; aim: Triple; fov: number };
  travel?: number;
  /** Looking straight down: the top of the picture is the character's facing. */
  overhead?: boolean;
}

/** The character is 2.67 m tall with the eyes at 2.24 m. */
export const SHOTS: Readonly<Record<CineShot, ShotSpec>> = {
  face: { frame: 'follow', offset: [0.6, 2.2, 2.7], aim: [0, 2.0, 0], fov: 36, rate: 3 },
  shoulder: { frame: 'follow', offset: [1.1, 3.4, -3.4], aim: [0, 1.4, 5], fov: 50, rate: 3.5 },
  low: { frame: 'follow', offset: [1.4, 0.3, 2.7], aim: [0, 1.75, 0], fov: 52, rate: 3 },
  top: { frame: 'follow', offset: [0, 9, 0], aim: [0, 0, 0], fov: 42, rate: 3, overhead: true },
  // In front and to the right, wide enough that a running character stays in the picture.
  quarter: { frame: 'follow', offset: [4.5, 3.2, 6.5], aim: [0, 1.1, 1], fov: 45, rate: 3.5 },
  side: { frame: 'follow', offset: [6, 1.7, 0.2], aim: [0, 1.35, 0.2], fov: 42, rate: 4 },
  // From the isometric corner, higher and further than the game camera.
  wide: { frame: 'world', offset: [0, 15, -22], aim: [0, 1, 0], fov: 40, rate: 2 },
  orbit: { frame: 'spin', offset: [0, 2.7, -6.5], aim: [0, 1.5, 0], fov: 42, rate: 4 },
  push: {
    frame: 'fixed', offset: [2.2, 4.5, 10], aim: [0, 1.4, 0], fov: 40, rate: 4,
    to: { offset: [0.5, 2.3, 2.6], aim: [0, 2, 0], fov: 32 }, travel: 6,
  },
  pull: {
    frame: 'fixed', offset: [0.5, 2.3, 2.6], aim: [0, 2, 0], fov: 32, rate: 4,
    to: { offset: [3, 17, 20], aim: [0, 0.5, 0], fov: 42 }, travel: 7,
  },
};

/** Glide between two shots (seconds); a cut jumps at once. */
export const CINE_GLIDE = 1.4;
/** The orbit's turn (rad/s). */
export const ORBIT_SPEED = 0.3;
/** How fast a following shot turns with the character's facing (1/s): slow, so turns sweep rather than jerk. */
export const YAW_RATE = 1.6;
/** The isometric game camera looks from +X+Z; the wide shot looks from the same corner. */
export const WORLD_YAW = -3 * Math.PI / 4;

export interface CinePose {
  position: Vector3;
  aim: Vector3;
  up: Vector3;
  fov: number;
}

/** Shortest signed turn from a to b. */
export function turnBetween(a: number, b: number): number {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}

const smooth = (t: number) => t * t * (3 - 2 * t);

function lerpTriple(a: Triple, b: Triple, t: number): Triple {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** A frame offset turned to world space: forwards is (sin yaw, 0, cos yaw) and right is (-cos yaw, 0, sin yaw). */
export function frameToWorld(offset: Triple, yaw: number, origin: Vector3, out = new Vector3()): Vector3 {
  const [x, y, z] = offset;
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  return out.set(origin.x + z * s - x * c, origin.y + y, origin.z + z * c + x * s);
}

/** Where a shot wants the camera now: `elapsed` seconds into it, the frame turned to `yaw`, round the character at `subject`. */
export function shotPose(shot: CineShot, subject: Vector3, yaw: number, elapsed: number): CinePose {
  const spec = SHOTS[shot];
  let { offset, aim, fov } = spec;
  if (spec.to && spec.travel) {
    const t = smooth(Math.min(Math.max(elapsed / spec.travel, 0), 1));
    offset = lerpTriple(spec.offset, spec.to.offset, t);
    aim = lerpTriple(spec.aim, spec.to.aim, t);
    fov = spec.fov + (spec.to.fov - spec.fov) * t;
  }
  const up = spec.overhead ? new Vector3(Math.sin(yaw), 0, Math.cos(yaw)) : new Vector3(0, 1, 0);
  return { position: frameToWorld(offset, yaw, subject), aim: frameToWorld(aim, yaw, subject), up, fov };
}

/** The frame's turn for a shot: the character's (smoothed) facing, a fixed one, the world corner or the orbit. */
export function frameYaw(frame: Frame, facing: number, fixed: number, elapsed: number): number {
  if (frame === 'world') return WORLD_YAW;
  if (frame === 'spin') return fixed + elapsed * ORBIT_SPEED;
  if (frame === 'fixed') return fixed;
  return facing;
}

/**
 * The recording camera. `update` once a frame with the character's feet and facing; `render` with `camera`.
 * Shots glide into each other (or cut), follow the character with damping, and with reduced motion jump at once.
 * `freeze` keeps the camera where it is and only turns it to the character, for shots where it runs past.
 */
export class CineCamera {
  readonly camera = new PerspectiveCamera(40, 9 / 16, 0.05, 600);
  shot: CineShot = 'face';
  cut = false;
  frozen = false;
  private elapsed = 0;
  private yaw = 0;
  private fixedYaw = 0;
  private started = false;
  private glide = 0;
  private from?: CinePose;
  private readonly position = new Vector3();
  private readonly aim = new Vector3();
  private readonly up = new Vector3(0, 1, 0);
  private fov = 40;

  /** Start a shot. From the game view (`fromGame`) or in cut mode it starts at once; otherwise it glides from the current pose. */
  setShot(shot: CineShot, fromGame: boolean, facing: number): void {
    const glide = this.started && !fromGame && !this.cut;
    this.from = glide ? { position: this.position.clone(), aim: this.aim.clone(), up: this.up.clone(), fov: this.fov } : undefined;
    this.glide = glide ? CINE_GLIDE : 0;
    this.shot = shot;
    this.elapsed = 0;
    this.frozen = false;
    // The orbit starts from where the camera is now, so it turns on from there.
    const current = Math.atan2(this.aim.x - this.position.x, this.aim.z - this.position.z);
    this.fixedYaw = shot === 'orbit' && this.started ? current : facing;
    if (!this.started) this.yaw = facing;
    if (!glide) this.started = false;
  }

  update(delta: number, subject: Vector3, facing: number, reducedMotion: boolean): void {
    const spec = SHOTS[this.shot];
    this.elapsed += delta;
    this.yaw = !this.started || reducedMotion ? facing : this.yaw + turnBetween(this.yaw, facing) * (1 - Math.exp(-delta * YAW_RATE));
    const goal = shotPose(this.shot, subject, frameYaw(spec.frame, this.yaw, this.fixedYaw, this.elapsed), this.elapsed);
    if (!this.started || reducedMotion) {
      this.position.copy(goal.position);
      this.aim.copy(goal.aim);
      this.up.copy(goal.up);
      this.fov = goal.fov;
      this.started = true;
      this.from = undefined;
      this.glide = 0;
    } else if (this.from && this.glide > 0) {
      // Gliding: the blend runs from the old pose to the new shot's live goal.
      this.glide = Math.max(this.glide - delta, 0);
      const t = smooth(1 - this.glide / CINE_GLIDE);
      this.position.lerpVectors(this.from.position, goal.position, t);
      this.aim.lerpVectors(this.from.aim, goal.aim, t);
      this.up.lerpVectors(this.from.up, goal.up, t).normalize();
      this.fov = this.from.fov + (goal.fov - this.from.fov) * t;
      if (this.glide === 0) this.from = undefined;
    } else {
      const k = 1 - Math.exp(-delta * spec.rate);
      if (!this.frozen) this.position.lerp(goal.position, k);
      this.aim.lerp(this.frozen ? subject.clone().setY(subject.y + 1.5) : goal.aim, k);
      this.up.lerp(goal.up, k).normalize();
      this.fov += (goal.fov - this.fov) * k;
    }
    const camera = this.camera;
    camera.position.copy(this.position);
    camera.up.copy(this.up);
    camera.lookAt(this.aim);
    if (Math.abs(camera.fov - this.fov) > 1e-4) {
      camera.fov = this.fov;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
