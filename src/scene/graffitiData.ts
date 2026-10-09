import { Raycaster, Vector3, type Object3D } from 'three';
import type { Language } from '../core/i18n.ts';
import type { PieceGroup } from './outsideData.ts';
import { SPRAY_SYMBOLS, type SpraySymbolName } from './sprayFont.ts';

/**
 * Graffiti painted on the outside: words or symbols sprayed onto a surface and left there. Each spot is one entry
 * in GRAFFITI; `Graffiti.ts` paints it with spray paint on a canvas and lays it on whatever static surface is at
 * `at` (projected like a decal, so it follows slopes and bevels), or flat on the ground when nothing is there.
 *
 * Adding one: pick a point on (or just in front of) a surface, the face it is painted on and a width, then add an
 * entry. Words come in both languages (one string when they read the same: commands, names, English-only jokes) and
 * repaint when the language changes, always whole: the paint's box fits the longer of the two. A spot with `loose`
 * is painted on the loose pieces of that group it covers (the bricks of a wall) and each piece carries its share. Faces follow the perspective rule (`tests/about.test.ts`): +X, +Z or up, the sides the corner camera sees;
 * text reads along +X on +Z faces and on the ground, along -Z on +X faces.
 */

/** Face the paint lies on: the +Z side, the +X side, or facing up (the ground, a ramp, a top). */
export type GraffitiFace = 'z' | 'x' | 'up';
/** Symbols drawn filled ('piece' or 'tag'). */
export type FilledSymbol = 'heart' | 'star' | 'crown' | 'arrow' | 'smiley' | 'bolt' | 'code';
/**
 * Symbols the painter knows; words are any text instead. The filled ones, and the quick one-colour can strokes
 * ('spray', SPRAY_SYMBOLS: the reference set and technology logos such as react, js or git).
 */
export type GraffitiSymbol = FilledSymbol | SpraySymbolName;
export const GRAFFITI_SYMBOLS: readonly GraffitiSymbol[] = [
  'heart', 'star', 'crown', 'arrow', 'smiley', 'bolt', 'code',
  ...(Object.keys(SPRAY_SYMBOLS) as SpraySymbolName[]),
];
/**
 * 'spray': simple strokes of one colour straight from the can (soft edges, mist, speckles, drips); every word is
 * painted this way, from the single-stroke capitals in sprayFont.ts. The filled symbols can also be 'piece' (a fade
 * between two colours with a dark outline and glints) or 'tag' (one colour, filled).
 */
export type GraffitiStyle = 'spray' | 'piece' | 'tag';

export type GraffitiSpot = {
  id: string;
  /** Words to paint (a newline starts a second line), per language or the same in both; always 'spray'. */
  text?: string | Readonly<Record<Language, string>>;
  /** Words only: a loose ring sprayed round them, and the lines (0 the first) struck through with one long stroke. */
  circled?: boolean;
  crossed?: number[];
  symbol?: GraffitiSymbol;
  style: GraffitiStyle;
  /** Paint on the loose pieces of this group under the spot (each piece carries its share) instead of static surfaces. */
  loose?: PieceGroup;
  /** A point on or just off the surface (three.js metres); `ground` puts it on the outside ground. */
  at: [number, number | 'ground', number];
  face: GraffitiFace;
  /** Painted width in metres; the height follows the drawing. */
  width: number;
  /** Turn within the surface (degrees, counter-clockwise as seen facing the surface). */
  tilt?: number;
  /** The paint's colour; a 'piece' symbol also fades to `fade` and may have an `outline`. */
  color: string;
  fade?: string;
  outline?: string;
  /** Seed of everything hand-made about it: letter jitter, wobble, speckles, drips. */
  seed: number;
};

/** Spray can colours that read on the dark ground and on the light concrete. */
export const GRAFFITI_COLORS = {
  black: '#121014', white: '#f4f1ff', pink: '#ff3fa4', lime: '#b6ff3b', cyan: '#3ff0ff', yellow: '#ffd23f', orange: '#ff7a1a', violet: '#a879ff',
} as const;

const C = GRAFFITI_COLORS;

/** Spots painted in the scene, chosen from the «Grafitis» design canvas. */
export const GRAFFITI: readonly GraffitiSpot[] = [
  // The concrete barriers behind the room.
  { id: 'barrier-machine', text: { es: 'FUNCIONA EN\nMI MÁQUINA', en: 'IT WORKS ON\nMY MACHINE' }, style: 'spray', at: [5.63, 0.3, -11.78], face: 'z', width: 1.9, tilt: 2, color: C.black, seed: 401 },
  { id: 'barrier-react', symbol: 'react', style: 'spray', at: [1.76, 0.3, -12.22], face: 'z', width: 0.95, tilt: -6, color: C.black, seed: 301 },
  { id: 'barrier-force', text: 'GIT PUSH --FORCE', style: 'spray', at: [-3.2, 0.3, -11.23], face: 'z', width: 1.9, tilt: -3, color: C.black, seed: 405 },
  { id: 'barrier-stop', text: 'STOP', circled: true, style: 'spray', at: [-6.2, 0.3, -8.88], face: 'z', width: 1.2, tilt: 5, color: C.pink, seed: 201 },
  // The playground's brick wall: each brick carries its part, so a knocked wall scatters the paint.
  { id: 'wall-java', text: 'JAVA\nSH*T', crossed: [0], loose: 'bricks', style: 'spray', at: [26.0, 0.5, 31.43], face: 'z', width: 2.2, tilt: -4, color: C.black, seed: 203 },
  // A ramp behind the plaza, on its slope, and the road just past the start line.
  { id: 'ramp-jump', text: { es: '¡SALTA!', en: 'JUMP!' }, style: 'spray', at: [29.45, 1.5, -10.7], face: 'up', width: 2.0, tilt: 6, color: C.pink, seed: 13 },
  { id: 'road-go', text: { es: '¡VAMOS!', en: 'GO!' }, style: 'spray', at: [29.7, 'ground', 18.65], face: 'up', width: 2.6, tilt: 4, color: C.yellow, seed: 11 },
  // A planter in the plaza, the park and the work site.
  { id: 'planter-heart', symbol: 'heartline', style: 'spray', at: [33.9, 0.14, 9.25], face: 'z', width: 0.62, tilt: -8, color: C.pink, seed: 37 },
  { id: 'park-code', symbol: 'code', style: 'piece', at: [-6.5, 'ground', 22.5], face: 'up', width: 2.4, tilt: -6, color: C.cyan, fade: C.lime, seed: 97 },
  { id: 'works-friday', text: { es: 'VIERNES:\nNO DEPLOY', en: 'FRIDAY:\nNO DEPLOY' }, style: 'spray', at: [-2.5, 'ground', 33.5], face: 'up', width: 2.6, tilt: 8, color: C.lime, seed: 413 },
];

/** The words of a text spot in a language. */
export function textFor(spot: GraffitiSpot, language: Language): string {
  return typeof spot.text === 'string' ? spot.text : spot.text?.[language] ?? '';
}

/** Deterministic random numbers in [0, 1) (mulberry32): the same spot paints the same way every time. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** How far letters stray from a tidy line, by style: turn (radians), scale and baseline shift (share of the size). */
export const JITTER: Readonly<Record<GraffitiStyle, { turn: number; scale: number; shift: number; lean: number; overlap: number }>> = {
  spray: { turn: 0.12, scale: 0.12, shift: 0.08, lean: 0.14, overlap: 0 },
  piece: { turn: 0.2, scale: 0.2, shift: 0.12, lean: 0.18, overlap: 0.1 },
  tag: { turn: 0.28, scale: 0.22, shift: 0.16, lean: 0.32, overlap: 0.02 },
};

/** One hand-placed letter: its character, centre offset along the line (in letter sizes), turn and scale. */
export type Glyph = { char: string; line: number; turn: number; scale: number; shift: number };

/**
 * Messy lettering: each character of each line gets its own turn, size and baseline shift, so no two letters sit
 * alike (the canvas draws them with the advance it measures, overlapping by JITTER.overlap).
 */
export function glyphLayout(text: string, style: GraffitiStyle, seed: number): Glyph[] {
  const random = seeded(seed);
  const jitter = JITTER[style];
  const spread = (amount: number) => (random() * 2 - 1) * amount;
  return text.split('\n').flatMap((line, index) => [...line].map((char) => ({
    char,
    line: index,
    turn: spread(jitter.turn),
    scale: 1 + spread(jitter.scale),
    shift: spread(jitter.shift),
  })));
}

/** Outward normal of a face. */
export function faceNormal(face: GraffitiFace): Vector3 {
  return face === 'x' ? new Vector3(1, 0, 0) : face === 'z' ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0);
}

/** How far in front of `at` the projector starts looking for the surface, and how far it looks. */
export const REACH = { before: 0.5, depth: 1.2 };

/**
 * The static surface a spot is painted on: the nearest hit along the face's inward normal from just in front of
 * `at`, or undefined when there is nothing there (a ground spot then lies flat on the ground at `groundY`).
 * Ground spots look down from half a metre up only, so tree tops and lamp heads above them never catch the paint.
 */
export function surfaceFor(spot: GraffitiSpot, targets: readonly Object3D[], groundY: number): { point: Vector3; object: Object3D } | undefined {
  const normal = faceNormal(spot.face);
  const y = spot.at[1] === 'ground' ? groundY : spot.at[1];
  const origin = new Vector3(spot.at[0], y, spot.at[2]).addScaledVector(normal, REACH.before);
  const ray = new Raycaster(origin, normal.clone().negate(), 0, REACH.before + REACH.depth);
  const hit = ray.intersectObjects([...targets], true).find((entry) => entry.face && entry.face.normal.clone().transformDirection(entry.object.matrixWorld).dot(normal) > 0.3);
  if (!hit) return undefined;
  if (spot.at[1] === 'ground' && hit.point.y < groundY + 0.02) return undefined;
  return { point: hit.point, object: hit.object };
}
