import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { Texture, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CharacterController, MAX_STEP, RUN_SPEED, WALK_SPEED } from '../src/character/CharacterController.ts';
import { overlaps, resolve, sweep, type Box2 } from '../src/world/collisions.ts';

const still = { forward: 0, right: 0, run: false };
const forward = { forward: 1, right: 0, run: false };

async function roomBoxes() {
  const data = await readFile(new URL('../public/models/room.glb', import.meta.url));
  const loader = new GLTFLoader();
  // Named like the built-in WebP plugin so it replaces it: Node cannot decode images.
  loader.register(() => ({ name: 'EXT_texture_webp', loadTexture: () => Promise.resolve(new Texture()) }));
  const { scene } = await loader.parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.length), '');
  scene.updateMatrixWorld(true);
  const boxes: Box2[] = [];
  scene.traverse((object) => {
    if (object.userData.collider !== 'box') return;
    const centre = object.getWorldPosition(new Vector3());
    const [sx, sy] = object.userData.size as number[];
    boxes.push({ name: object.name, minX: centre.x - sx / 2, maxX: centre.x + sx / 2, minZ: centre.z - sy / 2, maxZ: centre.z + sy / 2 });
  });
  const spawn = scene.getObjectByName('Spawn')!.getWorldPosition(new Vector3());
  return { boxes, spawn: { x: spawn.x, z: spawn.z }, half: Number(scene.getObjectByName('Room')!.userData.half_size) };
}

test('locomotion speeds match the walk and run clips in the rig manifest', async () => {
  const manifest = JSON.parse(await readFile(new URL('../public/models/developer-v4-rig.manifest.json', import.meta.url), 'utf8'));
  const speed = (name: string) => manifest.clips.find((clip: { name: string }) => clip.name === name).speed;
  assert.ok(Math.abs(speed('walk') - WALK_SPEED) < 1e-9);
  assert.ok(Math.abs(speed('run') - RUN_SPEED) < 1e-9);
});

test('movement follows the camera and diagonals are not faster than straight lines', () => {
  for (const azimuth of [0, Math.PI / 4, 1.2]) {
    const ahead = CharacterController.direction(forward, azimuth);
    assert.ok(Math.abs(ahead.x + Math.sin(azimuth)) < 1e-9 && Math.abs(ahead.z + Math.cos(azimuth)) < 1e-9, 'W walks away from the camera');
    const right = CharacterController.direction({ forward: 0, right: 1, run: false }, azimuth);
    assert.ok(Math.abs(ahead.x * right.x + ahead.z * right.z) < 1e-9, 'D is perpendicular to W');
    const diagonal = CharacterController.direction({ forward: 1, right: 1, run: false }, azimuth);
    assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.z) - 1) < 1e-9, 'diagonal is normalized');
  }
  const open = new CharacterController({ position: { x: 0, z: 0 }, yaw: 0 }, [], 50);
  const diagonal = new CharacterController({ position: { x: 0, z: 0 }, yaw: 0 }, [], 50);
  for (let i = 0; i < 120; i++) {
    open.update(1 / 60, forward, 0);
    diagonal.update(1 / 60, { forward: 1, right: 1, run: false }, 0);
  }
  assert.ok(Math.abs(Math.hypot(open.position.x, open.position.z) - Math.hypot(diagonal.position.x, diagonal.position.z)) < 1e-6);
});

test('speed, turning and clip choice are frame-rate independent and settle to idle', () => {
  const run = (fps: number) => {
    const controller = new CharacterController({ position: { x: 0, z: 0 }, yaw: 0 }, [], 50);
    for (let t = 0; t < 2; t += 1 / fps) controller.update(1 / fps, { forward: 1, right: 0, run: true }, Math.PI / 2);
    return controller;
  };
  const fast = run(144);
  const slow = run(30);
  assert.equal(fast.locomotion(), 'run');
  assert.ok(Math.abs(fast.speed - RUN_SPEED) < 0.01);
  assert.ok(Math.abs(fast.position.x - slow.position.x) < 0.05, `${fast.position.x} vs ${slow.position.x}`);
  assert.ok(Math.abs(Math.sin(fast.yaw) + 1) < 0.01, 'turned to face the walking direction');
  assert.ok(Math.abs(fast.clipRate() - 1) < 0.01, 'clip plays at authored speed at full run');
  for (let i = 0; i < 90; i++) fast.update(1 / 60, still, 0);
  assert.equal(fast.locomotion(), 'idle');
  assert.equal(fast.speed, 0);
  const walker = new CharacterController({ position: { x: 0, z: 0 }, yaw: 0 }, [], 50);
  for (let i = 0; i < 120; i++) walker.update(1 / 60, forward, 0);
  assert.equal(walker.locomotion(), 'walk');
  const hitch = new CharacterController({ position: { x: 0, z: 0 }, yaw: 0 }, [], 50);
  hitch.update(5, forward, 0);
  assert.ok(Math.hypot(hitch.position.x, hitch.position.z) <= WALK_SPEED * MAX_STEP + 1e-9, 'a long frame is clamped');
});

test('collisions slide along boxes and long moves cannot tunnel through thin furniture', () => {
  const wall: Box2 = { name: 'wall', minX: -0.05, maxX: 0.05, minZ: -5, maxZ: 5 };
  const pushed = resolve({ x: 0.1, z: 0 }, 0.3, [wall]);
  assert.ok(Math.abs(pushed.x - 0.35) < 1e-9 && pushed.z === 0);
  const through = sweep({ x: -1, z: 0 }, { x: 2, z: 0.5 }, 0.3, [wall], 10);
  assert.ok(through.x <= -0.35 + 1e-9, `blocked on its side: ${through.x}`);
  assert.ok(through.z > 0.4, 'kept the motion along the wall (slide)');
  const inside = resolve({ x: 0.02, z: 0 }, 0.3, [wall]);
  assert.ok(!overlaps(inside, 0.3, [wall]), 'a centre inside a box is pushed out');
});

test('in the room the character walks into furniture and walls without entering them', async () => {
  const { boxes, spawn, half } = await roomBoxes();
  assert.ok(boxes.length >= 6);
  assert.equal(overlaps(spawn, 0.3, boxes), undefined, 'spawn is clear');
  for (let heading = 0; heading < 8; heading++) {
    const azimuth = heading * Math.PI / 4;
    const controller = new CharacterController({ position: spawn, yaw: 0 }, boxes, half);
    for (let i = 0; i < 60 * 12; i++) {
      controller.update(1 / 60, { forward: 1, right: 0.3, run: true }, azimuth);
      const hit = overlaps(controller.position, controller.radius, boxes);
      assert.equal(hit, undefined, `heading ${heading}: inside ${hit?.name} at ${JSON.stringify(controller.position)}`);
      assert.ok(Math.abs(controller.position.x) <= half - 0.3 + 1e-6 && Math.abs(controller.position.z) <= half - 0.3 + 1e-6, 'stays on the floor');
    }
  }
  const controller = new CharacterController({ position: spawn, yaw: 0 }, boxes, half);
  for (let i = 0; i < 100; i++) controller.update(1 / 60, forward, 0.4);
  controller.reset();
  assert.deepEqual(controller.position, spawn);
});
