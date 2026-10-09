import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import * as cannon from 'cannon-es';
import { AnimationMixer, Texture, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { STRIKE_MIN_POWER, THROW_CLIP, THROW_HAND, THROW_RELEASE, throwDirection, throwSpeed } from '../src/character/CharacterController.ts';
import { readOutside } from '../src/scene/outsideData.ts';
import { MAX_THROWN, PropPhysics, type TargetHit } from '../src/world/PropPhysics.ts';
import { ROUND_THROWS, TargetGame, behindLine, ringPoints, type Lane } from '../src/world/targets.ts';

async function parse(file: string) {
  const data = await readFile(new URL(`../public/models/${file}.glb`, import.meta.url));
  const loader = new GLTFLoader();
  loader.register(() => ({ name: 'EXT_texture_webp', loadTexture: () => Promise.resolve(new Texture()) }));
  return loader.parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.length), '');
}

test('points: the innermost ring that holds the hit, nothing off the disc', () => {
  const rings = [0.4, 0.26, 0.12];
  const points = [10, 25, 50];
  assert.equal(ringPoints(0.05, rings, points), 50);
  assert.equal(ringPoints(0.2, rings, points), 25);
  assert.equal(ringPoints(0.39, rings, points), 10);
  assert.equal(ringPoints(0.5, rings, points), 0);
});

test(`rounds of ${ROUND_THROWS} throws from behind the line; other throws do not count`, () => {
  assert.equal(ROUND_THROWS, MAX_THROWN);
  const lane: Lane = { minX: 10, maxX: 13, lineZ: 27, depth: 3 };
  assert.ok(behindLine({ x: 11.5, z: 27.4 }, lane));
  assert.ok(!behindLine({ x: 11.5, z: 26.5 }, lane), 'past the line');
  assert.ok(!behindLine({ x: 9, z: 27.4 }, lane), 'beside the lane');
  const game = new TargetGame();
  assert.equal(game.throwFrom({ x: 11.5, z: 26 }, lane), false);
  assert.equal(game.throws, 0);
  for (let i = 0; i < ROUND_THROWS; i++) assert.ok(game.throwFrom({ x: 11.5, z: 27.5 }, lane));
  game.hit(0.1, [0.4, 0.26, 0.12], [10, 25, 50]);
  assert.deepEqual([game.score, game.throws, game.hits], [50, ROUND_THROWS, 1]);
  // The next counted throw starts a new round.
  assert.ok(game.throwFrom({ x: 11.5, z: 27.5 }, lane));
  assert.deepEqual([game.score, game.throws, game.hits], [0, 1, 0]);
});

test('a charged laptop thrown from the line reaches every target, the farthest one included, and hits near its centre; a tap falls short of a full charge', async () => {
  // Where the throwing hand lets go, relative to the character's feet (facing +Z): measured on the rig.
  const rig = await parse('developer-v4-interactions');
  const clip = rig.animations.find((animation) => animation.name === THROW_CLIP)!;
  const mixer = new AnimationMixer(rig.scene);
  mixer.clipAction(clip).play();
  mixer.setTime(THROW_RELEASE);
  rig.scene.updateMatrixWorld(true);
  const hand = rig.scene.getObjectByName(THROW_HAND)!.getWorldPosition(new Vector3());
  const data = readOutside((await parse('outside')).scene);
  assert.equal(data.targets.length, 3);
  const lane = data.floors.find((floor) => floor.id === 'targets')!;
  const lineZ = lane.position.z + lane.line;
  const distances = data.targets.map((target) => lineZ - target.position.z);
  assert.ok(Math.max(...distances) > 3.5, `the farthest target is ${Math.max(...distances).toFixed(2)} m away`);
  // The thrower stands just behind the line, facing -Z, as the keys allow; the laptop leaves the right hand, off to
  // the side, and flies towards the line the character faces, faster the longer F was held.
  const yaw = Math.PI;
  const quaternion = new cannon.Quaternion().setFromEuler(0, yaw, 0);
  const launch = (physics: PropPhysics, feet: { x: number; z: number }, power: number) => {
    const release = { x: feet.x + hand.x * Math.cos(yaw) + hand.z * Math.sin(yaw), y: data.groundY + hand.y, z: feet.z - hand.x * Math.sin(yaw) + hand.z * Math.cos(yaw) };
    const forward = throwDirection(feet, yaw, release);
    const speed = throwSpeed(power);
    return physics.throwLaptop({ position: release, quaternion }, { x: forward.x * speed.forward, y: speed.up, z: forward.z * speed.forward }, { x: 0, y: 0, z: 0 });
  };
  const powers = Array.from({ length: 16 }, (_, i) => STRIKE_MIN_POWER + (1 - STRIKE_MIN_POWER) * i / 15);
  for (const target of data.targets) {
    const discs = data.targets.map((entry) => ({ center: { x: entry.position.x, y: entry.position.y + entry.centre, z: entry.position.z + 0.025 }, radius: entry.radius, yaw: entry.yaw }));
    // Some charge hits the target near its centre.
    let best = Infinity;
    for (const power of powers) {
      const physics = new PropPhysics(cannon, [], [], data.groundY, [discs[target.index]]);
      const hits: TargetHit[] = [];
      physics.onTargetHit = (hit) => hits.push(hit);
      launch(physics, { x: target.position.x, z: lineZ + 0.3 }, power);
      for (let i = 0; i < 60 * 3 && !hits.length; i++) physics.step(1 / 60, undefined);
      if (hits.length) best = Math.min(best, hits[0].distance);
    }
    assert.ok(best < target.rings[1], `target ${target.index} (${(lineZ - target.position.z).toFixed(1)} m) hit ${best.toFixed(2)} m from its centre at best`);
  }
  // On open ground, a full charge lands much further than a tap.
  const landing = (power: number) => {
    const physics = new PropPhysics(cannon, [], [], data.groundY);
    const laptop = launch(physics, { x: 0, z: 0 }, power);
    for (let i = 0; i < 60 * 3 && laptop.base.position.y > data.groundY + 0.1; i++) physics.step(1 / 60, undefined);
    return -laptop.base.position.z;
  };
  const tap = landing(STRIKE_MIN_POWER);
  const full = landing(1);
  assert.ok(tap > 1.5 && full > tap * 1.8, `a tap lands ${tap.toFixed(2)} m away, a full charge ${full.toFixed(2)} m`);
});
