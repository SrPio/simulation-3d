import {
  CanvasTexture, DoubleSide, InstancedBufferAttribute, InstancedMesh, Matrix4, PlaneGeometry, SRGBColorSpace, ShaderMaterial,
} from 'three';
import { SNOW, SOLE } from '../world/snowPrints.ts';

/** How many sole prints show at once (the oldest is reused): enough for SNOW.fade seconds of running. */
export const PRINTS = { max: 160 } as const;

/** Canvas pixels per metre of sole. */
const PPM = 480;

const vertexShader = /* glsl */ `
attribute float aBorn;
uniform float uTime;
uniform float uFade;
varying vec2 vUv;
varying float vLeft;
void main() {
  vUv = uv;
  // Fresh 1, gone 0 after uFade seconds; a slot never used has aBorn far in the past.
  vLeft = clamp(1.0 - (uTime - aBorn) / uFade, 0.0, 1.0);
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;

const fragmentShader = /* glsl */ `
uniform sampler2D map;
varying vec2 vUv;
varying float vLeft;
void main() {
  vec4 colour = texture2D(map, vUv);
  // Fading, the print fills back in with snow from its shallow parts first.
  float alpha = colour.a * smoothstep(0.0, 0.35, vLeft) * (0.55 + 0.45 * vLeft);
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(colour.rgb, alpha);
  #include <colorspace_fragment>
}`;

/** The bare ground under the snow, as the floor shows it in the Christmas dress-up (InfiniteFloor.setSnow). */
const GROUND = '#262c3f';

/** The right sneaker's sole as a hole pressed into the snow, toe up. */
function soleTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  const pad = 10;
  canvas.width = Math.ceil(SOLE.width * PPM) + pad * 2;
  canvas.height = Math.ceil(SOLE.length * PPM) + pad * 2;
  const ctx = canvas.getContext('2d')!;
  const w = SOLE.width * PPM;
  const l = SOLE.length * PPM;
  const heel = SOLE.heel * PPM;
  const r = SOLE.corner * PPM;
  // The outline: the ball of the foot full width, narrowing to the heel, every corner rounded; y grows towards the heel.
  const cx = canvas.width / 2;
  const top = pad;
  const bottom = pad + l;
  const outline = new Path2D();
  const at = (t: number) => {
    // Half width t of the way from toe (0) to heel (1).
    const k = Math.min(1, Math.max(0, (t - 0.55) / 0.4));
    return (w + (heel - w) * k * k * (3 - 2 * k)) / 2;
  };
  outline.moveTo(cx, top);
  outline.bezierCurveTo(cx + at(0) * 0.7, top, cx + at(0), top + r * 0.4, cx + at(0.12), top + l * 0.12);
  for (let t = 0.16; t <= 0.9; t += 0.04) outline.lineTo(cx + at(t), top + l * t);
  outline.bezierCurveTo(cx + at(1), bottom - r * 0.4, cx + at(1) * 0.7, bottom, cx, bottom);
  outline.bezierCurveTo(cx - at(1) * 0.7, bottom, cx - at(1), bottom - r * 0.4, cx - at(0.9), top + l * 0.9);
  for (let t = 0.86; t >= 0.12; t -= 0.04) outline.lineTo(cx - at(t), top + l * t);
  outline.bezierCurveTo(cx - at(0), top + r * 0.4, cx - at(0) * 0.7, top, cx, top);
  outline.closePath();
  // A hole in the snow down to the ground: the bare ground's own colour (InfiniteFloor's snowy-night ground), its edge a
  // little soft like crumbled snow.
  ctx.filter = 'blur(2px)';
  ctx.fillStyle = GROUND;
  ctx.fill(outline);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/**
 * Christmas: the sneaker's sole printed in the snow at every step, crisp at any zoom: one instanced quad per print,
 * lying just over the ground, turned like the foot (left prints mirrored), fading out over SNOW.fade seconds. The
 * texture is the outline of the character's own sole (SOLE) in the bare ground's colour: a hole in the snow.
 */
export class SnowPrints {
  readonly mesh: InstancedMesh<PlaneGeometry, ShaderMaterial>;
  private readonly born: InstancedBufferAttribute;
  private readonly groundY: number;
  private next = 0;
  private clock = 0;
  private readonly matrix = new Matrix4();
  private readonly turn = new Matrix4();
  private readonly mirror = new Matrix4();

  constructor(groundY: number) {
    this.groundY = groundY;
    // Flat on the ground, the texture's top (the toe) along +Z before the print is turned.
    const geometry = new PlaneGeometry(SOLE.width + 20 / PPM, SOLE.length + 20 / PPM).rotateX(Math.PI / 2);
    this.born = new InstancedBufferAttribute(new Float32Array(PRINTS.max).fill(-1e6), 1);
    geometry.setAttribute('aBorn', this.born);
    const material = new ShaderMaterial({
      vertexShader, fragmentShader, transparent: true, depthWrite: false, side: DoubleSide,
      uniforms: { map: { value: soleTexture() }, uTime: { value: 0 }, uFade: { value: SNOW.fade } },
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.mesh = new InstancedMesh(geometry, material, PRINTS.max);
    this.mesh.name = 'SnowPrints';
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -3;
  }

  /** A print of the left or right sole with its middle at (x, z), the toe towards `heading` (0 faces +Z). */
  add(x: number, z: number, heading: number, left: boolean): void {
    const index = this.next;
    this.next = (this.next + 1) % PRINTS.max;
    this.mesh.count = Math.max(this.mesh.count, index + 1);
    this.matrix.makeTranslation(x, this.groundY + 0.004, z).multiply(this.turn.makeRotationY(heading));
    // The texture is a right sole; a left one is its mirror image.
    if (left) this.matrix.multiply(this.mirror.makeScale(-1, 1, 1));
    this.mesh.setMatrixAt(index, this.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.born.setX(index, this.clock);
    this.born.needsUpdate = true;
  }

  /** Time moves on: the prints fade (a little slower with reduced motion). */
  update(delta: number, reducedMotion: boolean): void {
    this.clock += delta * (reducedMotion ? 0.7 : 1);
    this.mesh.material.uniforms.uTime.value = this.clock;
  }

  /** Restablecer: no prints left. */
  clear(): void {
    this.born.array.fill(-1e6);
    this.born.needsUpdate = true;
    this.mesh.count = 0;
    this.next = 0;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.uniforms.map.value.dispose();
    this.mesh.material.dispose();
  }
}
