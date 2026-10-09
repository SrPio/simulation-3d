/**
 * Single-stroke capitals for spray-painted words: each glyph is the few strokes a hand makes with a can, as
 * polylines in a box one unit tall (y down from the cap line to the baseline at 1) and `width` wide. The painter
 * jitters the points, smooths each stroke through them and sprays it with one colour. Lower case is painted as
 * capitals; accented vowels add their accent; characters without a glyph are left as a gap.
 */

export type Point = [number, number];
export type Stroke = Point[];
export type SprayGlyph = { width: number; strokes: Stroke[] };

/** Points along an ellipse arc (radians, 0 = +x, clockwise on screen since y points down). */
export function arc(cx: number, cy: number, rx: number, ry: number, from: number, to: number, steps = 10): Stroke {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const angle = from + ((to - from) * i) / steps;
    return [cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry] as Point;
  });
}

const PI = Math.PI;
const g = (width: number, ...strokes: Stroke[]): SprayGlyph => ({ width, strokes });

const LETTERS: Record<string, SprayGlyph> = {
  A: g(0.66, [[0, 1], [0.33, 0], [0.66, 1]], [[0.13, 0.62], [0.53, 0.62]]),
  B: g(0.58, [[0, 1], [0, 0]], [[0, 0], [0.32, 0], ...arc(0.32, 0.24, 0.2, 0.24, -PI / 2, PI / 2, 6).slice(1), [0, 0.48]],
    [[0, 0.48], [0.36, 0.48], ...arc(0.36, 0.74, 0.22, 0.26, -PI / 2, PI / 2, 6).slice(1), [0, 1]]),
  C: g(0.6, arc(0.36, 0.5, 0.36, 0.5, -0.25 * PI, -1.75 * PI, 14)),
  D: g(0.62, [[0, 1], [0, 0], [0.22, 0], ...arc(0.22, 0.5, 0.4, 0.5, -PI / 2, PI / 2, 10).slice(1), [0, 1]]),
  E: g(0.52, [[0.52, 0], [0, 0], [0, 1], [0.52, 1]], [[0, 0.5], [0.4, 0.5]]),
  F: g(0.5, [[0.5, 0], [0, 0], [0, 1]], [[0, 0.5], [0.4, 0.5]]),
  G: g(0.64, [...arc(0.36, 0.5, 0.36, 0.5, -0.25 * PI, -1.85 * PI, 14), [0.66, 0.55], [0.4, 0.55]]),
  H: g(0.6, [[0, 0], [0, 1]], [[0.6, 0], [0.6, 1]], [[0, 0.5], [0.6, 0.5]]),
  I: g(0.12, [[0.06, 0], [0.06, 1]]),
  J: g(0.48, [[0.46, 0], [0.46, 0.7], ...arc(0.24, 0.72, 0.22, 0.28, 0, PI, 8).slice(1)]),
  K: g(0.58, [[0, 0], [0, 1]], [[0.56, 0], [0.02, 0.56]], [[0.2, 0.4], [0.58, 1]]),
  L: g(0.48, [[0, 0], [0, 1], [0.48, 1]]),
  M: g(0.76, [[0, 1], [0.04, 0], [0.38, 0.62], [0.72, 0], [0.76, 1]]),
  N: g(0.62, [[0, 1], [0, 0], [0.62, 1], [0.62, 0]]),
  O: g(0.7, arc(0.35, 0.5, 0.35, 0.5, -PI / 2, 1.55 * PI, 18)),
  P: g(0.56, [[0, 1], [0, 0], [0.3, 0], ...arc(0.3, 0.26, 0.24, 0.26, -PI / 2, PI / 2, 7).slice(1), [0, 0.52]]),
  Q: g(0.7, arc(0.35, 0.5, 0.35, 0.5, -PI / 2, 1.55 * PI, 18), [[0.42, 0.7], [0.72, 1.05]]),
  R: g(0.58, [[0, 1], [0, 0], [0.3, 0], ...arc(0.3, 0.26, 0.24, 0.26, -PI / 2, PI / 2, 7).slice(1), [0, 0.52]], [[0.22, 0.52], [0.58, 1]]),
  S: g(0.56, [...arc(0.28, 0.25, 0.26, 0.25, -0.1 * PI, -PI, 8), ...arc(0.28, 0.75, 0.28, 0.25, -PI / 2, 0.95 * PI, 10).slice(1)]),
  T: g(0.6, [[0, 0], [0.6, 0]], [[0.3, 0], [0.3, 1]]),
  U: g(0.6, [[0, 0], [0, 0.66], ...arc(0.3, 0.68, 0.3, 0.32, PI, 0, 9).slice(1), [0.6, 0]]),
  V: g(0.64, [[0, 0], [0.32, 1], [0.64, 0]]),
  W: g(0.86, [[0, 0], [0.2, 1], [0.43, 0.3], [0.66, 1], [0.86, 0]]),
  X: g(0.6, [[0, 0], [0.6, 1]], [[0.6, 0], [0, 1]]),
  Y: g(0.6, [[0, 0], [0.3, 0.5], [0.6, 0]], [[0.3, 0.5], [0.3, 1]]),
  Z: g(0.56, [[0, 0], [0.56, 0], [0, 1], [0.56, 1]]),
  0: g(0.58, arc(0.29, 0.5, 0.29, 0.5, -PI / 2, 1.55 * PI, 16)),
  1: g(0.3, [[0, 0.2], [0.24, 0], [0.24, 1]]),
  2: g(0.54, [...arc(0.27, 0.27, 0.26, 0.27, PI, 2.15 * PI, 8), [0, 1], [0.56, 1]]),
  3: g(0.54, [...arc(0.26, 0.26, 0.26, 0.26, -0.9 * PI, 0.5 * PI, 8)], [...arc(0.26, 0.74, 0.28, 0.26, -0.5 * PI, 0.9 * PI, 8)]),
  4: g(0.58, [[0.44, 1], [0.44, 0], [0, 0.7], [0.6, 0.7]]),
  5: g(0.54, [[0.5, 0], [0.06, 0], [0.02, 0.44], ...arc(0.26, 0.7, 0.28, 0.3, -0.75 * PI, 0.85 * PI, 10)]),
  6: g(0.56, [[0.46, 0.02], ...arc(0.4, 0.5, 0.38, 0.5, -0.6 * PI, -PI, 4).slice(1), ...arc(0.28, 0.72, 0.27, 0.28, PI, 3 * PI, 14).slice(1)]),
  7: g(0.54, [[0, 0], [0.56, 0], [0.18, 1]]),
  8: g(0.56, arc(0.28, 0.25, 0.22, 0.25, PI / 2, 2.5 * PI, 12), arc(0.28, 0.74, 0.28, 0.26, -PI / 2, 1.5 * PI, 14)),
  9: g(0.56, [...arc(0.28, 0.28, 0.27, 0.28, 0, 2 * PI, 14), [0.55, 0.3], [0.5, 0.7], [0.1, 1]]),
  '!': g(0.12, [[0.06, 0], [0.06, 0.68]], [[0.06, 0.95], [0.065, 1]]),
  '?': g(0.5, [...arc(0.25, 0.24, 0.24, 0.24, PI, 2.4 * PI, 9), [0.25, 0.68]], [[0.25, 0.95], [0.255, 1]]),
  // Spanish opening marks: the closing ones turned upside down.
  '¡': g(0.12, [[0.06, 0.32], [0.06, 1]], [[0.06, 0], [0.065, 0.05]]),
  '¿': g(0.5, [...arc(0.25, 0.76, 0.24, 0.24, 0, 1.4 * PI, 9).reverse(), [0.25, 0.32] as Point].reverse(), [[0.25, 0], [0.255, 0.05]]),
  '.': g(0.1, [[0.05, 0.95], [0.055, 1]]),
  ',': g(0.12, [[0.08, 0.92], [0.02, 1.12]]),
  ':': g(0.1, [[0.05, 0.3], [0.055, 0.35]], [[0.05, 0.95], [0.055, 1]]),
  '-': g(0.4, [[0, 0.55], [0.4, 0.55]]),
  '+': g(0.5, [[0, 0.55], [0.5, 0.55]], [[0.25, 0.3], [0.25, 0.8]]),
  "'": g(0.1, [[0.06, 0], [0.04, 0.22]]),
  '/': g(0.4, [[0.4, 0], [0, 1]]),
  '<': g(0.46, [[0.46, 0.2], [0, 0.56], [0.46, 0.92]]),
  '>': g(0.46, [[0, 0.2], [0.46, 0.56], [0, 0.92]]),
  '(': g(0.24, arc(0.4, 0.5, 0.36, 0.56, -0.68 * PI, -1.32 * PI, 8)),
  ')': g(0.24, arc(-0.16, 0.5, 0.36, 0.56, -0.32 * PI, 0.32 * PI, 8)),
  '#': g(0.6, [[0.2, 0.1], [0.14, 0.95]], [[0.46, 0.1], [0.4, 0.95]], [[0, 0.36], [0.6, 0.36]], [[0, 0.7], [0.6, 0.7]]),
  '&': g(0.62, [[0.62, 1], [0.12, 0.42], ...arc(0.28, 0.2, 0.16, 0.2, PI * 0.75, 2.25 * PI, 8).slice(1), [0.06, 0.66], ...arc(0.26, 0.76, 0.22, 0.24, PI, 2.1 * PI, 8).slice(1), [0.62, 0.5]]),
  '*': g(0.44, [[0.22, 0.02], [0.22, 0.42]], [[0.02, 0.1], [0.42, 0.34]], [[0.42, 0.1], [0.02, 0.34]]),
  '"': g(0.26, [[0.06, 0], [0.04, 0.22]], [[0.22, 0], [0.2, 0.22]]),
  '_': g(0.56, [[0, 1.02], [0.56, 1.02]]),
  '=': g(0.5, [[0, 0.42], [0.5, 0.42]], [[0, 0.7], [0.5, 0.7]]),
  ';': g(0.12, [[0.06, 0.3], [0.065, 0.35]], [[0.08, 0.92], [0.02, 1.12]]),
  '{': g(0.32, [[0.32, 0], [0.16, 0.06], [0.16, 0.42], [0, 0.5], [0.16, 0.58], [0.16, 0.94], [0.32, 1]]),
  '}': g(0.32, [[0, 0], [0.16, 0.06], [0.16, 0.42], [0.32, 0.5], [0.16, 0.58], [0.16, 0.94], [0, 1]]),
  '[': g(0.24, [[0.24, -0.02], [0, -0.02], [0, 1.02], [0.24, 1.02]]),
  ']': g(0.24, [[0, -0.02], [0.24, -0.02], [0.24, 1.02], [0, 1.02]]),
  '|': g(0.1, [[0.05, -0.05], [0.05, 1.05]]),
};

/** The strokes of a short word in capitals, `size` units tall with its top left at (x, y): logos with letters in them. */
function lettering(text: string, x: number, y: number, size: number): Stroke[] {
  const strokes: Stroke[] = [];
  let cursor = x;
  for (const char of text) {
    const glyph = LETTERS[char];
    if (!glyph) {
      cursor += SPACE * size;
      continue;
    }
    for (const stroke of glyph.strokes) strokes.push(stroke.map(([u, v]) => [cursor + u * size, y + v * size] as Point));
    cursor += (glyph.width + TRACKING) * size;
  }
  return strokes;
}

/** A closed polygon through the points (the first repeated at the end). */
const closed = (...points: Point[]): Stroke => [...points, points[0]];

/** An ellipse turned by `angle` about its centre. */
function turnedEllipse(cx: number, cy: number, rx: number, ry: number, angle: number, steps = 24): Stroke {
  return arc(0, 0, rx, ry, 0, 2 * PI, steps).map(([x, y]) => [cx + x * Math.cos(angle) - y * Math.sin(angle), cy + x * Math.sin(angle) + y * Math.cos(angle)] as Point);
}

/** A badge shield (HTML5, CSS3): flat top, sides tapering into a point. */
const shield = (): Stroke => closed([0.06, 0.02], [0.94, 0.02], [0.86, 0.86], [0.5, 1.0], [0.14, 0.86]);

/**
 * An arrow `length` long through (cx, cy), pointing up turned by `angle` (clockwise on screen, y points down):
 * the shaft, then the head in one go.
 */
function arrowStrokes(cx: number, cy: number, length: number, angle: number): Stroke[] {
  const turn = ([x, y]: Point): Point => [cx + x * Math.cos(angle) - y * Math.sin(angle), cy + x * Math.sin(angle) + y * Math.cos(angle)];
  const half = length / 2;
  const head = length * 0.32;
  return [[[0, half], [0, -half]].map((p) => turn(p as Point)), [[-head, -half + head], [0, -half], [head, -half + head]].map((p) => turn(p as Point))];
}

/**
 * The Konami code as a gamepad would print it, after the «Grafitis · Pollito y Konami» canvas (option B): up, up,
 * down, down on the first row; left, right, left, right and the B and A buttons, each in a loose ring, on the second.
 */
function konami(): Stroke[] {
  const up = 0;
  const down = PI;
  const left = -PI / 2;
  const right = PI / 2;
  // Each arrow a touch off straight, like a hand in a hurry.
  const rows: [number, number, number, number[]][] = [
    [0.66, 0.445, 0.77, [up - 0.05, up + 0.07, down - 0.05, down + 0.05]],
    [1.646, 0.418, 0.7, [left - 0.02, right - 0.05, left + 0.03, right + 0.03]],
  ];
  const starts = [1.12, 0.49];
  const strokes: Stroke[] = [];
  for (const [row, [y, length, step, angles]] of rows.entries()) {
    for (const [k, angle] of angles.entries()) strokes.push(...arrowStrokes(starts[row] + k * step - 0.2, y - 0.35, length, angle));
  }
  for (const [char, cx] of [['B', 3.3], ['A', 4.1]] as const) {
    const size = 0.366;
    const glyph = LETTERS[char];
    strokes.push(...lettering(char, cx - 0.2 - (glyph.width * size) / 2, 1.646 - 0.35 - size / 2, size));
    // The ring runs a little past where it started.
    strokes.push(arc(cx - 0.2 + 0.01, 1.646 - 0.35 + 0.01, 0.36, 0.34, -0.62 * PI, 1.48 * PI, 22));
  }
  return strokes;
}

/** Accents laid over the capital's top. */
const ACCENTED: Record<string, [string, Stroke[]]> = {
  Á: ['A', [[[0.28, -0.12], [0.42, -0.26]]]],
  É: ['E', [[[0.2, -0.12], [0.34, -0.26]]]],
  Í: ['I', [[[0.0, -0.12], [0.14, -0.26]]]],
  Ó: ['O', [[[0.3, -0.12], [0.44, -0.26]]]],
  Ú: ['U', [[[0.24, -0.12], [0.38, -0.26]]]],
  Ñ: ['N', [[[0.06, -0.14], [0.2, -0.24], [0.4, -0.14], [0.56, -0.24]]]],
  Ü: ['U', [[[0.16, -0.18], [0.17, -0.14]], [[0.44, -0.18], [0.45, -0.14]]]],
};

/** Gap left by a space (and by characters without a glyph), in units. */
export const SPACE = 0.42;
/** Gap between letters, in units. */
export const TRACKING = 0.3;

/** The glyph for a character (lower case as capitals), or undefined for a gap. */
export function sprayGlyph(char: string): SprayGlyph | undefined {
  const upper = char.toUpperCase();
  if (LETTERS[upper]) return LETTERS[upper];
  const accented = ACCENTED[upper];
  if (!accented) return undefined;
  const base = LETTERS[accented[0]];
  return { width: base.width, strokes: [...base.strokes, ...accented[1]] };
}

/** Every character with a glyph (capitals, digits, punctuation and accented capitals). */
export const SPRAY_CHARACTERS = [...Object.keys(LETTERS), ...Object.keys(ACCENTED)].join('');

/**
 * Can-stroke symbols in a box one unit tall and `width` wide, after the classic spray set: crown, curved arrow,
 * stitched smiley, cross, zigzag, arrow down, heart outline, splat and dot. `blobs` are filled spots (x, y, radius).
 */
export type SpraySymbol = { width: number; strokes: Stroke[]; blobs?: [number, number, number][] };
export type SpraySymbolName =
  | 'crownline' | 'swoosh' | 'stitched' | 'cross' | 'zigzag' | 'arrowdown' | 'heartline' | 'splat' | 'dot'
  | 'react' | 'js' | 'ts' | 'node' | 'git' | 'three' | 'vite' | 'html' | 'css' | 'terminal' | 'konami';
export const SPRAY_SYMBOLS: Record<SpraySymbolName, SpraySymbol> = {
  crownline: {
    width: 1,
    strokes: [
      [[0.14, 0.86], [0.08, 0.3], [0.32, 0.58], [0.5, 0.12], [0.68, 0.58], [0.92, 0.3], [0.86, 0.86]],
      arc(0.5, 0.86, 0.42, 0.11, PI, 3.05 * PI, 16),
      [[0.02, 0.06], [0.16, 0.0], [0.24, 0.12]],
      [[0.78, 0.1], [0.86, 0.0]],
    ],
  },
  swoosh: {
    width: 1.5,
    strokes: [
      [...arc(0.75, 0.95, 0.72, 0.62, PI * 1.05, PI * 1.62, 10)],
      [[1.0, 0.22], [1.38, 0.38], [1.08, 0.62]],
    ],
  },
  stitched: {
    width: 1,
    strokes: [
      arc(0.5, 0.5, 0.46, 0.46, -PI / 2, 1.58 * PI, 22),
      [[0.36, 0.28], [0.37, 0.44]],
      [[0.6, 0.26], [0.61, 0.42]],
      [[0.26, 0.66], [0.5, 0.64], [0.74, 0.66]],
      [[0.34, 0.6], [0.35, 0.72]], [[0.5, 0.58], [0.51, 0.7]], [[0.65, 0.6], [0.66, 0.72]],
    ],
  },
  cross: { width: 0.9, strokes: [[[0.05, 0.1], [0.85, 0.9]], [[0.85, 0.05], [0.1, 0.95]]] },
  zigzag: { width: 0.55, strokes: [[[0.1, 0.0], [0.5, 0.18], [0.1, 0.38], [0.5, 0.58], [0.1, 0.78], [0.42, 1.0]]] },
  arrowdown: { width: 0.6, strokes: [[[0.3, 0.0], [0.31, 1.0]], [[0.02, 0.62], [0.31, 1.0], [0.58, 0.6]]] },
  heartline: {
    width: 1,
    strokes: [[[0.5, 0.95], ...arc(0.27, 0.32, 0.25, 0.25, 0.8 * PI, 1.95 * PI, 8), ...arc(0.73, 0.32, 0.25, 0.25, 1.05 * PI, 2.2 * PI, 8), [0.5, 0.95], [0.52, 1.08]]],
  },
  splat: { width: 1, strokes: [], blobs: [[0.5, 0.5, 0.36]] },
  dot: { width: 0.4, strokes: [], blobs: [[0.2, 0.5, 0.16]] },
  // Technology logos, as quick one-colour can strokes.
  react: {
    width: 1.1,
    strokes: [0, PI / 3, (2 * PI) / 3].map((angle) => turnedEllipse(0.55, 0.5, 0.52, 0.19, angle)),
    blobs: [[0.55, 0.5, 0.09]],
  },
  js: { width: 1, strokes: [closed([0.02, 0.02], [0.98, 0.02], [0.98, 0.98], [0.02, 0.98]), ...lettering('JS', 0.3, 0.42, 0.44)] },
  ts: { width: 1, strokes: [closed([0.02, 0.02], [0.98, 0.02], [0.98, 0.98], [0.02, 0.98]), ...lettering('TS', 0.3, 0.42, 0.44)] },
  node: {
    width: 0.92,
    strokes: [closed([0.46, 0], [0.9, 0.25], [0.9, 0.75], [0.46, 1], [0.02, 0.75], [0.02, 0.25]), ...lettering('N', 0.32, 0.32, 0.36)],
  },
  // A diamond with the branch inside: a line between two commits and a second branch off it.
  git: {
    width: 1,
    strokes: [closed([0.5, 0.0], [1.0, 0.5], [0.5, 1.0], [0.0, 0.5]), [[0.24, 0.24], [0.66, 0.66]], [[0.45, 0.45], [0.45, 0.78]]],
    blobs: [[0.66, 0.66, 0.075], [0.45, 0.8, 0.075]],
  },
  three: {
    width: 1.1,
    strokes: [closed([0.55, 0.02], [1.08, 0.98], [0.02, 0.98]), closed([0.285, 0.5], [0.815, 0.5], [0.55, 0.98])],
  },
  vite: {
    width: 1,
    strokes: [[[0.02, 0.06], [0.5, 0.98], [0.98, 0.06]], [[0.6, 0.0], [0.38, 0.46], [0.6, 0.44], [0.44, 0.86]]],
  },
  html: { width: 1, strokes: [shield(), ...lettering('5', 0.34, 0.24, 0.48)] },
  css: { width: 1, strokes: [shield(), ...lettering('3', 0.34, 0.24, 0.48)] },
  terminal: {
    width: 1.2,
    strokes: [closed([0.02, 0.06], [1.18, 0.06], [1.18, 0.94], [0.02, 0.94]), [[0.2, 0.32], [0.42, 0.52], [0.2, 0.72]], [[0.52, 0.74], [0.86, 0.74]]],
  },
  // ↑ ↑ ↓ ↓ / ← → ← → (B) (A): the hint for the chick rain, painted on the ground near the intro's arrow keys.
  konami: { width: 4.2, strokes: konami() },
};
