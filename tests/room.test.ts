import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { Box3, Mesh, Texture, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const root = new URL('../', import.meta.url);

async function loadRoom() {
  const buffer = await readFile(new URL('public/models/room.glb', root));
  assert.equal(buffer.toString('ascii', 0, 4), 'glTF');
  assert.equal(buffer.readUInt32LE(8), buffer.byteLength);
  const document = JSON.parse(buffer.toString('utf8', 20, 20 + buffer.readUInt32LE(12)));
  const loader = new GLTFLoader();
  // Named like the built-in WebP plugin so it replaces it: Node cannot decode images.
  loader.register(() => ({ name: 'EXT_texture_webp', loadTexture: () => Promise.resolve(new Texture()) }));
  const gltf = await loader.parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '');
  gltf.scene.updateMatrixWorld(true);
  return { gltf, document, buffer };
}

test('room GLB is a grounded diorama with every reference element and embedded textures', async (t) => {
  const { gltf, document, buffer } = await loadRoom();
  assert.ok(buffer.byteLength < 8 * 1024 * 1024, `Room bytes: ${buffer.byteLength}`);
  assert.ok(document.buffers.every((entry: { uri?: string }) => !entry.uri));
  assert.ok(document.images.length >= 9 && document.images.every((image: { uri?: string; bufferView?: number }) => !image.uri && image.bufferView !== undefined));
  assert.equal(gltf.animations.length, 0);
  assert.ok(!document.nodes.some((node: { camera?: number }) => node.camera !== undefined), 'No cameras in the room asset');
  for (const name of ['Room', 'Platform', 'Wall_Left', 'Wall_BackLow', 'BedFrame', 'Mattress', 'Duvet', 'Pillow_Back', 'Pillow_Front',
    'Nightstand', 'LampShade', 'Book_0', 'DeskTop', 'DeskMat', 'KeyboardCase', 'Mouse', 'Mug',
    'ChairSeat', 'ChairBack', 'Poster_cruzados', 'Poster_bug_hunter', 'Poster_merge_conflict', 'Poster_404', 'WindowGlass', 'NightCity']) {
    assert.ok(gltf.scene.getObjectByName(name), name);
  }
  for (const name of ['LaptopBase', 'LaptopLid', 'LaptopScreen']) {
    assert.equal(gltf.scene.getObjectByName(name), undefined, `${name}: the laptop is the separate laptop.glb, never duplicated in the room`);
  }
  const bounds = new Box3().setFromObject(gltf.scene, true);
  const size = bounds.getSize(new Vector3());
  assert.ok(size.x > 5.6 && size.x < 6.6 && size.z > 5.6 && size.z < 6.6, `Footprint ${size.toArray()}`);
  assert.ok(bounds.max.y > 3.3 && bounds.max.y < 3.7, `Wall height ${bounds.max.y}`);
  const floor = new Box3().setFromObject(gltf.scene.getObjectByName('Platform')!, true);
  assert.ok(Math.abs(floor.max.y + 0.06) < 0.01, `Floor boards sit on the platform top: ${floor.max.y}`);
  let meshes = 0;
  let triangles = 0;
  gltf.scene.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    meshes++;
    const positions = object.geometry.getAttribute('position');
    assert.ok(Array.from(positions.array as Float32Array).every(Number.isFinite), object.name);
    triangles += (object.geometry.index?.count ?? positions.count) / 3;
  });
  assert.ok(triangles < 250000, `Triangles ${triangles}`);
  t.diagnostic(`Room: ${meshes} meshes, ${triangles} triangles, ${buffer.byteLength} bytes`);
});

test('room exports seats, laptop spots, spawn, lights and colliders for the interaction phases', async () => {
  const { gltf } = await loadRoom();
  const node = (name: string) => {
    const found = gltf.scene.getObjectByName(name);
    assert.ok(found, name);
    return found;
  };
  const spawn = node('Spawn').getWorldPosition(new Vector3());
  assert.ok(Math.abs(spawn.y) < 0.001, 'Spawn on the floor');
  assert.equal(node('Anchor_ChairSeat').userData.seat, 'chair');
  assert.equal(node('Anchor_BedSeat').userData.seat, 'bed');
  assert.equal(node('Anchor_DeskLaptop').userData.laptop, 'desk');
  assert.equal(node('Anchor_BedLaptop').userData.laptop, 'bed');
  const seat = node('Anchor_ChairSeat').getWorldPosition(new Vector3());
  const chair = new Box3().setFromObject(node('ChairSeat'), true);
  assert.ok(Math.abs(seat.y - chair.max.y) < 0.01, 'Chair anchor on the seat surface');
  for (const name of ['Light_BedGlow', 'Light_WallGlow', 'BedLed_Front', 'BedLed_Foot', 'BedLed_Head', 'BedLed_Wall']) {
    assert.equal(gltf.scene.getObjectByName(name), undefined, `${name}: no violet glow under or behind the bed`);
  }
  for (const name of ['Light_Lamp', 'Light_Screen', 'Light_Window']) {
    const data = node(name).userData;
    assert.equal(data.light, 'point', name);
    assert.equal(data.color.length, 3, name);
    assert.ok(data.intensity > 0, name);
  }
  const colliders = ['WallLeft', 'WallBack', 'Bed', 'Nightstand', 'Desk', 'Chair'].map((name) => node(`Collider_${name}`));
  for (const collider of colliders) {
    assert.equal(collider.userData.collider, 'box');
    assert.ok(collider.userData.size.every((value: number) => value > 0), collider.name);
  }
  const spawnPoint = { x: spawn.x, z: spawn.z };
  for (const collider of colliders) {
    const center = collider.getWorldPosition(new Vector3());
    const [sx, sy] = collider.userData.size as number[];
    const inside = Math.abs(spawnPoint.x - center.x) < sx / 2 && Math.abs(spawnPoint.z - center.z) < sy / 2;
    assert.ok(!inside, `Spawn is clear of ${collider.name}`);
  }
});

test('room keeps its editable source, texture sources and review renders', async (t) => {
  const blend = await readFile(new URL('assets/blender/room.blend', root));
  assert.ok(['BLENDER', '\x28\xb5\x2f\xfd'].some((magic) => blend.toString('latin1', 0, magic.length) === magic));
  for (const name of ['poster_cruzados', 'poster_bug_hunter', 'poster_merge_conflict', 'poster_404', 'desk_mat', 'laptop_screen',
    'mug_art', 'circuit', 'wood', 'night_city']) {
    const png = await readFile(new URL(`assets/textures/room/${name}.png`, root));
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], name);
  }
  const reference = existsSync(new URL('assets/reference/room/room-reference.jpg', root));
  if (!reference) t.diagnostic('Private room reference not present; skipping the comparison sheet check');
  for (const name of ['diorama', 'diorama-empty', 'diorama-typing', 'diorama-bed', ...(reference ? ['compare-diorama'] : [])]) {
    const png = await readFile(new URL(`assets/renders/room/${name}.png`, root));
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], name);
  }
});
