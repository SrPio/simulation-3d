import {
  BufferAttribute, BufferGeometry, CanvasTexture, Color, DoubleSide, Group, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace,
  ShaderMaterial, Vector3, type Camera, type Raycaster,
} from 'three';
import type { Sign } from './outsideData.ts';

const BORDER = 0.09;
const FENCE_HEIGHT = 0.45;
/** The label floats this high just past the zone's front edge, where it never covers the character or the board. */
const LABEL_HEIGHT = 0.45;
const LABEL_AHEAD = 0.85;
const LABEL_WIDTH = 2.3;
const ENTER = 0.35;
const LEAVE = 0.25;
const FLASH = 1.2;
const VIOLET = new Color(0xb79bff);

const fenceVertex = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const fenceFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uGround;
uniform float uTime;
uniform float uAlpha;
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  // The fence rises out of the ground: nothing below it is drawn.
  if (vWorld.y < uGround) discard;
  float stripe = step(fract((vWorld.x + vWorld.y + vWorld.z - uTime * 0.35) * 2.5), 0.5) * 0.28;
  float band = max(step(1.0 - vUv.y, 0.1), step(vUv.y, 0.1)) * 0.6;
  float alpha = max(stripe, band) * uAlpha;
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(uColor, alpha);
  #include <colorspace_fragment>
}`;

/** Flat rectangular ring on the ground: 8 vertices, 8 triangles. */
function ringGeometry(halfX: number, halfZ: number, width: number): BufferGeometry {
  const corners = (hx: number, hz: number) => [-hx, 0, -hz, hx, 0, -hz, hx, 0, hz, -hx, 0, hz];
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([...corners(halfX - width, halfZ - width), ...corners(halfX, halfZ)]), 3));
  const index: number[] = [];
  for (let side = 0; side < 4; side++) {
    const next = (side + 1) % 4;
    index.push(side, next, side + 4, next, next + 4, side + 4);
  }
  geometry.setIndex(index);
  return geometry;
}

/** Open box (four walls, no top or bottom) with v going 0 at the bottom to 1 at the top. */
function fenceGeometry(halfX: number, halfZ: number, height: number): BufferGeometry {
  const corners = [[-halfX, -halfZ], [halfX, -halfZ], [halfX, halfZ], [-halfX, halfZ]];
  const position: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  for (let side = 0; side < 4; side++) {
    const [ax, az] = corners[side];
    const [bx, bz] = corners[(side + 1) % 4];
    const base = side * 4;
    position.push(ax, 0, az, bx, 0, bz, bx, height, bz, ax, height, az);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  geometry.setIndex(index);
  return geometry;
}

function labelTexture(text: string): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 840;
  canvas.height = 160;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#ffffff';
  context.strokeStyle = '#ffffff';
  context.lineWidth = 7;
  context.font = '700 54px system-ui, "Segoe UI", Roboto, sans-serif';
  context.textBaseline = 'middle';
  // The Enter key cap, then the destination.
  const key = 'ENTER';
  const keyWidth = context.measureText(key).width + 56;
  context.beginPath();
  context.roundRect(8, 28, keyWidth, 104, 18);
  context.stroke();
  context.fillText(key, 36, 82);
  context.font = '600 60px system-ui, "Segoe UI", Roboto, sans-serif';
  context.fillText(`${text}  ↗`, keyWidth + 44, 82);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

type Zone = {
  sign: Sign;
  border: Mesh<BufferGeometry, MeshBasicMaterial>;
  fence: Mesh<BufferGeometry, ShaderMaterial>;
  label: Mesh<PlaneGeometry, MeshBasicMaterial>;
  hits: Mesh[];
  progress: number;
  target: 0 | 1;
  flash: number;
};

const easeOutBack = (t: number) => 1 + 2.4 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2;

/**
 * The floor zone in front of each sign. A faint border is always drawn on the ground; when the
 * character walks in, a striped fence rises out of the ground and an "ENTER" label appears above it.
 * Hidden fences and labels are not drawn. Click targets are invisible planes kept out of the scene.
 */
export class SignAreas {
  readonly root = new Group();
  private readonly zones: Zone[] = [];
  private readonly labelGeometry = new PlaneGeometry(LABEL_WIDTH, LABEL_WIDTH * 160 / 840);
  private readonly groundY: number;
  private reducedMotion = false;
  private clock = 0;

  constructor(signs: readonly Sign[], groundY: number) {
    this.groundY = groundY;
    this.root.name = 'SignAreas';
    for (const sign of signs) {
      const { area } = sign;
      const placed = (mesh: Mesh, y: number) => {
        mesh.position.set(area.center.x, y, area.center.z);
        mesh.rotation.y = sign.yaw;
        return mesh;
      };
      const border = placed(new Mesh(ringGeometry(area.halfX, area.halfZ, BORDER),
        new MeshBasicMaterial({ color: VIOLET, transparent: true, opacity: 0.45, depthWrite: false, side: DoubleSide })), groundY + 0.006) as Zone['border'];
      const fence = placed(new Mesh(fenceGeometry(area.halfX, area.halfZ, FENCE_HEIGHT), new ShaderMaterial({
        vertexShader: fenceVertex,
        fragmentShader: fenceFragment,
        uniforms: { uColor: { value: VIOLET.clone() }, uGround: { value: groundY }, uTime: { value: 0 }, uAlpha: { value: 1 } },
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
      })), groundY - FENCE_HEIGHT) as Zone['fence'];
      const label = new Mesh(this.labelGeometry, new MeshBasicMaterial({ map: labelTexture(sign.label), transparent: true, depthWrite: false, depthTest: false }));
      const ahead = area.halfZ + LABEL_AHEAD;
      label.position.set(area.center.x + area.axisZ.x * ahead, groundY + LABEL_HEIGHT, area.center.z + area.axisZ.z * ahead);
      label.renderOrder = 10;
      border.renderOrder = -4;
      for (const mesh of [border, fence, label]) mesh.name = `SignArea_${sign.id}`;
      for (const mesh of [fence, label]) mesh.visible = false;
      border.matrixAutoUpdate = false;
      border.updateMatrix();
      // Click targets: the zone on the ground and the board itself.
      const floorHit = placed(new Mesh(new PlaneGeometry(area.halfX * 2, area.halfZ * 2).rotateX(-Math.PI / 2)), groundY);
      const boardHit = new Mesh(new PlaneGeometry(sign.board.width, sign.board.height));
      boardHit.position.copy(sign.position).setY(sign.position.y + sign.board.bottom + sign.board.height / 2);
      boardHit.rotation.y = sign.yaw;
      const hits = [floorHit, boardHit];
      for (const hit of hits) hit.updateMatrixWorld(true);
      this.root.add(border, fence, label);
      this.zones.push({ sign, border, fence, label, hits, progress: 0, target: 0, flash: 0 });
    }
  }

  setReducedMotion(enabled: boolean): void {
    this.reducedMotion = enabled;
  }

  /** Raise the fence of this sign's zone (undefined lowers them all). */
  show(id: string | undefined): void {
    for (const zone of this.zones) zone.target = zone.sign.id === id ? 1 : 0;
  }

  /** Brief flash and bounce when the zone's link is opened. */
  pulse(id: string): void {
    const zone = this.zones.find((entry) => entry.sign.id === id);
    if (zone) zone.flash = 1;
  }

  /** Zone state for tests: 'in' while rising or up, 'out' while sinking, 'hidden'. */
  state(id: string): 'in' | 'out' | 'hidden' {
    const zone = this.zones.find((entry) => entry.sign.id === id);
    if (!zone || !zone.fence.visible) return 'hidden';
    return zone.target === 1 ? 'in' : 'out';
  }

  /** World centre of a zone on the ground. */
  center(id: string): Vector3 | undefined {
    const zone = this.zones.find((entry) => entry.sign.id === id);
    return zone && new Vector3(zone.sign.area.center.x, this.groundY, zone.sign.area.center.z);
  }

  update(delta: number, camera: Camera): void {
    this.clock += delta;
    for (const zone of this.zones) {
      const { fence, label, border } = zone;
      zone.flash = this.reducedMotion ? 0 : Math.max(0, zone.flash - delta / FLASH);
      if (zone.progress === zone.target && zone.target === 0 && !fence.visible) {
        if (border.material.opacity !== 0.45) border.material.opacity = 0.45;
        continue;
      }
      if (this.reducedMotion) zone.progress = zone.target;
      else if (zone.target === 1) zone.progress = Math.min(1, zone.progress + delta / ENTER);
      else zone.progress = Math.max(0, zone.progress - delta / LEAVE);
      const p = zone.progress;
      fence.visible = label.visible = p > 0;
      border.material.opacity = 0.45 + 0.4 * p + 0.15 * zone.flash;
      if (!fence.visible) continue;
      const rise = zone.target === 1 ? easeOutBack(p) : p * p;
      // On open the fence dips and springs back.
      const dip = zone.flash > 0.8 ? (zone.flash - 0.8) * 5 * FENCE_HEIGHT * 0.6 : 0;
      fence.position.y = this.groundY - FENCE_HEIGHT + FENCE_HEIGHT * rise - dip;
      fence.material.uniforms.uTime.value = this.reducedMotion ? 0 : this.clock;
      fence.material.uniforms.uAlpha.value = Math.min(1, p * 1.5) + zone.flash * 0.6;
      label.position.y = this.groundY + LABEL_HEIGHT - 0.25 * (1 - rise);
      label.material.opacity = Math.min(1, p * 1.4) * (0.85 + 0.15 * zone.flash);
      label.quaternion.copy(camera.quaternion);
    }
  }

  /** Sign under the pointer: its floor zone or its board. */
  hit(raycaster: Raycaster): Sign | undefined {
    let best: { sign: Sign; distance: number } | undefined;
    for (const zone of this.zones) {
      const [first] = raycaster.intersectObjects(zone.hits, false);
      if (first && (!best || first.distance < best.distance)) best = { sign: zone.sign, distance: first.distance };
    }
    return best?.sign;
  }

  dispose(): void {
    this.labelGeometry.dispose();
    for (const zone of this.zones) {
      zone.border.geometry.dispose();
      zone.border.material.dispose();
      zone.fence.geometry.dispose();
      zone.fence.material.dispose();
      zone.label.material.map?.dispose();
      zone.label.material.dispose();
      for (const hit of zone.hits) hit.geometry.dispose();
    }
    this.root.removeFromParent();
  }
}
