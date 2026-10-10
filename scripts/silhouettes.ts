/**
 * Traces the profile masks rendered by scripts/blender/render_silhouettes.py (assets/renders/silhouettes/*.png) into
 * SVG paths and writes src/ui/silhouettes.ts: the head outline the loading screen draws, and one filled figure per
 * on-screen touch button. Run: node scripts/silhouettes.ts
 *
 * Marching squares on the alpha channel (half coverage, interpolated along the pixel edges), loops linked by their
 * shared edges, simplified with Ramer–Douglas–Peucker. The head keeps its outer loop only, starting under the chin so
 * the loading line begins there; each figure keeps every loop (holes between an arm and the body) for an even-odd fill.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const ROOT = new URL('../', import.meta.url);
const MASKS = new URL('assets/renders/silhouettes/', ROOT);
const OUT = new URL('src/ui/silhouettes.ts', ROOT);
export const ACTIONS = ['jump', 'run', 'punch', 'kick', 'throw', 'sit', 'laptop', 'open', 'nitro'] as const;

type Point = { x: number; y: number };
type Mask = { width: number; height: number; alpha: Float32Array };

/** An 8-bit RGBA, non-interlaced PNG (what Blender writes) as its alpha channel, 0…1. */
export function readPng(data: Uint8Array): Mask {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  const chunks: Uint8Array[] = [];
  while (offset < data.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...data.subarray(offset + 4, offset + 8));
    const body = data.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      if (body[8] !== 8 || body[9] !== 6 || body[12] !== 0) throw new Error('expected an 8-bit RGBA non-interlaced PNG');
    } else if (type === 'IDAT') chunks.push(body);
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * 4;
  const pixels = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const left = i >= 4 ? pixels[y * stride + i - 4] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + i] : 0;
      const corner = y > 0 && i >= 4 ? pixels[(y - 1) * stride + i - 4] : 0;
      let value = line[i];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - corner;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - corner);
        value += pa <= pb && pa <= pc ? left : pb <= pc ? up : corner;
      }
      pixels[y * stride + i] = value & 255;
    }
  }
  const alpha = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) alpha[i] = pixels[i * 4 + 3] / 255;
  return { width, height, alpha };
}

/** Closed loops round the parts of the mask at least half covered, in pixel coordinates (y down). */
export function trace(mask: Mask): Point[][] {
  // One empty pixel of padding all round so every loop closes.
  const w = mask.width + 2;
  const h = mask.height + 2;
  const at = (x: number, y: number) => (x < 1 || y < 1 || x > mask.width || y > mask.height ? 0 : mask.alpha[(y - 1) * mask.width + (x - 1)]);
  const points = new Map<string, Point>();
  const links = new Map<string, string[]>();
  const edge = (kind: 'h' | 'v', x: number, y: number): string => {
    const key = `${kind}${x},${y}`;
    if (!points.has(key)) {
      const a = at(x, y);
      const b = kind === 'h' ? at(x + 1, y) : at(x, y + 1);
      const t = Math.abs(b - a) < 1e-6 ? 0.5 : (0.5 - a) / (b - a);
      points.set(key, kind === 'h' ? { x: x + t - 1, y: y - 1 } : { x: x - 1, y: y + t - 1 });
    }
    return key;
  };
  const link = (a: string, b: string) => {
    links.set(a, [...(links.get(a) ?? []), b]);
    links.set(b, [...(links.get(b) ?? []), a]);
  };
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const tl = at(x, y) >= 0.5 ? 8 : 0;
      const tr = at(x + 1, y) >= 0.5 ? 4 : 0;
      const br = at(x + 1, y + 1) >= 0.5 ? 2 : 0;
      const bl = at(x, y + 1) >= 0.5 ? 1 : 0;
      const code = tl | tr | br | bl;
      if (code === 0 || code === 15) continue;
      const top = () => edge('h', x, y);
      const bottom = () => edge('h', x, y + 1);
      const left = () => edge('v', x, y);
      const right = () => edge('v', x + 1, y);
      const centre = (at(x, y) + at(x + 1, y) + at(x + 1, y + 1) + at(x, y + 1)) / 4 >= 0.5;
      switch (code) {
        case 1: case 14: link(left(), bottom()); break;
        case 2: case 13: link(bottom(), right()); break;
        case 3: case 12: link(left(), right()); break;
        case 4: case 11: link(top(), right()); break;
        case 6: case 9: link(top(), bottom()); break;
        case 7: case 8: link(left(), top()); break;
        case 5:
          if (centre) { link(left(), top()); link(bottom(), right()); } else { link(top(), right()); link(left(), bottom()); }
          break;
        case 10:
          if (centre) { link(top(), right()); link(left(), bottom()); } else { link(left(), top()); link(bottom(), right()); }
          break;
      }
    }
  }
  const loops: Point[][] = [];
  const seen = new Set<string>();
  for (const start of links.keys()) {
    if (seen.has(start)) continue;
    const loop: Point[] = [];
    let previous = '';
    let current = start;
    while (!seen.has(current)) {
      seen.add(current);
      loop.push(points.get(current)!);
      const next = links.get(current)!.find((key) => key !== previous && !seen.has(key)) ?? links.get(current)!.find((key) => key !== previous);
      if (!next) break;
      previous = current;
      current = next;
    }
    if (loop.length > 2) loops.push(loop);
  }
  return loops;
}

export const area = (loop: readonly Point[]) => loop.reduce((sum, p, i) => {
  const q = loop[(i + 1) % loop.length];
  return sum + p.x * q.y - q.x * p.y;
}, 0) / 2;

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

function simplifyOpen(points: readonly Point[], epsilon: number): Point[] {
  if (points.length < 3) return [...points];
  let worst = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = distanceToSegment(points[i], points[0], points[points.length - 1]);
    if (d > worst) { worst = d; index = i; }
  }
  if (worst <= epsilon) return [points[0], points[points.length - 1]];
  return [...simplifyOpen(points.slice(0, index + 1), epsilon).slice(0, -1), ...simplifyOpen(points.slice(index), epsilon)];
}

/** Ramer–Douglas–Peucker on a closed loop: split at the point furthest from the first one. */
export function simplify(loop: readonly Point[], epsilon: number): Point[] {
  let far = 0;
  let best = 0;
  for (let i = 0; i < loop.length; i++) {
    const d = Math.hypot(loop[i].x - loop[0].x, loop[i].y - loop[0].y);
    if (d > best) { best = d; far = i; }
  }
  const first = simplifyOpen([...loop.slice(0, far + 1)], epsilon);
  const second = simplifyOpen([...loop.slice(far), loop[0]], epsilon);
  return [...first.slice(0, -1), ...second.slice(0, -1)];
}

const bounds = (loops: readonly Point[][]) => {
  const all = loops.flat();
  return { x0: Math.min(...all.map((p) => p.x)), y0: Math.min(...all.map((p) => p.y)), x1: Math.max(...all.map((p) => p.x)), y1: Math.max(...all.map((p) => p.y)) };
};

const path = (loops: readonly Point[][], map: (p: Point) => Point) => loops.map((loop) => loop.map((p, i) => {
  const q = map(p);
  return `${i ? 'L' : 'M'}${q.x.toFixed(1)} ${q.y.toFixed(1)}`;
}).join('') + 'Z').join('');

/** The head: its outer loop only, starting at the lowest point (under the chin), in a viewBox 100 units high. */
export function headOutline(mask: Mask) {
  const loops = trace(mask).sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)));
  let loop = simplify(loops[0], 0.7);
  const lowest = loop.reduce((best, p, i) => (p.y > loop[best].y ? i : best), 0);
  loop = [...loop.slice(lowest), ...loop.slice(0, lowest)];
  const box = bounds([loop]);
  const scale = 100 / (box.y1 - box.y0);
  const width = (box.x1 - box.x0) * scale;
  const d = path([loop], (p) => ({ x: (p.x - box.x0) * scale, y: (p.y - box.y0) * scale }));
  return { d, width: Number(width.toFixed(1)), height: 100 };
}

/** A figure: every loop larger than a few pixels, centred in a 100 × 100 box with a small margin. */
export function figure(mask: Mask) {
  const loops = trace(mask).filter((loop) => Math.abs(area(loop)) > 12).map((loop) => simplify(loop, 0.8));
  const box = bounds(loops);
  const scale = 92 / Math.max(box.x1 - box.x0, box.y1 - box.y0);
  const ox = 50 - ((box.x0 + box.x1) / 2) * scale;
  const oy = 50 - ((box.y0 + box.y1) / 2) * scale;
  return { d: path(loops, (p) => ({ x: p.x * scale + ox, y: p.y * scale + oy })), loops: loops.length };
}

function main() {
  const load = (name: string) => readPng(readFileSync(new URL(`${name}.png`, MASKS)));
  const head = headOutline(load('head'));
  const icons = Object.fromEntries(ACTIONS.map((name) => [name, figure(load(name)).d]));
  const lines = [
    '// Generated by scripts/silhouettes.ts from the profile masks of scripts/blender/render_silhouettes.py. Do not edit.',
    '',
    '/** The character\'s head with its backwards cap, in profile facing right: one closed outline starting under the chin. */',
    `export const HEAD_OUTLINE = { d: '${head.d}', width: ${head.width}, height: ${head.height} } as const;`,
    '',
    '/** Filled profile figures of the character doing each touch-button action, in a 100 × 100 box (even-odd fill). */',
    'export const ACTION_ICONS = {',
    ...ACTIONS.map((name) => `  ${name}: '${icons[name]}',`),
    '} as const;',
    '',
    'export type ActionIcon = keyof typeof ACTION_ICONS;',
    '',
  ];
  writeFileSync(OUT, lines.join('\n'));
  console.log(`head: ${head.d.length} chars; icons: ${ACTIONS.map((name) => `${name} ${icons[name].length}`).join(', ')}`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll('\\', '/').split('/').pop()!)) main();
