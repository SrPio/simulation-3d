import type { Plate } from '../scene/outsideData.ts';
import type { Point2 } from './collisions.ts';

/** How far past its edge the character may drift before leaving the plate it is on (no flicker at the border). */
export const PLATE_MARGIN = 0.15;

function inside(point: Point2, plate: Plate, margin: number): boolean {
  const dx = point.x - plate.position.x;
  const dz = point.z - plate.position.z;
  const along = dx * plate.axisX.x + dz * plate.axisX.z;
  const across = dx * plate.axisZ.x + dz * plate.axisZ.z;
  return Math.abs(along) <= plate.halfX + margin && Math.abs(across) <= plate.halfZ + margin;
}

/**
 * The plate the character stands on. Entering needs the centre on the plate itself; once on it the
 * plate stays current until the centre is PLATE_MARGIN past its edge.
 */
export function plateAt(point: Point2, plates: readonly Plate[], current?: string): Plate | undefined {
  const held = plates.find((plate) => plate.id === current);
  if (held && inside(point, held, PLATE_MARGIN)) return held;
  return plates.find((plate) => inside(point, plate, 0));
}
