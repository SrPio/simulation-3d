import type { Body as BodyType, HingeConstraint as HingeType, Material as MaterialType, World as WorldType } from 'cannon-es';
import { LETTER_MASS, type PieceGroup, type PieceShape } from '../scene/outsideData.ts';

type Cannon = typeof import('cannon-es');
type Vec = { x: number; y: number; z: number };
type Quat = Vec & { w: number };

/** A piece at rest: where it stands, the half sizes of its box (width, height, depth) and, optionally, another shape, its mass and group. */
export type PieceBody = { position: Vec; quaternion: Quat; half: [number, number, number]; shape?: PieceShape; mass?: number; group?: PieceGroup };
/** Something pieces bounce off: a box turned about +Y (sign boards, the room platform, furniture, walls). */
export type StaticBox = { center: Vec; half: [number, number, number]; yaw: number };
/** Character feet; a kinematic capsule of spheres above them pushes the pieces. */
export type Pusher = { x: number; y: number; z: number };

/** Thrown laptop: a base and a lid joined by a hinge along the base's back edge. */
export const LAPTOP = { width: 0.48, depth: 0.32, base: 0.022, lid: 0.012, baseMass: 1, lidMass: 0.4 } as const;
/** The lid opens up to here (radians, a laptop's own stop) and no further back; 0 is closed on the keys. */
export const LID_LIMIT = Math.PI * 0.75;
/** The closed stop: a hair below 0 so a lid resting on the keys can settle; its front edge stays above them. */
export const LID_CLOSED = -0.02;
export type ThrownLaptop = { base: BodyType; lid: BodyType; hinge: HingeType; born: number };
/** At most this many thrown laptops at once: the next throw retires the oldest. */
export const MAX_THROWN = 3;

const STEP = 1 / 60;
const MAX_SUBSTEPS = 3;
const PUSHER_RADIUS = 0.3;
// Low enough to shove the flat tagline pieces, high enough to tip the standing letters and pins over.
const PUSHER_SPHERES = [0.3, 0.75, 1.2];
/** The world only steps when a piece is awake or the character is this close to one. */
const WAKE_DISTANCE = 1.6;
const STRAY_DISTANCE = 30;
/** Strikes: what lies within this distance of the fist or foot (to its bounds) is hit, leaving at these speeds (m/s, by power) and partly upwards. */
export const STRIKE_RADIUS = 0.45;
export const STRIKE_SPEED = { min: 1.5, max: 9 };
const STRIKE_LIFT = 0.35;

type Settings = { material: string; sleepSpeed: number; angularDamping: number; linearDamping: number };
const SETTINGS: Record<PieceGroup | 'laptop', Settings> = {
  // Generous sleep limits: a letter resting against another keeps a faint rocking that must still count as asleep.
  name: { material: 'letter', sleepSpeed: 0.2, angularDamping: 0.5, linearDamping: 0.1 },
  tag: { material: 'letter', sleepSpeed: 0.2, angularDamping: 0.5, linearDamping: 0.1 },
  keys: { material: 'letter', sleepSpeed: 0.2, angularDamping: 0.5, linearDamping: 0.1 },
  bricks: { material: 'brick', sleepSpeed: 0.15, angularDamping: 0.4, linearDamping: 0.1 },
  bowling: { material: 'pin', sleepSpeed: 0.15, angularDamping: 0.4, linearDamping: 0.1 },
  laptop: { material: 'laptop', sleepSpeed: 0.15, angularDamping: 0.3, linearDamping: 0.05 },
};
/** The ball rolls: it keeps less damping than the pins but still comes to rest on the flat ground. */
const BALL: Settings = { material: 'ball', sleepSpeed: 0.12, angularDamping: 0.12, linearDamping: 0.05 };
const CONTACTS: [string, string, number, number][] = [
  ['letter', 'ground', 0.6, 0.05], ['letter', 'letter', 0.4, 0.1],
  ['brick', 'ground', 0.7, 0.02], ['brick', 'brick', 0.65, 0.02],
  ['pin', 'ground', 0.3, 0.1], ['pin', 'pin', 0.2, 0.4], ['pin', 'ball', 0.1, 0.55],
  ['ball', 'ground', 0.4, 0.15], ['laptop', 'ground', 0.5, 0.15],
];

/**
 * Loose pieces as rigid bodies (cannon-es): the name letters, the arrow keys, the bowling pins and ball,
 * the bricks and thrown laptops. They start asleep and cost nothing until the character, a kinematic capsule
 * driven by the controller, walks into them (or something hits them); then they topple, bump each other and
 * settle back to sleep. The world is skipped entirely while nothing is near or moving.
 */
export class PropPhysics {
  readonly world: WorldType;
  /** One body per piece, in the order given. */
  readonly bodies: BodyType[] = [];
  readonly laptops: ThrownLaptop[] = [];
  /** Laptops taken out of the world (the oldest past MAX_THROWN, or fallen off) for the viewer to fade away; it empties the list. */
  readonly retired: ThrownLaptop[] = [];
  private readonly cannon: Cannon;
  private readonly rest: PieceBody[];
  private readonly groups: PieceGroup[];
  /** Balls roll: their tilt says nothing about being knocked over. */
  private readonly round: boolean[];
  private readonly pusher: BodyType;
  private readonly groundY: number;
  private readonly materials = new Map<string, MaterialType>();
  private idle = true;
  private clock = 0;

  static async load(pieces: readonly PieceBody[], statics: readonly StaticBox[], groundY: number): Promise<PropPhysics> {
    return new PropPhysics(await import('cannon-es'), pieces, statics, groundY);
  }

  constructor(cannon: Cannon, pieces: readonly PieceBody[], statics: readonly StaticBox[], groundY: number) {
    const { Body, Box, ContactMaterial, Cylinder, Material, Plane, SAPBroadphase, Sphere, Vec3, World } = cannon;
    this.cannon = cannon;
    // Copied field by field: three.js vectors and quaternions keep their values in accessors.
    this.rest = pieces.map(({ position: p, quaternion: q, half, shape, mass, group }) => ({
      position: { x: p.x, y: p.y, z: p.z }, quaternion: { x: q.x, y: q.y, z: q.z, w: q.w }, half, shape, mass, group,
    }));
    this.groups = this.rest.map((piece) => piece.group ?? 'name');
    this.round = this.rest.map((piece) => piece.shape?.kind === 'sphere');
    this.groundY = groundY;
    this.world = new World({ gravity: new Vec3(0, -9.82, 0), allowSleep: true });
    this.world.broadphase = new SAPBroadphase(this.world);
    // More solver passes: thin pieces resting on an edge and stacked bricks settle and sleep instead of rocking forever.
    (this.world.solver as unknown as { iterations: number }).iterations = 20;
    for (const name of ['ground', 'letter', 'brick', 'pin', 'ball', 'laptop']) this.materials.set(name, new Material(name));
    this.world.defaultContactMaterial.friction = 0.4;
    this.world.defaultContactMaterial.restitution = 0.1;
    for (const [a, b, friction, restitution] of CONTACTS) {
      this.world.addContactMaterial(new ContactMaterial(this.materials.get(a)!, this.materials.get(b)!, { friction, restitution }));
    }
    const groundMaterial = this.materials.get('ground')!;
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
    for (const piece of this.rest) {
      const shape = piece.shape ?? { kind: 'box' };
      const settings = shape.kind === 'sphere' ? BALL : SETTINGS[piece.group ?? 'name'];
      const body = new Body({ mass: piece.mass ?? LETTER_MASS, material: this.materials.get(settings.material) });
      if (shape.kind === 'sphere') body.addShape(new Sphere(shape.radius));
      else if (shape.kind === 'cylinders') {
        // cannon-es cylinders stand along +Y like the pins.
        for (const part of shape.cylinders) body.addShape(new Cylinder(part.radius, part.radius, part.height, 10), new Vec3(0, part.y, 0));
      } else body.addShape(new Box(new Vec3(...piece.half)));
      this.configure(body, settings);
      this.world.addBody(body);
      this.bodies.push(body);
    }
    this.pusher = new Body({ type: Body.KINEMATIC });
    for (const y of PUSHER_SPHERES) this.pusher.addShape(new Sphere(PUSHER_RADIUS), new Vec3(0, y, 0));
    this.pusher.allowSleep = false;
    this.world.addBody(this.pusher);
    this.world.addEventListener('postStep', this.limitLids);
    this.reset();
  }

  private configure(body: BodyType, settings: Settings): void {
    body.allowSleep = true;
    body.sleepSpeedLimit = settings.sleepSpeed;
    body.sleepTimeLimit = 0.6;
    // Damping settles thin pieces balanced on an edge instead of letting them rock forever.
    body.angularDamping = settings.angularDamping;
    body.linearDamping = settings.linearDamping;
  }

  /** Every piece (or every piece of one group) back where it stood, still and asleep; a full reset also removes thrown laptops. */
  reset(group?: PieceGroup): void {
    for (const [index, body] of this.bodies.entries()) {
      if (!group || this.groups[index] === group) this.place(body, this.rest[index]);
    }
    if (!group) {
      for (const laptop of [...this.laptops]) this.removeLaptop(laptop);
      this.retired.length = 0;
    }
  }

  private place(body: BodyType, rest: PieceBody): void {
    body.position.set(rest.position.x, rest.position.y, rest.position.z);
    body.quaternion.set(rest.quaternion.x, rest.quaternion.y, rest.quaternion.z, rest.quaternion.w);
    body.velocity.setZero();
    body.angularVelocity.setZero();
    body.sleep();
  }

  /**
   * A laptop leaving the hand: `pose` is the base's centre and orientation (the lid closed on it), `velocity`
   * its launch speed and `spin` its angular velocity. The lid starts closed and swings on its own.
   */
  throwLaptop(pose: { position: Vec; quaternion: Quat }, velocity: Vec, spin: Vec, lidSpin = 0): ThrownLaptop {
    const { Body, Box, HingeConstraint, Quaternion, Vec3 } = this.cannon;
    while (this.laptops.length >= MAX_THROWN) this.retire(this.laptops[0]);
    const material = this.materials.get('laptop');
    const hw = LAPTOP.width / 2;
    const hd = LAPTOP.depth / 2;
    const base = new Body({ mass: LAPTOP.baseMass, material, shape: new Box(new Vec3(hw, LAPTOP.base / 2, hd)) });
    // The lid is a hair shorter than the base and rests on it, hinged at the base's back (+Z) edge.
    const lid = new Body({ mass: LAPTOP.lidMass, material, shape: new Box(new Vec3(hw, LAPTOP.lid / 2, hd - 0.005)) });
    const orientation = new Quaternion(pose.quaternion.x, pose.quaternion.y, pose.quaternion.z, pose.quaternion.w);
    base.position.set(pose.position.x, pose.position.y, pose.position.z);
    base.quaternion.copy(orientation);
    const lidOffset = orientation.vmult(new Vec3(0, LAPTOP.base / 2 + LAPTOP.lid / 2 + 0.001, 0.005));
    lid.position.set(pose.position.x + lidOffset.x, pose.position.y + lidOffset.y, pose.position.z + lidOffset.z);
    lid.quaternion.copy(orientation);
    for (const body of [base, lid]) {
      this.configure(body, SETTINGS.laptop);
      body.velocity.set(velocity.x, velocity.y, velocity.z);
      body.angularVelocity.set(spin.x, spin.y, spin.z);
      this.world.addBody(body);
    }
    // The lid swings open about the hinge axis (the base's local X) while it flies: it turns about the hinge,
    // so its centre also moves (a spin about its own centre would fight the hinge and turn it the other way).
    const axis = orientation.vmult(new Vec3(1, 0, 0));
    const swing = axis.scale(lidSpin);
    lid.angularVelocity.vadd(swing, lid.angularVelocity);
    lid.velocity.vadd(swing.cross(orientation.vmult(new Vec3(0, LAPTOP.lid / 2 + 0.001, 0.005 - hd))), lid.velocity);
    // The lid and the base collide: closing stops on the keys; opening stops at LID_LIMIT (limitLids).
    const hinge = new HingeConstraint(base, lid, {
      pivotA: new Vec3(0, LAPTOP.base / 2, hd), axisA: new Vec3(1, 0, 0),
      pivotB: new Vec3(0, -LAPTOP.lid / 2 - 0.001, hd - 0.005), axisB: new Vec3(1, 0, 0),
    });
    this.world.addConstraint(hinge);
    const laptop = { base, lid, hinge, born: this.clock };
    this.laptops.push(laptop);
    return laptop;
  }

  /**
   * A punch or kick from a character standing at `from`, landing at `point` (the fist or foot) towards `direction` on
   * the floor: every piece and thrown laptop in front of the character within STRIKE_RADIUS of the blow gets knocked away, faster the stronger the blow (`power` 0…1) and the closer
   * it is. The push acts at the struck point, so pieces also spin. Returns how many bodies were hit.
   */
  strike(from: { x: number; z: number }, point: Vec, direction: { x: number; z: number }, power: number): number {
    const { Vec3 } = this.cannon;
    const length = Math.hypot(direction.x, direction.z) || 1;
    const along = { x: direction.x / length, z: direction.z / length };
    const speed = STRIKE_SPEED.min + (STRIKE_SPEED.max - STRIKE_SPEED.min) * Math.min(Math.max(power, 0), 1);
    let hits = 0;
    for (const body of [...this.bodies, ...this.laptops.flatMap((laptop) => [laptop.base, laptop.lid])]) {
      // Only what is in front of the character: a fist or foot can reach past a piece it is pressed against.
      if ((body.position.x - from.x) * along.x + (body.position.z - from.z) * along.z <= 0) continue;
      // Distance to the body's bounds, not its centre: a kick at hip height reaches the top of a short letter.
      body.updateAABB();
      const { lowerBound: low, upperBound: high } = body.aabb;
      const touch = new Vec3(
        Math.min(Math.max(point.x, low.x), high.x), Math.min(Math.max(point.y, low.y), high.y), Math.min(Math.max(point.z, low.z), high.z));
      const distance = Math.hypot(touch.x - point.x, touch.y - point.y, touch.z - point.z);
      if (distance > STRIKE_RADIUS) continue;
      const change = speed * (1 - 0.5 * distance / STRIKE_RADIUS);
      body.wakeUp();
      // Pushed where the blow touches it, so it also spins.
      body.applyImpulse(new Vec3(along.x * change * body.mass, change * STRIKE_LIFT * body.mass, along.z * change * body.mass), touch.vsub(body.position));
      hits++;
    }
    if (hits) this.idle = false;
    return hits;
  }

  private retire(laptop: ThrownLaptop): void {
    this.removeLaptop(laptop);
    this.retired.push(laptop);
  }

  removeLaptop(laptop: ThrownLaptop): void {
    const index = this.laptops.indexOf(laptop);
    if (index < 0) return;
    this.laptops.splice(index, 1);
    this.world.removeConstraint(laptop.hinge);
    this.world.removeBody(laptop.base);
    this.world.removeBody(laptop.lid);
  }

  /**
   * How far the lid is open (radians): 0 closed on the keys, up to LID_LIMIT. Read from the middle of the
   * forbidden arc (between LID_LIMIT and a full turn) so an overshoot stays past the nearer stop.
   */
  lidAngle(laptop: ThrownLaptop): number {
    const { base, lid } = laptop;
    const relative = base.quaternion.conjugate().mult(lid.quaternion);
    // Opening turns the lid about +X: its front edge rises from the keys and swings back over the hinge.
    const angle = 2 * Math.atan2(relative.x, relative.w);
    const wrapped = Math.atan2(Math.sin(angle), Math.cos(angle));
    return wrapped < LID_LIMIT / 2 - Math.PI ? wrapped + Math.PI * 2 : wrapped;
  }

  /**
   * The hinge has no stops of its own: past either end, the relative turn that pushes further out is taken away.
   * LID_CLOSED is a hard stop: the thin lid and base can pass through each other in one step, so a turn below
   * it is undone at once (the lid would otherwise look shut with the keyboard showing through it).
   */
  private readonly limitLids = (): void => {
    for (const laptop of this.laptops) {
      const angle = this.lidAngle(laptop);
      const over = angle < LID_CLOSED ? angle - LID_CLOSED : angle > LID_LIMIT ? angle - LID_LIMIT : 0;
      if (!over) continue;
      const { base, lid } = laptop;
      const axis = base.quaternion.vmult(new this.cannon.Vec3(1, 0, 0));
      // A hard landing can drive the lid well past a stop within one step: turn it back onto it about the hinge.
      const pivot = base.pointToWorldFrame(new this.cannon.Vec3(0, LAPTOP.base / 2, LAPTOP.depth / 2));
      const turn = new this.cannon.Quaternion().setFromAxisAngle(axis, -over);
      const offset = turn.vmult(lid.position.vsub(pivot));
      lid.position.copy(pivot.vadd(offset));
      lid.quaternion.copy(turn.mult(lid.quaternion));
      // Then take away the relative turn that pushes further out, shared by mass between the awake bodies. No
      // push back inside: a lid resting against a stop would keep that speed forever and never fall asleep.
      const relative = lid.angularVelocity.vsub(base.angularVelocity).dot(axis);
      const excess = over > 0 ? Math.max(0, relative) : Math.min(0, relative);
      if (!excess) continue;
      const asleep = this.cannon.Body.SLEEPING;
      const lidShare = base.sleepState === asleep ? 1 : lid.sleepState === asleep ? 0 : LAPTOP.baseMass / (LAPTOP.baseMass + LAPTOP.lidMass);
      lid.angularVelocity.vsub(axis.scale(excess * lidShare), lid.angularVelocity);
      base.angularVelocity.vadd(axis.scale(excess * (1 - lidShare)), base.angularVelocity);
    }
  };

  /** Whether any piece or thrown laptop is moving. */
  get active(): boolean {
    const asleep = this.cannon.Body.SLEEPING;
    return this.bodies.some((body) => body.sleepState !== asleep)
      || this.laptops.some((laptop) => laptop.base.sleepState !== asleep || laptop.lid.sleepState !== asleep);
  }

  private near(pusher: Pusher): boolean {
    const close = (body: BodyType) => Math.abs(body.position.x - pusher.x) < WAKE_DISTANCE && Math.abs(body.position.z - pusher.z) < WAKE_DISTANCE
      && Math.hypot(body.position.x - pusher.x, body.position.z - pusher.z) < WAKE_DISTANCE;
    return this.bodies.some(close) || this.laptops.some((laptop) => close(laptop.base));
  }

  /**
   * cannon-es solves a contact with a sleeping body as if it could not move, and only wakes it afterwards: a
   * rolling ball would bounce off the first pin like off a wall. Sleeping pieces that something moving (or the
   * character) is about to touch are woken before the step instead.
   */
  private wakeAround(pusher: Pusher | undefined): void {
    const asleep = this.cannon.Body.SLEEPING;
    const movers: { x: number; z: number; reach: number }[] = [];
    // The character only wakes what it walks into: standing still next to a piece lets it sleep.
    if (pusher && !this.idle && Math.hypot(pusher.x - this.pusher.position.x, pusher.z - this.pusher.position.z) > 0.002) movers.push({ x: pusher.x, z: pusher.z, reach: 0.8 });
    const moving = [...this.bodies, ...this.laptops.flatMap((laptop) => [laptop.base, laptop.lid])];
    for (const body of moving) {
      if (body.sleepState === asleep) continue;
      const speed = body.velocity.length();
      if (speed > 0.5) movers.push({ x: body.position.x, z: body.position.z, reach: 0.8 + speed * STEP * MAX_SUBSTEPS });
    }
    for (const body of this.bodies) {
      if (body.sleepState !== asleep) continue;
      for (const mover of movers) {
        if (Math.abs(body.position.x - mover.x) < mover.reach && Math.abs(body.position.z - mover.z) < mover.reach) {
          body.wakeUp();
          break;
        }
      }
    }
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
        // Back near the pieces after a while: appear there instead of sweeping across the ground.
        body.position.set(pusher.x, pusher.y, pusher.z);
        body.velocity.setZero();
      } else {
        // Kinematic: moved by its velocity, which is what pushes the pieces it touches.
        const scale = 1 / Math.max(delta, STEP);
        body.velocity.set((pusher.x - body.position.x) * scale, (pusher.y - body.position.y) * scale, (pusher.z - body.position.z) * scale);
      }
    }
    this.idle = false;
    this.clock += delta;
    this.wakeAround(pusher);
    this.world.step(STEP, Math.min(delta, STEP * MAX_SUBSTEPS), MAX_SUBSTEPS);
    for (const [index, body] of this.bodies.entries()) {
      // A piece knocked far away or through the ground comes back to its place.
      const rest = this.rest[index];
      if (body.position.y < this.groundY - 2 || Math.hypot(body.position.x - rest.position.x, body.position.z - rest.position.z) > STRAY_DISTANCE) this.place(body, rest);
    }
    for (const laptop of [...this.laptops]) if (laptop.base.position.y < this.groundY - 2) this.retire(laptop);
    return true;
  }

  /** How many pieces lie toppled (tilted more than 45 degrees), of the given groups or all of them; balls never count. */
  fallen(groups?: readonly PieceGroup[]): number {
    let count = 0;
    for (const [index, body] of this.bodies.entries()) {
      if (this.round[index] || (groups && !groups.includes(this.groups[index]))) continue;
      const q = body.quaternion;
      // Y component of the piece's up axis.
      const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
      if (upY < Math.SQRT1_2) count++;
    }
    return count;
  }
}
