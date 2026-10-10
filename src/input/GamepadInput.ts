import type { HoldAction, KeyboardInput, PressAction } from './KeyboardInput.ts';

/** Buttons by their PlayStation names (any pad): face buttons, shoulders, triggers, the middle ones, stick clicks, cross pad. */
export type PadButton = 'cross' | 'circle' | 'square' | 'triangle' | 'l1' | 'r1' | 'l2' | 'r2' | 'select' | 'start' | 'l3' | 'r3' | 'up' | 'down' | 'left' | 'right';
export type PadKind = 'xbox' | 'playstation' | 'generic';
/** A pad read the same way whatever its layout: each button 0…1, the sticks -1…1 (y down). */
export type PadState = { buttons: Record<PadButton, number>; left: { x: number; y: number }; right: { x: number; y: number } };
/** The parts of the browser's Gamepad this reads (tests pass plain objects). */
export type RawPad = { id: string; mapping: string; buttons: readonly { value: number; pressed: boolean }[]; axes: readonly number[] };

/** Sticks and analog buttons do nothing below this; above it a stick is rescaled to start from 0. */
export const DEAD = 0.2;

export function padKind(id: string): PadKind {
  if (/xbox|xinput/i.test(id)) return 'xbox';
  if (/playstation|dualshock|dualsense|ps\d|054c/i.test(id)) return 'playstation';
  return 'generic';
}

/** Button indices and axes of the layouts browsers report. */
type Layout = {
  buttons: Partial<Record<PadButton, number>>;
  /** Triggers reported as axes (-1 released … 1 pressed). */
  triggers?: { l2: number; r2: number };
  /** The cross pad as one "hat" axis: the value of each direction (and its diagonals) on it. */
  hat?: { axis: number; up: number[]; right: number[]; down: number[]; left: number[] };
  left: [number, number];
  right: [number, number];
};
const STANDARD: Layout = {
  buttons: { cross: 0, circle: 1, square: 2, triangle: 3, l1: 4, r1: 5, l2: 6, r2: 7, select: 8, start: 9, l3: 10, r3: 11, up: 12, down: 13, left: 14, right: 15 },
  left: [0, 1],
  right: [2, 3],
};
/** Firefox on Windows and macOS gives a DualSense no standard mapping: its own button order, triggers and the cross pad as axes. */
const hat = (axis: number) => ({ axis, up: [-1, -5 / 7, 1], right: [-3 / 7, -5 / 7, -1 / 7], down: [1 / 7, -1 / 7, 3 / 7], left: [5 / 7, 3 / 7, 1] });
const FIREFOX_PS5_WINDOWS: Layout = {
  buttons: { square: 0, cross: 1, circle: 2, triangle: 3, l1: 4, r1: 5, select: 8, start: 9, l3: 10, r3: 11 },
  triggers: { l2: 3, r2: 4 },
  hat: hat(9),
  left: [0, 1],
  right: [2, 5],
};
const FIREFOX_PS5_MAC: Layout = { ...FIREFOX_PS5_WINDOWS, triggers: { l2: 4, r2: 5 }, hat: hat(6), right: [2, 3] };

export function layoutOf(pad: Pick<RawPad, 'id' | 'mapping' | 'axes'>): Layout {
  if (pad.mapping === 'standard' || padKind(pad.id) !== 'playstation') return STANDARD;
  return pad.axes.length > 9 ? FIREFOX_PS5_WINDOWS : FIREFOX_PS5_MAC;
}

const stick = (x: number, y: number) => {
  const length = Math.hypot(x, y);
  if (length < DEAD) return { x: 0, y: 0 };
  const scale = Math.min(1, (length - DEAD) / (1 - DEAD)) / length;
  return { x: x * scale, y: y * scale };
};

/** Read a pad through its layout. */
export function readPad(pad: RawPad): PadState {
  const layout = layoutOf(pad);
  const buttons = {} as Record<PadButton, number>;
  for (const name of ['cross', 'circle', 'square', 'triangle', 'l1', 'r1', 'l2', 'r2', 'select', 'start', 'l3', 'r3', 'up', 'down', 'left', 'right'] as const) {
    const index = layout.buttons[name];
    const button = index === undefined ? undefined : pad.buttons[index];
    // The triggers keep how far they are pressed; other buttons count as fully down once pressed.
    buttons[name] = !button ? 0 : name === 'l2' || name === 'r2' ? button.value : Math.max(button.value, button.pressed ? 1 : 0);
  }
  if (layout.triggers) {
    buttons.l2 = ((pad.axes[layout.triggers.l2] ?? -1) + 1) / 2;
    buttons.r2 = ((pad.axes[layout.triggers.r2] ?? -1) + 1) / 2;
  }
  if (layout.hat) {
    const value = pad.axes[layout.hat.axis] ?? 2;
    for (const direction of ['up', 'right', 'down', 'left'] as const) {
      if (layout.hat[direction].some((at) => Math.abs(value - at) < 0.1)) buttons[direction] = 1;
    }
  }
  for (const name of Object.keys(buttons) as PadButton[]) if (buttons[name] < DEAD) buttons[name] = 0;
  return {
    buttons,
    left: stick(pad.axes[layout.left[0]] ?? 0, pad.axes[layout.left[1]] ?? 0),
    right: stick(pad.axes[layout.right[0]] ?? 0, pad.axes[layout.right[1]] ?? 0),
  };
}

/** What each button does; ✕/A both jumps and (in a sign's zone) opens, which the page decides. */
export const PAD_ACTIONS: Partial<Record<PadButton, { press?: PressAction; hold?: HoldAction }>> = {
  cross: { hold: 'jump' },
  triangle: { press: 'interact' },
  square: { press: 'laptop' },
  circle: { hold: 'throw' },
  r1: { hold: 'punch' },
  l1: { hold: 'kick' },
  select: { press: 'reset' },
};
/** The Konami code on a pad: the cross pad, then ○/B and ✕/A. */
export const PAD_KONAMI: readonly PadButton[] = ['up', 'up', 'down', 'down', 'left', 'right', 'left', 'right', 'circle', 'cross'];

/**
 * A gamepad driving the page through the same input as the keyboard: plugged in, it works at once with the browser's
 * mapping (Xbox, PlayStation and generic pads; Firefox's own DualSense layout too). The left stick or the cross pad
 * walks (a full tilt runs, a click on the stick switches running like Shift), the triggers drive the office chair, ✕/A
 * jumps or opens a sign's zone (and is the chair's nitro), △/Y sits and stands, □/X the laptop, ○/B throws, R1 punches,
 * L1 kicks, Select resets the position and Start opens the menu. Polled every frame.
 */
export class GamepadInput {
  private previous?: Record<PadButton, number>;
  private readonly recent: PadButton[] = [];
  /** Hold actions this pad started, let go when their button is (✕/A opening a sign holds nothing). */
  private readonly held = new Set<HoldAction>();
  private frame = 0;
  private kind?: PadKind;
  /** Something on the pad was used this frame (the page shows the pad's buttons in its hints). */
  onUse?: (kind: PadKind) => void;
  /** Start pressed. */
  onMenu?: () => void;
  /** Every button going down, first: true takes it (the loading screen's START), so it does nothing else. */
  onButton?: (button: PadButton) => boolean;
  /** ✕/A opens a sign instead of jumping while this says so. */
  inZone: () => boolean = () => false;
  private readonly input: () => KeyboardInput | undefined;

  constructor(input: () => KeyboardInput | undefined) {
    this.input = input;
  }

  start(): void {
    const loop = () => {
      this.poll();
      this.frame = requestAnimationFrame(loop);
    };
    this.frame = requestAnimationFrame(loop);
  }

  /** The last connected pad, if any. */
  private pad(): RawPad | undefined {
    const pads = navigator.getGamepads?.() ?? [];
    let found: RawPad | undefined;
    for (const pad of pads) if (pad?.connected) found = pad;
    return found;
  }

  poll(): void {
    const input = this.input();
    const raw = this.pad();
    if (!raw || !input) {
      if (this.previous) this.letGo(input);
      return;
    }
    const kind = padKind(raw.id);
    const state = readPad(raw);
    const previous = this.previous;
    this.previous = state.buttons;
    if (!previous) return;
    let used = false;
    for (const name of Object.keys(state.buttons) as PadButton[]) {
      const down = state.buttons[name] > 0 && !previous[name];
      const up = !state.buttons[name] && previous[name] > 0;
      if (down) {
        used = true;
        if (this.onButton?.(name)) continue;
        this.konami(name, input);
        if (name === 'start') this.onMenu?.();
        else if (name === 'l3') input.toggleRun();
        else if (name === 'cross' && this.inZone()) input.press('open');
        else {
          const action = PAD_ACTIONS[name];
          if (action?.hold) {
            this.held.add(action.hold);
            input.press(action.hold);
          } else if (action?.press) input.press(action.press);
        }
      } else if (up) {
        const hold = PAD_ACTIONS[name]?.hold;
        if (hold && this.held.delete(hold)) input.release(hold);
      }
    }
    const { buttons, left } = state;
    // Walking: the stick or the cross pad. Driving the chair: the triggers push forwards and back when pressed harder.
    const pad = { forward: buttons.up - buttons.down, right: buttons.right - buttons.left };
    const triggers = buttons.r2 - buttons.l2;
    const forward = Math.abs(triggers) > Math.max(Math.abs(left.y), Math.abs(pad.forward)) ? triggers : Math.abs(pad.forward) > Math.abs(left.y) ? pad.forward : -left.y;
    const right = Math.abs(pad.right) > Math.abs(left.x) ? pad.right : left.x;
    const tilt = Math.hypot(left.x, left.y);
    input.setAnalog('gamepad', { forward, right, run: tilt > 0.95 });
    if (used || tilt > 0 || triggers !== 0) {
      if (kind !== this.kind) this.kind = kind;
      this.onUse?.(kind);
    }
  }

  /** The pad went away: everything it held is let go. */
  private letGo(input: KeyboardInput | undefined): void {
    if (input) {
      input.setAnalog('gamepad', undefined);
      for (const hold of this.held) input.release(hold);
    }
    this.held.clear();
    this.previous = undefined;
  }

  private konami(button: PadButton, input: KeyboardInput): void {
    this.recent.push(button);
    if (this.recent.length > PAD_KONAMI.length) this.recent.splice(0, this.recent.length - PAD_KONAMI.length);
    if (this.recent.length === PAD_KONAMI.length && this.recent.every((name, i) => name === PAD_KONAMI[i])) {
      this.recent.length = 0;
      input.press('konami');
    }
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
  }
}
