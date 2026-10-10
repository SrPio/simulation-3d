import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STICK, stickMove } from '../src/home/TouchControls.ts';
import { combineIntent } from '../src/input/KeyboardInput.ts';

test('the joystick ignores a light touch, pushes up the screen as forward and runs at full tilt', () => {
  assert.equal(stickMove(0, 0, 60), undefined);
  assert.equal(stickMove(60 * STICK.dead * 0.9, 0, 60), undefined, 'inside the dead zone');
  const up = stickMove(0, -40, 60)!;
  assert.ok(up.forward > 0.5 && Math.abs(up.right) < 1e-9 && !up.run, 'up the screen is forward, walking');
  const right = stickMove(60, 0, 60)!;
  assert.ok(right.right > 0.99 && right.run, 'a full push runs');
  const past = stickMove(0, 200, 60)!;
  assert.ok(past.forward >= -1 - 1e-9 && past.forward < -0.99, 'clamped at the rim');
  // Just past the dead zone the push starts from almost nothing.
  assert.ok(stickMove(60 * STICK.dead * 1.05, 0, 60)!.right < 0.05);
});

test('keys and sticks combine: the stronger push on each axis wins, any of them can run', () => {
  assert.deepEqual(combineIntent({ forward: 0, right: 0 }, [], false), { forward: 0, right: 0, run: false });
  assert.deepEqual(combineIntent({ forward: 1, right: 0 }, [{ forward: 0.3, right: -0.6, run: false }], false), { forward: 1, right: -0.6, run: false });
  assert.deepEqual(combineIntent({ forward: 0, right: 0 }, [{ forward: 0.2, right: 0, run: false }, { forward: -0.9, right: 0.1, run: true }], false), { forward: -0.9, right: 0.1, run: true });
  assert.equal(combineIntent({ forward: 0, right: 0 }, [], true).run, true, 'Shift still runs');
});
