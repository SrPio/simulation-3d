import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { Texture } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { readOutside } from '../src/scene/outsideData.ts';

async function parse() {
  const data = await readFile(new URL('../public/models/outside.glb', import.meta.url));
  const loader = new GLTFLoader();
  loader.register(() => ({ name: 'EXT_texture_webp', loadTexture: () => Promise.resolve(new Texture()) }));
  return loader.parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.length), '');
}

test('a few trails of footprints where they were marked; the prints leaving the room stay as they were', async () => {
  const gltf = await parse();
  const data = readOutside(gltf.scene);
  const room = data.floors.filter((floor) => floor.id === 'footprints');
  assert.equal(room.length, 1);
  assert.deepEqual([room[0].position.x, room[0].position.z, ...room[0].size].map((value) => +value.toFixed(3)), [4.45, 4.45, 3.3, 3.3]);
  const trails = data.floors.filter((floor) => floor.id === 'prints');
  assert.equal(trails.length, 5);
  for (const trail of trails) {
    assert.ok(trail.steps.length >= 4 && trail.steps.length <= 8, `${trail.steps.length} steps`);
    for (const step of trail.steps) {
      assert.ok(Math.abs(step.x - trail.position.x) <= trail.size[0] / 2 && Math.abs(step.z - trail.position.z) <= trail.size[1] / 2, 'inside its block');
    }
    // Steps follow each other: no gap wider than a stride and a half.
    for (let i = 1; i < trail.steps.length; i++) {
      const gap = Math.hypot(trail.steps[i].x - trail.steps[i - 1].x, trail.steps[i].z - trail.steps[i - 1].z);
      assert.ok(gap > 0.3 && gap < 1.3, `stride ${gap.toFixed(2)} m`);
    }
  }
});

test('the crossroads is a round bed of grass round the lamppost, with nothing painted on it', async () => {
  const gltf = await parse();
  const data = readOutside(gltf.scene);
  const green = gltf.scene.getObjectByName('CrossroadsGreen');
  assert.ok(green && data.lamppost, 'green and lamppost');
  assert.ok(Math.hypot(green.position.x - data.lamppost.position.x, green.position.z - data.lamppost.position.z) < 1e-3, 'centred on the lamppost');
  // The crossroads block only carries the lamppost's arrows now.
  const crossroads = data.floors.find((floor) => floor.id === 'crossroads')!;
  assert.deepEqual(crossroads.labels, ['about', 'playground']);
  assert.ok(!data.floors.some((floor) => floor.id === 'playground'), 'no floor sign');
});

test('a car circuit runs round the zones as one flat band of the zones\' fill, inside the walkable ground', async () => {
  const gltf = await parse();
  const data = readOutside(gltf.scene);
  const circuits = data.floors.filter((floor) => floor.id === 'circuit');
  assert.equal(circuits.length, 1);
  const [circuit] = circuits;
  assert.equal(circuit.gap, 3.5);
  assert.ok(circuit.targets.length > 50, `${circuit.targets.length} points`);
  const half = circuit.gap / 2;
  for (const [i, point] of circuit.targets.entries()) {
    assert.ok(Math.abs(point.x - circuit.position.x) + half <= circuit.size[0] / 2 && Math.abs(point.z - circuit.position.z) + half <= circuit.size[1] / 2, 'inside its block');
    assert.ok(point.x - half >= data.bounds.minX && point.x + half <= data.bounds.maxX && point.z - half >= data.bounds.minZ && point.z + half <= data.bounds.maxZ, `walkable at ${point.x}, ${point.z}`);
    if (i > 0) {
      const previous = circuit.targets[i - 1];
      assert.ok(Math.hypot(point.x - previous.x, point.z - previous.z) < 2, 'continuous');
    }
    // It goes round the plaza and the playground, never across them.
    for (const zone of data.floors.filter((floor) => floor.id === 'about' || floor.id === 'playarea')) {
      const inside = Math.abs(point.x - zone.position.x) < zone.size[0] / 2 + half && Math.abs(point.z - zone.position.z) < zone.size[1] / 2 + half;
      assert.ok(!inside, `${zone.id} at ${point.x}, ${point.z}`);
    }
  }
});
