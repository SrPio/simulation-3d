type Vec = { x: number; y: number; z: number };

/**
 * The Santa hat's bobble: a weight on a short cord from the hat's tip, swinging as the head moves. `length` is the
 * cord the swing behaves as if it hung from (longer than the drawn one: a slower, softer swing), `damping` how fast a
 * swing dies down (1/s), `limit` how far from straight down it may swing (radians) before it would reach into the hat.
 */
export const POMPOM = { length: 0.2, damping: 5, limit: 1.9, gravity: 9.8, maxStep: 1 / 120 } as const;

/** Where the bobble is (a point `length` from the tip) and how it moves, in the world. */
export type PompomState = { bob: Vec; velocity: Vec };

/** A bobble hanging still under the tip. */
export function pompomAt(tip: Vec): PompomState {
  return { bob: { x: tip.x, y: tip.y - POMPOM.length, z: tip.z }, velocity: { x: 0, y: 0, z: 0 } };
}

/**
 * Advance the bobble by `delta` seconds with the hat's tip now at `tip`: gravity pulls it, the cord keeps it `length`
 * from the tip (so the tip moving drags it and it swings behind), damping settles it, and it never swings further than
 * `limit` from straight down. Sub-stepped and safe for long frames. Returns the unit direction from the tip to the bobble.
 */
export function pompomStep(state: PompomState, tip: Vec, delta: number): Vec {
  const steps = Math.max(1, Math.min(8, Math.ceil(delta / POMPOM.maxStep)));
  const dt = Math.min(delta, 0.1) / steps;
  const keep = Math.exp(-POMPOM.damping * dt);
  const { bob, velocity } = state;
  for (let i = 0; i < steps; i++) {
    velocity.y -= POMPOM.gravity * dt;
    velocity.x *= keep;
    velocity.y *= keep;
    velocity.z *= keep;
    const before = { ...bob };
    bob.x += velocity.x * dt;
    bob.y += velocity.y * dt;
    bob.z += velocity.z * dt;
    // The cord: back to its length from the tip, and no limp past the swing limit.
    let dx = bob.x - tip.x;
    let dy = bob.y - tip.y;
    let dz = bob.z - tip.z;
    const length = Math.hypot(dx, dy, dz) || 1;
    dx /= length;
    dy /= length;
    dz /= length;
    const angle = Math.acos(Math.min(1, Math.max(-1, -dy)));
    if (angle > POMPOM.limit) {
      const across = Math.hypot(dx, dz) || 1;
      const s = Math.sin(POMPOM.limit);
      dx = (dx / across) * s;
      dz = (dz / across) * s;
      dy = -Math.cos(POMPOM.limit);
    }
    bob.x = tip.x + dx * POMPOM.length;
    bob.y = tip.y + dy * POMPOM.length;
    bob.z = tip.z + dz * POMPOM.length;
    // Velocity from what the cord left (position based), so dragging the tip makes it swing.
    if (dt > 0) {
      velocity.x = (bob.x - before.x) / dt;
      velocity.y = (bob.y - before.y) / dt;
      velocity.z = (bob.z - before.z) / dt;
    }
  }
  const dx = bob.x - tip.x;
  const dy = bob.y - tip.y;
  const dz = bob.z - tip.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  return { x: dx / length, y: dy / length, z: dz / length };
}
