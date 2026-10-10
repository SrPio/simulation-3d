import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Bone, Object3D, Texture, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { LEAN, applyLean, leanStep, leanTarget, restLean, solveArm } from '../src/character/riderPose.ts';

async function load(file: string): Promise<Object3D> {
  const data = readFileSync(new URL(`../public/models/${file}`, import.meta.url));
  const loader = new GLTFLoader();
  loader.register(() => ({ name: 'EXT_texture_webp', loadTexture: () => Promise.resolve(new Texture()) }));
  return (await loader.parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.length), '')).scene;
}

test('the rider leans forwards speeding up, back braking, into the turns and back with the nitro', () => {
  assert.ok(leanTarget(3, 0, false).pitch > 0, 'speeding up');
  assert.ok(leanTarget(-6, 0, false).pitch < 0, 'braking');
  assert.ok(leanTarget(0, 1.5, false).roll > 0, 'turning left leans left');
  assert.ok(leanTarget(0, -1.5, false).roll < 0, 'turning right leans right');
  assert.equal(leanTarget(5, 0, true).pitch, LEAN.nitro);
  assert.equal(Math.abs(leanTarget(100, 100, false).pitch), LEAN.limit, 'limited');
  const lean = restLean();
  for (let i = 0; i < 120; i++) leanStep(lean, { pitch: 0.2, roll: -0.1 }, 1 / 60);
  assert.ok(Math.abs(lean.pitch - 0.2) < 0.01 && Math.abs(lean.roll + 0.1) < 0.01, 'settles on its target');
  // Frame-rate independent: one long frame lands where many short ones do.
  const coarse = restLean();
  leanStep(coarse, { pitch: 0.2, roll: 0 }, 0.5);
  const fine = restLean();
  for (let i = 0; i < 30; i++) leanStep(fine, { pitch: 0.2, roll: 0 }, 0.5 / 30);
  assert.ok(Math.abs(coarse.pitch - fine.pitch) < 0.01);
});

test('the arm IK puts the wrist on the target with the elbow bent towards the pole', () => {
  const upper = new Bone();
  const fore = new Bone();
  const hand = new Bone();
  upper.add(fore);
  fore.add(hand);
  fore.position.set(0.3, 0, 0);
  hand.position.set(0.28, 0, 0);
  upper.updateMatrixWorld(true);
  const target = new Vector3(0.25, -0.3, 0.15);
  const pole = new Vector3(0.2, 0, -1);
  solveArm(upper, fore, hand, target, pole);
  assert.ok(hand.getWorldPosition(new Vector3()).distanceTo(target) < 0.002, 'wrist on target');
  assert.ok(fore.getWorldPosition(new Vector3()).z < 0, 'elbow towards the pole');
  // Out of reach the arm stretches straight at the target.
  const far = new Vector3(2, 0, 0);
  solveArm(upper, fore, hand, far, pole);
  assert.ok(hand.getWorldPosition(new Vector3()).distanceTo(new Vector3(0.58, 0, 0)) < 0.01);
});

test('on the real rig, leaning moves the head the right way and the arms reach the office chair\'s pads', async () => {
  const rig = await load('developer-v4-interactions.glb');
  rig.updateMatrixWorld(true);
  const bone = (name: string) => rig.getObjectByName(name)!;
  const head = () => bone('head').getWorldPosition(new Vector3());
  const before = head();
  const right = new Vector3(-1, 0, 0);
  const ahead = new Vector3(0, 0, 1);
  applyLean({ spine: bone('spine'), chest: bone('chest'), neck: bone('neck') }, { pitch: 0.25, roll: 0, pitchRate: 0, rollRate: 0 }, right, ahead);
  assert.ok(head().z > before.z + 0.1, 'forwards (+Z)');
  applyLean({ spine: bone('spine'), chest: bone('chest'), neck: bone('neck') }, { pitch: -0.25, roll: 0.25, pitchRate: 0, rollRate: 0 }, right, ahead);
  assert.ok(head().x > before.x + 0.1, 'left (+X, the rider faces +Z)');
  // Each wrist reaches a point beside the hips at armrest height (the rig's _L is the rider's right).
  for (const [suffix, side] of [['L', -1], ['R', 1]] as const) {
    const shoulder = bone(`upper_arm_${suffix}`).getWorldPosition(new Vector3());
    const target = new Vector3(shoulder.x + side * 0.12, shoulder.y - 0.5, shoulder.z + 0.15);
    solveArm(bone(`upper_arm_${suffix}`), bone(`forearm_${suffix}`), bone(`hand_${suffix}`), target, shoulder.clone().add(new Vector3(side * 0.4, -0.3, -0.5)));
    assert.ok(bone(`hand_${suffix}`).getWorldPosition(new Vector3()).distanceTo(target) < 0.01, `${suffix} wrist on its pad`);
  }
});

test('the office chair has a pad top for each hand and two soda bottles with their mouths backwards', async () => {
  const circuit = await load('circuit.glb');
  circuit.updateMatrixWorld(true);
  const chair = circuit.getObjectByName('OfficeChair')!;
  const seat = circuit.getObjectByName('OfficeChair_Seat')!;
  const local = (object: Object3D) => chair.worldToLocal(object.getWorldPosition(new Vector3()));
  const seatAt = local(seat);
  for (const side of ['right', 'left'] as const) {
    const pad = circuit.getObjectByName(`ChairArmrest_${side}`);
    assert.ok(pad, side);
    const at = local(pad);
    // The rider faces the chair's +Z: its right is -X.
    assert.ok(side === 'right' ? at.x < -0.3 : at.x > 0.3, `${side} pad on its side`);
    assert.ok(at.y > seatAt.y + 0.2 && at.y < seatAt.y + 0.35, `${side} pad above the seat`);
    for (const part of ['ChairBottle', 'ChairBottleLiquid', 'ChairBottleCap']) assert.ok(circuit.getObjectByName(`${part}_${side}`), `${part}_${side}`);
    const mouth = local(circuit.getObjectByName(`ChairNozzle_${side}`)!);
    const bottom = local(circuit.getObjectByName(`ChairBottleLiquid_${side}`)!);
    assert.ok(mouth.z < bottom.z - 0.2, `${side} mouth points backwards`);
  }
});
