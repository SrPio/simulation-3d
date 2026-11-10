import type { Point2 } from './collisions.ts';

/**
 * Christmas: where the snow on the ground is and how what is pressed into it fades. The sleigh's runner marks are drawn
 * into a texture over the whole map (`texels` per metre) and fade out evenly over `fade` seconds, a step every `tick`
 * seconds; the shoe prints are their own decals (SnowPrints, `PRINTS`).
 */
export const SNOW = { texels: 24, fade: 4, tick: 0.25 } as const;
/**
 * The character's sneaker sole as it presses into the snow (metres, measured on ShoeSole_* of the web V4 rig): `length`
 * heel to toe, `width` across the ball of the foot and `heel` across the heel, its corners rounded by `corner`
 * (SnowPrints draws it). On the ground the sole's middle is `ahead` of the ankle (the foot
 * bone) and `out` to its outer side, and the toes turn out by `toeOut` (radians).
 */
export const SOLE = { length: 0.55, width: 0.272, heel: 0.2, corner: 0.075, ahead: 0.13, out: 0.025, toeOut: 0.13 } as const;

/**
 * How anything pressed into the snow looks (the shoe prints and the sleigh's runner marks), softly, like an inset
 * button: a light grey a little darker than the snow (`floor`, drawn at `alpha` over it), an inner shadow along the edge
 * nearest the light and a faint highlight along the far one, `depth` metres wide. The light comes from `light` on the
 * ground (x, z), which is the top left of the screen in the game's isometric view.
 */
export const MARK = { floor: 0xbcc6d8, shadow: 0x8995ae, highlight: 0xf7f9fe, alpha: 0.85, depth: 0.06, light: [-1, 0] } as const;

/** How much each fade tick takes away (the texture holds 0…1): a mark goes in SNOW.fade seconds. */
export const fadeStep = (): number => SNOW.tick / SNOW.fade;

/** Distance from a point to a polyline. */
export function distanceToLine(point: Point2, line: readonly Point2[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i];
    const b = line[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = dx * dx + dz * dz;
    const t = length > 0 ? Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.z - a.z) * dz) / length)) : 0;
    best = Math.min(best, Math.hypot(point.x - (a.x + dx * t), point.z - (a.z + dz * t)));
  }
  return best;
}

/** The ground without snow: the circuit's road (its middle line and width), the room's platform and round spots (the crossroads green). */
export type BareGround = {
  road?: { line: readonly Point2[]; width: number };
  platform?: { minX: number; maxX: number; minZ: number; maxZ: number };
  spots?: readonly { x: number; z: number; radius: number }[];
};

/** Whether there is snow at this point to leave a print in. */
export function snowAt(point: Point2, bare: BareGround): boolean {
  const { platform, road, spots } = bare;
  if (platform && point.x >= platform.minX && point.x <= platform.maxX && point.z >= platform.minZ && point.z <= platform.maxZ) return false;
  for (const spot of spots ?? []) if (Math.hypot(point.x - spot.x, point.z - spot.z) < spot.radius) return false;
  if (road && distanceToLine(point, road.line) < road.width / 2) return false;
  return true;
}

/**
 * Where a sole print goes for a foot on the ground: from its ankle (the foot bone's ground point), the sole's middle a
 * little ahead and outwards, turned like the character (`yaw`, 0 faces +Z) with the toes a little out.
 */
export function printSpot(ankle: Point2, yaw: number, left: boolean): { x: number; z: number; heading: number } {
  // The character's right is (-cos, sin) on the ground when it faces (sin, cos); a left foot's outer side is its left.
  const out = (left ? -1 : 1) * SOLE.out;
  const heading = yaw + (left ? SOLE.toeOut : -SOLE.toeOut);
  return {
    x: ankle.x + Math.sin(heading) * SOLE.ahead - Math.cos(yaw) * out,
    z: ankle.z + Math.cos(heading) * SOLE.ahead + Math.sin(yaw) * out,
    heading,
  };
}

/** A print's strength after `seconds` (1 fresh, 0 gone), as the fading texture shows it. */
export function printLeft(seconds: number): number {
  const ticks = Math.floor(seconds / SNOW.tick);
  return Math.max(0, 1 - ticks * fadeStep());
}
