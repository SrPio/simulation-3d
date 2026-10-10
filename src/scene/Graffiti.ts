import {
  BatchedMesh, BufferAttribute, BufferGeometry, CanvasTexture, Euler, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, Quaternion,
  SRGBColorSpace, SkinnedMesh, Vector3, type Material, type Object3D,
} from 'three';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Language } from '../core/i18n.ts';
import { faceNormal, surfaceFor, textFor, type GraffitiFace, type GraffitiSpot } from './graffitiData.ts';
import { ATLAS_WIDTH, GAP, canvas, paintSpot, type Canvas } from './graffitiPaint.ts';
import type { Piece } from './outsideData.ts';

/** One spot's paint in each language (the same painting twice when the words do not change, and for symbols). */
export type Paintings = Record<Language, CanvasImageSource & { width: number; height: number }>;

/** Paints `spot` in both languages, sharing the painting when its words read the same. */
export function paintBoth(spot: GraffitiSpot): Record<Language, Canvas> {
  const es = paintSpot(spot, 'es');
  return { es, en: spot.text && textFor(spot, 'en') !== textFor(spot, 'es') ? paintSpot(spot, 'en') : es };
}

/**
 * Every spot painted off the page in a worker, so the loading screen keeps moving; on the page itself when workers
 * or OffscreenCanvas are missing or the worker fails.
 */
export function paintGraffiti(spots: readonly GraffitiSpot[]): Promise<Paintings[]> {
  const onPage = () => spots.map(paintBoth);
  if (!spots.length) return Promise.resolve([]);
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return Promise.resolve(onPage());
  return new Promise((resolve) => {
    const worker = new Worker(new URL('./graffitiWorker.ts', import.meta.url), { type: 'module' });
    const done = (paintings: Paintings[]) => {
      worker.terminate();
      resolve(paintings);
    };
    worker.onmessage = (event: MessageEvent<Paintings[] | null>) => done(event.data ?? onPage());
    worker.onerror = () => done(onPage());
    worker.postMessage(spots);
  });
}

/** Depth of the decal projector (m): enough to follow a barrier's sloped face, short enough to stay on one side. */
const DECAL_DEPTH = 0.45;
/** Ground paint sits just above the painted floor words (FloorTexts, +0.006). */
const GROUND_LIFT = 0.009;
/** Flat paint on the ground is a little see-through, like the floor words; paint on things is solid. */
const GROUND_OPACITY = 0.88;
/** Shelf packing of the painted spots into one atlas, tallest first. */
function pack(sizes: readonly { width: number; height: number }[]): { rects: { x: number; y: number }[]; height: number } {
  const rects: { x: number; y: number }[] = [];
  const order = sizes.map((size, index) => ({ index, ...size })).sort((a, b) => b.height - a.height);
  let x = 0;
  let y = 0;
  let shelf = 0;
  for (const { index, width, height } of order) {
    if (x + width > ATLAS_WIDTH) {
      x = 0;
      y += shelf + GAP;
      shelf = 0;
    }
    rects[index] = { x, y };
    x += width + GAP;
    shelf = Math.max(shelf, height);
  }
  return { rects, height: y + shelf };
}

/** Orientation of the decal projector for a face: its local +X runs along the text, +Y up the text, +Z out of the surface. */
function faceRotation(face: GraffitiFace, tilt: number): Quaternion {
  const base = new Quaternion().setFromEuler(face === 'x' ? new Euler(0, Math.PI / 2, 0) : face === 'up' ? new Euler(-Math.PI / 2, 0, 0) : new Euler());
  return base.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), (tilt * Math.PI) / 180));
}

/** A flat quad on the ground (decal-like: uv 0…1 across, +X along the text, -Z its top). */
function groundQuad(center: Vector3, width: number, height: number, rotation: Quaternion): BufferGeometry {
  const corners = [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]];
  const position: number[] = [];
  const uv: number[] = [];
  for (const [u, v] of corners) {
    const point = new Vector3(u * width, v * height, 0).applyQuaternion(rotation).add(center);
    position.push(point.x, point.y, point.z);
    uv.push(u + 0.5, v + 0.5);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  geometry.setIndex([0, 1, 2, 2, 1, 3]);
  return geometry.toNonIndexed();
}

/** Keep the triangles of a decal that face its projector (a thin object's far side is left bare), as plain arrays. */
function facingTriangles(geometry: BufferGeometry, normal: Vector3): BufferGeometry {
  const position = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  const uv = geometry.getAttribute('uv');
  const keep: { position: number[]; normal: number[]; uv: number[] } = { position: [], normal: [], uv: [] };
  const n = new Vector3();
  for (let i = 0; i + 2 < position.count; i += 3) {
    n.set(0, 0, 0);
    for (let k = 0; k < 3; k++) n.add(new Vector3().fromBufferAttribute(normals, i + k));
    if (n.normalize().dot(normal) < 0.25) continue;
    for (let k = i; k < i + 3; k++) {
      keep.position.push(position.getX(k), position.getY(k), position.getZ(k));
      keep.normal.push(normals.getX(k), normals.getY(k), normals.getZ(k));
      keep.uv.push(uv.getX(k), uv.getY(k));
    }
  }
  const out = new BufferGeometry();
  out.setAttribute('position', new BufferAttribute(new Float32Array(keep.position), 3));
  out.setAttribute('normal', new BufferAttribute(new Float32Array(keep.normal), 3));
  out.setAttribute('uv', new BufferAttribute(new Float32Array(keep.uv), 2));
  return out;
}

/** Squeeze a decal's 0…1 uv into its atlas cell. */
function toCell(geometry: BufferGeometry, cell: { u: number; v: number; w: number; h: number }): void {
  const uv = geometry.getAttribute('uv') as BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, cell.u + uv.getX(i) * cell.w, cell.v + uv.getY(i) * cell.h);
}

/** Decals of every mesh the projector box reaches, keeping the faces that look at it; undefined when none. */
function decalOn(meshes: readonly Mesh[], point: Vector3, rotation: Quaternion, size: Vector3, normal: Vector3): BufferGeometry | undefined {
  const orientation = new Euler().setFromQuaternion(rotation);
  const reach = size.length() / 2;
  const parts: BufferGeometry[] = [];
  for (const mesh of meshes) {
    mesh.geometry.computeBoundingSphere();
    const sphere = mesh.geometry.boundingSphere!.clone().applyMatrix4(mesh.matrixWorld);
    if (sphere.center.distanceTo(point) > sphere.radius + reach) continue;
    const decal = new DecalGeometry(mesh, point, orientation, size);
    if (decal.getAttribute('position').count) {
      const facing = facingTriangles(decal, normal);
      if (facing.getAttribute('position').count) parts.push(facing);
    }
    decal.dispose();
  }
  if (!parts.length) return undefined;
  return parts.length > 1 ? mergeGeometries(parts, false) ?? undefined : parts[0];
}

/** Static meshes under the given roots that paint can land on (not instanced, batched or skinned ones). */
function staticMeshes(targets: readonly Object3D[]): Mesh[] {
  const meshes: Mesh[] = [];
  for (const target of targets) {
    target.updateMatrixWorld(true);
    target.traverse((object) => {
      if (object instanceof Mesh && object.visible && !(object instanceof InstancedMesh) && !(object instanceof BatchedMesh) && !(object instanceof SkinnedMesh)) meshes.push(object);
    });
  }
  return meshes;
}

/** A geometry as BatchedMesh wants it: position, normal and uv, indexed. */
function indexed(geometry: BufferGeometry): BufferGeometry {
  if (!geometry.index) geometry.setIndex(Array.from({ length: geometry.getAttribute('position').count }, (_, i) => i));
  return geometry;
}

/**
 * Every GRAFFITI spot painted with spray paint into one canvas atlas and laid on its surface: projected onto the
 * static meshes found at the spot (lit like them, one draw call), onto the loose pieces of a group (the bricks of a
 * wall: each piece carries its share and follows it, one more draw call), or flat on the ground (one more). Words are
 * painted in the current language and repainted in place on a change; each spot's cell fits the longer of its two
 * texts, so the paint is always whole and its box never changes.
 */
export class Graffiti {
  readonly root = new Group();
  /** Ids of the spots that found a surface (or the ground) and were painted. */
  readonly painted: string[] = [];
  private readonly texture: CanvasTexture<Canvas>;
  private readonly atlas: Canvas;
  private readonly materials: Material[] = [];
  private readonly paintings: Paintings[];
  private readonly cells: { x: number; y: number; width: number; height: number }[];
  private language: Language;
  /** The batch of paint on loose pieces, and its instances per piece index. */
  private onPieces?: BatchedMesh;
  private readonly pieceInstances = new Map<number, number[]>();

  constructor(
    spots: readonly GraffitiSpot[], targets: readonly Object3D[], groundY: number, pieces: readonly Piece[] = [], language: Language = 'es',
    paintings: Paintings[] = spots.map(paintBoth),
  ) {
    this.root.name = 'Graffiti';
    this.language = language;
    this.paintings = paintings;
    // A cell holds either language whole: as wide and as tall as the larger painting.
    const sizes = this.paintings.map(({ es, en }) => ({ width: Math.min(Math.max(es.width, en.width), ATLAS_WIDTH), height: Math.max(es.height, en.height) }));
    const { rects, height } = pack(sizes);
    this.cells = rects.map((rect, index) => ({ ...rect, ...sizes[index] }));
    this.atlas = canvas(ATLAS_WIDTH, height);
    this.texture = new CanvasTexture(this.atlas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.anisotropy = 8;
    this.paint();
    const meshes = staticMeshes(targets);
    const onThings: BufferGeometry[] = [];
    const onGround: BufferGeometry[] = [];
    const onPieces: { piece: number; geometry: BufferGeometry }[] = [];
    for (const [index, spot] of spots.entries()) {
      const cell = this.cells[index];
      // The canvas' top row is the top of the texture (flipY): v runs from the bottom of the cell up.
      const uv = { u: cell.x / ATLAS_WIDTH, v: 1 - (cell.y + cell.height) / this.atlas.height, w: cell.width / ATLAS_WIDTH, h: cell.height / this.atlas.height };
      const size = new Vector3(spot.width, (spot.width * cell.height) / cell.width, DECAL_DEPTH);
      const rotation = faceRotation(spot.face, spot.tilt ?? 0);
      const normal = faceNormal(spot.face);
      const placed: BufferGeometry[] = [];
      if (spot.loose) {
        // Each piece of the group at rest, as a mesh to project on; its share is kept in the piece's own axes.
        for (const [pieceIndex, piece] of pieces.entries()) {
          if (piece.group !== spot.loose) continue;
          const rest = new Matrix4().compose(piece.position, piece.quaternion, new Vector3(1, 1, 1));
          const parts = piece.parts.map((part) => {
            const mesh = new Mesh(part.geometry);
            mesh.matrixAutoUpdate = false;
            mesh.matrix.copy(rest);
            mesh.matrixWorld.copy(rest);
            return mesh;
          });
          const surface = surfaceFor(spot, parts, groundY);
          const point = surface?.point ?? new Vector3(spot.at[0], spot.at[1] === 'ground' ? groundY : spot.at[1], spot.at[2]);
          const geometry = decalOn(parts, point, rotation, size, normal);
          if (!geometry) continue;
          geometry.applyMatrix4(rest.clone().invert());
          onPieces.push({ piece: pieceIndex, geometry });
          placed.push(geometry);
        }
      } else {
        const surface = surfaceFor(spot, meshes, groundY);
        if (surface) {
          const geometry = decalOn(meshes, surface.point, rotation, size, normal);
          if (geometry) {
            onThings.push(geometry);
            placed.push(geometry);
          }
        } else if (spot.at[1] === 'ground') {
          const geometry = groundQuad(new Vector3(spot.at[0], groundY + GROUND_LIFT, spot.at[2]), size.x, size.y, rotation);
          onGround.push(geometry);
          placed.push(geometry);
        }
      }
      if (!placed.length) continue;
      for (const geometry of placed) toCell(geometry, uv);
      this.painted.push(spot.id);
    }
    const onSurfaces = () => new MeshLambertMaterial({
      map: this.texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    if (onThings.length) this.add(onThings, onSurfaces(), 'GraffitiOnThings', -1);
    if (onGround.length) {
      const material = new MeshBasicMaterial({ map: this.texture, transparent: true, opacity: GROUND_OPACITY, depthWrite: false });
      // After the painted floor words (renderOrder -4) and the zone labels (-3).
      this.add(onGround, material, 'GraffitiOnGround', -2);
    }
    if (onPieces.length) {
      const geometries = onPieces.map(({ geometry }) => indexed(geometry));
      const vertices = geometries.reduce((sum, geometry) => sum + geometry.getAttribute('position').count, 0);
      const indices = geometries.reduce((sum, geometry) => sum + geometry.index!.count, 0);
      const material = onSurfaces();
      const batch = new BatchedMesh(geometries.length, vertices, indices, material);
      batch.name = 'GraffitiOnPieces';
      batch.renderOrder = -1;
      // The pieces wander after a push, like their own batch.
      batch.frustumCulled = false;
      for (const [k, { piece, geometry }] of onPieces.entries()) {
        const id = batch.addInstance(batch.addGeometry(geometry));
        const rest = pieces[piece];
        batch.setMatrixAt(id, new Matrix4().compose(rest.position, rest.quaternion, new Vector3(1, 1, 1)));
        this.pieceInstances.set(piece, [...(this.pieceInstances.get(piece) ?? []), id]);
        geometries[k].dispose();
      }
      this.onPieces = batch;
      this.root.add(batch);
      this.materials.push(material);
    }
  }

  /** Paint on loose piece `index` follows its pose (PieceMeshes reports every move). */
  followPiece(index: number, matrix: Matrix4): void {
    const ids = this.pieceInstances.get(index);
    if (!ids || !this.onPieces) return;
    for (const id of ids) this.onPieces.setMatrixAt(id, matrix);
  }

  /** Repaint the words in another language; the paint keeps its place and size. */
  setLanguage(language: Language): void {
    if (language === this.language) return;
    this.language = language;
    this.paint();
  }

  /** Every cell in the current language, each painting centred in its cell. */
  private paint(): void {
    // Never read back: without willReadFrequently the atlas stays on the GPU and uploads in a moment (half a second otherwise).
    const ctx = this.atlas.getContext('2d')!;
    for (const [index, cell] of this.cells.entries()) {
      const painting = this.paintings[index][this.language];
      ctx.clearRect(cell.x, cell.y, cell.width, cell.height);
      ctx.drawImage(painting, cell.x + (cell.width - Math.min(painting.width, cell.width)) / 2, cell.y + (cell.height - painting.height) / 2, Math.min(painting.width, cell.width), painting.height);
    }
    this.texture.needsUpdate = true;
  }

  private add(geometries: BufferGeometry[], material: Material, name: string, renderOrder: number): void {
    const merged = geometries.length > 1 ? mergeGeometries(geometries, false) : geometries[0];
    if (!merged) return;
    for (const geometry of geometries) if (geometry !== merged) geometry.dispose();
    const mesh = new Mesh(merged, material);
    mesh.name = name;
    mesh.renderOrder = renderOrder;
    mesh.matrixAutoUpdate = false;
    this.root.add(mesh);
    this.materials.push(material);
  }

  dispose(): void {
    for (const child of this.root.children) {
      if (child instanceof BatchedMesh) child.dispose();
      else if (child instanceof Mesh) child.geometry.dispose();
    }
    for (const material of this.materials) material.dispose();
    this.texture.dispose();
  }
}
