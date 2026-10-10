/**
 * A safety tape as a rope (Verlet integration with distance constraints): taut and straight between its two posts
 * until something cuts it; then each half hangs from its post, the cut ends whip back with the released tension, get
 * shoved along by what went through, fall and settle on the ground in loose curves. Pure numbers, no three.js.
 */

export type Point3 = { x: number; y: number; z: number };
type Node = { p: Point3; prev: Point3 };

export const ROPE = {
  /** Nodes along the whole tape. */
  nodes: 33,
  /** Each segment rests this much shorter than when taut: the halves pull back towards their posts once cut. */
  slack: 0.97,
  gravity: 9.82,
  /** Velocity kept per second in the air (a ribbon slows in the air). */
  airKeep: 0.35,
  /** Horizontal velocity kept per second while touching the ground. */
  groundKeep: 0.002,
  /** The cut ends' whip back towards the posts and how hard what went through shoves the tape near the cut (m/s). */
  recoil: 3.4,
  push: 1.2,
  /** Random wobble given to each node when cut, so no two tapes land alike (m/s). */
  jitter: 0.7,
  /** A smooth sideways swing along each half (m/s at its peak, waves along the half): it lands in curves, not straight. */
  curl: 1.6,
  waves: 1.6,
  iterations: 12,
  step: 1 / 120,
  /** Asleep once nothing moved more than this (m) for `rest` seconds. */
  still: 2e-4,
  rest: 0.6,
} as const;

/** A tiny seeded random generator (mulberry32), so a tape's fall is repeatable in tests. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class TapeRope {
  /** The chains drawn: one straight run while whole, two (each from its post) once cut. */
  chains: Point3[][];
  private nodes: Node[][] = [];
  private readonly a: Point3;
  private readonly b: Point3;
  private readonly ground: number;
  private segment = 0;
  private quiet = 0;
  private carry = 0;
  /** Moving (needs stepping and redrawing). */
  active = false;
  cut = false;

  constructor(a: Point3, b: Point3, ground: number) {
    this.a = { ...a };
    this.b = { ...b };
    this.ground = ground;
    this.chains = [this.straight()];
  }

  private straight(): Point3[] {
    const n = ROPE.nodes;
    return Array.from({ length: n }, (_, i) => {
      const t = i / (n - 1);
      return { x: this.a.x + (this.b.x - this.a.x) * t, y: this.a.y + (this.b.y - this.a.y) * t, z: this.a.z + (this.b.z - this.a.z) * t };
    });
  }

  /** Whole and taut again. */
  reset(): void {
    this.cut = false;
    this.active = false;
    this.nodes = [];
    this.chains = [this.straight()];
  }

  /**
   * Cut at `at` (0 at the first post … 1 at the second), shoved along `push` (a horizontal direction, its length the
   * speed of what went through in m/s), with a seed for the wobble.
   */
  cutAt(at: number, push: { x: number; z: number }, seed = 1): void {
    if (this.cut) return;
    this.cut = true;
    this.active = true;
    this.quiet = 0;
    const random = seeded(seed);
    const points = this.straight();
    const n = points.length;
    const k = Math.min(n - 3, Math.max(2, Math.round(at * (n - 1))));
    const length = Math.hypot(this.b.x - this.a.x, this.b.y - this.a.y, this.b.z - this.a.z);
    this.segment = (length / (n - 1)) * ROPE.slack;
    const speed = Math.min(Math.hypot(push.x, push.z), 6);
    const along = speed > 1e-6 ? { x: push.x / Math.hypot(push.x, push.z), z: push.z / Math.hypot(push.x, push.z) } : { x: 0, z: 0 };
    const chain = (indices: number[]): Node[] => {
      const phase = random() * Math.PI * 2;
      const waves = ROPE.waves * (0.7 + random() * 0.6);
      return indices.map((index, i) => {
        const p = points[index];
        const post = points[indices[0]];
        // Further from the post, the stronger the whip back, the shove of what went through and the sideways swing.
        const reach = i / (indices.length - 1);
        const back = { x: post.x - p.x, z: post.z - p.z };
        const backLength = Math.hypot(back.x, back.z) || 1;
        // Sideways: across the tape on the ground.
        const side = { x: -back.z / backLength, z: back.x / backLength };
        const swing = Math.sin(reach * waves * Math.PI * 2 + phase) * ROPE.curl * reach;
        const v = {
          x: (back.x / backLength) * ROPE.recoil * reach * reach + along.x * speed * ROPE.push * reach + side.x * swing + (random() - 0.5) * ROPE.jitter * reach,
          y: (random() - 0.3) * ROPE.jitter * reach,
          z: (back.z / backLength) * ROPE.recoil * reach * reach + along.z * speed * ROPE.push * reach + side.z * swing + (random() - 0.5) * ROPE.jitter * reach,
        };
        return { p: { ...p }, prev: { x: p.x - v.x * ROPE.step, y: p.y - v.y * ROPE.step, z: p.z - v.z * ROPE.step } };
      });
    };
    const first = Array.from({ length: k + 1 }, (_, i) => i);
    const second = Array.from({ length: n - k - 1 }, (_, i) => n - 1 - i);
    this.nodes = [chain(first), chain(second)];
    this.chains = this.nodes.map((nodes) => nodes.map((node) => node.p));
  }

  /** Advance by `dt` seconds (fixed sub-steps). Returns whether it is still moving. */
  update(dt: number): boolean {
    if (!this.active) return false;
    this.carry += Math.min(dt, 0.1);
    while (this.carry >= ROPE.step && this.active) {
      this.carry -= ROPE.step;
      this.subStep();
    }
    return this.active;
  }

  /** Run until it settles (or `limit` seconds): for reduced motion, the tape lies straight where it falls. */
  settle(limit = 6): void {
    for (let t = 0; t < limit && this.active; t += ROPE.step) this.subStep();
  }

  private subStep(): void {
    const h = ROPE.step;
    const air = Math.pow(ROPE.airKeep, h);
    const grip = Math.pow(ROPE.groundKeep, h);
    const floor = this.ground + 0.004;
    let moved = 0;
    for (const nodes of this.nodes) {
      for (let i = 1; i < nodes.length; i++) {
        const { p, prev } = nodes[i];
        const onGround = p.y <= floor + 1e-3;
        const keep = onGround ? grip : air;
        const vx = (p.x - prev.x) * keep;
        const vy = (p.y - prev.y) * air;
        const vz = (p.z - prev.z) * keep;
        prev.x = p.x;
        prev.y = p.y;
        prev.z = p.z;
        p.x += vx;
        p.y += vy - ROPE.gravity * h * h;
        p.z += vz;
      }
      for (let k = 0; k < ROPE.iterations; k++) {
        // The post end stays put; each segment keeps its length.
        for (let i = 0; i < nodes.length - 1; i++) {
          const a = nodes[i].p;
          const b = nodes[i + 1].p;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dz = b.z - a.z;
          const d = Math.hypot(dx, dy, dz) || 1e-9;
          const diff = (d - this.segment) / d;
          if (i === 0) {
            b.x -= dx * diff;
            b.y -= dy * diff;
            b.z -= dz * diff;
          } else {
            a.x += dx * diff * 0.5;
            a.y += dy * diff * 0.5;
            a.z += dz * diff * 0.5;
            b.x -= dx * diff * 0.5;
            b.y -= dy * diff * 0.5;
            b.z -= dz * diff * 0.5;
          }
        }
        for (const node of nodes) if (node.p.y < floor) node.p.y = floor;
      }
      for (const node of nodes) moved = Math.max(moved, Math.abs(node.p.x - node.prev.x), Math.abs(node.p.y - node.prev.y), Math.abs(node.p.z - node.prev.z));
    }
    this.quiet = moved < ROPE.still ? this.quiet + h : 0;
    if (this.quiet >= ROPE.rest) this.active = false;
  }
}
