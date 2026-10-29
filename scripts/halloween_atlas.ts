/**
 * Texture atlas of the Halloween dress-up (halloween.glb, scripts/blender/create_halloween.py): one 256 px cell per
 * texture in four columns, and a second image of the same layout with what glows (the carved faces lit from inside).
 * Run by hand: `node scripts/halloween_atlas.ts`, then
 * `blender ... --python scripts/blender/create_halloween.py -- --replace-generated`.
 *
 * Cells (row by row): the bowling pin as a pumpkin (cylindrical: u round the pin with its front at u 0.5, v up its
 * height), the bowling ball as an eye (longitude and latitude, the iris at the front), three dark stones for the bricks,
 * a carved pumpkin and a plain one (cylindrical like the pin), five gravestones (the front face over the whole cell,
 * GRAVE_FACE metres wide and high, so the lettering is drawn squeezed to come out right on the stone) and the ember: the
 * candle-lit inside of a carved pumpkin, seen through the face cut into it (it glows).
 */
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

export const CELLS = ['pin', 'eye', 'stone0', 'stone1', 'stone2', 'jack', 'pumpkin', 'grave0', 'grave1', 'grave2', 'grave3', 'grave4', 'ember'] as const;
export const COLUMNS = 4;
const CELL = 256;
/** The gravestones' front face, width and height (m): GRAVE in create_halloween.py. */
const GRAVE_FACE = [0.64, 0.96];
/** The epitaphs: the same in both languages (a dev's graveyard). The first line is the large one. */
const EPITAPHS = [
  ['RIP', 'IE 6', '2001 – 2022'],
  ['RIP', 'FLASH', '1996 – 2020'],
  ['RIP', 'undefined', 'is not a function'],
  ['RIP', '404', 'NOT FOUND'],
  ['RIP', 'MY CODE', 'git push -f'],
];
/** Where the pin's red band was (PIN_BAND over PIN_HEIGHT in create_outside.py): a dark band here. */
const PIN_BAND = [0.415 / 0.7, 0.445 / 0.7];

const output = new URL('../assets/textures/halloween/', import.meta.url);
await mkdir(output, { recursive: true });
const rows = Math.ceil(CELLS.length / COLUMNS);

/** Runs in the page: paints both atlases and returns them as PNG data URLs. */
function paint(cells: readonly string[], columns: number, size: number, epitaphs: string[][], graveFace: number[], pinBand: number[]) {
  const width = columns * size;
  const height = Math.ceil(cells.length / columns) * size;
  const make = () => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas.getContext('2d')!;
  };
  const color = make();
  const glow = make();
  glow.fillStyle = '#000';
  glow.fillRect(0, 0, width, height);
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const font = (weight: number, px: number) => `${weight} ${px}px Bahnschrift, "Bahnschrift SemiCondensed", "Barlow Semi Condensed", Arial, sans-serif`;

  /** Orange pumpkin skin with darker grooves between the ribs and lighter middles (u round the pumpkin). */
  const skin = (g: CanvasRenderingContext2D, x: number, y: number, ribs: number) => {
    const base = g.createLinearGradient(x, y, x, y + size);
    base.addColorStop(0, '#d9611a');
    base.addColorStop(0.5, '#f07a1c');
    base.addColorStop(1, '#b84f12');
    g.fillStyle = base;
    g.fillRect(x, y, size, size);
    for (let k = 0; k < ribs; k++) {
      const cx = x + (k + 0.5) * size / ribs;
      const rib = g.createLinearGradient(cx - size / ribs / 2, 0, cx + size / ribs / 2, 0);
      rib.addColorStop(0, 'rgba(110, 35, 5, 0.55)');
      rib.addColorStop(0.5, 'rgba(255, 170, 70, 0.25)');
      rib.addColorStop(1, 'rgba(110, 35, 5, 0.55)');
      g.fillStyle = rib;
      g.fillRect(cx - size / ribs / 2, y, size / ribs, size);
    }
    // Speckles.
    for (let k = 0; k < 120; k++) {
      g.fillStyle = `rgba(${random() < 0.5 ? '255, 200, 120' : '90, 30, 0'}, ${0.08 + random() * 0.12})`;
      g.beginPath();
      g.arc(x + random() * size, y + random() * size, 0.5 + random() * 1.5, 0, Math.PI * 2);
      g.fill();
    }
  };

  /** A jack-o'-lantern face centred on (cx, cy): triangle eyes, a nose and a toothed grin, `scale` its half width. */
  const face = (g: CanvasRenderingContext2D, cx: number, cy: number, sx: number, sy: number, inside: string, lit: boolean) => {
    const holes = new Path2D();
    const p = (path: Path2D, points: number[][]) => {
      path.moveTo(cx + points[0][0] * sx, cy + points[0][1] * sy);
      for (const [px, py] of points.slice(1)) path.lineTo(cx + px * sx, cy + py * sy);
      path.closePath();
    };
    p(holes, [[-0.78, -0.18], [-0.28, -0.22], [-0.5, -0.72]]);
    p(holes, [[0.78, -0.18], [0.28, -0.22], [0.5, -0.72]]);
    p(holes, [[-0.12, 0.08], [0.12, 0.08], [0, -0.14]]);
    p(holes, [[-0.82, 0.22], [-0.55, 0.3], [-0.45, 0.22], [-0.35, 0.34], [-0.15, 0.3], [-0.05, 0.42], [0.05, 0.42], [0.15, 0.3], [0.35, 0.34],
      [0.45, 0.22], [0.55, 0.3], [0.82, 0.22], [0.6, 0.62], [0.4, 0.55], [0.3, 0.72], [0.1, 0.62], [0, 0.76], [-0.1, 0.62], [-0.3, 0.72],
      [-0.4, 0.55], [-0.6, 0.62]]);
    if (lit) {
      // The candle's light: bright in the middle of each hole, deeper orange at the cut edges.
      g.fillStyle = inside;
      g.fill(holes);
    } else {
      g.save();
      g.shadowColor = 'rgba(255, 190, 60, 0.9)';
      g.shadowBlur = sx * 0.15;
      g.fillStyle = '#ffcf3a';
      g.fill(holes);
      g.restore();
      g.lineWidth = Math.max(1.5, sx * 0.05);
      g.strokeStyle = '#7a2a06';
      g.stroke(holes);
      g.fillStyle = inside;
      g.save();
      g.clip(holes);
      const light = g.createRadialGradient(cx, cy, 0, cx, cy, sx);
      light.addColorStop(0, '#fff1a0');
      light.addColorStop(0.6, '#ffc83a');
      light.addColorStop(1, '#ff8a10');
      g.fillStyle = light;
      g.fillRect(cx - sx, cy - sy, sx * 2, sy * 2);
      g.restore();
    }
  };

  /** Dark, eerie stone: charcoal and violet blotches, black cracks and a little green moss. */
  const stone = (g: CanvasRenderingContext2D, x: number, y: number, tint: [number, number, number], light = 1) => {
    g.fillStyle = `rgb(${tint.map((value) => Math.round(value * light)).join(',')})`;
    g.fillRect(x, y, size, size);
    for (let k = 0; k < 160; k++) {
      const r = 4 + random() * 28;
      const dark = random() < 0.55;
      g.fillStyle = dark ? `rgba(8, 5, 12, ${0.08 + random() * 0.18})` : `rgba(${Math.round(120 * light)}, ${Math.round(100 * light)}, ${Math.round(140 * light)}, ${0.05 + random() * 0.12})`;
      g.beginPath();
      g.ellipse(x + random() * size, y + random() * size, r, r * (0.4 + random() * 0.6), random() * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
    for (let k = 0; k < 900; k++) {
      g.fillStyle = `rgba(${random() < 0.5 ? '0,0,0' : '200,190,220'}, ${0.08 + random() * 0.15})`;
      g.fillRect(x + random() * size, y + random() * size, 1 + random() * 1.5, 1 + random() * 1.5);
    }
    g.save();
    g.beginPath();
    g.rect(x, y, size, size);
    g.clip();
    g.strokeStyle = 'rgba(0, 0, 0, 0.75)';
    for (let k = 0; k < 4; k++) {
      g.lineWidth = 1 + random() * 1.6;
      g.beginPath();
      let px = x + random() * size;
      let py = y + random() * size;
      g.moveTo(px, py);
      for (let s = 0; s < 7; s++) {
        px += (random() - 0.5) * 50;
        py += (random() - 0.3) * 30;
        g.lineTo(px, py);
      }
      g.stroke();
    }
    for (let k = 0; k < 7; k++) {
      const mx = x + random() * size;
      const my = y + size * (0.6 + random() * 0.4);
      for (let s = 0; s < 25; s++) {
        g.fillStyle = `rgba(${40 + random() * 30}, ${80 + random() * 50}, ${30 + random() * 20}, ${0.25 + random() * 0.35})`;
        g.beginPath();
        g.arc(mx + (random() - 0.5) * 30, my + (random() - 0.5) * 14, 1 + random() * 3, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.restore();
  };

  for (const [index, name] of cells.entries()) {
    const x = (index % columns) * size;
    const y = Math.floor(index / columns) * size;
    // Canvas y grows downwards: v = 1 (the top of a pin, pumpkin or stone) is the cell's first row.
    const v = (value: number) => y + (1 - value) * size;
    // Each cell keeps to itself: blotches and veins would bleed into the neighbours.
    for (const g of [color, glow]) {
      g.save();
      g.beginPath();
      g.rect(x, y, size, size);
      g.clip();
    }
    if (name === 'pin') {
      skin(color, x, y, 8);
      color.fillStyle = '#2b1a3a';
      color.fillRect(x, v(pinBand[1]), size, v(pinBand[0]) - v(pinBand[1]));
      // The crown: the pumpkin's green-brown stalk end.
      const crown = color.createLinearGradient(0, v(1), 0, v(0.88));
      crown.addColorStop(0, '#3b4a1a');
      crown.addColorStop(1, 'rgba(70, 85, 30, 0)');
      color.fillStyle = crown;
      color.fillRect(x, v(1), size, v(0.88) - v(1));
      face(color, x + size / 2, v(0.31), size * 0.12, size * 0.16, '#ffd84a', false);
      face(glow, x + size / 2, v(0.31), size * 0.12, size * 0.16, '#ffb52e', true);
    } else if (name === 'eye') {
      // Sclera: white, pinker towards the back, with red veins crawling towards the iris.
      const sclera = color.createRadialGradient(x + size / 2, y + size / 2, size * 0.05, x + size / 2, y + size / 2, size * 0.7);
      sclera.addColorStop(0, '#fbf6ef');
      sclera.addColorStop(0.55, '#f1ddd2');
      sclera.addColorStop(1, '#d99a95');
      color.fillStyle = sclera;
      color.fillRect(x, y, size, size);
      color.strokeStyle = 'rgba(190, 20, 30, 0.75)';
      for (let k = 0; k < 26; k++) {
        const angle = random() * Math.PI * 2;
        let px = x + size / 2 + Math.cos(angle) * size * 0.48;
        let py = y + size / 2 + Math.sin(angle) * size * 0.48;
        color.lineWidth = 0.8 + random() * 1.4;
        color.beginPath();
        color.moveTo(px, py);
        for (let s = 0; s < 8; s++) {
          const tx = x + size / 2 + Math.cos(angle) * size * 0.1;
          const ty = y + size / 2 + Math.sin(angle) * size * 0.2;
          px += (tx - px) * 0.18 + (random() - 0.5) * 10;
          py += (ty - py) * 0.18 + (random() - 0.5) * 10;
          color.lineTo(px, py);
          if (random() < 0.2) {
            color.moveTo(px, py);
            color.lineTo(px + (random() - 0.5) * 18, py + (random() - 0.5) * 18);
            color.moveTo(px, py);
          }
        }
        color.stroke();
      }
      // Iris and pupil, at the front (u 0.5, v 0.5): stretched twice as tall because a latitude spans half the turn a
      // longitude does.
      const cx = x + size / 2;
      const cy = y + size / 2;
      const rx = size * 0.075;
      const ry = size * 0.15;
      const iris = color.createRadialGradient(cx, cy, 0, cx, cy, rx);
      iris.addColorStop(0, '#d8e83a');
      iris.addColorStop(0.55, '#5aa82a');
      iris.addColorStop(1, '#1d4a14');
      color.save();
      color.translate(cx, cy);
      color.scale(1, ry / rx);
      color.fillStyle = iris;
      color.beginPath();
      color.arc(0, 0, rx, 0, Math.PI * 2);
      color.fill();
      color.strokeStyle = 'rgba(20, 50, 10, 0.6)';
      color.lineWidth = 0.8;
      for (let k = 0; k < 40; k++) {
        const a = (k / 40) * Math.PI * 2;
        color.beginPath();
        color.moveTo(Math.cos(a) * rx * 0.4, Math.sin(a) * rx * 0.4);
        color.lineTo(Math.cos(a) * rx * 0.95, Math.sin(a) * rx * 0.95);
        color.stroke();
      }
      color.strokeStyle = '#0d1a08';
      color.lineWidth = 2;
      color.beginPath();
      color.arc(0, 0, rx, 0, Math.PI * 2);
      color.stroke();
      // A cat's slit pupil.
      color.fillStyle = '#050505';
      color.beginPath();
      color.ellipse(0, 0, rx * 0.22, rx * 0.8, 0, 0, Math.PI * 2);
      color.fill();
      color.fillStyle = 'rgba(255, 255, 255, 0.85)';
      color.beginPath();
      color.arc(-rx * 0.35, -rx * 0.4, rx * 0.16, 0, Math.PI * 2);
      color.fill();
      color.restore();
      // A faint sickly glow in the iris for the dark.
      glow.save();
      glow.translate(cx, cy);
      glow.scale(1, ry / rx);
      const halo = glow.createRadialGradient(0, 0, rx * 0.25, 0, 0, rx);
      halo.addColorStop(0, 'rgba(0,0,0,1)');
      halo.addColorStop(0.3, 'rgba(70, 120, 20, 1)');
      halo.addColorStop(1, 'rgba(0, 0, 0, 1)');
      glow.fillStyle = halo;
      glow.beginPath();
      glow.arc(0, 0, rx, 0, Math.PI * 2);
      glow.fill();
      glow.restore();
    } else if (name === 'ember') {
      for (const g of [color, glow]) {
        const light = g.createRadialGradient(x + size / 2, y + size / 2, 0, x + size / 2, y + size / 2, size * 0.7);
        light.addColorStop(0, '#fff3a8');
        light.addColorStop(0.5, '#ffc23a');
        light.addColorStop(1, '#ff8a10');
        g.fillStyle = light;
        g.fillRect(x, y, size, size);
      }
    } else if (name.startsWith('stone')) {
      const tints: [number, number, number][] = [[46, 38, 52], [38, 34, 44], [54, 40, 46]];
      stone(color, x, y, tints[Number(name.slice(5))]);
      // Mortar-dark edges so neighbouring bricks read apart.
      color.strokeStyle = 'rgba(0, 0, 0, 0.6)';
      color.lineWidth = 6;
      color.strokeRect(x + 3, y + 3, size - 6, size - 6);
    } else if (name === 'jack' || name === 'pumpkin') {
      skin(color, x, y, 10);
      const crown = color.createLinearGradient(0, v(1), 0, v(0.9));
      crown.addColorStop(0, '#5a3a12');
      crown.addColorStop(1, 'rgba(90, 60, 20, 0)');
      color.fillStyle = crown;
      color.fillRect(x, v(1), size, v(0.9) - v(1));
      if (name === 'jack') {
        face(color, x + size / 2, v(0.53), size * 0.16, size * 0.24, '#ffd84a', false);
        face(glow, x + size / 2, v(0.53), size * 0.16, size * 0.24, '#ffa424', true);
      }
    } else {
      const lines = epitaphs[Number(name.slice(5))];
      stone(color, x, y, [104, 98, 112], 1);
      color.save();
      // The front face is graveFace wide and high but fills the square cell: draw squeezed so it stretches back.
      color.translate(x + size / 2, y);
      color.scale(1, graveFace[0] / graveFace[1]);
      const tall = size * graveFace[1] / graveFace[0];
      const carve = (text: string, at: number, px: number, weight: number) => {
        color.font = font(weight, px);
        color.textAlign = 'center';
        color.textBaseline = 'middle';
        let fit = px;
        while (color.measureText(text).width > size * 0.78 && fit > 8) {
          fit -= 1;
          color.font = font(weight, fit);
        }
        // Engraved: a light lower edge and a dark cut.
        color.fillStyle = 'rgba(220, 215, 230, 0.35)';
        color.fillText(text, 0, at * tall + 2);
        color.fillStyle = '#1a141f';
        color.fillText(text, 0, at * tall);
      };
      // The rounded top takes the first quarter: the words start under it.
      carve(lines[0], 0.36, 56, 700);
      carve(lines[1], 0.56, 44, 600);
      carve(lines[2], 0.72, 30, 500);
      color.strokeStyle = '#1a141f';
      color.lineWidth = 3;
      color.beginPath();
      color.moveTo(-size * 0.25, 0.46 * tall);
      color.lineTo(size * 0.25, 0.46 * tall);
      color.stroke();
      color.restore();
    }
    color.restore();
    glow.restore();
  }
  return [color.canvas.toDataURL('image/png'), glow.canvas.toDataURL('image/png')];
}

const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: COLUMNS * CELL, height: rows * CELL }, deviceScaleFactor: 1 });
  await page.setContent('<!doctype html><html><body></body></html>');
  const [atlas, glow] = await page.evaluate(
    `(${paint.toString()})(${JSON.stringify(CELLS)}, ${COLUMNS}, ${CELL}, ${JSON.stringify(EPITAPHS)}, ${JSON.stringify(GRAVE_FACE)}, ${JSON.stringify(PIN_BAND)})`,
  ) as [string, string];
  const { writeFile } = await import('node:fs/promises');
  for (const [file, data] of [['atlas.png', atlas], ['glow.png', glow]] as const) {
    const path = fileURLToPath(new URL(file, output));
    await writeFile(path, Buffer.from(data.split(',')[1], 'base64'));
    console.log(`halloween ${file}: ${path}`);
  }
} finally {
  await browser.close();
}
