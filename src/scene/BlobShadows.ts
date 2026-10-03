import {
  Color, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, Matrix4, PlaneGeometry, Quaternion, ShaderMaterial, Vector3,
} from 'three';

const vertexShader = /* glsl */ `
attribute float aAlpha;
varying float vAlpha;
varying vec2 vUv;
void main() {
  vUv = uv;
  vAlpha = aAlpha;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;

const fragmentShader = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
varying vec2 vUv;
void main() {
  // Soft rounded rectangle: full in the middle, fading out towards every edge.
  vec2 q = abs(vUv - 0.5) * 2.0;
  float alpha = (1.0 - smoothstep(0.35, 1.0, q.x)) * (1.0 - smoothstep(0.35, 1.0, q.y));
  if (vAlpha * alpha < 0.004) discard;
  gl_FragColor = vec4(uColor, vAlpha * alpha);
  #include <colorspace_fragment>
}`;

const UP = new Vector3(0, 1, 0);

/**
 * Soft contact shadows on the outside ground, which receives no shadow map: one instanced quad per
 * object, all in a single draw call. They also show in the shadowless quality preset.
 */
export class BlobShadows {
  readonly mesh: InstancedMesh<PlaneGeometry, ShaderMaterial>;
  private readonly alpha: InstancedBufferAttribute;
  private readonly matrix = new Matrix4();
  private readonly rotation = new Quaternion();
  private readonly position = new Vector3();
  private readonly scale = new Vector3();
  private readonly groundY: number;
  private dirty = false;

  constructor(count: number, groundY: number) {
    this.groundY = groundY;
    const geometry = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.alpha = new InstancedBufferAttribute(new Float32Array(count), 1).setUsage(DynamicDrawUsage);
    geometry.setAttribute('aAlpha', this.alpha);
    const material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: { uColor: { value: new Color(0x07050b) } },
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.mesh = new InstancedMesh(geometry, material, count);
    this.mesh.name = 'BlobShadows';
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -5;
    for (let index = 0; index < count; index++) this.set(index, 0, 0, 0, 1, 1, 0);
  }

  /** Shadow `index`: centred at x,z on the ground, turned by yaw, size along its own axes, opacity. */
  set(index: number, x: number, z: number, yaw: number, width: number, depth: number, alpha: number): void {
    this.position.set(x, this.groundY + 0.004, z);
    this.rotation.setFromAxisAngle(UP, yaw);
    this.scale.set(Math.max(width, 1e-3), 1, Math.max(depth, 1e-3));
    this.mesh.setMatrixAt(index, this.matrix.compose(this.position, this.rotation, this.scale));
    this.alpha.setX(index, alpha);
    this.dirty = true;
  }

  hide(index: number): void {
    if (this.alpha.getX(index) === 0) return;
    this.alpha.setX(index, 0);
    this.dirty = true;
  }

  /** Upload the changes of this frame, if any. */
  flush(): void {
    if (!this.dirty) return;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.alpha.needsUpdate = true;
    this.dirty = false;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.dispose();
    this.mesh.removeFromParent();
  }
}
