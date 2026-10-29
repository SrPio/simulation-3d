/**
 * Halloween's little ghosts: each floats round its home, bobbing, and flees when the character comes near, then drifts
 * back once it has gone. Pure: the viewer draws them where this says.
 */
export const GHOST = {
  /** Closer than this (m) and a ghost flees. */
  scare: 3.4,
  /** How fast it flees and drifts home (m/s), and how far from home it may go. */
  flee: 3.2,
  home: 0.9,
  leash: 7,
  /** Its float: height of its middle over the ground and how much it bobs (m), and how often (rad/s). */
  height: 1.4,
  bob: 0.18,
  rate: 1.7,
  /** How quickly its speed follows what it wants (1/s). */
  ease: 3,
} as const;

export type Ghost = { home: { x: number; z: number }; x: number; z: number; vx: number; vz: number; yaw: number; phase: number };

export function ghostAt(home: { x: number; z: number }, phase: number): Ghost {
  return { home: { ...home }, x: home.x, z: home.z, vx: 0, vz: 0, yaw: 0, phase };
}

/**
 * One step of a ghost with the character at `from`: away from it while it is within GHOST.scare (never past
 * GHOST.leash from home), back home otherwise, its velocity easing towards that and its face turned the way it moves.
 */
export function fleeStep(ghost: Ghost, from: { x: number; z: number } | undefined, delta: number): void {
  let wantX = 0;
  let wantZ = 0;
  const dx = from ? ghost.x - from.x : 0;
  const dz = from ? ghost.z - from.z : 0;
  const near = from ? Math.hypot(dx, dz) : Infinity;
  const homeX = ghost.home.x - ghost.x;
  const homeZ = ghost.home.z - ghost.z;
  const away = Math.hypot(homeX, homeZ);
  if (near < GHOST.scare) {
    const scale = GHOST.flee / Math.max(near, 0.05);
    wantX = dx * scale;
    wantZ = dz * scale;
    // At the end of its leash it slides round instead of going further.
    if (away > GHOST.leash) {
      const outX = -homeX / away;
      const outZ = -homeZ / away;
      const out = wantX * outX + wantZ * outZ;
      if (out > 0) {
        wantX -= out * outX;
        wantZ -= out * outZ;
      }
    }
  } else if (away > 0.05) {
    const speed = Math.min(GHOST.home, away * 1.5);
    wantX = (homeX / away) * speed;
    wantZ = (homeZ / away) * speed;
  }
  const blend = 1 - Math.exp(-GHOST.ease * delta);
  ghost.vx += (wantX - ghost.vx) * blend;
  ghost.vz += (wantZ - ghost.vz) * blend;
  ghost.x += ghost.vx * delta;
  ghost.z += ghost.vz * delta;
  // Never past the end of its leash, however hard it was chased.
  const reach = Math.hypot(ghost.x - ghost.home.x, ghost.z - ghost.home.z);
  if (reach > GHOST.leash) {
    ghost.x = ghost.home.x + (ghost.x - ghost.home.x) * GHOST.leash / reach;
    ghost.z = ghost.home.z + (ghost.z - ghost.home.z) * GHOST.leash / reach;
  }
  if (Math.hypot(ghost.vx, ghost.vz) > 0.2) ghost.yaw = Math.atan2(ghost.vx, ghost.vz);
  ghost.phase += delta * GHOST.rate;
}

/** How high a ghost floats now: its middle over the ground, bobbing. */
export function ghostHeight(ghost: Ghost): number {
  return GHOST.height + Math.sin(ghost.phase) * GHOST.bob;
}
