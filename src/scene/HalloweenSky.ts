import {
  AdditiveBlending, CanvasTexture, DynamicDrawUsage, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial,
  PlaneGeometry, Quaternion, SRGBColorSpace, Vector3, type BufferGeometry, type Material, type MeshStandardMaterial, type Object3D,
} from 'three';
import { fleeStep, ghostAt, ghostHeight, type Ghost } from '../world/ghosts.ts';

/** Where the bats circle (three.js x, z), how wide, how high and how many in each flock. */
const FLOCKS = [
  { x: -8, z: 11, radius: 4, height: 5.5, count: 4 }, { x: 0, z: 0, radius: 5, height: 6.5, count: 3 },
  { x: 30, z: 3, radius: 6, height: 7, count: 4 }, { x: 27, z: 36, radius: 5, height: 6, count: 3 },
] as const;
/** The little ghosts' homes: the graveyard, the plaza, the forest and the playground. */
const GHOST_HOMES = [{ x: -7.6, z: 8.6 }, { x: 34.5, z: 6.6 }, { x: 45.5, z: 12.5 }, { x: 15.2, z: 30.4 }] as const;
/** Mist: soft patches drifting low round the character (how many, how far, how big and high). */
const MIST = { count: 26, reach: 11, size: [2.6, 5.2], height: 0.18, opacity: 0.16 } as const;
const BAT_SCALE = 1.6;

/** A soft round puff of mist: white in the middle, fading out. */
function mistTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** Instanced copies of a model, one InstancedMesh per material. */
function instanced(model: Object3D, capacity: number): InstancedMesh[] {
  model.updateMatrixWorld(true);
  const inverse = new Matrix4().copy(model.matrixWorld).invert();
  const meshes: InstancedMesh[] = [];
  model.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const geometry = (object.geometry as BufferGeometry).clone().applyMatrix4(new Matrix4().multiplyMatrices(inverse, object.matrixWorld));
    const mesh = new InstancedMesh(geometry, object.material as Material, capacity);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    meshes.push(mesh);
  });
  return meshes;
}

/**
 * Halloween's night life: flocks of bats circling high over the graveyard, the room, the plaza and the boxing corner
 * (their wings flap in the vertex shader), little sheet ghosts that bob round their homes and flee from the character
 * (src/world/ghosts.ts), and patches of low mist drifting round the character. With reduced motion everything holds
 * still. Nothing here has a body or a shadow.
 */
export class HalloweenSky {
  readonly root = new Group();
  readonly ghosts: Ghost[];
  private readonly bats: InstancedMesh[] = [];
  private readonly ghostMeshes: InstancedMesh[] = [];
  private readonly mist: InstancedMesh;
  private readonly mistSpots: { x: number; z: number; size: number; drift: number; phase: number }[] = [];
  private readonly flap = { value: 0 };
  private clock = 0;
  private readonly groundY: number;
  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly quaternion = new Quaternion();
  private readonly scale = new Vector3();
  private readonly up = new Vector3(0, 1, 0);

  constructor(library: Map<string, Object3D>, groundY: number, random: () => number = Math.random) {
    this.root.name = 'HalloweenSky';
    this.groundY = groundY;
    const batCount = FLOCKS.reduce((sum, flock) => sum + flock.count, 0);
    const bat = library.get('Bat');
    if (bat) {
      for (const mesh of instanced(bat, batCount)) {
        // Each bat flaps at its own moment: the wings (further than 6 cm from the body along X) turn up and down.
        mesh.geometry.setAttribute('aPhase', new InstancedBufferAttribute(Float32Array.from({ length: batCount }, () => random() * Math.PI * 2), 1));
        const material = (mesh.material as MeshStandardMaterial).clone();
        material.onBeforeCompile = (shader) => {
          shader.uniforms.uFlap = this.flap;
          shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nuniform float uFlap;\nattribute float aPhase;')
            .replace('#include <begin_vertex>', `#include <begin_vertex>
              float side = sign(transformed.x);
              float reach = max(abs(transformed.x) - 0.06, 0.0);
              float beat = sin(uFlap * 14.0 + aPhase) * 0.9;
              transformed.x = side * (min(abs(transformed.x), 0.06) + reach * cos(beat));
              transformed.y += reach * sin(beat);`);
        };
        mesh.material = material;
        mesh.name = 'Bats';
        this.bats.push(mesh);
        this.root.add(mesh);
      }
    }
    this.ghosts = GHOST_HOMES.map((home, k) => ghostAt(home, k * 1.7));
    const ghost = library.get('Ghost');
    if (ghost) {
      for (const mesh of instanced(ghost, this.ghosts.length)) {
        mesh.name = 'Ghosts';
        this.ghostMeshes.push(mesh);
        this.root.add(mesh);
      }
    }
    const material = new MeshBasicMaterial({ map: mistTexture(), color: 0xc9c2ff, transparent: true, opacity: MIST.opacity, depthWrite: false, blending: AdditiveBlending });
    this.mist = new InstancedMesh(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), material, MIST.count);
    this.mist.name = 'Mist';
    this.mist.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mist.frustumCulled = false;
    this.mist.renderOrder = 2;
    for (let k = 0; k < MIST.count; k++) {
      this.mistSpots.push({
        x: (random() - 0.5) * 2 * MIST.reach, z: (random() - 0.5) * 2 * MIST.reach,
        size: MIST.size[0] + random() * (MIST.size[1] - MIST.size[0]), drift: 0.25 + random() * 0.35, phase: random() * Math.PI * 2,
      });
    }
    this.root.add(this.mist);
  }

  /** Flap, circle, float and drift; the ghosts flee from the character at `from` (none while it is not outside). */
  update(delta: number, from: { x: number; z: number } | undefined, reducedMotion: boolean): void {
    const step = reducedMotion ? 0 : delta;
    this.clock += step;
    this.flap.value = this.clock;
    let slot = 0;
    for (const [f, flock] of FLOCKS.entries()) {
      for (let k = 0; k < flock.count; k++) {
        const angle = this.clock * (0.55 + 0.1 * k) * (f % 2 ? -1 : 1) + (k / flock.count) * Math.PI * 2;
        const wobble = Math.sin(this.clock * 1.3 + k * 2.1 + f) * 0.6;
        this.position.set(flock.x + Math.cos(angle) * (flock.radius + wobble), this.groundY + flock.height + Math.sin(this.clock * 2 + k) * 0.5, flock.z + Math.sin(angle) * (flock.radius + wobble));
        // Facing along the circle: the tangent, which turns the other way for the flocks that fly the other way.
        const heading = Math.atan2(-Math.sin(angle), Math.cos(angle)) * (f % 2 ? -1 : 1) + (f % 2 ? Math.PI : 0);
        this.quaternion.setFromAxisAngle(this.up, heading);
        this.matrix.compose(this.position, this.quaternion, this.scale.setScalar(BAT_SCALE));
        for (const mesh of this.bats) mesh.setMatrixAt(slot, this.matrix);
        slot++;
      }
    }
    for (const mesh of this.bats) {
      mesh.count = slot;
      mesh.instanceMatrix.needsUpdate = true;
    }
    for (const [k, ghost] of this.ghosts.entries()) {
      if (step > 0) fleeStep(ghost, from, step);
      this.position.set(ghost.x, this.groundY + ghostHeight(ghost), ghost.z);
      this.quaternion.setFromAxisAngle(this.up, ghost.yaw);
      this.matrix.compose(this.position, this.quaternion, this.scale.setScalar(1));
      for (const mesh of this.ghostMeshes) mesh.setMatrixAt(k, this.matrix);
    }
    for (const mesh of this.ghostMeshes) mesh.instanceMatrix.needsUpdate = true;
    // The mist keeps round the character: patches that fall behind come back in front.
    const centre = from ?? { x: 0, z: 0 };
    for (const [k, spot] of this.mistSpots.entries()) {
      spot.x += spot.drift * step;
      spot.phase += step * 0.3;
      let x = spot.x - centre.x;
      let z = spot.z - centre.z;
      x = ((x + MIST.reach) % (2 * MIST.reach) + 2 * MIST.reach) % (2 * MIST.reach) - MIST.reach;
      z = ((z + MIST.reach) % (2 * MIST.reach) + 2 * MIST.reach) % (2 * MIST.reach) - MIST.reach;
      spot.x = centre.x + x;
      spot.z = centre.z + z;
      const size = spot.size * (1 + Math.sin(spot.phase) * 0.12);
      this.position.set(spot.x, this.groundY + MIST.height, spot.z);
      this.quaternion.setFromAxisAngle(this.up, spot.phase * 0.2);
      this.matrix.compose(this.position, this.quaternion, this.scale.set(size, 1, size));
      this.mist.setMatrixAt(k, this.matrix);
    }
    this.mist.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const mesh of [...this.bats, ...this.ghostMeshes]) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
    (this.mist.material as MeshBasicMaterial).map?.dispose();
    (this.mist.material as MeshBasicMaterial).dispose();
    this.mist.geometry.dispose();
    this.mist.dispose();
    this.root.removeFromParent();
  }
}
