import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { AnimationMixer, Box3, LoopOnce, SkinnedMesh, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

async function loadRig() {
  const bytes = await readFile(new URL('../public/models/developer-v1-rig.glb', import.meta.url));
  return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length), '');
}

function update(scene) {
  scene.updateMatrixWorld(true);
  scene.traverse((object) => { if (object instanceof SkinnedMesh) object.skeleton.update(); });
}

test('the separate V1 rig contains complete weighted meshes and three named clips', async () => {
  const { scene, animations } = await loadRig();
  assert.deepEqual(animations.map((clip) => clip.name).sort(), ['idle', 'run', 'walk']);
  for (const name of ['DeveloperRig', 'root', 'pelvis', 'head', 'upper_arm_L', 'forearm_R', 'thigh_L', 'shin_R', 'foot_L', 'finger_R_0']) {
    assert.ok(scene.getObjectByName(name), name);
  }
  let meshes = 0;
  scene.traverse((object) => {
    if (!(object instanceof SkinnedMesh)) return;
    meshes++;
    const weights = object.geometry.getAttribute('skinWeight');
    const indices = object.geometry.getAttribute('skinIndex');
    assert.ok(weights && indices, object.name);
    for (let i = 0; i < weights.count; i++) {
      const values = [weights.getX(i), weights.getY(i), weights.getZ(i), weights.getW(i)];
      assert.ok(values.every((value) => Number.isFinite(value) && value >= 0));
      assert.ok(Math.abs(values.reduce((a, b) => a + b, 0) - 1) < 0.0001, object.name);
    }
  });
  assert.ok(meshes > 20);
  for (const clip of animations) {
    assert.ok(clip.duration > 0.4 && clip.duration <= 4, clip.name);
    for (const track of clip.tracks) {
      assert.ok(Array.from(track.values).every(Number.isFinite));
      const stride = track.getValueSize();
      for (let i = 0; i < stride; i++) {
        assert.ok(Math.abs(track.values[i] - track.values[track.values.length - stride + i]) < 0.0001, `${clip.name}: loop seam ${track.name}`);
      }
    }
  }
});

test('animated samples are finite, in-place, do not sink through the floor and move the legs', async () => {
  const { scene, animations } = await loadRig();
  const mixer = new AnimationMixer(scene);
  for (const clip of animations) {
    mixer.stopAllAction();
    const action = mixer.clipAction(clip).reset().setLoop(LoopOnce, 1).play();
    action.clampWhenFinished = true;
    const legSamples: number[] = [];
    for (let i = 0; i < 12; i++) {
      mixer.setTime(clip.duration * i / 12);
      update(scene);
      const bounds = new Box3().setFromObject(scene, true);
      const size = bounds.getSize(new Vector3());
      assert.ok([...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite), clip.name);
      assert.ok(bounds.min.y > -0.025, `${clip.name}: floor ${bounds.min.y}`);
      assert.ok(size.y > 2 && size.y < 2.9 && size.x < 1.8 && size.z < 1.6, `${clip.name}: exploded geometry ${size.toArray()}`);
      const root = scene.getObjectByName('root')!.getWorldPosition(new Vector3());
      assert.ok(Math.abs(root.x) < 0.0001 && Math.abs(root.z) < 0.0001, clip.name);
      legSamples.push(scene.getObjectByName('foot_L')!.getWorldPosition(new Vector3()).z);
    }
    if (clip.name !== 'idle') assert.ok(Math.max(...legSamples) - Math.min(...legSamples) > 0.2, clip.name);
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(scene);
});

test('rig source and review poses are independent deliverables', async () => {
  const source = await readFile(new URL('../assets/blender/developer-v1-rig.blend', import.meta.url));
  assert.equal(source.toString('ascii', 0, 7), 'BLENDER');
  for (const name of ['idle', 'walk', 'run']) {
    const png = await readFile(new URL(`../assets/renders/character-v1-rig/${name}.png`, import.meta.url));
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  }
});
