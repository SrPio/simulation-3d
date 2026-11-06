import {
  CanvasTexture, Color, CustomBlending, InstancedBufferAttribute, InstancedBufferGeometry, LinearFilter, MaxEquation, Mesh, OneFactor, OrthographicCamera,
  PlaneGeometry, RedFormat, ReverseSubtractEquation, Scene, ShaderMaterial, UnsignedByteType, Vector2, WebGLRenderTarget, type Texture,
  type WebGLRenderer,
} from 'three';
import type { Bounds, Point2 } from '../world/collisions.ts';
import { SNOW, fadeStep } from '../world/snowPrints.ts';

/** What is pressed into the snow here: a round spot or a straight stroke (the sleigh's runners). The shoe prints are SnowPrints. */
export type StampKind = 'spot' | 'stroke';
const KIND: Record<StampKind, number> = { spot: 0, stroke: 1 };
/** Stamps drawn in one go; more wait for the next frame. */
const BATCH = 96;

const stampVertex = /* glsl */ `
attribute vec4 aStamp;   // x, z, heading, kind
attribute vec2 aSize;    // across, along (metres)
uniform vec2 uMapMin;
uniform vec2 uMapSize;
varying vec2 vLocal;
varying vec2 vUnit;
varying float vKind;
void main() {
  vLocal = position.xy * aSize;
  vUnit = position.xy * 2.0;
  vKind = aStamp.w;
  float s = sin(aStamp.z);
  float c = cos(aStamp.z);
  // Across is the heading's right (cos, -sin), along its forward (sin, cos), on the ground.
  vec2 world = aStamp.xy + vec2(c, -s) * vLocal.x + vec2(s, c) * vLocal.y;
  gl_Position = vec4((world - uMapMin) / uMapSize * 2.0 - 1.0, 0.0, 1.0);
}`;

const stampFragment = /* glsl */ `
varying vec2 vLocal;
varying vec2 vUnit;
varying float vKind;
void main() {
  float value;
  if (vKind < 0.5) {
    value = 1.0 - smoothstep(0.55, 1.0, length(vUnit));
  } else {
    value = 1.0 - smoothstep(0.5, 1.0, abs(vUnit.x));
  }
  if (value <= 0.0) discard;
  gl_FragColor = vec4(value, 0.0, 0.0, 1.0);
}`;

const fadeVertex = /* glsl */ `
void main() { gl_Position = vec4(position.xy * 2.0, 0.0, 1.0); }`;
const fadeFragment = /* glsl */ `
uniform float uStep;
void main() { gl_FragColor = vec4(uStep, 0.0, 0.0, 1.0); }`;

/**
 * Christmas: what is pressed into the snow on the ground. A texture over the whole map (SNOW.texels per metre, one
 * channel) holds how deep the snow is pushed away at each point: the sleigh's runners. Stamps are drawn into it on the GPU (keeping the deeper of old and new), and every SNOW.tick
 * seconds the whole texture is lowered a little, so every print fades out evenly over SNOW.fade seconds and the snow is
 * whole again. A second, fixed texture holds the bare ground: the circuit's road, never snowed on. The ground shader
 * (InfiniteFloor.setSnow) reads both.
 */
export class SnowGround {
  readonly trail: WebGLRenderTarget;
  readonly road: CanvasTexture;
  readonly min: Vector2;
  readonly size: Vector2;
  private readonly scene = new Scene();
  private readonly fadeScene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly stamps: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  private readonly stampData: InstancedBufferAttribute;
  private readonly sizeData: InstancedBufferAttribute;
  private readonly fade: Mesh<PlaneGeometry, ShaderMaterial>;
  private readonly pending: { x: number; z: number; heading: number; kind: number; across: number; along: number }[] = [];
  private clock = 0;
  private cleared = false;

  constructor(bounds: Bounds, road?: { line: readonly Point2[]; width: number }) {
    this.min = new Vector2(bounds.minX, bounds.minZ);
    this.size = new Vector2(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ);
    const width = Math.min(2048, Math.ceil(this.size.x * SNOW.texels));
    const height = Math.min(2048, Math.ceil(this.size.y * SNOW.texels));
    this.trail = new WebGLRenderTarget(width, height, { format: RedFormat, type: UnsignedByteType, depthBuffer: false, magFilter: LinearFilter, minFilter: LinearFilter });
    this.trail.texture.name = 'SnowTrail';
    const geometry = new InstancedBufferGeometry();
    const quad = new PlaneGeometry(1, 1);
    geometry.index = quad.index;
    geometry.setAttribute('position', quad.getAttribute('position'));
    this.stampData = new InstancedBufferAttribute(new Float32Array(BATCH * 4), 4);
    this.sizeData = new InstancedBufferAttribute(new Float32Array(BATCH * 2), 2);
    geometry.setAttribute('aStamp', this.stampData);
    geometry.setAttribute('aSize', this.sizeData);
    geometry.instanceCount = 0;
    const uniforms = { uMapMin: { value: this.min }, uMapSize: { value: this.size } };
    this.stamps = new Mesh(geometry, new ShaderMaterial({
      vertexShader: stampVertex, fragmentShader: stampFragment, uniforms, depthTest: false, depthWrite: false,
      blending: CustomBlending, blendEquation: MaxEquation, blendSrc: OneFactor, blendDst: OneFactor,
    }));
    this.stamps.frustumCulled = false;
    this.scene.add(this.stamps);
    this.fade = new Mesh(new PlaneGeometry(1, 1), new ShaderMaterial({
      vertexShader: fadeVertex, fragmentShader: fadeFragment, uniforms: { uStep: { value: fadeStep() } }, depthTest: false, depthWrite: false,
      blending: CustomBlending, blendEquation: ReverseSubtractEquation, blendSrc: OneFactor, blendDst: OneFactor,
    }));
    this.fade.frustumCulled = false;
    this.fadeScene.add(this.fade);
    this.road = this.paintRoad(road);
  }

  /** The bare road as a mask over the map (soft edged), painted once like the circuit band on the floor. */
  private paintRoad(road?: { line: readonly Point2[]; width: number }): CanvasTexture {
    const canvas = document.createElement('canvas');
    const ppm = 8;
    canvas.width = Math.ceil(this.size.x * ppm);
    canvas.height = Math.ceil(this.size.y * ppm);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (road && road.line.length > 1) {
      ctx.filter = 'blur(2px)';
      ctx.strokeStyle = '#fff';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = road.width * ppm;
      ctx.beginPath();
      const at = (point: Point2) => [(point.x - this.min.x) * ppm, (point.z - this.min.y) * ppm] as const;
      ctx.moveTo(...at(road.line[0]));
      for (let i = 1; i < road.line.length - 1; i++) {
        const [x, y] = at(road.line[i]);
        const [nx, ny] = at(road.line[i + 1]);
        ctx.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2);
      }
      ctx.lineTo(...at(road.line[road.line.length - 1]));
      ctx.stroke();
    }
    // Canvas rows run down the image; with flipY off, row 0 is v = 0, which is the map's minZ like the trail's.
    const texture = new CanvasTexture(canvas);
    texture.flipY = false;
    texture.name = 'SnowRoad';
    return texture;
  }

  get texture(): Texture {
    return this.trail.texture;
  }

  /** Press something into the snow at (x, z): `heading` is its yaw (0 faces +Z); `across`/`along` its size for spots and strokes. */
  stamp(kind: StampKind, x: number, z: number, heading: number, across: number, along: number): void {
    if (this.pending.length > BATCH * 4) this.pending.shift();
    this.pending.push({ x, z, heading, kind: KIND[kind], across, along });
  }

  /** Draw what was pressed this frame and fade everything a step every SNOW.tick seconds. */
  update(renderer: WebGLRenderer, delta: number, reducedMotion: boolean): void {
    this.clock += delta;
    const tick = this.clock >= SNOW.tick;
    if (!this.pending.length && !tick && this.cleared) return;
    const target = renderer.getRenderTarget();
    const autoClear = renderer.autoClear;
    renderer.setRenderTarget(this.trail);
    if (!this.cleared) {
      const color = renderer.getClearColor(new Color());
      const alpha = renderer.getClearAlpha();
      renderer.setClearColor(0x000000, 1);
      renderer.clear(true, false, false);
      renderer.setClearColor(color, alpha);
      this.cleared = true;
    }
    renderer.autoClear = false;
    if (this.pending.length) {
      const batch = this.pending.splice(0, BATCH);
      for (const [i, stamp] of batch.entries()) {
        this.stampData.setXYZW(i, stamp.x, stamp.z, stamp.heading, stamp.kind);
        this.sizeData.setXY(i, stamp.across, stamp.along);
      }
      this.stampData.needsUpdate = true;
      this.sizeData.needsUpdate = true;
      this.stamps.geometry.instanceCount = batch.length;
      renderer.render(this.scene, this.camera);
    }
    if (tick) {
      // With reduced motion the prints stay a little longer but still go.
      this.fade.material.uniforms.uStep.value = fadeStep() * (reducedMotion ? 0.7 : 1) * Math.floor(this.clock / SNOW.tick);
      this.clock %= SNOW.tick;
      renderer.render(this.fadeScene, this.camera);
    }
    renderer.setRenderTarget(target);
    renderer.autoClear = autoClear;
  }

  dispose(): void {
    this.trail.dispose();
    this.road.dispose();
    this.stamps.geometry.dispose();
    this.stamps.material.dispose();
    this.fade.geometry.dispose();
    this.fade.material.dispose();
  }
}
