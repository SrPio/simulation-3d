import type { MoveIntent } from '../character/CharacterController';

export type PressAction = 'interact' | 'laptop' | 'jump' | 'open' | 'throw' | 'punch' | 'kick';
const PRESSES: Record<string, PressAction> = {
  KeyE: 'interact', KeyL: 'laptop', Space: 'jump', Enter: 'open', NumpadEnter: 'open', KeyF: 'throw', KeyJ: 'punch', KeyK: 'kick',
};
/** Keys whose release matters too: holding them charges a strike. */
export type HoldAction = 'punch' | 'kick';
const HOLDS = new Set<PressAction>(['punch', 'kick']);

const BINDINGS: Record<string, 'forward' | 'back' | 'left' | 'right'> = {
  KeyW: 'forward', ArrowUp: 'forward', KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
};

/** Whether a key event belongs to a control that uses the keyboard itself (fields, selects, sliders). */
function ownsKeyboard(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest('input, select, textarea, [contenteditable=""], [contenteditable="true"]')) return true;
  return false;
}

/**
 * WASD / arrows for movement, Shift toggles running on and off, Space to jump, F to throw, J to punch and K to kick
 * (held to charge, released to strike), E and L for seats and the laptop, Enter to open a sign's link. Keys are released when the window loses focus or the
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
  /** Called when a held strike key (J, K) is released, or the window loses focus while it is down. */
  onRelease?: (action: HoldAction) => void;

  constructor(target: Window, signal: AbortSignal) {
    target.addEventListener('keydown', this.onKeyDown, { signal });
    target.addEventListener('keyup', this.onKeyUp, { signal });
    target.addEventListener('blur', this.clear, { signal });
    target.document.addEventListener('visibilitychange', this.clear, { signal });
  }

  get intent(): MoveIntent {
    const forward = (this.held.has('forward') ? 1 : 0) - (this.held.has('back') ? 1 : 0);
    const right = (this.held.has('right') ? 1 : 0) - (this.held.has('left') ? 1 : 0);
    return { forward, right, run: this.running };
  }

  get active(): boolean {
    return this.held.size > 0;
  }

  get run(): boolean {
    return this.running;
  }

  readonly clear = (): void => {
    this.held.clear();
    for (const action of [...this.holding]) this.release(action);
  };

  private release(action: HoldAction): void {
    if (!this.holding.delete(action)) return;
    this.onRelease?.(action);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
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
