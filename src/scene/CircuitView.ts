import {
  BufferAttribute, BufferGeometry, CanvasTexture, DoubleSide, Group, Mesh, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace, type Object3D,
} from 'three';
import { TapeRope, type Point3 } from '../world/tapeRope.ts';
import { t } from '../core/i18n.ts';
import { FONT } from './canvasText.ts';
import type { OfficeChair, OutsideData, Scoreboard, Tape } from './outsideData.ts';

const BOARD_PPM = 160;

/** Lap time as m:ss.t. */
export function lapText(seconds: number | undefined): string {
  if (seconds === undefined) return '–:––.–';
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${minutes}:${rest < 10 ? '0' : ''}${rest.toFixed(1)}`;
}

/** Height of the tape's middle on its posts, how tall the band is (it stays a thin ribbon) and one stripe's length (m). */
export const TAPE = { height: 0.85, band: 0.12, stripe: 0.18 } as const;
/** Lens colours when lit (red, amber, green). */
const LIT = [0xff3b30, 0xffc21a, 0x2ee86b] as const;

/** The office chair's moving parts: base and casters on the ground, the upper part on the gas lift. */
export type ChairRig = {
  root: Object3D;
  base: Object3D;
  upper: Object3D;
  /** Where the hips go, a child of the upper part. */
  seat: Object3D;
  casters: Object3D[];
  wheels: Object3D[];
  /** Tops of the arm pads, by the rider's side: the hands rest there. */
  armrests: Partial<Record<Side, Object3D>>;
  /** The nitro's soda bottles: the liquid (scaled along its local Y as it empties), the cap that pops off, the mouth. */
  bottles: ChairBottle[];
};

export type Side = 'right' | 'left';
export type ChairBottle = { side: Side; liquid?: Object3D; cap?: Object3D; nozzle: Object3D };

type TapeState = Tape & { rope: TapeRope; geometry: BufferGeometry; cut: number | undefined };

/**
 * The circuit's moving bits outside the merged static scene: the office chair, the safety tapes (cut and drooping)
 * and the traffic light's three lenses.
 */
export class CircuitView {
  readonly root = new Group();
  readonly chair: ChairRig | undefined;
  readonly tapes: TapeState[];
  private readonly lenses: Mesh[] = [];
  private clock = 0;
  private readonly canvas = document.createElement('canvas');
  private readonly texture: CanvasTexture;
  private lap: { time: number | undefined; best: number | undefined; running: boolean } = { time: undefined, best: undefined, running: false };
  private readonly tapeMaterial: MeshStandardMaterial;
  private reducedMotion = false;

  constructor(data: Pick<OutsideData, 'chair' | 'tapes' | 'trafficLight' | 'lapBoard'>) {
    this.root.name = 'CircuitView';
    const board = data.lapBoard;
    this.canvas.width = board ? Math.ceil(board.width * BOARD_PPM) : 1;
    this.canvas.height = board ? Math.ceil(board.height * BOARD_PPM) : 1;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.anisotropy = 4;
    if (board) this.root.add(boardMesh(board, this.texture));
    this.paint();
    this.chair = data.chair ? this.takeChair(data.chair) : undefined;
    this.tapeMaterial = new MeshStandardMaterial({ map: stripes(), roughness: 0.55, side: DoubleSide });
    this.tapes = data.tapes.map((tape) => {
      this.root.attach(tape.object);
      // Between the tops of its posts, across the road.
      const ax = { x: Math.cos(tape.yaw), z: -Math.sin(tape.yaw) };
      const half = tape.length / 2;
      const { x, y, z } = tape.position;
      const rope = new TapeRope({ x: x - ax.x * half, y: y + TAPE.height, z: z - ax.z * half }, { x: x + ax.x * half, y: y + TAPE.height, z: z + ax.z * half }, y);
      const geometry = new BufferGeometry();
      const mesh = new Mesh(geometry, this.tapeMaterial);
      mesh.name = `${tape.name}_Ribbon`;
      mesh.frustumCulled = false;
      this.root.add(mesh);
      const state = { ...tape, rope, geometry, cut: undefined };
      drawRibbon(state);
      return state;
    });
    for (let k = 0; k < 3; k++) {
      const lens = data.trafficLight?.getObjectByName(`TrafficLight_Lens_${k}`);
      if (!(lens instanceof Mesh)) continue;
      this.root.attach(lens);
      lens.material = (lens.material as MeshStandardMaterial).clone();
      this.lenses.push(lens);
    }
  }

  private takeChair(chair: OfficeChair): ChairRig | undefined {
    const { object } = chair;
    const base = object.getObjectByName('ChairBase');
    const upper = object.getObjectByName('ChairUpper');
    const seat = object.getObjectByName('OfficeChair_Seat');
    if (!base || !upper || !seat) return undefined;
    this.root.attach(object);
    const casters: Object3D[] = [];
    const wheels: Object3D[] = [];
    for (let k = 0; k < 5; k++) {
      const caster = object.getObjectByName(`ChairCaster_${k}`);
      const wheel = object.getObjectByName(`ChairWheel_${k}`);
      if (caster && wheel) {
        casters.push(caster);
        wheels.push(wheel);
      }
    }
    const armrests: Partial<Record<Side, Object3D>> = {};
    const bottles: ChairBottle[] = [];
    for (const side of ['right', 'left'] as const) {
      const armrest = object.getObjectByName(`ChairArmrest_${side}`);
      if (armrest) armrests[side] = armrest;
      const nozzle = object.getObjectByName(`ChairNozzle_${side}`);
      if (nozzle) bottles.push({ side, nozzle, liquid: object.getObjectByName(`ChairBottleLiquid_${side}`), cap: object.getObjectByName(`ChairBottleCap_${side}`) });
    }
    return { root: object, base, upper, seat, casters, wheels, armrests, bottles };
  }

  /** The lap board: the running (or last) lap time and the best one. */
  setLap(time: number | undefined, best: number | undefined, running: boolean): void {
    const shown = time === undefined ? undefined : Math.floor(time * 10) / 10;
    if (shown === this.lap.time && best === this.lap.best && running === this.lap.running) return;
    this.lap = { time: shown, best, running };
    this.paint();
  }

  /** Repaint the lap board (also on a language change). */
  paint(): void {
    const context = this.canvas.getContext('2d');
    if (!context || this.canvas.width < 2) return;
    const { width, height } = this.canvas;
    context.fillStyle = '#0d0a18';
    context.fillRect(0, 0, width, height);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = '#b79bff';
    context.font = `600 ${Math.round(height * 0.13)}px ${FONT}`;
    context.fillText(t('circuit.lap'), width / 2, height * 0.15);
    context.fillStyle = this.lap.running ? '#ffe27a' : '#ffffff';
    context.font = `700 ${Math.round(height * 0.34)}px ${FONT}`;
    context.fillText(lapText(this.lap.time), width / 2, height * 0.48);
    context.fillStyle = '#9be6c0';
    context.font = `600 ${Math.round(height * 0.13)}px ${FONT}`;
    context.fillText(`${t('circuit.best')} ${lapText(this.lap.best)}`, width / 2, height * 0.83);
    this.texture.needsUpdate = true;
  }

  /** Which lens is lit: 0 red, 1 amber, 2 green, -1 none. */
  setLights(lit: number): void {
    for (const [k, lens] of this.lenses.entries()) {
      const material = lens.material as MeshStandardMaterial;
      const on = k === lit;
      material.emissive.setHex(on ? LIT[k] : 0x000000);
      material.emissiveIntensity = on ? 2.2 : 0;
    }
  }

  /**
   * Cut tape `index` at `at` (0 at its first post … 1 at the second) by something moving at `push` (m/s on the ground):
   * its halves whip back, hang from their posts and fall to the ground; a cut tape stays cut until reset.
   */
  cut(index: number, at = 0.5, push = { x: 0, z: 0 }): void {
    const tape = this.tapes[index];
    if (!tape || tape.cut !== undefined) return;
    tape.cut = this.clock;
    tape.rope.cutAt(at, push, index * 7919 + Math.round(this.clock * 1000));
    if (this.reducedMotion) tape.rope.settle();
    drawRibbon(tape);
  }

  get cutCount(): number {
    return this.tapes.filter((tape) => tape.cut !== undefined).length;
  }

  /** Tapes whole again. */
  reset(): void {
    for (const tape of this.tapes) {
      tape.cut = undefined;
      tape.rope.reset();
      drawRibbon(tape);
    }
  }

  update(delta: number, reducedMotion: boolean): void {
    this.clock += delta;
    this.reducedMotion = reducedMotion;
    for (const tape of this.tapes) {
      if (!tape.rope.active) continue;
      tape.rope.update(delta);
      drawRibbon(tape);
    }
  }
}

/** A quad just in front of the lap board's face (local +Z), showing the canvas. */
function boardMesh(board: Scoreboard, texture: CanvasTexture): Mesh {
  const { position, yaw, width, height, bottom } = board;
  const ax = { x: Math.cos(yaw), z: -Math.sin(yaw) };
  const az = { x: Math.sin(yaw), z: Math.cos(yaw) };
  const cx = position.x + az.x * 0.046;
  const cz = position.z + az.z * 0.046;
  const y = position.y + bottom + height / 2;
  const vertices: number[] = [];
  for (const [lx, ly] of [[-width / 2, height / 2], [width / 2, height / 2], [-width / 2, -height / 2], [width / 2, -height / 2]]) vertices.push(cx + ax.x * lx, y + ly, cz + ax.z * lx);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(vertices), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array([0, 1, 1, 1, 0, 0, 1, 0]), 2));
  geometry.setIndex([0, 2, 1, 1, 2, 3]);
  geometry.computeVertexNormals();
  const mesh = new Mesh(geometry, new MeshStandardMaterial({ map: texture, emissiveMap: texture, emissive: 0xffffff, emissiveIntensity: 0.4, roughness: 0.6 }));
  mesh.name = 'LapBoardFace';
  return mesh;
}

/**
 * The tape's black and yellow stripes, slanting up to the right (/) like real safety tape, repeating along it. The canvas
 * is one period of stripes along the tape by the band's height, at the same pixels per metre both ways, so the
 * stripes run at 45 degrees; each pixel's colour depends on x + y, so the pattern wraps seamlessly along the tape.
 */
function stripes(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = Math.round((96 * TAPE.band) / (TAPE.stripe * 2));
  const context = canvas.getContext('2d');
  if (context) {
    const image = context.createImageData(canvas.width, canvas.height);
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        // Canvas y grows downwards: a constant x + y rises to the right.
        const yellow = (x + y) % canvas.width < canvas.width / 2;
        const i = (y * canvas.width + x) * 4;
        image.data.set(yellow ? [0xe4, 0xbf, 0x2c, 255] : [0x14, 0x12, 0x16, 255], i);
      }
    }
    context.putImageData(image, 0, 0);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  return texture;
}

const UP = { x: 0, y: 1, z: 0 };
const normalize = (v: Point3): Point3 => {
  const length = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / length, y: v.y / length, z: v.z / length };
};
const crossOf = (a: Point3, b: Point3): Point3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });

/**
 * The ribbon along the rope's chains: each node gets the band's two edges, across the rope. In the air the band
 * stands upright (like a stretched tape); near the ground it turns flat, lying on the road.
 */
function drawRibbon(tape: { rope: TapeRope; geometry: BufferGeometry }): void {
  const chains = tape.rope.chains;
  const count = chains.reduce((sum, chain) => sum + chain.length, 0);
  let position = tape.geometry.getAttribute('position') as BufferAttribute | undefined;
  let uv = tape.geometry.getAttribute('uv') as BufferAttribute | undefined;
  const fresh = !position || position.count !== count * 2 || tape.geometry.userData.chains !== chains.length;
  if (fresh) {
    position = new BufferAttribute(new Float32Array(count * 6), 3);
    uv = new BufferAttribute(new Float32Array(count * 4), 2);
    tape.geometry.setAttribute('position', position);
    tape.geometry.setAttribute('uv', uv);
    const index: number[] = [];
    let base = 0;
    for (const chain of chains) {
      for (let i = 0; i < chain.length - 1; i++) {
        const v = (base + i) * 2;
        index.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
      }
      base += chain.length;
    }
    tape.geometry.setIndex(index);
    tape.geometry.userData.chains = chains.length;
  }
  const ground = tape.rope.chains[0][0].y - TAPE.height;
  let v = 0;
  for (const chain of chains) {
    // Read along the way that goes to the right on screen (the default corner view looks along -X-Z, so screen right
    // is +X-Z): whichever way a tape or a cut half runs, its stripes then slant up to the right, never mirrored.
    const first = chain[0];
    const last = chain[chain.length - 1];
    const way = (last.x - first.x) - (last.z - first.z) < 0 ? -1 : 1;
    let along = 0;
    let previous: Point3 | undefined;
    for (let i = 0; i < chain.length; i++) {
      const p = chain[i];
      if (i > 0) along += Math.hypot(p.x - chain[i - 1].x, p.y - chain[i - 1].y, p.z - chain[i - 1].z);
      const a = chain[Math.max(0, i - 1)];
      const b = chain[Math.min(chain.length - 1, i + 1)];
      const tangent = normalize({ x: (b.x - a.x) * way, y: (b.y - a.y) * way, z: (b.z - a.z) * way });
      // Upright: up without its part along the rope. Flat: across the rope on the ground.
      const dot = tangent.y;
      const upright = { x: -tangent.x * dot, y: 1 - tangent.y * dot, z: -tangent.z * dot };
      const flat = normalize(crossOf(tangent, UP));
      const lift = Math.min(1, Math.max(0, (p.y - ground - 0.02) / 0.25));
      const uprightLength = Math.hypot(upright.x, upright.y, upright.z);
      const k = uprightLength > 0.2 ? lift : 0;
      let across = normalize({
        x: flat.x * (1 - k) + (upright.x / (uprightLength || 1)) * k,
        y: flat.y * (1 - k) + (upright.y / (uprightLength || 1)) * k,
        z: flat.z * (1 - k) + (upright.z / (uprightLength || 1)) * k,
      });
      // Keep the band from flipping over between neighbours.
      if (previous && across.x * previous.x + across.y * previous.y + across.z * previous.z < 0) across = { x: -across.x, y: -across.y, z: -across.z };
      previous = across;
      const half = TAPE.band / 2;
      // Lying flat, the band's lower edge would go below the road: raise it by what its slope takes.
      const rise = Math.max(0, ground + 0.006 - (p.y - Math.abs(across.y) * half));
      position!.setXYZ(v, p.x + across.x * half, p.y + across.y * half + rise, p.z + across.z * half);
      position!.setXYZ(v + 1, p.x - across.x * half, p.y - across.y * half + rise, p.z - across.z * half);
      uv!.setXY(v, (way * along) / (TAPE.stripe * 2), 1);
      uv!.setXY(v + 1, (way * along) / (TAPE.stripe * 2), 0);
      v += 2;
    }
  }
  position!.needsUpdate = true;
  uv!.needsUpdate = true;
  tape.geometry.computeVertexNormals();
}
