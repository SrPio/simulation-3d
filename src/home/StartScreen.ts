import { HEAD_OUTLINE } from '../ui/silhouettes.ts';

export type StartState = 'loading' | 'ready' | 'opening' | 'done';

const SVG = 'http://www.w3.org/2000/svg';
/** Height of the head on screen, as a share of the smaller viewport side. */
const HEAD_SHARE = 0.46;
/** How long the hole takes to swallow the screen (ms) and the fade used instead with reduced motion. */
const OPEN_MS = 950;
const FADE_MS = 280;
/**
 * The hole's radius at its narrowest, as a share of the head's height: the scale that makes the outline clear every
 * corner of the screen is worked out from it, so the opening ends exactly when nothing of the screen is left.
 */
const INNER_RADIUS = 0.3;

/** Ease-in for the opening: slow at first, then the hole rushes outwards. */
export const easeIn = (t: number) => t * t * t;

/** The scale at which a hole of `inner` radius (px, at scale 1) round `centre` covers a `width` × `height` screen. */
export function coverScale(width: number, height: number, centre: { x: number; y: number }, inner: number): number {
  const reach = Math.max(...[[0, 0], [width, 0], [0, height], [width, height]].map(([x, y]) => Math.hypot(x - centre.x, y - centre.y)));
  return Math.max(1, (reach / Math.max(inner, 1)) * 1.05);
}

/**
 * The middle of the outline's filled area (its centroid). The head is placed by this point rather than by its box,
 * whose middle the cap's brim pulls far behind the skull: START and the head both read as centred on screen this way.
 */
export function outlineCentre(d: string): { x: number; y: number } {
  const points = [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
  let area = 0;
  let x = 0;
  let y = 0;
  points.forEach((a, i) => {
    const b = points[(i + 1) % points.length];
    const cross = a.x * b.y - b.x * a.y;
    area += cross;
    x += (a.x + b.x) * cross;
    y += (a.y + b.y) * cross;
  });
  return { x: x / (3 * area), y: y / (3 * area) };
}

const CENTRE = outlineCentre(HEAD_OUTLINE.d);

/**
 * The percentage shown while loading is paced by time, not by the bytes: it always fills from 0 to 100 in about
 * FILL_MS, easing in at the start. If the scene is not ready by HOLD_AT it creeps on ever slower (never past CREEP_MAX)
 * and, once everything has loaded, it finishes within FINISH_MS. READY_PAUSE_MS is the beat at 100% before START shows.
 */
export const FILL = { FILL_MS: 2400, EASE_IN_MS: 350, HOLD_AT: 0.88, CREEP_MAX: 0.99, FINISH_MS: 450, READY_PAUSE_MS: 220 };

/**
 * The speed (per ms) to finish at once the scene is ready with `shown` filled: an early load keeps the plain fill, a late
 * one runs the rest within FINISH_MS.
 */
export const finishSpeed = (shown: number) => (1 - Math.max(shown, FILL.HOLD_AT)) / FILL.FINISH_MS + 1e-6;

/**
 * One step of the shown progress: `elapsed` ms since loading began, `dt` ms since the last step, and `finish` the speed
 * from finishSpeed once everything has loaded, or 0 while still loading.
 */
export function fillStep(shown: number, elapsed: number, dt: number, finish: number): number {
  let speed = (1 / FILL.FILL_MS) * Math.min(1, elapsed / FILL.EASE_IN_MS);
  if (finish > 0) return Math.min(1, shown + Math.max(speed, finish) * dt);
  if (shown > FILL.HOLD_AT) speed *= ((FILL.CREEP_MAX - shown) / (FILL.CREEP_MAX - FILL.HOLD_AT)) ** 2;
  return Math.min(FILL.CREEP_MAX, shown + speed * dt);
}

/** Width of the line round the head on screen (px): while it runs round loading, and once the head is hollow. */
const LINE = { loading: 3, ready: 4 };

/**
 * The room page's loading screen: the character's head in profile (backwards cap and all) with a short bright line
 * running round its outline like a spinner while the scene loads. When everything is ready the whole outline lights up
 * and the head turns into a window of frosted, dark violet glass onto the room, with START inside (a click, Enter or
 * Space, or the gamepad); pressing it grows the hole until the outline leaves the screen while the glass clears.
 */
export class StartScreen {
  readonly root: HTMLDivElement;
  private readonly svg: SVGSVGElement;
  /** The frosted glass behind the hole: it blurs and tints the room until START clears it. */
  private readonly glass: HTMLDivElement;
  private grow = 1;
  private readonly hole: SVGGElement;
  private readonly holePath: SVGPathElement;
  private readonly outline: SVGGElement;
  private readonly line: SVGPathElement;
  private readonly button: HTMLButtonElement;
  private readonly percent: HTMLSpanElement;
  private state: StartState = 'loading';
  /** The percentage shown (paced by time, see FILL) and, once the scene is ready, the speed to finish at. */
  private progress = 0;
  private finishRate = 0;
  private loaded = false;
  private frame = 0;
  private fillFrame = 0;
  private readyTimer = 0;
  private readonly abort = new AbortController();
  private readonly onStart: () => void;
  private readonly reducedMotion: () => boolean;

  constructor(parent: HTMLElement, options: { onStart: () => void; reducedMotion: () => boolean; label: string }) {
    this.onStart = options.onStart;
    this.reducedMotion = options.reducedMotion;
    this.root = document.createElement('div');
    this.root.className = 'start-screen';
    this.root.dataset.start = 'loading';
    this.glass = document.createElement('div');
    this.glass.className = 'start-glass';
    this.svg = document.createElementNS(SVG, 'svg');
    this.svg.setAttribute('aria-hidden', 'true');
    this.svg.classList.add('start-art');
    const defs = document.createElementNS(SVG, 'defs');
    const mask = document.createElementNS(SVG, 'mask');
    mask.id = 'start-hole';
    mask.setAttribute('maskUnits', 'userSpaceOnUse');
    const all = document.createElementNS(SVG, 'rect');
    all.setAttribute('x', '-1');
    all.setAttribute('y', '-1');
    all.setAttribute('width', '100%');
    all.setAttribute('height', '100%');
    all.setAttribute('fill', '#fff');
    all.classList.add('start-mask-all');
    this.hole = document.createElementNS(SVG, 'g');
    this.holePath = document.createElementNS(SVG, 'path');
    this.holePath.setAttribute('d', HEAD_OUTLINE.d);
    this.holePath.classList.add('start-hole');
    this.hole.append(this.holePath);
    mask.append(all, this.hole);
    defs.append(mask);
    const backdrop = document.createElementNS(SVG, 'rect');
    backdrop.setAttribute('width', '100%');
    backdrop.setAttribute('height', '100%');
    backdrop.setAttribute('mask', 'url(#start-hole)');
    backdrop.classList.add('start-backdrop');
    this.outline = document.createElementNS(SVG, 'g');
    this.outline.classList.add('start-outline');
    this.line = document.createElementNS(SVG, 'path');
    this.line.setAttribute('d', HEAD_OUTLINE.d);
    this.line.setAttribute('pathLength', '1');
    this.line.classList.add('start-line');
    const ghost = document.createElementNS(SVG, 'path');
    ghost.setAttribute('d', HEAD_OUTLINE.d);
    ghost.classList.add('start-ghost');
    this.outline.append(ghost, this.line);
    this.svg.append(defs, backdrop, this.outline);
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'start-button';
    this.button.textContent = 'START';
    this.button.setAttribute('aria-label', options.label);
    this.button.disabled = true;
    this.percent = document.createElement('span');
    this.percent.className = 'start-percent';
    this.percent.setAttribute('aria-hidden', 'true');
    this.root.append(this.glass, this.svg, this.button, this.percent);
    parent.append(this.root);
    this.button.addEventListener('click', () => this.open(), { signal: this.abort.signal });
    window.addEventListener('resize', () => this.layout(this.grow), { signal: this.abort.signal });
    // Enter or Space start too, wherever the focus is.
    window.addEventListener('keydown', (event) => {
      if (this.state !== 'ready' || event.repeat || (event.code !== 'Enter' && event.code !== 'NumpadEnter' && event.code !== 'Space')) return;
      event.preventDefault();
      this.press();
    }, { signal: this.abort.signal });
    this.layout();
    this.showProgress(0);
    const begin = performance.now();
    let last = begin;
    const fill = (now: number) => {
      // A long frame (the scene parsing on the main thread) pauses the count instead of making it jump.
      const dt = Math.min(now - last, 50);
      last = now;
      this.showProgress(fillStep(this.progress, now - begin, dt, this.finishRate));
      if (this.progress < 1) this.fillFrame = requestAnimationFrame(fill);
      else this.readyTimer = window.setTimeout(() => this.becomeReady(), FILL.READY_PAUSE_MS);
    };
    this.fillFrame = requestAnimationFrame(fill);
  }

  get current(): StartState {
    return this.state;
  }

  setLabel(label: string): void {
    this.button.setAttribute('aria-label', label);
  }

  /** The percentage under the head (the line runs round it meanwhile). */
  private showProgress(fraction: number): void {
    const before = this.percent.textContent;
    this.progress = fraction;
    const text = `${Math.round(fraction * 100)}%`;
    if (text === before) return;
    this.percent.textContent = text;
    this.root.dataset.progress = fraction.toFixed(2);
  }

  /** Everything loaded: the count finishes quickly, then the head turns hollow over the scene with START inside. */
  ready(): void {
    if (this.loaded) return;
    this.loaded = true;
    this.finishRate = finishSpeed(this.progress);
  }

  private becomeReady(): void {
    if (this.state !== 'loading') return;
    this.setState('ready');
    this.layout(this.grow);
    this.button.disabled = false;
    this.button.focus({ preventScroll: true });
  }

  /** Hide without the opening (a loading error takes over the screen). */
  hide(): void {
    this.root.hidden = true;
  }

  show(): void {
    this.root.hidden = false;
  }

  private setState(state: StartState): void {
    this.state = state;
    this.root.dataset.start = state;
  }

  /** Where the head sits and how large: centred, HEAD_SHARE of the smaller side high. */
  private placement(): { x: number; y: number; scale: number } {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const scale = (Math.min(width, height) * HEAD_SHARE) / HEAD_OUTLINE.height;
    return { x: width / 2, y: height / 2, scale };
  }

  private transform(grow: number): string {
    const { x, y, scale } = this.placement();
    const s = scale * grow;
    // The head's middle (the centroid of its area) stays on the screen centre while it grows.
    return `translate(${x} ${y}) scale(${s}) translate(${-CENTRE.x} ${-CENTRE.y})`;
  }

  private layout(grow = 1): void {
    this.grow = grow;
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const transform = this.transform(grow);
    this.hole.setAttribute('transform', transform);
    this.outline.setAttribute('transform', transform);
    // How far the chin reaches below the screen centre, for the percentage under it.
    this.root.style.setProperty('--start-below', `${this.placement().scale * (HEAD_OUTLINE.height - CENTRE.y)}px`);
    // The line is drawn in the head's own units: its width is divided by the scale so it keeps its screen width.
    const pixels = this.state === 'loading' ? LINE.loading : LINE.ready;
    this.line.style.strokeWidth = String(pixels / (this.placement().scale * grow));
  }

  /** START: from the button, Enter or Space, or a gamepad button (the page calls this). */
  press(): void {
    this.open();
  }

  private open(): void {
    if (this.state !== 'ready') return;
    this.setState('opening');
    this.button.disabled = true;
    this.onStart();
    if (this.reducedMotion()) {
      this.root.classList.add('start-fade');
      window.setTimeout(() => this.finish(), FADE_MS);
      return;
    }
    const { x, y, scale } = this.placement();
    const target = coverScale(window.innerWidth, window.innerHeight, { x, y }, INNER_RADIUS * HEAD_OUTLINE.height * scale);
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / OPEN_MS);
      this.layout(1 + (target - 1) * easeIn(t));
      if (t < 1) this.frame = requestAnimationFrame(step);
      else this.finish();
    };
    this.frame = requestAnimationFrame(step);
  }

  private finish(): void {
    this.setState('done');
    this.root.hidden = true;
    this.dispose();
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    cancelAnimationFrame(this.fillFrame);
    clearTimeout(this.readyTimer);
    this.abort.abort();
  }
}
