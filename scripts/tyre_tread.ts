/**
 * The tyres' rubber (circuit.glb, scripts/blender/create_circuit.py `tyre_mesh`): a smooth tread with the chevron
 * pattern of assets/textures/circuit/tread-pattern.png (the user's image, four strips of blocks with white grooves)
 * painted on it faintly, a shade darker in the grooves, and plain rubber on the sidewalls.
 * Run by hand: `node scripts/tyre_tread.ts`, then
 * `blender ... --python scripts/blender/create_circuit.py -- --replace-generated`.
 *
 * Layout: x runs round the tyre (u: TYRE_TREAD_REPEATS copies round it), y across its profile from one bead to the
 * other; the tread, shoulder to shoulder, fills TREAD[0] … TREAD[1] of the height (TYRE_TREAD_V in create_circuit.py).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const SIZE = 256;
/** The tread's band across the image: TYRE_TREAD_V in create_circuit.py. */
const TREAD = [0.2, 0.8];
/** The first strip of the pattern image (x from, to) and how far its blocks repeat down it (px); one copy round the
 * tyre is PERIODS of them, so it joins up seamlessly (three copies make about 30 chevrons, as a car tyre has). */
const STRIP = [11, 163];
const PERIOD = 46;
const PERIODS = 10;
/** Rubber, and the grooves a little darker: faint, as the user asked. sRGB. */
const RUBBER = [56, 56, 60];
const GROOVE = [38, 38, 41];

/** Runs in the page: paints the rubber and returns it as a PNG data URL. */
async function paint(size: number, tread: number[], patternUrl: string, strip: number[], length: number, rubber: number[], groove: number[]) {
  const pattern = new Image();
  pattern.src = patternUrl;
  await pattern.decode();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  g.fillStyle = `rgb(${rubber.join(',')})`;
  g.fillRect(0, 0, size, size);
  // The grooves (white in the image) as a mask of the strip, laid along x (round the tyre) across the tread's band.
  const mask = document.createElement('canvas');
  mask.width = size;
  mask.height = size;
  const m = mask.getContext('2d')!;
  const top = tread[0] * size;
  const band = (tread[1] - tread[0]) * size;
  m.setTransform(0, band / (strip[1] - strip[0]), size / length, 0, 0, top);
  m.imageSmoothingQuality = 'high';
  m.drawImage(pattern, strip[0], 0, strip[1] - strip[0], length, 0, 0, strip[1] - strip[0], length);
  m.setTransform(1, 0, 0, 1, 0, 0);
  const pixels = m.getImageData(0, 0, size, size);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const light = pixels.data[i] / 255;
    pixels.data[i] = groove[0];
    pixels.data[i + 1] = groove[1];
    pixels.data[i + 2] = groove[2];
    pixels.data[i + 3] = Math.round(light * pixels.data[i + 3]);
  }
  m.putImageData(pixels, 0, 0);
  // The strip's own margins are white too: keep the grooves to the band, fading at the shoulders.
  g.save();
  g.beginPath();
  g.rect(0, top + 2, size, band - 4);
  g.clip();
  g.filter = 'blur(0.4px)';
  g.drawImage(mask, 0, 0);
  g.restore();
  return canvas.toDataURL('image/png');
}

const output = new URL('../assets/textures/circuit/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 });
  await page.setContent('<!doctype html><html><body></body></html>');
  const pattern = `data:image/png;base64,${(await readFile(new URL('tread-pattern.png', output))).toString('base64')}`;
  const args = [SIZE, TREAD, pattern, STRIP, PERIOD * PERIODS, RUBBER, GROOVE].map((value) => JSON.stringify(value)).join(', ');
  const data = await page.evaluate(`(${paint.toString()})(${args})`) as string;
  const path = fileURLToPath(new URL('tyre.png', output));
  await writeFile(path, Buffer.from(data.split(',')[1], 'base64'));
  console.log(`tyre rubber: ${path}`);
} finally {
  await browser.close();
}
