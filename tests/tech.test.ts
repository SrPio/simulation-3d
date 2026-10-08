import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import * as cannon from 'cannon-es';
import { Texture } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MESSAGES, type MessageKey } from '../src/core/i18n.ts';
import { readOutside, type OutsideData } from '../src/scene/outsideData.ts';
import { PropPhysics } from '../src/world/PropPhysics.ts';

async function outside(): Promise<OutsideData> {
  const data = await readFile(new URL('../public/models/outside.glb', import.meta.url));
  const loader = new GLTFLoader();
  loader.register(() => ({ name: 'EXT_texture_webp', loadTexture: () => Promise.resolve(new Texture()) }));
  const gltf = await loader.parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.length), '');
  return readOutside(gltf.scene);
}

const TOOLS = ['typescript', 'node', 'pnpm', 'vite', 'three', 'github', 'playwright', 'blender', 'gltf', 'openvdb'];
const far = { x: 100, y: -0.12, z: 100 };

test('the tech tower: ten logo cubes in a 4-3-2-1 pyramid, each tool with its label in both languages', async () => {
  const data = await outside();
  const cubes = data.props.filter((piece) => piece.group === 'tech');
  assert.deepEqual(cubes.map((cube) => cube.tech), TOOLS);
  const rows = Object.groupBy(cubes, (cube) => cube.position.y.toFixed(2));
  assert.deepEqual(Object.values(rows).map((row) => row!.length).sort().reverse(), [4, 3, 2, 1]);
  for (const cube of cubes) {
    assert.ok(cube.parts.every((part) => part.map && part.geometry.getAttribute('uv')), `${cube.name} shows its logo`);
    for (const language of ['es', 'en'] as const) assert.ok(MESSAGES[language][`tech.${cube.tech}` as MessageKey], `${language} label for ${cube.tech}`);
  }
  assert.ok(data.zones.some((zone) => zone.target === 'tech'), 'a reset zone');
});

test('the tower stands still until struck; a full punch brings cubes down and the reset stacks it again', async () => {
  const data = await outside();
  const cubes = data.props.filter((piece) => piece.group === 'tech');
  const physics = new PropPhysics(cannon, cubes, [], data.groundY);
  const centre = cubes[0].position.clone().add(cubes[3].position).multiplyScalar(0.5);
  for (let i = 0; i < 120; i++) physics.step(1 / 60, { x: centre.x + 1.5, y: data.groundY, z: centre.z + 1.5 });
  assert.equal(physics.fallen(['tech']), 0, 'it holds up on its own');
  assert.equal(physics.active, false);
  // A punch from in front of the tower, at the height of its second row.
  const from = { x: centre.x, z: centre.z + 0.9 };
  const hits = physics.strike(from, { x: centre.x, y: data.groundY + 0.95, z: centre.z + 0.35 }, { x: 0, z: -1 }, 1);
  assert.ok(hits >= 1, `${hits} cubes hit`);
  for (let i = 0; i < 60 * 4; i++) physics.step(1 / 60, far);
  assert.ok(physics.fallen(['tech']) >= 2, `${physics.fallen(['tech'])} cubes down`);
  physics.reset('tech');
  assert.equal(physics.fallen(['tech']), 0);
  assert.equal(physics.active, false);
});
