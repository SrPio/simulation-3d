import type { MoveIntent } from '../character/CharacterController';

export type PressAction = 'interact' | 'laptop' | 'jump' | 'open';
const PRESSES: Record<string, PressAction> = { KeyE: 'interact', KeyL: 'laptop', Space: 'jump', Enter: 'open', NumpadEnter: 'open' };

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
 * WASD / arrows for movement, Shift toggles running on and off, Space to jump, E and L for seats and the laptop, Enter to open a sign's link. Keys are released when the window loses focus or the
 * page is hidden, so a key held while switching away never keeps the character walking.
 */
export class KeyboardInput {
  private readonly held = new Set<'forward' | 'back' | 'left' | 'right'>();
  /** Running mode: each Shift press switches it; it stays as it is while walking around. */
  private running = false;
  enabled = true;
  /** Called when Shift switches running on or off. */
  onRunChange?: (running: boolean) => void;
  /** One call per physical press of E (sit/stand), L (laptop), Space (jump) or Enter (open); key repeat is ignored. */
  onPress?: (action: PressAction) => void;

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
  };

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
      if (!event.repeat) this.onPress?.(press);
      return;
    }
    const action = BINDINGS[event.code];
    if (!action || !this.enabled || event.ctrlKey || event.altKey || event.metaKey || ownsKeyboard(event.target)) return;
    this.held.add(action);
    event.preventDefault(); // arrows would otherwise scroll the page
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (event.code === 'Space' && this.enabled && !ownsKeyboard(event.target)) event.preventDefault();
    const action = BINDINGS[event.code];
    if (action) this.held.delete(action);
  };
}
