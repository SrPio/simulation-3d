import { Material, Mesh, Vector2, Vector3, type Camera, type Object3D, type WebGLProgramParametersWithUniforms } from 'three';
import { REVEAL_RADIUS } from '../world/reveal.ts';

type Uniforms = {
  uRevealCenter: { value: Vector2 };
  uRevealRadius: { value: number };
  uRevealDepth: { value: number };
  uRevealAmount: { value: number };
};

const VERTEX_HEAD = /* glsl */ `
varying float vRevealDepth;
`;
const VERTEX_BODY = /* glsl */ `
vRevealDepth = -mvPosition.z;
`;
const FRAGMENT_HEAD = /* glsl */ `
uniform vec2 uRevealCenter;
uniform float uRevealRadius;
uniform float uRevealDepth;
uniform float uRevealAmount;
varying float vRevealDepth;
// Interleaved gradient noise: the window's edge breaks up into a fine screen-door pattern instead of a hard line.
float revealDither(vec2 pixel) {
  return fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715))));
}
`;
const FRAGMENT_BODY = /* glsl */ `
if (uRevealAmount > 0.0 && vRevealDepth < uRevealDepth) {
  float distanceToCentre = distance(gl_FragCoord.xy, uRevealCenter);
  float radius = uRevealRadius * uRevealAmount;
  // Fully open in the middle, thinning out over the outer third of the circle.
  float open = 1.0 - smoothstep(radius * 0.62, radius, distanceToCentre);
  if (open > revealDither(gl_FragCoord.xy)) discard;
}
`;

/**
 * A see-through window in the room around the character while the room stands between it and the camera: every room
 * material leaves out the fragments in front of the character inside a circle around it on screen, with a dithered
 * edge. Shadows are untouched (the shadow pass has its own materials). One set of uniforms is shared by all of them.
 */
export class RoomReveal {
  private readonly uniforms: Uniforms = {
    uRevealCenter: { value: new Vector2() },
    uRevealRadius: { value: 0 },
    uRevealDepth: { value: 0 },
    uRevealAmount: { value: 0 },
  };
  private readonly patched = new Set<Material>();
  private readonly point = new Vector3();
  private readonly edge = new Vector3();
  private readonly right = new Vector3();

  constructor(room: Object3D) {
    room.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) this.patch(material);
    });
  }

  private patch(material: Material): void {
    if (this.patched.has(material)) return;
    this.patched.add(material);
    const previous = material.onBeforeCompile;
    material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms, renderer) => {
      previous?.call(material, shader, renderer);
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${VERTEX_HEAD}`)
        .replace('#include <project_vertex>', `#include <project_vertex>\n${VERTEX_BODY}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FRAGMENT_HEAD}`)
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${FRAGMENT_BODY}`);
    };
    // Its own program: other materials of the same kind keep theirs.
    const key = material.customProgramCacheKey.bind(material);
    material.customProgramCacheKey = () => `${key()}|room-reveal`;
    material.needsUpdate = true;
  }

  /**
   * Centre the window on the character's chest at `chest` (world), sized REVEAL_RADIUS there, opened by `amount`.
   * `width`/`height` are the drawing buffer's size in device pixels.
   */
  update(camera: Camera, chest: Vector3, amount: number, width: number, height: number): void {
    const uniforms = this.uniforms;
    uniforms.uRevealAmount.value = amount;
    if (amount <= 0) return;
    camera.updateMatrixWorld();
    this.point.copy(chest).applyMatrix4(camera.matrixWorldInverse);
    uniforms.uRevealDepth.value = -this.point.z;
    this.right.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    this.edge.copy(chest).addScaledVector(this.right, REVEAL_RADIUS).project(camera);
    this.point.copy(chest).project(camera);
    uniforms.uRevealCenter.value.set((this.point.x + 1) / 2 * width, (this.point.y + 1) / 2 * height);
    uniforms.uRevealRadius.value = Math.abs(this.edge.x - this.point.x) / 2 * width;
  }

  get amount(): number {
    return this.uniforms.uRevealAmount.value;
  }
}
