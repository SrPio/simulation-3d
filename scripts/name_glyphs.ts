// Outlines of the name letters in Bahnschrift SemiBold SemiCondensed, for scripts/blender/create_outside.py.
// Windows ships Bahnschrift as one variable font; Blender only reads its default instance, so the
// instance is resolved here and only the glyph contours of NAME are written, flattened to polygons.
// Its glyphs are drawn from overlapping pieces (an E is four bars); they are merged into one outline
// per letter (outer rings followed by their holes) so the extruded letters have no inner faces.
// Usage: node scripts/name_glyphs.ts [path to bahnschrift.ttf]
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fontkit from 'fontkit';
import polygonClipping, { type Polygon } from 'polygon-clipping';

const NAME = 'ANDRES JARAMILLO';
const SOURCE = process.argv[2] ?? 'C:/Windows/Fonts/bahnschrift.ttf';
const OUTPUT = fileURLToPath(new URL('../assets/name/name-glyphs.json', import.meta.url));
const VARIATION = { wght: 600, wdth: 87.5 }; // the SemiBold SemiCondensed named instance
/** Curves are split into segments about this long (font units; caps are 1454 high), at most MAX_STEPS. */
const SEGMENT = 90;
const MAX_STEPS = 6;
const steps = (...points: number[]) => {
  let length = 0;
  for (let i = 2; i < points.length; i += 2) length += Math.hypot(points[i] - points[i - 2], points[i + 1] - points[i - 1]);
  return Math.min(MAX_STEPS, Math.max(1, Math.ceil(length / SEGMENT)));
};

type Point = [number, number];
type Command = { command: string; args: number[] };

/** Contours of a glyph path as closed polygons; quadratic and cubic segments are subdivided. */
function contours(commands: Command[]): Point[][] {
  const result: Point[][] = [];
  let current: Point[] = [];
  let last: Point = [0, 0];
  const close = () => {
    if (current.length > 2) {
      const [fx, fy] = current[0];
      const [lx, ly] = current[current.length - 1];
      if (Math.hypot(fx - lx, fy - ly) < 1e-6) current.pop();
      result.push(current);
    }
    current = [];
  };
  for (const { command, args } of commands) {
    if (command === 'moveTo') {
      close();
      last = [args[0], args[1]];
      current.push(last);
    } else if (command === 'lineTo') {
      last = [args[0], args[1]];
      current.push(last);
    } else if (command === 'quadraticCurveTo') {
      const [cx, cy, x, y] = args;
      const count = steps(last[0], last[1], cx, cy, x, y);
      for (let i = 1; i <= count; i++) {
        const t = i / count;
        const u = 1 - t;
        current.push([u * u * last[0] + 2 * u * t * cx + t * t * x, u * u * last[1] + 2 * u * t * cy + t * t * y]);
      }
      last = [x, y];
    } else if (command === 'bezierCurveTo') {
      const [c1x, c1y, c2x, c2y, x, y] = args;
      const count = steps(last[0], last[1], c1x, c1y, c2x, c2y, x, y);
      for (let i = 1; i <= count; i++) {
        const t = i / count;
        const u = 1 - t;
        current.push([
          u ** 3 * last[0] + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t ** 3 * x,
          u ** 3 * last[1] + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t ** 3 * y,
        ]);
      }
      last = [x, y];
    } else if (command === 'closePath') {
      close();
    }
  }
  close();
  return result;
}

const signedArea = (ring: Point[]) => ring.reduce((sum, [x, y], i) => {
  const [nx, ny] = ring[(i + 1) % ring.length];
  return sum + x * ny - nx * y;
}, 0) / 2;

function insideRing([px, py]: Point, ring: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Union of a glyph's pieces. TrueType outer contours run clockwise (negative area, y up); holes run the other way. */
function merge(rings: Point[][]): Point[][][] {
  const outers = rings.filter((ring) => signedArea(ring) < 0);
  const holes = rings.filter((ring) => signedArea(ring) >= 0);
  const pieces: Polygon[] = outers.map((outer) => [outer, ...holes.filter((hole) => insideRing(hole[0], outer))]);
  if (!pieces.length) return [];
  return polygonClipping.union(pieces[0], ...pieces.slice(1)).map((polygon) => polygon.map((ring) => {
    const open = ring.slice(0, -1) as Point[]; // the library repeats the first point at the end
    return open.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10] as Point);
  }));
}

const base = fontkit.openSync(SOURCE) as fontkit.Font;
const font = base.getVariation(VARIATION);
const run = font.layout(NAME);
let pen = 0;
const letters = run.glyphs.map((glyph, index) => {
  const entry = {
    char: NAME[index],
    x: pen,
    advance: run.positions[index].xAdvance,
    /** Polygons: each is an outer ring followed by its holes. */
    polygons: merge(contours(glyph.path.commands as Command[])),
  };
  pen += run.positions[index].xAdvance;
  return entry;
});
await mkdir(dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify({
  name: NAME,
  font: `${base.familyName} SemiBold SemiCondensed`,
  variation: VARIATION,
  unitsPerEm: font.unitsPerEm,
  capHeight: font.capHeight,
  width: pen,
  letters,
})}\n`);
console.log(`${OUTPUT}: ${letters.length} glyphs, ${pen} units wide`);
