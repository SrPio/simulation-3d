import { Color, IcosahedronGeometry, InstancedMesh, Matrix4, MeshBasicMaterial, type Vector3 } from 'three';

/** Bulb colours, in turn along each string: red, warm gold, green and icy blue. */
export const BULB_COLORS = [0xff3040, 0xffc23a, 0x3dff7a, 0x5ab8ff].map((hex) => new Color(hex));
/** How often the pattern changes (s) and how dim a bulb that is off still glows (a share of its colour). */
export const BLINK = { step: 0.45, off: 0.14 } as const;

/**
 * Which bulbs are lit at `time`: the strings blink in three alternating patterns, a few seconds each, so they never
 * look in step: every other bulb (two groups taking turns), a chase running along the string, and all together slowly
 * twinkling on and off. Pure, for the tests.
 */
export function bulbOn(index: number, string: number, time: number): boolean {
  const tick = Math.floor(time / BLINK.step);
  const pattern = Math.floor((tick + string * 5) / 12) % 3;
  if (pattern === 0) return (index + tick) % 2 === 0;
  if (pattern === 1) return (((index - tick) % 4) + 4) % 4 < 2;
  return Math.sin(tick * 1.7 + index * 2.3 + string) > -0.35;
}

/**
 * Christmas: every bulb of every light string (garlands, pines, the giant tree, the lamppost, the room) as one instanced
 * mesh of small glowing balls that blink in patterns. The colours are updated a few times a second; with reduced motion
 * they stay lit.
 */
export class ChristmasLights {
  readonly mesh: InstancedMesh;
  private readonly bulbs: { string: number; index: number; color: Color }[] = [];
  private readonly color = new Color();
  private lastTick = -1;

  constructor(bulbs: readonly { position: Vector3; radius: number; string: number }[]) {
    const material = new MeshBasicMaterial({ toneMapped: false });
    this.mesh = new InstancedMesh(new IcosahedronGeometry(1, 1), material, Math.max(bulbs.length, 1));
    this.mesh.name = 'ChristmasLights';
    this.mesh.count = bulbs.length;
    const matrix = new Matrix4();
    const perString = new Map<number, number>();
    for (const [i, bulb] of bulbs.entries()) {
      const index = perString.get(bulb.string) ?? 0;
      perString.set(bulb.string, index + 1);
      matrix.makeScale(bulb.radius, bulb.radius * 1.3, bulb.radius).setPosition(bulb.position);
      this.mesh.setMatrixAt(i, matrix);
      const color = BULB_COLORS[index % BULB_COLORS.length];
      this.bulbs.push({ string: bulb.string, index, color });
      this.mesh.setColorAt(i, color);
    }
    this.mesh.computeBoundingSphere();
  }

  get count(): number {
    return this.bulbs.length;
  }

  update(time: number, reducedMotion: boolean): void {
    const tick = reducedMotion ? 0 : Math.floor(time / BLINK.step);
    if (tick === this.lastTick) return;
    this.lastTick = tick;
    for (const [i, bulb] of this.bulbs.entries()) {
      const on = reducedMotion || bulbOn(bulb.index, bulb.string, time);
      this.color.copy(bulb.color).multiplyScalar(on ? 1.6 : BLINK.off);
      this.mesh.setColorAt(i, this.color);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicMaterial).dispose();
    this.mesh.removeFromParent();
  }
}
