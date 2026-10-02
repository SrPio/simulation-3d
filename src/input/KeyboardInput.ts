import type { MoveIntent } from '../character/CharacterController';

export type PressAction = 'interact' | 'laptop';
const PRESSES: Record<string, PressAction> = { KeyE: 'interact', KeyL: 'laptop' };

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
 * WASD / arrows for movement and Shift to run. Keys are released when the window loses focus or the
 * page is hidden, so a key held while switching away never keeps the character walking.
 */
export class KeyboardInput {
  private readonly held = new Set<'forward' | 'back' | 'left' | 'right'>();
  private shift = false;
  enabled = true;
  /** One call per physical press of E (sit/stand) or L (laptop); key repeat is ignored. */
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
    return { forward, right, run: this.shift };
  }

  get active(): boolean {
    return this.held.size > 0;
  }

  readonly clear = (): void => {
    this.held.clear();
    this.shift = false;
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Shift') this.shift = true;
    const press = PRESSES[event.code];
    if (press && this.enabled && !event.repeat && !event.ctrlKey && !event.altKey && !event.metaKey && !ownsKeyboard(event.target)) {
      this.onPress?.(press);
      return;
    }
    const action = BINDINGS[event.code];
    if (!action || !this.enabled || event.ctrlKey || event.altKey || event.metaKey || ownsKeyboard(event.target)) return;
    this.held.add(action);
    this.shift = event.shiftKey;
    event.preventDefault(); // arrows would otherwise scroll the page
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (event.key === 'Shift') this.shift = false;
    const action = BINDINGS[event.code];
    if (action) this.held.delete(action);
  };
}
