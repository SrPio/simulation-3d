import { BatchedMesh, BufferAttribute, BufferGeometry, Group, Matrix4, MeshStandardMaterial, Quaternion, Vector3, type Texture } from 'three';
import type { Piece } from './outsideData.ts';
import type { BlobShadows } from './BlobShadows.ts';

type Pose = { position: { x: number; y: number; z: number }; quaternion: { x: number; y: number; z: number; w: number } };
/** A physics body's pose and whether it sleeps (cannon-es sleepState 2): sleeping pieces do not move. */
type Moving = Pose & { sleepState?: number };
const SLEEPING = 2;

/** Only what the shared material draws: positions, normals and, for textured pieces, UVs, indexed (BatchedMesh needs the same attributes everywhere). */
function plain(geometry: BufferGeometry, textured = false): BufferGeometry {
  const copy = new BufferGeometry();
  copy.setAttribute('position', geometry.getAttribute('position'));
  if (textured) copy.setAttribute('uv', geometry.getAttribute('uv'));
  const normal = geometry.getAttribute('normal');
  if (normal) copy.setAttribute('normal', normal);
  else copy.computeVertexNormals();
  const index = geometry.index ?? new BufferAttribute(Uint32Array.from({ length: geometry.getAttribute('position').count }, (_, i) => i), 1);
  copy.setIndex(index);
  return copy;
}

/** A box flap's centre from its hinge, in the hinge's axes (it lies flat, reaching inwards along -Z when shut). */
export const FLAP_CENTRE = { x: 0, y: 0.004, z: -0.123 };

type Batch = { mesh: BatchedMesh; geometries: Map<BufferGeometry, BufferGeometry>; ids: Map<BufferGeometry, number>; instances: number };

/**
 * Every loose piece outside (name letters, tagline, arrow keys, pins, ball, bricks, crates and cones) drawn as one
 * BatchedMesh: a single draw call. A piece of several materials is several instances sharing its matrix, each with its
 * colour. Textured parts (the tech cubes' logos, one shared atlas) go in a second batch: one more draw call.
 * Matrices follow the physics bodies while they move; each piece also owns a blob shadow.
 */
export class PieceMeshes {
  /** Both batches. */
  readonly root = new Group();
  readonly mesh: BatchedMesh;
  readonly textured?: BatchedMesh;
  private readonly pieces: readonly Piece[];
  private readonly instances: { mesh: BatchedMesh; id: number }[][] = [];
  /** Each box's flaps: their instance and place on the rim. */
  private readonly flapInstances: { id: number; local: Matrix4 }[][] = [];
  /** Each piece's last pose: the flaps sit shut on it until their own bodies move them. */
  private readonly poses: Matrix4[] = [];
  private readonly flapMatrix = new Matrix4();
  private readonly toHinge = new Matrix4().makeTranslation(-FLAP_CENTRE.x, -FLAP_CENTRE.y, -FLAP_CENTRE.z);
  private readonly shadows: BlobShadows;
  private readonly shadowOffset: number;
  private readonly groundY: number;
  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly quaternion = new Quaternion();
  private readonly one = new Vector3(1, 1, 1);
  private readonly axes = [new Vector3(), new Vector3(), new Vector3()];
  /** Called with every new pose of a piece (graffiti painted on the bricks follows them). */
  onPose?: (index: number, matrix: Matrix4) => void;

  constructor(pieces: readonly Piece[], shadows: BlobShadows, shadowOffset: number, groundY: number) {
    this.pieces = pieces;
    this.shadows = shadows;
    this.shadowOffset = shadowOffset;
    this.groundY = groundY;
    // Pieces of one kind share their geometry: it is stored once per batch.
    const plainParts: Batch = { mesh: undefined!, geometries: new Map(), ids: new Map(), instances: 0 };
    const texturedParts: Batch = { mesh: undefined!, geometries: new Map(), ids: new Map(), instances: 0 };
    let map: Texture | undefined;
    for (const piece of pieces) {
      for (const part of [...piece.parts, ...(piece.flaps ?? [])]) {
        const batch = part.map && part.geometry.getAttribute('uv') ? texturedParts : plainParts;
        if (batch === texturedParts) map ??= part.map;
        if (!batch.geometries.has(part.geometry)) batch.geometries.set(part.geometry, plain(part.geometry, batch === texturedParts));
        batch.instances++;
      }
    }
    const build = (batch: Batch, name: string, material: MeshStandardMaterial) => {
      let vertices = 0;
      let indices = 0;
      for (const geometry of batch.geometries.values()) {
        vertices += geometry.getAttribute('position').count;
        indices += geometry.index!.count;
      }
      batch.mesh = new BatchedMesh(Math.max(1, batch.instances), Math.max(1, vertices), Math.max(1, indices), material);
      batch.mesh.name = name;
      // Pieces wander after a push; each one is culled on its own bounds instead.
      batch.mesh.frustumCulled = false;
      for (const [source, geometry] of batch.geometries) batch.ids.set(source, batch.mesh.addGeometry(geometry));
      this.root.add(batch.mesh);
      return batch.mesh;
    };
    this.mesh = build(plainParts, 'Pieces', new MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0 }));
    if (texturedParts.instances) this.textured = build(texturedParts, 'TexturedPieces', new MeshStandardMaterial({ map, roughness: 0.55, metalness: 0 }));
    for (const [index, piece] of pieces.entries()) {
      this.instances.push(piece.parts.map((part) => {
        const batch = part.map && texturedParts.geometries.has(part.geometry) ? texturedParts : plainParts;
        const id = batch.mesh.addInstance(batch.ids.get(part.geometry)!);
        batch.mesh.setColorAt(id, part.color);
        return { mesh: batch.mesh, id };
      }));
      this.flapInstances.push((piece.flaps ?? []).map((flap) => {
        const id = plainParts.mesh.addInstance(plainParts.ids.get(flap.geometry)!);
        plainParts.mesh.setColorAt(id, flap.color);
        return { id, local: flap.matrix };
      }));
      this.poses.push(new Matrix4());
      this.set(index, piece);
    }
    for (const batch of [plainParts, texturedParts]) for (const geometry of batch.geometries.values()) geometry.dispose();
  }

  /** Move piece `index` (and its shadow) to a pose. */
  set(index: number, pose: Pose): void {
    const { position: p, quaternion: q } = pose;
    this.position.set(p.x, p.y, p.z);
    this.quaternion.set(q.x, q.y, q.z, q.w);
    this.matrix.compose(this.position, this.quaternion, this.one);
    for (const { mesh, id } of this.instances[index]) mesh.setMatrixAt(id, this.matrix);
    this.poses[index].copy(this.matrix);
    this.onPose?.(index, this.matrix);
    this.placeFlaps(index);
    // Footprint of the turned box on the ground: its extent along the piece's projected width axis and across it.
    const half = this.pieces[index].half;
    const [ax, ay, az] = this.axes;
    ax.set(1, 0, 0).applyQuaternion(this.quaternion).multiplyScalar(half[0]);
    ay.set(0, 1, 0).applyQuaternion(this.quaternion).multiplyScalar(half[1]);
    az.set(0, 0, 1).applyQuaternion(this.quaternion).multiplyScalar(half[2]);
    const yaw = Math.atan2(-ax.z, ax.x) || 0;
    const ux = Math.cos(yaw);
    const uz = -Math.sin(yaw);
    let along = 0;
    let across = 0;
    for (const axis of this.axes) {
      along += Math.abs(axis.x * ux + axis.z * uz);
      across += Math.abs(axis.x * uz - axis.z * ux);
    }
    const lowest = Math.abs(ax.y) + Math.abs(ay.y) + Math.abs(az.y);
    const lift = Math.max(0, p.y - lowest - this.groundY);
    const fade = Math.max(0, 1 - lift / 1.5) ** 2;
    // Flat pieces (the tagline) only get a faint contact shadow; standing ones a fuller one.
    const presence = Math.min(1, lowest / 0.2);
    this.shadows.set(this.shadowOffset + index, p.x, p.z, yaw, along * 2 + 0.25 * presence, across * 2 + 0.25 * presence, 0.5 * fade * presence);
  }

  /** The flaps of box `index` shut on it (before the physics runs, and after a reset). */
  private placeFlaps(index: number): void {
    const flaps = this.flapInstances[index];
    if (!flaps?.length) return;
    for (const flap of flaps) {
      this.flapMatrix.multiplyMatrices(this.poses[index], flap.local);
      this.mesh.setMatrixAt(flap.id, this.flapMatrix);
    }
  }

  /** Flap `k` of box `index` where its own body is (the body sits at the flap's centre, the mesh at its hinge). */
  setFlap(index: number, k: number, pose: Pose): void {
    const flap = this.flapInstances[index]?.[k];
    if (!flap) return;
    const { position: p, quaternion: q } = pose;
    this.position.set(p.x, p.y, p.z);
    this.quaternion.set(q.x, q.y, q.z, q.w);
    this.flapMatrix.compose(this.position, this.quaternion, this.one).multiply(this.toHinge);
    this.mesh.setMatrixAt(flap.id, this.flapMatrix);
  }

  /** Copy the poses of the bodies that moved (sleeping ones keep theirs), or of all of them. */
  sync(bodies: readonly Moving[], all = false): void {
    for (const [index, body] of bodies.entries()) if (all || body.sleepState !== SLEEPING) this.set(index, body);
  }

  /** Back to the poses read from the GLB. */
  reset(): void {
    for (const [index, piece] of this.pieces.entries()) this.set(index, piece);
  }

  dispose(): void {
    for (const mesh of [this.mesh, this.textured]) {
      if (!mesh) continue;
      mesh.dispose();
      const material = mesh.material as MeshStandardMaterial;
      material.map?.dispose();
      material.dispose();
    }
    this.root.removeFromParent();
  }
}
