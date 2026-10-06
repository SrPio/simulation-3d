import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KEY_SINK, onKey, pressStep, type FloorKey } from '../src/world/keyPress.ts';

const key: FloorKey = { center: { x: 9, z: -1 }, yaw: 0, halfX: 0.3, halfZ: 0.3 };

test('a floor key is pressed while the feet are on its cap, also when the key is turned', () => {
  assert.equal(onKey({ x: 9, z: -1 }, key, 0.15), true);
  assert.equal(onKey({ x: 9.4, z: -1 }, key, 0.15), true, 'feet over the edge');
  assert.equal(onKey({ x: 9.5, z: -1 }, key, 0.15), false);
  assert.equal(onKey({ x: 9.45, z: -0.55 }, key, 0.15), false, 'off the corner');
  const turned: FloorKey = { ...key, yaw: Math.PI / 4 };
  // Along the turned key's diagonal the corner reaches 0.42 m out.
  assert.equal(onKey({ x: 9.38, z: -1 }, turned, 0.01), true);
  assert.equal(onKey({ x: 9.38, z: -1 }, key, 0.01), false);
});

test('a key goes down quickly and springs back up more slowly, or at once with reduced motion', () => {
  let depth = 0;
  let frames = 0;
  while (depth < 1 && frames < 120) { depth = pressStep(depth, true, 1 / 60); frames++; }
  const down = frames;
  frames = 0;
  while (depth > 0 && frames < 240) { depth = pressStep(depth, false, 1 / 60); frames++; }
  assert.ok(down < 40 && frames > down, `down in ${down} frames, up in ${frames}`);
  assert.equal(pressStep(0.3, true, 1 / 60, true), 1);
  assert.equal(pressStep(0.3, false, 1 / 60, true), 0);
  assert.ok(KEY_SINK > 0.1 && KEY_SINK < 0.3, 'sinks most of the way into the 0.3 m cap');
});
