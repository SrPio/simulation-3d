import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { Box3, Mesh, Texture, Vector3, type MeshStandardMaterial } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MESSAGES, type MessageKey } from '../src/core/i18n.ts';
import { readOutside, type OutsideData } from '../src/scene/outsideData.ts';
import { overlaps } from '../src/world/collisions.ts';
import { SHOUT_MARGIN, SHOUT_REACH, shoutAt, shoutSpots } from '../src/world/shouts.ts';
import polygonClipping from 'polygon-clipping';

async function load(file: string) {
  const data = await readFile(new URL(`../public/models/${file}`, import.meta.url));
  const loader = new GLTFLoader();
  loader.register(() => ({ name: 'EXT_texture_webp', loadTexture: () => Promise.resolve(new Texture()) }));
  return (await loader.parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.length), '')).scene;
}

/** The outside with the Colombian corner, the Univalle logo and the boxing corner, as the viewer reads them. */
async function outside(): Promise<OutsideData> {
  const scene = await load('outside.glb');
  for (const file of ['colombia.glb', 'univalle.glb', 'boxing.glb']) scene.add(await load(file));
  return readOutside(scene);
}

/** How far a yaw is from the nearest quarter turn. */
const offAxis = (yaw: number) => Math.abs(Math.sin(2 * yaw)) / 2;
const facesFront = (yaw: number) => Math.cos(yaw) > 0.999;

test('everything new keeps the block perspective: axis aligned, fronts towards +Z like the signs', async () => {
  const data = await outside();
  // Round things (tree crowns, rocks) have no front and may turn freely; everything else keeps a quarter turn.
  for (const item of data.decor.filter((entry) => entry.kind !== 'tree' && entry.kind !== 'rock')) {
    assert.ok(offAxis(item.yaw) < 1e-3, `${item.name} is axis aligned (${item.yaw.toFixed(3)})`);
  }
  for (const kind of ['bust', 'colombia', 'univalle', 'planter', 'lamp', 'scoreboard', 'boxing', 'post']) {
    const items = data.decor.filter((entry) => entry.kind === kind);
    assert.ok(items.length > 0, kind);
    for (const item of items) assert.ok(facesFront(item.yaw), `${item.name} faces +Z`);
  }
  for (const plaque of data.plaques) assert.ok(facesFront(plaque.yaw), `plaque ${plaque.id} faces +Z`);
  for (const target of data.targets) assert.ok(facesFront(target.yaw), `target ${target.index} faces +Z`);
  for (const zone of data.zones) assert.ok(facesFront(zone.yaw), `${zone.id} keeps the block yaw`);
  for (const floor of data.floors) assert.ok(facesFront(floor.yaw), `${floor.id} keeps the block yaw`);
  for (const piece of data.props.filter((entry) => entry.group === 'tech' || entry.group === 'decor')) {
    const yaw = Math.atan2(2 * (piece.quaternion.w * piece.quaternion.y + piece.quaternion.x * piece.quaternion.z), 1 - 2 * (piece.quaternion.y ** 2 + piece.quaternion.z ** 2));
    assert.ok(offAxis(yaw) < 1e-3, `${piece.name} is axis aligned`);
  }
  // Rows run along +X: the plaza's objects share one line, the tech tower's bottom row too.
  const row = data.decor.filter((entry) => ['colombia', 'bust', 'univalle'].includes(entry.kind));
  assert.equal(row.length, 3);
  assert.ok(Math.max(...row.map((entry) => entry.position.z)) - Math.min(...row.map((entry) => entry.position.z)) < 1e-3, 'one row');
  const bottom = data.props.filter((entry) => entry.group === 'tech').slice(0, 4);
  assert.ok(Math.max(...bottom.map((entry) => entry.position.z)) - Math.min(...bottom.map((entry) => entry.position.z)) < 1e-3, 'tower row');
});

test('the about-me plaza holds the signs, a bust, the Colombian corner and the Univalle logo in front of them', async () => {
  const data = await outside();
  const plaza = data.floors.find((floor) => floor.id === 'about')!;
  assert.ok(plaza, 'Floor_About');
  const inside = (x: number, z: number) => Math.abs(x - plaza.position.x) < plaza.size[0] / 2 && Math.abs(z - plaza.position.z) < plaza.size[1] / 2;
  for (const sign of data.signs) assert.ok(inside(sign.position.x, sign.position.z), `${sign.id} in the plaza`);
  const signZ = data.signs[0].position.z;
  const kinds = new Map(data.decor.map((entry) => [entry.kind, entry]));
  for (const kind of ['bust', 'colombia', 'univalle', 'planter', 'lamp']) {
    const item = kinds.get(kind)!;
    assert.ok(item && inside(item.position.x, item.position.z), `${kind} in the plaza`);
    // In front of the sign zones and their titles, so it never hides a board.
    assert.ok(item.position.z > signZ + 4, `${kind} in front of the signs`);
  }
  // The Colombian corner on the bust's left, the Univalle logo as far on its right.
  const [colombia, bust, univalle] = ['colombia', 'bust', 'univalle'].map((kind) => kinds.get(kind)!.position.x);
  assert.ok(colombia < bust && bust < univalle);
  assert.ok(Math.abs((bust - colombia) - (univalle - bust)) < 0.01, 'one on each side, as far');
  assert.ok(!kinds.has('vitrine') && !kinds.has('rack'), 'no glass case, no racks');
  assert.ok(!kinds.has('globe'), 'the globe gave way to the Colombian corner');
  assert.deepEqual(data.plaques.map((plaque) => plaque.id).sort(), ['bust', 'colombia', 'univalle']);
  for (const key of ['about.name', 'about.role', 'about.country', 'about.univalle', 'floor.about'] as MessageKey[]) {
    for (const language of ['es', 'en'] as const) assert.ok(MESSAGES[language][key], `${language} ${key}`);
  }
  assert.equal(MESSAGES.es['about.country'], 'Colombia');
  assert.equal(MESSAGES.es['about.univalle'], 'Universidad del Valle');
});

test('no decor blocks a sign zone or a reset zone, and every solid one has a collider', async () => {
  const data = await outside();
  for (const zone of [...data.signs, ...data.zones]) {
    const { area } = zone;
    for (const sx of [-1, 0, 1]) for (const sz of [-1, 0, 1]) {
      const point = {
        x: area.center.x + sx * area.halfX * area.axisX.x + sz * area.halfZ * area.axisZ.x,
        z: area.center.z + sx * area.halfX * area.axisX.z + sz * area.halfZ * area.axisZ.z,
      };
      assert.equal(overlaps(point, 0.05, data.boxes)?.name, undefined, `${zone.id} is free`);
    }
  }
  for (const item of data.decor.filter((entry) => entry.solid)) {
    assert.ok(overlaps({ x: item.position.x, z: item.position.z }, 0.01, data.boxes), `${item.name} blocks the character`);
  }
});

test('the Colombian corner stands side by side: hat, cup, pin and flag on one low base, none on another', async () => {
  const scene = await load('colombia.glb');
  scene.updateMatrixWorld(true);
  const parts = ['ColombiaFlag_Pole', 'Colombia_Hat', 'Colombia_Cup', 'Colombia_Pin'].map((name) => {
    const object = scene.getObjectByName(name)!;
    assert.ok(object, name);
    return new Box3().setFromObject(object);
  });
  // A row along +X: each starts where the one before it ends, and all stand on the base's top.
  for (let i = 1; i < parts.length; i++) assert.ok(parts[i].min.x >= parts[i - 1].max.x - 0.02, `part ${i} beside the one before`);
  const base = new Box3().setFromObject(scene.getObjectByName('ColombiaBase')!);
  for (const part of parts) assert.ok(Math.abs(part.min.y - base.max.y) < 0.03, 'on the base');
  assert.ok(scene.getObjectByName('ColombiaFlag_Cloth'), 'the flag has its cloth');
});

test('the Univalle logo is the flat logo extruded: a red disc with the white U and V standing out of both faces, upright on its base', async () => {
  const scene = await load('univalle.glb');
  scene.updateMatrixWorld(true);
  const box = (name: string) => new Box3().setFromObject(scene.getObjectByName(name)!);
  const [disc, u, v, base] = ['Univalle_Disc', 'Univalle_U', 'Univalle_V', 'UnivalleBase'].map(box);
  const colour = (name: string) => ((scene.getObjectByName(name) as Mesh).material as MeshStandardMaterial).color.getHexString();
  assert.equal(colour('Univalle_Disc'), 'e30613', 'red disc');
  assert.equal(colour('Univalle_U'), 'ffffff', 'white U');
  assert.equal(colour('Univalle_V'), 'ffffff', 'white V');
  // Upright and facing +Z: round in X and Y, thin along Z.
  const size = disc.getSize(new Vector3());
  assert.ok(Math.abs(size.x - size.y) < 0.02 && size.z < 0.2, 'a standing disc');
  for (const mark of [u, v]) {
    assert.ok(mark.max.z > disc.max.z + 0.005 && mark.min.z < disc.min.z - 0.005, 'stands out of both faces');
    assert.ok(disc.containsPoint(mark.getCenter(new Vector3()).setZ(disc.getCenter(new Vector3()).z)), 'inside the disc');
  }
  assert.ok(Math.abs(disc.min.y - base.max.y) < 0.1, 'standing on the base');
  // The V is to the right of and below the U, as in the logo.
  assert.ok(v.max.x > u.max.x && v.min.y < u.min.y);
});

test('the traced U and V keep the logo’s red fillet between them', async () => {
  const { univalle } = JSON.parse(await readFile(new URL('../assets/logos/logo-outlines.json', import.meta.url), 'utf8'));
  const u = univalle.u as [number, number][][][];
  const v = univalle.v as [number, number][][];
  assert.deepEqual(polygonClipping.intersection(u as never, [v] as never), [], 'the U never touches the V');
  // The fillet: no U corner is closer to the V's sides than a few units of the 300 box.
  const [a, b, c] = v[0];
  const toSide = ([px, py]: [number, number], [ax, ay]: [number, number], [bx, by]: [number, number]) => {
    const t = Math.min(1, Math.max(0, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
    return Math.hypot(px - ax - t * (bx - ax), py - ay - t * (by - ay));
  };
  const nearest = Math.min(...u.flat(2).map((point) => Math.min(toSide(point, a, b), toSide(point, b, c), toSide(point, c, a))));
  assert.ok(nearest > 6 && nearest < 10, `fillet ${nearest}`);
});

test('near the bust, the Colombian corner and the Univalle logo the character exclaims what each one says about its author', async () => {
  const data = await outside();
  const spots = shoutSpots(data.decor);
  assert.deepEqual(spots.map((spot) => spot.id).sort(), ['bust', 'colombia', 'univalle']);
  const at = (id: string) => spots.find((spot) => spot.id === id)!;
  // In front of each landmark (+Z, where the character walks up to it).
  for (const spot of spots) assert.equal(shoutAt({ x: spot.x, z: spot.z + spot.halfZ + 1 }, spots), spot.id);
  assert.equal(shoutAt({ x: at('bust').x, z: at('bust').z + 8 }, spots), undefined, 'nothing far away');
  // Leaving: still shouting just past the reach, quiet further out.
  const edge = { x: at('univalle').x, z: at('univalle').z + at('univalle').halfZ + SHOUT_REACH + SHOUT_MARGIN / 2 };
  assert.equal(shoutAt(edge, spots), undefined);
  assert.equal(shoutAt(edge, spots, 'univalle'), 'univalle');
  assert.equal(MESSAGES.es['shout.bust'], 'Andrés Jaramillo\nIngeniero de Sistemas y Desarrollador');
  assert.equal(MESSAGES.es['shout.colombia'], 'Nacido en Colombia');
  assert.equal(MESSAGES.es['shout.univalle'].replace('\n', ' '), 'Graduado de la Universidad del Valle');
  for (const key of ['shout.bust', 'shout.colombia', 'shout.univalle'] as MessageKey[]) assert.ok(MESSAGES.en[key], `en ${key}`);
});
