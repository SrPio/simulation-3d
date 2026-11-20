import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { test } from 'node:test';
import { Box3, Mesh, SkinnedMesh, Vector3, type AnimationClip, type Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const file = new URL('../public/models/canela.glb', import.meta.url);

async function load(): Promise<{ scene: Object3D; animations: AnimationClip[] }> {
  const data = await readFile(file);
  return new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.length), '');
}

async function canela(): Promise<Object3D> {
  return (await load()).scene;
}

test('canela.glb: a lemon beagle in a red collar with her name tag, paws on the ground, facing +Z', async () => {
  assert.ok((await stat(file)).size < 940_000, 'light enough to fetch when she is invited (only then)');
  const scene = await canela();
  const root = scene.getObjectByName('Canela');
  assert.ok(root, 'Canela root');
  const materials = new Set<string>();
  let triangles = 0;
  scene.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    materials.add(object.material.name);
    triangles += (object.geometry.index?.count ?? object.geometry.getAttribute('position').count) / 3;
  });
  for (const name of ['CanelaFur', 'CanelaEar', 'CanelaNose', 'CanelaEye', 'CanelaCollar', 'CanelaTag', 'CanelaTagName']) {
    assert.ok(materials.has(name), name);
  }
  assert.ok(triangles < 26_000, `${triangles} triangles`);
  const box = new Box3().setFromObject(scene);
  const size = box.getSize(new Vector3());
  assert.ok(Math.abs(box.min.y) < 0.01, `paws at the origin (${box.min.y.toFixed(3)})`);
  assert.ok(size.y > 0.8 && size.y < 0.95, `head about 0.88 m high beside the 2.67 m character (${size.y.toFixed(2)})`);
  assert.ok(size.z > 0.85 && size.z < 1.0, `about 0.9 m from nose to tail (${size.z.toFixed(2)})`);
  assert.ok(Math.abs(root.userData.withers - 0.575) < 0.01, 'withers height kept for the rig');

  // The coat is painted on the body: only white and light brown, both present.
  const body = scene.getObjectByName('Canela_Body') as Mesh;
  const colors = body.geometry.getAttribute('color');
  assert.ok(colors, 'vertex colours on the body');
  let white = 0;
  let brown = 0;
  for (let i = 0; i < colors.count; i++) {
    const [r, g, b] = [colors.getX(i), colors.getY(i), colors.getZ(i)];
    assert.ok(r >= g - 1e-3 && g >= b - 1e-3, 'between white and brown, no other hue');
    if (b > 0.7) white++;
    else if (b < 0.2) brown++;
  }
  assert.ok(white > colors.count * 0.25 && brown > colors.count * 0.2, `white ${white}, brown ${brown} of ${colors.count}`);

  // Nose, name tag and both ears where they belong: the nose leads, the tag hangs under the collar at the chest.
  const part = (name: string) => new Box3().setFromObject(scene.getObjectByName(name)!);
  assert.ok(part('Canela_Nose').max.z > box.max.z - 0.01, 'nose at the very front');
  const tag = part('Canela_TagName');
  const collar = part('Canela_Collar');
  assert.ok(tag.max.y < collar.min.y + 0.02 && tag.min.z > 0.25, 'the name hangs below the collar, in front of the chest');
  assert.ok(Math.abs(tag.min.x + tag.max.x) < 0.005, 'the name is centred');
  for (const side of ['L', 'R']) {
    const ear = part(`Canela_Ear_${side}`);
    assert.ok(ear.max.y - ear.min.y > 0.22, `ear ${side} hangs long`);
  }
  // The tail stands up: its white tip is well above the back.
  assert.ok(box.min.z < -0.38, 'tail behind');
});

test('canela.glb is rigged: a skinned body, ears and collar on their bones, and her clips', async () => {
  const { scene, animations } = await load();
  const body = scene.getObjectByName('Canela_Body');
  assert.ok(body instanceof SkinnedMesh, 'the body is skinned');
  const bones = new Set(body.skeleton.bones.map((bone) => bone.name));
  for (const name of ['root', 'pelvis', 'spine', 'chest', 'neck1', 'neck2', 'head', 'earL', 'earR', 'tail1', 'tail2', 'tail3',
    'f_upperL', 'f_lowerL', 'f_pawL', 'h_thighR', 'h_shinR', 'h_hockR', 'h_pawR']) assert.ok(bones.has(name), name);
  // Rigid parts hang from their bones, so they move with them.
  // The ears are skinned to a chain of three bones each, so they bend; each chain hangs on its own side of the head.
  const head = scene.getObjectByName('head')!.getWorldPosition(new Vector3());
  for (const side of ['L', 'R']) {
    const ear = scene.getObjectByName(`Canela_Ear_${side}`);
    assert.ok(ear instanceof SkinnedMesh, `ear ${side} is skinned`);
    const chain = [`ear${side}`, `ear1${side}`, `ear2${side}`];
    assert.deepEqual(chain.map((name) => scene.getObjectByName(name)?.parent?.name), ['head', ...chain.slice(0, 2)]);
    const flap = new Box3().setFromObject(ear).getCenter(new Vector3());
    const root = scene.getObjectByName(chain[0])!.getWorldPosition(new Vector3());
    assert.ok(Math.sign(flap.x - head.x) === Math.sign(root.x - head.x), `ear ${side} hangs from its own side`);
    assert.ok(Math.abs(root.x - flap.x) < 0.12, `ear ${side} hangs from the top of its flap`);
  }
  assert.equal(scene.getObjectByName('Canela_Collar')?.parent?.name, 'neck1');
  assert.equal(scene.getObjectByName('Canela_Nose')?.parent?.name, 'head');
  assert.equal(scene.getObjectByName('Canela_Mouth')?.parent?.name, 'head');
  const names = animations.map((clip) => clip.name).sort();
  assert.deepEqual(names, ['idle', 'jump', 'pickup', 'run', 'sit', 'walk']);
});
