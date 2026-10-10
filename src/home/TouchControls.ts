import type { AnalogMove, HoldAction, KeyboardInput, PressAction } from '../input/KeyboardInput.ts';
import { ACTION_ICONS, type ActionIcon } from '../ui/silhouettes.ts';
import { MESSAGES, type MessageKey } from '../core/i18n.ts';

/** Joystick: below this share of its radius it does nothing; past `run` the character runs. */
export const STICK = { dead: 0.14, run: 0.9 } as const;

/** The push of a joystick dragged `dx`, `dy` px (y down) from its centre, `radius` px at full tilt: forward is up the screen. */
export function stickMove(dx: number, dy: number, radius: number): AnalogMove | undefined {
  const length = Math.hypot(dx, dy);
  const amount = Math.min(length / radius, 1);
  if (amount < STICK.dead || length === 0) return undefined;
  // Rescaled past the dead zone, so a light push still starts slowly from 0.
  const strength = (amount - STICK.dead) / (1 - STICK.dead);
  return { forward: (-dy / length) * strength, right: (dx / length) * strength, run: amount >= STICK.run };
}

/** What the zone button says in a sign's zone (`data-sign` is the sign id, or `reset-<group>` in a reset zone). */
export function zoneAction(sign: string): { kind: 'link' | 'reset'; key: MessageKey } | undefined {
  if (!sign || sign === 'none') return undefined;
  if (sign.startsWith('reset-')) return { kind: 'reset', key: 'touch.reset' };
  const key = `touch.visit.${sign}`;
  return { kind: 'link', key: (key in MESSAGES.es ? key : 'touch.open') as MessageKey };
}

/** Arrows for the office chair's pedals, in the same 100 × 100 box as the silhouettes. */
export const PEDAL_ARROWS = {
  up: 'M50 12 L86 52 L63 52 L63 88 L37 88 L37 52 L14 52 Z',
  down: 'M50 88 L86 48 L63 48 L63 12 L37 12 L37 48 L14 48 Z',
} as const;

/**
 * The buttons: what each does (a press, a hold kept until the finger lifts, the run switch, or a pedal held like W or S
 * while riding) and its figure.
 */
type Button = { id: string; label: MessageKey; icon?: ActionIcon; arrow?: keyof typeof PEDAL_ARROWS; press?: PressAction; hold?: HoldAction; run?: true; pedal?: 1 | -1 };
const BUTTONS: Button[] = [
  { id: 'accelerate', arrow: 'up', label: 'touch.accelerate', pedal: 1 },
  { id: 'reverse', arrow: 'down', label: 'touch.reverse', pedal: -1 },
  { id: 'nitro', icon: 'nitro', label: 'touch.nitro', hold: 'jump' },
  { id: 'sit', icon: 'sit', label: 'touch.sit', press: 'interact' },
  { id: 'laptop', icon: 'laptop', label: 'touch.laptop', press: 'laptop' },
  { id: 'throw', icon: 'throw', label: 'touch.throw', hold: 'throw' },
  { id: 'kick', icon: 'kick', label: 'touch.kick', hold: 'kick' },
  { id: 'punch', icon: 'punch', label: 'touch.punch', hold: 'punch' },
  { id: 'run', icon: 'run', label: 'touch.run', run: true },
  { id: 'jump', icon: 'jump', label: 'touch.jump', hold: 'jump' },
];

/**
 * On-screen controls for touch screens: a joystick bottom left (forward is up the screen, a full push runs) and round
 * buttons bottom right, each showing the character's own silhouette doing the action. Buttons show only when they
 * make sense, read from the viewer's state on its host: walking about (jump, run, punch, kick, throw; sit near a seat),
 * seated (stand up, the laptop) or riding the office chair (accelerate and reverse, the nitro, stand up). Near a seat
 * the sit button glows on and off softly, as the speech bubble over the head asks for it. Standing in a sign's or a reset
 * zone, a short text button above them names what Enter does there (visit the site, reset the pieces).
 */
export class TouchControls {
  readonly root: HTMLDivElement;
  private readonly stick: HTMLDivElement;
  private readonly knob: HTMLDivElement;
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private readonly zone: HTMLButtonElement;
  private readonly zoneText: HTMLSpanElement;
  private text?: (key: MessageKey) => string;
  private readonly host: HTMLElement;
  private pointer?: number;
  private readonly abort = new AbortController();
  private readonly observer: MutationObserver;
  private readonly input: () => KeyboardInput | undefined;

  constructor(parent: HTMLElement, host: HTMLElement, input: () => KeyboardInput | undefined) {
    this.input = input;
    this.host = host;
    this.root = document.createElement('div');
    this.root.className = 'touch-controls';
    this.root.hidden = true;
    this.stick = document.createElement('div');
    this.stick.className = 'touch-stick';
    this.knob = document.createElement('div');
    this.knob.className = 'touch-knob';
    this.stick.append(this.knob);
    const pad = document.createElement('div');
    pad.className = 'touch-buttons';
    const signal = this.abort.signal;
    for (const button of BUTTONS) {
      const element = document.createElement('button');
      element.type = 'button';
      element.className = 'touch-button';
      element.dataset.action = button.id;
      element.innerHTML = `<svg viewBox="0 0 100 100" aria-hidden="true"><path fill-rule="evenodd" d="${button.arrow ? PEDAL_ARROWS[button.arrow] : ACTION_ICONS[button.icon!]}"></path></svg>`;
      element.dataset.label = button.label;
      if (button.run) element.setAttribute('aria-pressed', 'false');
      const down = (event: PointerEvent) => {
        event.preventDefault();
        element.setPointerCapture(event.pointerId);
        element.classList.add('is-down');
        const keys = this.input();
        if (!keys) return;
        if (button.pedal) keys.setAnalog(`pedal-${button.id}`, { forward: button.pedal, right: 0, run: false });
        else if (button.run) keys.toggleRun();
        else if (button.hold) keys.press(button.hold);
        else if (button.press) keys.press(button.press);
      };
      const up = () => {
        element.classList.remove('is-down');
        if (button.hold) this.input()?.release(button.hold);
        if (button.pedal) this.input()?.setAnalog(`pedal-${button.id}`, undefined);
      };
      element.addEventListener('pointerdown', down, { signal });
      element.addEventListener('pointerup', up, { signal });
      element.addEventListener('pointercancel', up, { signal });
      element.addEventListener('lostpointercapture', up, { signal });
      element.addEventListener('contextmenu', (event) => event.preventDefault(), { signal });
      this.buttons.set(button.id, element);
      pad.append(element);
    }
    this.zone = document.createElement('button');
    this.zone.type = 'button';
    this.zone.className = 'touch-zone';
    this.zone.hidden = true;
    this.zone.innerHTML = `<svg viewBox="0 0 100 100" aria-hidden="true"><path fill-rule="evenodd" d="${ACTION_ICONS.open}"></path></svg><span></span>`;
    this.zoneText = this.zone.querySelector('span')!;
    this.zone.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      this.zone.classList.add('is-down');
      this.input()?.press('open');
    }, { signal });
    for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const) this.zone.addEventListener(type, () => this.zone.classList.remove('is-down'), { signal });
    this.zone.addEventListener('contextmenu', (event) => event.preventDefault(), { signal });
    const side = document.createElement('div');
    side.className = 'touch-side';
    side.append(this.zone, pad);
    this.root.append(this.stick, side);
    parent.append(this.root);
    this.stick.addEventListener('pointerdown', this.onStickDown, { signal });
    this.stick.addEventListener('pointermove', this.onStickMove, { signal });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) this.stick.addEventListener(type, this.onStickUp, { signal });
    this.observer = new MutationObserver(() => this.sync(host));
    this.observer.observe(host, { attributes: true, attributeFilter: ['data-interaction', 'data-prompt', 'data-sign', 'data-drive'] });
    this.sync(host);
  }

  /** Labels in the current language. */
  setLabels(text: (key: MessageKey) => string): void {
    this.text = text;
    for (const element of this.buttons.values()) element.setAttribute('aria-label', text(element.dataset.label as MessageKey));
    this.sync(this.host);
  }

  show(): void {
    this.root.hidden = false;
  }

  /** The run switch shows whether running is on (Shift and this button share it). */
  setRunning(on: boolean): void {
    this.buttons.get('run')?.setAttribute('aria-pressed', String(on));
  }

  /** Which buttons fit what the character is doing. */
  private sync(host: HTMLElement): void {
    const { interaction = 'free', prompt = 'none', sign = 'none', drive = 'none' } = host.dataset;
    const riding = drive !== 'none';
    const free = interaction === 'free';
    const seated = !free && !riding;
    const show: Record<string, boolean> = {
      accelerate: riding, reverse: riding, nitro: riding, sit: (free && prompt !== 'none') || seated || riding,
      laptop: seated, throw: free, kick: free, punch: free, run: free, jump: free,
    };
    for (const [id, element] of this.buttons) element.hidden = !show[id];
    // Getting off with a pedal still down must not leave the chair driving.
    if (!riding) for (const id of ['accelerate', 'reverse']) this.input()?.setAnalog(`pedal-${id}`, undefined);
    this.buttons.get('sit')?.classList.toggle('is-hint', free && prompt !== 'none');
    const zone = free ? zoneAction(sign) : undefined;
    this.zone.hidden = !zone;
    if (zone) {
      this.zone.dataset.zone = zone.kind;
      this.zoneText.textContent = this.text?.(zone.key) ?? '';
    }
    this.root.dataset.mode = riding ? 'riding' : free ? 'free' : 'seated';
  }

  private readonly onStickDown = (event: PointerEvent): void => {
    if (this.pointer !== undefined) return;
    event.preventDefault();
    this.pointer = event.pointerId;
    this.stick.setPointerCapture(event.pointerId);
    this.stick.classList.add('is-active');
    this.onStickMove(event);
  };

  private readonly onStickMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointer) return;
    const box = this.stick.getBoundingClientRect();
    const radius = box.width / 2;
    let dx = event.clientX - (box.left + radius);
    let dy = event.clientY - (box.top + radius);
    const length = Math.hypot(dx, dy);
    if (length > radius) {
      dx *= radius / length;
      dy *= radius / length;
    }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const move = stickMove(dx, dy, radius);
    this.input()?.setAnalog('touch', move);
    this.root.dataset.joystick = move ? `${move.right.toFixed(2)},${move.forward.toFixed(2)}` : 'none';
  };

  private readonly onStickUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointer) return;
    this.pointer = undefined;
    this.stick.classList.remove('is-active');
    this.knob.style.transform = '';
    this.input()?.setAnalog('touch', undefined);
    this.root.dataset.joystick = 'none';
  };

  dispose(): void {
    this.observer.disconnect();
    this.abort.abort();
    this.root.remove();
  }
}
