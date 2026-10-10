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

/**
 * Joystick flicks for the Konami code: a push past `reach` of the radius, clearly along one axis, let go of (back to
 * the dead zone, or the other way) within `time` seconds counts as that arrow; a longer push is just walking.
 */
export const FLICK = { reach: 0.55, axis: 1.4, time: 0.5 } as const;

export type FlickCode = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';

/** The arrow a joystick dragged `dx`, `dy` px (y down) from its centre points, when pushed far enough along one axis. */
export function flickDirection(dx: number, dy: number, radius: number): FlickCode | undefined {
  if (Math.hypot(dx, dy) < radius * FLICK.reach) return undefined;
  if (Math.abs(dy) >= Math.abs(dx) * FLICK.axis) return dy < 0 ? 'ArrowUp' : 'ArrowDown';
  if (Math.abs(dx) >= Math.abs(dy) * FLICK.axis) return dx < 0 ? 'ArrowLeft' : 'ArrowRight';
  return undefined;
}

/** Follows one finger on the joystick and reports each quick flick (an arrow of the Konami code) as it ends. */
export class FlickReader {
  private current?: { code: FlickCode; since: number };

  /** The joystick at dx, dy at `time` seconds; returns the flick that just ended, if any. */
  move(dx: number, dy: number, radius: number, time: number): FlickCode | undefined {
    const code = flickDirection(dx, dy, radius);
    if (code && code === this.current?.code) return undefined;
    const back = Math.hypot(dx, dy) < radius * STICK.dead;
    // Swept straight on to another arrow, or back to the middle: the flick so far ends.
    const ended = code || back ? this.end(time) : undefined;
    if (code) this.current = { code, since: time };
    return ended;
  }

  /** The finger lifted (or the push ended) at `time` seconds. */
  end(time: number): FlickCode | undefined {
    const current = this.current;
    this.current = undefined;
    return current && time - current.since <= FLICK.time ? current.code : undefined;
  }
}

/** What the zone button says in a sign's zone (`data-sign` is the sign id, or `reset-<group>` in a reset zone). */
export function zoneAction(sign: string): { kind: 'link' | 'reset'; key: MessageKey } | undefined {
  if (!sign || sign === 'none') return undefined;
  if (sign.startsWith('reset-')) return { kind: 'reset', key: 'touch.reset' };
  const key = `touch.visit.${sign}`;
  return { kind: 'link', key: (key in MESSAGES.es ? key : 'touch.open') as MessageKey };
}

/** Arrows for the office chair's pedals and steering, in the same 100 × 100 box as the silhouettes. */
export const PEDAL_ARROWS = {
  up: 'M50 12 L86 52 L63 52 L63 88 L37 88 L37 52 L14 52 Z',
  down: 'M50 88 L86 48 L63 48 L63 12 L37 12 L37 48 L14 48 Z',
  left: 'M12 50 L52 14 L52 37 L88 37 L88 63 L52 63 L52 86 Z',
  right: 'M88 50 L48 14 L48 37 L12 37 L12 63 L48 63 L48 86 Z',
} as const;

/**
 * The buttons: what each does (a press, a hold kept until the finger lifts, the run switch, or, while riding, a pedal
 * held like W or S or a steering arrow held like A or D) and its figure.
 */
type Button = { id: string; label: MessageKey; icon?: ActionIcon; arrow?: keyof typeof PEDAL_ARROWS; press?: PressAction; hold?: HoldAction; run?: true; pedal?: 1 | -1; steer?: 1 | -1; konami?: 'KeyB' | 'KeyA' };
const BUTTONS: Button[] = [
  { id: 'accelerate', arrow: 'up', label: 'touch.accelerate', pedal: 1 },
  { id: 'reverse', arrow: 'down', label: 'touch.reverse', pedal: -1 },
  { id: 'nitro', icon: 'nitro', label: 'touch.nitro', hold: 'jump' },
  { id: 'sit', icon: 'sit', label: 'touch.sit', press: 'interact' },
  { id: 'laptop', icon: 'laptop', label: 'touch.laptop', press: 'laptop' },
  { id: 'throw', icon: 'throw', label: 'touch.throw', hold: 'throw', konami: 'KeyB' },
  { id: 'kick', icon: 'kick', label: 'touch.kick', hold: 'kick' },
  { id: 'punch', icon: 'punch', label: 'touch.punch', hold: 'punch' },
  { id: 'run', icon: 'run', label: 'touch.run', run: true },
  { id: 'jump', icon: 'jump', label: 'touch.jump', hold: 'jump', konami: 'KeyA' },
];
/** Riding, these take the joystick's place: left and right, like A and D (or the arrow keys). */
const STEER: Button[] = [
  { id: 'left', arrow: 'left', label: 'touch.left', steer: -1 },
  { id: 'right', arrow: 'right', label: 'touch.right', steer: 1 },
];
/** The analog sources the riding buttons hold, let go of when the rider gets off. */
const RIDING_SOURCES = ['pedal-accelerate', 'pedal-reverse', 'steer-left', 'steer-right'];

/**
 * On-screen controls for touch screens: a joystick bottom left (forward is up the screen, a full push runs) and round
 * buttons bottom right, each showing the character's own silhouette doing the action. Buttons show only when they
 * make sense, read from the viewer's state on its host: walking about (jump, run, punch, kick, throw; sit near a seat),
 * seated (stand up, the laptop) or riding the office chair (accelerate and reverse, the nitro, stand up; the joystick
 * gives way to two arrows that steer left and right). Near a seat
 * the sit button glows on and off softly, as the speech bubble over the head asks for it. Standing in a sign's or a reset
 * zone, a short text button above them names what Enter does there (visit the site, reset the pieces). The Konami
 * code works here too: quick flicks of the joystick are its arrows, the throw button its B and the jump button its A.
 */
export class TouchControls {
  readonly root: HTMLDivElement;
  private readonly stick: HTMLDivElement;
  private readonly steer: HTMLDivElement;
  private readonly knob: HTMLDivElement;
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private readonly zone: HTMLButtonElement;
  private readonly zoneText: HTMLSpanElement;
  private text?: (key: MessageKey) => string;
  private readonly host: HTMLElement;
  private pointer?: number;
  private readonly flicks = new FlickReader();
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
    for (const button of BUTTONS) pad.append(this.makeButton(button));
    this.steer = document.createElement('div');
    this.steer.className = 'touch-steer';
    this.steer.hidden = true;
    for (const button of STEER) this.steer.append(this.makeButton(button));
    const signal = this.abort.signal;
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
    this.root.append(this.stick, this.steer, side);
    parent.append(this.root);
    this.stick.addEventListener('pointerdown', this.onStickDown, { signal });
    this.stick.addEventListener('pointermove', this.onStickMove, { signal });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) this.stick.addEventListener(type, this.onStickUp, { signal });
    this.observer = new MutationObserver(() => this.sync(host));
    this.observer.observe(host, { attributes: true, attributeFilter: ['data-interaction', 'data-prompt', 'data-sign', 'data-drive'] });
    this.sync(host);
  }

  /** One round button wired to the input. */
  private makeButton(button: Button): HTMLButtonElement {
    const signal = this.abort.signal;
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
      // Every button is a step of the Konami code: B and A for throw and jump, anything else breaks it.
      keys.konamiStep(button.konami ?? button.id);
      if (button.pedal) keys.setAnalog(`pedal-${button.id}`, { forward: button.pedal, right: 0, run: false });
      else if (button.steer) keys.setAnalog(`steer-${button.id}`, { forward: 0, right: button.steer, run: false });
      else if (button.run) keys.toggleRun();
      else if (button.hold) keys.press(button.hold);
      else if (button.press) keys.press(button.press);
    };
    const up = () => {
      element.classList.remove('is-down');
      if (button.hold) this.input()?.release(button.hold);
      if (button.pedal) this.input()?.setAnalog(`pedal-${button.id}`, undefined);
      if (button.steer) this.input()?.setAnalog(`steer-${button.id}`, undefined);
    };
    element.addEventListener('pointerdown', down, { signal });
    element.addEventListener('pointerup', up, { signal });
    element.addEventListener('pointercancel', up, { signal });
    element.addEventListener('lostpointercapture', up, { signal });
    element.addEventListener('contextmenu', (event) => event.preventDefault(), { signal });
    this.buttons.set(button.id, element);
    return element;
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
      laptop: seated, throw: free, kick: free, punch: free, run: free, jump: free, left: riding, right: riding,
    };
    for (const [id, element] of this.buttons) element.hidden = !show[id];
    // Riding, the steering arrows replace the joystick; a finger still on it lets go so it never keeps steering.
    this.stick.hidden = riding;
    this.steer.hidden = !riding;
    if (riding && this.pointer !== undefined) this.releaseStick();
    // Getting off with a pedal or an arrow still down must not leave the chair driving.
    if (!riding) for (const source of RIDING_SOURCES) this.input()?.setAnalog(source, undefined);
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
    const flick = this.flicks.move(dx, dy, radius, event.timeStamp / 1000);
    if (flick) this.input()?.konamiStep(flick);
    const move = stickMove(dx, dy, radius);
    this.input()?.setAnalog('touch', move);
    this.root.dataset.joystick = move ? `${move.right.toFixed(2)},${move.forward.toFixed(2)}` : 'none';
  };

  private readonly onStickUp = (event: PointerEvent): void => {
    if (event.pointerId === this.pointer) this.releaseStick();
  };

  private releaseStick(): void {
    const flick = this.flicks.end(performance.now() / 1000);
    if (flick) this.input()?.konamiStep(flick);
    if (this.pointer !== undefined && this.stick.hasPointerCapture(this.pointer)) this.stick.releasePointerCapture(this.pointer);
    this.pointer = undefined;
    this.stick.classList.remove('is-active');
    this.knob.style.transform = '';
    this.input()?.setAnalog('touch', undefined);
    this.root.dataset.joystick = 'none';
  }

  dispose(): void {
    this.observer.disconnect();
    this.abort.abort();
    this.root.remove();
  }
}
