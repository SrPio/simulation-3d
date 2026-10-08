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

test('V4 rig is fully skinned with seamless idle, walk and run loops and a jump that starts and ends standing', async () => {
  const { scene, animations } = await loadRig();
  assert.deepEqual(animations.map((clip) => clip.name).sort(), ['idle', 'jump', 'run', 'walk']);
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
  assert.deepEqual(manifest.clips.map((clip: { name: string }) => clip.name), ['idle', 'walk', 'run', 'jump']);
  const jump = manifest.clips.find((clip: { name: string }) => clip.name === 'jump');
  assert.equal(jump.loop, false);
  assert.ok(jump.distance > 0.2 && jump.distance < 0.8, 'a short hop');
});

/** World positions of every vertex of the matching skinned meshes, after posing. */
function vertices(scene: Object3D, pattern: RegExp): Vector3[] {
  const out: Vector3[] = [];
  scene.traverse((object) => {
    if (!(object instanceof SkinnedMesh) || !pattern.test(object.name)) return;
    const positions = object.geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) out.push(object.getVertexPosition(i, new Vector3()).applyMatrix4(object.matrixWorld));
  });
  return out;
}

test('V4 arms hang close to the body at rest and while walking, without cutting into it', async () => {
  const { scene, animations } = await loadRig();
  // Torso half width (hoodie and trousers) in the bind pose, where the T-pose arms are out of the way.
  scene.traverse((object) => { if (object instanceof SkinnedMesh) object.skeleton.pose(); });
  pose(scene);
  const torso = vertices(scene, /^(Hoodie|Pants)$/).filter((point) => point.y < 1.6 && point.y > 0.7);
  const halfWidth = (y: number) => Math.max(...torso.filter((point) => Math.abs(point.y - y) < 0.03).map((point) => Math.abs(point.x)));
  const mixer = new AnimationMixer(scene);
  for (const name of ['idle', 'walk']) {
    const clip = animations.find((entry) => entry.name === name)!;
    mixer.stopAllAction();
    mixer.clipAction(clip).reset().setLoop(LoopOnce, 1).play().clampWhenFinished = true;
    for (let i = 0; i < 8; i++) {
      mixer.setTime(clip.duration * i / 8);
      pose(scene);
      for (const side of ['L', 'R']) {
        const hand = vertices(scene, new RegExp(`^Hand_${side}$`));
        const inner = Math.min(...hand.map((point) => Math.abs(point.x)));
        const height = hand.reduce((sum, point) => sum + point.y, 0) / hand.length;
        const body = halfWidth(height);
        assert.ok(inner > body + 0.005, `${name} ${side} frame ${i}: hand ${inner.toFixed(3)} cuts into the body (${body.toFixed(3)})`);
        assert.ok(inner < body + 0.09, `${name} ${side} frame ${i}: hand ${inner.toFixed(3)} hangs away from the body (${body.toFixed(3)})`);
        const wrist = scene.getObjectByName(`hand_${side}`)!.getWorldPosition(new Vector3());
        assert.ok(Math.abs(wrist.x) < 0.42, `${name} ${side} frame ${i}: wrist ${wrist.x.toFixed(3)} close to the hips`);
      }
    }
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(scene);
});

test('V4 jump crouches, leaves the floor and lands back on it', async () => {
  const { scene, animations } = await loadRig();
  const manifest = JSON.parse(await readFile(new URL('public/models/developer-v4-rig.manifest.json', root), 'utf8'));
  const [takeOff, landing] = manifest.clips.find((clip: { name: string }) => clip.name === 'jump').air;
  const clip = animations.find((entry) => entry.name === 'jump')!;
  const mixer = new AnimationMixer(scene);
  mixer.clipAction(clip).reset().setLoop(LoopOnce, 1).play().clampWhenFinished = true;
  const lowest = (fraction: number) => {
    mixer.setTime(clip.duration * fraction);
    pose(scene);
    return new Box3().setFromObject(scene, true).min.y;
  };
  // In time order: a clamped one-shot action stops updating once it has reached its end.
  const grounded = (fraction: number) => {
    const floor = lowest(fraction);
    assert.ok(floor > -0.025 && floor < 0.03, `feet on the floor at ${fraction}: ${floor}`);
  };
  grounded(0);
  grounded(0.1);
  assert.ok(scene.getObjectByName('pelvis')!.getWorldPosition(new Vector3()).y < 0.97, 'crouches before pushing off');
  grounded(takeOff - 0.02);
  assert.ok(lowest((takeOff + landing) / 2) > 0.12, 'airborne at the top of the hop');
  grounded(landing + 0.03);
  grounded(0.9);
  grounded(1);
  mixer.stopAllAction();
  mixer.uncacheRoot(scene);
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
      if (clip.name !== 'jump') assert.ok(hand.y < 1.45,`${clip.name}: hand height ${hand.y}`);
      const rootBone = scene.getObjectByName('root')!.getWorldPosition(new Vector3());
      assert.ok(Math.abs(rootBone.x) < 0.0001 && Math.abs(rootBone.z) < 0.0001, `${clip.name}: in place`);
      feet.push(scene.getObjectByName('foot_L')!.getWorldPosition(new Vector3()).z);
    }
    if (!['idle', 'jump'].includes(clip.name)) assert.ok(Math.max(...feet) - Math.min(...feet) > 0.2, `${clip.name}: stride`);
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

test('UAL clips are seamless, in place and grounded; walks and runs keep the arms lowered and match their speeds', async () => {
  const bytes = await readFile(new URL('public/models/developer-v4-interactions.glb', root));
  const { scene, animations } = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length), '');
  const manifest = JSON.parse(await readFile(new URL('public/models/developer-v4-interactions.manifest.json', root), 'utf8'));
  const { CLIP_ALTERNATIVES, DEFAULT_GAIT_CLIPS } = await import('../src/character/CharacterController.ts');
  const clips = animations.filter((clip) => clip.name.includes('_ual'));
  // The throw and the punch are not locomotion, so they have no CLIP_ALTERNATIVES entry.
  assert.deepEqual(clips.map((clip) => clip.name).sort(), [...Object.keys(CLIP_ALTERNATIVES), 'throw_ual', 'punch_ual'].sort());
  for (const gait of ['walk', 'run', 'jump'] as const) {
    const name = DEFAULT_GAIT_CLIPS[gait];
    assert.ok(name === gait || CLIP_ALTERNATIVES[name]?.gait === gait, `default ${gait}: ${name}`);
  }
  assert.deepEqual(DEFAULT_GAIT_CLIPS, { walk: 'walk_ual', run: 'run_ual_sprint', jump: 'jump_ual' });
  const bones = ['thigh_L', 'thigh_R', 'shin_L', 'shin_R'].map((name) => scene.getObjectByName(name)!);
  const feet = ['foot_L', 'foot_R'].map((name) => scene.getObjectByName(name)!);
  pose(scene);
  const hinge = (bone: Object3D) => new Vector3(1, 0, 0).applyQuaternion(bone.getWorldQuaternion(new Quaternion()));
  const along = (bone: Object3D) => new Vector3(0, 1, 0).applyQuaternion(bone.getWorldQuaternion(new Quaternion())).y;
  const restHinge = bones.map(hinge);
  const restAlong = feet.map(along);
  const mixer = new AnimationMixer(scene);
  for (const clip of clips) {
    const entry = manifest.clips.find((item: { name: string }) => item.name === clip.name);
    const alternative = CLIP_ALTERNATIVES[clip.name];
    const gait = alternative?.gait ?? clip.name.replace('_ual', '');
    const cycle = gait === 'walk' || gait === 'run';
    assert.ok(clip.name.startsWith(gait) && entry.source.includes('CC0') && entry.loop === cycle, clip.name);
    if (cycle) assert.ok(Math.abs(entry.speed - alternative.speed!) < 1e-9, `${clip.name}: speed`);
    if (gait === 'jump') {
      assert.deepEqual({ duration: entry.duration, air: entry.air, distance: entry.distance }, alternative.jump, `${clip.name}: jump timing`);
      assert.ok(entry.air[0] > 0.05 && entry.air[1] < 0.6 && entry.air[1] - entry.air[0] > 0.15, `${clip.name}: air ${entry.air}`);
      // Long and high enough: over half a second off the floor.
      assert.ok((entry.air[1] - entry.air[0]) * entry.duration > 0.5 && entry.distance >= 0.9, `${clip.name}: air time and distance`);
    }
    assert.ok(Math.abs(entry.duration - clip.duration) < 1e-3, `${clip.name}: duration`);
    mixer.stopAllAction();
    const action = mixer.clipAction(clip).reset().setLoop(LoopOnce, 1).play();
    action.clampWhenFinished = true;
    const sampleHand = (time: number) => { mixer.setTime(time); pose(scene); return scene.getObjectByName('hand_L')!.getWorldPosition(new Vector3()); };
    // Loops close their cycle; one-shot clips start and end on the idle frame.
    assert.ok(sampleHand(0).distanceTo(sampleHand(clip.duration)) < 0.005, `${clip.name}: seam`);
    action.reset().play(); // a finished one-shot action ignores later setTime calls
    const stride: number[] = [];
    for (let i = 0; i < 24; i++) {
      mixer.setTime(clip.duration * i / 24);
      pose(scene);
      const bounds = new Box3().setFromObject(scene, true);
      const size = bounds.getSize(new Vector3());
      assert.ok(bounds.min.y > -0.025, `${clip.name} frame ${i}: floor ${bounds.min.y}`);
      // Jump_Loop opens the arms in the air (about 2.05 m); a T-pose spans over 2.3 m.
      assert.ok(size.x < (cycle ? 1.6 : 2.1) && size.y > (cycle ? 2.3 : 1.9) && size.y < (cycle ? 2.8 : 3.1), `${clip.name} frame ${i}: arms lowered, intact ${size.toArray()}`);
      for (const side of cycle ? ['L', 'R'] : []) {
        const hand = scene.getObjectByName(`hand_${side}`)!.getWorldPosition(new Vector3()).y;
        // The forward swing of the jog brings the wrist about 1 cm higher than the procedural clips allow.
        assert.ok(hand < 1.5, `${clip.name} frame ${i}: hand ${side} height ${hand}`);
      }
      const rootBone = scene.getObjectByName('root')!.getWorldPosition(new Vector3());
      assert.ok(Math.abs(rootBone.x) < 0.0001 && Math.abs(rootBone.z) < 0.0001, `${clip.name}: in place`);
      // The throwing lunge splays the legs sideways, tilting the hinge more than a stride does.
      bones.forEach((bone, index) => assert.ok(hinge(bone).dot(restHinge[index]) > (cycle ? 0.95 : 0.85), `${clip.name} ${bone.name} frame ${i}: knee hinge twisted`));
      feet.forEach((foot, index) => assert.ok(along(foot) - restAlong[index] < 0.02, `${clip.name} ${foot.name} frame ${i}: toe tilts up`));
      stride.push(feet[0].getWorldPosition(new Vector3()).z);
    }
    if (cycle) assert.ok(Math.max(...stride) - Math.min(...stride) > 0.4, `${clip.name}: stride ${Math.max(...stride) - Math.min(...stride)}`);
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(scene);
});
