import { Color, Matrix4, Mesh, PerspectiveCamera, PlaneGeometry, ShaderMaterial, Vector2, type Camera } from 'three';

const vertexShader = /* glsl */ `
uniform mat4 uInverse;
uniform mat4 uViewProjection;
uniform float uGround;
uniform float uSpread;
uniform float uHorizon;
varying vec3 vPoint;
varying vec2 vUv;
void main() {
  vUv = uv;
  // Each corner of the screen is unprojected onto the near and far planes and its view ray is cut
  // with the ground plane. With the orthographic camera the ground's depth and position are linear
  // across the screen, so interpolating these four corners is exact. A perspective camera (the recording shots)
  // can see the horizon: a corner whose ray misses the ground before the far plane takes the ground point
  // uHorizon away in the ray's direction instead, and the quad is spread past the screen edges to cover the sides.
  vec4 near = uInverse * vec4(position.xy * uSpread, -1.0, 1.0);
  vec4 far = uInverse * vec4(position.xy * uSpread, 1.0, 1.0);
  near /= near.w;
  far /= far.w;
  vec3 ray = far.xyz - near.xyz;
  float t = (uGround - near.y) / min(ray.y, -1e-6);
  if (ray.y > -1e-6 || t > 0.95) {
    vec2 flatRay = normalize(ray.xz + vec2(1e-6, 0.0));
    vPoint = vec3(near.x + flatRay.x * uHorizon, uGround, near.z + flatRay.y * uHorizon);
  } else {
    vPoint = near.xyz + ray * t;
  }
  gl_Position = uViewProjection * vec4(vPoint, 1.0);
}`;

const fragmentShader = /* glsl */ `
uniform vec2 uFocus;
uniform vec3 uBottomLeft;
uniform vec3 uBottomRight;
uniform vec3 uTopLeft;
uniform vec3 uTopRight;
uniform vec3 uDot;
varying vec3 vPoint;
varying vec2 vUv;
void main() {
  vec3 point = vPoint;
  vec3 color = mix(mix(uBottomLeft, uBottomRight, vUv.x), mix(uTopLeft, uTopRight, vUv.x), vUv.y);
  // Faint 1 m dot grid around the character, so walking reads as moving over the ground.
  vec2 cell = fract(point.xz) - 0.5;
  float distanceToDot = length(cell);
  float width = fwidth(distanceToDot);
  float dotMask = 1.0 - smoothstep(0.03 - width, 0.03 + width, distanceToDot);
  float fade = 1.0 - smoothstep(5.0, 14.0, distance(point.xz, uFocus));
  gl_FragColor = vec4(color + uDot * dotMask * fade, 1.0);
  #include <colorspace_fragment>
}`;

/**
 * Endless ground outside the room: one quad whose corners are where the screen corners' view rays
 * meet the ground plane, so it always fills the view whatever the camera does and costs a single draw
 * call with no large geometry. It has a real depth (anything below the ground stays hidden) and is
 * drawn after the opaque scene, so pixels the room already covers are skipped by the depth test.
 * The colour is a screen-space gradient with a faint dot grid on the ground.
 */
export class InfiniteFloor {
  readonly mesh: Mesh<PlaneGeometry, ShaderMaterial>;
  private readonly inverse = new Matrix4();

  constructor(groundY: number) {
    const color = (hex: number) => new Color(hex);
    const material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uInverse: { value: new Matrix4() },
        uViewProjection: { value: new Matrix4() },
        uGround: { value: groundY },
        uSpread: { value: 1 },
        uHorizon: { value: 1e4 },
        uFocus: { value: new Vector2() },
        uBottomLeft: { value: color(0x120f18) },
        uBottomRight: { value: color(0x1b1623) },
        uTopLeft: { value: color(0x2c2337) },
        uTopRight: { value: color(0x1f1929) },
        uDot: { value: color(0x2a2236) },
      },
      depthWrite: true,
    });
    this.mesh = new Mesh(new PlaneGeometry(2, 2), material);
    this.mesh.name = 'InfiniteFloor';
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    // After the other opaque objects: only the pixels they leave uncovered are shaded.
    this.mesh.renderOrder = 5;
  }

  /** Follow the camera and the character; call once per frame before rendering. */
  update(camera: Camera, focus: { x: number; z: number }): void {
    const uniforms = this.mesh.material.uniforms;
    camera.updateMatrixWorld();
    const viewProjection = uniforms.uViewProjection.value as Matrix4;
    viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    (uniforms.uInverse.value as Matrix4).copy(this.inverse.copy(viewProjection).invert());
    (uniforms.uFocus.value as Vector2).set(focus.x, focus.z);
    const perspective = camera instanceof PerspectiveCamera;
    uniforms.uSpread.value = perspective ? 1.6 : 1;
    uniforms.uHorizon.value = perspective ? camera.far * 0.85 : 1e4;
  }

  setLight(violet: boolean): void {
    (this.mesh.material.uniforms.uTopLeft.value as Color).set(violet ? 0x2f2340 : 0x2c2337);
  }

  /** Halloween's moonlit night: the ground's gradient darker and colder, its dots fainter. */
  setNight(): void {
    const uniforms = this.mesh.material.uniforms;
    (uniforms.uBottomLeft.value as Color).set(0x08070d);
    (uniforms.uBottomRight.value as Color).set(0x0e0b16);
    (uniforms.uTopLeft.value as Color).set(0x1a1430);
    (uniforms.uTopRight.value as Color).set(0x120e1f);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.removeFromParent();
  }
}
