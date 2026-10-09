import { DynamicDrawUsage, Group, InstancedMesh, Matrix4, Mesh, Quaternion, Vector3, type BufferGeometry, type Material, type Object3D } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Body } from 'cannon-es';
import type { BlobShadows } from './BlobShadows.ts';
import { CHICK, MAX_CHICKS, type PropPhysics } from '../world/PropPhysics.ts';

/** A shower: how many chicks, over how long (s), how far round the character (m) and from how high above the ground. */
export const RAIN = { count: 20, time: 2.2, near: 0.9, far: 4.5, low: 6, high: 9 } as const;
/** Seconds a chick takes to shrink away when a newer shower pushes it out. */
const SHRINK_TIME = 0.35;

type Vec = { x: number; y: number; z: number };
/** One chick leaving the sky: where its feet start, its heading, its fall and its tumble. */
export type ChickDrop = { feet: Vec; yaw: number; velocity: Vec; spin: Vec };

/** A chick dropped somewhere round `center` (never right on top of the character), falling and tumbling a little. */
export function chickDrop(random: () => number, center: { x: number; z: number }, groundY: number): ChickDrop {
  const angle = random() * Math.PI * 2;
  // Even over the ring's area, not bunched at its inner edge.
  const distance = Math.sqrt(RAIN.near ** 2 + random() * (RAIN.far ** 2 - RAIN.near ** 2));
  const spread = () => (random() - 0.5) * 2;
  return {
    feet: { x: center.x + Math.cos(angle) * distance, y: groundY + RAIN.low + random() * (RAIN.high - RAIN.low), z: center.z + Math.sin(angle) * distance },
    yaw: random() * Math.PI * 2,
    velocity: { x: spread() * 0.6, y: -1 - random() * 2, z: spread() * 0.6 },
    spin: { x: spread() * 3, y: spread() * 4, z: spread() * 3 },
  };
}

/**
 * The Konami code's chick shower: the chick model drawn as one instanced mesh per material, every copy following its
 * physics body (PropPhysics.dropChick: a self-righting ball, so they bounce, roll and end up on their feet), each
 * with a blob shadow. A new shower adds to what is there; past MAX_CHICKS the oldest shrink away. Restablecer clears them.
 */
export class ChickRain {
  readonly root = new Group();
  private readonly meshes: InstancedMesh[] = [];
  private readonly bodies: Body[] = [];
  private readonly leaving: { matrix: Matrix4; shrink: number }[] = [];
  private queue: { at: number; drop: ChickDrop }[] = [];
  private clock = 0;
  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly quaternion = new Quaternion();
  private readonly scale = new Vector3(1, 1, 1);
  private readonly offset = new Vector3();
  private readonly shadows: BlobShadows | undefined;
  private readonly shadowStart: number;
  private readonly groundY: number;

  constructor(model: Object3D, shadows: BlobShadows | undefined, shadowStart: number, groundY: number) {
    this.root.name = 'ChickRain';
    this.shadows = shadows;
    this.shadowStart = shadowStart;
    this.groundY = groundY;
    model.updateMatrixWorld(true);
    const parts = new Map<Material, BufferGeometry[]>();
    model.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      const geometry = object.geometry.clone().applyMatrix4(object.matrixWorld);
      for (const name of Object.keys(geometry.attributes)) if (name !== 'position' && name !== 'normal') geometry.deleteAttribute(name);
      const material = object.material as Material;
      parts.set(material, [...(parts.get(material) ?? []), geometry]);
    });
    // Twice the cap: the ones shrinking away are still drawn while new ones fall.
    const capacity = MAX_CHICKS * 2;
    for (const [material, geometries] of parts) {
      const merged = geometries.length > 1 ? mergeGeometries(geometries, false) : geometries[0];
      if (!merged) continue;
      for (const geometry of geometries) if (geometry !== merged) geometry.dispose();
      const mesh = new InstancedMesh(merged, material, capacity);
      mesh.name = `Chicks_${material.name}`;
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.count = 0;
      // They spread over the ground round the character: never culled as one small box.
      mesh.frustumCulled = false;
      this.meshes.push(mesh);
      this.root.add(mesh);
    }
  }

  /** Chicks on screen, falling, sitting or shrinking away. */
  get count(): number {
    return this.bodies.length + this.leaving.length;
  }

  /** A shower round `center`: RAIN.count chicks over RAIN.time seconds. */
  start(center: { x: number; z: number }, random: () => number = Math.random): void {
    for (let i = 0; i < RAIN.count; i++) {
      this.queue.push({ at: this.clock + (i / RAIN.count) * RAIN.time + random() * 0.08, drop: chickDrop(random, center, this.groundY) });
    }
    this.queue.sort((a, b) => a.at - b.at);
  }

  /** Drop the chicks that are due, then put every copy where its body is (and the leaving ones where they were). */
  update(delta: number, physics: PropPhysics): void {
    this.clock += delta;
    while (this.queue.length && this.queue[0].at <= this.clock) {
      const { drop } = this.queue.shift()!;
      this.bodies.push(physics.dropChick(drop.feet, drop.yaw, drop.velocity, drop.spin) as unknown as Body);
    }
    for (const body of physics.retiredChicks.splice(0)) {
      const index = this.bodies.indexOf(body as unknown as Body);
      if (index < 0) continue;
      this.bodies.splice(index, 1);
      this.leaving.push({ matrix: this.poseOf(body as unknown as Body).clone(), shrink: 0 });
    }
    let slot = 0;
    for (const body of this.bodies) {
      this.place(slot, this.poseOf(body));
      this.shadow(slot++, body.position.x, body.position.y, body.position.z, 1);
    }
    for (const entry of this.leaving) entry.shrink += delta;
    for (const [k, entry] of [...this.leaving.entries()].reverse()) if (entry.shrink >= SHRINK_TIME) this.leaving.splice(k, 1);
    for (const entry of this.leaving) {
      const size = Math.max(0.001, 1 - entry.shrink / SHRINK_TIME);
      entry.matrix.decompose(this.position, this.quaternion, this.scale);
      this.place(slot, this.matrix.compose(this.position, this.quaternion, this.scale.setScalar(size)));
      this.shadow(slot++, this.position.x, this.position.y + CHICK.centre, this.position.z, size);
    }
    this.scale.set(1, 1, 1);
    for (const mesh of this.meshes) {
      mesh.count = slot;
      mesh.instanceMatrix.needsUpdate = true;
    }
    if (this.shadows) for (let index = slot; index < MAX_CHICKS; index++) this.shadows.hide(this.shadowStart + index);
  }

  /** Every chick gone at once (Restablecer: the physics has already removed their bodies). */
  clear(): void {
    this.bodies.length = 0;
    this.leaving.length = 0;
    this.queue = [];
    for (const mesh of this.meshes) mesh.count = 0;
    if (this.shadows) for (let index = 0; index < MAX_CHICKS; index++) this.shadows.hide(this.shadowStart + index);
  }

  /** The model's pose for a body: its origin (the feet) below the body's centre of mass. */
  private poseOf(body: Body): Matrix4 {
    this.quaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
    this.offset.set(0, CHICK.centre - CHICK.low, 0).applyQuaternion(this.quaternion);
    this.position.set(body.position.x, body.position.y, body.position.z).sub(this.offset);
    return this.matrix.compose(this.position, this.quaternion, this.scale.set(1, 1, 1));
  }

  private place(slot: number, matrix: Matrix4): void {
    for (const mesh of this.meshes) mesh.setMatrixAt(slot, matrix);
  }

  /** A soft shadow under a chick, fainter and smaller the higher it is (the slots past MAX_CHICKS have none). */
  private shadow(slot: number, x: number, y: number, z: number, size: number): void {
    if (!this.shadows || slot >= MAX_CHICKS) return;
    const lift = Math.max(0, y - CHICK.centre - this.groundY);
    const fade = Math.max(0, 1 - lift / 4);
    this.shadows.set(this.shadowStart + slot, x, z, 0, 0.42 * size * (0.6 + 0.4 * fade), 0.42 * size * (0.6 + 0.4 * fade), 0.45 * fade * fade * size);
  }

  dispose(): void {
    for (const mesh of this.meshes) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
    this.root.removeFromParent();
  }
}
