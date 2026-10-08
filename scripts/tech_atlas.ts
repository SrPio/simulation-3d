/**
 * Logo atlas for the tech tower outside: the official logos in assets/logos/ (see the README there), one cell each
 * on a background that suits it, in the order of TECH_ROWS in create_outside.py. Run by hand:
 * `node scripts/tech_atlas.ts`, then `blender ... --python scripts/blender/create_outside.py -- --replace-generated`.
 */
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

/** Cell order (the cubes from the bottom row up) and each cell's background; logos stay as published. */
export const TECH = [
  ['typescript', '#3178c6'], ['node', '#1d1a26'], ['pnpm', '#1d1a26'], ['vite', '#1d1a26'],
  ['three', '#f4f2f8'], ['github', '#f4f2f8'], ['playwright', '#1d1a26'],
  ['blender', '#1d1a26'], ['gltf', '#f4f2f8'], ['openvdb', '#f4f2f8'],
] as const;
const CELL = 256;
const COLUMNS = 5;
const LOGO = 0.72;   // logo box, as a fraction of the cell; the corners keep the plain background

const logos = new URL('../assets/logos/', import.meta.url);
const output = new URL('../assets/textures/outside/', import.meta.url);
await mkdir(output, { recursive: true });
/** Each logo as published: an SVG, or the PNG icon where the kit has no square SVG (Blender). */
const FILES: Partial<Record<(typeof TECH)[number][0], string>> = { blender: 'blender.png' };
const cells = await Promise.all(TECH.map(async ([name, background]) => {
  const file = FILES[name] ?? `${name}.svg`;
  const data = await readFile(new URL(file, logos));
  const type = file.endsWith('.png') ? 'image/png' : 'image/svg+xml';
  return `<div style="background:${background}"><img alt="" src="data:${type};base64,${data.toString('base64')}"></div>`;
}));
const rows = Math.ceil(TECH.length / COLUMNS);
const html = `<!doctype html><html><head><style>
html,body{margin:0;background:transparent}
#atlas{display:grid;grid-template-columns:repeat(${COLUMNS},${CELL}px);grid-auto-rows:${CELL}px;width:${CELL * COLUMNS}px;height:${CELL * rows}px}
#atlas div{display:flex;align-items:center;justify-content:center}
#atlas img{max-width:${CELL * LOGO}px;max-height:${CELL * LOGO}px;width:${CELL * LOGO}px;height:${CELL * LOGO}px;object-fit:contain}
</style></head><body><div id="atlas">${cells.join('')}</div></body></html>`;

const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: CELL * COLUMNS, height: CELL * rows }, deviceScaleFactor: 1 });
  await page.setContent(html);
  await page.waitForFunction(() => [...document.images].every((image) => image.complete && image.naturalWidth > 0));
  const path = fileURLToPath(new URL('tech-atlas.png', output));
  await page.locator('#atlas').screenshot({ path });
  console.log(`tech atlas: ${path}`);
} finally {
  await browser.close();
}
