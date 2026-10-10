// The spray painting of the graffiti spots onto canvases. Kept apart from the 3D placement (Graffiti.ts) so a worker can
// paint them (graffitiWorker.ts) while the scene loads: OffscreenCanvas works on the page and in a worker alike.
import type { Language } from '../core/i18n.ts';
import { JITTER, glyphLayout, seeded, textFor, type GraffitiFace, type GraffitiSpot, type GraffitiSymbol } from './graffitiData.ts';
import { SPACE, SPRAY_SYMBOLS, TRACKING, sprayGlyph } from './sprayFont.ts';

/** Letter height on the canvas (px); symbols are drawn in a square of SYMBOL_SIZE. */
const LETTER = 180;
const SYMBOL_SIZE = 340;
export const ATLAS_WIDTH = 2048;
export const GAP = 6;

export type Canvas = OffscreenCanvas;
type Context = OffscreenCanvasRenderingContext2D;

export function canvas(width: number, height: number): Canvas {
  const w = Math.max(1, Math.ceil(width));
  const h = Math.max(1, Math.ceil(height));
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  // Older browsers: a page canvas has the same drawing API.
  return Object.assign(document.createElement('canvas'), { width: w, height: h }) as unknown as Canvas;
}

export const context = (element: Canvas): Context => element.getContext('2d', { willReadFrequently: true })!;

/** A copy of an alpha mask in one colour (or a vertical gradient between two). */
function tinted(mask: Canvas, top: string, bottom = top): Canvas {
  const out = canvas(mask.width, mask.height);
  const ctx = context(out);
  ctx.drawImage(mask, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  const gradient = ctx.createLinearGradient(0, mask.height * 0.25, 0, mask.height * 0.75);
  gradient.addColorStop(0, top);
  gradient.addColorStop(1, bottom);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, out.width, out.height);
  return out;
}

/** The mask grown by `radius` px in every direction (a ring of offset copies): the outline under the letters. */
function grown(mask: Canvas, radius: number): Canvas {
  const out = canvas(mask.width, mask.height);
  const ctx = context(out);
  const steps = 20;
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * Math.PI * 2;
    ctx.drawImage(mask, Math.cos(angle) * radius, Math.sin(angle) * radius);
  }
  ctx.drawImage(mask, 0, 0);
  return out;
}

/** Shaky hands: rows, then columns, shift by a wave plus noise, so straight font strokes come out wavering. */
function wobbled(mask: Canvas, amount: number, random: () => number): Canvas {
  const rows = canvas(mask.width, mask.height);
  const band = 3;
  const phase = random() * 10;
  const frequency = 0.02 + random() * 0.02;
  let drift = 0;
  for (let y = 0; y < mask.height; y += band) {
    drift = drift * 0.8 + (random() - 0.5) * amount * 0.5;
    context(rows).drawImage(mask, 0, y, mask.width, band, Math.sin(y * frequency + phase) * amount + drift, y, mask.width, band);
  }
  const out = canvas(mask.width, mask.height);
  drift = 0;
  for (let x = 0; x < mask.width; x += band) {
    drift = drift * 0.8 + (random() - 0.5) * amount * 0.5;
    context(out).drawImage(rows, x, 0, band, mask.height, x, Math.sin(x * frequency * 1.3 + phase * 2) * amount * 0.7 + drift, band, mask.height);
  }
  return out;
}

/** A stroke in canvas pixels. */
type PixelStroke = { x: number; y: number }[];

/**
 * A smooth hand-drawn line through the points (Catmull-Rom), `steps` samples per segment. Long straight segments get
 * points along them first, so a corner only rounds off a little (a box stays a box).
 */
function smoothed(input: PixelStroke, steps = 6, spacing = 18): PixelStroke {
  const points: PixelStroke = [];
  for (let i = 0; i < input.length; i++) {
    if (i > 0) {
      const a = input[i - 1];
      const b = input[i];
      const pieces = Math.floor(Math.hypot(b.x - a.x, b.y - a.y) / spacing);
      for (let k = 1; k < pieces; k++) points.push({ x: a.x + ((b.x - a.x) * k) / pieces, y: a.y + ((b.y - a.y) * k) / pieces });
    }
    points.push(input[i]);
  }
  if (points.length < 3) return points;
  const out: PixelStroke = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      const at = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: at(p0.x, p1.x, p2.x, p3.x), y: at(p0.y, p1.y, p2.y, p3.y) });
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

/** Strokes and filled spots of a spray drawing in canvas pixels, with the canvas size that holds them and their paint. */
type SprayDrawing = { strokes: PixelStroke[]; blobs: { x: number; y: number; r: number }[]; width: number; height: number; line: number };

/** Lay strokes out with room around them: mist all round, the drips below. */
function framed(strokes: PixelStroke[], blobs: SprayDrawing['blobs'], line: number, size: number): SprayDrawing {
  const xs = [...strokes.flat().map((p) => p.x), ...blobs.flatMap((b) => [b.x - b.r, b.x + b.r])];
  const ys = [...strokes.flat().map((p) => p.y), ...blobs.flatMap((b) => [b.y - b.r, b.y + b.r])];
  const pad = line * 2.2;
  const left = Math.min(...xs) - pad;
  const top = Math.min(...ys) - pad;
  const move = (p: { x: number; y: number }) => ({ x: p.x - left, y: p.y - top });
  return {
    strokes: strokes.map((stroke) => stroke.map(move)),
    blobs: blobs.map((b) => ({ ...move(b), r: b.r })),
    width: Math.max(...xs) - left + pad,
    height: Math.max(...ys) - top + pad + size * 0.45,
    line,
  };
}

/** Words in single-stroke capitals, each letter turned, sized and shifted a little on its own, the hand shaking. */
function sprayWords(text: string, spot: GraffitiSpot, random: () => number): SprayDrawing {
  const jitter = JITTER.spray;
  const strokes: PixelStroke[] = [];
  const glyphs = glyphLayout(text, 'spray', spot.seed);
  const cursor: number[] = [];
  const shake = LETTER * 0.025;
  for (const glyph of glyphs) {
    cursor[glyph.line] ??= 0;
    const shape = sprayGlyph(glyph.char);
    const size = LETTER * glyph.scale;
    if (!shape) {
      cursor[glyph.line] += SPACE * LETTER;
      continue;
    }
    const left = cursor[glyph.line];
    const baseline = glyph.line * LETTER * 1.4 + glyph.shift * LETTER;
    const cx = shape.width * size / 2;
    const cos = Math.cos(glyph.turn);
    const sin = Math.sin(glyph.turn);
    for (const stroke of shape.strokes) {
      strokes.push(smoothed(stroke.map(([u, v]) => {
        // About the letter's middle: turn it, lean it like a quick hand, then shake each point.
        const x = u * size - cx - (v - 0.5) * size * jitter.lean;
        const y = (v - 0.5) * size;
        return {
          x: left + cx + x * cos - y * sin + (random() - 0.5) * shake,
          y: baseline + size / 2 + x * sin + y * cos + (random() - 0.5) * shake,
        };
      })));
    }
    cursor[glyph.line] += (shape.width + TRACKING) * size;
  }
  const bounds = (points: PixelStroke) => ({
    left: Math.min(...points.map((p) => p.x)), right: Math.max(...points.map((p) => p.x)),
    top: Math.min(...points.map((p) => p.y)), bottom: Math.max(...points.map((p) => p.y)),
  });
  // A line struck through: one long stroke rising across it, overshooting both ends.
  for (const line of spot.crossed ?? []) {
    const box = bounds(strokes.filter((stroke) => stroke.some((p) => Math.abs(p.y - (line * LETTER * 1.4 + LETTER / 2)) < LETTER * 0.7)).flat());
    if (!Number.isFinite(box.left)) continue;
    const from = { x: box.left - LETTER * 0.25, y: box.bottom + LETTER * 0.12 };
    const to = { x: box.right + LETTER * 0.45, y: box.top - LETTER * 0.3 };
    const bow = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 + LETTER * 0.06 };
    strokes.push(smoothed([from, bow, to].map((p) => ({ x: p.x + (random() - 0.5) * shake, y: p.y + (random() - 0.5) * shake })), 10));
  }
  // A loose ring round everything, drawn in one go: it wobbles and its end runs past its start.
  if (spot.circled && strokes.length) {
    const box = bounds(strokes.flat());
    const cx = (box.left + box.right) / 2;
    const cy = (box.top + box.bottom) / 2;
    const rx = (box.right - box.left) / 2 + LETTER * 0.45;
    const ry = (box.bottom - box.top) / 2 + LETTER * 0.55;
    const start = -Math.PI * (0.55 + random() * 0.2);
    const ring: PixelStroke = [];
    for (let i = 0; i <= 26; i++) {
      const angle = start + (i / 24) * Math.PI * 2;
      const wobble = 1 + (random() - 0.5) * 0.1;
      ring.push({ x: cx + Math.cos(angle) * rx * wobble, y: cy + Math.sin(angle) * ry * wobble });
    }
    strokes.push(smoothed(ring, 4));
  }
  return framed(strokes, [], LETTER * 0.13, LETTER);
}

/** A can-stroke symbol (SPRAY_SYMBOLS) at SYMBOL_SIZE, shaken a little. */
function spraySymbol(symbol: keyof typeof SPRAY_SYMBOLS, random: () => number): SprayDrawing {
  const shape = SPRAY_SYMBOLS[symbol];
  const size = SYMBOL_SIZE;
  const shake = size * 0.015;
  const strokes = shape.strokes.map((stroke) => smoothed(stroke.map(([u, v]) => ({ x: u * size + (random() - 0.5) * shake, y: v * size + (random() - 0.5) * shake }))));
  const blobs = (shape.blobs ?? []).map(([u, v, r]) => ({ x: u * size, y: v * size, r: r * size }));
  return framed(strokes, blobs, size * 0.07, size);
}

/** The drawing's paint in white: strokes that thicken and thin as the can moves, paint pooled where it starts and stops. */
function sprayMask(drawing: SprayDrawing, random: () => number): Canvas {
  const mask = canvas(drawing.width, drawing.height);
  const ctx = context(mask);
  ctx.fillStyle = ctx.strokeStyle = '#fff';
  ctx.lineCap = ctx.lineJoin = 'round';
  const line = drawing.line;
  for (const stroke of drawing.strokes) {
    let width = line * (0.9 + random() * 0.2);
    for (let i = 1; i < stroke.length; i++) {
      width = Math.min(line * 1.2, Math.max(line * 0.75, width + (random() - 0.5) * line * 0.12));
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(stroke[i - 1].x, stroke[i - 1].y);
      ctx.lineTo(stroke[i].x, stroke[i].y);
      ctx.stroke();
    }
    for (const end of [stroke[0], stroke[stroke.length - 1]]) {
      ctx.beginPath();
      ctx.arc(end.x, end.y, line * (0.5 + random() * 0.12), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  for (const blob of drawing.blobs) {
    // A burst: a ragged disc with spatters thrown off round it.
    ctx.beginPath();
    for (let i = 0; i <= 40; i++) {
      const angle = (i / 40) * Math.PI * 2;
      const r = blob.r * (0.9 + random() * 0.14);
      ctx.lineTo(blob.x + Math.cos(angle) * r, blob.y + Math.sin(angle) * r);
    }
    ctx.fill();
    for (let i = 0; i < blob.r * 0.5; i++) {
      const angle = random() * Math.PI * 2;
      const distance = blob.r * (1.0 + random() * 0.35);
      ctx.beginPath();
      ctx.arc(blob.x + Math.cos(angle) * distance, blob.y + Math.sin(angle) * distance, blob.r * (0.02 + random() * 0.07), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return mask;
}

/**
 * Where paint gathers and runs: the lowest point of every stroke and of every blob, and the strokes' ends; points
 * closer together than a stroke and a half count once (a dash does not run three times).
 */
function dripSources(drawing: SprayDrawing): { x: number; y: number }[] {
  const candidates = drawing.strokes.flatMap((stroke) => {
    const lowest = stroke.reduce((low, p) => (p.y > low.y ? p : low), stroke[0]);
    return [lowest, stroke[0], stroke[stroke.length - 1]];
  });
  for (const blob of drawing.blobs) candidates.push({ x: blob.x - blob.r * 0.4, y: blob.y + blob.r * 0.85 }, { x: blob.x + blob.r * 0.3, y: blob.y + blob.r * 0.9 });
  const sources: { x: number; y: number }[] = [];
  for (const point of candidates) {
    if (!sources.some((other) => Math.hypot(other.x - point.x, other.y - point.y) < drawing.line * 1.5)) sources.push(point);
  }
  return sources;
}

/**
 * One colour sprayed along the drawing: a soft mist round the strokes, a dense core with soft edges, speckles flying
 * off them, runs dripping straight down from the lowest points (walls only: on the ground it stays put) and the
 * surface's grain showing through.
 */
function paintSprayed(drawing: SprayDrawing, color: string, face: GraffitiFace, random: () => number): Canvas {
  const mask = sprayMask(drawing, random);
  const line = drawing.line;
  const out = canvas(mask.width, mask.height);
  const ctx = context(out);
  const paint = tinted(mask, color);
  ctx.filter = `blur(${Math.round(line * 0.9)}px)`;
  ctx.globalAlpha = 0.3;
  ctx.drawImage(paint, 0, 0);
  ctx.filter = `blur(${Math.max(1, Math.round(line * 0.12))}px)`;
  ctx.globalAlpha = 1;
  ctx.drawImage(paint, 0, 0);
  ctx.filter = 'none';
  // Speckles: dense near the strokes, sparse further out.
  const haze = canvas(out.width, out.height);
  const hazy = context(haze);
  hazy.filter = `blur(${Math.round(line * 1.3)}px)`;
  hazy.drawImage(mask, 0, 0);
  const mist = alphaOf(haze);
  ctx.fillStyle = color;
  for (let i = 0; i < (out.width * out.height) / 14; i++) {
    const x = random() * out.width;
    const y = random() * out.height;
    const a = mist[Math.floor(y) * out.width + Math.floor(x)];
    if (a < 4 || a > 200 || random() * 200 > a) continue;
    ctx.globalAlpha = 0.5 + random() * 0.5;
    ctx.beginPath();
    ctx.arc(x, y, (0.4 + random() * 1.1) * (line / 20), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  if (face !== 'up') {
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    const painted = alphaOf(mask);
    // A run that would land on more paint just below (an accent over its letter) is left out.
    const lands = (x: number, y: number) => Array.from({ length: 8 }, (_, k) => y + line * (1.2 + k * 0.4))
      .some((below) => below < mask.height && painted[Math.floor(below) * mask.width + Math.floor(x)] > 128);
    for (const source of dripSources(drawing)) {
      if (random() > 0.5 || lands(source.x, source.y)) continue;
      const length = line * (1.5 + random() * 5.5);
      const width = line * (0.22 + random() * 0.22);
      const bottom = Math.min(out.height - width * 2, source.y + length);
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(source.x, source.y);
      ctx.lineTo(source.x + (random() - 0.5) * 1.5, bottom);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(source.x, bottom, width * 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < (out.width * out.height) / 140; i++) {
    ctx.globalAlpha = 0.1 + random() * 0.35;
    ctx.fillRect(random() * out.width, random() * out.height, 1 + random() * 1.5, 1 + random() * 1.5);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  return out;
}

const isSpraySymbol = (symbol: GraffitiSymbol): symbol is keyof typeof SPRAY_SYMBOLS => symbol in SPRAY_SYMBOLS;

/**
 * The chick in sunglasses, as drawn on the «Grafitis · Pollito y Konami» canvas (option B): SVG paths in a 360 px box
 * round (180, 176), drawn at CHICK_SCALE of the symbol's half size per box pixel.
 */
const CHICK = {
  body: 'M180 72 C 240 70 282 118 280 178 C 278 238 236 272 180 272 C 122 272 80 236 82 176 C 84 118 124 74 180 72 Z',
  tuft: 'M174 74 C 166 54 170 44 182 38 M184 72 C 188 54 198 48 208 52',
  wings: 'M90 196 C 72 208 76 228 100 230 M270 196 C 288 208 284 228 260 230',
  lenses: 'M108 136 L172 136 C172 168 164 186 142 186 C 116 186 106 166 108 136 Z M188 136 L252 136 C254 166 244 186 218 186 C 196 186 188 168 188 136 Z',
  bar: 'M98 138 L262 138',
  glints: 'M122 148 L140 166 M134 146 L142 154 M200 148 L218 166 M212 146 L220 154',
  beak: 'M160 196 L200 196 L180 224 Z',
  feet: 'M158 272 L154 300 L142 310 M154 300 L156 314 M154 300 L168 310 M202 272 L206 300 L194 310 M206 300 L208 314 M206 300 L220 310',
};
const CHICK_SCALE = 1 / 150;

/** Into the chick's drawing box: centred on the symbol (already turned by the caller). */
function chickBox(ctx: Context, half: number): void {
  ctx.scale(half * CHICK_SCALE, half * CHICK_SCALE);
  ctx.translate(-180, -176);
}

/** What the chick has in other colours than its feathers, over the painted piece: wings' creases, cheeks, shades, beak, feet. */
function chickDetails(ctx: Context, centre: number, angle: number, outline: string): void {
  ctx.save();
  ctx.translate(centre, centre);
  ctx.rotate(angle);
  chickBox(ctx, SYMBOL_SIZE / 2);
  ctx.lineCap = ctx.lineJoin = 'round';
  ctx.filter = 'blur(0.8px)';
  ctx.strokeStyle = outline;
  ctx.lineWidth = 7;
  ctx.stroke(new Path2D(CHICK.wings));
  ctx.fillStyle = 'rgba(255, 128, 140, 0.6)';
  for (const x of [118, 242]) {
    ctx.beginPath();
    ctx.arc(x, 206, 12, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = ctx.strokeStyle = '#111014';
  ctx.fill(new Path2D(CHICK.lenses));
  ctx.lineWidth = 8;
  ctx.stroke(new Path2D(CHICK.lenses));
  ctx.stroke(new Path2D(CHICK.bar));
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.lineWidth = 4;
  ctx.stroke(new Path2D(CHICK.glints));
  ctx.fillStyle = '#f08a1c';
  ctx.strokeStyle = outline;
  ctx.lineWidth = 3;
  ctx.fill(new Path2D(CHICK.beak));
  ctx.stroke(new Path2D(CHICK.beak));
  ctx.lineWidth = 12;
  ctx.stroke(new Path2D(CHICK.feet));
  ctx.strokeStyle = '#f08a1c';
  ctx.lineWidth = 7;
  ctx.stroke(new Path2D(CHICK.feet));
  ctx.restore();
}

/** A symbol drawn as quick thick strokes and fills on a transparent mask, and the turn it was drawn at. */
function symbolMask(symbol: GraffitiSymbol, spot: GraffitiSpot, random: () => number): { mask: Canvas; angle: number } {
  const size = SYMBOL_SIZE;
  const pad = size * 0.3;
  const mask = canvas(size + pad * 2, size + pad * 2);
  const ctx = context(mask);
  const shake = () => (random() - 0.5) * size * 0.04;
  ctx.translate(pad + size / 2, pad + size / 2);
  const angle = (random() - 0.5) * 0.2;
  ctx.rotate(angle);
  ctx.fillStyle = ctx.strokeStyle = '#fff';
  ctx.lineCap = ctx.lineJoin = 'round';
  ctx.lineWidth = size * 0.11;
  const s = size / 2;
  ctx.beginPath();
  switch (symbol) {
    case 'heart':
      ctx.moveTo(0, s * 0.85);
      ctx.bezierCurveTo(-s * 1.15 + shake(), s * 0.05, -s * 0.75, -s * 0.95 + shake(), 0, -s * 0.35);
      ctx.bezierCurveTo(s * 0.75, -s * 0.95 + shake(), s * 1.15 + shake(), s * 0.05, 0, s * 0.85);
      ctx.fill();
      break;
    case 'star':
      for (let i = 0; i < 10; i++) {
        const radius = (i % 2 ? 0.42 : 1) * s * 0.95 + shake();
        const angle = -Math.PI / 2 + (i * Math.PI) / 5;
        ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
      }
      ctx.closePath();
      ctx.fill();
      break;
    case 'crown':
      ctx.moveTo(-s * 0.85, s * 0.5);
      ctx.lineTo(-s * 0.95 + shake(), -s * 0.55);
      ctx.lineTo(-s * 0.45, s * 0.0 + shake());
      ctx.lineTo(0 + shake(), -s * 0.8);
      ctx.lineTo(s * 0.45, s * 0.0 + shake());
      ctx.lineTo(s * 0.95 + shake(), -s * 0.55);
      ctx.lineTo(s * 0.85, s * 0.5);
      ctx.closePath();
      ctx.stroke();
      for (const x of [-0.95, 0, 0.95]) {
        ctx.moveTo(x * s + s * 0.09, (x ? -0.55 : -0.8) * s - s * 0.12);
        ctx.arc(x * s, (x ? -0.55 : -0.8) * s - s * 0.12, s * 0.09, 0, Math.PI * 2);
      }
      ctx.fill();
      break;
    case 'arrow':
      ctx.moveTo(-s * 0.9, s * 0.3);
      ctx.quadraticCurveTo(-s * 0.2, -s * 0.5 + shake(), s * 0.6, -s * 0.15);
      ctx.moveTo(s * 0.25, -s * 0.45 + shake());
      ctx.lineTo(s * 0.7, -s * 0.12);
      ctx.lineTo(s * 0.3, s * 0.2 + shake());
      ctx.stroke();
      break;
    case 'smiley':
      ctx.arc(0, 0, s * 0.85, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(-s * 0.3, -s * 0.22, s * 0.08, s * 0.16, 0, 0, Math.PI * 2);
      ctx.ellipse(s * 0.3, -s * 0.22 + shake() * 0.5, s * 0.08, s * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(shake() * 0.5, s * 0.05, s * 0.5, 0.2 * Math.PI, 0.8 * Math.PI);
      ctx.stroke();
      break;
    case 'bolt':
      ctx.moveTo(s * 0.2, -s * 0.95);
      ctx.lineTo(-s * 0.55 + shake(), s * 0.12);
      ctx.lineTo(-s * 0.02, s * 0.1);
      ctx.lineTo(-s * 0.25 + shake(), s * 0.95);
      ctx.lineTo(s * 0.6, -s * 0.18);
      ctx.lineTo(s * 0.06, -s * 0.15);
      ctx.closePath();
      ctx.fill();
      break;
    case 'code':
      ctx.lineWidth = size * 0.13;
      ctx.moveTo(-s * 0.45, -s * 0.5);
      ctx.lineTo(-s * 0.95 + shake(), 0);
      ctx.lineTo(-s * 0.45, s * 0.5);
      ctx.moveTo(s * 0.45, -s * 0.5);
      ctx.lineTo(s * 0.95 + shake(), 0);
      ctx.lineTo(s * 0.45, s * 0.5);
      ctx.moveTo(s * 0.22 + shake(), -s * 0.75);
      ctx.lineTo(-s * 0.22 + shake(), s * 0.75);
      ctx.stroke();
      break;
    case 'chick':
      // The feathers only: body, tuft and the wings sticking out; chickDetails adds the rest over the paint.
      chickBox(ctx, s);
      ctx.fill(new Path2D(CHICK.body));
      ctx.lineWidth = 13;
      ctx.stroke(new Path2D(CHICK.tuft));
      ctx.lineWidth = 20;
      ctx.stroke(new Path2D(CHICK.wings));
      break;
  }
  // The chick keeps its lines: its glasses and beak are drawn over it where the drawing says.
  return { mask: symbol === 'chick' ? mask : wobbled(mask, spot.style === 'tag' ? 4 : 3, random), angle };
}

/** Alpha of every pixel of a canvas. */
function alphaOf(element: Canvas): Uint8ClampedArray {
  const data = context(element).getImageData(0, 0, element.width, element.height).data;
  const alpha = new Uint8ClampedArray(element.width * element.height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
  return alpha;
}

/**
 * Paint one spot. Words and the can-stroke symbols are one colour sprayed along simple strokes (paintSprayed); the
 * filled symbols get a soft overspray halo, the outline (pieces), the fill with its fade, uneven spray inside the
 * fill, a highlight or two, loose speckles round the edges, runs dripping down from the lowest strokes on walls, and
 * the wall's own grain showing through.
 */
export function paintSpot(spot: GraffitiSpot, language: Language = 'es'): Canvas {
  const random = seeded(spot.seed * 7919 + 13);
  if (!spot.symbol) return paintSprayed(sprayWords(textFor(spot, language), spot, random), spot.color, spot.face, random);
  if (isSpraySymbol(spot.symbol)) return paintSprayed(spraySymbol(spot.symbol, random), spot.color, spot.face, random);
  const { mask, angle } = symbolMask(spot.symbol, spot, random);
  const top = spot.color;
  const bottom = spot.fade ?? spot.color;
  const ink = spot.outline ?? top;
  const piece = spot.style === 'piece';
  // Only a piece with an `outline` colour gets the dark rim under its fill.
  const outlined = piece && spot.outline !== undefined;
  const size = SYMBOL_SIZE * 0.5;
  const outline = outlined ? grown(mask, size * 0.075) : mask;
  const out = canvas(mask.width, mask.height);
  const ctx = context(out);
  // Overspray: the colour mist that lands round every stroke.
  ctx.filter = `blur(${Math.round(size * 0.07)}px)`;
  ctx.globalAlpha = 0.4;
  ctx.drawImage(tinted(outline, top), 0, 0);
  ctx.globalAlpha = 1;
  if (outlined) {
    ctx.filter = 'blur(1.5px)';
    ctx.drawImage(tinted(outline, ink), 0, 0);
  }
  ctx.filter = piece ? 'blur(1px)' : 'blur(1.8px)';
  ctx.drawImage(tinted(mask, top, bottom), 0, 0);
  ctx.filter = 'none';
  // Uneven spray inside the fill: lighter and darker blotches, kept to the letters.
  const blotches = canvas(out.width, out.height);
  const blot = context(blotches);
  blot.drawImage(mask, 0, 0);
  blot.globalCompositeOperation = 'source-in';
  blot.filter = 'blur(6px)';
  for (let i = 0; i < 70; i++) {
    blot.fillStyle = random() < 0.5 ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.16)';
    blot.beginPath();
    blot.arc(random() * out.width, random() * out.height, size * (0.04 + random() * 0.1), 0, Math.PI * 2);
    blot.fill();
  }
  ctx.drawImage(blotches, 0, 0);
  // Highlights: short white glints near the top left of the letters (pieces only).
  if (piece) {
    const shine = canvas(out.width, out.height);
    const glint = context(shine);
    glint.drawImage(mask, 0, 0);
    glint.globalCompositeOperation = 'source-in';
    glint.strokeStyle = 'rgba(255,255,255,0.85)';
    glint.lineCap = 'round';
    glint.lineWidth = size * 0.035;
    const alpha = alphaOf(mask);
    for (let tries = 0, drawn = 0; tries < 400 && drawn < 4; tries++) {
      const x = Math.floor(random() * out.width);
      const y = Math.floor(random() * out.height * 0.6);
      if (alpha[y * out.width + x] < 200) continue;
      glint.beginPath();
      glint.moveTo(x, y);
      glint.lineTo(x + size * (0.08 + random() * 0.08), y - size * 0.04);
      glint.stroke();
      drawn++;
    }
    ctx.drawImage(shine, 0, 0);
  }
  if (spot.symbol === 'chick') chickDetails(ctx, mask.width / 2, angle, ink);
  // Speckles where the mist thins out round the strokes.
  const haze = canvas(out.width, out.height);
  const hazy = context(haze);
  hazy.filter = `blur(${Math.round(size * 0.06)}px)`;
  hazy.drawImage(outline, 0, 0);
  const mist = alphaOf(haze);
  const speckle = outlined ? ink : top;
  for (let i = 0; i < 2600; i++) {
    const x = random() * out.width;
    const y = random() * out.height;
    const a = mist[Math.floor(y) * out.width + Math.floor(x)];
    if (a < 8 || a > 150) continue;
    ctx.globalAlpha = 0.35 + random() * 0.5;
    ctx.fillStyle = random() < 0.7 ? speckle : top;
    ctx.beginPath();
    ctx.arc(x, y, 0.6 + random() * 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // Runs: paint gathers at the bottom of a stroke and drips straight down (walls only; on the ground it stays put).
  if (spot.face !== 'up') {
    const alpha = alphaOf(mask);
    const runs = piece ? 6 : 4;
    for (let tries = 0, drawn = 0; tries < 300 && drawn < runs; tries++) {
      const x = Math.floor(out.width * (0.1 + random() * 0.8));
      let bottomY = -1;
      for (let y = out.height - 1; y >= 0; y--) {
        if (alpha[y * out.width + x] > 200) {
          bottomY = y;
          break;
        }
      }
      if (bottomY < 0) continue;
      const length = Math.min(out.height - bottomY - 4, size * (0.12 + random() * 0.45));
      const width = 2 + random() * size * 0.025;
      const gradient = ctx.createLinearGradient(0, bottomY, 0, bottomY + length);
      gradient.addColorStop(0, bottom);
      gradient.addColorStop(1, bottom);
      ctx.strokeStyle = gradient;
      ctx.fillStyle = bottom;
      ctx.lineCap = 'round';
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(x, bottomY - 3);
      ctx.lineTo(x + (random() - 0.5) * 2, bottomY + length);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, bottomY + length, width * 0.75, 0, Math.PI * 2);
      ctx.fill();
      drawn++;
    }
  }
  // The surface's grain: tiny gaps where the paint did not catch.
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < (out.width * out.height) / 90; i++) {
    ctx.globalAlpha = 0.15 + random() * 0.45;
    ctx.fillRect(random() * out.width, random() * out.height, 1 + random() * 2, 1 + random() * 2);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  return out;
}
