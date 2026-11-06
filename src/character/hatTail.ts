import { BufferAttribute, Matrix4, Quaternion, Vector3, type BufferGeometry } from 'three';

/**
 * The Santa hat's red tail: it keeps its modelled shape and follows the head, and only sways a little, calmly, when
 * the head speeds up, slows down or tilts. Rings up to `free` sit on the head and only follow it; the rest are moved
 * by one smooth sway, most at the tip and none where the tail leaves the head (growing with the square of the way along):
 * - the sway is a critically damped spring (`frequency` rad/s, `damping` 1 = no wobble): driven by how the tail's root
 *   speeds up or slows down, it leans the tail back as the head sets off and forwards as it stops, once, then settles;
 * - the root's speed is smoothed over `smooth` seconds first, so the bob of every step does not shake it;
 * - it never sways further than `reach` (m, at the tip);
 * - tilting the head lets the tail fall towards the ground by `sag` (m at the tip for a quarter turn), since the
 *   modelled shape already hangs as it would standing straight;
 * - no point comes nearer the head's middle than it is in the modelled shape or than the head plus its own ring
 *   (`clear`), so the tail rests on the head instead of going through it, and none goes into the white fur cuff
 *   (`cuff`, an upright elliptic band round the head) either.
 */
export const TAIL = { frequency: 7, damping: 1, smooth: 0.18, reach: 0.16, sag: 0.11, clear: 0.6, maxStep: 1 / 120 } as const;

/** What the hat's GLB says about the tail (extras of ChristmasHat_Cap, in the hat's own axes). */
export type TailSpine = { spine: number[]; radii: number[]; free: number; head: number[]; cuff?: number[] };

/** The hat's fur cuff as an upright elliptic band (hat axes): middle x, z, reach to the side, ahead and behind, bottom and top. */
type Cuff = { x: number; z: number; side: number; ahead: number; behind: number; bottom: number; top: number };

const DOWN = new Vector3(0, -1, 0);
/** Over how many rings either side the push off the cuff fades out. */
const CUFF_SPREAD = 7;

export class HatTail {
  /** The spine as modelled (hat axes). */
  readonly rest: Vector3[];
  private readonly radii: number[];
  private readonly free: number;
  private readonly headCentre: Vector3;
  private readonly headRadius: number;
  private readonly cuff?: Cuff;
  private readonly outside: boolean[];
  private readonly nearest: number[];
  /** The chain now (world). */
  private readonly points: Vector3[];
  /** The sway at the tip and how it moves, the root's last place and its smoothed speed (world). */
  private readonly sway = new Vector3();
  private readonly swayVelocity = new Vector3();
  private readonly root = new Vector3();
  private readonly rootVelocity = new Vector3();
  private started = false;
  private readonly inverse = new Matrix4();

  constructor(data: TailSpine) {
    this.rest = [];
    for (let i = 0; i + 2 < data.spine.length; i += 3) this.rest.push(new Vector3(data.spine[i], data.spine[i + 1], data.spine[i + 2]));
    this.radii = data.radii;
    this.free = Math.max(1, Math.min(this.rest.length - 1, data.free));
    this.headCentre = new Vector3(data.head[0], data.head[1], data.head[2]);
    this.headRadius = data.head[3] ?? 0;
    const c = data.cuff;
    this.cuff = c && c.length === 7 ? { x: c[0], z: c[1], side: c[2], ahead: c[3], behind: c[4], bottom: c[5], top: c[6] } : undefined;
    // Only rings that hang outside the cuff in the modelled shape are kept out of it (the dome's sit over it).
    const cuff = this.cuff;
    this.outside = this.rest.map((point) => !!cuff
      && Math.hypot((point.x - cuff.x) / cuff.side, (point.z - cuff.z) / (point.z < cuff.z ? cuff.behind : cuff.ahead)) >= 1);
    this.nearest = this.rest.map((point, i) => Math.min(point.distanceTo(this.headCentre), this.headRadius + (this.radii[i] ?? 0) * TAIL.clear));
    this.points = this.rest.map((point) => point.clone());
  }

  get count(): number {
    return this.rest.length;
  }

  /** Put the tail back in its modelled shape on a hat whose world matrix is `matrix` (no motion). */
  reset(matrix: Matrix4): void {
    this.sway.set(0, 0, 0);
    this.swayVelocity.set(0, 0, 0);
    this.rootVelocity.set(0, 0, 0);
    this.root.copy(this.rest[this.free]).applyMatrix4(matrix);
    this.place(matrix);
    this.started = true;
  }

  /** Advance `delta` seconds with the hat (the head) now at world `matrix`. */
  step(delta: number, matrix: Matrix4): void {
    if (!this.started || delta <= 0) {
      if (!this.started) this.reset(matrix);
      return;
    }
    const time = Math.min(delta, 0.1);
    // How the root speeds up, from its smoothed speed (the bob of each step averaged away).
    const root = this.rest[this.free].clone().applyMatrix4(matrix);
    const velocity = root.clone().sub(this.root).divideScalar(time);
    this.root.copy(root);
    const before = this.rootVelocity.clone();
    this.rootVelocity.lerp(velocity, 1 - Math.exp(-time / TAIL.smooth));
    const accel = this.rootVelocity.clone().sub(before).divideScalar(time);
    // The sway: a critically damped spring pushed the other way to how the head speeds up.
    const steps = Math.max(1, Math.ceil(time / TAIL.maxStep));
    const dt = time / steps;
    const w = TAIL.frequency;
    const scale = new Vector3().setFromMatrixScale(matrix).x || 1;
    for (let s = 0; s < steps; s++) {
      const force = this.sway.clone().multiplyScalar(-w * w).addScaledVector(this.swayVelocity, -2 * TAIL.damping * w).sub(accel);
      this.swayVelocity.addScaledVector(force, dt);
      this.sway.addScaledVector(this.swayVelocity, dt);
    }
    const most = TAIL.reach * scale;
    if (this.sway.length() > most) {
      this.sway.setLength(most);
      // Along the stop it keeps nothing of its speed outwards, so it eases back.
      const out = this.sway.clone().normalize();
      const outward = this.swayVelocity.dot(out);
      if (outward > 0) this.swayVelocity.addScaledVector(out, -outward);
    }
    this.place(matrix);
  }

  /** The chain from the modelled shape on the head, the sway and the tilt, kept off the head. */
  private place(matrix: Matrix4): void {
    const scale = new Vector3().setFromMatrixScale(matrix).x || 1;
    // A tilted head lets the tail fall a little towards the ground.
    const hatDown = DOWN.clone().transformDirection(matrix);
    const fall = DOWN.clone().sub(hatDown).multiplyScalar(TAIL.sag * scale / Math.SQRT2);
    // Worked out in the hat's own axes (where the head and the cuff are), then put back in the world.
    this.inverse.copy(matrix).invert();
    const world = this.sway.clone().add(fall);
    const offset = world.clone().transformDirection(this.inverse).multiplyScalar(world.length() / scale);
    const span = this.points.length - this.free;
    const local = this.points.map((point, i) => {
      point.copy(this.rest[i]);
      if (i >= this.free) point.addScaledVector(offset, ((i - this.free + 1) / span) ** 2);
      return point;
    });
    this.keepOffCuff(local);
    for (const [i, point] of local.entries()) {
      if (i >= this.free) {
        const out = point.clone().sub(this.headCentre);
        const reach = out.length();
        if (reach < this.nearest[i] && reach > 1e-6) point.copy(this.headCentre).addScaledVector(out, this.nearest[i] / reach);
      }
      point.applyMatrix4(matrix);
    }
  }

  /**
   * Keep the hanging tail (hat axes) outside the white fur cuff, an upright elliptic band round the head, its own
   * ring's thickness away: each point that would sink into it says how far out it must go, and the tail is pushed out by
   * a smooth swell over that (fading over `CUFF_SPREAD` rings either side), so the push never kinks it.
   */
  private keepOffCuff(points: Vector3[]): void {
    const cuff = this.cuff;
    if (!cuff) return;
    const need = points.map((point, i) => {
      if (i < this.free || !this.outside[i]) return 0;
      const margin = (this.radii[i] ?? 0) + 0.01;
      if (point.y < cuff.bottom - margin || point.y > cuff.top + margin) return 0;
      const dx = point.x - cuff.x;
      const dz = point.z - cuff.z;
      const into = Math.hypot(dx / (cuff.side + margin), dz / ((dz < 0 ? cuff.behind : cuff.ahead) + margin));
      return into < 1 && into > 1e-6 ? Math.hypot(dx, dz) * (1 / into - 1) : 0;
    });
    if (!need.some((value) => value > 0)) return;
    for (const [i, point] of points.entries()) {
      let push = 0;
      for (const [j, value] of need.entries()) if (value > 0) push = Math.max(push, value * Math.max(0, 1 - Math.abs(i - j) / CUFF_SPREAD));
      if (push <= 0) continue;
      const dx = point.x - cuff.x;
      const dz = point.z - cuff.z;
      const length = Math.hypot(dx, dz) || 1;
      point.x += (dx / length) * push;
      point.z += (dz / length) * push;
    }
  }

  /** The chain in the hat's own axes (for drawing), given the hat's world `matrix`. */
  local(matrix: Matrix4): Vector3[] {
    this.inverse.copy(matrix).invert();
    return this.points.map((point) => point.clone().applyMatrix4(this.inverse));
  }

  /** The direction along the chain at point i (hat axes) for points `at`. */
  static tangent(at: readonly Vector3[], i: number): Vector3 {
    const a = at[Math.max(0, i - 1)];
    const b = at[Math.min(at.length - 1, i + 1)];
    return b.clone().sub(a).normalize();
  }

  /**
   * Tie a mesh of the hat to the chain: each vertex belongs to its ring (Blender's `_ring` attribute, or else the
   * spine point whose ring it lies on), kept as its offset from that point. Vertices on rings before `free` (the cuff and the dome) stay put.
   */
  bind(geometry: BufferGeometry): TailBinding {
    const position = geometry.getAttribute('position') as BufferAttribute;
    const normal = geometry.getAttribute('normal') as BufferAttribute | undefined;
    const tangents = this.rest.map((_, i) => HatTail.tangent(this.rest, i));
    const ring = new Int16Array(position.count).fill(-1);
    const offsets = new Float32Array(position.count * 3);
    const v = new Vector3();
    const d = new Vector3();
    // Blender says which ring each vertex is on (`_ring`, -1 off the tail); without it, the ring it lies across.
    const rings = (geometry.getAttribute('_ring') ?? geometry.getAttribute('_RING')) as BufferAttribute | undefined;
    for (let k = 0; k < position.count; k++) {
      v.fromBufferAttribute(position, k);
      if (rings) {
        const index = Math.round(rings.getX(k));
        if (index < this.free || index >= this.rest.length) continue;
        ring[k] = index;
        d.copy(v).sub(this.rest[index]);
        offsets.set([d.x, d.y, d.z], k * 3);
        continue;
      }
      let best = -1;
      let score = Infinity;
      for (let i = 0; i < this.rest.length; i++) {
        d.copy(v).sub(this.rest[i]);
        const along = Math.abs(d.dot(tangents[i]));
        const across = Math.sqrt(Math.max(0, d.lengthSq() - along * along));
        // On ring i a vertex lies in its plane and on its surface (as far out as the ring's radius).
        const value = along + Math.abs(across - (this.radii[i] ?? 0));
        if (value < score) {
          score = value;
          best = i;
        }
      }
      if (best < this.free) continue;
      ring[k] = best;
      d.copy(v).sub(this.rest[best]);
      offsets.set([d.x, d.y, d.z], k * 3);
    }
    return { geometry, ring, offsets, restNormals: normal ? Float32Array.from(normal.array as ArrayLike<number>) : undefined, tangents };
  }

  /** Move a bound mesh's tail vertices (and turn their normals) to follow the chain now at `at` (hat axes). */
  deform(binding: TailBinding, at: readonly Vector3[]): void {
    const { geometry, ring, offsets, restNormals, tangents } = binding;
    const position = geometry.getAttribute('position') as BufferAttribute;
    const normal = geometry.getAttribute('normal') as BufferAttribute | undefined;
    const turns = at.map((_, i) => (i < this.free ? undefined : new Quaternion().setFromUnitVectors(tangents[i], HatTail.tangent(at, i))));
    const d = new Vector3();
    for (let k = 0; k < ring.length; k++) {
      const i = ring[k];
      if (i < 0) continue;
      const turn = turns[i]!;
      d.set(offsets[k * 3], offsets[k * 3 + 1], offsets[k * 3 + 2]).applyQuaternion(turn).add(at[i]);
      position.setXYZ(k, d.x, d.y, d.z);
      if (normal && restNormals) {
        d.set(restNormals[k * 3], restNormals[k * 3 + 1], restNormals[k * 3 + 2]).applyQuaternion(turn);
        normal.setXYZ(k, d.x, d.y, d.z);
      }
    }
    position.needsUpdate = true;
    if (normal) normal.needsUpdate = true;
  }
}

/** A hat mesh tied to the tail (see HatTail.bind). */
export type TailBinding = {
  geometry: BufferGeometry;
  ring: Int16Array;
  offsets: Float32Array;
  restNormals?: Float32Array;
  tangents: Vector3[];
};
