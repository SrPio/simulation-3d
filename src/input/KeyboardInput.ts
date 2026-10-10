import type { MoveIntent } from '../character/CharacterController';

export type PressAction = 'interact' | 'laptop' | 'jump' | 'open' | 'throw' | 'punch' | 'kick' | 'konami' | 'reset';
const PRESSES: Record<string, PressAction> = {
  KeyE: 'interact', KeyL: 'laptop', Space: 'jump', Enter: 'open', NumpadEnter: 'open', KeyF: 'throw', KeyJ: 'punch', KeyK: 'kick', KeyR: 'reset',
};
/** Keys whose release matters too: holding them charges a strike or a throw, or keeps the office chair's nitro on (Space). */
export type HoldAction = 'punch' | 'kick' | 'throw' | 'jump';
const HOLDS = new Set<PressAction>(['punch', 'kick', 'throw', 'jump']);

const BINDINGS: Record<string, 'forward' | 'back' | 'left' | 'right'> = {
  KeyW: 'forward', ArrowUp: 'forward', KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
};

/** Analog movement from another source (the touch joystick, a gamepad stick): forward up the screen and right, -1…1. */
export type AnalogMove = { forward: number; right: number; run: boolean };

/** Keys and analog movement together: the larger push on each axis wins, clamped to -1…1. */
export function combineIntent(keys: { forward: number; right: number }, analog: Iterable<AnalogMove>, running: boolean): MoveIntent {
  let { forward, right } = keys;
  let run = running;
  for (const move of analog) {
    if (Math.abs(move.forward) > Math.abs(forward)) forward = move.forward;
    if (Math.abs(move.right) > Math.abs(right)) right = move.right;
    run ||= move.run;
  }
  return { forward: Math.max(-1, Math.min(1, forward)), right: Math.max(-1, Math.min(1, right)), run };
}

/** The Konami code: ↑ ↑ ↓ ↓ ← → ← → B A (key codes, so it works on any keyboard layout). */
export const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'KeyB', 'KeyA'] as const;

/** Add a pressed key to the recent ones (kept as long as the code); true when they now spell the Konami code, which empties them. */
export function pushKonami(recent: string[], code: string): boolean {
  recent.push(code);
  if (recent.length > KONAMI.length) recent.splice(0, recent.length - KONAMI.length);
  if (recent.length < KONAMI.length || recent.some((key, i) => key !== KONAMI[i])) return false;
  recent.length = 0;
  return true;
}

/** Whether a key event belongs to a control that uses the keyboard itself (fields, selects, sliders). */
function ownsKeyboard(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest('input, select, textarea, [contenteditable=""], [contenteditable="true"]')) return true;
  return false;
}

/**
 * The page's actions, from the keyboard and from the on-screen touch controls or a gamepad (`setAnalog`, `press`,
 * `release`, `toggleRun`), so the viewer reads one source. WASD / arrows for movement, Shift toggles running on and off, Space to jump, F to throw, J to punch and K to kick
 * (each held to charge, released to let go), E and L for seats and the laptop, Enter to open a sign's link, R to reset the position. Keys are released when the window loses focus or the
 * page is hidden, so a key held while switching away never keeps the character walking.
 */
export class KeyboardInput {
  private readonly held = new Set<'forward' | 'back' | 'left' | 'right'>();
  /** Running mode: each Shift press switches it; it stays as it is while walking around. */
  private running = false;
  /** Strike keys down right now; released ones (or all, when focus is lost) go to onRelease. */
  private readonly holding = new Set<HoldAction>();
  enabled = true;
  /** Called when Shift switches running on or off. */
  onRunChange?: (running: boolean) => void;
  /** One call per physical press of E (sit/stand), L (laptop), Space (jump), F (throw) or Enter (open); key repeat is ignored. */
  onPress?: (action: PressAction) => void;
  /** The last keys pressed, for the Konami code (it calls onPress with 'konami'). */
  private readonly recent: string[] = [];
  /** Called when a held strike or throw key (J, K, F) is released, or the window loses focus while it is down. */
  onRelease?: (action: HoldAction) => void;

  constructor(target: Window, signal: AbortSignal) {
    target.addEventListener('keydown', this.onKeyDown, { signal });
    target.addEventListener('keyup', this.onKeyUp, { signal });
    target.addEventListener('blur', this.clear, { signal });
    target.document.addEventListener('visibilitychange', this.clear, { signal });
  }

  /** Analog movement by source ('touch', 'gamepad'); a source with no push is removed. */
  private readonly analog = new Map<string, AnalogMove>();

  get intent(): MoveIntent {
    const forward = (this.held.has('forward') ? 1 : 0) - (this.held.has('back') ? 1 : 0);
    const right = (this.held.has('right') ? 1 : 0) - (this.held.has('left') ? 1 : 0);
    return combineIntent({ forward, right }, this.analog.values(), this.running);
  }

  get active(): boolean {
    return this.held.size > 0 || this.analog.size > 0;
  }

  /** Movement from a stick: undefined (or no push) lets go of it. */
  setAnalog(source: string, move: AnalogMove | undefined): void {
    if (!this.enabled || !move || (move.forward === 0 && move.right === 0)) this.analog.delete(source);
    else this.analog.set(source, move);
  }

  /** An action from a button: like its key going down (a hold action stays down until `release`). */
  press(action: PressAction): void {
    if (!this.enabled) return;
    if (HOLDS.has(action)) {
      if (this.holding.has(action as HoldAction)) return;
      this.holding.add(action as HoldAction);
    }
    this.onPress?.(action);
  }

  /** A button's hold action let go. */
  release(action: HoldAction): void {
    if (!this.holding.delete(action)) return;
    this.onRelease?.(action);
  }

  /**
   * A step of the Konami code from another source, as the key code it stands for (the touch joystick flicked up is
   * 'ArrowUp', the throw button 'KeyB', the jump button 'KeyA'; anything else breaks the sequence).
   */
  konamiStep(code: string): void {
    if (this.enabled && pushKonami(this.recent, code)) this.onPress?.('konami');
  }

  /** Running on or off, like Shift. */
  toggleRun(): void {
    if (!this.enabled) return;
    this.running = !this.running;
    this.onRunChange?.(this.running);
  }

  get run(): boolean {
    return this.running;
  }

  readonly clear = (): void => {
    this.held.clear();
    this.analog.clear();
    for (const action of [...this.holding]) this.release(action);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!event.repeat && this.enabled && !event.ctrlKey && !event.altKey && !event.metaKey && !ownsKeyboard(event.target) && pushKonami(this.recent, event.code)) {
      this.onPress?.('konami');
    }
    if (event.key === 'Shift') {
      if (!event.repeat && this.enabled && !event.ctrlKey && !event.altKey && !event.metaKey && !ownsKeyboard(event.target)) {
        this.running = !this.running;
        this.onRunChange?.(this.running);
      }
      return;
    }
    const press = PRESSES[event.code];
    // Enter on a focused button or link belongs to that control.
    const control = press === 'open' && event.target instanceof Element && !!event.target.closest('button, a');
    if (press && this.enabled && !control && !event.ctrlKey && !event.altKey && !event.metaKey && !ownsKeyboard(event.target)) {
      // Space would also scroll the page or press the focused button.
      if (press === 'jump') event.preventDefault();
      if (!event.repeat) {
        if (HOLDS.has(press)) this.holding.add(press as HoldAction);
        this.onPress?.(press);
      }
      return;
    }
    const action = BINDINGS[event.code];
    if (!action || !this.enabled || event.ctrlKey || event.altKey || event.metaKey || ownsKeyboard(event.target)) return;
    this.held.add(action);
    event.preventDefault(); // arrows would otherwise scroll the page
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (event.code === 'Space' && this.enabled && !ownsKeyboard(event.target)) event.preventDefault();
    const press = PRESSES[event.code];
    if (press && HOLDS.has(press)) this.release(press as HoldAction);
    const action = BINDINGS[event.code];
    if (action) this.held.delete(action);
  };
}
