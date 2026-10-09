type Vec = { x: number; y: number; z: number };
/** An axis-aligned box: the room's bounds. */
export type Bounds3 = { min: Vec; max: Vec };

/** Heights on the character the camera should see: its chest and head (m above its feet). */
export const REVEAL_POINTS = [0.9, 1.7];
/** Radius of the window opened in the room around the character (m, at the character's distance). */
export const REVEAL_RADIUS = 1.35;
/** Seconds the window takes to open or close. */
export const REVEAL_TIME = 0.25;

/** Whether the segment from `from` along `direction` (towards the camera) passes through `box`. */
export function rayHitsBox(from: Vec, direction: Vec, box: Bounds3): boolean {
  let near = 0;
  let far = Infinity;
  for (const axis of ['x', 'y', 'z'] as const) {
    const d = direction[axis];
    const lo = box.min[axis];
    const hi = box.max[axis];
    if (Math.abs(d) < 1e-9) {
      if (from[axis] < lo || from[axis] > hi) return false;
      continue;
    }
    let t1 = (lo - from[axis]) / d;
    let t2 = (hi - from[axis]) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    near = Math.max(near, t1);
    far = Math.min(far, t2);
    if (near > far) return false;
  }
  return far > 0;
}

/**
 * Whether the room hides the character from a camera looking along `-toCamera`: the character stands outside the room's
 * footprint and the line from its chest or head to the camera crosses the room. Inside the room (whose two walls stand
 * away from the camera) nothing is hidden.
 */
export function hiddenBehind(feet: Vec, toCamera: Vec, room: Bounds3): boolean {
  const inside = feet.x > room.min.x && feet.x < room.max.x && feet.z > room.min.z && feet.z < room.max.z;
  if (inside) return false;
  return REVEAL_POINTS.some((height) => rayHitsBox({ x: feet.x, y: feet.y + height, z: feet.z }, toCamera, room));
}

/** Ease the window's opening towards shut (0) or open (1) over REVEAL_TIME; at once with reduced motion. */
export function revealStep(amount: number, hidden: boolean, delta: number, reducedMotion: boolean): number {
  const target = hidden ? 1 : 0;
  if (reducedMotion) return target;
  const step = delta / REVEAL_TIME;
  return target > amount ? Math.min(target, amount + step) : Math.max(target, amount - step);
}
