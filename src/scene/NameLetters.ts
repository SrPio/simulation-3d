import { BatchedMesh, Matrix4, Quaternion, Vector3, type Material } from 'three';
import type { Letter } from './outsideData.ts';
import type { BlobShadows } from './BlobShadows.ts';

type Pose = { position: { x: number; y: number; z: number }; quaternion: { x: number; y: number; z: number; w: number } };

/**
 * The name letters drawn as one BatchedMesh (a single draw call for all of them). Each letter keeps
 * its own matrix, updated from its physics body while it moves; each also owns a blob shadow.
 */
export class NameLetters {
  readonly mesh: BatchedMesh;
  private readonly letters: readonly Letter[];
  private readonly ids: number[] = [];
  private readonly shadows: BlobShadows;
  private readonly shadowOffset: number;
  private readonly groundY: number;
  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly quaternion = new Quaternion();
  private readonly one = new Vector3(1, 1, 1);
  private readonly axes = [new Vector3(), new Vector3(), new Vector3()];

  constructor(letters: readonly Letter[], shadows: BlobShadows, shadowOffset: number, groundY: number) {
    this.letters = letters;
    this.shadows = shadows;
    this.shadowOffset = shadowOffset;
    this.groundY = groundY;
    let vertices = 0;
    let indices = 0;
    for (const { geometry } of letters) {
      vertices += geometry.getAttribute('position').count;
      indices += geometry.index?.count ?? 0;
    }
    const material = (letters[0]?.material as Material).clone();
    this.mesh = new BatchedMesh(letters.length, vertices, indices, material);
    this.mesh.name = 'NameLetters';
    // Letters wander after a push; each one is culled on its own bounds instead.
    this.mesh.frustumCulled = false;
    for (const letter of letters) {
      const id = this.mesh.addInstance(this.mesh.addGeometry(letter.geometry));
      this.ids.push(id);
      this.set(this.ids.length - 1, letter);
    }
  }

  /** Move letter `index` (and its shadow) to a pose. */
  set(index: number, pose: Pose): void {
    const { position: p, quaternion: q } = pose;
    this.position.set(p.x, p.y, p.z);
    this.quaternion.set(q.x, q.y, q.z, q.w);
    this.mesh.setMatrixAt(this.ids[index], this.matrix.compose(this.position, this.quaternion, this.one));
    // Footprint of the turned box on the ground: its extent along the letter's projected width axis and across it.
    const half = this.letters[index].half;
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
    this.shadows.set(this.shadowOffset + index, p.x, p.z, yaw, along * 2 + 0.25, across * 2 + 0.25, 0.5 * fade);
  }

  /** Copy every letter's pose from the physics bodies. */
  sync(bodies: readonly Pose[]): void {
    for (const [index, body] of bodies.entries()) this.set(index, body);
  }

  /** Back to the poses read from the GLB. */
  reset(): void {
    for (const [index, letter] of this.letters.entries()) this.set(index, letter);
  }

  dispose(): void {
    this.mesh.dispose();
    (this.mesh.material as Material).dispose();
    this.mesh.removeFromParent();
  }
}
