import {
  CanvasTexture, Group, Mesh, MeshStandardMaterial, SphereGeometry, SpriteMaterial, Sprite, SRGBColorSpace, Vector3,
  type Object3D,
} from 'three';
import { BASEBALL, type ThrownPumpkin } from '../world/PropPhysics.ts';

/** A ball Canela put down stays this long (s), then shrinks away over `shrink` s. */
export const BALL_LINGER = { stay: 4, shrink: 0.45 } as const;

/** A baseball's cover: white leather with the two red stitched seams curling round it. */
function cover(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#f3efe6';
  g.fillRect(0, 0, 256, 128);
  g.strokeStyle = '#c8322b';
  g.lineWidth = 3;
  for (const shift of [0, 128]) {
    // In the sphere's longitude/latitude the seam is a wave round the ball.
    const path = (offset: number) => {
      g.beginPath();
      for (let x = 0; x <= 128; x += 2) {
        const y = 64 + Math.sin((x / 128) * Math.PI * 2) * 34 * (shift ? -1 : 1) + offset;
        if (x === 0) g.moveTo(x + shift, y);
        else g.lineTo(x + shift, y);
      }
      g.stroke();
    };
    path(0);
    // The stitches: short slanted ticks either side of the seam.
    g.lineWidth = 2;
    for (let x = 2; x < 128; x += 7) {
      const y = 64 + Math.sin((x / 128) * Math.PI * 2) * 34 * (shift ? -1 : 1);
      g.beginPath();
      g.moveTo(x + shift - 3, y - 6);
      g.lineTo(x + shift + 3, y - 2);
      g.moveTo(x + shift - 3, y + 6);
      g.lineTo(x + shift + 3, y + 2);
      g.stroke();
    }
    g.lineWidth = 3;
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

type Resting = { mesh: Mesh; age: number };

/**
 * The baseballs: flying and rolling ones follow their bodies, the one in Canela's mouth rides on it, and the ones she
 * put down stay a moment and shrink away.
 */
export class Baseballs {
  readonly root = new Group();
  private readonly geometry = new SphereGeometry(BASEBALL.radius, 20, 14);
  private readonly material = new MeshStandardMaterial({ map: cover(), roughness: 0.65 });
  private readonly flying = new Map<ThrownPumpkin, Mesh>();
  private held?: Mesh;
  private resting: Resting[] = [];

  constructor() {
    this.root.name = 'Baseballs';
  }

  private make(): Mesh {
    const mesh = new Mesh(this.geometry, this.material);
    mesh.castShadow = true;
    this.root.add(mesh);
    return mesh;
  }

  /** Follow the balls in the world; balls that left it (taken away) go. */
  sync(balls: readonly ThrownPumpkin[], retired: ThrownPumpkin[]): void {
    for (const ball of retired.splice(0)) {
      const mesh = this.flying.get(ball);
      if (mesh) this.root.remove(mesh);
      this.flying.delete(ball);
    }
    for (const ball of balls) {
      let mesh = this.flying.get(ball);
      if (!mesh) {
        mesh = this.make();
        this.flying.set(ball, mesh);
      }
      const { position: p, quaternion: q } = ball.body;
      mesh.position.set(p.x, p.y, p.z);
      mesh.quaternion.set(q.x, q.y, q.z, q.w);
    }
  }

  /** Canela took `ball` in her mouth: its mesh moves onto `mouth`. */
  grab(ball: ThrownPumpkin, mouth: Object3D): void {
    const mesh = this.flying.get(ball) ?? this.make();
    this.flying.delete(ball);
    mesh.removeFromParent();
    mesh.position.set(0, 0, 0);
    mesh.quaternion.identity();
    mouth.add(mesh);
    this.held = mesh;
  }

  get holding(): boolean {
    return this.held !== undefined;
  }

  /** She lets it go: it lies on the ground under her mouth, at `groundY`. */
  drop(groundY: number): Vector3 | undefined {
    const mesh = this.held;
    if (!mesh) return undefined;
    const at = mesh.getWorldPosition(new Vector3());
    mesh.removeFromParent();
    at.y = groundY + BASEBALL.radius;
    mesh.position.copy(at);
    this.root.add(mesh);
    this.held = undefined;
    this.resting.push({ mesh, age: 0 });
    return at;
  }

  /** The ball in her mouth is dropped where it is without lying down (she lost it: a reset, a jump back to the character). */
  letGo(): void {
    if (!this.held) return;
    this.held.removeFromParent();
    this.held = undefined;
  }

  update(delta: number, reducedMotion: boolean): void {
    this.resting = this.resting.filter((entry) => {
      entry.age += delta;
      const fading = entry.age - BALL_LINGER.stay;
      if (fading <= 0) return true;
      const size = reducedMotion ? 0 : 1 - fading / BALL_LINGER.shrink;
      if (size <= 0.01) {
        this.root.remove(entry.mesh);
        return false;
      }
      entry.mesh.scale.setScalar(size);
      return true;
    });
  }

  get count(): number {
    return this.flying.size + this.resting.length + (this.held ? 1 : 0);
  }

  clear(): void {
    for (const mesh of this.flying.values()) this.root.remove(mesh);
    this.flying.clear();
    for (const entry of this.resting) this.root.remove(entry.mesh);
    this.resting = [];
    this.letGo();
  }

  dispose(): void {
    this.clear();
    this.geometry.dispose();
    this.material.map?.dispose();
    this.material.dispose();
    this.root.removeFromParent();
  }
}

/** A soft puff of dust (only dust) where Canela lands out of nowhere: a ring of sprites that swell, rise and fade. */
export class DustPuff {
  readonly root = new Group();
  private readonly material: SpriteMaterial;
  private puffs: { sprites: Sprite[]; age: number; drift: Vector3[] }[] = [];
  private static readonly LIFE = 0.9;

  constructor() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const g = canvas.getContext('2d')!;
    const gradient = g.createRadialGradient(32, 32, 2, 32, 32, 31);
    gradient.addColorStop(0, 'rgba(214, 196, 168, 0.95)');
    gradient.addColorStop(0.55, 'rgba(196, 176, 148, 0.55)');
    gradient.addColorStop(1, 'rgba(190, 170, 140, 0)');
    g.fillStyle = gradient;
    g.fillRect(0, 0, 64, 64);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    this.material = new SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
    this.root.name = 'DustPuff';
  }

  /** A puff round `at` (on the ground). */
  burst(at: Vector3, count = 14): void {
    const sprites: Sprite[] = [];
    const drift: Vector3[] = [];
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const sprite = new Sprite(this.material.clone());
      const out = 0.12 + Math.random() * 0.12;
      sprite.position.set(at.x + Math.cos(angle) * out, at.y + 0.08 + Math.random() * 0.1, at.z + Math.sin(angle) * out);
      sprite.scale.setScalar(0.2);
      sprite.renderOrder = 3;
      this.root.add(sprite);
      sprites.push(sprite);
      drift.push(new Vector3(Math.cos(angle) * (0.9 + Math.random() * 0.6), 0.35 + Math.random() * 0.5, Math.sin(angle) * (0.9 + Math.random() * 0.6)));
    }
    this.puffs.push({ sprites, age: 0, drift });
  }

  update(delta: number): void {
    this.puffs = this.puffs.filter((puff) => {
      puff.age += delta;
      const t = puff.age / DustPuff.LIFE;
      for (const [i, sprite] of puff.sprites.entries()) {
        const slow = Math.exp(-puff.age * 3);
        sprite.position.addScaledVector(puff.drift[i], delta * slow);
        sprite.scale.setScalar(0.2 + 0.55 * Math.sqrt(Math.min(t, 1)));
        (sprite.material as SpriteMaterial).opacity = Math.max(0, 1 - t) ** 1.5;
      }
      if (t < 1) return true;
      for (const sprite of puff.sprites) {
        this.root.remove(sprite);
        (sprite.material as SpriteMaterial).dispose();
      }
      return false;
    });
  }

  dispose(): void {
    for (const puff of this.puffs) for (const sprite of puff.sprites) (sprite.material as SpriteMaterial).dispose();
    this.puffs = [];
    this.material.map?.dispose();
    this.material.dispose();
    this.root.removeFromParent();
  }
}
