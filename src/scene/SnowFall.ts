import { AdditiveBlending, BufferAttribute, BufferGeometry, Points, ShaderMaterial, Vector3 } from 'three';

/**
 * How many flakes fall per quality (Auto, Alta, Baja) and with reduced motion, the box round the view they fall in
 * (width, height, depth in metres) and how fast they fall (m/s).
 */
export const SNOWFALL = { count: { auto: 900, high: 1400, low: 400, reduced: 300 }, box: [40, 20, 40], fall: [0.6, 1.3], size: [0.05, 0.11] } as const;

const vertexShader = /* glsl */ `
uniform float uTime;
uniform vec3 uCentre;
uniform vec3 uBox;
uniform float uScale;
uniform float uSlow;
attribute vec4 aFlake;
varying float vAlpha;
void main() {
  // Each flake falls through the box at its own speed, drifting and swaying; the box follows the view, and wrapping
  // round it keeps the flakes where they are in the world.
  float speed = mix(${SNOWFALL.fall[0].toFixed(2)}, ${SNOWFALL.fall[1].toFixed(2)}, aFlake.w) * uSlow;
  vec3 drift = vec3(0.35 * uTime * uSlow + sin(uTime * 0.7 * uSlow + aFlake.w * 40.0) * 0.6, -uTime * speed, sin(uTime * 0.5 * uSlow + aFlake.x * 30.0) * 0.5);
  vec3 low = uCentre - uBox * 0.5;
  vec3 world = low + mod(position * uBox + drift - low, uBox);
  vec4 view = modelViewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * view;
  float size = mix(${SNOWFALL.size[0].toFixed(3)}, ${SNOWFALL.size[1].toFixed(3)}, aFlake.z);
  // Orthographic: a metre is the same number of pixels everywhere; perspective: further is smaller.
  float perspective = projectionMatrix[3][3] > 0.5 ? 1.0 : 1.0 / max(-view.z, 0.1);
  // projectionMatrix[1][1] over half the drawing buffer's height: pixels per metre (at one metre for perspective).
  gl_PointSize = max(1.5, size * projectionMatrix[1][1] * 0.5 * uScale * perspective);
  // Thinner near the box's top and bottom, so the wrap is never seen.
  float height = (world.y - low.y) / uBox.y;
  vAlpha = smoothstep(0.0, 0.12, height) * (1.0 - smoothstep(0.85, 1.0, height));
}`;

const fragmentShader = /* glsl */ `
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float alpha = (1.0 - smoothstep(0.2, 0.5, d)) * vAlpha * 0.85;
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(vec3(0.95, 0.97, 1.0), alpha);
}`;

/**
 * Christmas: snow falling over the whole view, as one set of points moved entirely in the vertex shader (no work on the
 * CPU per flake). The box of flakes follows what the camera looks at. Fewer flakes in low quality, fewer and slower
 * ones with reduced motion.
 */
export class SnowFall {
  readonly points: Points<BufferGeometry, ShaderMaterial>;

  constructor(count: number) {
    const geometry = new BufferGeometry();
    const seeds = new Float32Array(SNOWFALL.count.high * 3);
    const flakes = new Float32Array(SNOWFALL.count.high * 4);
    let seed = 12345;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < SNOWFALL.count.high; i++) {
      seeds.set([random(), random(), random()], i * 3);
      flakes.set([random(), random(), random(), random()], i * 4);
    }
    geometry.setAttribute('position', new BufferAttribute(seeds, 3));
    geometry.setAttribute('aFlake', new BufferAttribute(flakes, 4));
    const material = new ShaderMaterial({
      vertexShader, fragmentShader, transparent: true, depthWrite: false, blending: AdditiveBlending,
      uniforms: {
        uTime: { value: 0 }, uCentre: { value: new Vector3() }, uBox: { value: new Vector3(...SNOWFALL.box) },
        uScale: { value: 1 }, uSlow: { value: 1 },
      },
    });
    this.points = new Points(geometry, material);
    this.points.name = 'SnowFall';
    this.points.frustumCulled = false;
    this.points.renderOrder = 20;
    this.setCount(count);
  }

  setCount(count: number): void {
    this.points.geometry.setDrawRange(0, Math.min(count, SNOWFALL.count.high));
  }

  /** `centre` is where the camera looks; `bufferHeight` the drawing buffer's height in pixels (the flakes' size). */
  update(delta: number, centre: Vector3, bufferHeight: number, reducedMotion: boolean): void {
    const uniforms = this.points.material.uniforms;
    uniforms.uTime.value += delta;
    uniforms.uSlow.value = reducedMotion ? 0.35 : 1;
    (uniforms.uCentre.value as Vector3).set(centre.x, centre.y + SNOWFALL.box[1] * 0.25, centre.z);
    uniforms.uScale.value = bufferHeight;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.points.material.dispose();
    this.points.removeFromParent();
  }
}
