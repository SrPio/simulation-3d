import {
  AdditiveBlending, CanvasTexture, Color, CylinderGeometry, DoubleSide, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, PlaneGeometry, Quaternion, SRGBColorSpace, Shape, ShapeGeometry, Vector3, type BufferGeometry,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { experienceYears } from '../core/experience.ts';
import { RubikPuzzle, inLayer, nearCube, type Axis, type Cubie } from '../world/rubik.ts';
import { FONT } from './canvasText.ts';

/** Sticker colours by face: +X, -X, +Y, -Y, +Z (the front, where the number lights), -Z. */
const FACE_COLORS = ['#c41e3a', '#ff6a00', '#f4f4f4', '#ffd500', '#00a35c', '#0051ba'];
/** The solved front darkens to this behind the neon number. */
const FRONT_DARK = new Color('#140d22');
const NEON = '#c58bff';
const SPIN = 0.45;              // rad/s about the vertical while scrambled
const TILT = { x: 0.42, z: 0.32 };  // the scrambled cube hangs tipped onto a corner
const SETTLE = 4;               // rate at which it turns to face the front and levels when the character comes near
const BOB = { height: 0.05, rate: 1.4 };

const AXES = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)];
const FRONT = new Vector3(0, 0, 1);

function roundedSquare(size: number, radius: number): ShapeGeometry {
  const h = size / 2;
  const shape = new Shape();
  shape.moveTo(-h + radius, -h);
  shape.lineTo(h - radius, -h);
  shape.quadraticCurveTo(h, -h, h, -h + radius);
  shape.lineTo(h, h - radius);
  shape.quadraticCurveTo(h, h, h - radius, h);
  shape.lineTo(-h + radius, h);
  shape.quadraticCurveTo(-h, h, -h, h - radius);
  shape.lineTo(-h, -h + radius);
  shape.quadraticCurveTo(-h, -h, -h + radius, -h);
  return new ShapeGeometry(shape, 3);
}

/** The neon number: glowing violet strokes with a white-hot core, on a transparent canvas, plus a thin neon frame. */
function paintNeon(canvas: HTMLCanvasElement, text: string): void {
  const size = canvas.width;
  const context = canvas.getContext('2d');
  if (!context) return;
  context.clearRect(0, 0, size, size);
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  const glow = (draw: () => void) => {
    for (const [blur, color, width] of [[48, NEON, 1], [22, NEON, 1], [8, '#e9d6ff', 1], [0, '#ffffff', 0.45]] as const) {
      context.shadowBlur = blur;
      context.shadowColor = color;
      context.globalAlpha = width;
      draw();
    }
    context.shadowBlur = 0;
    context.globalAlpha = 1;
  };
  context.font = `700 ${Math.round(size * 0.6)}px ${FONT}`;
  const natural = context.measureText(text).width;
  if (natural > size * 0.8) context.font = `700 ${Math.round(size * 0.6 * size * 0.8 / natural)}px ${FONT}`;
  context.fillStyle = '#f1e4ff';
  glow(() => context.fillText(text, size / 2, size * 0.53));
  context.strokeStyle = '#d9b8ff';
  context.lineWidth = size * 0.018;
  glow(() => {
    context.beginPath();
    context.roundRect(size * 0.07, size * 0.07, size * 0.86, size * 0.86, size * 0.08);
    context.stroke();
  });
}

/**
 * The years-of-experience monument's Rubik's cube, floating over its pedestal. Scrambled it turns slowly about the
 * vertical, tipped onto a corner; when the character comes near it levels, turns its front (+Z, the perspective rule)
 * towards the plaza and undoes its scramble a layer at a time (RubikPuzzle), then the front darkens and the number
 * lights in neon. 27 rounded cubies and 54 stickers are two instanced meshes; a soft beam rises from the projector.
 */
export class RubikMonument {
  readonly root = new Group();
  readonly puzzle = new RubikPuzzle();
  private readonly cube = new Group();
  private readonly cell: number;
  private readonly bodies: InstancedMesh;
  private readonly stickers: InstancedMesh;
  /** Each sticker's cubie, its face, and its place on the cubie. */
  private readonly stickerOf: { cubie: number; face: number; local: Matrix4 }[] = [];
  private readonly neon: Mesh;
  private readonly neonMaterial: MeshBasicMaterial;
  private readonly beamMaterial: MeshBasicMaterial;
  private readonly geometries: BufferGeometry[] = [];
  private readonly textures: CanvasTexture[] = [];
  private near = false;
  private yaw = 0.6;
  private tilt = 1;
  private time = 0;

  constructor(spot: { position: Vector3; edge: number; drop: number }) {
    this.root.name = 'RubikMonument';
    this.root.position.copy(spot.position);
    this.root.add(this.cube);
    this.cell = spot.edge / 3;
    const cell = this.cell;
    const body = new RoundedBoxGeometry(cell * 0.98, cell * 0.98, cell * 0.98, 2, cell * 0.1);
    const sticker = roundedSquare(cell * 0.84, cell * 0.12);
    this.geometries.push(body, sticker);
    this.bodies = new InstancedMesh(body, new MeshStandardMaterial({ color: '#141218', roughness: 0.45, metalness: 0.1 }), 27);
    this.bodies.name = 'RubikCubies';
    const cubies = this.puzzle.cubies;
    for (const [index, cubie] of cubies.entries()) {
      for (const axis of [0, 1, 2] as Axis[]) {
        const sign = cubie.home[axis];
        if (!sign) continue;
        const normal = AXES[axis].clone().multiplyScalar(sign);
        const local = new Matrix4().compose(normal.clone().multiplyScalar(cell * 0.494), new Quaternion().setFromUnitVectors(FRONT, normal), new Vector3(1, 1, 1));
        this.stickerOf.push({ cubie: index, face: axis * 2 + (sign > 0 ? 0 : 1), local });
      }
    }
    this.stickers = new InstancedMesh(sticker, new MeshStandardMaterial({ color: '#ffffff', roughness: 0.3, metalness: 0.05 }), this.stickerOf.length);
    this.stickers.name = 'RubikStickers';
    for (const [index, { face }] of this.stickerOf.entries()) this.stickers.setColorAt(index, new Color(FACE_COLORS[face]));
    for (const mesh of [this.bodies, this.stickers]) {
      // The cubies move inside the cube's bounds; their own bounds would cull them wrongly.
      mesh.frustumCulled = false;
      this.cube.add(mesh);
    }
    // The neon number on the front face, a hair in front of the stickers; lit only once solved.
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 512;
    paintNeon(canvas, `+${experienceYears()}`);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 4;
    this.textures.push(texture);
    const plane = new PlaneGeometry(spot.edge, spot.edge);
    this.geometries.push(plane);
    this.neonMaterial = new MeshBasicMaterial({ map: texture, transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0 });
    this.neon = new Mesh(plane, this.neonMaterial);
    this.neon.name = 'RubikNeon';
    this.neon.position.z = spot.edge / 2 + 0.006;
    this.neon.visible = false;
    this.cube.add(this.neon);
    // The projector's beam: an open cone from the pedestal up round the cube, fading upwards.
    const fade = document.createElement('canvas');
    fade.width = 1;
    fade.height = 64;
    const fadeContext = fade.getContext('2d');
    if (fadeContext) {
      const gradient = fadeContext.createLinearGradient(0, 0, 0, 64);
      gradient.addColorStop(0, 'rgba(0,0,0,1)');
      gradient.addColorStop(0.55, 'rgba(60,60,60,1)');
      gradient.addColorStop(1, 'rgba(255,255,255,1)');
      fadeContext.fillStyle = gradient;
      fadeContext.fillRect(0, 0, 1, 64);
    }
    const fadeTexture = new CanvasTexture(fade);
    this.textures.push(fadeTexture);
    const length = spot.drop + spot.edge * 0.3;
    const beam = new CylinderGeometry(spot.edge * 0.95, 0.3, length, 40, 1, true);
    beam.translate(0, length / 2 - spot.drop, 0);
    this.geometries.push(beam);
    this.beamMaterial = new MeshBasicMaterial({
      color: NEON, alphaMap: fadeTexture, transparent: true, opacity: 0.22, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, toneMapped: false,
    });
    const beamMesh = new Mesh(beam, this.beamMaterial);
    beamMesh.name = 'RubikBeam';
    beamMesh.renderOrder = 2;
    this.root.add(beamMesh);
    this.pose();
  }

  /** Where each cubie and sticker is now, with the turning layer partway round. */
  private pose(): void {
    const { turning } = this.puzzle;
    const turn = new Matrix4();
    if (turning) turn.makeRotationAxis(AXES[turning.move.axis], this.puzzle.angle);
    const rotation = new Matrix4();
    const matrices = this.puzzle.cubies.map((cubie: Cubie) => {
      const [a, b, c, d, e, f, g, h, i] = cubie.rotation;
      rotation.set(a, b, c, 0, d, e, f, 0, g, h, i, 0, 0, 0, 0, 1);
      const matrix = new Matrix4().makeTranslation(cubie.at[0] * this.cell, cubie.at[1] * this.cell, cubie.at[2] * this.cell).multiply(rotation);
      return turning && inLayer(cubie, turning.move) ? turn.clone().multiply(matrix) : matrix;
    });
    for (const [index, matrix] of matrices.entries()) this.bodies.setMatrixAt(index, matrix);
    const sticker = new Matrix4();
    for (const [index, { cubie, local }] of this.stickerOf.entries()) this.stickers.setMatrixAt(index, sticker.multiplyMatrices(matrices[cubie], local));
    this.bodies.instanceMatrix.needsUpdate = true;
    this.stickers.instanceMatrix.needsUpdate = true;
  }

  /** The solved front darkens behind the number as it lights. */
  private shade(reveal: number): void {
    const color = new Color();
    for (const [index, { face }] of this.stickerOf.entries()) {
      if (face !== 4) continue;
      this.stickers.setColorAt(index, color.set(FACE_COLORS[face]).lerp(FRONT_DARK, reveal));
    }
    if (this.stickers.instanceColor) this.stickers.instanceColor.needsUpdate = true;
  }

  /**
   * Advance by `delta` seconds with the character at `character` (none: away). `still` (reduced motion) stops the spin,
   * the bob and the flicker and solves at once. Returns the layer turns that ended now and whether the number just lit.
   */
  update(delta: number, character: { x: number; z: number } | undefined, still: boolean): { turns: number; lit: boolean } {
    this.time += delta;
    const distance = character ? Math.hypot(character.x - this.root.position.x, character.z - this.root.position.z) : Infinity;
    this.near = nearCube(distance, this.near);
    const before = this.puzzle.reveal;
    const turns = this.puzzle.update(delta, this.near, still);
    const reveal = this.puzzle.reveal;
    // Near (or lit) it levels and faces the front; scrambled it tips back onto its corner and spins.
    const settle = this.near || reveal > 0;
    const ease = still ? 1 : 1 - Math.exp(-SETTLE * delta);
    if (settle) this.yaw += (Math.round(this.yaw / (2 * Math.PI)) * 2 * Math.PI - this.yaw) * ease;
    else if (!still) this.yaw += SPIN * delta;
    this.tilt += ((settle ? 0 : 1) - this.tilt) * ease;
    this.cube.rotation.set(TILT.x * this.tilt, this.yaw, TILT.z * this.tilt, 'YXZ');
    this.cube.position.y = still ? 0 : Math.sin(this.time * BOB.rate) * BOB.height;
    this.pose();
    if (reveal !== before) this.shade(reveal);
    // The neon stutters on like a tube striking, then hums.
    const flicker = still || reveal >= 0.6 ? 1 : Math.sin(reveal * 70) > 0 ? 1 : 0.2;
    this.neonMaterial.opacity = reveal * flicker * (still ? 1 : 0.92 + 0.08 * Math.sin(this.time * 3.1));
    this.neon.visible = reveal > 0;
    this.beamMaterial.opacity = 0.22 + 0.28 * reveal;
    return { turns, lit: before === 0 && reveal > 0 };
  }

  /** For the page's hook: scrambled | solving | solved | scrambling. */
  get phase(): string {
    return this.puzzle.phase;
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    for (const texture of this.textures) texture.dispose();
    for (const mesh of [this.bodies, this.stickers]) {
      (mesh.material as MeshStandardMaterial).dispose();
      mesh.dispose();
    }
    this.neonMaterial.dispose();
    this.beamMaterial.dispose();
    this.root.removeFromParent();
  }
}
