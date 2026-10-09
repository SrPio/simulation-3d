import {
  BufferAttribute, BufferGeometry, CanvasTexture, Group, Mesh, MeshStandardMaterial, SRGBColorSpace, type Object3D,
} from 'three';
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

/** How long a cut tape takes to drop and swing still (s). */
const TAPE_DROP = 1.6;
/** Height of the tape on its posts (m). */
const TAPE_HEIGHT = 0.85;
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
};

type TapeState = Tape & { halves: Object3D[]; cut: number | undefined };

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
    this.tapes = data.tapes.map((tape) => {
      this.root.attach(tape.object);
      const halves = ['L', 'R'].map((side) => tape.object.getObjectByName(`${tape.name}_${side}`)).filter((half): half is Object3D => !!half);
      return { ...tape, halves, cut: undefined };
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
    return { root: object, base, upper, seat, casters, wheels };
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

  /** Cut tape `index` (its halves drop and swing from their posts); a cut tape stays cut until reset. */
  cut(index: number): void {
    const tape = this.tapes[index];
    if (tape && tape.cut === undefined) tape.cut = this.clock;
  }

  get cutCount(): number {
    return this.tapes.filter((tape) => tape.cut !== undefined).length;
  }

  /** Tapes whole again. */
  reset(): void {
    for (const tape of this.tapes) {
      tape.cut = undefined;
      for (const [k, half] of tape.halves.entries()) half.rotation.set(0, k === 0 ? 0 : Math.PI, 0, 'YZX');
    }
  }

  update(delta: number, reducedMotion: boolean): void {
    this.clock += delta;
    for (const tape of this.tapes) {
      if (tape.cut === undefined) continue;
      const t = Math.min((this.clock - tape.cut) / TAPE_DROP, 1);
      // A damped swing down to hanging: about 80 degrees below the horizontal, overshooting a little first.
      const hang = reducedMotion ? 1 : 1 - Math.exp(-5 * t) * Math.cos(9 * t);
      // Each half pivots at its post: it drops until its end touches the ground and swings round along the road
      // (about the vertical first, then down: Euler order YZX), like a cut tape blown back by what went through.
      const drop = Math.asin(Math.min(1, TAPE_HEIGHT / (tape.length / 2)));
      for (const [k, half] of tape.halves.entries()) {
        half.rotation.order = 'YZX';
        half.rotation.y = k === 0 ? -hang * 1.25 : Math.PI + hang * 1.25;
        half.rotation.z = -hang * drop;
      }
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
