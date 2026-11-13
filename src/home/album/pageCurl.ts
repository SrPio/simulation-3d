/**
 * The shape of a page as it turns (pure, for PageFlip.ts and tests). The page is cut into vertical strips from the
 * spine to its free edge; strip 0 turns about the spine and each next strip turns a little more about the previous
 * strip's far edge, so the paper curls: the free edge leads the way over, most at mid-turn, and lies flat at either end.
 *
 * `progress` is 0 with the page flat on the right, 1 flat on the left. Angles are how far each strip has turned from
 * flat on the right (0 … π) about the vertical axis.
 */

export const CURL = {
  /** Strips per page: more is smoother and costs more page copies while it turns. */
  strips: 12,
  /** How far ahead (rad) the free edge is of the spine at mid-turn, before the turn's own angle. */
  bend: 0.62,
  /** Seconds a whole turn takes when let go or clicked. */
  duration: 0.85,
} as const;

/** Each strip's turn (rad), from the spine to the free edge. */
export function stripAngles(progress: number, strips: number = CURL.strips, bend: number = CURL.bend): number[] {
  const p = Math.min(1, Math.max(0, progress));
  const turn = p * Math.PI;
  const lift = Math.sin(p * Math.PI) * bend;
  const angles: number[] = [];
  for (let i = 0; i < strips; i++) {
    const along = strips > 1 ? i / (strips - 1) : 0.5;
    angles.push(Math.min(Math.PI, Math.max(0, turn - lift + 2 * lift * along)));
  }
  return angles;
}

/** The turn of each strip relative to the one before it (the nested strips' own rotations). */
export function relativeAngles(angles: readonly number[]): number[] {
  return angles.map((angle, i) => (i === 0 ? angle : angle - angles[i - 1]));
}

/**
 * Where the free edge shows across the book, seen from straight ahead: its distance from the spine in page widths,
 * positive over the right page, negative over the left. The shadow on the page below follows it.
 */
export function edgeAt(angles: readonly number[]): number {
  return angles.reduce((sum, angle) => sum + Math.cos(angle), 0) / angles.length;
}

/** How dark a strip's face is: none facing the reader, darkest edge-on. */
export function stripShade(angle: number): number {
  return (1 - Math.abs(Math.cos(angle))) * 0.5;
}

/** Ease in and out of a turn (smoothstep). */
export const ease = (t: number): number => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};
