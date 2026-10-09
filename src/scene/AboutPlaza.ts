import {
  BufferAttribute, BufferGeometry, CanvasTexture, ConeGeometry, Group, Mesh, MeshStandardMaterial, SRGBColorSpace, SphereGeometry, Vector3,
} from 'three';
import { t } from '../core/i18n.ts';
import { FONT } from './canvasText.ts';
import type { Globe, Plaque } from './outsideData.ts';

/** Canvas pixels per metre of plaque. */
const PPM = 640;
const ATLAS_WIDTH = 512;
const PAD = 4;

/** Where the pin goes: Colombia (Bogotá), in degrees. */
export const COLOMBIA = { lon: -74.1, lat: 4.6 };

type Rect = { x: number; y: number; w: number; h: number };

/** Coarse continent outlines (longitude, latitude), enough for a stylized globe; Colombia is drawn on top. */
const LAND: [number, number][][] = [
  // North and Central America
  [[-168, 66], [-160, 71], [-140, 70], [-125, 70], [-95, 72], [-80, 73], [-65, 62], [-56, 52], [-66, 45], [-70, 42], [-76, 37], [-81, 31],
    [-80, 25], [-82, 27], [-90, 30], [-97, 27], [-97, 22], [-92, 18], [-87, 21], [-88, 15], [-83, 10], [-79, 9], [-77.4, 7.5], [-80, 7.5],
    [-85, 10], [-92, 15], [-105, 20], [-110, 24], [-114, 30], [-118, 34], [-124, 40], [-124, 48], [-130, 55], [-140, 60], [-152, 58], [-165, 60]],
  // Greenland
  [[-55, 60], [-45, 60], [-20, 70], [-20, 82], [-60, 83], [-72, 78], [-55, 70]],
  // South America
  [[-80, 10], [-75, 11], [-72, 12], [-62, 11], [-60, 8], [-52, 5], [-50, 0], [-44, -2], [-35, -5], [-35, -9], [-39, -14], [-40, -22], [-48, -26],
    [-53, -34], [-58, -38], [-63, -41], [-65, -46], [-68, -52], [-74, -53], [-73, -45], [-72, -38], [-71, -30], [-70, -18], [-76, -14],
    [-81, -6], [-80, -2], [-78, 2], [-77, 7]],
  // Europe and Asia
  [[-10, 36], [-9, 43], [-2, 44], [-5, 48], [2, 51], [8, 54], [10, 58], [5, 62], [15, 70], [30, 71], [45, 68], [60, 70], [80, 73], [100, 77],
    [140, 73], [160, 70], [180, 68], [180, 64], [170, 60], [160, 55], [142, 53], [140, 45], [130, 42], [122, 40], [120, 32], [121, 25], [110, 20],
    [108, 12], [104, 9], [100, 14], [98, 8], [100, 3], [104, 1], [95, 15], [92, 22], [88, 22], [80, 15], [77, 8], [72, 20], [67, 25], [57, 25],
    [56, 27], [50, 30], [48, 29], [56, 24], [59, 22], [52, 16], [44, 12], [42, 15], [35, 28], [34, 31], [36, 36], [28, 36], [26, 40], [23, 37],
    [20, 40], [15, 45], [12, 44], [18, 40], [16, 38], [12, 38], [10, 44], [3, 43], [-1, 37], [-6, 36]],
  // Africa
  [[-17, 21], [-16, 12], [-12, 7], [-8, 4], [2, 6], [9, 4], [9, -1], [12, -6], [13, -13], [12, -18], [15, -27], [18, -34], [25, -34], [32, -29],
    [35, -24], [40, -15], [40, -10], [43, -1], [51, 12], [44, 11], [39, 17], [33, 28], [32, 31], [20, 32], [10, 37], [0, 36], [-6, 35], [-10, 30],
    [-13, 27]],
  [[44, -25], [47, -25], [50, -15], [49, -12], [44, -17]],
  [[-5, 50], [1, 51], [-2, 56], [-5, 58], [-6, 55]],
  [[130, 31], [135, 34], [141, 38], [142, 45], [140, 41], [133, 34]],
  [[95, 5], [105, -6], [115, -8], [120, -9], [110, -3], [100, 2]],
  [[131, -1], [141, -3], [150, -6], [147, -10], [138, -8]],
  // Australia
  [[114, -22], [122, -18], [130, -12], [137, -12], [142, -11], [146, -19], [153, -26], [150, -37], [141, -38], [131, -31], [115, -34]],
  // Antarctica
  [[-180, -72], [180, -72], [180, -90], [-180, -90]],
];
const COLOMBIA_OUTLINE: [number, number][] = [
  [-77, 8.5], [-75.5, 10.8], [-72, 12.4], [-71.3, 11.5], [-72.5, 8], [-70, 7], [-67.5, 6.2], [-67.8, 2], [-69.5, 1], [-69.9, -4.2], [-73, -2.5],
  [-75.5, -0.3], [-79, 1.5], [-77.5, 4], [-77.4, 7],
];

/** Point on a unit sphere of three.js SphereGeometry for a longitude/latitude, with the map below drawn as its texture. */
export function onSphere(lon: number, lat: number): { x: number; y: number; z: number } {
  const phi = ((lon + 180) / 360) * Math.PI * 2;
  const theta = ((90 - lat) / 180) * Math.PI;
  return { x: -Math.cos(phi) * Math.sin(theta), y: Math.cos(theta), z: Math.sin(phi) * Math.sin(theta) };
}

/** Turn about +Y that brings a longitude/latitude round to face the horizontal direction `view` (x, z). */
export function faceYaw(lon: number, lat: number, view: { x: number; z: number }): number {
  const point = onSphere(lon, lat);
  return Math.atan2(point.z, point.x) - Math.atan2(view.z, view.x);
}

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
 * The about-me plaza's painted parts: the plaques (the bust's name, role and country, the globe's country) as one mesh over one canvas atlas facing the front, and the globe itself, a sphere with
 * the continents painted on and a pin on Colombia turned towards the default view. Plaques repaint on a language change.
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

  constructor(plaques: readonly Plaque[], globe: Globe | undefined, view: { x: number; z: number }) {
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
    if (globe) this.root.add(this.globe(globe, view));
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

  private globe(globe: Globe, view: { x: number; z: number }): Group {
    const group = new Group();
    group.name = 'GlobeSphere';
    group.position.set(globe.position.x, globe.position.y + globe.centre, globe.position.z);
    const map = this.globeMap();
    const sphere = new SphereGeometry(globe.radius, 40, 24);
    const material = new MeshStandardMaterial({ map, roughness: 0.45, metalness: 0.05 });
    const ball = new Mesh(sphere, material);
    // The pin rides on the sphere; the sphere turns so Colombia faces the default view.
    const spin = new Group();
    spin.rotation.y = faceYaw(COLOMBIA.lon, COLOMBIA.lat, view);
    spin.add(ball);
    const at = onSphere(COLOMBIA.lon, COLOMBIA.lat);
    const pinMaterial = new MeshStandardMaterial({ color: 0xff6a3d, roughness: 0.35, emissive: 0xff4a1d, emissiveIntensity: 0.35 });
    const stick = new ConeGeometry(0.012, 0.09, 8);
    const head = new SphereGeometry(0.028, 12, 8);
    const pin = new Group();
    const stickMesh = new Mesh(stick, pinMaterial);
    stickMesh.position.y = 0.045;
    const headMesh = new Mesh(head, pinMaterial);
    headMesh.position.y = 0.09;
    stickMesh.rotation.x = Math.PI;
    pin.add(stickMesh, headMesh);
    pin.position.set(at.x * globe.radius, at.y * globe.radius, at.z * globe.radius);
    pin.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), pin.position.clone().normalize());
    spin.add(pin);
    group.add(spin);
    this.geometries.push(sphere, stick, head);
    this.materials.push(material, pinMaterial);
    return group;
  }

  private globeMap(): CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 512;
    const context = canvas.getContext('2d');
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 4;
    this.textures.push(texture);
    if (!context) return texture;
    const x = (lon: number) => ((lon + 180) / 360) * canvas.width;
    const y = (lat: number) => ((90 - lat) / 180) * canvas.height;
    context.fillStyle = '#34397f';
    context.fillRect(0, 0, canvas.width, canvas.height);
    // Faint parallels and meridians.
    context.strokeStyle = '#4b52a3';
    context.lineWidth = 1.5;
    for (let lat = -60; lat <= 60; lat += 30) {
      context.beginPath();
      context.moveTo(0, y(lat));
      context.lineTo(canvas.width, y(lat));
      context.stroke();
    }
    for (let lon = -150; lon <= 180; lon += 30) {
      context.beginPath();
      context.moveTo(x(lon), 0);
      context.lineTo(x(lon), canvas.height);
      context.stroke();
    }
    const fill = (outline: readonly [number, number][], color: string) => {
      context.fillStyle = color;
      context.beginPath();
      for (const [i, [lon, lat]] of outline.entries()) {
        if (i === 0) context.moveTo(x(lon), y(lat));
        else context.lineTo(x(lon), y(lat));
      }
      context.closePath();
      context.fill();
    };
    for (const outline of LAND) fill(outline, '#86cfa4');
    fill(COLOMBIA_OUTLINE, '#ffb347');
    texture.needsUpdate = true;
    return texture;
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
