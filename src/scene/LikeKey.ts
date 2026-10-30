import {
  BufferAttribute, BufferGeometry, CanvasTexture, Color, DoubleSide, ExtrudeGeometry, Group, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, SRGBColorSpace, Shape,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { t } from '../core/i18n.ts';
import { formatLikes } from '../core/likes.ts';
import type { FloorKey } from '../world/keyPress.ts';
import { FONT } from './canvasText.ts';

/** The like key: cap width and height (m), like the intro's arrow keys but larger. */
export const LIKE_KEY = { size: 0.9, height: 0.3 };
/**
 * What is painted round the key on the ground (m): the words behind it (above it on screen), the count in front of
 * it (below), `gap` clear of the cap in front and `wordsGap` behind (the cap stands up into the words on screen); one
 * canvas at `ppm` pixels per metre.
 */
const PANEL = { width: 3.6, words: 1.8, count: 0.95, gap: 0.15, wordsGap: 0.65, ppm: 200 };
/** Words: letter size and line step (m). */
const WORDS = { size: 0.46, step: 0.56 };
/** A heart rising off the key when a like counts: seconds, and how high it goes (m). */
const BURST = { time: 1.1, rise: 1.4 };
const VIOLET = new Color(0xb79bff);
const HEART_IDLE = new Color().setRGB(0.36, 0.24, 0.58);
const HEART_LIKED = new Color(0xff3d7f);

/** A heart outline in a unit box (x −0.5…0.5, y −0.5…0.5, point down), as canvas-like path steps. */
function heartPath(path: { moveTo(x: number, y: number): void; bezierCurveTo(a: number, b: number, c: number, d: number, x: number, y: number): void }, size: number, cx = 0, cy = 0, flip = 1): void {
  const p = (x: number, y: number): [number, number] => [cx + x * size, cy + y * size * flip];
  path.moveTo(...p(0, -0.5));
  path.bezierCurveTo(...p(-0.12, -0.38), ...p(-0.5, -0.12), ...p(-0.5, 0.14));
  path.bezierCurveTo(...p(-0.5, 0.38), ...p(-0.3, 0.5), ...p(-0.25, 0.5));
  path.bezierCurveTo(...p(-0.12, 0.5), ...p(-0.02, 0.42), ...p(0, 0.3));
  path.bezierCurveTo(...p(0.02, 0.42), ...p(0.12, 0.5), ...p(0.25, 0.5));
  path.bezierCurveTo(...p(0.3, 0.5), ...p(0.5, 0.38), ...p(0.5, 0.14));
  path.bezierCurveTo(...p(0.5, -0.12), ...p(0.12, -0.38), ...p(0, -0.5));
}

function heartGeometry(size: number, depth: number): ExtrudeGeometry {
  const shape = new Shape();
  heartPath(shape, size);
  const geometry = new ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 10 });
  // Lying on the cap, pointing at the panel (+Z) so it reads upright from the default view.
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

/**
 * The like key on the ground (room page only): a large keycap with a heart that sinks when stepped on, like the
 * intro's arrow keys, with its words painted on the ground behind it and the shared count in front. The heart lights up while this
 * visitor's like holds, and a heart rises off the key when a like counts.
 */
export class LikeKey {
  readonly root = new Group();
  /** The cap's footprint, for onKey. */
  readonly area: FloorKey;
  private readonly cap = new Group();
  private readonly heart: MeshStandardMaterial;
  private readonly floating: Mesh<ExtrudeGeometry, MeshBasicMaterial>;
  private readonly canvas = document.createElement('canvas');
  private readonly texture: CanvasTexture;
  private readonly panel: Mesh<BufferGeometry, MeshBasicMaterial>;
  private burstTime = Infinity;
  private likes: number | undefined;
  private liked = false;
  private readonly groundY: number;

  constructor(at: { x: number; z: number }, groundY: number) {
    this.groundY = groundY;
    this.root.name = 'LikeKey';
    this.area = { center: { ...at }, yaw: 0, halfX: LIKE_KEY.size / 2, halfZ: LIKE_KEY.size / 2 };
    const { size, height } = LIKE_KEY;
    const body = new Mesh(new RoundedBoxGeometry(size, height, size, 3, 0.06), new MeshStandardMaterial({ color: new Color().setRGB(0.86, 0.83, 0.94), roughness: 0.45 }));
    body.position.y = height / 2;
    this.heart = new MeshStandardMaterial({ color: HEART_IDLE, roughness: 0.5, emissive: HEART_LIKED, emissiveIntensity: 0 });
    const heart = new Mesh(heartGeometry(size * 0.56, 0.025), this.heart);
    heart.position.y = height - 0.004;
    this.cap.add(body, heart);
    this.cap.position.set(at.x, groundY, at.z);
    this.floating = new Mesh(heartGeometry(size * 0.4, 0.04), new MeshBasicMaterial({ color: HEART_LIKED, transparent: true, depthWrite: false }));
    // Upright, standing in its own XY plane.
    this.floating.geometry.rotateX(Math.PI / 2);
    this.floating.geometry.center();
    this.floating.visible = false;
    this.floating.position.set(at.x, groundY + height, at.z);

    // The words and the count, flat on the ground like the floor's other words: one quad round the key, clear under it.
    const depth = PANEL.words + PANEL.wordsGap + size + PANEL.gap + PANEL.count;
    this.canvas.width = Math.round(PANEL.width * PANEL.ppm);
    this.canvas.height = Math.round(depth * PANEL.ppm);
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.anisotropy = 8;
    const y = groundY + 0.006;
    const z0 = at.z - size / 2 - PANEL.wordsGap - PANEL.words;
    const x0 = at.x - PANEL.width / 2;
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array([
      x0, y, z0, x0 + PANEL.width, y, z0, x0, y, z0 + depth, x0 + PANEL.width, y, z0 + depth,
    ]), 3));
    geometry.setAttribute('uv', new BufferAttribute(new Float32Array([0, 1, 1, 1, 0, 0, 1, 0]), 2));
    geometry.setIndex([0, 2, 1, 1, 2, 3]);
    geometry.computeVertexNormals();
    this.panel = new Mesh(geometry, new MeshBasicMaterial({ map: this.texture, color: VIOLET, transparent: true, opacity: 0.6, depthWrite: false, side: DoubleSide }));
    this.panel.renderOrder = -4;
    this.panel.name = 'LikeCount';
    this.root.add(this.cap, this.floating, this.panel);
    this.paint();
  }

  /** The shared count and whether this visitor's like holds. */
  setCount(likes: number | undefined, liked: boolean): void {
    if (likes === this.likes && liked === this.liked) return;
    this.likes = likes;
    this.liked = liked;
    this.heart.color.copy(liked ? HEART_LIKED : HEART_IDLE);
    this.heart.emissiveIntensity = liked ? 0.6 : 0;
    this.paint();
  }

  /** How far the cap is pressed down (m). */
  setSink(sink: number): void {
    this.cap.position.y = this.groundY - sink;
  }

  /** A like counted: a heart rises off the key, turning, and fades (not with reduced motion). */
  burst(reducedMotion: boolean): void {
    if (!reducedMotion) this.burstTime = 0;
  }

  update(delta: number): void {
    if (this.burstTime >= BURST.time) {
      this.floating.visible = false;
      return;
    }
    this.burstTime += delta;
    const f = Math.min(this.burstTime / BURST.time, 1);
    this.floating.visible = f < 1;
    this.floating.scale.setScalar(0.6 + 0.6 * Math.sin(Math.min(f * 3, 1) * Math.PI / 2));
    this.floating.material.opacity = 1 - f * f;
    this.floating.rotation.y = f * Math.PI * 2;
    this.floating.position.y = this.groundY + LIKE_KEY.height + 0.35 + BURST.rise * (1 - (1 - f) * (1 - f));
  }

  /** Paints the words (over the key on screen) and the count (under it) in the current language. */
  paint(): void {
    const context = this.canvas.getContext('2d');
    if (!context) return;
    const { width, height } = this.canvas;
    const ppm = PANEL.ppm;
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#ffffff';
    context.textBaseline = 'middle';
    context.textAlign = 'center';
    // The words a few to a line, the last one nearest the key.
    const lines = t(this.liked ? 'like.thanks' : 'like.prompt').split('\n');
    const size = Math.round(WORDS.size * ppm);
    const last = (PANEL.words - WORDS.step / 2) * ppm;
    for (const [index, line] of lines.entries()) {
      context.font = `600 ${size}px ${FONT}`;
      // A line too long for the panel shrinks to fit.
      const fit = Math.min(1, (width * 0.96) / context.measureText(line).width);
      context.font = `600 ${Math.floor(size * fit)}px ${FONT}`;
      context.fillText(line, width / 2, last - (lines.length - 1 - index) * WORDS.step * ppm);
    }
    // The count with its heart, under the key.
    const big = Math.round(PANEL.count * 0.8 * ppm);
    context.font = `700 ${big}px ${FONT}`;
    context.textAlign = 'left';
    const count = formatLikes(this.likes);
    const heart = big * 0.82;
    const gap = big * 0.22;
    const total = heart + gap + context.measureText(count).width;
    const left = (width - total) / 2;
    const middle = height - PANEL.count / 2 * ppm;
    context.beginPath();
    heartPath(context, heart, left + heart / 2, middle, -1);
    context.fill();
    context.fillText(count, left + heart + gap, middle + big * 0.04);
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.root.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      object.geometry.dispose();
      (object.material as MeshStandardMaterial).dispose();
    });
    this.texture.dispose();
  }
}
