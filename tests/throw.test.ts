import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import * as cannon from 'cannon-es';
import { AnimationMixer, Texture, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { THROW_CLIP, THROW_HAND, THROW_RELEASE } from '../src/character/CharacterController.ts';
import { MAX_THROWN, PropPhysics } from '../src/world/PropPhysics.ts';

test('the laptop leaves the right hand above the head and in front of it while the throwing arm whips forward', async () => {
  const bytes = await readFile(new URL('../public/models/developer-v4-interactions.glb', import.meta.url));
  const loader = new GLTFLoader();
  loader.register(() => ({ name: 'EXT_texture_webp', loadTexture: () => Promise.resolve(new Texture()) }));
  const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length), '');
  const clip = gltf.animations.find((animation) => animation.name === THROW_CLIP);
  assert.ok(clip, THROW_CLIP);
  assert.ok(THROW_RELEASE > 0 && THROW_RELEASE < clip.duration);
  const mixer = new AnimationMixer(gltf.scene);
  mixer.clipAction(clip).play();
  const hand = gltf.scene.getObjectByName(THROW_HAND);
  assert.ok(hand, THROW_HAND);
  const at = (time: number) => {
    mixer.setTime(time);
    gltf.scene.updateMatrixWorld(true);
    return hand.getWorldPosition(new Vector3());
  };
  const rest = at(0);
  const release = at(THROW_RELEASE);
  const after = at(THROW_RELEASE + 1 / 30);
  // The character faces +Z, so its right side is -X: that hand is ahead of the body and above the head, moving forward.
  assert.ok(release.z > 0.4, `hand ${release.z.toFixed(2)} m ahead`);
  assert.ok(release.y > rest.y + 0.8, `hand raised to ${release.y.toFixed(2)} m`);
  assert.ok(release.x < 0, `the right hand (x ${release.x.toFixed(2)})`);
  assert.ok(after.z > release.z + 0.1, 'still whipping forward');
});

test(`at most ${MAX_THROWN} thrown laptops: each throw past that retires the oldest`, () => {
  const physics = new PropPhysics(cannon, [], [], 0);
  const throwOne = (x: number) => physics.throwLaptop({ position: { x, y: 1, z: 0 }, quaternion: new cannon.Quaternion() }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
  const first = throwOne(0);
  for (let i = 1; i < MAX_THROWN; i++) throwOne(i * 2);
  assert.equal(physics.laptops.length, MAX_THROWN);
  assert.equal(physics.retired.length, 0);
  throwOne(10);
  assert.equal(physics.laptops.length, MAX_THROWN);
  assert.deepEqual(physics.retired, [first]);
  assert.ok(!physics.world.bodies.includes(first.base) && !physics.world.bodies.includes(first.lid), 'its bodies left the world');
  physics.reset();
  assert.equal(physics.laptops.length, 0);
});
