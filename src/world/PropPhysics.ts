import type { Body as BodyType, Constraint as ConstraintType, HingeConstraint as HingeType, Material as MaterialType, World as WorldType } from 'cannon-es';
import { LETTER_MASS, type PieceGroup, type PieceShape } from '../scene/outsideData.ts';
import { FLAP_CENTRE } from '../scene/PieceMeshes.ts';

type Cannon = typeof import('cannon-es');
type Vec = { x: number; y: number; z: number };
type Quat = Vec & { w: number };

/** A piece at rest: where it stands, the half sizes of its box (width, height, depth) and, optionally, another shape, its mass and group. */
export type PieceBody = {
  position: Vec; quaternion: Quat; half: [number, number, number]; shape?: PieceShape; mass?: number; group?: PieceGroup;
  /** Pieces sharing a joint are locked together until a hard knock breaks them apart (a wooden fence's legs and planks). */
  joint?: string;
  /** A cardboard box's flaps: each hinge on its rim, in the box's own axes (the hinge runs along its local X). */
  flaps?: { position: Vec; quaternion: Quat }[];
};
/** Something pieces bounce off: a box turned about +Y (sign boards, the room platform, furniture, walls). */
export type StaticBox = { center: Vec; half: [number, number, number]; yaw: number; /** Tilt about its own X after the yaw (a ramp's slope). */ pitch?: number };
/** A standing target's disc: its centre, radius and the yaw of its face (local +Z). Thrown laptops that hit it are reported. */
export type TargetDisc = { center: Vec; radius: number; yaw: number };
/** A thrown laptop hitting a target disc: which target, how far from its centre (in the disc's plane) and the laptop. */
export type TargetHit = { target: number; distance: number; laptop: ThrownLaptop };
/** Something hit a loose piece (its index), a thrown laptop, a chick or a punching bag this hard (m/s along the contact normal), for its sound. */
export type Impact = { source: number | 'laptop' | 'chick' | 'bag'; speed: number; position: Vec };
/**
 * A punching bag: a cylinder (`radius`, `length`) hanging from a fixed hook at `pivot`, its middle `centre` below it.
 * It only swings like a pendulum round the hook: a ball joint holds it there and its spin about its own axis is taken away.
 */
export type BagBody = { pivot: Vec; centre: number; radius: number; length: number; mass: number };
/** A blow sets a bag's middle moving at this speed (m/s, by power): a tap nudges it, a full charge swings it about 33°. */
export const BAG_STRIKE = { min: 0.6, max: 2.8 };
/** Impacts slower than this make no sound and are not reported (resting contacts jitter well below it). */
const IMPACT_MIN = 0.5;
type CollideEvent = { body: BodyType; contact: { getImpactVelocityAlongNormal(): number } };
/** Character feet; a kinematic capsule of spheres above them pushes the pieces. */
export type Pusher = { x: number; y: number; z: number };
/** The office chair while it is ridden: where its base stands on the ground and its heading (yaw about +Y). */
export type ChairPusher = Pusher & { yaw: number };
/** A wooden fence's plank locked to one of its legs. */
type Joint = { key: string; plank: number; leg: number; constraint: ConstraintType | undefined };
/**
 * A fence breaks apart when something hits it this fast (m/s): the ridden chair, a thrown laptop, or a charged blow (its
 * launch speed). The character walking or running into it only pushes it over whole: the locks hold whatever force.
 */
export const BREAK_SPEED = 3;
/** The ridden chair's body for the pieces: a box round its base and seat (half sizes) with its bottom on the ground. */
export const CHAIR_HALF = [0.45, 0.55, 0.45] as const;

/** Thrown laptop: a base and a lid joined by a hinge along the base's back edge. */
export const LAPTOP = { width: 0.48, depth: 0.32, base: 0.022, lid: 0.012, baseMass: 1, lidMass: 0.4 } as const;
/** The lid opens up to here (radians, a laptop's own stop) and no further back; 0 is closed on the keys. */
export const LID_LIMIT = Math.PI * 0.75;
/** The closed stop: a hair below 0 so a lid resting on the keys can settle; its front edge stays above them. */
export const LID_CLOSED = -0.02;
export type ThrownLaptop = { base: BodyType; lid: BodyType; hinge: HingeType; born: number };
/** A box flap: a thin board hinged on the rim, light, opening from shut (0) up to FLAP_LIMIT. */
export const FLAP = { width: 0.488, thickness: 0.008, length: 0.246, mass: 0.08 } as const;
export const FLAP_LIMIT = 2.6;
/** One box flap: its body, its hinge and where the hinge sits on the box. */
export type Flap = { body: BodyType; hinge: HingeType; at: { position: Vec; quaternion: Quat } };
/** Collision groups: flaps only meet the ground, the static boxes, laptops and the character, not the loose pieces. */
const GROUP = { world: 1, piece: 2, flap: 4 } as const;
/**
 * A raining chick (the Konami code): a ball round its body (`centre` above its feet) whose weight sits `low` below
 * that centre, so like a roly-poly toy it rocks back onto its feet wherever it lands.
 */
export const CHICK = { radius: 0.16, centre: 0.16, low: 0.07, mass: 0.5 } as const;
/** At most this many chicks at once: a new shower retires the oldest. */
export const MAX_CHICKS = 30;
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
const SETTINGS: Record<PieceGroup | 'laptop' | 'chick', Settings> = {
  // Generous sleep limits: a letter resting against another keeps a faint rocking that must still count as asleep.
  name: { material: 'letter', sleepSpeed: 0.2, angularDamping: 0.5, linearDamping: 0.1 },
  tag: { material: 'letter', sleepSpeed: 0.2, angularDamping: 0.5, linearDamping: 0.1 },
  keys: { material: 'letter', sleepSpeed: 0.2, angularDamping: 0.5, linearDamping: 0.1 },
  bricks: { material: 'brick', sleepSpeed: 0.15, angularDamping: 0.4, linearDamping: 0.1 },
  bowling: { material: 'pin', sleepSpeed: 0.15, angularDamping: 0.4, linearDamping: 0.1 },
  decor: { material: 'brick', sleepSpeed: 0.15, angularDamping: 0.4, linearDamping: 0.1 },
  tech: { material: 'brick', sleepSpeed: 0.15, angularDamping: 0.4, linearDamping: 0.1 },
  circuit: { material: 'brick', sleepSpeed: 0.15, angularDamping: 0.3, linearDamping: 0.08 },
  wall: { material: 'brick', sleepSpeed: 0.15, angularDamping: 0.4, linearDamping: 0.1 },
  laptop: { material: 'laptop', sleepSpeed: 0.15, angularDamping: 0.3, linearDamping: 0.05 },
  chick: { material: 'chick', sleepSpeed: 0.12, angularDamping: 0.9, linearDamping: 0.2 },
};
/** A heavy bag swings a few times and settles: damped enough to stop within seconds, asleep once nearly still. */
const BAG: Settings = { material: 'bag', sleepSpeed: 0.05, angularDamping: 0.45, linearDamping: 0.5 };
/** The ball rolls: it keeps less damping than the pins but still comes to rest on the flat ground. */
const BALL: Settings = { material: 'ball', sleepSpeed: 0.12, angularDamping: 0.12, linearDamping: 0.05 };
const CONTACTS: [string, string, number, number][] = [
  ['letter', 'ground', 0.6, 0.05], ['letter', 'letter', 0.4, 0.1],
  ['brick', 'ground', 0.7, 0.02], ['brick', 'brick', 0.65, 0.02],
  ['pin', 'ground', 0.3, 0.1], ['pin', 'pin', 0.2, 0.4], ['pin', 'ball', 0.1, 0.55],
  ['ball', 'ground', 0.4, 0.15], ['laptop', 'ground', 0.5, 0.15],
  // Chicks bounce a little off the ground and off each other.
  ['chick', 'ground', 0.6, 0.35], ['chick', 'chick', 0.4, 0.3],
  // A bag is soft: what hits it hardly bounces.
  ['bag', 'bag', 0.5, 0.05], ['bag', 'laptop', 0.5, 0.05], ['bag', 'chick', 0.5, 0.1],
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
  /** Chicks in the world, oldest first, and the ones taken out (past MAX_CHICKS) for the viewer to shrink away; it empties the list. */
  readonly chicks: BodyType[] = [];
  readonly retiredChicks: BodyType[] = [];
  /** The punching bags, in the order given, and where each one hangs at rest. */
  readonly bags: BodyType[] = [];
  private readonly bagRest: BagBody[] = [];
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
  /** Called when a thrown laptop first touches a target disc (once per laptop and target). */
  onTargetHit?: (hit: TargetHit) => void;
  /** Called when a piece, a laptop or a chick hits something hard enough to be heard. */
  onImpact?: (impact: Impact) => void;
  /** Called when a wooden fence breaks apart (its joint key). */
  onBreak?: (key: string) => void;
  private readonly targetBodies: BodyType[] = [];
  /** Each piece's flaps (none for most). */
  readonly flaps: Flap[][] = [];
  private readonly scored = new WeakMap<ThrownLaptop, Set<number>>();
  /** Fence planks locked to their legs; a broken one has no constraint until the next reset. */
  readonly joints: Joint[] = [];
  /** The ridden office chair: a kinematic box that only meets the pieces while someone drives it. */
  private readonly chair: BodyType;
  private chairActive = false;

  static async load(pieces: readonly PieceBody[], statics: readonly StaticBox[], groundY: number, targets: readonly TargetDisc[] = [], bags: readonly BagBody[] = []): Promise<PropPhysics> {
    return new PropPhysics(await import('cannon-es'), pieces, statics, groundY, targets, bags);
  }

  constructor(cannon: Cannon, pieces: readonly PieceBody[], statics: readonly StaticBox[], groundY: number, targets: readonly TargetDisc[] = [], bags: readonly BagBody[] = []) {
    const { Body, Box, ContactMaterial, Cylinder, Material, Plane, PointToPointConstraint, SAPBroadphase, Sphere, Vec3, World } = cannon;
    this.cannon = cannon;
    // Copied field by field: three.js vectors and quaternions keep their values in accessors.
    this.rest = pieces.map(({ position: p, quaternion: q, half, shape, mass, group, flaps, joint }) => ({
      position: { x: p.x, y: p.y, z: p.z }, quaternion: { x: q.x, y: q.y, z: q.z, w: q.w }, half, shape, mass, group, joint,
      flaps: flaps?.map(({ position: h, quaternion: r }) => ({ position: { x: h.x, y: h.y, z: h.z }, quaternion: { x: r.x, y: r.y, z: r.z, w: r.w } })),
    }));
    this.groups = this.rest.map((piece) => piece.group ?? 'name');
    this.round = this.rest.map((piece) => piece.shape?.kind === 'sphere');
    this.groundY = groundY;
    this.world = new World({ gravity: new Vec3(0, -9.82, 0), allowSleep: true });
    this.world.broadphase = new SAPBroadphase(this.world);
    // More solver passes: thin pieces resting on an edge and stacked bricks settle and sleep instead of rocking forever.
    (this.world.solver as unknown as { iterations: number }).iterations = 20;
    for (const name of ['ground', 'letter', 'brick', 'pin', 'ball', 'laptop', 'chick', 'bag']) this.materials.set(name, new Material(name));
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
      if (box.pitch) body.quaternion = body.quaternion.mult(new cannon.Quaternion().setFromAxisAngle(new Vec3(1, 0, 0), box.pitch));
      this.world.addBody(body);
    }
    // Target discs: thin static boxes facing their local +Z; a laptop touching one reports where it hit.
    for (const [index, disc] of targets.entries()) {
      const body = new Body({ type: Body.STATIC, shape: new Box(new Vec3(disc.radius, disc.radius, 0.03)), material: groundMaterial });
      body.position.set(disc.center.x, disc.center.y, disc.center.z);
      body.quaternion.setFromEuler(0, disc.yaw, 0);
      body.addEventListener('collide', (event: { body: BodyType }) => {
        const laptop = this.laptops.find((entry) => entry.base === event.body || entry.lid === event.body);
        if (!laptop) return;
        const seen = this.scored.get(laptop) ?? new Set<number>();
        if (seen.has(index)) return;
        seen.add(index);
        this.scored.set(laptop, seen);
        // Where the laptop's middle crosses the disc's plane along its flight, in the disc's own axes: its distance from
        // the centre across the face (the first contact is often a corner of the wide laptop, ahead of its middle).
        const inverse = body.quaternion.conjugate();
        const local = inverse.vmult(laptop.base.position.vsub(body.position));
        const speed = inverse.vmult(laptop.base.velocity);
        const along = Math.abs(speed.z) > 0.5 ? Math.max(0, -local.z / speed.z) : 0;
        this.onTargetHit?.({ target: index, distance: Math.hypot(local.x + speed.x * along, local.y + speed.y * along), laptop });
      });
      this.world.addBody(body);
      this.targetBodies.push(body);
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
      body.collisionFilterGroup = GROUP.piece;
      const index = this.bodies.length;
      body.addEventListener('collide', (event: CollideEvent) => this.report(index, body, event));
      this.world.addBody(body);
      this.bodies.push(body);
      this.flaps.push((piece.flaps ?? []).map((at) => this.addFlap(body, at)));
    }
    // Punching bags: each hangs by a ball joint from a fixed hook (a static body with no shape).
    for (const bag of bags) {
      const rest = { pivot: { x: bag.pivot.x, y: bag.pivot.y, z: bag.pivot.z }, centre: bag.centre, radius: bag.radius, length: bag.length, mass: bag.mass };
      const hook = new Body({ type: Body.STATIC });
      hook.position.set(rest.pivot.x, rest.pivot.y, rest.pivot.z);
      this.world.addBody(hook);
      const body = new Body({ mass: rest.mass, material: this.materials.get(BAG.material), shape: new Cylinder(rest.radius, rest.radius, rest.length, 12) });
      this.configure(body, BAG);
      body.collisionFilterGroup = GROUP.piece;
      body.addEventListener('collide', (event: CollideEvent) => this.report('bag', body, event));
      this.world.addBody(body);
      this.world.addConstraint(new PointToPointConstraint(body, new Vec3(0, rest.centre, 0), hook, new Vec3(0, 0, 0)));
      this.bags.push(body);
      this.bagRest.push(rest);
    }
    this.pusher = new Body({ type: Body.KINEMATIC });
    for (const y of PUSHER_SPHERES) this.pusher.addShape(new Sphere(PUSHER_RADIUS), new Vec3(0, y, 0));
    this.pusher.allowSleep = false;
    this.world.addBody(this.pusher);
    this.chair = new Body({ type: Body.KINEMATIC, shape: new Box(new Vec3(...CHAIR_HALF)) });
    this.chair.allowSleep = false;
    this.chair.collisionResponse = false;
    this.chair.position.set(0, groundY - 10, 0);
    this.chair.addEventListener('collide', (event: { body: BodyType }) => this.knock(event.body, this.chair.velocity.length()));
    this.world.addBody(this.chair);
    // Planks and legs of one fence: each plank is locked to each leg (the joints are made at rest, in reset).
    const byJoint = new Map<string, number[]>();
    for (const [index, piece] of this.rest.entries()) if (piece.joint) byJoint.set(piece.joint, [...(byJoint.get(piece.joint) ?? []), index]);
    for (const [key, indices] of byJoint) {
      const legs = indices.filter((index) => this.rest[index].half[1] >= 0.3);
      for (const plank of indices.filter((index) => !legs.includes(index))) for (const leg of legs) this.joints.push({ key, plank, leg, constraint: undefined });
    }
    this.world.addEventListener('postStep', this.limitLids);
    this.world.addEventListener('postStep', this.limitFlaps);
    this.world.addEventListener('postStep', this.breakJoints);
    this.world.addEventListener('postStep', this.swingOnly);
    this.reset();
  }

  /** A bag only swings: the spin about its own (hanging) axis is taken away after every step. */
  private readonly swingOnly = (): void => {
    for (const body of this.bags) {
      const axis = body.quaternion.vmult(new this.cannon.Vec3(0, 1, 0));
      const spin = body.angularVelocity.dot(axis);
      if (spin) body.angularVelocity.vsub(axis.scale(spin), body.angularVelocity);
    }
  };

  /** A bag hanging still under its hook. */
  private hang(body: BodyType, rest: BagBody): void {
    body.position.set(rest.pivot.x, rest.pivot.y - rest.centre, rest.pivot.z);
    body.quaternion.set(0, 0, 0, 1);
    body.velocity.setZero();
    body.angularVelocity.setZero();
    body.sleep();
  }

  /** How many fence planks have broken loose from a leg. */
  get broken(): number {
    return this.joints.filter((joint) => !joint.constraint).length;
  }

  /** Lock a plank to its leg where they stand now (both at rest after a reset). */
  private lock(joint: Joint): void {
    if (joint.constraint) this.world.removeConstraint(joint.constraint);
    joint.constraint = new this.cannon.LockConstraint(this.bodies[joint.plank], this.bodies[joint.leg]);
    // The plank ends sit in the legs: touching each other they would fight the lock (the option is not passed on by LockConstraint).
    joint.constraint.collideConnected = false;
    this.world.addConstraint(joint.constraint);
  }

  /** Fences hit hard this step, broken apart after it (constraints are not removed in the middle of a step). */
  private readonly toBreak = new Set<string>();

  /** The fence piece `body` belongs to, if any. */
  private jointOf(body: BodyType): string | undefined {
    const index = this.bodies.indexOf(body);
    return index >= 0 ? this.rest[index].joint : undefined;
  }

  /** Something hit `body` at `speed`: a fence piece hit hard enough breaks its whole fence apart. */
  private knock(body: BodyType, speed: number): void {
    const key = this.jointOf(body);
    if (key && speed >= BREAK_SPEED) this.toBreak.add(key);
  }

  /** A contact on `body`, reported when it is hard enough to hear. */
  private report(source: Impact['source'], body: BodyType, event: CollideEvent): void {
    if (!this.onImpact) return;
    const speed = Math.abs(event.contact.getImpactVelocityAlongNormal());
    if (speed >= IMPACT_MIN) this.onImpact({ source, speed, position: body.position });
  }

  /** The fences hit hard during the step let go of their planks, which fly on their own until the next reset. */
  private readonly breakJoints = (): void => {
    if (!this.toBreak.size) return;
    const broke = new Set<string>();
    for (const joint of this.joints) {
      if (!joint.constraint || !this.toBreak.has(joint.key)) continue;
      this.world.removeConstraint(joint.constraint);
      joint.constraint = undefined;
      this.bodies[joint.plank].wakeUp();
      broke.add(joint.key);
    }
    this.toBreak.clear();
    for (const key of broke) this.onBreak?.(key);
  };

  /**
   * A flap hinged on box `box` at `at`: its body sits at the flap's centre (so gravity swings it), and the hinge joins
   * it to the box along the rim. It only collides with the ground, the static boxes, laptops and the character.
   */
  private addFlap(box: BodyType, at: { position: Vec; quaternion: Quat }): Flap {
    const { Body, Box, HingeConstraint, Quaternion, Vec3 } = this.cannon;
    const body = new Body({ mass: FLAP.mass, material: this.materials.get('brick'), shape: new Box(new Vec3(FLAP.width / 2, FLAP.thickness / 2, FLAP.length / 2)) });
    body.collisionFilterGroup = GROUP.flap;
    body.collisionFilterMask = GROUP.world;
    this.configure(body, { material: 'brick', sleepSpeed: 0.15, angularDamping: 0.6, linearDamping: 0.1 });
    const turn = new Quaternion(at.quaternion.x, at.quaternion.y, at.quaternion.z, at.quaternion.w);
    const hinge = new HingeConstraint(box, body, {
      pivotA: new Vec3(at.position.x, at.position.y, at.position.z), axisA: turn.vmult(new Vec3(1, 0, 0)),
      pivotB: new Vec3(-FLAP_CENTRE.x, -FLAP_CENTRE.y, -FLAP_CENTRE.z), axisB: new Vec3(1, 0, 0),
    });
    this.world.addBody(body);
    this.world.addConstraint(hinge);
    return { body, hinge, at };
  }

  /** Flap pose for a box pose: shut on the rim, or opened by `angle` about its hinge. */
  private placeFlap(box: BodyType, flap: Flap, angle = 0): void {
    const { Quaternion, Vec3 } = this.cannon;
    const local = new Quaternion(flap.at.quaternion.x, flap.at.quaternion.y, flap.at.quaternion.z, flap.at.quaternion.w)
      .mult(new Quaternion().setFromAxisAngle(new Vec3(1, 0, 0), angle));
    const orientation = box.quaternion.mult(local);
    const hinge = box.pointToWorldFrame(new Vec3(flap.at.position.x, flap.at.position.y, flap.at.position.z));
    flap.body.position.copy(hinge.vadd(orientation.vmult(new Vec3(FLAP_CENTRE.x, FLAP_CENTRE.y, FLAP_CENTRE.z))));
    flap.body.quaternion.copy(orientation);
    flap.body.velocity.setZero();
    flap.body.angularVelocity.setZero();
    flap.body.sleep();
  }

  /** How far flap `k` of piece `index` stands open (radians about its hinge): 0 shut, up to FLAP_LIMIT. */
  flapAngle(index: number, k: number): number {
    const box = this.bodies[index];
    const flap = this.flaps[index]?.[k];
    if (!box || !flap) return 0;
    const { Quaternion } = this.cannon;
    const shut = box.quaternion.mult(new Quaternion(flap.at.quaternion.x, flap.at.quaternion.y, flap.at.quaternion.z, flap.at.quaternion.w));
    const relative = shut.conjugate().mult(flap.body.quaternion);
    return Math.atan2(Math.sin(2 * Math.atan2(relative.x, relative.w)), Math.cos(2 * Math.atan2(relative.x, relative.w)));
  }

  /**
   * Flaps stop shut on the box and fully open: past either stop the flap is turned back onto it about its hinge and the
   * relative spin pushing further out is taken away (like the laptop lids, so a flap resting on a stop can sleep).
   */
  private readonly limitFlaps = (): void => {
    const { Quaternion, Vec3 } = this.cannon;
    for (const [index, flaps] of this.flaps.entries()) {
      const box = this.bodies[index];
      for (const [k, flap] of flaps.entries()) {
        const angle = this.flapAngle(index, k);
        const over = angle < 0 ? angle : angle > FLAP_LIMIT ? angle - FLAP_LIMIT : 0;
        if (!over) continue;
        const local = new Quaternion(flap.at.quaternion.x, flap.at.quaternion.y, flap.at.quaternion.z, flap.at.quaternion.w);
        const axis = box.quaternion.mult(local).vmult(new Vec3(1, 0, 0));
        const pivot = box.pointToWorldFrame(new Vec3(flap.at.position.x, flap.at.position.y, flap.at.position.z));
        const turn = new Quaternion().setFromAxisAngle(axis, -over);
        flap.body.position.copy(pivot.vadd(turn.vmult(flap.body.position.vsub(pivot))));
        flap.body.quaternion.copy(turn.mult(flap.body.quaternion));
        const relative = flap.body.angularVelocity.vsub(box.angularVelocity).dot(axis);
        const excess = over > 0 ? Math.max(0, relative) : Math.min(0, relative);
        if (excess) flap.body.angularVelocity.vsub(axis.scale(excess), flap.body.angularVelocity);
      }
    }
  };

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
    for (const joint of this.joints) if (!group || this.groups[joint.plank] === group) this.lock(joint);
    if (!group) {
      for (const laptop of [...this.laptops]) this.removeLaptop(laptop);
      this.retired.length = 0;
      for (const chick of this.chicks) this.world.removeBody(chick);
      this.chicks.length = 0;
      for (const [index, body] of this.bags.entries()) this.hang(body, this.bagRest[index]);
      this.retiredChicks.length = 0;
      // The character is put back too: its pusher jumps there on the next step instead of sweeping across the pieces
      // just put back (at the speed of that jump it would fling them away).
      this.idle = true;
    }
  }

  private place(body: BodyType, rest: PieceBody): void {
    body.position.set(rest.position.x, rest.position.y, rest.position.z);
    body.quaternion.set(rest.quaternion.x, rest.quaternion.y, rest.quaternion.z, rest.quaternion.w);
    body.velocity.setZero();
    body.angularVelocity.setZero();
    body.sleep();
    for (const flap of this.flaps[this.bodies.indexOf(body)] ?? []) this.placeFlap(body, flap);
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
    // A laptop flying into a fence breaks it like the chair does.
    for (const part of [base, lid]) {
      part.addEventListener('collide', (event: CollideEvent) => {
        this.knock(event.body, part.velocity.vsub(event.body.velocity).length());
        this.report('laptop', part, event);
      });
    }
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
    const bagSpeed = BAG_STRIKE.min + (BAG_STRIKE.max - BAG_STRIKE.min) * Math.min(Math.max(power, 0), 1);
    let hits = 0;
    for (const body of [...this.bodies, ...this.laptops.flatMap((laptop) => [laptop.base, laptop.lid]), ...this.chicks, ...this.bags]) {
      // Only what is in front of the character: a fist or foot can reach past a piece it is pressed against.
      if ((body.position.x - from.x) * along.x + (body.position.z - from.z) * along.z <= 0) continue;
      // Distance to the body's bounds, not its centre: a kick at hip height reaches the top of a short letter.
      body.updateAABB();
      const { lowerBound: low, upperBound: high } = body.aabb;
      const touch = new Vec3(
        Math.min(Math.max(point.x, low.x), high.x), Math.min(Math.max(point.y, low.y), high.y), Math.min(Math.max(point.z, low.z), high.z));
      const distance = Math.hypot(touch.x - point.x, touch.y - point.y, touch.z - point.z);
      if (distance > STRIKE_RADIUS) continue;
      if (this.bags.includes(body)) {
        // A bag is pushed through its middle, straight along the blow: it swings away from the character and back.
        const push = bagSpeed * (1 - 0.3 * distance / STRIKE_RADIUS) * body.mass;
        body.wakeUp();
        body.applyImpulse(new Vec3(along.x * push, 0, along.z * push));
        hits++;
        continue;
      }
      const change = speed * (1 - 0.5 * distance / STRIKE_RADIUS);
      body.wakeUp();
      // Pushed where the blow touches it, so it also spins.
      body.applyImpulse(new Vec3(along.x * change * body.mass, change * STRIKE_LIFT * body.mass, along.z * change * body.mass), touch.vsub(body.position));
      this.knock(body, change);
      hits++;
    }
    if (hits) this.idle = false;
    this.breakJoints();
    return hits;
  }

  /**
   * A chick falling from the sky: its feet at `feet`, turned by `yaw`, with a velocity and a spin. Past MAX_CHICKS the
   * oldest one is retired.
   */
  dropChick(feet: Vec, yaw: number, velocity: Vec, spin: Vec): BodyType {
    const { Body, Sphere, Vec3 } = this.cannon;
    while (this.chicks.length >= MAX_CHICKS) {
      const old = this.chicks.shift()!;
      this.world.removeBody(old);
      this.retiredChicks.push(old);
    }
    const body = new Body({ mass: CHICK.mass, material: this.materials.get('chick') });
    // The body's origin is its centre of mass, below the ball's centre: it always rolls back upright.
    body.addShape(new Sphere(CHICK.radius), new Vec3(0, CHICK.low, 0));
    this.configure(body, SETTINGS.chick);
    body.position.set(feet.x, feet.y + CHICK.centre - CHICK.low, feet.z);
    body.quaternion.setFromEuler(0, yaw, 0);
    body.velocity.set(velocity.x, velocity.y, velocity.z);
    body.angularVelocity.set(spin.x, spin.y, spin.z);
    body.addEventListener('collide', (event: CollideEvent) => this.report('chick', body, event));
    this.world.addBody(body);
    this.chicks.push(body);
    this.idle = false;
    return body;
  }

  /** Take every thrown laptop away (they shrink out in the viewer like retired ones); the pieces stay as they are. */
  clearThrown(): void {
    for (const laptop of [...this.laptops]) this.retire(laptop);
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
      || this.flaps.some((flaps) => flaps.some((flap) => flap.body.sleepState !== asleep))
      || this.laptops.some((laptop) => laptop.base.sleepState !== asleep || laptop.lid.sleepState !== asleep)
      || this.chicks.some((chick) => chick.sleepState !== asleep)
      || this.bags.some((bag) => bag.sleepState !== asleep);
  }

  private near(pusher: Pusher): boolean {
    const close = (body: BodyType) => Math.abs(body.position.x - pusher.x) < WAKE_DISTANCE && Math.abs(body.position.z - pusher.z) < WAKE_DISTANCE
      && Math.hypot(body.position.x - pusher.x, body.position.z - pusher.z) < WAKE_DISTANCE;
    return this.bodies.some(close) || this.laptops.some((laptop) => close(laptop.base)) || this.chicks.some(close) || this.bags.some(close);
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
    const moving = [...this.bodies, ...this.laptops.flatMap((laptop) => [laptop.base, laptop.lid]), ...this.chicks, ...this.bags];
    for (const body of moving) {
      if (body.sleepState === asleep) continue;
      const speed = body.velocity.length();
      if (speed > 0.5) movers.push({ x: body.position.x, z: body.position.z, reach: 0.8 + speed * STEP * MAX_SUBSTEPS });
    }
    // A box that moves takes its flaps along: a sleeping flap would hold its hinge still.
    for (const [index, flaps] of this.flaps.entries()) {
      if (this.bodies[index].sleepState === asleep) continue;
      for (const flap of flaps) if (flap.body.sleepState === asleep) flap.body.wakeUp();
    }
    if (this.chairActive) movers.push({ x: this.chair.position.x, z: this.chair.position.z, reach: 1.2 + this.chair.velocity.length() * STEP * MAX_SUBSTEPS });
    // A fence moves as one while it holds together: a sleeping part would pin the rest in place.
    for (const joint of this.joints) {
      if (!joint.constraint) continue;
      const plank = this.bodies[joint.plank];
      const leg = this.bodies[joint.leg];
      if ((plank.sleepState === asleep) !== (leg.sleepState === asleep)) {
        plank.wakeUp();
        leg.wakeUp();
      }
    }
    for (const body of [...this.bodies, ...this.chicks, ...this.bags]) {
      if (body.sleepState !== asleep) continue;
      for (const mover of movers) {
        if (Math.abs(body.position.x - mover.x) < mover.reach && Math.abs(body.position.z - mover.z) < mover.reach) {
          body.wakeUp();
          break;
        }
      }
    }
  }

  /**
   * The office chair while it is ridden (its base on the ground and heading), or undefined when nobody drives it:
   * then it takes no part. Moved like the character's pusher, by its velocity, so what it runs into is knocked away.
   */
  private moveChair(chair: ChairPusher | undefined, delta: number): void {
    const body = this.chair;
    if (!chair) {
      if (this.chairActive) {
        body.position.set(0, this.groundY - 10, 0);
        body.velocity.setZero();
        body.collisionResponse = false;
        this.chairActive = false;
      }
      return;
    }
    const y = chair.y + CHAIR_HALF[1];
    if (!this.chairActive || delta <= 0) {
      body.position.set(chair.x, y, chair.z);
      body.velocity.setZero();
    } else {
      const scale = 1 / Math.max(delta, STEP);
      body.velocity.set((chair.x - body.position.x) * scale, (y - body.position.y) * scale, (chair.z - body.position.z) * scale);
    }
    body.quaternion.setFromEuler(0, chair.yaw, 0);
    body.collisionResponse = true;
    this.chairActive = true;
  }

  /** Advance by `delta` seconds with the character at `pusher` (and the ridden chair). Returns false when the world was skipped. */
  step(delta: number, pusher: Pusher | undefined, chair?: ChairPusher): boolean {
    this.moveChair(chair, delta);
    const close = (pusher !== undefined && this.near(pusher)) || (chair !== undefined && this.near(chair));
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
    for (const chick of [...this.chicks]) {
      if (chick.position.y > this.groundY - 2) continue;
      this.chicks.splice(this.chicks.indexOf(chick), 1);
      this.world.removeBody(chick);
      this.retiredChicks.push(chick);
    }
    return true;
  }

  /** How many pieces lie toppled (tilted more than 45 degrees), of the given groups or all of them; balls never count. */
  fallen(groups?: readonly PieceGroup[]): number {
    let count = 0;
    for (const index of this.bodies.keys()) {
      if (this.round[index] || (groups && !groups.includes(this.groups[index]))) continue;
      if (this.toppled(index)) count++;
    }
    return count;
  }

  /** Whether piece `index` is tilted more than 45 degrees or lies more than half its height below where it stood. */
  toppled(index: number): boolean {
    const body = this.bodies[index];
    const q = body.quaternion;
    // Y component of the piece's up axis.
    const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
    return upY < Math.SQRT1_2 || body.position.y < this.rest[index].position.y - this.rest[index].half[1];
  }
}
