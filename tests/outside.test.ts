import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { Mesh, Texture } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CHARACTER_RADIUS, CharacterController, JUMP } from '../src/character/CharacterController.ts';
import { readOutside } from '../src/scene/outsideData.ts';
import { readRoom } from '../src/scene/roomData.ts';
import { overlaps, type Point2 } from '../src/world/collisions.ts';
import { PLATE_MARGIN, plateAt } from '../src/world/plates.ts';

async function load(file: string) {
  const data = await readFile(new URL(`../public/models/${file}.glb`, import.meta.url));
  const loader = new GLTFLoader();
  // Named like the built-in WebP plugin so it replaces it: Node cannot decode images.
  loader.register(() => ({ name: 'EXT_texture_webp', loadTexture: () => Promise.resolve(new Texture()) }));
  return { bytes: data, gltf: await loader.parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.length), '') };
}

function glbJson(bytes: Buffer) {
  const length = bytes.readUInt32LE(12);
  return JSON.parse(bytes.subarray(20, 20 + length).toString('utf8'));
}

const LINKS = { portfolio: 'https://andres-jaramillo.is-a.dev/', github: 'https://github.com/SrPio' };

test('outside GLB: dark ground around the open sides and two plates linking to the portfolio and GitHub', async () => {
  const { bytes, gltf } = await load('outside');
  const root = gltf.scene.getObjectByName('Outside');
  assert.ok(root, 'Outside root');
  assert.equal(gltf.scene.getObjectByName('Room'), undefined, 'the room stays in room.glb');
  assert.ok(bytes.length < 600_000, `outside.glb ${bytes.length} bytes`);
  const json = glbJson(bytes);
  assert.ok(json.extensionsUsed?.includes('EXT_texture_webp'), 'screenshots are embedded as WebP');
  assert.ok(json.images.length >= 2 && json.images.every((image: { mimeType: string }) => image.mimeType === 'image/webp'));
  const ground = ['Ground_Front', 'Ground_Side'].map((name) => gltf.scene.getObjectByName(name) as Mesh);
  for (const mesh of ground) {
    assert.ok(mesh instanceof Mesh, 'ground mesh');
    const color = (mesh.material as { color: { r: number; g: number; b: number } }).color;
    assert.ok(Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b) < 0.02, 'neutral grey, unlike the warm wood floor');
    assert.ok(color.r < 0.12, 'dark');
  }
  const { plates, bounds } = readOutside(gltf.scene);
  assert.deepEqual(Object.fromEntries(plates.map((plate) => [plate.id, plate.link])), LINKS);
  for (const plate of plates) {
    assert.ok(plate.label.length > 3, plate.id);
    assert.ok(plate.position.y > 0 && plate.position.y < 0.03, `${plate.id}: a thin plate on the floor`);
  }
  // The walkable area holds the whole room floor plus the ground outside it.
  const half = 2.9;
  assert.ok(bounds.minX <= -half && bounds.minZ <= -half && bounds.maxX > half + 4 && bounds.maxZ > half + 4, JSON.stringify(bounds));
});

test('plates sit outside the room, inside the walkable ground, and are detected with a margin', async () => {
  const { plates, bounds } = readOutside((await load('outside')).gltf.scene);
  for (const plate of plates) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const corner = {
        x: plate.position.x + sx * plate.halfX * plate.axisX.x + sz * plate.halfZ * plate.axisZ.x,
        z: plate.position.z + sx * plate.halfX * plate.axisX.z + sz * plate.halfZ * plate.axisZ.z,
      };
      assert.ok(corner.x > 3.0 || corner.z > 3.0, `${plate.id}: corner outside the room`);
      assert.ok(corner.x < bounds.maxX && corner.z < bounds.maxZ && corner.x > bounds.minX && corner.z > bounds.minZ, `${plate.id}: on the ground`);
    }
    const centre = { x: plate.position.x, z: plate.position.z };
    assert.equal(plateAt(centre, plates)?.id, plate.id);
    const edge = (distance: number): Point2 => ({ x: centre.x + plate.axisX.x * distance, z: centre.z + plate.axisX.z * distance });
    assert.equal(plateAt(edge(plate.halfX + 0.05), plates), undefined, 'not on it yet');
    assert.equal(plateAt(edge(plate.halfX + 0.05), plates, plate.id)?.id, plate.id, 'stays while drifting off the edge');
    assert.equal(plateAt(edge(plate.halfX + PLATE_MARGIN + 0.05), plates, plate.id), undefined, 'leaves past the margin');
  }
});

test('the character walks out of the room through its open sides onto a plate, but never through the walls', async () => {
  const room = readRoom((await load('room')).gltf.scene);
  const { plates, bounds } = readOutside((await load('outside')).gltf.scene);
  const portfolio = plates.find((plate) => plate.id === 'portfolio')!;
  const controller = new CharacterController(room.spawn, room.boxes, bounds);
  let current: string | undefined;
  for (let i = 0; i < 60 * 20 && current !== 'portfolio'; i++) {
    const dx = portfolio.position.x - controller.position.x;
    const dz = portfolio.position.z - controller.position.z;
    // Steer with a camera looking along the walk direction: forward only.
    controller.update(1 / 60, { forward: 1, right: 0, run: false }, Math.atan2(-dx, -dz));
    assert.equal(overlaps(controller.position, CHARACTER_RADIUS, room.boxes), undefined);
    current = plateAt(controller.position, plates, current)?.id;
  }
  assert.equal(current, 'portfolio', `reached the plate: ${JSON.stringify(controller.position)}`);
  // Walls on -X and -Z still hold, also from outside.
  for (const azimuth of [Math.PI / 2, 0]) {
    const walker = new CharacterController({ position: { x: 4, z: 4 }, yaw: 0 }, room.boxes, bounds);
    for (let i = 0; i < 60 * 25; i++) walker.update(1 / 60, { forward: 1, right: 0, run: true }, azimuth);
    assert.ok(walker.position.x >= bounds.minX + CHARACTER_RADIUS - 1e-6 && walker.position.z >= bounds.minZ + CHARACTER_RADIUS - 1e-6);
    assert.equal(overlaps(walker.position, CHARACTER_RADIUS, room.boxes), undefined);
  }
});

test('jump: a short hop forward while airborne, no double jump, and walls still stop it', () => {
  const controller = new CharacterController({ position: { x: 0, z: 0 }, yaw: 0 }, [], 50);
  assert.ok(controller.jump());
  assert.equal(controller.jump(), false, 'no jump while in the air');
  let airborne = 0;
  let t = 0;
  for (; controller.jumping && t < 3; t += 1 / 60) {
    const before = controller.position.z;
    assert.equal(controller.update(1 / 60, { forward: 0, right: 1, run: false }, 0), controller.jumping ? 'jump' : 'idle');
    if (controller.airborne) airborne++;
    else if (controller.jumping) assert.ok(Math.abs(controller.position.z - before) < 1e-9 || controller.position.z - before < 0.03, 'crouch and landing stay in place');
  }
  assert.ok(Math.abs(t - JUMP.duration) < 0.05, `lasts the clip: ${t}`);
  assert.ok(airborne > 10);
  assert.ok(Math.abs(controller.position.z - JUMP.distance) < 0.03, `forward along the facing: ${controller.position.z}`);
  assert.ok(Math.abs(controller.position.x) < 1e-9, 'keys do not steer in the air');
  const wall = { name: 'wall', minX: -1, maxX: 1, minZ: 0.5, maxZ: 0.6 };
  const blocked = new CharacterController({ position: { x: 0, z: 0 }, yaw: 0 }, [wall], 50);
  blocked.jump();
  for (let i = 0; i < 60; i++) blocked.update(1 / 60, { forward: 0, right: 0, run: false }, 0);
  for (let i = 0; i < 2; i++) { blocked.jump(); for (let j = 0; j < 60; j++) blocked.update(1 / 60, { forward: 0, right: 0, run: false }, 0); }
  assert.ok(blocked.position.z <= 0.5 - CHARACTER_RADIUS + 1e-6, `stopped by the wall: ${blocked.position.z}`);
});

test('the jump in the controller matches the rig manifest', async () => {
  const manifest = JSON.parse(await readFile(new URL('../public/models/developer-v4-rig.manifest.json', import.meta.url), 'utf8'));
  const jump = manifest.clips.find((clip: { name: string }) => clip.name === 'jump');
  assert.ok(Math.abs(jump.duration - JUMP.duration) < 1e-9);
  assert.deepEqual(jump.air, JUMP.air);
  assert.equal(jump.distance, JUMP.distance);
});
