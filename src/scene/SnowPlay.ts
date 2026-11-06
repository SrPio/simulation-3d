import { Color, DynamicDrawUsage, Euler, Group, InstancedMesh, Matrix4, Mesh, Quaternion, Vector3, type BufferGeometry, type Material, type Object3D } from 'three';
import type { Body } from 'cannon-es';
import { GIFT_COLORS } from './christmasDress.ts';
import { shardStep, type Shard } from './CandyBurst.ts';
import { GIFT, type FallenGift, type PropPhysics } from '../world/PropPhysics.ts';

/** Snowballs in the air at once (they burst at their first touch). */
const MAX_FLYING = 6;
/** Lumps of snow flying from a burst snowball, a crumbling snowman, a landing or a kick: the most at once and how long one lasts (s). */
export const PUFFS = { max: 220, life: 1.3, burst: 9, crumble: 18 } as const;
/** Seconds a gift takes to shrink away when it goes (too old, or pushed out by newer ones). */
const SHRINK_TIME = 0.4;

type Vec = { x: number; y: number; z: number };
type Puff = Shard & { size: number; life: number };

/** Instanced copies of a model, one InstancedMesh per material, for `capacity` copies. */
function instanced(model: Object3D, capacity: number, name: string): InstancedMesh[] {
  model.updateMatrixWorld(true);
  const inverse = new Matrix4().copy(model.matrixWorld).invert();
  const meshes: InstancedMesh[] = [];
  model.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const geometry = (object.geometry as BufferGeometry).clone().applyMatrix4(new Matrix4().multiplyMatrices(inverse, object.matrixWorld));
    const mesh = new InstancedMesh(geometry, object.material as Material, capacity);
    mesh.name = `${name}_${(object.material as Material).name}`;
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    meshes.push(mesh);
  });
  return meshes;
}

/**
 * Christmas play things drawn from the physics: snowballs in the air, the lumps of snow they burst into (and those of
 * a crumbling snowman, a landing in the snow or a kick), and the gifts that fall off the sleigh's sack, each in its own
 * wrapping paper, shrinking away when they go.
 */
export class SnowPlay {
  readonly root = new Group();
  private readonly snowballs: InstancedMesh[];
  private readonly chunks: InstancedMesh[];
  private readonly gifts: InstancedMesh[][];
  private readonly puffs: Puff[] = [];
  private readonly giftColors = new WeakMap<Body, Color>();
  private readonly leaving: { gift: FallenGift; matrix: Matrix4; shrink: number }[] = [];
  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly quaternion = new Quaternion();
  private readonly scale = new Vector3(1, 1, 1);
  private readonly euler = new Euler();
  private readonly groundY: number;
  private readonly random: () => number;
  private colorTurn = 0;
  /** Snowballs burst so far (data-snowballs). */
  bursts = 0;

  constructor(library: Map<string, Object3D>, groundY: number, random: () => number = Math.random) {
    this.root.name = 'SnowPlay';
    this.groundY = groundY;
    this.random = random;
    const take = (name: string, capacity: number) => {
      const model = library.get(name);
      const meshes = model ? instanced(model, capacity, name) : [];
      for (const mesh of meshes) this.root.add(mesh);
      return meshes;
    };
    this.snowballs = take('Snowball', MAX_FLYING);
    this.chunks = take('SnowChunk', PUFFS.max);
    this.gifts = GIFT.sizes.map((_, k) => take(`Gift_${k}`, GIFT.max * 2));
  }

  /** Lumps of snow thrown up from `at` (`count` of them, about `size` metres across), moving on with `velocity`. */
  puff(at: Vec, count: number, size = 0.07, velocity: Vec = { x: 0, y: 0, z: 0 }, speed = 1.6): void {
    for (let k = 0; k < count; k++) {
      if (this.puffs.length >= PUFFS.max) this.puffs.shift();
      const angle = (k / count) * Math.PI * 2 + this.random() * 0.8;
      const out = speed * (0.4 + this.random() * 0.7);
      this.puffs.push({
        position: { x: at.x, y: at.y, z: at.z },
        velocity: { x: Math.cos(angle) * out + velocity.x * 0.25, y: speed * (0.5 + this.random() * 0.8), z: Math.sin(angle) * out + velocity.z * 0.25 },
        spin: { x: (this.random() - 0.5) * 8, y: (this.random() - 0.5) * 8, z: (this.random() - 0.5) * 8 },
        turn: { x: this.random() * 6, y: this.random() * 6, z: this.random() * 6 },
        age: 0,
        size: size * (0.6 + this.random() * 0.8),
        life: PUFFS.life * (0.7 + this.random() * 0.6),
      });
    }
  }

  get flyingPuffs(): number {
    return this.puffs.length;
  }

  update(delta: number, physics: PropPhysics, reducedMotion = false): void {
    for (const burst of physics.bursts.splice(0)) {
      this.bursts++;
      if (!reducedMotion) this.puff(burst.position, PUFFS.burst, 0.06, burst.velocity, 2.0);
    }
    for (const crumble of physics.crumbles.splice(0)) {
      if (!reducedMotion) this.puff(crumble.position, PUFFS.crumble, crumble.radius * 0.35, { x: 0, y: 0, z: 0 }, 1.8);
    }
    // Flying snowballs.
    const flying = physics.snowballs.slice(-MAX_FLYING);
    for (const mesh of this.snowballs) mesh.count = flying.length;
    for (const [i, ball] of flying.entries()) {
      const p = ball.body.position;
      const q = ball.body.quaternion;
      this.matrix.compose(this.position.set(p.x, p.y, p.z), this.quaternion.set(q.x, q.y, q.z, q.w), this.scale.set(1, 1, 1));
      for (const mesh of this.snowballs) mesh.setMatrixAt(i, this.matrix);
    }
    for (const mesh of this.snowballs) mesh.instanceMatrix.needsUpdate = true;
    // Lumps of snow: fly, fall, settle and shrink away.
    const floor = this.groundY + 0.02;
    for (const puff of this.puffs) shardStep(puff, delta, floor);
    for (let i = this.puffs.length - 1; i >= 0; i--) if (this.puffs[i].age > this.puffs[i].life) this.puffs.splice(i, 1);
    for (const mesh of this.chunks) mesh.count = this.puffs.length;
    for (const [i, puff] of this.puffs.entries()) {
      const left = 1 - puff.age / puff.life;
      const size = puff.size * Math.min(1, left * 2.5);
      this.quaternion.setFromEuler(this.euler.set(puff.turn.x, puff.turn.y, puff.turn.z));
      this.matrix.compose(this.position.set(puff.position.x, puff.position.y, puff.position.z), this.quaternion, this.scale.set(size, size * 0.8, size));
      for (const mesh of this.chunks) mesh.setMatrixAt(i, this.matrix);
    }
    for (const mesh of this.chunks) mesh.instanceMatrix.needsUpdate = true;
    // Gifts: the ones in the world follow their bodies; the ones that went shrink where they were.
    for (const gift of physics.retiredGifts.splice(0)) {
      const p = gift.body.position;
      const q = gift.body.quaternion;
      this.leaving.push({ gift, matrix: new Matrix4().compose(new Vector3(p.x, p.y, p.z), new Quaternion(q.x, q.y, q.z, q.w), new Vector3(1, 1, 1)), shrink: SHRINK_TIME });
    }
    const counts = this.gifts.map(() => 0);
    const draw = (gift: FallenGift, matrix: Matrix4) => {
      const meshes = this.gifts[gift.size];
      const index = counts[gift.size]++;
      if (index >= GIFT.max * 2) return;
      let color = this.giftColors.get(gift.body);
      if (!color) {
        color = GIFT_COLORS[this.colorTurn++ % GIFT_COLORS.length];
        this.giftColors.set(gift.body, color);
      }
      for (const [m, mesh] of meshes.entries()) {
        mesh.setMatrixAt(index, matrix);
        if (m === 0) mesh.setColorAt(index, color);
      }
    };
    for (const gift of physics.gifts) {
      const p = gift.body.position;
      const q = gift.body.quaternion;
      draw(gift, this.matrix.compose(this.position.set(p.x, p.y, p.z), this.quaternion.set(q.x, q.y, q.z, q.w), this.scale.set(1, 1, 1)));
    }
    for (let i = this.leaving.length - 1; i >= 0; i--) {
      const leaving = this.leaving[i];
      leaving.shrink -= delta;
      if (leaving.shrink <= 0) {
        this.leaving.splice(i, 1);
        continue;
      }
      const s = leaving.shrink / SHRINK_TIME;
      draw(leaving.gift, this.matrix.copy(leaving.matrix).multiply(new Matrix4().makeScale(s, s, s)));
    }
    for (const [k, meshes] of this.gifts.entries()) {
      for (const mesh of meshes) {
        mesh.count = Math.min(counts[k], GIFT.max * 2);
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    }
  }

  clear(): void {
    this.puffs.length = 0;
    this.leaving.length = 0;
  }

  dispose(): void {
    for (const mesh of [...this.snowballs, ...this.chunks, ...this.gifts.flat()]) mesh.geometry.dispose();
    this.root.removeFromParent();
  }
}
