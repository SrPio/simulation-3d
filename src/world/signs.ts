import type { Sign, SignArea } from '../scene/outsideData.ts';
import type { Point2 } from './collisions.ts';

/** How far past its edge the character may drift before leaving the zone it is in (no flicker at the border). */
export const AREA_MARGIN = 0.15;

export function insideArea(point: Point2, area: SignArea, margin = 0): boolean {
  const dx = point.x - area.center.x;
  const dz = point.z - area.center.z;
  const along = dx * area.axisX.x + dz * area.axisX.z;
  const across = dx * area.axisZ.x + dz * area.axisZ.z;
  return Math.abs(along) <= area.halfX + margin && Math.abs(across) <= area.halfZ + margin;
}

/**
 * The sign whose floor zone the character is in. Entering needs the centre inside the zone itself;
 * once in, the zone stays current until the centre is AREA_MARGIN past its edge.
 */
export function signAt(point: Point2, signs: readonly Sign[], current?: string): Sign | undefined {
  const held = signs.find((sign) => sign.id === current);
  if (held && insideArea(point, held.area, AREA_MARGIN)) return held;
  return signs.find((sign) => insideArea(point, sign.area));
}
