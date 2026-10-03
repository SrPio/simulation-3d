import type { Body as BodyType, World as WorldType } from 'cannon-es';

type Cannon = typeof import('cannon-es');
type Vec = { x: number; y: number; z: number };
type Quat = Vec & { w: number };

/** A letter at rest: where it stands and the half sizes of its box (width, height, depth). */
export type LetterBody = { position: Vec; quaternion: Quat; half: [number, number, number] };
/** Something letters bounce off: a box turned about +Y (posts, the room platform). */
export type StaticBox = { center: Vec; half: [number, number, number]; yaw: number };

/** Character as a capsule of two spheres pushing the letters; feet at `y`, `height` lifts it during a jump. */
export type Pusher = { x: number; y: number; z: number };

export const LETTER_MASS = 1.5;
const STEP = 1 / 60;
const MAX_SUBSTEPS = 3;
const PUSHER_RADIUS = 0.3;
const PUSHER_SPHERES = [0.55, 1.1];
/** The world only steps when a letter is awake or the character is this close to one. */
const WAKE_DISTANCE = 1.6;
const STRAY_DISTANCE = 30;

/**
 * Letters of the name as rigid boxes (cannon-es). They start asleep and cost nothing until the
 * character, a kinematic capsule driven by the controller, walks into them; then they topple, bump
 * each other and settle back to sleep. The world is skipped entirely while nothing is near or moving.
 */
export class LetterPhysics {
  readonly world: WorldType;
  readonly bodies: BodyType[] = [];
  private readonly cannon: Cannon;
  private readonly rest: LetterBody[];
  private readonly pusher: BodyType;
  private readonly groundY: number;
  private idle = true;

  static async load(letters: readonly LetterBody[], statics: readonly StaticBox[], groundY: number): Promise<LetterPhysics> {
    return new LetterPhysics(await import('cannon-es'), letters, statics, groundY);
  }

  constructor(cannon: Cannon, letters: readonly LetterBody[], statics: readonly StaticBox[], groundY: number) {
    const { Body, Box, ContactMaterial, Material, Plane, Sphere, Vec3, World } = cannon;
    this.cannon = cannon;
    // Copied field by field: three.js vectors and quaternions keep their values in accessors.
    this.rest = letters.map(({ position: p, quaternion: q, half }) => ({
      position: { x: p.x, y: p.y, z: p.z }, quaternion: { x: q.x, y: q.y, z: q.z, w: q.w }, half,
    }));
    this.groundY = groundY;
    this.world = new World({ gravity: new Vec3(0, -9.82, 0), allowSleep: true });
    const letterMaterial = new Material('letter');
    const groundMaterial = new Material('ground');
    this.world.addContactMaterial(new ContactMaterial(letterMaterial, groundMaterial, { friction: 0.6, restitution: 0.15 }));
    this.world.addContactMaterial(new ContactMaterial(letterMaterial, letterMaterial, { friction: 0.4, restitution: 0.1 }));
    const ground = new Body({ type: Body.STATIC, shape: new Plane(), material: groundMaterial });
    ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    ground.position.set(0, groundY, 0);
    this.world.addBody(ground);
    for (const box of statics) {
      const body = new Body({ type: Body.STATIC, shape: new Box(new Vec3(...box.half)), material: groundMaterial });
      body.position.set(box.center.x, box.center.y, box.center.z);
      body.quaternion.setFromEuler(0, box.yaw, 0);
      this.world.addBody(body);
    }
    for (const letter of this.rest) {
      const body = new Body({ mass: LETTER_MASS, shape: new Box(new Vec3(...letter.half)), material: letterMaterial });
      body.allowSleep = true;
      body.sleepSpeedLimit = 0.08;
      body.sleepTimeLimit = 0.6;
      body.angularDamping = 0.15;
      this.world.addBody(body);
      this.bodies.push(body);
    }
    this.pusher = new Body({ type: Body.KINEMATIC });
    for (const y of PUSHER_SPHERES) this.pusher.addShape(new Sphere(PUSHER_RADIUS), new Vec3(0, y, 0));
    this.pusher.allowSleep = false;
    this.world.addBody(this.pusher);
    this.reset();
  }

  /** Every letter back where it stood, still and asleep. */
  reset(): void {
    for (const [index, body] of this.bodies.entries()) this.place(body, this.rest[index]);
  }

  private place(body: BodyType, rest: LetterBody): void {
    body.position.set(rest.position.x, rest.position.y, rest.position.z);
    body.quaternion.set(rest.quaternion.x, rest.quaternion.y, rest.quaternion.z, rest.quaternion.w);
    body.velocity.setZero();
    body.angularVelocity.setZero();
    body.sleep();
  }

  /** Whether any letter is moving. */
  get active(): boolean {
    return this.bodies.some((body) => body.sleepState !== this.cannon.Body.SLEEPING);
  }

  private near(pusher: Pusher): boolean {
    return this.bodies.some((body) => Math.hypot(body.position.x - pusher.x, body.position.z - pusher.z) < WAKE_DISTANCE);
  }

  /** Advance by `delta` seconds with the character at `pusher`. Returns false when the world was skipped. */
  step(delta: number, pusher: Pusher | undefined): boolean {
    const close = pusher !== undefined && this.near(pusher);
    if (!close && !this.active) {
      this.idle = true;
      return false;
    }
    if (pusher) {
      const body = this.pusher;
      if (this.idle || delta <= 0) {
        // Back near the letters after a while: appear there instead of sweeping across the ground.
        body.position.set(pusher.x, pusher.y, pusher.z);
        body.velocity.setZero();
      } else {
        // Kinematic: moved by its velocity, which is what pushes the letters it touches.
        const scale = 1 / Math.max(delta, STEP);
        body.velocity.set((pusher.x - body.position.x) * scale, (pusher.y - body.position.y) * scale, (pusher.z - body.position.z) * scale);
      }
    }
    this.idle = false;
    this.world.step(STEP, Math.min(delta, STEP * MAX_SUBSTEPS), MAX_SUBSTEPS);
    for (const [index, body] of this.bodies.entries()) {
      // A letter knocked far away or through the ground comes back to its place.
      const rest = this.rest[index];
      if (body.position.y < this.groundY - 2 || Math.hypot(body.position.x - rest.position.x, body.position.z - rest.position.z) > STRAY_DISTANCE) this.place(body, rest);
    }
    return true;
  }

  /** How many letters lie toppled (tilted more than 45 degrees). */
  fallen(): number {
    let count = 0;
    for (const body of this.bodies) {
      const q = body.quaternion;
      // Y component of the letter's up axis.
      const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
      if (upY < Math.SQRT1_2) count++;
    }
    return count;
  }
}
