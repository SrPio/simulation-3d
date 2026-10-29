import { Color, DynamicDrawUsage, Group, InstancedMesh, Matrix4, Mesh, Quaternion, Vector3, type BufferGeometry, type Material, type Object3D } from 'three';
import type { Body } from 'cannon-es';
import { CANDY_COLORS } from './halloweenDress.ts';
import { MAX_CANDIES, type PropPhysics } from '../world/PropPhysics.ts';

/** Thrown pumpkins in the air at once (they burst at their first touch, so a few is plenty). */
const MAX_FLYING = 6;
/** Shell pieces of a burst pumpkin: how many, how fast they fly out (m/s), how long they last (s) and the most at once. */
export const SHARDS = { count: 7, speed: 2.4, lift: 2.6, life: 1.6, max: 42 } as const;
/** Seconds a candy takes to shrink away once a newer burst pushes it out. */
const SHRINK_TIME = 0.35;

type Vec = { x: number; y: number; z: number };
/** A shard of shell: flying freely with gravity, bouncing once or twice off the ground, then shrinking away. */
export type Shard = { position: Vec; velocity: Vec; spin: Vec; turn: Vec; age: number };

/** The shards of a pumpkin burst at `at` moving with `velocity`: thrown out all round, up, and a little on. */
export function shardsOf(at: Vec, velocity: Vec, random: () => number): Shard[] {
  return Array.from({ length: SHARDS.count }, (_, k) => {
    const angle = (k / SHARDS.count) * Math.PI * 2 + random() * 0.5;
    const speed = SHARDS.speed * (0.6 + random() * 0.6);
    return {
      position: { x: at.x, y: at.y, z: at.z },
      velocity: { x: Math.cos(angle) * speed + velocity.x * 0.2, y: SHARDS.lift * (0.5 + random() * 0.7), z: Math.sin(angle) * speed + velocity.z * 0.2 },
      spin: { x: (random() - 0.5) * 14, y: (random() - 0.5) * 14, z: (random() - 0.5) * 14 },
      turn: { x: random() * 6, y: random() * 6, z: random() * 6 },
      age: 0,
    };
  });
}

/** One step of a shard: gravity, a lossy bounce off the ground at `floor`, its tumble, its age. */
export function shardStep(shard: Shard, delta: number, floor: number): void {
  shard.velocity.y -= 9.82 * delta;
  shard.position.x += shard.velocity.x * delta;
  shard.position.y += shard.velocity.y * delta;
  shard.position.z += shard.velocity.z * delta;
  if (shard.position.y < floor) {
    shard.position.y = floor;
    shard.velocity.y = Math.abs(shard.velocity.y) * 0.3;
    shard.velocity.x *= 0.5;
    shard.velocity.z *= 0.5;
    shard.spin.x *= 0.5;
    shard.spin.y *= 0.5;
    shard.spin.z *= 0.5;
  }
  shard.turn.x += shard.spin.x * delta;
  shard.turn.y += shard.spin.y * delta;
  shard.turn.z += shard.spin.z * delta;
  shard.age += delta;
}

/** Instanced copies of a model, one InstancedMesh per material, for `capacity` copies. */
function instanced(model: Object3D, capacity: number, name: string): InstancedMesh[] {
  model.updateMatrixWorld(true);
  const inverse = new Matrix4().copy(model.matrixWorld).invert();
  const meshes: InstancedMesh[] = [];
  model.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    // Each part in the model's own frame (its node may sit inside a group of the multi-material mesh).
    const geometry = (object.geometry as BufferGeometry).clone().applyMatrix4(new Matrix4().multiplyMatrices(inverse, object.matrixWorld));
    const mesh = new InstancedMesh(geometry, object.material as Material, capacity);
    mesh.name = `${name}_${(object.material as Material).name}`;
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.count = 0;
    // They scatter over the ground: never culled as one small box.
    mesh.frustumCulled = false;
    meshes.push(mesh);
  });
  return meshes;
}

/**
 * Halloween's thrown pumpkins: the pumpkins in the air follow their bodies; when one bursts (PropPhysics.smashed) its
 * shell flies apart in a few shards that tumble, bounce and shrink away, and its candies (bodies of their own, kicked
 * and pushed like the pieces) follow theirs, each a wrapped sweet, a lollipop or a gummy in a bright colour. Past
 * MAX_CANDIES the oldest shrink away. Restablecer clears everything.
 */
export class CandyBurst {
  readonly root = new Group();
  private readonly pumpkins: InstancedMesh[];
  private readonly shards: InstancedMesh[];
  /** Each kind of candy: its meshes (the coloured part first) and the bodies it draws. */
  private readonly kinds: { meshes: InstancedMesh[]; bodies: Body[] }[] = [];
  private readonly flyingShards: Shard[] = [];
  private readonly leaving: { kind: number; matrix: Matrix4; color: Color; shrink: number }[] = [];
  private readonly colors = new WeakMap<Body, Color>();
  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly quaternion = new Quaternion();
  private readonly scale = new Vector3(1, 1, 1);
  private readonly groundY: number;
  private readonly random: () => number;
  /** Bursts so far (data-smashed). */
  smashes = 0;

  constructor(library: Map<string, Object3D>, groundY: number, random: () => number = Math.random) {
    this.root.name = 'CandyBurst';
    this.groundY = groundY;
    this.random = random;
    const take = (name: string, capacity: number) => {
      const model = library.get(name);
      const meshes = model ? instanced(model, capacity, name) : [];
      for (const mesh of meshes) this.root.add(mesh);
      return meshes;
    };
    this.pumpkins = take('ThrownPumpkin', MAX_FLYING);
    this.shards = take('PumpkinShard', SHARDS.max);
    // Twice the cap: the ones shrinking away are still drawn while new ones fly.
    for (const name of ['Candy_Wrapped', 'Candy_Lollipop', 'Candy_Gummy']) this.kinds.push({ meshes: take(name, MAX_CANDIES * 2), bodies: [] });
  }

  /** Candies on the ground or in the air. */
  get candies(): number {
    return this.kinds.reduce((sum, kind) => sum + kind.bodies.length, 0);
  }

  /** Follow the physics: new bursts, the flying pumpkins, the shards, the candies and the ones shrinking away. */
  update(delta: number, physics: PropPhysics, reducedMotion = false): void {
    for (const smash of physics.smashed.splice(0)) {
      this.smashes++;
      if (!reducedMotion) {
        this.flyingShards.push(...shardsOf(smash.position, smash.velocity, this.random));
        while (this.flyingShards.length > SHARDS.max) this.flyingShards.shift();
      }
    }
    // New candies: a kind and a colour each, kept with the body.
    const known = new Set(this.kinds.flatMap((kind) => kind.bodies));
    for (const body of physics.candies as unknown as Body[]) {
      if (known.has(body)) continue;
      const kind = this.kinds[Math.floor(this.random() * this.kinds.length)];
      kind?.bodies.push(body);
      this.colors.set(body, CANDY_COLORS[Math.floor(this.random() * CANDY_COLORS.length)]);
    }
    for (const body of physics.retiredCandies.splice(0) as unknown as Body[]) {
      for (const [k, kind] of this.kinds.entries()) {
        const index = kind.bodies.indexOf(body);
        if (index < 0) continue;
        kind.bodies.splice(index, 1);
        this.leaving.push({ kind: k, matrix: this.poseOf(body).clone(), color: this.colors.get(body) ?? CANDY_COLORS[0], shrink: 0 });
      }
    }
    let flying = 0;
    for (const pumpkin of physics.pumpkins.slice(-MAX_FLYING)) {
      const pose = this.poseOf(pumpkin.body as unknown as Body);
      for (const mesh of this.pumpkins) mesh.setMatrixAt(flying, pose);
      flying++;
    }
    this.commit(this.pumpkins, flying);
    let shards = 0;
    for (const shard of this.flyingShards) shardStep(shard, delta, this.groundY + 0.03);
    for (let k = this.flyingShards.length - 1; k >= 0; k--) if (this.flyingShards[k].age >= SHARDS.life) this.flyingShards.splice(k, 1);
    for (const shard of this.flyingShards) {
      const size = Math.min(1, (SHARDS.life - shard.age) / 0.4);
      this.quaternion.setFromAxisAngle(this.position.set(shard.turn.x, shard.turn.y, shard.turn.z).normalize(), Math.hypot(shard.turn.x, shard.turn.y, shard.turn.z));
      this.position.set(shard.position.x, shard.position.y, shard.position.z);
      this.matrix.compose(this.position, this.quaternion, this.scale.setScalar(Math.max(0.001, size)));
      for (const mesh of this.shards) mesh.setMatrixAt(shards, this.matrix);
      shards++;
    }
    this.scale.set(1, 1, 1);
    this.commit(this.shards, shards);
    for (const entry of this.leaving) entry.shrink += delta;
    for (let k = this.leaving.length - 1; k >= 0; k--) if (this.leaving[k].shrink >= SHRINK_TIME) this.leaving.splice(k, 1);
    for (const [k, kind] of this.kinds.entries()) {
      let slot = 0;
      for (const body of kind.bodies) this.placeCandy(kind.meshes, slot++, this.poseOf(body), this.colors.get(body));
      for (const entry of this.leaving) {
        if (entry.kind !== k) continue;
        entry.matrix.decompose(this.position, this.quaternion, this.scale);
        const size = Math.max(0.001, 1 - entry.shrink / SHRINK_TIME);
        this.placeCandy(kind.meshes, slot++, this.matrix.compose(this.position, this.quaternion, this.scale.setScalar(size)), entry.color);
      }
      this.scale.set(1, 1, 1);
      this.commit(kind.meshes, slot);
    }
  }

  /** Everything gone at once (Restablecer: the physics has already removed the bodies). */
  clear(): void {
    for (const kind of this.kinds) kind.bodies.length = 0;
    this.leaving.length = 0;
    this.flyingShards.length = 0;
    for (const mesh of [...this.pumpkins, ...this.shards, ...this.kinds.flatMap((kind) => kind.meshes)]) mesh.count = 0;
  }

  private placeCandy(meshes: InstancedMesh[], slot: number, matrix: Matrix4, color: Color | undefined): void {
    for (const [k, mesh] of meshes.entries()) {
      if (slot >= mesh.instanceMatrix.count) continue;
      mesh.setMatrixAt(slot, matrix);
      // The first material is the sweet itself, in its colour; a lollipop's stick stays white.
      if (k === 0 && color) mesh.setColorAt(slot, color);
    }
  }

  private commit(meshes: InstancedMesh[], count: number): void {
    for (const mesh of meshes) {
      mesh.count = Math.min(count, mesh.instanceMatrix.count);
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  private poseOf(body: Body): Matrix4 {
    this.position.set(body.position.x, body.position.y, body.position.z);
    this.quaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
    return this.matrix.compose(this.position, this.quaternion, this.scale.set(1, 1, 1));
  }

  dispose(): void {
    for (const mesh of [...this.pumpkins, ...this.shards, ...this.kinds.flatMap((kind) => kind.meshes)]) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
    this.root.removeFromParent();
  }
}

