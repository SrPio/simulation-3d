import {
  BufferAttribute, CanvasTexture, Color, Group, Mesh, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace, Vector3, type Material, type Object3D,
} from 'three';
import { partsOf, type Piece, type PunchBag } from './outsideData.ts';

/**
 * christmas.glb (scripts/blender/create_christmas.py) split up: `world` is read with the outside (its snowmen and the
 * giant tree's gifts are pieces of group 'christmas'; the pines, the giant tree, the pond and the decorations are decor
 * merged with the outside); the rest is kept aside.
 */
export type ChristmasDress = {
  world: Object3D;
  /** The Santa hat, modelled in the character's own frame (hung on its head bone like the Halloween mask). */
  hat?: Object3D;
  /** The hat's bobble, its origin at the hat's tip (swung by the viewer, src/character/pompom.ts). */
  pompom?: Object3D;
  /** The sleigh that replaces the office chair: its origin on the ground under the rider's hips, facing +Z. */
  sleigh?: Object3D;
  /** Strings of bulbs (world positions after the outside is placed) and each string's bulb radius. */
  lights: { object: Object3D; points: Vector3[]; radius: number }[];
  /** Meshes used as they are: the dressed pin and ball, the snowball, a lump of snow and the falling gifts. */
  library: Map<string, Object3D>;
};

export function takeChristmas(scene: Object3D): ChristmasDress {
  scene.updateMatrixWorld(true);
  const world = scene.getObjectByName('ChristmasWorld') ?? new Group();
  const hat = scene.getObjectByName('ChristmasHat');
  const sleigh = scene.getObjectByName('ChristmasSleigh');
  const library = new Map<string, Object3D>();
  for (const child of scene.getObjectByName('ChristmasLibrary')?.children ?? []) library.set(child.name, child);
  const lights: ChristmasDress['lights'] = [];
  for (const child of scene.getObjectByName('ChristmasLights')?.children ?? []) {
    const flat = (child.userData.bulbs as number[] | undefined) ?? [];
    const points: Vector3[] = [];
    for (let i = 0; i + 2 < flat.length; i += 3) points.push(new Vector3(flat[i], flat[i + 1], flat[i + 2]));
    lights.push({ object: child, points, radius: Number(child.userData.bulb ?? 0.04) });
  }
  world.removeFromParent();
  return { world, hat, pompom: hat?.getObjectByName('ChristmasHat_Pompom'), sleigh, lights, library };
}

/** The bulbs' world positions, once the light strings sit where the outside is (call after it is placed). */
export function bulbPositions(dress: ChristmasDress): { position: Vector3; radius: number; string: number }[] {
  const out: { position: Vector3; radius: number; string: number }[] = [];
  for (const [index, string] of dress.lights.entries()) {
    string.object.updateWorldMatrix(true, false);
    for (const point of string.points) out.push({ position: point.clone().applyMatrix4(string.object.matrixWorld), radius: string.radius, string: index });
  }
  return out;
}

/** Wrapping-paper colours for the gifts (the giant tree's and the ones that fall off the sleigh). */
export const GIFT_COLORS = [0xd62839, 0x1f9d55, 0x2f6fd6, 0xf2b705, 0xb043d1, 0xf5f5f5, 0x18b5a4].map((hex) => new Color(hex));

/**
 * Christmas looks for pieces that keep their bodies: the pins red with a green ribbon, the ball red with little
 * drawings; the gifts round the giant tree each in its own wrapping paper. The dressed meshes have the same sizes.
 */
export function dressChristmasPieces(pieces: readonly Piece[], dress: ChristmasDress): void {
  const parts = (name: string) => {
    const object = dress.library.get(name);
    return object ? partsOf(object) : undefined;
  };
  const pin = parts('Christmas_Pin');
  const ball = parts('Christmas_Ball');
  let gift = 0;
  for (const piece of pieces) {
    if (piece.prop === 'pin' && pin) piece.parts = pin;
    else if (piece.prop === 'ball' && ball) piece.parts = ball;
    else if (piece.prop === 'gift' && piece.parts[0]) piece.parts[0] = { ...piece.parts[0], color: GIFT_COLORS[gift++ % GIFT_COLORS.length].clone() };
  }
}

/** The character's cap (its fabric, stitching and eyelets: every material named Cap*) comes off for the Santa hat. */
export function hideCap(model: Object3D): number {
  let hidden = 0;
  model.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (materials.every((material: Material) => /^Cap/.test(material.name))) {
      object.visible = false;
      hidden++;
    }
  });
  return hidden;
}

/**
 * How create_outside.py made the bust from the character's head (build_bust): the character's frame (feet at 0) moved
 * down by `cut`, scaled by `scale` and set `pedestal` metres up on its holder. `tests/christmas.test.ts` keeps these
 * equal to BUST_CUT_Z, BUST_SCALE and PEDESTAL there.
 */
export const BUST_FRAME = { cut: 1.62, scale: 0.85 * 2.5, pedestal: 1.0 } as const;

/**
 * Christmas: the about-me bust wears the Santa hat too, in its own red and white (not stone). Its stone cap
 * (`BustCap`) comes off and a still copy of the hat, made in the character's frame, goes on the bust the same way the
 * head was carved into it. Each mesh gets its own geometry: the worn hat's tail bends its geometry every frame.
 * Returns whether it found the bust.
 */
export function dressBust(outside: Object3D, hat: Object3D): boolean {
  const cap = outside.getObjectByName('BustCap');
  const bust = outside.getObjectByName('Bust');
  if (!cap || !bust) return false;
  cap.removeFromParent();
  const copy = new Group();
  copy.name = 'BustSantaHat';
  for (const child of hat.children) {
    const part = child.clone(true);
    part.traverse((object) => {
      if (object instanceof Mesh) object.geometry = object.geometry.clone();
    });
    copy.add(part);
  }
  copy.scale.setScalar(BUST_FRAME.scale);
  copy.position.set(0, BUST_FRAME.pedestal - BUST_FRAME.cut * BUST_FRAME.scale, 0);
  bust.add(copy);
  return true;
}

/** Where a punching bag's letters face (LETTERS turn in create_boxing.py): the prints face the same way. */
const BAG_FACE_TURN = 0.35;

/** What a punching bag wears for Christmas: a white cover with a snowman on its front, or candy-cane stripes. */
export type BagDesign = 'snowman' | 'candy';

/** The bag's cover as a canvas: u runs once round the bag (the front, where the letters faced, at FRONT_U), v up it. */
export function bagTexture(design: BagDesign): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width;
  const h = canvas.height;
  if (design === 'candy') {
    // Diagonal stripes that meet themselves round the bag: whole stripes across u and across v.
    ctx.fillStyle = '#fbf7f4';
    ctx.fillRect(0, 0, w, h);
    const stripes = 7;
    const period = w / stripes;
    ctx.fillStyle = '#d4202f';
    for (let k = -stripes * 2; k <= stripes * 2; k++) {
      ctx.beginPath();
      const x = k * period;
      ctx.moveTo(x, 0);
      ctx.lineTo(x + period * 0.5, 0);
      ctx.lineTo(x + period * 0.5 + h, h);
      ctx.lineTo(x + h, h);
      ctx.closePath();
      ctx.fill();
    }
    // A thin pale line along each stripe's edge, and a soft sheen down the bag.
    ctx.strokeStyle = '#ff9aa2';
    ctx.lineWidth = 6;
    for (let k = -stripes * 2; k <= stripes * 2; k++) {
      ctx.beginPath();
      ctx.moveTo(k * period, 0);
      ctx.lineTo(k * period + h, h);
      ctx.stroke();
    }
  } else {
    ctx.fillStyle = '#f7fbff';
    ctx.fillRect(0, 0, w, h);
    // Little pale blue snowflakes all round.
    ctx.strokeStyle = '#bcd8f2';
    ctx.lineWidth = 3;
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 46; k++) {
      const x = random() * w;
      const y = random() * h;
      const r = 10 + random() * 12;
      for (let a = 0; a < 3; a++) {
        const angle = (a * Math.PI) / 3;
        ctx.beginPath();
        ctx.moveTo(x - Math.cos(angle) * r, y - Math.sin(angle) * r);
        ctx.lineTo(x + Math.cos(angle) * r, y + Math.sin(angle) * r);
        ctx.stroke();
      }
    }
    // The snowman on the front, its height most of the bag's (v grows up the bag; the canvas y grows down); its three
    // balls overlap a little, bottom first, so each sits on the one below.
    const cx = FRONT_U * w;
    const body = (y: number, r: number) => {
      ctx.beginPath();
      ctx.ellipse(cx, h - y * h, r * w, r * w * 1.02, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.lineWidth = 7;
      ctx.strokeStyle = '#8fb6dc';
      ctx.stroke();
    };
    body(0.25, 0.095);
    body(0.4, 0.07);
    body(0.52, 0.052);
    const coal = (x: number, y: number, r: number) => {
      ctx.beginPath();
      ctx.arc(cx + x * w, h - y * h, r, 0, Math.PI * 2);
      ctx.fillStyle = '#1b1d24';
      ctx.fill();
    };
    coal(-0.017, 0.545, 9);
    coal(0.017, 0.545, 9);
    for (const y of [0.43, 0.395, 0.36]) coal(0, y, 8);
    for (let k = 0; k < 5; k++) coal(-0.022 + k * 0.011, 0.5 - Math.sin((k / 4) * Math.PI) * 0.012, 4.5);
    // Carrot nose.
    ctx.beginPath();
    ctx.moveTo(cx, h - 0.53 * h);
    ctx.lineTo(cx + 0.045 * w, h - 0.522 * h);
    ctx.lineTo(cx, h - 0.512 * h);
    ctx.closePath();
    ctx.fillStyle = '#f07a1a';
    ctx.fill();
    // Scarf round the neck, where the head meets the middle ball, and top hat.
    ctx.fillStyle = '#d4202f';
    ctx.fillRect(cx - 0.055 * w, h - 0.49 * h, 0.11 * w, 0.03 * h);
    ctx.fillRect(cx + 0.02 * w, h - 0.49 * h, 0.025 * w, 0.1 * h);
    ctx.fillStyle = '#1b1d24';
    ctx.fillRect(cx - 0.06 * w, h - 0.574 * h, 0.12 * w, 0.014 * h);
    ctx.fillRect(cx - 0.035 * w, h - 0.652 * h, 0.07 * w, 0.08 * h);
    ctx.fillStyle = '#d4202f';
    ctx.fillRect(cx - 0.035 * w, h - 0.592 * h, 0.07 * w, 0.014 * h);
    // Twig arms.
    ctx.strokeStyle = '#6b4424';
    ctx.lineWidth = 7;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + side * 0.065 * w, h - 0.42 * h);
      ctx.lineTo(cx + side * 0.135 * w, h - 0.5 * h);
      ctx.lineTo(cx + side * 0.155 * w, h - 0.53 * h);
      ctx.moveTo(cx + side * 0.135 * w, h - 0.5 * h);
      ctx.lineTo(cx + side * 0.16 * w, h - 0.49 * h);
      ctx.stroke();
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

/** The front of the bag in the cover's u (the letters' turn about the bag's axis). */
export const FRONT_U = BAG_FACE_TURN / (Math.PI * 2) + 0.5;

/**
 * A punching bag for Christmas: the letters off, the cover printed with `design` (UVs worked out here, round the bag's
 * axis, since the bag has none), the cap red or white to match.
 */
export function christmasBag(bag: PunchBag, design: BagDesign): void {
  const cover = new MeshStandardMaterial({ map: bagTexture(design), roughness: 0.6, name: `ChristmasBag_${design}` });
  const cap = new MeshStandardMaterial({ color: design === 'candy' ? 0xd4202f : 0xf2f6fb, roughness: 0.6, name: 'ChristmasBagCap' });
  const replaced = new Set<Material>();
  const letters: Mesh[] = [];
  bag.object.updateMatrixWorld(true);
  bag.object.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const material = object.material as Material;
    if (/^BagLetters/.test(material.name)) letters.push(object);
    else if (/^Bag_/.test(material.name)) {
      replaced.add(material);
      object.geometry = object.geometry.clone();
      wrapUv(object);
      object.material = cover;
    } else if (/^BagCap/.test(material.name)) {
      replaced.add(material);
      object.material = cap;
    }
  });
  for (const mesh of letters) {
    mesh.removeFromParent();
    mesh.geometry.dispose();
    replaced.add(mesh.material as Material);
  }
  for (const material of replaced) material.dispose();
}

/** Cylindrical UVs round the bag's (local Y) axis: u once round, v from the bag's bottom to its top. */
function wrapUv(mesh: Mesh): void {
  const position = mesh.geometry.getAttribute('position');
  const point = new Vector3();
  let low = Infinity;
  let high = -Infinity;
  for (let i = 0; i < position.count; i++) {
    point.fromBufferAttribute(position, i);
    low = Math.min(low, point.y);
    high = Math.max(high, point.y);
  }
  const uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    point.fromBufferAttribute(position, i);
    uv[i * 2] = Math.atan2(point.x, point.z) / (Math.PI * 2) + 0.5;
    uv[i * 2 + 1] = (point.y - low) / Math.max(high - low, 1e-6);
  }
  mesh.geometry.setAttribute('uv', new BufferAttribute(uv, 2));
}

/** The materials snow settles on: the trees' leaves and trunks, the bushes, the rocks and the pines. */
export const SNOWY = /^(LeavesLight|Leaves|LeavesShade|Trunk|Rock|RockDark|PineNeedles|PineNeedlesLight)$/;

/**
 * Snow on everything facing up: the material blends to snow white where its surface faces the sky (a soft, slightly
 * ragged edge), so the tops of the canopies, branches, rocks and pine tiers look snowed on. Patched into the material's
 * own shader; nothing is added to the scene.
 */
export function snowOnTop(material: MeshStandardMaterial, amount = 1, from = 0.42, to = 0.78): void {
  if (material.userData.snowy) return;
  material.userData.snowy = true;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSnowAmount = { value: amount };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
varying float vSnowUp;
varying vec3 vSnowPoint;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
  vSnowUp = normalize(mat3(modelMatrix) * objectNormal).y;
  vSnowPoint = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uSnowAmount;
varying float vSnowUp;
varying vec3 vSnowPoint;
float snowHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
// Smooth value noise: soft drifts rather than a pattern of cells.
float snowNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(snowHash(i), snowHash(i + vec3(1, 0, 0)), f.x), mix(snowHash(i + vec3(0, 1, 0)), snowHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(snowHash(i + vec3(0, 0, 1)), snowHash(i + vec3(1, 0, 1)), f.x), mix(snowHash(i + vec3(0, 1, 1)), snowHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
  float snowCover = smoothstep(${from.toFixed(3)}, ${to.toFixed(3)}, vSnowUp + (snowNoise(vSnowPoint * 2.5) - 0.5) * 0.3) * uSnowAmount;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.94, 1.0), snowCover);`);
  };
  material.customProgramCacheKey = () => `snow-${amount}-${from}-${to}`;
  material.needsUpdate = true;
}
