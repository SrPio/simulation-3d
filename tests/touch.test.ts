import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FLICK, FlickReader, PEDAL_ARROWS, STICK, flickDirection, stickMove, zoneAction } from '../src/home/TouchControls.ts';
import { MESSAGES } from '../src/core/i18n.ts';
import { KeyboardInput, combineIntent } from '../src/input/KeyboardInput.ts';

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

test('the zone button names the zone: a short visit for each sign, reset for the reset zones', () => {
  assert.equal(zoneAction('none'), undefined);
  for (const sign of ['portfolio', 'github', 'linkedin']) {
    const action = zoneAction(sign)!;
    assert.equal(action.kind, 'link');
    assert.equal(action.key, `touch.visit.${sign}`);
    for (const language of ['es', 'en'] as const) assert.ok(MESSAGES[language][action.key].length <= 14, `${sign} is short in ${language}`);
  }
  assert.deepEqual(zoneAction('reset-bowling'), { kind: 'reset', key: 'touch.reset' });
  assert.deepEqual(zoneAction('reset-circuit'), { kind: 'reset', key: 'touch.reset' });
  assert.equal(zoneAction('somewhere')!.key, 'touch.open', 'an unknown sign falls back to Open');
});

test('the pedal and steering arrows point their way inside the button box', () => {
  const points = (d: string) => [...d.matchAll(/(\d+) (\d+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  for (const d of Object.values(PEDAL_ARROWS)) for (const [x, y] of points(d)) assert.ok(x >= 0 && x <= 100 && y >= 0 && y <= 100);
  assert.deepEqual(points(PEDAL_ARROWS.up)[0], [50, 12], 'the up arrow tip is at the top');
  assert.deepEqual(points(PEDAL_ARROWS.down)[0], [50, 88], 'the down arrow tip is at the bottom');
  assert.deepEqual(points(PEDAL_ARROWS.left)[0], [12, 50], 'the left arrow tip is on the left');
  assert.deepEqual(points(PEDAL_ARROWS.right)[0], [88, 50], 'the right arrow tip is on the right');
});

test('quick joystick flicks are the arrows of the Konami code, a long push is not', () => {
  assert.equal(flickDirection(0, -20, 60), undefined, 'not far enough');
  assert.equal(flickDirection(0, -50, 60), 'ArrowUp');
  assert.equal(flickDirection(-50, 5, 60), 'ArrowLeft');
  assert.equal(flickDirection(40, 40, 60), undefined, 'a diagonal is no arrow');
  const reader = new FlickReader();
  assert.equal(reader.move(0, -50, 60, 0), undefined);
  assert.equal(reader.move(0, -2, 60, 0.2), 'ArrowUp', 'back to the middle ends it');
  reader.move(0, 50, 60, 1);
  assert.equal(reader.end(1 + FLICK.time + 0.1), undefined, 'held too long: walking');
  reader.move(-50, 0, 60, 2);
  assert.equal(reader.move(50, 0, 60, 2.1), 'ArrowLeft', 'swept straight to the other side');
  assert.equal(reader.end(2.2), 'ArrowRight');
});

test('flicks, the throw button and the jump button type the Konami code', () => {
  const target = Object.assign(new EventTarget(), { document: new EventTarget() });
  const input = new KeyboardInput(target as unknown as Window, new AbortController().signal);
  const presses: string[] = [];
  input.onPress = (action) => presses.push(action);
  for (const code of ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'KeyB', 'KeyA']) input.konamiStep(code);
  assert.deepEqual(presses, ['konami']);
  for (const code of ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'KeyB', 'punch', 'KeyA']) input.konamiStep(code);
  assert.deepEqual(presses, ['konami'], 'another button breaks it');
});
