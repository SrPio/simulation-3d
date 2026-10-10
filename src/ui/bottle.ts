/**
 * The nitro's contour soda bottle as a flat silhouette for the on-screen gauge: the same half outline the 3D bottle is
 * turned from (`BOTTLE_PROFILE` in scripts/blender/create_circuit.py, `tests/nitro.test.ts` keeps them equal), as
 * (height from the base, radius), both as fractions of its length, mirrored round its axis and standing mouth up.
 */
export const BOTTLE_PROFILE: readonly (readonly [number, number])[] = [
  [0.0, 0.0], [0.02, 0.114], [0.07, 0.147], [0.22, 0.121], [0.32, 0.13], [0.44, 0.143], [0.54, 0.143],
  [0.62, 0.129], [0.7, 0.111], [0.78, 0.08], [0.86, 0.063], [0.92, 0.06], [0.935, 0.07], [1.0, 0.046], [1.0, 0.0],
];

/** Silhouette units per bottle length: the base sits at y = BOTTLE_UNITS and the mouth at y = 0 (SVG y points down). */
export const BOTTLE_UNITS = 100;

/** How high a full tank fills the bottle (a fraction of its length): into the neck, as a new soda. */
export const BOTTLE_FULL = 0.9;

/** The closed SVG path of the bottle standing up: up the right side from the base, across the mouth, down the left. */
export function bottlePath(): string {
  const side = BOTTLE_PROFILE.filter(([, r]) => r > 0).map(([h, r]) => [r * BOTTLE_UNITS, (1 - h) * BOTTLE_UNITS] as const);
  const right = side.map(([x, y]) => `${fixed(x)} ${fixed(y)}`);
  const left = [...side].reverse().map(([x, y]) => `${fixed(-x)} ${fixed(y)}`);
  return `M0 ${BOTTLE_UNITS} L${right.join(' L')} L${left.join(' L')} Z`;
}

/** Where the cola's surface stands in silhouette units for a fuel of 0…1. */
export function liquidLevel(fuel: number): number {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(fuel) ? fuel : 0));
  return (1 - clamped * BOTTLE_FULL) * BOTTLE_UNITS;
}

const fixed = (value: number) => Number(value.toFixed(2)).toString();
