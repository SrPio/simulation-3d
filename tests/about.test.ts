import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { Box3, Texture } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MESSAGES, type MessageKey } from '../src/core/i18n.ts';
import { readOutside, type OutsideData } from '../src/scene/outsideData.ts';
import { overlaps } from '../src/world/collisions.ts';

async function load(file: string) {
  const data = await readFile(new URL(`../public/models/${file}`, import.meta.url));
  const loader = new GLTFLoader();
  loader.register(() => ({ name: 'EXT_texture_webp', loadTexture: () => Promise.resolve(new Texture()) }));
  return (await loader.parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.length), '')).scene;
}

/** The outside with the Colombian corner, as the viewer reads them. */
async function outside(): Promise<OutsideData> {
  const scene = await load('outside.glb');
  scene.add(await load('colombia.glb'));
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
  for (const kind of ['bust', 'colombia', 'planter', 'lamp', 'scoreboard']) {
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
  const row = data.decor.filter((entry) => ['colombia', 'bust'].includes(entry.kind));
  assert.ok(Math.max(...row.map((entry) => entry.position.z)) - Math.min(...row.map((entry) => entry.position.z)) < 1e-3, 'one row');
  const bottom = data.props.filter((entry) => entry.group === 'tech').slice(0, 4);
  assert.ok(Math.max(...bottom.map((entry) => entry.position.z)) - Math.min(...bottom.map((entry) => entry.position.z)) < 1e-3, 'tower row');
});

test('the about-me plaza holds the signs, a bust and the Colombian corner in front of them', async () => {
  const data = await outside();
  const plaza = data.floors.find((floor) => floor.id === 'about')!;
  assert.ok(plaza, 'Floor_About');
  const inside = (x: number, z: number) => Math.abs(x - plaza.position.x) < plaza.size[0] / 2 && Math.abs(z - plaza.position.z) < plaza.size[1] / 2;
  for (const sign of data.signs) assert.ok(inside(sign.position.x, sign.position.z), `${sign.id} in the plaza`);
  const signZ = data.signs[0].position.z;
  const kinds = new Map(data.decor.map((entry) => [entry.kind, entry]));
  for (const kind of ['bust', 'colombia', 'planter', 'lamp']) {
    const item = kinds.get(kind)!;
    assert.ok(item && inside(item.position.x, item.position.z), `${kind} in the plaza`);
    // In front of the sign zones and their titles, so it never hides a board.
    assert.ok(item.position.z > signZ + 4, `${kind} in front of the signs`);
  }
  assert.ok(kinds.get('colombia')!.position.x < kinds.get('bust')!.position.x);
  assert.ok(!kinds.has('vitrine') && !kinds.has('rack'), 'no glass case, no racks');
  assert.ok(!kinds.has('globe'), 'the globe gave way to the Colombian corner');
  assert.deepEqual(data.plaques.map((plaque) => plaque.id).sort(), ['bust', 'colombia']);
  for (const key of ['about.name', 'about.role', 'about.country', 'floor.about'] as MessageKey[]) {
    for (const language of ['es', 'en'] as const) assert.ok(MESSAGES[language][key], `${language} ${key}`);
  }
  assert.equal(MESSAGES.es['about.country'], 'Colombia');
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
