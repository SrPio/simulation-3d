import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { AnimationMixer, Box3, LoopOnce, Mesh, type Object3D, Quaternion, SkinnedMesh, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const root = new URL('../', import.meta.url);

test('V4 web GLB is grounded, reference-scaled, complete and within its size budget', async (t) => {
  const buffer = await readFile(new URL('public/models/developer-v4.glb', root));
  assert.equal(buffer.toString('ascii', 0, 4), 'glTF');
  assert.equal(buffer.readUInt32LE(8), buffer.byteLength);
  assert.ok(buffer.byteLength < 10 * 1024 * 1024, `GLB bytes: ${buffer.byteLength}`);
  const document = JSON.parse(buffer.toString('utf8', 20, 20 + buffer.readUInt32LE(12)));
  assert.ok(document.buffers.every((entry: { uri?: string }) => !entry.uri));
  assert.ok(!document.extensionsUsed?.includes('KHR_materials_sheen'), 'Sheen greys out the black fabrics in three.js');
  const gltf = await new GLTFLoader().parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '');
  gltf.scene.updateMatrixWorld(true);
  assert.equal(gltf.animations.length, 0);
  for (const name of ['Developer', 'Head', 'Beard', 'Moustache', 'Eyebrows', 'Eye_L', 'Eye_R', 'Hair', 'HairTuft',
    'CapCrown', 'CapBrim', 'CapStrap', 'Hoodie', 'Pants', 'Hand_L', 'Hand_R', 'ShoeUpper_L', 'ShoeUpper_R',
    'ShoeSole_L', 'ShoeSole_R', 'ShoeStripe_L', 'ShoeStripe_R']) {
    assert.ok(gltf.scene.getObjectByName(name), name);
  }
  const bounds = new Box3().setFromObject(gltf.scene, true);
  const size = bounds.getSize(new Vector3());
  assert.ok(size.y > 2.6 && size.y < 2.75, `Height: ${size.y}`);
  assert.ok(size.x > 2.3 && size.x < 2.55, `T-pose span: ${size.x}`);
  assert.ok(Math.abs(bounds.min.y) < 0.01, `Ground: ${bounds.min.y}`);
  const face = new Box3().setFromObject(gltf.scene.getObjectByName('Eye_L')!, true).getCenter(new Vector3());
  assert.ok(face.z > 0.2, `Faces +Z after export (eye z ${face.z})`);
  let triangles = 0;
  gltf.scene.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const positions = object.geometry.getAttribute('position');
    assert.ok(Array.from(positions.array as Float32Array).every(Number.isFinite), object.name);
    assert.ok(object.geometry.getAttribute('normal'), object.name);
    triangles += (object.geometry.index?.count ?? positions.count) / 3;
  });
  assert.ok(triangles < 400000, `Triangles: ${triangles}`);
  t.diagnostic(`V4: ${triangles} triangles, ${buffer.byteLength} bytes`);
});

test('V4 keeps its editable sources, calibrated references and review renders', async (t) => {
  for (const name of ['developer-v4.blend', 'developer-v4-rig.blend']) {
    const blend = await readFile(new URL(`assets/blender/${name}`, root));
    assert.ok(['BLENDER', '\x28\xb5\x2f\xfd'].some((magic) => blend.toString('latin1', 0, magic.length) === magic), name);
  }
  for (const clip of ['idle', 'walk', 'run']) {
    for (const view of ['three-quarter', 'left']) {
      const png = await readFile(new URL(`assets/renders/character-v4-rig/${clip}-${view}.png`, root));
      assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${clip}-${view}`);
    }
  }
  for (const view of ['front', 'back', 'left', 'right', 'three-quarter', 'face-front', 'face-profile',
    'face-three-quarter', 'hands', 'shoes']) {
    const png = await readFile(new URL(`assets/renders/character-v4/${view}.png`, root));
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], view);
  }
  // Reference photos and the comparison sheets built from them are private and not versioned.
  if (!existsSync(new URL('assets/reference/v4/', root))) {
    t.diagnostic('Private V4 reference photos not present; skipping reference and comparison checks');
    return;
  }
  for (const name of ['full-front.jpg', 'head-closeup.jpg', 'side-back.jpg']) {
    const jpg = await readFile(new URL(`assets/reference/v4/${name}`, root));
    assert.deepEqual([...jpg.subarray(0, 2)], [0xff, 0xd8]);
  }
  for (const view of ['compare-front', 'compare-left', 'compare-back']) {
    const png = await readFile(new URL(`assets/renders/character-v4/${view}.png`, root));
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], view);
  }
});

async function loadRig() {
  const bytes = await readFile(new URL('public/models/developer-v4-rig.glb', root));
  return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length), '');
}

function pose(scene: Object3D) {
  scene.updateMatrixWorld(true);
  scene.traverse((object) => { if (object instanceof SkinnedMesh) object.skeleton.update(); });
}

test('V4 rig is fully skinned with seamless idle, walk and run loops', async () => {
  const { scene, animations } = await loadRig();
  assert.deepEqual(animations.map((clip) => clip.name).sort(), ['idle', 'run', 'walk']);
  for (const name of ['DeveloperRig', 'root', 'pelvis', 'chest', 'head', 'clavicle_L', 'upper_arm_R', 'forearm_L',
    'hand_R', 'finger_L_0', 'thumb_R', 'thigh_L', 'shin_R', 'foot_L']) {
    assert.ok(scene.getObjectByName(name), name);
  }
  let skinned = 0;
  scene.traverse((object) => {
    if (object instanceof Mesh && !(object instanceof SkinnedMesh)) assert.fail(`${object.name} is not skinned`);
    if (!(object instanceof SkinnedMesh)) return;
    skinned++;
    const weights = object.geometry.getAttribute('skinWeight');
    for (let i = 0; i < weights.count; i++) {
      const sum = weights.getX(i) + weights.getY(i) + weights.getZ(i) + weights.getW(i);
      assert.ok(Math.abs(sum - 1) < 0.001, `${object.name}: weight sum ${sum}`);
    }
  });
  assert.ok(skinned >= 40, `Skinned meshes: ${skinned}`);
  for (const clip of animations) {
    for (const track of clip.tracks) {
      const stride = track.getValueSize();
      for (let i = 0; i < stride; i++) {
        assert.ok(Math.abs(track.values[i] - track.values[track.values.length - stride + i]) < 0.0001, `${clip.name}: seam ${track.name}`);
      }
    }
  }
  const manifest = JSON.parse(await readFile(new URL('public/models/developer-v4-rig.manifest.json', root), 'utf8'));
  assert.equal(manifest.source, 'developer-v4-rig.glb');
  assert.deepEqual(manifest.clips.map((clip: { name: string }) => clip.name), ['idle', 'walk', 'run']);
});

test('V4 clips lower the T-pose arms, stay in place above the floor and move the legs', async () => {
  const { scene, animations } = await loadRig();
  const mixer = new AnimationMixer(scene);
  for (const clip of animations) {
    mixer.stopAllAction();
    mixer.clipAction(clip).reset().setLoop(LoopOnce, 1).play().clampWhenFinished = true;
    const feet: number[] = [];
    for (let i = 0; i < 12; i++) {
      mixer.setTime(clip.duration * i / 12);
      pose(scene);
      const bounds = new Box3().setFromObject(scene, true);
      const size = bounds.getSize(new Vector3());
      assert.ok(bounds.min.y > -0.025, `${clip.name}: floor ${bounds.min.y}`);
      assert.ok(size.x < 1.6 && size.y > 2.4 && size.y < 2.8, `${clip.name}: arms lowered, intact ${size.toArray()}`);
      const hand = scene.getObjectByName('hand_R')!.getWorldPosition(new Vector3());
      assert.ok(hand.y < 1.45, `${clip.name}: hand height ${hand.y}`);
      const rootBone = scene.getObjectByName('root')!.getWorldPosition(new Vector3());
      assert.ok(Math.abs(rootBone.x) < 0.0001 && Math.abs(rootBone.z) < 0.0001, `${clip.name}: in place`);
      feet.push(scene.getObjectByName('foot_L')!.getWorldPosition(new Vector3()).z);
    }
    if (clip.name !== 'idle') assert.ok(Math.max(...feet) - Math.min(...feet) > 0.2, `${clip.name}: stride`);
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(scene);
});

test('V4 legs swing on their knee hinge without twisting around the bone', async () => {
  const { scene, animations } = await loadRig();
  const bones = ['thigh_L', 'thigh_R', 'shin_L', 'shin_R'].map((name) => scene.getObjectByName(name)!);
  pose(scene);
  const hinge = (bone: Object3D) => new Vector3(1, 0, 0).applyQuaternion(bone.getWorldQuaternion(new Quaternion()));
  const rest = bones.map(hinge);
  const mixer = new AnimationMixer(scene);
  for (const clip of animations) {
    mixer.stopAllAction();
    mixer.clipAction(clip).reset().setLoop(LoopOnce, 1).play().clampWhenFinished = true;
    for (let i = 0; i < 24; i++) {
      mixer.setTime(clip.duration * i / 24);
      pose(scene);
      bones.forEach((bone, index) => {
        const alignment = hinge(bone).dot(rest[index]);
        assert.ok(alignment > 0.95, `${clip.name} ${bone.name} frame ${i}: hinge turned ${Math.round(Math.acos(Math.min(1, alignment)) * 180 / Math.PI)}°`);
      });
    }
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(scene);
});

test('V4 feet never tip the toe up while stepping', async () => {
  const { scene, animations } = await loadRig();
  const feet = ['foot_L', 'foot_R'].map((name) => scene.getObjectByName(name)!);
  pose(scene);
  const along = (bone: Object3D) => new Vector3(0, 1, 0).applyQuaternion(bone.getWorldQuaternion(new Quaternion())).y;
  const rest = feet.map(along);
  const mixer = new AnimationMixer(scene);
  for (const clip of animations) {
    mixer.stopAllAction();
    mixer.clipAction(clip).reset().setLoop(LoopOnce, 1).play().clampWhenFinished = true;
    for (let i = 0; i < 24; i++) {
      mixer.setTime(clip.duration * i / 24);
      pose(scene);
      feet.forEach((foot, index) => {
        const lift = along(foot) - rest[index];
        assert.ok(lift < 0.02, `${clip.name} ${foot.name} frame ${i}: toe tilts up (${lift.toFixed(3)})`);
      });
    }
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(scene);
});
