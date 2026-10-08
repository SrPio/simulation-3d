import {
  BufferAttribute, BufferGeometry, CanvasTexture, Color, DoubleSide, ExtrudeGeometry, Group, Matrix4, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, SRGBColorSpace, Shape, Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Point2 } from '../world/collisions.ts';
import { FONT } from './canvasText.ts';
import { zoneName } from './FloorTexts.ts';
import type { Lamppost } from './outsideData.ts';

/** Arrow board: length from the pole, half height, the pointed head, thickness and the glowing rim. */
const LENGTH = 1.8;
const HALF = 0.19;
const HEAD = 0.3;
const THICKNESS = 0.05;
const RIM = 0.028;
/** Smallest angle between a board and the default view's line of sight, so its words never turn edge-on. */
export const MIN_VIEW_ANGLE = Math.PI / 4;
const ATLAS_WIDTH = 1024;
const BOARD = new Color(0x1b1724);
const GLOW = new Color(0x9a6bff);

const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

/**
 * Yaw (rotation about +Y; local +X is the arrow's point) of a board on a pole at `from` pointing at `to`. `view` is the
 * horizontal direction from the scene towards the camera: a board pointing nearly along it would be seen edge-on, so
 * it turns until it is at least `min` off that line, staying on the target's side.
 */
export function arrowYaw(from: Point2, to: Point2, view: Point2, min = MIN_VIEW_ANGLE): number {
  const yaw = Math.atan2(-(to.z - from.z), to.x - from.x);
  const viewYaw = Math.atan2(-view.z, view.x);
  const relative = wrap(yaw - viewYaw);
  const side = relative < 0 ? -1 : 1;
  const clamped = side * Math.min(Math.max(Math.abs(relative), min), Math.PI - min);
  return wrap(viewYaw + clamped);
}

/** Pentagon arrow in the board's XY plane from x0 along +X, shrunk by `inset` all round. */
function arrowShape(x0: number, inset: number): Shape {
  const tip = x0 + LENGTH - inset * 1.6;
  const neck = x0 + LENGTH - HEAD;
  const half = HALF - inset;
  const shape = new Shape();
  shape.moveTo(x0 + inset, -half);
  shape.lineTo(neck, -half);
  shape.lineTo(tip, 0);
  shape.lineTo(neck, half);
  shape.lineTo(x0 + inset, half);
  shape.closePath();
  return shape;
}

function slab(shape: Shape, depth: number): BufferGeometry {
  const geometry = new ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  geometry.translate(0, 0, -depth / 2);
  geometry.clearGroups();
  return geometry;
}

/**
 * Arrow boards on the crossroads lamppost, one per zone the crossroads points at (`Lamppost.arrows`, from the GLB),
 * stacked down the pole. Each points at its zone (turned just enough to stay readable from the default isometric
 * view) and carries the zone's name on both faces, the right way round from either side. Boards, rims and words
 * are three meshes in all; switching the language repaints the words.
 */
export class Signpost {
  readonly root = new Group();
  /** Each arrow's zone and yaw, top to bottom. */
  readonly arrows: { id: string; yaw: number }[];
  private readonly canvas = document.createElement('canvas');
  private readonly texture: CanvasTexture;
  private readonly rowHeight: number;

  constructor(lamppost: Lamppost, view: Point2) {
    this.root.name = 'Signpost';
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.anisotropy = 8;
    const from = { x: lamppost.position.x, z: lamppost.position.z };
    this.arrows = lamppost.arrows.map((arrow) => ({ id: arrow.id, yaw: arrowYaw(from, arrow.target, view) }));
    const x0 = lamppost.poleRadius * 0.5;
    // The words cover the shaft and the start of the head, inside the rim.
    const textFrom = x0 + 0.1;
    const textTo = x0 + LENGTH - HEAD * 0.45;
    const textHalf = HALF - RIM - 0.02;
    this.rowHeight = Math.round(ATLAS_WIDTH * 2 * textHalf / (textTo - textFrom));
    this.canvas.width = ATLAS_WIDTH;
    this.canvas.height = Math.max(1, this.rowHeight * this.arrows.length);

    const rims: BufferGeometry[] = [];
    const boards: BufferGeometry[] = [];
    const position: number[] = [];
    const uv: number[] = [];
    const index: number[] = [];
    const matrix = new Matrix4();
    const point = new Vector3();
    for (const [i, arrow] of this.arrows.entries()) {
      matrix.makeRotationY(arrow.yaw).setPosition(lamppost.position.x, lamppost.position.y + lamppost.arrowsTop - i * lamppost.arrowStep, lamppost.position.z);
      rims.push(slab(arrowShape(x0, 0), THICKNESS).applyMatrix4(matrix));
      boards.push(slab(arrowShape(x0, RIM), THICKNESS + 0.01).applyMatrix4(matrix));
      // Row i of the atlas on both faces; the back face runs u the other way so it does not read mirrored.
      const v0 = 1 - i / this.arrows.length;
      const v1 = 1 - (i + 1) / this.arrows.length;
      for (const side of [1, -1]) {
        const z = side * (THICKNESS / 2 + 0.008);
        const [uFrom, uTo] = side > 0 ? [0, 1] : [1, 0];
        const base = position.length / 3;
        for (const [x, y, u, v] of [[textFrom, textHalf, uFrom, v0], [textTo, textHalf, uTo, v0], [textFrom, -textHalf, uFrom, v1], [textTo, -textHalf, uTo, v1]]) {
          point.set(x, y, z).applyMatrix4(matrix);
          position.push(point.x, point.y, point.z);
          uv.push(u, v);
        }
        index.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
      }
    }
    if (!this.arrows.length) return;
    const rim = new Mesh(mergeGeometries(rims), new MeshBasicMaterial({ color: GLOW }));
    const board = new Mesh(mergeGeometries(boards), new MeshStandardMaterial({ color: BOARD, roughness: 0.5, metalness: 0.3 }));
    for (const geometry of [...rims, ...boards]) geometry.dispose();
    const words = new BufferGeometry();
    words.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
    words.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
    words.setIndex(index);
    const text = new Mesh(words, new MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false, side: DoubleSide }));
    rim.name = 'SignpostRims';
    board.name = 'SignpostBoards';
    text.name = 'SignpostWords';
    for (const mesh of [rim, board, text]) {
      mesh.matrixAutoUpdate = false;
      this.root.add(mesh);
    }
    this.paint();
  }

  /** Write each zone's name in the current language, shrinking a long one to fit its board. */
  paint(): void {
    const context = this.canvas.getContext('2d');
    if (!context || !this.arrows.length) return;
    context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    context.fillStyle = '#f4efff';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const room = ATLAS_WIDTH * 0.92;
    const size = Math.round(this.rowHeight * 0.64);
    for (const [i, arrow] of this.arrows.entries()) {
      const words = zoneName(arrow.id);
      context.font = `700 ${size}px ${FONT}`;
      const natural = context.measureText(words).width;
      if (natural > room) context.font = `700 ${Math.floor(size * room / natural)}px ${FONT}`;
      context.fillText(words, ATLAS_WIDTH / 2, (i + 0.54) * this.rowHeight);
    }
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.root.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      object.geometry.dispose();
      (object.material as MeshBasicMaterial).dispose();
    });
    this.texture.dispose();
    this.root.removeFromParent();
  }
}
