/**
 * Outlines of the letters on the punching bags, from the official logos in assets/logos/ (see the README there): the
 * "JS" of javascript.svg and the "TS" of typescript.svg, their SVG paths flattened into closed rings (logo units, y
 * down, as in the SVG); and the Universidad del Valle logo (a red disc with a white U and a white downward triangle, the
 * V, which overlaps the U with a red fillet round it), traced from the image the user supplied. Writes
 * assets/logos/logo-outlines.json, which scripts/blender/create_boxing.py and create_univalle.py extrude.
 * Run by hand: `node scripts/logo_outlines.ts`.
 */
import { readFile, writeFile } from 'node:fs/promises';
import polygonClipping from 'polygon-clipping';

type Point = [number, number];

/** Points per Bézier curve: enough for smooth letters a few dozen centimetres tall. */
const CURVE_STEPS = 10;

/** Split an SVG path into commands and their numbers ("-.5.5" is two numbers, as SVG allows). */
function tokens(d: string): (string | number)[] {
  return [...d.matchAll(/[MmLlHhVvCcSsQqTtZz]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g)].map(([token]) => (/^[A-Za-z]$/.test(token) ? token : Number(token)));
}

/** The closed rings an SVG path draws (lines and cubic/quadratic curves; arcs are not used by these logos). */
export function flatten(d: string): Point[][] {
  const list = tokens(d);
  const rings: Point[][] = [];
  let ring: Point[] = [];
  let at: Point = [0, 0];
  let start: Point = [0, 0];
  let control: Point | undefined;
  let command = '';
  let i = 0;
  const number = () => list[i++] as number;
  const close = () => {
    if (ring.length > 2) rings.push(ring);
    ring = [];
  };
  const cubic = (c1: Point, c2: Point, end: Point) => {
    for (let k = 1; k <= CURVE_STEPS; k++) {
      const t = k / CURVE_STEPS;
      const u = 1 - t;
      ring.push([
        u * u * u * at[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * end[0],
        u * u * u * at[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * end[1],
      ]);
    }
    control = c2;
    at = end;
  };
  while (i < list.length) {
    if (typeof list[i] === 'string') command = list[i++] as string;
    const relative = command === command.toLowerCase();
    const point = (): Point => {
      const x = number();
      const y = number();
      return relative ? [at[0] + x, at[1] + y] : [x, y];
    };
    switch (command.toLowerCase()) {
      case 'm':
        close();
        at = start = point();
        ring.push(at);
        control = undefined;
        // Further pairs after a moveto are linetos.
        command = relative ? 'l' : 'L';
        break;
      case 'l':
        at = point();
        ring.push(at);
        control = undefined;
        break;
      case 'h':
        at = [relative ? at[0] + number() : number(), at[1]];
        ring.push(at);
        control = undefined;
        break;
      case 'v':
        at = [at[0], relative ? at[1] + number() : number()];
        ring.push(at);
        control = undefined;
        break;
      case 'c': {
        const c1 = point();
        const c2 = point();
        cubic(c1, c2, point());
        break;
      }
      case 's': {
        const c1: Point = control ? [2 * at[0] - control[0], 2 * at[1] - control[1]] : at;
        const c2 = point();
        cubic(c1, c2, point());
        break;
      }
      case 'q': {
        const q = point();
        const end = point();
        cubic([at[0] + (2 / 3) * (q[0] - at[0]), at[1] + (2 / 3) * (q[1] - at[1])], [end[0] + (2 / 3) * (q[0] - end[0]), end[1] + (2 / 3) * (q[1] - end[1])], end);
        break;
      }
      case 'z':
        at = start;
        close();
        control = undefined;
        break;
      default:
        throw new Error(`unsupported path command ${command}`);
    }
  }
  close();
  // Drop a closing point that repeats the first.
  return rings.map((points) => {
    const [first, last] = [points[0], points[points.length - 1]];
    return Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-6 ? points.slice(0, -1) : points;
  });
}

/** Drop the points of a closed ring that stay within `tolerance` of the line through their neighbours (Ramer–Douglas–Peucker). */
export function simplify(ring: Point[], tolerance: number): Point[] {
  const keep = (points: Point[]): Point[] => {
    const [a, b] = [points[0], points[points.length - 1]];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    let far = 0;
    let index = 0;
    for (let i = 1; i < points.length - 1; i++) {
      const distance = Math.abs((b[0] - a[0]) * (a[1] - points[i][1]) - (a[0] - points[i][0]) * (b[1] - a[1])) / length;
      if (distance > far) [far, index] = [distance, i];
    }
    return far <= tolerance ? [a, b] : [...keep(points.slice(0, index + 1)).slice(0, -1), ...keep(points.slice(index))];
  };
  // Split the ring at its first point and the point furthest from it, and simplify each half.
  let opposite = 1;
  for (let i = 1; i < ring.length; i++) if (Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]) > Math.hypot(ring[opposite][0] - ring[0][0], ring[opposite][1] - ring[0][1])) opposite = i;
  const first = keep(ring.slice(0, opposite + 1));
  const second = keep([...ring.slice(opposite), ring[0]]);
  return [...first.slice(0, -1), ...second.slice(0, -1)];
}

/** Outline tolerance in logo units: about a millimetre on the bags' 22 cm letters. */
const TOLERANCE = 1.2;

const round = (rings: Point[][]) => rings.map((points) => points.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]));
const paths = (svg: string, filter: (tag: string) => boolean) =>
  [...svg.matchAll(/<path\b[^>]*>/g)].map(([tag]) => tag).filter(filter).map((tag) => /\sd="([^"]+)"/.exec(tag)![1]);

const logos = new URL('../assets/logos/', import.meta.url);
const js = await readFile(new URL('javascript.svg', logos), 'utf8');
const ts = await readFile(new URL('typescript.svg', logos), 'utf8');
const outlines = {
  // The JS logo: a 630 square, the letters "j" and "s" in black at its bottom right.
  js: { size: 630, color: '#f7df1e', ink: '#000000', rings: round(paths(js, (tag) => /id="[js]"/.test(tag)).flatMap(flatten).map((ring) => simplify(ring, TOLERANCE))) },
  // The TS logo: a 512 square, "TS" in white at its bottom right (one path, both letters).
  ts: { size: 512, color: '#3178c6', ink: '#ffffff', rings: round(paths(ts, () => true).flatMap(flatten).map((ring) => simplify(ring, TOLERANCE))) },
};

/**
 * The Univalle logo in a 300 × 300 box (y down) round its disc (centre 150,150, radius 150), measured on the user's
 * image: the U's straight top and right side, its left side curving into the bottom with a round corner; the V a
 * triangle pointing down whose top edge crosses the U, cut out of it with a red fillet GAP wide all round.
 */
const UNIVALLE = { radius: 150, u: { left: 56, right: 180, top: 80, bottom: 208, corner: 65 }, v: [[116, 147], [248, 147], [182, 273]] as Point[], gap: 8 };

function univalle() {
  const { u, v, gap } = UNIVALLE;
  const ring: Point[] = [[u.left, u.top], [u.right, u.top], [u.right, u.bottom]];
  // The round corner at the bottom left, from the bottom edge up to the left side.
  const centre: Point = [u.left + u.corner, u.bottom - u.corner];
  for (let k = 0; k <= 16; k++) {
    const angle = Math.PI / 2 + (k / 16) * (Math.PI / 2);
    ring.push([centre[0] + Math.cos(angle) * u.corner, centre[1] + Math.sin(angle) * u.corner]);
  }
  // The triangle grown by the fillet: each side moved out by GAP, the corners where the moved sides meet.
  const middle = [(v[0][0] + v[1][0] + v[2][0]) / 3, (v[0][1] + v[1][1] + v[2][1]) / 3];
  const sides = v.map((a, i) => {
    const b = v[(i + 1) % 3];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let normal: Point = [(b[1] - a[1]) / length, -(b[0] - a[0]) / length];
    if ((a[0] - middle[0]) * normal[0] + (a[1] - middle[1]) * normal[1] < 0) normal = [-normal[0], -normal[1]];
    return { a: [a[0] + normal[0] * gap, a[1] + normal[1] * gap] as Point, b: [b[0] + normal[0] * gap, b[1] + normal[1] * gap] as Point };
  });
  const meet = (p: { a: Point; b: Point }, q: { a: Point; b: Point }): Point => {
    const [x1, y1] = p.a; const [x2, y2] = p.b; const [x3, y3] = q.a; const [x4, y4] = q.b;
    const d = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / d;
    return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
  };
  const grown = sides.map((side, i) => meet(sides[(i + 2) % 3], side));
  const cut = polygonClipping.difference([ring], [grown]);
  return { u: cut.map((polygon) => polygon.map((points) => points.slice(0, -1) as Point[])), v };
}

const { u, v } = univalle();
// The Univalle logo: the disc's radius, the U (polygons: outer ring, then holes) and the V.
const marks = { ...outlines, univalle: { radius: UNIVALLE.radius, color: '#e30613', ink: '#ffffff', u: u.map(round), v: round([v]) } };
const output = new URL('logo-outlines.json', logos);
await writeFile(output, `${JSON.stringify(marks)}\n`);
console.log(`logo outlines: ${outlines.js.rings.length} JS rings, ${outlines.ts.rings.length} TS rings, Univalle U in ${u.length} piece(s)`);
