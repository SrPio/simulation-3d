import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { Box3, Mesh, Texture, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const root = new URL('../', import.meta.url);
const originals = {
  'assets/blender/developer.blend': '26a349d248c316f05e77271a440caf2c13958332',
  'public/models/developer.glb': '6b6ea97c3a1194c0d24d7d02adea317ad354a346',
  'assets/renders/character/front.png': '3759740ac95e6e3963686145e9c026b2957391d8',
  'assets/renders/character/back.png': '4f6d79196865a900bc2126998f45f44592bb127a',
  'assets/renders/character/left.png': '0026897d6adf4365ac59d4184a9cfe06cf29b96b',
  'assets/renders/character/right.png': 'bea113cc8f94f269c425b599e6d693b928915709',
  'assets/renders/character/three-quarter.png': '140d976d473240341cb0c29b393a13e1463b23a8',
  'assets/renders/character/violet.png': 'db0b227becf14b1a0747c5298706ea21c267e164',
  'assets/blender/developer-v2.blend': 'f9d305e1837c032f16f6747a0f15e0a639b90f9d',
  'public/models/developer-v2.glb': 'c7a5cd219e8bfd8b73fa4736404422b252d5e4f6',
  'assets/renders/character-v2/front.png': '18b29f2bc8328f832e52722b17acb8da04604eec',
  'assets/renders/character-v2/back.png': '7826ffdb8d4d8f6f09a0cbedac8db95fd23eabe4',
  'assets/renders/character-v2/three-quarter.png': '64c5bdab7a4cb61a157ace76e5df70d1b40d40c7',
};

test('all pre-existing V1 and V2 models and renders are byte-for-byte preserved', async () => {
  for (const [path, hash] of Object.entries(originals)) {
    const bytes = await readFile(new URL(path, root));
    const actual = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    assert.equal(actual, hash, path);
  }
});

test('V2 is a distinct self-contained model with separate hair and beard, readable geometry and grounded feet', async () => {
  const { gltf, buffer } = await loadCharacter('developer-v2');
  const original = await loadCharacter();
  assert.ok(!buffer.equals(original.buffer));
  assert.ok(gltf.scene.getObjectByName('Developer'));
  for (const name of ['HairScalp', 'BeardContour', 'Hand_L', 'Hand_R', 'Hood', 'KangarooPocket']) {
    assert.ok(gltf.scene.getObjectByName(name), name);
  }
  assert.equal(gltf.animations.length, 0);
  const size = new Vector3();
  const bounds = new Box3().setFromObject(gltf.scene, true);
  bounds.getSize(size);
  assert.ok(size.y > 2.4 && size.y < 2.9, `Height: ${size.y}`);
  assert.ok(size.x > 1.1 && size.x < 1.9, `Width: ${size.x}`);
  assert.ok(Math.abs(bounds.min.y) < 0.025, `Ground: ${bounds.min.y}`);
  let triangles = 0;
  gltf.scene.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const positions = object.geometry.getAttribute('position');
    assert.ok(Array.from(positions.array).every(Number.isFinite), object.name);
    assert.ok(object.geometry.getAttribute('normal'), object.name);
    triangles += (object.geometry.index?.count ?? positions.count) / 3;
  });
  assert.ok(triangles < 350000, `Triangles: ${triangles}`);
  assert.ok(buffer.length < 20 * 1024 * 1024);
});

test('V2 has its own editable source and render set', async () => {
  const blend = await readFile(new URL('assets/blender/developer-v2.blend', root));
  assert.equal(blend.toString('ascii', 0, 7), 'BLENDER');
  for (const view of ['front', 'back', 'left', 'right', 'three-quarter', 'violet']) {
    const png = await readFile(new URL(`assets/renders/character-v2/${view}.png`, root));
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.ok(png.readUInt32BE(16) >= 640);
    assert.ok(png.readUInt32BE(20) >= 640);
  }
});

async function loadCharacter(version = 'developer') {
  const buffer = await readFile(new URL(`public/models/${version}.glb`, root));
  assert.equal(buffer.toString('ascii', 0, 4), 'glTF');
  assert.equal(buffer.readUInt32LE(4), 2);
  assert.equal(buffer.readUInt32LE(8), buffer.byteLength);
  const jsonSize = buffer.readUInt32LE(12);
  const document = JSON.parse(buffer.toString('utf8', 20, 20 + jsonSize));
  assert.ok(document.buffers.every((entry: { uri?: string }) => !entry.uri));
  assert.ok(!document.images?.some((entry: { uri?: string }) => entry.uri));
  const loader = new GLTFLoader();
  if (document.images?.length) {
    loader.register(() => ({ name: 'HeadlessGeometryTextures', loadTexture: () => Promise.resolve(new Texture()) }));
  }
  const gltf = await loader.parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '');
  return { gltf, document, buffer };
}

test('character is a self-contained GLB with a named root and no presentation props', async () => {
  const { gltf, buffer } = await loadCharacter();
  assert.ok(gltf.scene.getObjectByName('Developer'));
  assert.equal(gltf.animations.length, 0);
  assert.ok(buffer.byteLength < 20 * 1024 * 1024);
  for (const name of ['StudioFloor', 'StudioCamera', 'StudioKey', 'PresentationBase']) {
    assert.equal(gltf.scene.getObjectByName(name), undefined);
  }
});

test('character exports meters, feet at ground, finite geometry and readable materials', async () => {
  const { gltf } = await loadCharacter();
  gltf.scene.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(gltf.scene);
  const size = bounds.getSize(new Vector3());
  assert.ok(size.y > 2.2 && size.y < 2.9, `Height: ${size.y}`);
  assert.ok(size.x > 0.8 && size.x < 1.6, `Width: ${size.x}`);
  assert.ok(Math.abs(bounds.min.y) < 0.025, `Ground: ${bounds.min.y}`);
  let meshes = 0;
  let triangles = 0;
  const names = new Set<string>();
  gltf.scene.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    meshes++;
    const positions = object.geometry.getAttribute('position');
    assert.ok(positions.count > 0, object.name);
    assert.ok(Array.from(positions.array).every(Number.isFinite), object.name);
    assert.ok(object.geometry.getAttribute('normal'), object.name);
    triangles += (object.geometry.index?.count ?? positions.count) / 3;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      names.add(material.name);
    }
  });
  assert.ok(meshes >= 20, `Meshes: ${meshes}`);
  assert.ok(triangles < 250000, `Triangles: ${triangles}`);
  for (const name of ['Skin', 'Hoodie', 'CapBurgundy', 'Hair', 'Sole']) assert.ok(names.has(name), name);
});

test('editable Blender source and inspection renders exist', async () => {
  const blend = await readFile(new URL('assets/blender/developer.blend', root));
  assert.equal(blend.toString('ascii', 0, 7), 'BLENDER');
  for (const view of ['front', 'back', 'left', 'right', 'three-quarter', 'violet']) {
    const png = await readFile(new URL(`assets/renders/character/${view}.png`, root));
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.ok(png.readUInt32BE(16) >= 640);
    assert.ok(png.readUInt32BE(20) >= 640);
  }
});
