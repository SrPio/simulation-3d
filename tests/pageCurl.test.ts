import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CURL, ease, edgeAt, relativeAngles, stripAngles, stripShade } from '../src/home/album/pageCurl.ts';

test('a page lies flat at either end of its turn and curls most in the middle', () => {
  assert.deepEqual(stripAngles(0), new Array(CURL.strips).fill(0));
  assert.ok(stripAngles(1).every((angle) => Math.abs(angle - Math.PI) < 1e-9));
  const spread = (p: number) => { const a = stripAngles(p); return a[a.length - 1] - a[0]; };
  assert.ok(spread(0.5) > spread(0.2) && spread(0.5) > spread(0.8));
  assert.ok(Math.abs(spread(0.5) - 2 * CURL.bend) < 1e-9);
});

test('the free edge leads, every strip stays between flat right and flat left, and the nested turns add up', () => {
  for (const p of [0.05, 0.3, 0.5, 0.7, 0.95]) {
    const angles = stripAngles(p);
    for (let i = 1; i < angles.length; i++) assert.ok(angles[i] >= angles[i - 1], 'the edge is ahead of the spine');
    assert.ok(angles.every((angle) => angle >= 0 && angle <= Math.PI));
    const sum = relativeAngles(angles).reduce((total, angle) => total + angle, 0);
    assert.ok(Math.abs(sum - angles[angles.length - 1]) < 1e-9);
  }
});

test('the edge crosses from the right page to the left one, and shading and easing stay in range', () => {
  assert.ok(Math.abs(edgeAt(stripAngles(0)) - 1) < 1e-9);
  assert.ok(Math.abs(edgeAt(stripAngles(1)) + 1) < 1e-9);
  let last = 2;
  for (let p = 0; p <= 1.0001; p += 0.05) {
    const edge = edgeAt(stripAngles(p));
    assert.ok(edge <= last + 1e-9, 'moves left all the way');
    last = edge;
  }
  assert.equal(stripShade(0), 0);
  assert.ok(Math.abs(stripShade(Math.PI / 2) - 0.5) < 1e-9);
  assert.equal(ease(0), 0);
  assert.equal(ease(1), 1);
  assert.equal(ease(0.5), 0.5);
});
