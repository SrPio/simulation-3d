import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { AnimationMixer, Box3, LoopOnce, SkinnedMesh, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { InteractionState } from '../src/interactions/interactionState.ts';

async function load(file: string) {
  const data = await readFile(new URL(`../public/models/${file}.glb`, import.meta.url));
  return new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.length), '');
}

test('seat and laptop transitions reject incompatible commands and stow before standing', () => {
  for (const seat of ['chair', 'bed'] as const) {
    const state = new InteractionState();
    assert.ok(state.setSeat(seat));
    assert.equal(state.command('laptop'), false);
    assert.ok(state.command('sit'));
    assert.equal(state.command('sit'), false);
    assert.equal(state.command('stand'), false);
    assert.equal(state.setSeat('chair'), false);
    state.finish();
    assert.equal(state.stage, 'seated');
    assert.ok(state.command('laptop'));
    assert.equal(state.command('laptop'), false);
    state.finish();
    assert.equal(state.clip, `typing_${seat}`);
    assert.equal(state.finish(), false);
    assert.ok(state.command('stand'));
    assert.equal(state.stage, 'stowing');
    state.finish();
    assert.equal(state.stage, 'standing');
    state.finish();
    assert.equal(state.stage, 'idle');
    state.reset();
    assert.ok(state.can('sit'));
  }
});

test('phase 2A source and GLB remain byte-for-byte unchanged', async () => {
  for (const [file, expected] of Object.entries({
    'assets/blender/developer-v1-rig.blend': 'f3f7f646845af68eca9574e18753612e053234c9',
    'public/models/developer-v1-rig.glb': 'c8f40eb48595a68aaffd92af38bd72c1a47ea89c',
  })) {
    const bytes = await readFile(new URL(`../${file}`, import.meta.url));
    assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), expected);
  }
});

test('interaction GLB contains all seat/laptop clips and finite grounded poses', async () => {
  const { scene, animations } = await load('developer-v1-interactions');
  assert.equal(animations.length, 15);
  const mixer = new AnimationMixer(scene);
  for (const seat of ['chair', 'bed']) {
    for (const action of ['sit_down', 'seated', 'stand_up', 'laptop_draw', 'typing', 'laptop_stow']) {
      const name = `${action}_${seat}`;
      const clip = animations.find((entry) => entry.name === name);
      assert.ok(clip, name);
      mixer.stopAllAction();
      const playback = mixer.clipAction(clip).reset().setLoop(LoopOnce, 1).play();
      playback.clampWhenFinished = true;
      for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
        mixer.setTime(clip.duration * progress);
        scene.updateMatrixWorld(true);
        scene.traverse((object) => { if (object instanceof SkinnedMesh) object.skeleton.update(); });
        const bounds = new Box3().setFromObject(scene, true);
        const size = bounds.getSize(new Vector3());
        assert.ok(bounds.min.y > -0.025, `${name}: floor ${bounds.min.y}`);
        assert.ok(size.x < 1.8 && size.y > 1.7 && size.y < 2.9 && size.z < 1.7, `${name}: ${size.toArray()}`);
        for (const track of clip.tracks) assert.ok(Array.from(track.values).every(Number.isFinite), track.name);
      }
    }
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(scene);
});

test('laptop is a separate asset with one hinge, keyboard and display', async () => {
  const { scene } = await load('laptop');
  for (const name of ['Laptop', 'LaptopHinge', 'LaptopBase', 'Keyboard', 'Trackpad', 'Display']) assert.ok(scene.getObjectByName(name), name);
  assert.equal(scene.getObjectByName('Developer'), undefined);
  const size = new Box3().setFromObject(scene).getSize(new Vector3());
  assert.ok(size.x > 0.4 && size.x < 0.45 && size.y < 0.06 && size.z < 0.3);
});
