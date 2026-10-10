import { Color, DynamicDrawUsage, IcosahedronGeometry, InstancedMesh, Matrix4, MeshStandardMaterial, Object3D, Quaternion, Vector3 } from 'three';

/** Most drops alive at once (both bottles), and how many a burst and a second of spraying make per bottle. */
const MAX_DROPS = 360;
export const SPRAY = { burst: 70, rate: 220, speed: [3.2, 6.2], spread: 0.32, life: [0.35, 0.8], size: [0.025, 0.06], gravity: 9.8, drag: 1.6 } as const;
const FOAM = new Color(0xf3e6cf);
const COLA = new Color(0x5a2a12);

type Drop = { position: Vector3; velocity: Vector3; age: number; life: number; size: number; foam: boolean };
type Cap = { object: Object3D; velocity: Vector3; spin: Vector3; resting: boolean };

/**
 * The nitro's soda: foam and cola bursting backwards out of the bottles' mouths while it pushes (a big burst when it
 * lights, a steady jet after), as one instanced mesh of small drops that fly, fall and fade out; and the bottle caps
 * that pop off the first time, fly and settle on the ground until the reset.
 */
export class SodaSpray {
  readonly mesh: InstancedMesh;
  private readonly drops: Drop[] = [];
  private readonly caps: Cap[] = [];
  private readonly matrix = new Matrix4();
  private readonly hidden = new Matrix4().makeScale(0, 0, 0);
  private carry = 0;
  /** Fewer drops in low quality or with reduced motion. */
  density = 1;

  constructor() {
    const material = new MeshStandardMaterial({ roughness: 0.35, metalness: 0, transparent: true, opacity: 0.92 });
    this.mesh = new InstancedMesh(new IcosahedronGeometry(1, 1), material, MAX_DROPS);
    this.mesh.name = 'SodaSpray';
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    for (let i = 0; i < MAX_DROPS; i++) this.mesh.setColorAt(i, FOAM);
  }

  get alive(): number {
    return this.drops.length;
  }

  /**
   * Spray from these mouths (world positions) backwards along `back`, carried by the chair's velocity: `burst` adds the
   * big first gush. Call every frame the nitro is on.
   */
  emit(mouths: readonly Vector3[], back: Vector3, carried: Vector3, delta: number, burst: boolean): void {
    this.carry += SPRAY.rate * this.density * delta;
    const count = Math.floor(this.carry) + (burst ? Math.round(SPRAY.burst * this.density) : 0);
    this.carry -= Math.floor(this.carry);
    for (const mouth of mouths) {
      for (let i = 0; i < count && this.drops.length < MAX_DROPS; i++) {
        const spread = SPRAY.spread * (burst && i < SPRAY.burst ? 1.8 : 1);
        const direction = back.clone().add(new Vector3((Math.random() - 0.5) * spread, 0.18 + (Math.random() - 0.3) * spread, (Math.random() - 0.5) * spread)).normalize();
        const speed = SPRAY.speed[0] + Math.random() * (SPRAY.speed[1] - SPRAY.speed[0]) * (burst ? 1.25 : 1);
        this.drops.push({
          position: mouth.clone().addScaledVector(direction, Math.random() * 0.05),
          velocity: direction.multiplyScalar(speed).add(carried),
          age: 0,
          life: SPRAY.life[0] + Math.random() * (SPRAY.life[1] - SPRAY.life[0]),
          size: SPRAY.size[0] + Math.random() * (SPRAY.size[1] - SPRAY.size[0]),
          foam: Math.random() < 0.7,
        });
      }
    }
  }

  /** A bottle cap shoots off backwards and up, spinning, then lies where it lands. */
  launchCap(object: Object3D, back: Vector3, carried: Vector3): void {
    const position = object.getWorldPosition(new Vector3());
    const quaternion = object.getWorldQuaternion(new Quaternion());
    const scene = object.parent;
    let root = scene;
    while (root?.parent) root = root.parent;
    if (!root) return;
    root.add(object);
    object.position.copy(position);
    object.quaternion.copy(quaternion);
    const velocity = back.clone().multiplyScalar(5 + Math.random() * 2).add(new Vector3(0, 3.5 + Math.random(), 0)).add(carried);
    this.caps.push({ object, velocity, spin: new Vector3(Math.random() * 20, Math.random() * 20, Math.random() * 20), resting: false });
  }

  /** Move the drops and caps; `ground` is the height of the ground. */
  update(delta: number, ground: number): void {
    let n = 0;
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const drop = this.drops[i];
      drop.age += delta;
      drop.velocity.y -= SPRAY.gravity * delta;
      drop.velocity.multiplyScalar(Math.exp(-SPRAY.drag * delta));
      drop.position.addScaledVector(drop.velocity, delta);
      if (drop.age > drop.life || drop.position.y < ground) this.drops.splice(i, 1);
    }
    for (const drop of this.drops) {
      const t = drop.age / drop.life;
      // Foam swells as it leaves the bottle and shrinks away at the end.
      const scale = drop.size * (drop.foam ? 0.6 + t * 1.4 : 1) * Math.min(1, (1 - t) * 4);
      this.matrix.makeScale(scale, scale, scale).setPosition(drop.position);
      this.mesh.setMatrixAt(n, this.matrix);
      this.mesh.setColorAt(n, drop.foam ? FOAM : COLA);
      n++;
    }
    for (let i = n; i < this.mesh.count; i++) this.mesh.setMatrixAt(i, this.hidden);
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    for (const cap of this.caps) {
      if (cap.resting) continue;
      cap.velocity.y -= SPRAY.gravity * delta;
      cap.object.position.addScaledVector(cap.velocity, delta);
      cap.object.rotation.x += cap.spin.x * delta;
      cap.object.rotation.y += cap.spin.y * delta;
      cap.object.rotation.z += cap.spin.z * delta;
      if (cap.object.position.y <= ground + 0.01) {
        cap.object.position.y = ground + 0.01;
        // A little bounce, then it lies on its side.
        if (Math.abs(cap.velocity.y) > 1.2) {
          cap.velocity.set(cap.velocity.x * 0.5, -cap.velocity.y * 0.35, cap.velocity.z * 0.5);
          cap.spin.multiplyScalar(0.5);
        } else {
          cap.resting = true;
          cap.object.rotation.set(Math.PI / 2, cap.object.rotation.y, 0);
        }
      }
    }
  }

  /** Drop every drop and give the caps back to their bottles (at their old place, in their old parent). */
  reset(restore: (object: Object3D) => void): void {
    this.drops.length = 0;
    this.mesh.count = 0;
    for (const cap of this.caps) restore(cap.object);
    this.caps.length = 0;
  }

}
