import {
  BufferAttribute, BufferGeometry, CanvasTexture, Color, DoubleSide, Mesh, MeshBasicMaterial, SRGBColorSpace,
} from 'three';
import { t, type MessageKey } from '../core/i18n.ts';
import { FONT, drawArrow, drawKey } from './canvasText.ts';
import type { FloorBlock } from './outsideData.ts';

/** Canvas pixels per metre of ground. */
const PPM = 150;
const ATLAS_WIDTH = 2048;
const PAD = 8;
const OPACITY = 0.6;
const VIOLET = new Color(0xb79bff);

type Rect = { x: number; y: number; w: number; h: number };
type Local = { x: number; z: number };

/** Shelf packing of the blocks into one atlas row after row. */
function pack(blocks: readonly FloorBlock[]): { rects: Rect[]; height: number } {
  const rects: Rect[] = [];
  const order = blocks.map((block, index) => ({ index, w: Math.ceil(block.size[0] * PPM), h: Math.ceil(block.size[1] * PPM) }))
    .sort((a, b) => b.h - a.h);
  let x = 0;
  let y = 0;
  let shelf = 0;
  for (const { index, w, h } of order) {
    if (x + w > ATLAS_WIDTH) {
      x = 0;
      y += shelf + PAD;
      shelf = 0;
    }
    rects[index] = { x, y, w: Math.min(w, ATLAS_WIDTH), h };
    x += w + PAD;
    shelf = Math.max(shelf, h);
  }
  return { rects, height: y + shelf };
}

/** A block's own axes on the ground: local +X along the text, +Z towards the camera. */
const axes = (yaw: number) => ({ x: { x: Math.cos(yaw), z: -Math.sin(yaw) }, z: { x: Math.sin(yaw), z: Math.cos(yaw) } });

/** Direction from a block's centre to a ground point, in the block's own axes (unit length). */
function towards(block: FloorBlock, target: Local): Local {
  const { x, z } = axes(block.yaw);
  const dx = target.x - block.position.x;
  const dz = target.z - block.position.z;
  const local = { x: dx * x.x + dz * x.z, z: dx * z.x + dz * z.z };
  const length = Math.hypot(local.x, local.z) || 1;
  return { x: local.x / length, z: local.z / length };
}

/**
 * Words and drawings painted flat on the outside ground: the intro sentence around the 3D arrow keys, the
 * crossroads arrows, the controls panel, the playground sign and the bowling lane. One canvas atlas and one
 * mesh (a single draw call) in the sign zones' title colour; switching the language repaints the canvas.
 */
export class FloorTexts {
  readonly mesh: Mesh<BufferGeometry, MeshBasicMaterial>;
  private readonly blocks: readonly FloorBlock[];
  private readonly rects: Rect[];
  private readonly canvas: HTMLCanvasElement;
  private readonly texture: CanvasTexture;

  constructor(blocks: readonly FloorBlock[], groundY: number) {
    this.blocks = blocks;
    const { rects, height } = pack(blocks);
    this.rects = rects;
    this.canvas = document.createElement('canvas');
    this.canvas.width = ATLAS_WIDTH;
    this.canvas.height = Math.max(1, height);
    const position: number[] = [];
    const uv: number[] = [];
    const index: number[] = [];
    const y = groundY + 0.006;
    for (const [i, block] of blocks.entries()) {
      const { x, z } = axes(block.yaw);
      const [w, d] = block.size;
      const rect = rects[i];
      for (const [lx, lz] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]]) {
        position.push(block.position.x + x.x * lx + z.x * lz, y, block.position.z + x.z * lx + z.z * lz);
      }
      const u0 = rect.x / ATLAS_WIDTH;
      const u1 = (rect.x + rect.w) / ATLAS_WIDTH;
      const v0 = 1 - rect.y / this.canvas.height;
      const v1 = 1 - (rect.y + rect.h) / this.canvas.height;
      // The far edge of the block (local -Z) is the top of its canvas region, so the text reads upright.
      uv.push(u0, v0, u1, v0, u0, v1, u1, v1);
      const base = i * 4;
      index.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
    geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
    geometry.setIndex(index);
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.anisotropy = 8;
    this.mesh = new Mesh(geometry, new MeshBasicMaterial({ map: this.texture, color: VIOLET, transparent: true, opacity: OPACITY, depthWrite: false, side: DoubleSide }));
    this.mesh.name = 'FloorTexts';
    this.mesh.renderOrder = -4;
    this.mesh.matrixAutoUpdate = false;
    this.paint();
  }

  /** Repaint every block in the current language. */
  paint(): void {
    const context = this.canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    context.fillStyle = '#ffffff';
    context.strokeStyle = '#ffffff';
    for (const [i, block] of this.blocks.entries()) {
      const rect = this.rects[i];
      context.save();
      context.beginPath();
      context.rect(rect.x, rect.y, rect.w, rect.h);
      context.clip();
      // Draw in metres about the block centre: +x along the text, +y towards the camera.
      context.translate(rect.x + rect.w / 2, rect.y + rect.h / 2);
      context.scale(PPM, PPM);
      this.draw(context, block);
      context.restore();
    }
    this.texture.needsUpdate = true;
  }

  private draw(context: CanvasRenderingContext2D, block: FloorBlock): void {
    const [w, d] = block.size;
    /** Writes a text at most `room` wide (shrinking it when a language needs more), returns its width. */
    const text = (key: MessageKey, x: number, y: number, size: number, align: CanvasTextAlign = 'center', weight = 600, room = Infinity) => {
      context.font = `${weight} ${size}px ${FONT}`;
      const natural = context.measureText(t(key)).width;
      if (natural > room) context.font = `${weight} ${Math.floor(size * room / natural)}px ${FONT}`;
      context.textAlign = align;
      context.fillText(t(key), x, y);
      return Math.min(natural, room);
    };
    context.textBaseline = 'middle';
    // Canvas fonts need whole pixel sizes: draw text at 100× and scale down.
    const scaled = (draw: () => void) => {
      context.save();
      context.scale(0.01, 0.01);
      draw();
      context.restore();
    };
    if (block.id === 'intro') {
      // "USE YOUR [keys] KEYS" on the row of the left/down/right keys, then the rest on a second line under the keys,
      // centred on the first line (text and keys together); each part keeps to its side of the keys and a longer
      // translation gets a smaller size.
      const edge = block.gap / 2 + 0.12;
      const room = (w / 2 - edge - 0.1) * 100;
      scaled(() => {
        const before = text('floor.introBefore', -edge * 100, 34, 58, 'right', 600, room);
        const after = text('floor.introAfter', edge * 100, 34, 58, 'left', 600, room);
        const middle = (edge * 100 + after - (edge * 100 + before)) / 2;
        text('floor.introNext', middle, 128, 58, 'center', 600, (w - 0.2) * 100);
      });
    } else if (block.id === 'crossroads') {
      context.lineWidth = 0.07;
      context.beginPath();
      context.arc(0, 0, 0.42, 0, Math.PI * 2);
      context.stroke();
      const labels: MessageKey[] = ['floor.links', 'floor.controls', 'floor.playground'];
      for (const [index, target] of block.targets.entries()) {
        const dir = towards(block, target);
        drawArrow(context, dir.x * 0.6, dir.z * 0.6, Math.atan2(dir.z, dir.x), 1.25, 0.14);
        const tip = { x: dir.x * 2.0, z: dir.z * 2.0 };
        scaled(() => {
          context.textBaseline = dir.z > 0.45 ? 'top' : dir.z < -0.45 ? 'bottom' : 'middle';
          text(labels[index], tip.x * 100, tip.z * 100, 40, dir.x > 0.45 ? 'left' : dir.x < -0.45 ? 'right' : 'center');
        });
      }
    } else if (block.id === 'controls') {
      const left = -w / 2 + 0.25;
      let y = -d / 2 + 0.45;
      scaled(() => text('floor.controls', left * 100, y * 100, 52, 'left', 700));
      y += 0.62;
      const rows: [string[], MessageKey][] = [
        [['W', 'A', 'S', 'D'], 'controls.move'], [['SHIFT'], 'controls.run'], [[t('key.space')], 'controls.jump'],
        [['E'], 'controls.sit'], [['L'], 'controls.laptop'], [['F'], 'controls.throw'], [['ENTER'], 'controls.open'],
      ];
      for (const [keys, label] of rows) {
        let x = left;
        scaled(() => {
          for (const key of keys) x += (drawKey(context, key, x * 100, (y - 0.2) * 100, 40) + 8) / 100;
        });
        scaled(() => text(label, (left + 1.9) * 100, y * 100, 30, 'left', 500));
        y += 0.56;
      }
    } else if (block.id === 'playground') {
      // The zone's name, and under it an arrow towards the playground.
      scaled(() => text('floor.playground', 0, (-d / 2 + 0.4) * 100, 66, 'center', 700, (w - 0.3) * 100));
      const dir = block.targets[0] ? towards(block, block.targets[0]) : { x: 0, z: 1 };
      const length = 0.85;
      const middle = { x: 0, z: d / 2 - 0.55 };
      drawArrow(context, middle.x - dir.x * length / 2, middle.z - dir.z * length / 2, Math.atan2(dir.z, dir.x), length, 0.16);
    } else if (block.id === 'bowling') {
      // Lane edges and the aiming arrows, the label under the ball.
      context.lineWidth = 0.05;
      context.setLineDash([0.3, 0.18]);
      for (const side of [-1, 1]) {
        context.beginPath();
        context.moveTo(side * (w / 2 - 0.08), -d / 2 + 0.1);
        context.lineTo(side * (w / 2 - 0.08), d / 2 - 0.75);
        context.stroke();
      }
      context.setLineDash([]);
      for (const x of [-0.45, 0, 0.45]) {
        context.beginPath();
        context.moveTo(x, -0.35 - Math.abs(x) * 0.6);
        context.lineTo(x - 0.1, -0.1 - Math.abs(x) * 0.6);
        context.lineTo(x + 0.1, -0.1 - Math.abs(x) * 0.6);
        context.closePath();
        context.fill();
      }
      scaled(() => text('floor.bowling', 0, (d / 2 - 0.38) * 100, 40, 'center', 700));
    }
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.texture.dispose();
    this.mesh.material.dispose();
    this.mesh.removeFromParent();
  }
}
