import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GamepadInput, padKind, readPad, type RawPad } from '../src/input/GamepadInput.ts';
import type { AnalogMove, KeyboardInput } from '../src/input/KeyboardInput.ts';

const buttons = (count: number, pressed: number[] = []) =>
  Array.from({ length: count }, (_, i) => ({ value: pressed.includes(i) ? 1 : 0, pressed: pressed.includes(i) }));
const standard = (pressed: number[] = [], axes = [0, 0, 0, 0]): RawPad =>
  ({ id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e)', mapping: 'standard', buttons: buttons(17, pressed), axes });

test('pads are told apart by name and read through their layout', () => {
  assert.equal(padKind('Xbox 360 Controller (XInput STANDARD GAMEPAD)'), 'xbox');
  assert.equal(padKind('DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)'), 'playstation');
  assert.equal(padKind('USB Gamepad'), 'generic');
  const pad = readPad(standard([0, 5], [0.1, -0.15, 0, 0]));
  assert.equal(pad.buttons.cross, 1);
  assert.equal(pad.buttons.r1, 1);
  assert.deepEqual(pad.left, { x: 0, y: 0 }, 'a resting stick inside the dead zone reads 0');
  const tilted = readPad(standard([], [1, 0, 0, 0]));
  assert.ok(Math.abs(tilted.left.x - 1) < 1e-9, 'full tilt reads 1');
  // Firefox's own DualSense layout on Windows: square first, triggers and the cross pad on axes.
  const firefox: RawPad = { id: '054c-0ce6-Wireless Controller', mapping: '', buttons: buttons(14, [1]), axes: [0, 0, 0, -1, 1, 0, 0, 0, 0, -1] };
  const ps = readPad(firefox);
  assert.equal(ps.buttons.cross, 1, 'cross is its button 1');
  assert.equal(ps.buttons.square, 0);
  assert.equal(ps.buttons.r2, 1, 'r2 from its axis');
  assert.equal(ps.buttons.l2, 0);
  assert.equal(ps.buttons.up, 1, 'up on the hat axis');
});

/** A stand-in for the page input that records what the pad does. */
function recorder() {
  const log: string[] = [];
  let analog: AnalogMove | undefined;
  const input = {
    press: (action: string) => log.push(`press ${action}`),
    release: (action: string) => log.push(`release ${action}`),
    toggleRun: () => log.push('run'),
    setAnalog: (_source: string, move: AnalogMove | undefined) => { analog = move; },
  } as unknown as KeyboardInput;
  return { log, input, analog: () => analog };
}

test('a plugged-in pad drives the page: presses, holds, the stick, the triggers and the Konami code', () => {
  let pad: RawPad | null = standard();
  Object.defineProperty(globalThis.navigator, 'getGamepads', { value: () => [pad && { ...pad, connected: true }], configurable: true });
  const { log, input, analog } = recorder();
  const gamepad = new GamepadInput(() => input);
  let zone = false;
  gamepad.inZone = () => zone;
  const used: string[] = [];
  gamepad.onUse = (kind) => used.push(kind);
  const frame = (pressed: number[] = [], axes = [0, 0, 0, 0]) => {
    pad = standard(pressed, axes);
    gamepad.poll();
  };
  frame();
  frame([0]);
  frame();
  assert.deepEqual(log.splice(0), ['press jump', 'release jump'], '✕/A is a held jump (the nitro on the chair)');
  zone = true;
  frame([0]);
  frame();
  assert.deepEqual(log.splice(0), ['press open'], 'in a sign zone it opens');
  zone = false;
  frame([3]);
  frame([2]);
  frame([5]);
  frame([4]);
  frame([1]);
  frame([10]);
  frame([8]);
  frame();
  // △/Y sits, □/X the laptop, R1 punches, L1 kicks, ○/B throws (held until let go), L3 switches running, Select resets.
  assert.deepEqual(log.splice(0), ['press interact', 'press laptop', 'press punch', 'press kick', 'release punch', 'press throw', 'release kick', 'release throw', 'run', 'press reset']);
  frame([], [0.4, -1, 0, 0]);
  assert.ok(analog()!.forward > 0.9 && analog()!.right > 0 && analog()!.run, 'stick up is forward; full tilt runs');
  pad = { ...standard(), buttons: buttons(17).map((button, i) => (i === 7 ? { value: 0.6, pressed: true } : button)) };
  gamepad.poll();
  assert.ok(Math.abs(analog()!.forward - 0.6) < 1e-9, 'R2 pushes the chair forwards as hard as it is pressed');
  assert.ok(used.includes('xbox'));
  log.length = 0;
  for (const button of [12, 12, 13, 13, 14, 15, 14, 15, 1, 0]) {
    frame([button]);
    frame();
  }
  assert.ok(log.includes('press konami'), '↑↑↓↓←→←→ B A');
  // Unplugged: whatever it held is let go.
  frame([4]);
  pad = null;
  gamepad.poll();
  assert.equal(log.at(-1), 'release kick');
  assert.equal(analog(), undefined);
});
