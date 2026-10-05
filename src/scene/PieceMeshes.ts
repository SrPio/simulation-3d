import { BatchedMesh, BufferAttribute, BufferGeometry, Matrix4, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import type { Piece } from './outsideData.ts';
import type { BlobShadows } from './BlobShadows.ts';

type Pose = { position: { x: number; y: number; z: number }; quaternion: { x: number; y: number; z: number; w: number } };
/** A physics body's pose and whether it sleeps (cannon-es sleepState 2): sleeping pieces do not move. */
type Moving = Pose & { sleepState?: number };
const SLEEPING = 2;

/** Only what the shared material draws: positions and normals, indexed (BatchedMesh needs the same attributes everywhere). */
function plain(geometry: BufferGeometry): BufferGeometry {
  const copy = new BufferGeometry();
  copy.setAttribute('position', geometry.getAttribute('position'));
  const normal = geometry.getAttribute('normal');
  if (normal) copy.setAttribute('normal', normal);
  else copy.computeVertexNormals();
  const index = geometry.index ?? new BufferAttribute(Uint32Array.from({ length: geometry.getAttribute('position').count }, (_, i) => i), 1);
  copy.setIndex(index);
  return copy;
}

/**
 * Every loose piece outside (name letters, tagline, arrow keys, pins, ball, bricks) drawn as one BatchedMesh:
 * a single draw call. A piece of several materials is several instances sharing its matrix, each with its
 * colour. Matrices follow the physics bodies while they move; each piece also owns a blob shadow.
 */
export class PieceMeshes {
  readonly mesh: BatchedMesh;
  private readonly pieces: readonly Piece[];
  private readonly instances: number[][] = [];
  private readonly shadows: BlobShadows;
  private readonly shadowOffset: number;
  private readonly groundY: number;
  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly quaternion = new Quaternion();
  private readonly one = new Vector3(1, 1, 1);
  private readonly axes = [new Vector3(), new Vector3(), new Vector3()];

  constructor(pieces: readonly Piece[], shadows: BlobShadows, shadowOffset: number, groundY: number) {
    this.pieces = pieces;
    this.shadows = shadows;
    this.shadowOffset = shadowOffset;
    this.groundY = groundY;
    // Pieces of one kind share their geometry: it is stored once.
    const unique = new Map<BufferGeometry, BufferGeometry>();
    let instances = 0;
    for (const piece of pieces) {
      for (const part of piece.parts) {
        if (!unique.has(part.geometry)) unique.set(part.geometry, plain(part.geometry));
        instances++;
      }
    }
    let vertices = 0;
    let indices = 0;
    for (const geometry of unique.values()) {
      vertices += geometry.getAttribute('position').count;
      indices += geometry.index!.count;
    }
    this.mesh = new BatchedMesh(instances, vertices, indices, new MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0 }));
    this.mesh.name = 'Pieces';
    // Pieces wander after a push; each one is culled on its own bounds instead.
    this.mesh.frustumCulled = false;
    const ids = new Map<BufferGeometry, number>();
    for (const [source, geometry] of unique) ids.set(source, this.mesh.addGeometry(geometry));
    for (const [index, piece] of pieces.entries()) {
      this.instances.push(piece.parts.map((part) => {
        const id = this.mesh.addInstance(ids.get(part.geometry)!);
        this.mesh.setColorAt(id, part.color);
        return id;
      }));
      this.set(index, piece);
    }
    for (const geometry of unique.values()) geometry.dispose();
  }

  /** Move piece `index` (and its shadow) to a pose. */
  set(index: number, pose: Pose): void {
    const { position: p, quaternion: q } = pose;
    this.position.set(p.x, p.y, p.z);
    this.quaternion.set(q.x, q.y, q.z, q.w);
    this.matrix.compose(this.position, this.quaternion, this.one);
    for (const id of this.instances[index]) this.mesh.setMatrixAt(id, this.matrix);
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

  /** Copy the poses of the bodies that moved (sleeping ones keep theirs), or of all of them. */
  sync(bodies: readonly Moving[], all = false): void {
    for (const [index, body] of bodies.entries()) if (all || body.sleepState !== SLEEPING) this.set(index, body);
  }

  /** Back to the poses read from the GLB. */
  reset(): void {
    for (const [index, piece] of this.pieces.entries()) this.set(index, piece);
  }

  dispose(): void {
    this.mesh.dispose();
    (this.mesh.material as MeshStandardMaterial).dispose();
    this.mesh.removeFromParent();
  }
}
