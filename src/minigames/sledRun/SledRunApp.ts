import './sledRun.css';
import { t, type MessageKey } from '../../core/i18n.ts';
import { christmasFile, halloweenFile, loadModelFile, modelVersions } from '../../core/loadAssets.ts';
import type { QualityId } from '../../core/quality.ts';
import type { Sounds } from '../../audio/Sounds.ts';
import { ACTION_ICONS } from '../../ui/silhouettes.ts';
import type { AppHandle, DesktopApp } from '../../home/desktop/WindowManager.ts';
import {
  SLED, multiplier, newRun, points, readSledRecord, saveSledScore, startRun, steer, stepRun, trick, type SledRun, type TrickKind,
} from './sledRun.ts';
import { howToSheet } from './howTo.ts';
import { SledRunView, type Season, type SledAssets } from './SledRunView.ts';

export type SledHooks = {
  /** The page's viewer host: the game's state is kept on it for tests (`data-minigame`, `data-mg-*`). */
  host: HTMLElement;
  season: Season;
  quality: () => QualityId;
  reducedMotion: () => boolean;
  sounds?: Sounds;
};

type Screen = 'loading' | 'error' | 'ready' | 'playing' | 'paused' | 'over';

const silhouette = (d: string, className = '') => `<svg class="${className}" viewBox="0 0 100 100" aria-hidden="true"><path class="i-mark" fill-rule="evenodd" d="${d}"/></svg>`;
/** The window's icon: the rider with the nitro. */
export const SLED_ICON = `<svg viewBox="0 0 64 64" aria-hidden="true"><rect class="i-front" x="6" y="6" width="52" height="52" rx="14"/><g transform="translate(9 9) scale(0.46)"><path class="i-mark" fill-rule="evenodd" d="${ACTION_ICONS.nitro}"/></g></svg>`;
const ARROW = (points: string) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${points}"/></svg>`;

const LEFT_KEYS = new Set(['ArrowLeft', 'KeyA', 'ArrowDown', 'KeyS']);
const RIGHT_KEYS = new Set(['ArrowRight', 'KeyD', 'ArrowUp', 'KeyW']);
const GO_KEYS = new Set(['Enter', 'Space', 'NumpadEnter']);
/** Tricks in the air: a spin round, a flip over backwards. */
const TRICK_KEYS: Record<string, TrickKind> = { Space: 'spin', KeyZ: 'spin', KeyJ: 'spin', KeyX: 'flip', KeyK: 'flip' };

/** The tricks of a jump as words: «Vuelta ×2 + Mortal». */
function trickNames(tricks: readonly TrickKind[]): string {
  const groups: { kind: TrickKind; count: number }[] = [];
  for (const kind of tricks) {
    const last = groups[groups.length - 1];
    if (last?.kind === kind) last.count += 1;
    else groups.push({ kind, count: 1 });
  }
  return groups.map(({ kind, count }) => `${t(`sled.trick.${kind}`)}${count > 1 ? ` ×${count}` : ''}`).join(' + ');
}
/** Below this horizontal movement (px) a touch is a tap, not a swipe. */
const SWIPE = 28;

function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** The chair downhill in a desktop window. */
export function sledRunApp(hooks: SledHooks): DesktopApp {
  return {
    id: 'sled',
    title: 'games.sled',
    icon: SLED_ICON,
    size: { width: 820, height: 580 },
    render: (body) => new SledRunGame(body, hooks).handle,
  };
}

/**
 * The game in its window: loads its own copy of the character, the circuit (and the season's vessel), runs the pure
 * rules (sledRun.ts) and draws them (SledRunView.ts), with a score bar, the lives, the nitro, and screens to start,
 * pause and play again. Keys and the gamepad reach it through the desktop while its window is in front.
 */
class SledRunGame {
  readonly handle: AppHandle;
  private readonly hooks: SledHooks;
  private readonly root: HTMLDivElement;
  private readonly stage: HTMLDivElement;
  private readonly screen: HTMLDivElement;
  private readonly lives: HTMLOListElement;
  private readonly score: HTMLElement;
  private readonly multi: HTMLElement;
  private readonly best: HTMLElement;
  private readonly nitro: HTMLDivElement;
  private readonly pop: HTMLParagraphElement;
  private readonly abort = new AbortController();
  private readonly resizer: ResizeObserver;
  private view?: SledRunView;
  private run: SledRun = newRun();
  private record = readSledRecord(storage());
  private state: Screen = 'loading';
  private frame = 0;
  private last = 0;
  private shown = { lives: -1, score: -1, multi: -1, nitro: -1 };
  private touchStart?: { x: number; y: number; id: number };
  private disposed = false;
  private popTimer = 0;

  constructor(body: HTMLElement, hooks: SledHooks) {
    this.hooks = hooks;
    body.classList.add('sled-body');
    body.innerHTML = `
      <div class="sled" data-owns-keys tabindex="0" data-i18n-label="games.sled">
        <div class="sled-stage"></div>
        <div class="sled-hud">
          <ol class="sled-lives" data-i18n-label="sled.lives">${Array.from({ length: SLED.lives }, () => `<li>${silhouette(ACTION_ICONS.sit)}</li>`).join('')}</ol>
          <div class="sled-score"><span data-i18n="sled.score"></span><strong>0</strong><em>×1</em></div>
          <div class="sled-best"><span data-i18n="sled.best"></span><strong>0</strong></div>
        </div>
        <p class="sled-pop" aria-hidden="true"></p>
        <div class="sled-nitro" hidden><span data-i18n="sled.nitro"></span><i></i></div>
        <div class="sled-touch">
          <button type="button" class="sled-steer" data-steer="-1" data-i18n-label="sled.left">${ARROW('M15 5l-7 7 7 7')}</button>
          <button type="button" class="sled-steer" data-steer="1" data-i18n-label="sled.right">${ARROW('M9 5l7 7-7 7')}</button>
        </div>
        <div class="sled-screen" role="status" aria-live="polite"></div>
      </div>`;
    this.root = body.querySelector('.sled')!;
    this.stage = body.querySelector('.sled-stage')!;
    this.screen = body.querySelector('.sled-screen')!;
    this.lives = body.querySelector('.sled-lives')!;
    this.score = body.querySelector('.sled-score strong')!;
    this.multi = body.querySelector('.sled-score em')!;
    this.best = body.querySelector('.sled-best strong')!;
    this.nitro = body.querySelector('.sled-nitro')!;
    this.pop = body.querySelector('.sled-pop')!;
    this.best.textContent = String(this.record.best);
    this.handle = {
      dispose: () => this.dispose(),
      key: (event, down) => this.key(event, down),
      pad: (button) => this.pad(button),
      front: (front) => {
        if (!front) this.pause();
      },
      // The instructions are drawn with their words in them: draw them again in the new language.
      language: () => {
        if (this.state === 'ready') this.show('ready');
      },
    };
    const signal = this.abort.signal;
    this.screen.addEventListener('click', (event) => {
      const action = (event.target as Element).closest<HTMLElement>('[data-action]')?.dataset.action;
      if (action === 'start') this.start();
      else if (action === 'resume') this.resume();
    }, { signal });
    for (const button of body.querySelectorAll<HTMLButtonElement>('[data-steer]')) {
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        this.steer(Number(button.dataset.steer) as -1 | 1);
      }, { signal });
    }
    // Swipes on the picture change lanes; a tap starts or resumes.
    this.stage.addEventListener('pointerdown', (event) => {
      this.touchStart = { x: event.clientX, y: event.clientY, id: event.pointerId };
    }, { signal });
    this.stage.addEventListener('pointerup', (event) => {
      const from = this.touchStart;
      this.touchStart = undefined;
      if (!from || from.id !== event.pointerId) return;
      const dx = event.clientX - from.x;
      const dy = event.clientY - from.y;
      if (Math.abs(dx) >= SWIPE && Math.abs(dx) > Math.abs(dy)) this.steer(dx > 0 ? 1 : -1);
      // In the air: a swipe up flips, a tap spins.
      else if (dy <= -SWIPE) this.trick('flip');
      else if (Math.abs(dx) < SWIPE && Math.abs(dy) < SWIPE) this.trick('spin');
    }, { signal });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pause();
    }, { signal });
    this.resizer = new ResizeObserver(() => this.resize());
    this.resizer.observe(this.stage);
    this.show('loading');
    void this.load();
  }

  private async load(): Promise<void> {
    const signal = this.abort.signal;
    try {
      const season = this.hooks.season;
      const [character, circuit, extra] = await Promise.all([
        loadModelFile(modelVersions.v4rig.file, signal),
        loadModelFile('models/circuit.glb', signal),
        season === 'halloween' ? loadModelFile(halloweenFile, signal) : season === 'christmas' ? loadModelFile(christmasFile, signal) : Promise.resolve(undefined),
      ]);
      if (this.disposed) return;
      const assets: SledAssets = { character, circuit, halloween: season === 'halloween' ? extra : undefined, christmas: season === 'christmas' ? extra : undefined };
      this.view = new SledRunView(assets, { season, quality: this.hooks.quality(), reducedMotion: this.hooks.reducedMotion(), sounds: this.hooks.sounds });
      this.stage.append(this.view.canvas);
      this.resize();
      this.view.update(this.run, 0, []);
      // Shaders compile before the first picture is shown, not while the chair races.
      await this.view.compile();
      if (this.disposed) return;
      this.show('ready');
      this.last = performance.now();
      this.frame = requestAnimationFrame(this.tick);
    } catch (error) {
      if (this.disposed || signal.aborted) return;
      console.error(error);
      this.show('error');
    }
  }

  private readonly tick = (now: number): void => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.tick);
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    const view = this.view;
    if (!view) return;
    if (this.state === 'playing') {
      stepRun(this.run, dt);
      const events = this.run.events;
      view.update(this.run, dt, events);
      for (const event of events) {
        if (event.type === 'crash') this.flashLives();
        if (event.type === 'heart') {
          this.flashLives('is-gain');
          this.popText(t('sled.heart'), 'heart');
        }
        if (event.type === 'bail') this.popText(t('sled.bail'), 'bail');
        else if (event.type === 'land' && event.points > 0) {
          const value = String(Math.round(event.points));
          this.popText(event.tricks.length ? t('sled.tricks', { names: trickNames(event.tricks), points: value }) : t('sled.jump', { points: value }), event.tricks.length ? 'trick' : 'jump');
        }
        if (event.type === 'over') this.finish();
      }
    } else if (this.state !== 'paused') {
      // The rider still breathes on the chair while waiting; the world does not move.
      view.update(this.run, dt, []);
    }
    view.render();
    this.updateHud();
  };

  private resize(): void {
    const box = this.stage.getBoundingClientRect();
    this.view?.resize(Math.round(box.width), Math.round(box.height));
  }

  private start(): void {
    if (this.state !== 'ready' && this.state !== 'over') return;
    if (this.state === 'over') {
      this.run = newRun();
      this.view?.reset();
    }
    startRun(this.run);
    this.hooks.sounds?.play('beepGo');
    this.show('playing');
    this.root.focus({ preventScroll: true });
  }

  private pause(): void {
    if (this.state !== 'playing') return;
    this.view?.silence();
    this.show('paused');
  }

  private resume(): void {
    if (this.state !== 'paused') return;
    this.last = performance.now();
    this.show('playing');
    this.root.focus({ preventScroll: true });
  }

  private steer(direction: -1 | 1): void {
    if (this.state !== 'playing') return;
    if (steer(this.run, direction)) this.hooks.sounds?.play('whoosh', 0.25);
    this.hooks.host.dataset.mgLane = String(this.run.lane);
  }

  private trick(kind: TrickKind): void {
    if (this.state === 'playing' && trick(this.run, kind)) this.hooks.sounds?.play('whoosh', 0.7);
  }

  private finish(): void {
    this.view?.silence();
    const score = points(this.run);
    const { record, best } = saveSledScore(storage(), score);
    this.record = record;
    this.best.textContent = String(record.best);
    this.hooks.sounds?.play(best ? 'best' : 'beep');
    this.show('over', { score, best });
  }

  private key(event: KeyboardEvent, down: boolean): boolean {
    const code = event.code;
    const ours = LEFT_KEYS.has(code) || RIGHT_KEYS.has(code) || GO_KEYS.has(code) || code in TRICK_KEYS || code === 'KeyP';
    if (!down) return ours && this.state === 'playing';
    if (this.state === 'playing') {
      if (code === 'Escape' || code === 'KeyP') {
        this.pause();
        return true;
      }
      if (!event.repeat && LEFT_KEYS.has(code)) this.steer(-1);
      else if (!event.repeat && RIGHT_KEYS.has(code)) this.steer(1);
      else if (!event.repeat && code in TRICK_KEYS) this.trick(TRICK_KEYS[code]);
      return ours;
    }
    if (this.state === 'paused' && (GO_KEYS.has(code) || code === 'KeyP')) {
      if (!event.repeat) this.resume();
      return true;
    }
    if ((this.state === 'ready' || this.state === 'over') && GO_KEYS.has(code)) {
      if (!event.repeat) this.start();
      return true;
    }
    return false;
  }

  private pad(button: string): boolean {
    if (this.state === 'playing') {
      if (button === 'left' || button === 'down') this.steer(-1);
      else if (button === 'right' || button === 'up') this.steer(1);
      else if (button === 'cross') this.trick('spin');
      else if (button === 'triangle') this.trick('flip');
      else if (button === 'start' || button === 'circle') this.pause();
      return button !== 'square';
    }
    if (this.state === 'paused' && (button === 'cross' || button === 'start')) {
      this.resume();
      return true;
    }
    if ((this.state === 'ready' || this.state === 'over') && (button === 'cross' || button === 'start')) {
      this.start();
      return true;
    }
    return false;
  }

  private show(state: Screen, result?: { score: number; best: boolean }): void {
    this.state = state;
    this.root.dataset.state = state;
    this.hooks.host.dataset.minigame = state;
    this.hooks.host.dataset.mgLives = String(this.run.lives);
    this.hooks.host.dataset.mgLane = String(this.run.lane);
    const screen = this.screen;
    screen.hidden = state === 'playing';
    if (state === 'playing') {
      screen.replaceChildren();
      return;
    }
    const title = `<h3 data-i18n="games.sled"></h3>`;
    const button = (action: string, key: MessageKey) => `<button type="button" class="sled-button" data-action="${action}" data-i18n="${key}"></button>`;
    screen.innerHTML = {
      loading: `<div class="sled-card"><span class="sled-spinner" aria-hidden="true"></span><p data-i18n="sled.loading"></p></div>`,
      error: `<div class="sled-card"><p data-i18n="sled.error"></p></div>`,
      ready: `<div class="sled-card is-how">${title}${howToSheet(this.hooks.season)}${button('start', 'sled.start')}</div>`,
      paused: `<div class="sled-card"><h3 data-i18n="sled.paused"></h3>${button('resume', 'sled.resume')}<p class="sled-hint" data-i18n="sled.quitHint"></p></div>`,
      over: `<div class="sled-card"><h3 data-i18n="sled.over"></h3>
        <p class="sled-final"><strong>${result?.score ?? 0}</strong><span data-i18n="sled.score"></span></p>
        ${result?.best ? '<p class="sled-new" data-i18n="sled.newBest"></p>' : `<p class="sled-record"><span data-i18n="sled.best"></span> <strong>${this.record.best}</strong></p>`}
        ${button('start', 'sled.again')}</div>`,
    }[state];
    for (const node of screen.querySelectorAll<HTMLElement>('[data-i18n]')) node.textContent = t(node.dataset.i18n as MessageKey);
    screen.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  }

  /** The lives blink once: shaken when one is lost, swelling when one comes back. */
  private flashLives(kind: 'is-hit' | 'is-gain' = 'is-hit'): void {
    this.lives.classList.remove('is-hit', 'is-gain');
    void this.lives.offsetWidth;
    this.lives.classList.add(kind);
  }

  /** A short word over the slope (a landed jump's points, a life back) that rises and fades. */
  private popText(text: string, kind: 'jump' | 'trick' | 'bail' | 'heart'): void {
    this.pop.textContent = text;
    this.pop.dataset.kind = kind;
    this.pop.classList.remove('is-on');
    void this.pop.offsetWidth;
    this.pop.classList.add('is-on');
    // With reduced motion there is no animation to fade it: it just goes after a moment.
    window.clearTimeout(this.popTimer);
    this.popTimer = window.setTimeout(() => this.pop.classList.remove('is-on'), 1100);
  }

  private updateHud(): void {
    const run = this.run;
    const host = this.hooks.host;
    if (this.shown.lives !== run.lives) {
      this.shown.lives = run.lives;
      this.lives.querySelectorAll('li').forEach((life, i) => life.classList.toggle('is-lost', i >= run.lives));
      host.dataset.mgLives = String(run.lives);
    }
    const score = points(run);
    if (this.shown.score !== score) {
      this.shown.score = score;
      this.score.textContent = String(score);
      host.dataset.mgScore = String(score);
      host.dataset.mgJumps = String(run.jumps);
      host.dataset.mgTricks = String(run.tricks);
    }
    const multi = multiplier(run);
    if (this.shown.multi !== multi) {
      this.shown.multi = multi;
      this.multi.textContent = `×${multi % 1 ? multi.toFixed(1) : multi}`;
      this.multi.classList.toggle('is-up', multi > 1);
    }
    const nitro = Math.ceil((run.nitro / SLED.nitro.time) * 20) / 20;
    if (this.shown.nitro !== nitro) {
      this.shown.nitro = nitro;
      this.nitro.hidden = nitro <= 0;
      this.nitro.style.setProperty('--fill', String(nitro));
      host.dataset.mgNitro = nitro > 0 ? 'on' : 'off';
    }
  }

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    window.clearTimeout(this.popTimer);
    this.abort.abort();
    this.resizer.disconnect();
    this.view?.dispose();
    const host = this.hooks.host;
    host.dataset.minigame = 'none';
    for (const key of ['mgLives', 'mgScore', 'mgLane', 'mgNitro', 'mgJumps', 'mgTricks']) delete host.dataset[key];
  }
}
