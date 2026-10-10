import { BufferAttribute, BufferGeometry, CanvasTexture, Group, Mesh, MeshStandardMaterial, SRGBColorSpace, DoubleSide, type Material, type Object3D, type WebGLProgramParametersWithUniforms } from 'three';
import { t } from '../core/i18n.ts';
import { FONT } from './canvasText.ts';
import type { Plaque } from './outsideData.ts';

/** Canvas pixels per metre of plaque. */
const PPM = 640;
const ATLAS_WIDTH = 512;
const PAD = 4;

type Rect = { x: number; y: number; w: number; h: number };

function plaqueRects(plaques: readonly Plaque[]): { rects: Rect[]; height: number } {
  const rects: Rect[] = [];
  let y = 0;
  for (const plaque of plaques) {
    const w = Math.min(ATLAS_WIDTH, Math.ceil(plaque.size[0] * PPM));
    const h = Math.ceil(plaque.size[1] * PPM);
    rects.push({ x: 0, y, w, h });
    y += h + PAD;
  }
  return { rects, height: Math.max(1, y) };
}

/**
 * The about-me plaza's painted parts: the plaques (the bust's name, role and country, the Colombian corner's country) as
 * one mesh over one canvas atlas facing the front, repainted on a language change; and the Colombian flag waving.
 */
export class AboutPlaza {
  readonly root = new Group();
  private readonly plaques: readonly Plaque[];
  private readonly rects: Rect[];
  private readonly canvas = document.createElement('canvas');
  private readonly texture: CanvasTexture;
  private readonly materials: MeshStandardMaterial[] = [];
  private readonly geometries: BufferGeometry[] = [];
  private readonly textures: CanvasTexture[] = [];

  /** The flag's waving clock (seconds), shared with its shader. */
  private readonly wave = { value: 0 };

  constructor(plaques: readonly Plaque[]) {
    this.root.name = 'AboutPlaza';
    this.plaques = plaques;
    const { rects, height } = plaqueRects(plaques);
    this.rects = rects;
    this.canvas.width = ATLAS_WIDTH;
    this.canvas.height = height;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.textures.push(this.texture);
    if (plaques.length) this.root.add(this.plaqueMesh());
    this.paint();
  }

  private plaqueMesh(): Mesh {
    const position: number[] = [];
    const uv: number[] = [];
    const index: number[] = [];
    for (const [i, plaque] of this.plaques.entries()) {
      const [w, h] = plaque.size;
      const ax = { x: Math.cos(plaque.yaw), z: -Math.sin(plaque.yaw) };
      const az = { x: Math.sin(plaque.yaw), z: Math.cos(plaque.yaw) };
      const { x, y, z } = plaque.position;
      // A hair in front of the surface it is fixed to.
      const cx = x + az.x * 0.004;
      const cz = z + az.z * 0.004;
      for (const [lx, ly] of [[-w / 2, h / 2], [w / 2, h / 2], [-w / 2, -h / 2], [w / 2, -h / 2]]) {
        position.push(cx + ax.x * lx, y + ly, cz + ax.z * lx);
      }
      const rect = this.rects[i];
      const u0 = rect.x / ATLAS_WIDTH;
      const u1 = (rect.x + rect.w) / ATLAS_WIDTH;
      const v0 = 1 - rect.y / this.canvas.height;
      const v1 = 1 - (rect.y + rect.h) / this.canvas.height;
      uv.push(u0, v0, u1, v0, u0, v1, u1, v1);
      const base = i * 4;
      index.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
    geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    const material = new MeshStandardMaterial({ map: this.texture, roughness: 0.55, metalness: 0.1 });
    this.geometries.push(geometry);
    this.materials.push(material);
    const mesh = new Mesh(geometry, material);
    mesh.name = 'Plaques';
    return mesh;
  }

  /**
   * Wave the flag's cloth: its vertices swing across it (local Z) in a travelling wave that grows from the pole (local
   * x 0) to the free edge (the cloth hangs towards -X). The cloth comes out of the merged scene in world space.
   */
  waveFlag(cloth: Object3D): void {
    const wave = this.wave;
    const materials = new Set<Material>();
    cloth.traverse((object) => {
      if (object instanceof Mesh) for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    });
    for (const material of materials) {
      // A cloth is seen from both sides.
      material.side = DoubleSide;
      material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
        shader.uniforms.flagTime = wave;
        shader.vertexShader = `uniform float flagTime;\n${shader.vertexShader}`.replace('#include <begin_vertex>', `#include <begin_vertex>
          float reach = -position.x;
          transformed.z += sin(reach * 6.0 - flagTime * 4.2) * 0.07 * reach + sin(position.y * 5.0 + flagTime * 2.3) * 0.015 * reach;`);
      };
      material.needsUpdate = true;
    }
    this.root.add(cloth);
  }

  /** Advance the flag's wave (held still with reduced motion). */
  update(delta: number, still: boolean): void {
    if (!still) this.wave.value += delta;
  }

  /** Repaint the plaques in the current language. */
  paint(): void {
    const context = this.canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (const [i, plaque] of this.plaques.entries()) {
      const rect = this.rects[i];
      context.save();
      context.translate(rect.x, rect.y);
      this.drawPlaque(context, plaque.id, rect.w, rect.h);
      context.restore();
    }
    this.texture.needsUpdate = true;
  }

  private drawPlaque(context: CanvasRenderingContext2D, id: string, w: number, h: number): void {
    const line = (words: string, y: number, size: number, weight: number, color: string) => {
      context.font = `${weight} ${size}px ${FONT}`;
      const natural = context.measureText(words).width;
      if (natural > w * 0.88) context.font = `${weight} ${Math.floor(size * w * 0.88 / natural)}px ${FONT}`;
      context.fillStyle = color;
      context.fillText(words, w / 2, y);
    };
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    // A brass plate with dark engraved letters.
    const gradient = context.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, '#d9b871');
    gradient.addColorStop(1, '#a9843e');
    context.fillStyle = gradient;
    context.beginPath();
    context.roundRect(0, 0, w, h, 14);
    context.fill();
    context.strokeStyle = '#7d5f27';
    context.lineWidth = 4;
    context.beginPath();
    context.roundRect(8, 8, w - 16, h - 16, 10);
    context.stroke();
    if (id === 'bust') {
      line(t('about.name'), h * 0.3, 52, 700, '#2c2112');
      line(t('about.role'), h * 0.56, 34, 600, '#3b2d18');
      line(t('about.country'), h * 0.78, 30, 500, '#3b2d18');
    } else {
      line(t('about.country').toUpperCase(), h / 2, 46, 700, '#2c2112');
    }
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    for (const texture of this.textures) texture.dispose();
    this.root.removeFromParent();
  }
}
