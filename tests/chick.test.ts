import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { test } from 'node:test';
import { Box3, Mesh, Vector3, type Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KONAMI, pushKonami } from '../src/input/KeyboardInput.ts';
import { RAIN, chickDrop } from '../src/scene/ChickRain.ts';
import { seeded } from '../src/scene/graffitiData.ts';
import { CHICK, MAX_CHICKS, PropPhysics } from '../src/world/PropPhysics.ts';

const file = new URL('../public/models/chick.glb', import.meta.url);

async function chick(): Promise<Object3D> {
  const data = await readFile(file);
  return (await new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.length), '')).scene;
}

test('chick.glb: a small yellow chick in black sunglasses, feet on the ground, facing +Z', async () => {
  assert.ok((await stat(file)).size < 150_000, 'small enough to fetch on the first Konami code');
  const scene = await chick();
  assert.ok(scene.getObjectByName('Chick'), 'Chick root');
  const materials = new Set<string>();
  let triangles = 0;
  scene.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    materials.add(object.material.name);
    triangles += (object.geometry.index?.count ?? object.geometry.getAttribute('position').count) / 3;
  });
  for (const name of ['ChickFeathers', 'ChickBeak', 'ChickFrames', 'ChickLenses']) assert.ok(materials.has(name), name);
  assert.ok(triangles < 6000, `${triangles} triangles: light enough to draw ${MAX_CHICKS} at once`);
  const box = new Box3().setFromObject(scene);
  const size = box.getSize(new Vector3());
  assert.ok(Math.abs(box.min.y) < 0.03, `feet at the origin (${box.min.y.toFixed(3)})`);
  assert.ok(size.y > 0.35 && size.y < 0.5, `about 0.4 m tall (${size.y.toFixed(2)})`);
  // The sunglasses and the beak are on the front (+Z after export), not the back.
  for (const name of ['ChickLens_1', 'ChickBeakTop']) {
    const part = new Box3().setFromObject(scene.getObjectByName(name)!);
    assert.ok(part.max.z > box.max.z - 0.03, `${name} at the front`);
  }
});

test('the Konami code is typed once, wherever it starts and however often the first key is pressed', () => {
  const recent: string[] = [];
  const type = (codes: readonly string[]) => codes.map((code) => pushKonami(recent, code)).filter(Boolean).length;
  assert.equal(type(KONAMI), 1);
  assert.equal(recent.length, 0, 'emptied after a match');
  assert.equal(type(['KeyW', 'ArrowUp', ...KONAMI]), 1, 'with other keys and an extra up before it');
  assert.equal(type(KONAMI.slice(0, 9)), 0, 'not without the A');
  assert.equal(type(['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'KeyA', 'KeyB']), 0, 'A before B does not count');
});

test('chicks fall round the character, land and rock back onto their feet', async () => {
  const random = seeded(5);
  const groundY = -0.12;
  const physics = await PropPhysics.load([], [], groundY);
  for (let i = 0; i < 12; i++) {
    const drop = chickDrop(random, { x: 3, z: -2 }, groundY);
    const distance = Math.hypot(drop.feet.x - 3, drop.feet.z + 2);
    assert.ok(distance >= RAIN.near - 1e-9 && distance <= RAIN.far + 1e-9, `${distance.toFixed(2)} m from the character`);
    assert.ok(drop.feet.y >= groundY + RAIN.low && drop.feet.y <= groundY + RAIN.high && drop.velocity.y < 0);
    physics.dropChick(drop.feet, drop.yaw, drop.velocity, drop.spin);
  }
  for (let t = 0; t < 12; t += 1 / 60) physics.step(1 / 60, undefined);
  for (const body of physics.chicks) {
    const q = body.quaternion;
    const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
    assert.ok(upY > 0.9, `upright (${upY.toFixed(2)})`);
    assert.ok(Math.abs(body.position.y - (groundY + CHICK.centre - CHICK.low)) < 0.06, `standing on the ground (${body.position.y.toFixed(3)})`);
  }
  // A full shower more than fills the cap: the oldest leave for the viewer to shrink away.
  for (let i = 0; i < MAX_CHICKS; i++) {
    const drop = chickDrop(random, { x: 0, z: 0 }, groundY);
    physics.dropChick(drop.feet, drop.yaw, drop.velocity, drop.spin);
  }
  assert.equal(physics.chicks.length, MAX_CHICKS);
  assert.equal(physics.retiredChicks.length, 12);
  physics.reset();
  assert.equal(physics.chicks.length, 0, 'Restablecer takes them all away');
});
