import {
  BufferAttribute, BufferGeometry, CanvasTexture, Color, DoubleSide, Mesh, MeshBasicMaterial, SRGBColorSpace,
} from 'three';
import { MESSAGES, t, type MessageKey } from '../core/i18n.ts';
import { FONT, drawArrow, drawKey } from './canvasText.ts';
import type { FloorBlock } from './outsideData.ts';

/** Canvas pixels per metre of ground. */
const PPM = 150;
const ATLAS_WIDTH = 2048;
const PAD = 8;
const OPACITY = 0.6;
const VIOLET = new Color(0xb79bff);
/** The circuit is one flat colour with soft edges: a few pixels per metre are enough for its long block. */
const CIRCUIT_PPM = 16;
/** The sketched arrow to the office chair: thin strokes over a wide block. */
const SKETCH_PPM = 70;
/** The note by the tech tower: two lines of text and a sketched arrow. */
const NOTE_PPM = 100;
/** How strongly a zone's own ground is filled (the plaza, the playground and the circuit share it). */
const ZONE_FILL = 0.1;

/** A block's region of the atlas and its pixels per metre (lower for blocks wider than the atlas). */
type Rect = { x: number; y: number; w: number; h: number; ppm: number };
type Local = { x: number; z: number };

/** Pixels per metre of a block: PPM, or less so a wide area (the plaza, the playground) still fits the atlas whole. */
const ppmOf = (block: FloorBlock) => Math.min(block.id === 'circuit' ? CIRCUIT_PPM : block.id === 'chairhint' ? SKETCH_PPM : block.id === 'technote' ? NOTE_PPM : PPM, (ATLAS_WIDTH - 2) / block.size[0]);

/** Shelf packing of the blocks into one atlas row after row. */
function pack(blocks: readonly FloorBlock[]): { rects: Rect[]; height: number } {
  const rects: Rect[] = [];
  const order = blocks.map((block, index) => ({ index, ppm: ppmOf(block), w: Math.ceil(block.size[0] * ppmOf(block)), h: Math.ceil(block.size[1] * ppmOf(block)) }))
    .sort((a, b) => b.h - a.h);
  let x = 0;
  let y = 0;
  let shelf = 0;
  for (const { index, ppm, w, h } of order) {
    if (x + w > ATLAS_WIDTH) {
      x = 0;
      y += shelf + PAD;
      shelf = 0;
    }
    rects[index] = { x, y, w: Math.min(w, ATLAS_WIDTH), h, ppm };
    x += w + PAD;
    shelf = Math.max(shelf, h);
  }
  return { rects, height: y + shelf };
}

/** Name of a zone the crossroads points at, in the current language: `floor.<id>`, or the id itself without one. */
export function zoneName(id: string): string {
  const key = `floor.${id}` as MessageKey;
  return key in MESSAGES.es ? t(key) : id.toUpperCase();
}

/** One shoe print at (x, z) in a block's metres, its toe along `heading`; `foot` 1 mirrors it into the other foot. */
function drawPrint(context: CanvasRenderingContext2D, x: number, z: number, heading: number, foot: number, alpha: number): void {
  context.save();
  context.globalAlpha = alpha;
  context.translate(x, z);
  context.rotate(heading);
  if (foot > 0) context.scale(1, -1);
  context.beginPath();
  context.ellipse(0.06, 0.008, 0.11, 0.068, 0.12, 0, Math.PI * 2);
  context.fill();
  context.beginPath();
  context.ellipse(-0.13, 0, 0.06, 0.055, 0, 0, Math.PI * 2);
  context.fill();
  context.restore();
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
 * controls panel, the bowling lane, the zones' own ground, the footprints leaving the room and a few more trails of prints.
 * One canvas atlas and one mesh (a single draw call) in the sign zones' title colour; switching the language
 * repaints the canvas.
 */
export class FloorTexts {
  readonly mesh: Mesh<BufferGeometry, MeshBasicMaterial>;
  private readonly blocks: readonly FloorBlock[];
  private readonly rects: Rect[];
  private readonly canvas: HTMLCanvasElement;
  private readonly texture: CanvasTexture;

  /** A touch screen: the intro speaks of the on-screen joystick and draws one where the arrow keys would be. */
  private readonly touch: boolean;

  constructor(blocks: readonly FloorBlock[], groundY: number, touch = false) {
    this.blocks = blocks;
    this.touch = touch;
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
      context.scale(rect.ppm, rect.ppm);
      this.draw(context, block);
      context.restore();
    }
    this.texture.needsUpdate = true;
  }

  private draw(context: CanvasRenderingContext2D, block: FloorBlock): void {
    const [w, d] = block.size;
    /** Writes a text at most `room` wide (shrinking it when a language needs more), returns its width. */
    const text = (key: MessageKey | { words: string }, x: number, y: number, size: number, align: CanvasTextAlign = 'center', weight = 600, room = Infinity) => {
      const words = typeof key === 'string' ? t(key) : key.words;
      context.font = `${weight} ${size}px ${FONT}`;
      const natural = context.measureText(words).width;
      if (natural > room) context.font = `${weight} ${Math.floor(size * room / natural)}px ${FONT}`;
      context.textAlign = align;
      context.fillText(words, x, y);
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
      const touch = this.touch;
      scaled(() => {
        if (touch) {
          // The joystick in the keys' place: its ring and the knob pushed up.
          context.lineWidth = 9;
          context.beginPath();
          context.arc(0, -20, 78, 0, Math.PI * 2);
          context.stroke();
          context.beginPath();
          context.arc(0, -52, 34, 0, Math.PI * 2);
          context.fill();
        }
        const before = text(touch ? 'floor.introTouchBefore' : 'floor.introBefore', -edge * 100, 34, 58, 'right', 600, room);
        const after = text(touch ? 'floor.introTouchAfter' : 'floor.introAfter', edge * 100, 34, 58, 'left', 600, room);
        const middle = (edge * 100 + after - (edge * 100 + before)) / 2;
        text('floor.introNext', middle, 128, 58, 'center', 600, (w - 0.2) * 100);
        if (touch) return;
        // Under it the Shift key with the controls panel's own label, centred on the same line.
        const keyHeight = 46;
        context.font = `700 ${Math.round(keyHeight * 0.46)}px ${FONT}`;
        const keyWidth = Math.max(keyHeight, context.measureText('SHIFT').width + keyHeight * 0.62);
        context.font = `500 40px ${FONT}`;
        const label = Math.min(context.measureText(t('controls.run')).width, room);
        const start = middle - (keyWidth + 18 + label) / 2;
        drawKey(context, 'SHIFT', start, 226 - keyHeight / 2, keyHeight);
        text('controls.run', start + keyWidth + 18, 226, 40, 'left', 500, room);
      });
    } else if (block.id === 'controls') {
      const left = -w / 2 + 0.25;
      let y = -d / 2 + 0.45;
      scaled(() => text('floor.controls', left * 100, y * 100, 52, 'left', 700));
      y += 0.62;
      const rows: [string[], MessageKey][] = [
        [['W', 'A', 'S', 'D'], 'controls.move'], [['SHIFT'], 'controls.run'], [[t('key.space')], 'controls.jump'],
        [['E'], 'controls.sit'], [['L'], 'controls.laptop'], [['F'], 'controls.throw'], [['J', 'K'], 'controls.strike'],
        [['ENTER'], 'controls.open'],
      ];
      for (const [keys, label] of rows) {
        let x = left;
        scaled(() => {
          for (const key of keys) x += (drawKey(context, key, x * 100, (y - 0.2) * 100, 40) + 8) / 100;
        });
        scaled(() => text(label, (left + 1.9) * 100, y * 100, 30, 'left', 500, (w / 2 - left - 2.1) * 100));
        y += 0.5;
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
    } else if (block.id === 'about' || block.id === 'playarea') {
      // A zone's own ground (the plaza around the signs, the playground): a faint floor, a dashed border and its name
      // at the front left.
      context.save();
      context.globalAlpha = ZONE_FILL;
      context.beginPath();
      context.roundRect(-w / 2 + 0.1, -d / 2 + 0.1, w - 0.2, d - 0.2, 0.5);
      context.fill();
      context.restore();
      context.lineWidth = 0.06;
      context.setLineDash([0.32, 0.2]);
      context.beginPath();
      context.roundRect(-w / 2 + 0.1, -d / 2 + 0.1, w - 0.2, d - 0.2, 0.5);
      context.stroke();
      context.setLineDash([]);
      // The plaza's path: a ring round the bust (its centre in `targets`, its radius in `gap`).
      const centre = block.targets[0];
      if (block.id === 'about' && centre && block.gap > 0) {
        const { x, z } = axes(block.yaw);
        const dx = centre.x - block.position.x;
        const dz = centre.z - block.position.z;
        context.save();
        // The same dashed line as the zone borders.
        context.lineWidth = 0.06;
        context.setLineDash([0.32, 0.2]);
        context.beginPath();
        context.arc(dx * x.x + dz * x.z, dx * z.x + dz * z.z, block.gap, 0, Math.PI * 2);
        context.stroke();
        context.restore();
      }
      // The playground's dividers between its games: segments in `targets` (two points each), dashed like the border.
      if (block.id === 'playarea' && block.targets.length >= 2) {
        const { x, z } = axes(block.yaw);
        const local = (point: { x: number; z: number }) => {
          const dx = point.x - block.position.x;
          const dz = point.z - block.position.z;
          return [dx * x.x + dz * x.z, dx * z.x + dz * z.z] as const;
        };
        context.save();
        context.lineWidth = 0.06;
        context.setLineDash([0.32, 0.2]);
        for (let i = 0; i + 1 < block.targets.length; i += 2) {
          context.beginPath();
          context.moveTo(...local(block.targets[i]));
          context.lineTo(...local(block.targets[i + 1]));
          context.stroke();
        }
        context.restore();
      }
      scaled(() => text(block.id === 'about' ? 'floor.about' : 'floor.playground', (-w / 2 + 0.7) * 100, (d / 2 - 0.85) * 100, 64, 'left', 700, (w / 2) * 100));
    } else if (block.id === 'targets') {
      // The lane's sides up to the throw line, the line itself, and the names in front of it.
      const line = block.line;
      context.lineWidth = 0.05;
      context.setLineDash([0.3, 0.18]);
      for (const side of [-1, 1]) {
        context.beginPath();
        context.moveTo(side * (w / 2 - 0.08), -d / 2 + 0.1);
        context.lineTo(side * (w / 2 - 0.08), line);
        context.stroke();
      }
      context.setLineDash([]);
      context.fillRect(-w / 2 + 0.08, line - 0.05, w - 0.16, 0.1);
      scaled(() => text('floor.targetsLine', 0, (line + 0.3) * 100, 26, 'center', 600, (w - 0.3) * 100));
      scaled(() => text('floor.targets', 0, (d / 2 - 0.35) * 100, 46, 'center', 700, (w - 0.3) * 100));
    } else if (block.id === 'tech') {
      // A frame around the tower's footprint and its name in front.
      context.lineWidth = 0.05;
      context.setLineDash([0.25, 0.15]);
      context.strokeRect(-1.45, -d / 2 + 0.05, 2.9, 0.8);
      context.setLineDash([]);
      scaled(() => text('floor.tech', 0, (d / 2 - 0.5) * 100, 52, 'center', 700, (w - 0.3) * 100));
    } else if (block.id === 'boxing') {
      // A dashed ring round the gantry's footprint and the zone's name in front of the bags.
      context.lineWidth = 0.05;
      context.setLineDash([0.25, 0.15]);
      context.strokeRect(-w / 2 + 0.3, -d / 2 + 0.1, w - 0.6, 1.5);
      context.setLineDash([]);
      scaled(() => text('floor.boxing', 0, (d / 2 - 0.55) * 100, 52, 'center', 700, (w - 0.3) * 100));
    } else if (block.id === 'footprints') {
      // Shoe prints walking out of the room's front corner (the block's far-left corner) along a gentle S, left and
      // right in turn, fading as they get further from the room.
      const from = { x: -w / 2 + 0.35, z: -d / 2 + 0.35 };
      const to = { x: w / 2 - 0.3, z: d / 2 - 0.3 };
      const along = { x: to.x - from.x, z: to.z - from.z };
      const length = Math.hypot(along.x, along.z);
      const side = { x: -along.z / length, z: along.x / length };
      const steps = Math.floor(length / 0.42) + 1;
      for (let i = 0; i < steps; i++) {
        const f = i / (steps - 1);
        const sway = Math.sin(f * Math.PI * 2) * 0.16;
        const foot = i % 2 === 0 ? -1 : 1;
        const x = from.x + along.x * f + side.x * (sway + foot * 0.13);
        const z = from.z + along.z * f + side.z * (sway + foot * 0.13);
        // Heading: the path direction turned by the slope of the sway.
        const slope = Math.cos(f * Math.PI * 2) * 0.16 * Math.PI * 2 / length;
        const heading = Math.atan2(along.z, along.x) + Math.atan(slope) + foot * 0.08;
        drawPrint(context, x, z, heading, foot, 1 - 0.6 * f);
      }
    } else if (block.id === 'circuit') {
      // The car circuit: its middle line (`targets`) stroked `gap` wide in the zones' fill, no border or dashes. The
      // corners are rounded through the midpoints so the road bends smoothly.
      const { x: ax, z: az } = axes(block.yaw);
      const local = block.targets.map((p) => {
        const dx = p.x - block.position.x;
        const dz = p.z - block.position.z;
        return { x: dx * ax.x + dz * ax.z, z: dx * az.x + dz * az.z };
      });
      if (local.length > 1) {
        context.save();
        context.globalAlpha = ZONE_FILL;
        context.lineWidth = block.gap;
        context.lineCap = 'round';
        context.lineJoin = 'round';
        context.beginPath();
        context.moveTo(local[0].x, local[0].z);
        for (let k = 1; k < local.length - 1; k++) {
          context.quadraticCurveTo(local[k].x, local[k].z, (local[k].x + local[k + 1].x) / 2, (local[k].z + local[k + 1].z) / 2);
        }
        context.lineTo(local[local.length - 1].x, local[local.length - 1].z);
        context.stroke();
        context.restore();
      }
    } else if (block.id === 'checker') {
      // Start and finish: two rows of squares across the road.
      const cells = 10;
      const cell = w / cells;
      for (let c = 0; c < cells; c++) {
        for (let r = 0; r < 2; r++) if ((c + r) % 2 === 0) context.fillRect(-w / 2 + c * cell, -d / 2 + r * (d / 2), cell, d / 2);
      }
    } else if (block.id === 'chairhint') {
      // A hand-drawn arrow curling over to the office chair (`targets`), a small question under its start, and short
      // strokes round the chair as if it had just popped up there.
      const target = block.targets[0];
      const { x: ax, z: az } = axes(block.yaw);
      const dx = target ? target.x - block.position.x : w / 4;
      const dz = target ? target.z - block.position.z : 0;
      const chair = { x: dx * ax.x + dz * ax.z, z: dx * az.x + dz * az.z };
      // Screen directions from the default corner view: up is towards -X and -Z, right towards +X and -Z.
      const at = (from: { x: number; z: number }, up: number, right: number) => ({
        x: from.x + (-up + right) * Math.SQRT1_2, z: from.z + (-up - right) * Math.SQRT1_2,
      });
      // It starts above the question, rises in an arc and comes down onto the chair from the left, its tip far enough
      // up the ground to meet the seat from the corner view.
      const end = at(chair, 1.2, -0.8);
      const start = at(chair, 1.0, -4.55);
      const c1 = at(start, 3.6, 0.9);
      const c2 = at(end, 2.0, -1.6);
      context.save();
      context.lineCap = 'round';
      context.lineJoin = 'round';
      // Drawn twice, the second stroke a little off the first, like a pen going over it.
      for (const [offset, width, alpha] of [[0, 0.06, 1], [0.035, 0.028, 0.55]] as const) {
        context.globalAlpha = alpha;
        context.lineWidth = width;
        context.beginPath();
        context.moveTo(start.x + offset, start.z);
        context.bezierCurveTo(c1.x + offset, c1.z - offset, c2.x, c2.z + offset, end.x, end.z + offset);
        context.stroke();
      }
      context.globalAlpha = 1;
      context.lineWidth = 0.06;
      const heading = Math.atan2(end.z - c2.z, end.x - c2.x);
      context.beginPath();
      for (const turn of [-0.5, 0.5]) {
        context.moveTo(end.x, end.z);
        context.lineTo(end.x - Math.cos(heading + turn) * 0.38, end.z - Math.sin(heading + turn) * 0.38);
      }
      context.stroke();
      // Short strokes round the chair, leaving a gap where the arrow comes in.
      context.lineWidth = 0.05;
      context.beginPath();
      for (const degrees of [250, 300, 345, 30, 80, 128]) {
        const angle = (degrees * Math.PI) / 180;
        const inner = degrees % 2 ? 0.95 : 1.05;
        context.moveTo(chair.x + Math.cos(angle) * inner, chair.z + Math.sin(angle) * inner);
        context.lineTo(chair.x + Math.cos(angle) * (inner + 0.45), chair.z + Math.sin(angle) * (inner + 0.45));
      }
      context.stroke();
      context.restore();
      // Two large lines under the arrow's start, in the floor's own axes like every painted text, kept inside the
      // block's near edge.
      const label = at(chair, -0.35, -4.6);
      const lines = t('floor.chairHint').split('\n');
      for (const [k, line] of lines.entries()) {
        scaled(() => text({ words: line }, label.x * 100, (label.z + (k - (lines.length - 1) / 2) * 0.66) * 100, 56, 'center', 700, 5.4 * 100));
      }
    } else if (block.id === 'technote') {
      // Two lines at the back of the block, and under them a hand-drawn arrow that drops towards the camera and curls
      // round to the tower (its tip in `targets`), coming in from the right as seen from the default view.
      const target = block.targets[0];
      const { x: ax, z: az } = axes(block.yaw);
      const dx = target ? target.x - block.position.x : -w / 4;
      const dz = target ? target.z - block.position.z : d / 2 - 0.2;
      const end = { x: dx * ax.x + dz * ax.z, z: dx * az.x + dz * az.z };
      const lines = t('floor.techNote').split('\n');
      for (const [k, line] of lines.entries()) {
        scaled(() => text({ words: line }, 0.2 * 100, (-d / 2 + 0.4 + k * 0.44) * 100, 34, 'center', 600, (w - 0.4) * 100));
      }
      const start = { x: 0.3, z: -d / 2 + 0.4 + lines.length * 0.44 };
      const c1 = { x: start.x + 0.85, z: start.z + 0.85 };
      const c2 = { x: end.x + 1.0, z: end.z - 0.65 };
      context.save();
      context.lineCap = 'round';
      context.lineJoin = 'round';
      for (const [offset, width, alpha] of [[0, 0.07, 1], [0.035, 0.03, 0.55]] as const) {
        context.globalAlpha = alpha;
        context.lineWidth = width;
        context.beginPath();
        context.moveTo(start.x + offset, start.z);
        context.bezierCurveTo(c1.x + offset, c1.z - offset, c2.x, c2.z + offset, end.x, end.z + offset);
        context.stroke();
      }
      context.globalAlpha = 1;
      context.lineWidth = 0.07;
      const heading = Math.atan2(end.z - c2.z, end.x - c2.x);
      context.beginPath();
      for (const turn of [-0.5, 0.5]) {
        context.moveTo(end.x, end.z);
        context.lineTo(end.x - Math.cos(heading + turn) * 0.4, end.z - Math.sin(heading + turn) * 0.4);
      }
      context.stroke();
      context.restore();
    } else if (block.id === 'prints') {
      // A few prints where they were marked on the map, the same shoe as the ones leaving the room, fading as they go.
      const { x: ax, z: az } = axes(block.yaw);
      for (const [k, step] of block.steps.entries()) {
        const dx = step.x - block.position.x;
        const dz = step.z - block.position.z;
        const f = block.steps.length > 1 ? k / (block.steps.length - 1) : 0;
        drawPrint(context, dx * ax.x + dz * ax.z, dx * az.x + dz * az.z, step.heading - block.yaw, k % 2 === 0 ? -1 : 1, 0.9 - 0.45 * f);
      }
    }
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.texture.dispose();
    this.mesh.material.dispose();
    this.mesh.removeFromParent();
  }
}
