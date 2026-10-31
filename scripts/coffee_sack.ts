/**
 * The print of the coffee sacks on the circuit (circuit.glb, scripts/blender/create_circuit.py `sack_mesh`): jute
 * weave all over, stitched seams at both ends, two faded stripes along the sides and, on top, the Java cup
 * (assets/logos/java.png) sprayed in black through a stencil (a soft overspray edge, paint that misses the gaps of the
 * weave and a few specks round it).
 * Run by hand: `node scripts/coffee_sack.ts`, then
 * `blender ... --python scripts/blender/create_circuit.py -- --replace-generated`.
 *
 * Layout: x runs along the sack (u), y round it from the seam underneath (the top's middle at half the height), so a
 * metre along is WIDTH / PRINT[0] pixels and a metre round is HEIGHT / PRINT[1]: SACK_PRINT in create_circuit.py.
 * The stencil stands along the sack, its top towards x = WIDTH.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const WIDTH = 256;
const HEIGHT = 512;
/** The sack's length and its girth round the middle (m): SACK_PRINT in create_circuit.py. */
const PRINT = [1.05, 1.886];
/** The logo image's side on the sack (m); the cup itself fills about three quarters of its width. */
const LOGO = 0.6;

/** Runs in the page: paints the print and returns it as a PNG data URL. */
async function paint(width: number, height: number, print: number[], logoUrl: string, size: number) {
  const logo = new Image();
  logo.src = logoUrl;
  await logo.decode();
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d')!;
  let seed = 11;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  // Jute: one tone per thread both ways, raised crossings lighter, the gaps between them darker, a few blotches.
  const PITCH = 4;
  const warp = Array.from({ length: Math.ceil(width / PITCH) }, () => random() * 0.14 - 0.07);
  const weft = Array.from({ length: Math.ceil(height / PITCH) }, () => random() * 0.14 - 0.07);
  const base = [176, 146, 104];
  const shade = (k: number) => `rgb(${base.map((c) => Math.round(Math.min(255, Math.max(0, c * (1 + k))))).join(',')})`;
  g.fillStyle = shade(-0.28);
  g.fillRect(0, 0, width, height);
  for (let i = 0; i < warp.length; i++) {
    for (let j = 0; j < weft.length; j++) {
      const x = i * PITCH;
      const y = j * PITCH;
      // Plain weave: the warp on top on one diagonal of cells, the weft on the other.
      if ((i + j) % 2) {
        g.fillStyle = shade(warp[i] + 0.02);
        g.fillRect(x + 0.5, y, PITCH - 1.5, PITCH);
        g.fillStyle = shade(warp[i] + 0.1);
        g.fillRect(x + 1, y + 1, 1, PITCH - 2);
      } else {
        g.fillStyle = shade(weft[j] - 0.03);
        g.fillRect(x, y + 0.5, PITCH, PITCH - 1.5);
        g.fillStyle = shade(weft[j] + 0.06);
        g.fillRect(x + 1, y + 1, PITCH - 2, 1);
      }
    }
  }
  for (let k = 0; k < 24; k++) {
    const x = random() * width;
    const y = random() * height;
    const r = 12 + random() * 30;
    const blot = g.createRadialGradient(x, y, 0, x, y, r);
    blot.addColorStop(0, `rgba(70, 48, 24, ${0.06 + random() * 0.08})`);
    blot.addColorStop(1, 'rgba(70, 48, 24, 0)');
    g.fillStyle = blot;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // Loose fibres.
  g.lineWidth = 0.7;
  for (let k = 0; k < 120; k++) {
    const x = random() * width;
    const y = random() * height;
    const a = random() * Math.PI;
    const l = 3 + random() * 7;
    g.strokeStyle = random() < 0.5 ? 'rgba(220, 192, 145, 0.55)' : 'rgba(95, 70, 40, 0.45)';
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + random() * 2, y + Math.sin(a) * l * 0.5 + random() * 2, x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }

  // The seams at both ends: a fold and a row of twine stitches across the whole girth.
  for (const x of [6, width - 6]) {
    g.fillStyle = 'rgba(60, 40, 20, 0.35)';
    g.fillRect(x - 3, 0, 6, height);
    for (let y = 0; y < height; y += 9) {
      g.strokeStyle = '#5a3f22';
      g.lineWidth = 2.2;
      g.beginPath();
      g.moveTo(x - 4, y);
      g.lineTo(x + 4, y + 5);
      g.stroke();
      g.strokeStyle = 'rgba(230, 205, 160, 0.5)';
      g.lineWidth = 0.8;
      g.beginPath();
      g.moveTo(x - 3.5, y + 0.5);
      g.lineTo(x + 3, y + 4.5);
      g.stroke();
    }
  }

  // Two faded green stripes along each side, between the top and the seam underneath.
  const perU = width / print[0];
  const perV = height / print[1];
  for (const middle of [0.25, 0.75]) {
    for (const offset of [-0.035, 0.035]) {
      const y = (middle + offset / print[1]) * height;
      g.fillStyle = 'rgba(38, 92, 52, 0.45)';
      g.fillRect(16, y - 0.012 * perV, width - 32, 0.024 * perV);
    }
  }

  // The stencil: the Java cup (assets/logos/java.png, black on transparent) as a white mask whose alpha is how dark
  // and opaque the logo is there, LOGO metres square, stood along the sack with its top towards +x.
  const source = document.createElement('canvas');
  source.width = logo.naturalWidth;
  source.height = logo.naturalHeight;
  const s = source.getContext('2d')!;
  s.drawImage(logo, 0, 0);
  const pixels = s.getImageData(0, 0, source.width, source.height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const [r, gr, b, a] = [pixels.data[i], pixels.data[i + 1], pixels.data[i + 2], pixels.data[i + 3]];
    const dark = 1 - (0.299 * r + 0.587 * gr + 0.114 * b) / 255;
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = 255;
    pixels.data[i + 3] = Math.round(dark * a);
  }
  s.putImageData(pixels, 0, 0);
  const mask = document.createElement('canvas');
  mask.width = width;
  mask.height = height;
  const m = mask.getContext('2d')!;
  const centre = [width * 0.5, height * 0.5];
  m.setTransform(0, perV, -perU, 0, centre[0], centre[1]);
  m.imageSmoothingQuality = 'high';
  m.drawImage(source, -size / 2, -size / 2, size, size);
  m.setTransform(1, 0, 0, 1, 0, 0);

  // Spray: a faint blurred halo first, then the paint, thinner where it misses the gaps of the weave.
  const ink = document.createElement('canvas');
  ink.width = width;
  ink.height = height;
  const p = ink.getContext('2d')!;
  p.filter = 'blur(1.4px)';
  p.globalAlpha = 0.3;
  p.drawImage(mask, 0, 0);
  p.filter = 'none';
  p.globalAlpha = 1;
  p.drawImage(mask, 0, 0);
  // Specks of overspray round the stencil's edges.
  p.fillStyle = '#fff';
  for (let k = 0; k < 700; k++) {
    const cx = centre[0] + (random() - 0.5) * size * 1.1 * perU;
    const cy = centre[1] + (random() - 0.5) * size * 0.85 * perV;
    p.globalAlpha = 0.2 + random() * 0.4;
    p.fillRect(cx, cy, random() < 0.8 ? 1 : 2, 1);
  }
  p.globalAlpha = 1;
  // Patchy coverage: knock some paint out of the gaps of the weave and in soft patches.
  p.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < width; i += PITCH) {
    for (let j = 0; j < height; j += PITCH) {
      // The gap beside the thread on top of this cell (the weave above).
      const warpOnTop = (i / PITCH + j / PITCH) % 2 === 1;
      p.fillStyle = `rgba(0, 0, 0, ${0.18 + random() * 0.18})`;
      p.fillRect(warpOnTop ? i + PITCH - 1 : i, warpOnTop ? j : j + PITCH - 1, warpOnTop ? 1 : PITCH, warpOnTop ? PITCH : 1);
    }
  }
  for (let k = 0; k < 16; k++) {
    const cx = centre[0] + (random() - 0.5) * size * perU;
    const cy = centre[1] + (random() - 0.5) * size * 0.7 * perV;
    const r = 6 + random() * 13;
    const worn = p.createRadialGradient(cx, cy, 0, cx, cy, r);
    worn.addColorStop(0, `rgba(0, 0, 0, ${0.15 + random() * 0.2})`);
    worn.addColorStop(1, 'rgba(0, 0, 0, 0)');
    p.fillStyle = worn;
    p.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  // The ink itself: black where the mask is.
  p.globalCompositeOperation = 'source-in';
  p.fillStyle = '#121010';
  p.fillRect(0, 0, width, height);
  g.globalAlpha = 0.92;
  g.drawImage(ink, 0, 0);
  g.globalAlpha = 1;
  return canvas.toDataURL('image/png');
}

const output = new URL('../assets/textures/circuit/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
  await page.setContent('<!doctype html><html><body></body></html>');
  const logo = `data:image/png;base64,${(await readFile(new URL('../assets/logos/java.png', import.meta.url))).toString('base64')}`;
  const data = await page.evaluate(`(${paint.toString()})(${WIDTH}, ${HEIGHT}, ${JSON.stringify(PRINT)}, ${JSON.stringify(logo)}, ${LOGO})`) as string;
  const path = fileURLToPath(new URL('coffee-sack.png', output));
  await writeFile(path, Buffer.from(data.split(',')[1], 'base64'));
  console.log(`coffee sack: ${path}`);
} finally {
  await browser.close();
}
