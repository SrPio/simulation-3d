import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { Box3, Texture } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as cannon from 'cannon-es';
import { PropPhysics } from '../src/world/PropPhysics.ts';
import { readOutside } from '../src/scene/outsideData.ts';
import { REVEAL_TIME, hiddenBehind, rayHitsBox, revealStep } from '../src/world/reveal.ts';

async function parse(file: string) {
  const data = await readFile(new URL(`../public/models/${file}.glb`, import.meta.url));
  const loader = new GLTFLoader();
  loader.register(() => ({ name: 'EXT_texture_webp', loadTexture: () => Promise.resolve(new Texture()) }));
  return loader.parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.length), '');
}

/** The default corner view: the camera sits towards +X, up and +Z (ROOM_VIEW). */
const toCamera = (() => {
  const length = Math.hypot(1, 0.95, 1);
  return { x: 1 / length, y: 0.95 / length, z: 1 / length };
})();

test('the room hides the character only behind its walls, never inside it or in front of it', async () => {
  const box = new Box3().setFromObject((await parse('room')).scene);
  const room = { min: box.min, max: box.max };
  const at = (x: number, z: number) => ({ x, y: -0.12, z });
  assert.ok(hiddenBehind(at(-4, -4), toCamera, room), 'behind the corner');
  assert.ok(hiddenBehind(at(-4, 0), toCamera, room), 'behind the left wall');
  assert.ok(hiddenBehind(at(0, -4), toCamera, room), 'behind the back wall');
  assert.ok(!hiddenBehind(at(0, 0), toCamera, room), 'inside the room');
  assert.ok(!hiddenBehind(at(5, 5), toCamera, room), 'in front of the room');
  assert.ok(!hiddenBehind(at(-4, 8), toCamera, room), 'off to the left, nothing in the way');
  assert.ok(!hiddenBehind(at(-14, -14), toCamera, room), 'far behind: the ray passes over the walls');
  assert.ok(rayHitsBox({ x: -1, y: 0.5, z: 0 }, { x: 1, y: 0, z: 0 }, { min: { x: 0, y: 0, z: -1 }, max: { x: 1, y: 1, z: 1 } }));
  assert.ok(!rayHitsBox({ x: 2, y: 0.5, z: 0 }, { x: 1, y: 0, z: 0 }, { min: { x: 0, y: 0, z: -1 }, max: { x: 1, y: 1, z: 1 } }), 'behind the ray start');
});

test('the window opens and shuts over REVEAL_TIME, at once with reduced motion', () => {
  assert.equal(revealStep(0, true, REVEAL_TIME / 2, false), 0.5);
  assert.equal(revealStep(0.5, true, REVEAL_TIME, false), 1);
  assert.equal(revealStep(1, false, REVEAL_TIME / 4, false), 0.75);
  assert.equal(revealStep(0, true, 0.001, true), 1);
  assert.equal(revealStep(1, false, 0.001, true), 0);
});

test('cardboard boxes carry four flaps hinged on their rim that stay shut at rest and swing open when the box tips over', async () => {
  const data = readOutside((await parse('outside')).scene);
  const boxes = data.props.filter((piece) => piece.flaps);
  assert.ok(boxes.length >= 4, `${boxes.length} boxes`);
  for (const box of boxes) {
    assert.equal(box.flaps!.length, 4, box.name);
    assert.ok(!box.parts.some((part) => box.flaps!.some((flap) => flap.geometry === part.geometry)), 'flaps are not body parts');
    for (const flap of box.flaps!) {
      assert.ok(Math.abs(flap.position.y - box.half[1]) < 0.03, `${box.name}: hinge on the rim`);
      assert.ok(Math.abs(Math.max(Math.abs(flap.position.x), Math.abs(flap.position.z)) - box.half[0]) < 1e-3, `${box.name}: on an edge`);
    }
  }
  // One box on its own: at rest its flaps stay shut and everything falls asleep.
  const box = boxes.find((entry) => entry.position.y < data.groundY + 0.4)!;
  const physics = new PropPhysics(cannon, [box], [], data.groundY);
  const near = { x: box.position.x + 1.2, y: data.groundY, z: box.position.z + 1.2 };
  for (let i = 0; i < 120; i++) physics.step(1 / 60, near);
  for (let k = 0; k < 4; k++) assert.ok(Math.abs(physics.flapAngle(0, k)) < 0.05, `flap ${k} shut: ${physics.flapAngle(0, k).toFixed(3)}`);
  // Tossed up spinning, it lands on its side and its flaps swing open on their own, each on its hinge.
  const body = physics.bodies[0];
  body.wakeUp();
  body.position.y += 0.8;
  body.angularVelocity.set(0, 0, 6);
  body.velocity.set(1.5, 0, 0);
  for (let i = 0; i < 60 * 4; i++) physics.step(1 / 60, { x: 100, y: 0, z: 100 });
  const angles = [0, 1, 2, 3].map((k) => physics.flapAngle(0, k));
  assert.ok(angles.filter((angle) => angle > 0.6).length >= 1, `flaps opened: ${angles.map((angle) => angle.toFixed(2))}`);
  assert.ok(angles.every((angle) => angle > -0.03), 'never through the box');
  physics.reset();
  for (let k = 0; k < 4; k++) assert.ok(Math.abs(physics.flapAngle(0, k)) < 1e-6, 'shut again after a reset');
});
