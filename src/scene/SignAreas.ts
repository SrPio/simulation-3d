import {
  BufferAttribute, BufferGeometry, CanvasTexture, Color, DoubleSide, Group, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace,
  ShaderMaterial, Vector3, type Raycaster,
} from 'three';
import { MESSAGES, t, type MessageKey } from '../core/i18n.ts';
import { FONT } from './canvasText.ts';
import type { Sign } from './outsideData.ts';

const BORDER = 0.09;
const FENCE_HEIGHT = 0.45;
/** Each zone's title is written on the ground just past its front edge, left aligned with the zone. */
const TITLE_GAP = 0.12;
const TITLE_HEIGHT = 0.42;
const TITLE_OPACITY = 0.6;
/** The ENTER label appears on the ground in front of the title while the character is in the zone. */
const LABEL_AHEAD = TITLE_GAP + TITLE_HEIGHT + 0.12;
const LABEL_WIDTH = 2.4;
const LABEL_SLIDE = 0.2;
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

/** Title on the ground and label of a zone in the current language (the GLB's words when there is no translation). */
export function signText(sign: Sign): { title: string; label: string } {
  if (sign.kind === 'reset') return { title: t('zone.title'), label: t(sign.target === 'bricks' ? 'zone.bricks' : 'zone.bowling') };
  const key = (part: string) => `sign.${sign.id}.${part}` as MessageKey;
  const known = key('title') in MESSAGES.es;
  return { title: known ? t(key('title')) : sign.title || sign.id.toUpperCase(), label: known ? t(key('label')) : sign.label };
}

function labelTexture(text: string, external: boolean): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 840;
  canvas.height = 160;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#ffffff';
  context.strokeStyle = '#ffffff';
  context.lineWidth = 7;
  context.font = `700 54px ${FONT}`;
  context.textBaseline = 'middle';
  // The Enter key cap, then the destination.
  const key = 'ENTER';
  const keyWidth = context.measureText(key).width + 56;
  context.beginPath();
  context.roundRect(8, 28, keyWidth, 104, 18);
  context.stroke();
  context.fillText(key, 36, 82);
  context.font = `600 60px ${FONT}`;
  context.fillText(external ? `${text}  ↗` : text, keyWidth + 44, 82, canvas.width - keyWidth - 52);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** Shift a point on the ground by along/ahead metres in a zone's own axes. */
const onZone = (sign: Sign, along: number, ahead: number, y: number): [number, number, number] => {
  const { center, axisX, axisZ } = sign.area;
  return [center.x + axisX.x * along + axisZ.x * ahead, y, center.z + axisX.z * along + axisZ.z * ahead];
};

/**
 * The zone titles (PORTAFOLIO, GITHUB, LINKEDIN) flat on the ground in the zone border colour: one
 * texture with a row per title and one quad per zone, so all of them are a single draw call.
 */
function titlesMesh(signs: readonly Sign[], groundY: number): Mesh<BufferGeometry, MeshBasicMaterial> {
  const row = 160;
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = row * Math.max(signs.length, 1);
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#ffffff';
  context.font = `600 118px ${FONT}`;
  context.textBaseline = 'middle';
  const position: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  for (const [i, sign] of signs.entries()) {
    const text = signText(sign).title;
    context.fillText(text, 8, row * i + row / 2 + 6, canvas.width - 16);
    const u = Math.min(1, (Math.min(context.measureText(text).width, canvas.width - 16) + 20) / canvas.width);
    const width = TITLE_HEIGHT * u * canvas.width / row;
    const left = -sign.area.halfX;
    const far = sign.area.halfZ + TITLE_GAP;
    const near = far + TITLE_HEIGHT;
    const y = groundY + 0.006;
    // The top of the text points away from the camera, so it reads upright on screen.
    position.push(...onZone(sign, left, far, y), ...onZone(sign, left + width, far, y), ...onZone(sign, left, near, y), ...onZone(sign, left + width, near, y));
    const top = 1 - i * row / canvas.height;
    const bottom = 1 - (i + 1) * row / canvas.height;
    uv.push(0, top, u, top, 0, bottom, u, bottom);
    const base = i * 4;
    index.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  geometry.setIndex(index);
  const mesh = new Mesh(geometry, new MeshBasicMaterial({ map: texture, color: VIOLET, transparent: true, opacity: TITLE_OPACITY, depthWrite: false, side: DoubleSide }));
  mesh.name = 'SignTitles';
  mesh.renderOrder = -4;
  mesh.matrixAutoUpdate = false;
  return mesh;
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
  // Lying on the ground, the top of the text away from the camera.
  private readonly labelGeometry = new PlaneGeometry(LABEL_WIDTH, LABEL_WIDTH * 160 / 840).rotateX(-Math.PI / 2);
  private titles: Mesh<BufferGeometry, MeshBasicMaterial>;
  private readonly signs: readonly Sign[];
  private readonly groundY: number;
  private reducedMotion = false;
  private clock = 0;

  constructor(signs: readonly Sign[], groundY: number) {
    this.groundY = groundY;
    this.signs = signs;
    this.root.name = 'SignAreas';
    this.titles = titlesMesh(signs, groundY);
    this.root.add(this.titles);
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
      const label = new Mesh(this.labelGeometry, new MeshBasicMaterial({ map: labelTexture(signText(sign).label, sign.kind === 'link'), transparent: true, depthWrite: false }));
      label.position.set(...onZone(sign, -area.halfX + LABEL_WIDTH / 2, area.halfZ + LABEL_AHEAD + LABEL_WIDTH * 160 / 840 / 2, groundY + 0.008));
      label.rotation.y = sign.yaw;
      label.userData.rest = label.position.clone();
      label.renderOrder = -3;
      border.renderOrder = -4;
      for (const mesh of [border, fence, label]) mesh.name = `SignArea_${sign.id}`;
      for (const mesh of [fence, label]) mesh.visible = false;
      border.matrixAutoUpdate = false;
      border.updateMatrix();
      // Click targets: the zone on the ground and the board itself.
      const hits = [placed(new Mesh(new PlaneGeometry(area.halfX * 2, area.halfZ * 2).rotateX(-Math.PI / 2)), groundY)];
      if (sign.board) {
        const boardHit = new Mesh(new PlaneGeometry(sign.board.width, sign.board.height));
        boardHit.position.copy(sign.position).setY(sign.position.y + sign.board.bottom + sign.board.height / 2);
        boardHit.rotation.y = sign.yaw;
        hits.push(boardHit);
      }
      for (const hit of hits) hit.updateMatrixWorld(true);
      this.root.add(border, fence, label);
      this.zones.push({ sign, border, fence, label, hits, progress: 0, target: 0, flash: 0 });
    }
  }

  setReducedMotion(enabled: boolean): void {
    this.reducedMotion = enabled;
  }

  /** Rewrite the titles on the ground and the ENTER labels in the current language. */
  setLanguage(): void {
    this.titles.geometry.dispose();
    this.titles.material.map?.dispose();
    this.titles.material.dispose();
    this.titles.removeFromParent();
    this.titles = titlesMesh(this.signs, this.groundY);
    this.root.add(this.titles);
    for (const zone of this.zones) {
      zone.label.material.map?.dispose();
      zone.label.material.map = labelTexture(signText(zone.sign).label, zone.sign.kind === 'link');
      zone.label.material.needsUpdate = true;
    }
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

  update(delta: number): void {
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
      // The label slides in from further ahead as it fades in.
      const rest = label.userData.rest as Vector3;
      const slide = LABEL_SLIDE * (1 - Math.min(rise, 1));
      label.position.set(rest.x + zone.sign.area.axisZ.x * slide, rest.y, rest.z + zone.sign.area.axisZ.z * slide);
      label.material.opacity = Math.min(1, p * 1.4) * (0.85 + 0.15 * zone.flash);
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
    this.titles.geometry.dispose();
    this.titles.material.map?.dispose();
    this.titles.material.dispose();
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
