import {
  BufferAttribute, BufferGeometry, CanvasTexture, Color, Group, Mesh, MeshStandardMaterial, SRGBColorSpace, type Object3D,
} from 'three';
import { t } from '../core/i18n.ts';
import { ROUND_THROWS } from '../world/targets.ts';
import { FONT } from './canvasText.ts';
import type { Scoreboard, Target } from './outsideData.ts';

/** Swing after a hit: how far back the target tips (radians), how fast it rocks and how quickly it settles. */
const SWING = { angle: 0.32, rate: 11, damping: 3.2 };
/** Seconds the hit ring keeps glowing. */
const GLOW_TIME = 0.9;
const BOARD_PPM = 300;

type State = { object: Object3D; swing: number; glow: number; ring: number; rings: MeshStandardMaterial[]; base: { color: Color; intensity: number }[] };

/**
 * The standing targets (moved out of the static outside scene so they can rock) and the scoreboard beside them. A hit
 * tips the target back on its foot and makes the ring it hit glow; the board shows the round's points and throws.
 */
export class TargetsView {
  readonly root = new Group();
  private readonly states: State[] = [];
  private readonly canvas = document.createElement('canvas');
  private readonly texture: CanvasTexture;
  private readonly board?: Mesh<BufferGeometry, MeshStandardMaterial>;
  private score = 0;
  private throws = 0;

  constructor(targets: readonly Target[], scoreboard: Scoreboard | undefined) {
    this.root.name = 'Targets';
    for (const target of targets) {
      // Each ring gets its own material so only the struck one lights up.
      const rings: MeshStandardMaterial[] = [];
      target.object.traverse((child) => {
        const match = /_Ring(\d)$/.exec(child.name) ?? /_Ring(\d)$/.exec(child.parent?.name ?? '');
        if (!(child instanceof Mesh) || !match) return;
        const material = (child.material as MeshStandardMaterial).clone();
        child.material = material;
        rings[Number(match[1])] = material;
      });
      this.states.push({ object: target.object, swing: Infinity, glow: 0, ring: -1, rings, base: rings.map((ring) => ({ color: ring.emissive.clone(), intensity: ring.emissiveIntensity })) });
    }
    this.canvas.width = scoreboard ? Math.ceil(scoreboard.width * BOARD_PPM) : 1;
    this.canvas.height = scoreboard ? Math.ceil(scoreboard.height * BOARD_PPM) : 1;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.anisotropy = 4;
    if (scoreboard) {
      const { position, yaw, width, height, bottom } = scoreboard;
      const ax = { x: Math.cos(yaw), z: -Math.sin(yaw) };
      const az = { x: Math.sin(yaw), z: Math.cos(yaw) };
      const cx = position.x + az.x * 0.036;
      const cz = position.z + az.z * 0.036;
      const y = position.y + bottom + height / 2;
      const w = width - 0.06;
      const h = height - 0.06;
      const vertices: number[] = [];
      for (const [lx, ly] of [[-w / 2, h / 2], [w / 2, h / 2], [-w / 2, -h / 2], [w / 2, -h / 2]]) vertices.push(cx + ax.x * lx, y + ly, cz + ax.z * lx);
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(new Float32Array(vertices), 3));
      geometry.setAttribute('uv', new BufferAttribute(new Float32Array([0, 1, 1, 1, 0, 0, 1, 0]), 2));
      geometry.setIndex([0, 2, 1, 1, 2, 3]);
      geometry.computeVertexNormals();
      // It glows a little like the signs, so the score reads in any light.
      this.board = new Mesh(geometry, new MeshStandardMaterial({ map: this.texture, emissiveMap: this.texture, emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.6 }));
      this.board.name = 'Scoreboard';
      this.root.add(this.board);
    }
    this.paint();
  }

  /** Target `index` was hit on ring `ring` (0 the outer one; -1 for a hit that scored nothing). */
  hit(index: number, ring: number): void {
    const state = this.states[index];
    if (!state) return;
    state.swing = 0;
    state.glow = ring >= 0 ? GLOW_TIME : 0;
    state.ring = ring;
  }

  setScore(score: number, throws: number): void {
    if (score === this.score && throws === this.throws) return;
    this.score = score;
    this.throws = throws;
    this.paint();
  }

  update(delta: number, reducedMotion: boolean): void {
    for (const state of this.states) {
      if (state.swing !== Infinity) {
        state.swing += delta;
        const amount = Math.exp(-state.swing * SWING.damping);
        // Tips back (away from the thrower, -Z) and rocks to rest; with reduced motion it stays upright.
        state.object.rotation.x = reducedMotion ? 0 : -SWING.angle * amount * Math.sin(state.swing * SWING.rate);
        if (amount < 0.01) {
          state.swing = Infinity;
          state.object.rotation.x = 0;
        }
      }
      if (state.glow > 0 || state.ring >= 0) {
        state.glow = Math.max(0, state.glow - delta);
        for (const [index, ring] of state.rings.entries()) {
          if (!ring) continue;
          const lit = index === state.ring ? state.glow / GLOW_TIME : 0;
          const base = state.base[index];
          if (lit > 0) {
            ring.emissive.setRGB(1, 0.85, 0.5);
            ring.emissiveIntensity = lit * 1.6;
          } else {
            ring.emissive.copy(base.color);
            ring.emissiveIntensity = base.intensity;
          }
        }
        if (state.glow === 0) state.ring = -1;
      }
    }
  }

  /** The board: the round's points large, the throws used under them. */
  paint(): void {
    const context = this.canvas.getContext('2d');
    if (!context || !this.board) return;
    const { width: w, height: h } = this.canvas;
    context.fillStyle = '#16121f';
    context.fillRect(0, 0, w, h);
    context.strokeStyle = '#b79bff';
    context.lineWidth = 6;
    context.strokeRect(8, 8, w - 16, h - 16);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = '#c9bdf5';
    context.font = `600 34px ${FONT}`;
    context.fillText(t('targets.score'), w / 2, h * 0.2);
    context.fillStyle = '#ffd27a';
    context.font = `700 110px ${FONT}`;
    context.fillText(String(this.score), w / 2, h * 0.52);
    context.fillStyle = '#c9bdf5';
    context.font = `500 28px ${FONT}`;
    context.fillText(`${t('targets.throws')} ${this.throws}/${ROUND_THROWS}`, w / 2, h * 0.84);
    this.texture.needsUpdate = true;
  }

  reset(): void {
    for (const state of this.states) {
      state.swing = Infinity;
      state.object.rotation.x = 0;
      state.glow = 0;
      state.ring = 0;
    }
    this.update(0, true);
    this.setScore(0, 0);
  }

  dispose(): void {
    for (const state of this.states) for (const ring of state.rings) ring?.dispose();
    this.board?.geometry.dispose();
    this.board?.material.dispose();
    this.texture.dispose();
    this.root.removeFromParent();
  }
}
