import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { Box3, Mesh, Texture, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const root = new URL('../', import.meta.url);

async function loadV3() {
  const buffer = await readFile(new URL('public/models/developer-v3.glb', root));
  assert.equal(buffer.toString('ascii', 0, 4), 'glTF');
  assert.equal(buffer.readUInt32LE(4), 2);
  assert.equal(buffer.readUInt32LE(8), buffer.byteLength);
  const document = JSON.parse(buffer.toString('utf8', 20, 20 + buffer.readUInt32LE(12)));
  assert.ok(document.buffers.every((entry: { uri?: string }) => !entry.uri));
  assert.ok(!document.images?.some((entry: { uri?: string }) => entry.uri));
  const loader = new GLTFLoader();
  loader.register(() => ({ name: 'HeadlessGeometryTextures', loadTexture: () => Promise.resolve(new Texture()) }));
  const gltf = await loader.parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '');
  return { gltf, document, buffer };
}

test('V3 has grounded T-pose geometry, detailed parts and bounded complexity', async (t) => {
  const { gltf, buffer } = await loadV3();
  gltf.scene.updateMatrixWorld(true);
  assert.equal(gltf.animations.length, 0);
  for (const name of ['Developer', 'Head', 'HairScalp', 'BeardContour', 'Forelock', 'BackwardCap', 'CapDoubleStitch', 'Hand_L', 'Hand_R', 'Hood', 'KangarooPocket']) {
    assert.ok(gltf.scene.getObjectByName(name), name);
  }
  const bounds = new Box3().setFromObject(gltf.scene, true);
  const size = bounds.getSize(new Vector3());
  assert.ok(size.x > 2.2 && size.x < 2.9, `T-pose span: ${size.x}`);
  assert.ok(size.y > 2.5 && size.y < 2.85, `Height: ${size.y}`);
  assert.ok(Math.abs(bounds.min.y) < 0.025, `Ground: ${bounds.min.y}`);
  for (const name of ['Hand_L', 'Hand_R']) {
    const hand = new Box3().setFromObject(gltf.scene.getObjectByName(name)!, true).getCenter(new Vector3());
    assert.ok(hand.y > 1.6 && hand.y < 1.85, `Hand level: ${hand.y}`);
  }
  let triangles = 0;
  let meshes = 0;
  gltf.scene.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    meshes++;
    const positions = object.geometry.getAttribute('position');
    assert.ok(Array.from(positions.array).every(Number.isFinite), object.name);
    assert.ok(object.geometry.getAttribute('normal'), object.name);
    triangles += (object.geometry.index?.count ?? positions.count) / 3;
  });
  assert.ok(triangles < 500000, `Triangles: ${triangles}`);
  assert.ok(buffer.length < 25 * 1024 * 1024);
  t.diagnostic(`V3: ${meshes} meshes, ${triangles} triangles, ${buffer.length} bytes`);
});

test('V3 embeds its fabric normal map as a valid PNG with UV coordinates', async () => {
  const { document, buffer } = await loadV3();
  assert.ok(document.images?.length > 0);
  const binaryStart = 20 + buffer.readUInt32LE(12) + 8;
  for (const image of document.images) {
    assert.equal(image.mimeType, 'image/png');
    const view = document.bufferViews[image.bufferView];
    assert.ok(view.byteLength > 24);
    const offset = binaryStart + (view.byteOffset ?? 0);
    assert.ok(offset + view.byteLength <= buffer.length);
    assert.deepEqual([...buffer.subarray(offset, offset + 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.ok(buffer.readUInt32BE(offset + 16) >= 128);
  }
  const normalMapped = document.materials.map((mat: { normalTexture?: object }, index: number) => mat.normalTexture ? index : -1).filter((index: number) => index >= 0);
  assert.ok(normalMapped.length > 0);
  for (const mesh of document.meshes) {
    for (const primitive of mesh.primitives) {
      if (normalMapped.includes(primitive.material)) assert.ok(primitive.attributes.TEXCOORD_0 !== undefined);
    }
  }
});

test('V3 has an independent editable source, turnarounds and detail renders', async () => {
  const blend = await readFile(new URL('assets/blender/developer-v3.blend', root));
  assert.equal(blend.toString('ascii', 0, 7), 'BLENDER');
  for (const view of ['front', 'back', 'left', 'right', 'three-quarter', 'violet', 'face-front', 'face-three-quarter', 'face-profile', 'hands', 'shoes']) {
    const png = await readFile(new URL(`assets/renders/character-v3/${view}.png`, root));
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.ok(png.readUInt32BE(16) >= 900);
    assert.ok(png.readUInt32BE(20) >= 900);
  }
});
