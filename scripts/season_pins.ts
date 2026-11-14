/**
 * The season pins' pictures (src/core/pins.ts): each source drawing in assets/pins/ (a cartoon with a black outline on a
 * white background) becomes a small transparent WebP in public/pins/. The white round the drawing is taken away by
 * filling it from the picture's border (and from any `holes`: white pockets the outline closes off from the border),
 * the outline's soft edge against that white is turned into transparency (unblended from white), and the drawing is
 * cropped to its bounds and scaled to `height` pixels tall.
 * Run by hand: `node scripts/season_pins.ts`.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

type Source = {
  /** assets/pins/<file> → public/pins/<id>.webp */
  file: string;
  id: string;
  /** Height of the web picture (px); the album and the world never draw it larger. */
  height: number;
  /** Extra seeds (source pixels) inside white pockets closed off from the border. */
  holes: [number, number][];
};

const SOURCES: Source[] = [
  { file: 'christmas-snowman.jpg', id: 'christmas-snowman', height: 480, holes: [] },
];

/** Runs in the page: cuts the drawing out and returns it as a WebP data URL and its size. */
async function cut({ url, height, holes }: { url: string; height: number; holes: [number, number][] }) {
  const image = new Image();
  image.src = url;
  await image.decode();
  const w = image.naturalWidth;
  const h = image.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(image, 0, 0);
  const data = g.getImageData(0, 0, w, h);
  const px = data.data;
  // Background: near white and grey-free, reached from the border without crossing the outline.
  const white = (i: number) => {
    const r = px[i * 4], gr = px[i * 4 + 1], b = px[i * 4 + 2];
    return Math.min(r, gr, b) > 228 && Math.max(r, gr, b) - Math.min(r, gr, b) < 22;
  };
  const background = new Uint8Array(w * h);
  const stack: number[] = [];
  const seed = (i: number) => {
    if (!background[i] && white(i)) {
      background[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    seed(x);
    seed((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    seed(y * w);
    seed(y * w + w - 1);
  }
  for (const [x, y] of holes) seed(y * w + x);
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    if (x > 0) seed(i - 1);
    if (x < w - 1) seed(i + 1);
    if (i >= w) seed(i - w);
    if (i < w * (h - 1)) seed(i + w);
  }
  // The edge: pixels within two of the background are the outline blended with white; unblend them.
  const near = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (!background[i]) continue;
    const x = i % w;
    const y = (i - x) / w;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h) near[ny * w + nx] = 1;
      }
    }
  }
  let minX = w, minY = h, maxX = 0, maxY = 0;
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    if (background[i]) {
      px[o + 3] = 0;
      continue;
    }
    if (near[i]) {
      // How far from white it is, against the outline's own darkness (about 25).
      const lightest = Math.min(px[o], px[o + 1], px[o + 2]);
      const alpha = Math.min(1, (255 - lightest) / 230);
      if (alpha < 0.04) {
        px[o + 3] = 0;
        continue;
      }
      for (let c = 0; c < 3; c++) px[o + c] = Math.max(0, Math.min(255, Math.round((px[o + c] - 255 * (1 - alpha)) / alpha)));
      px[o + 3] = Math.round(alpha * 255);
    }
    const x = i % w;
    const y = (i - x) / w;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  g.putImageData(data, 0, 0);
  const pad = 4;
  const cropW = maxX - minX + 1;
  const cropH = maxY - minY + 1;
  const scale = (height - pad * 2) / cropH;
  const out = document.createElement('canvas');
  out.width = Math.round(cropW * scale) + pad * 2;
  out.height = height;
  const o = out.getContext('2d')!;
  o.imageSmoothingQuality = 'high';
  o.drawImage(canvas, minX, minY, cropW, cropH, pad, pad, cropW * scale, cropH * scale);
  return { url: out.toDataURL('image/webp', 0.86), width: out.width, height: out.height };
}

const root = fileURLToPath(new URL('..', import.meta.url));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage();
await mkdir(`${root}public/pins`, { recursive: true });
for (const source of SOURCES) {
  const bytes = await readFile(`${root}assets/pins/${source.file}`);
  const url = `data:image/jpeg;base64,${bytes.toString('base64')}`;
  const result = await page.evaluate(cut, { url, height: source.height, holes: source.holes });
  const webp = Buffer.from(result.url.split(',')[1], 'base64');
  await writeFile(`${root}public/pins/${source.id}.webp`, webp);
  console.log(`${source.id}.webp ${result.width}×${result.height} ${(webp.length / 1024).toFixed(1)} KB`);
}
await browser.close();
