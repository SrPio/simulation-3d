import type { Point2 } from './collisions.ts';

/** The about-me plaza's landmarks that make the character shout something about its author when it comes near. */
export type ShoutId = 'bust' | 'colombia' | 'univalle';
export const SHOUT_IDS: readonly ShoutId[] = ['bust', 'colombia', 'univalle'];

/** A landmark on the ground: its centre and the half sizes of its footprint (its blob shadow), axis aligned. */
export type ShoutSpot = { id: ShoutId; x: number; z: number; halfX: number; halfZ: number };

/** The shout starts within this distance of a landmark's footprint and stops SHOUT_MARGIN further out. */
export const SHOUT_REACH = 1.8;
export const SHOUT_MARGIN = 0.4;

const isShout = (kind: string): kind is ShoutId => (SHOUT_IDS as readonly string[]).includes(kind);

/** The landmarks among the outside's decor (decor kinds 'bust', 'colombia', 'univalle'). */
export function shoutSpots(decor: readonly { kind: string; position: { x: number; z: number }; shadow: [number, number] }[]): ShoutSpot[] {
  return decor.flatMap((item) => isShout(item.kind)
    ? [{ id: item.kind, x: item.position.x, z: item.position.z, halfX: item.shadow[0] / 2, halfZ: item.shadow[1] / 2 }]
    : []);
}

/** Distance from `point` to the spot's footprint (0 inside it). */
export function shoutDistance(point: Point2, spot: ShoutSpot): number {
  return Math.hypot(Math.max(Math.abs(point.x - spot.x) - spot.halfX, 0), Math.max(Math.abs(point.z - spot.z) - spot.halfZ, 0));
}

/**
 * The landmark the character at `point` shouts about: the nearest one in reach. The one already shouting (`current`)
 * keeps going until the character is SHOUT_MARGIN past the reach, so standing on the edge does not flicker.
 */
export function shoutAt(point: Point2, spots: readonly ShoutSpot[], current?: ShoutId): ShoutId | undefined {
  let best: ShoutSpot | undefined;
  let bestDistance = Infinity;
  for (const spot of spots) {
    const distance = shoutDistance(point, spot);
    const reach = SHOUT_REACH + (spot.id === current ? SHOUT_MARGIN : 0);
    if (distance <= reach && distance < bestDistance) {
      best = spot;
      bestDistance = distance;
    }
  }
  return best?.id;
}
