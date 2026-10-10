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
 * The room page's loading screen: the character's head in profile (backwards cap and all) drawn by a line that follows
 * the loading progress. When everything is ready the head turns hollow, showing the room through it, with START inside;
 * pressing it grows the hollow head until its outline leaves the screen and the scene is all that remains.
 */
export class StartScreen {
  readonly root: HTMLDivElement;
  private readonly svg: SVGSVGElement;
  private readonly hole: SVGGElement;
  private readonly holePath: SVGPathElement;
  private readonly outline: SVGGElement;
  private readonly line: SVGPathElement;
  private readonly button: HTMLButtonElement;
  private readonly percent: HTMLSpanElement;
  private state: StartState = 'loading';
  private progress = 0;
  private frame = 0;
  private readonly abort = new AbortController();
  private readonly onStart: () => void;
  private readonly reducedMotion: () => boolean;

  constructor(parent: HTMLElement, options: { onStart: () => void; reducedMotion: () => boolean; label: string }) {
    this.onStart = options.onStart;
    this.reducedMotion = options.reducedMotion;
    this.root = document.createElement('div');
    this.root.className = 'start-screen';
    this.root.dataset.start = 'loading';
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
    this.root.append(this.svg, this.button, this.percent);
    parent.append(this.root);
    this.button.addEventListener('click', () => this.open(), { signal: this.abort.signal });
    window.addEventListener('resize', () => this.layout(), { signal: this.abort.signal });
    this.layout();
    this.setProgress(0);
  }

  get current(): StartState {
    return this.state;
  }

  setLabel(label: string): void {
    this.button.setAttribute('aria-label', label);
  }

  /** The line round the head follows the loading, 0…1. */
  setProgress(fraction: number): void {
    this.progress = Math.max(this.progress, Math.min(1, fraction));
    this.line.style.strokeDashoffset = String(1 - this.progress);
    this.percent.textContent = `${Math.round(this.progress * 100)}%`;
    this.root.dataset.progress = this.progress.toFixed(2);
  }

  /** Everything loaded: the head turns hollow over the scene and START shows inside it. */
  ready(): void {
    if (this.state !== 'loading') return;
    this.setProgress(1);
    this.setState('ready');
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
    // The head's middle (its box centre) stays on the screen centre while it grows.
    return `translate(${x} ${y}) scale(${s}) translate(${-HEAD_OUTLINE.width / 2} ${-HEAD_OUTLINE.height / 2})`;
  }

  private layout(grow = 1): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const transform = this.transform(grow);
    this.hole.setAttribute('transform', transform);
    this.outline.setAttribute('transform', transform);
    this.root.style.setProperty('--start-head', `${this.placement().scale * HEAD_OUTLINE.height}px`);
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
    this.abort.abort();
  }
}
