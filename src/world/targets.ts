import type { Point2 } from './collisions.ts';

/** Throws per round: as many as there can be thrown laptops at once (MAX_THROWN), so a whole round stays on the lane. */
export const ROUND_THROWS = 3;

/**
 * Points for a hit `distance` metres from a disc's centre: the innermost ring that holds it. `rings` are radii from the
 * outside in and `points` what each is worth; outside the disc scores nothing.
 */
export function ringPoints(distance: number, rings: readonly number[], points: readonly number[]): number {
  let score = 0;
  for (const [index, radius] of rings.entries()) if (distance <= radius) score = points[index] ?? score;
  return score;
}

/** Where a throw counts: behind the line (towards +Z, up to `depth` metres) and between the lane's sides. */
export type Lane = { minX: number; maxX: number; lineZ: number; depth: number };

export function behindLine(point: Point2, lane: Lane): boolean {
  return point.x >= lane.minX && point.x <= lane.maxX && point.z >= lane.lineZ && point.z <= lane.lineZ + lane.depth;
}

/**
 * Score of the targets lane: rounds of ROUND_THROWS throws from behind the line. A throw from anywhere else does not
 * count and neither do its hits; the first counted throw after a full round starts a new one at 0.
 */
export class TargetGame {
  score = 0;
  throws = 0;
  /** Targets hit this round. */
  hits = 0;

  /** A laptop leaves the hand at `from`; returns whether the throw counts for the round. */
  throwFrom(from: Point2, lane: Lane): boolean {
    if (!behindLine(from, lane)) return false;
    if (this.throws >= ROUND_THROWS) this.reset();
    this.throws++;
    return true;
  }

  /** A counted throw's laptop hit a target: returns the points it adds. */
  hit(distance: number, rings: readonly number[], points: readonly number[]): number {
    const value = ringPoints(distance, rings, points);
    if (value > 0) {
      this.score += value;
      this.hits++;
    }
    return value;
  }

  reset(): void {
    this.score = 0;
    this.throws = 0;
    this.hits = 0;
  }
}
