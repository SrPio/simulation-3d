import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ROPE, TapeRope, type Point3 } from '../src/world/tapeRope.ts';

const A = { x: 0, y: 0.85, z: 0 };
const B = { x: 5.6, y: 0.85, z: 0 };
const GROUND = 0;

test('a whole tape is a straight line between its posts', () => {
  const rope = new TapeRope(A, B, GROUND);
  assert.equal(rope.chains.length, 1);
  const chain = rope.chains[0];
  assert.equal(chain.length, ROPE.nodes);
  for (const p of chain) assert.ok(Math.abs(p.y - 0.85) < 1e-9 && Math.abs(p.z) < 1e-9);
  assert.equal(rope.update(1), false, 'nothing moves until it is cut');
});

test('cut, each half hangs from its post and falls to the ground in loose curves, then rests', () => {
  const rope = new TapeRope(A, B, GROUND);
  rope.cutAt(0.4, { x: 0, z: 3 }, 7);
  assert.equal(rope.chains.length, 2);
  for (let t = 0; t < 8 && rope.update(1 / 60); t += 1 / 60);
  assert.equal(rope.active, false, 'settled');
  const [first, second] = rope.chains;
  // The post ends stay on their posts.
  assert.deepEqual(first[0], A);
  assert.deepEqual(second[0], B);
  const segment = (5.6 / (ROPE.nodes - 1)) * ROPE.slack;
  for (const chain of rope.chains) {
    for (const p of chain) assert.ok(p.y >= GROUND - 1e-6, 'never below the ground');
    // The free end lies on the ground.
    assert.ok(chain[chain.length - 1].y < GROUND + 0.02, 'end on the ground');
    for (let i = 1; i < chain.length; i++) {
      const d = Math.hypot(chain[i].x - chain[i - 1].x, chain[i].y - chain[i - 1].y, chain[i].z - chain[i - 1].z);
      assert.ok(Math.abs(d - segment) < segment * 0.05, 'keeps its length');
    }
    // Not a straight line on the ground: the part lying there wanders off the line between the posts.
    const lying = chain.filter((p: Point3) => p.y < GROUND + 0.02);
    assert.ok(lying.length > 3, 'part of it lies on the ground');
    assert.ok(Math.max(...lying.map((p) => Math.abs(p.z))) > 0.15, 'in a loose curve, pushed along by what cut it');
  }
});

test('a cut tape falls the same way for the same seed, and reset makes it whole again', () => {
  const fall = (seed: number) => {
    const rope = new TapeRope(A, B, GROUND);
    rope.cutAt(0.5, { x: 0, z: 2 }, seed);
    rope.settle();
    return rope;
  };
  assert.deepEqual(fall(3).chains, fall(3).chains);
  assert.notDeepEqual(fall(3).chains, fall(4).chains);
  const rope = fall(3);
  rope.reset();
  assert.equal(rope.chains.length, 1);
  assert.equal(rope.cut, false);
});
