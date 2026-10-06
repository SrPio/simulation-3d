import type { Point2 } from './collisions.ts';

/** How far a floor key sinks when stepped on (m), and how quickly it goes down and comes back up (1/s). */
export const KEY_SINK = 0.2;
const PRESS_RATE = 18;
const RELEASE_RATE = 9;

/** A key fixed on the floor: its centre, turn about +Y and half sizes of its cap on the ground. */
export type FloorKey = { center: Point2; yaw: number; halfX: number; halfZ: number };

/** Whether a foot circle (the character at `point`, radius `radius`) is on a key's cap. */
export function onKey(point: Point2, key: FloorKey, radius: number): boolean {
  const dx = point.x - key.center.x;
  const dz = point.z - key.center.z;
  // Into the key's own axes (three.js yaw about +Y: local X runs along (cos, -sin)).
  const c = Math.cos(key.yaw);
  const s = Math.sin(key.yaw);
  const along = dx * c - dz * s;
  const across = dx * s + dz * c;
  const nx = Math.max(-key.halfX, Math.min(key.halfX, along));
  const nz = Math.max(-key.halfZ, Math.min(key.halfZ, across));
  return Math.hypot(along - nx, across - nz) < radius;
}

/**
 * Press depth 0 (up) … 1 (down) one frame later: a quick press while something stands on the key, a slower
 * spring back up when it leaves, like a real keyboard. Reduced motion jumps straight to the end.
 */
export function pressStep(depth: number, pressed: boolean, delta: number, instant = false): number {
  const target = pressed ? 1 : 0;
  if (instant) return target;
  const rate = pressed ? PRESS_RATE : RELEASE_RATE;
  const next = depth + (target - depth) * (1 - Math.exp(-delta * rate));
  return Math.abs(next - target) < 1e-3 ? target : next;
}
