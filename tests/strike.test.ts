import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import * as cannon from 'cannon-es';
import { AnimationMixer, LoopOnce, Texture, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { STRIKE_CHARGE, STRIKE_MIN_POWER, STRIKES, strikeCharge, strikeLaunch, strikePower } from '../src/character/CharacterController.ts';
import { PropPhysics, STRIKE_RADIUS } from '../src/world/PropPhysics.ts';

const root = new URL('../', import.meta.url);

test('punch and kick: timing matches the manifest, the limb draws back while charging and the blow lands in front', async () => {
  const bytes = await readFile(new URL('public/models/developer-v4-interactions.glb', root));
  const manifest = JSON.parse(await readFile(new URL('public/models/developer-v4-interactions.manifest.json', root), 'utf8'));
  const loader = new GLTFLoader();
  loader.register(() => ({ name: 'EXT_texture_webp', loadTexture: () => Promise.resolve(new Texture()) }));
  const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length), '');
  const mixer = new AnimationMixer(gltf.scene);
  for (const [kind, spec] of Object.entries(STRIKES)) {
    const entry = manifest.clips.find((clip: { name: string }) => clip.name === spec.clip);
    assert.ok(entry?.strike, `${spec.clip} in the manifest`);
    const { clip: _clip, reach: _reach, ...timing } = spec;
    assert.deepEqual(timing, entry.strike, `${kind}: timing`);
    const clip = gltf.animations.find((animation) => animation.name === spec.clip);
    assert.ok(clip, spec.clip);
    assert.ok(0 < spec.ready && spec.ready < spec.windup && spec.windup < spec.release && spec.release < spec.hit && spec.hit < clip.duration, `${kind}: stretches in order`);
    mixer.stopAllAction();
    const action = mixer.clipAction(clip).reset().setLoop(LoopOnce, 1).play();
    action.clampWhenFinished = true;
    const bone = gltf.scene.getObjectByName(spec.bone)!;
    const at = (time: number) => {
      mixer.setTime(time);
      gltf.scene.updateMatrixWorld(true);
      return bone.getWorldPosition(new Vector3());
    };
    const rest = at(0);
    const ready = at(spec.ready);
    const windup = at(spec.windup);
    const hit = at(spec.hit);
    // The character faces +Z; its right side (the striking one) is -X. Charging draws the fist or foot back.
    assert.ok(windup.z < ready.z - 0.2, `${kind}: draws back from ${ready.z.toFixed(2)} to ${windup.z.toFixed(2)}`);
    assert.ok(at(strikeCharge(spec, STRIKE_CHARGE / 4)).z < ready.z - 0.05, `${kind}: already drawing back at a quarter charge`);
    assert.ok(hit.z > windup.z + 0.5 && hit.z > rest.z + 0.25, `${kind}: forward from ${windup.z.toFixed(2)} to ${hit.z.toFixed(2)}`);
    assert.ok(hit.x < 0.05, `${kind}: the right side (x ${hit.x.toFixed(2)})`);
    // A ball kick hits low; the punch at chest height.
    if (kind === 'kick') assert.ok(hit.y > 0.1 && hit.y < 0.5, `kick at ${hit.y.toFixed(2)} m`);
    else assert.ok(hit.y > 1.3, `punch at ${hit.y.toFixed(2)} m`);
    // Let go at any charge, the swing continues from the very pose the charge reached.
    for (const held of [0, STRIKE_CHARGE / 3, STRIKE_CHARGE * 0.7, STRIKE_CHARGE]) {
      const gap = at(strikeCharge(spec, held)).distanceTo(at(strikeLaunch(spec, held)));
      assert.ok(gap < 0.03, `${kind}: released after ${held.toFixed(2)} s, ${gap.toFixed(3)} m apart`);
    }
    action.reset().play();
    assert.ok(at(0).distanceTo(at(clip.duration - 1e-4)) < 0.01, `${kind}: starts and ends standing`);
  }
  mixer.stopAllAction();
});

test('a tap strikes weakly, holding charges up to full power', () => {
  assert.equal(strikePower(0), STRIKE_MIN_POWER);
  assert.ok(strikePower(STRIKE_CHARGE / 2) > STRIKE_MIN_POWER && strikePower(STRIKE_CHARGE / 2) < 1);
  assert.equal(strikePower(STRIKE_CHARGE), 1);
  assert.equal(strikePower(STRIKE_CHARGE * 3), 1);
});

test('a strike knocks what is in front of it, harder when charged, and leaves what is behind', () => {
  const brick = (x: number, z: number) => ({ position: { x, y: 0.1, z }, quaternion: { x: 0, y: 0, z: 0, w: 1 }, half: [0.15, 0.1, 0.08] as [number, number, number], group: 'bricks' as const });
  const speedAfter = (power: number) => {
    const physics = new PropPhysics(cannon, [brick(0, 0.3), brick(0, -0.5)], [], 0);
    const hits = physics.strike({ x: 0, z: -0.2 }, { x: 0, y: 0.2, z: 0 }, { x: 0, z: 1 }, power);
    assert.equal(hits, 1, 'only the brick in front');
    assert.ok(physics.bodies[1].velocity.length() < 1e-6, 'the brick behind stays');
    return physics.bodies[0].velocity;
  };
  const weak = speedAfter(STRIKE_MIN_POWER);
  const strong = speedAfter(1);
  assert.ok(weak.z > 0.5 && strong.z > weak.z * 2, `away from the blow: ${weak.z.toFixed(2)} vs ${strong.z.toFixed(2)} m/s`);
  const far = new PropPhysics(cannon, [brick(0, STRIKE_RADIUS + 0.3)], [], 0);
  assert.equal(far.strike({ x: 0, z: -0.2 }, { x: 0, y: 0.1, z: 0 }, { x: 0, z: 1 }, 1), 0, 'out of reach');
});
