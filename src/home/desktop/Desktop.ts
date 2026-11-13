import githubLogo from '../../../assets/logos/github.svg?raw';
import { getLanguage, t, type MessageKey } from '../../core/i18n.ts';
import { HEAD_OUTLINE } from '../../ui/silhouettes.ts';
import { WindowManager, type DesktopApp } from './WindowManager.ts';
import { outlineCentre } from '../StartScreen.ts';

export type DesktopLink = { id: string; link: string; label: string };

export type DesktopOptions = {
  /** The outside signs' links, read when the desktop opens (they load with the world). */
  links: () => DesktopLink[];
  /** The desktop was shut down: the page resumes the world and closes the laptop. */
  onClose: () => void;
  /** A soft click for its buttons. */
  click?: () => void;
};

/** Seconds of the boot screen and of the screen switching off (match desktop.css). */
const BOOT_TIME = 0.9;
const OFF_TIME = 0.32;
type Direction = 'up' | 'down' | 'left' | 'right';

/**
 * The wallpaper's head: its box centred on the middle of the head's area, not of its outline's bounds (the cap's brim
 * reaches far to one side), with room round it so the stroke and its glow are never cut.
 */
const WALL_HEAD = (() => {
  const centre = outlineCentre(HEAD_OUTLINE.d);
  const pad = 3;
  const half = Math.max(centre.x, HEAD_OUTLINE.width - centre.x) + pad;
  return `<svg class="desk-wallpaper-head" viewBox="${(centre.x - half).toFixed(2)} ${-pad} ${(half * 2).toFixed(2)} ${HEAD_OUTLINE.height + pad * 2}" aria-hidden="true"><path d="${HEAD_OUTLINE.d}"/></svg>`;
})();

const head = (className: string) => `<svg class="${className}" viewBox="0 0 ${HEAD_OUTLINE.width} ${HEAD_OUTLINE.height}" aria-hidden="true"><path d="${HEAD_OUTLINE.d}"/></svg>`;

/** Desktop icons, drawn in a 64 × 64 box. */
const ICONS = {
  games: `<svg viewBox="0 0 64 64"><path class="i-back" d="M6 14a4 4 0 0 1 4-4h14l6 6h24a4 4 0 0 1 4 4v4H6z"/><path class="i-front" d="M6 22h52v28a4 4 0 0 1-4 4H10a4 4 0 0 1-4-4z"/><path class="i-mark" d="M22 32h20a7 7 0 0 1 0 14c-3 0-4-3-6-3h-8c-2 0-3 3-6 3a7 7 0 0 1 0-14zm-1 4v3h-3v2h3v3h2v-3h3v-2h-3v-3zm19 2a1.6 1.6 0 1 0 0 .1zm4 4a1.6 1.6 0 1 0 0 .1z"/></svg>`,
  album: `<svg viewBox="0 0 64 64"><path class="i-back" d="M12 8h38a4 4 0 0 1 4 4v42a4 4 0 0 1-4 4H12z"/><path class="i-spine" d="M8 8h8v50H8a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z"/><path class="i-stamp" d="M24 18h22v26H24z" stroke-dasharray="2.5 2.5"/><path class="i-mark" d="M35 24l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/></svg>`,
  portfolio: `<svg viewBox="0 0 64 64"><rect class="i-back" x="6" y="10" width="52" height="44" rx="5"/><path class="i-front" d="M6 20h52v29a5 5 0 0 1-5 5H11a5 5 0 0 1-5-5z"/><circle class="i-dot" cx="13" cy="15" r="2"/><circle class="i-dot" cx="20" cy="15" r="2"/><circle class="i-mark-line" cx="32" cy="37" r="11"/><path class="i-mark-line" d="M21 37h22M32 26c-5 6-5 16 0 22M32 26c5 6 5 16 0 22"/></svg>`,
  github: `<svg viewBox="0 0 64 64"><rect class="i-back" x="6" y="6" width="52" height="52" rx="14"/><g transform="translate(14 14) scale(1.5)" class="i-mark">${githubLogo.replace(/^<svg[^>]*>|<\/svg>\s*$/g, '')}</g></svg>`,
  linkedin: `<svg viewBox="0 0 64 64"><rect class="i-back" x="6" y="6" width="52" height="52" rx="10"/><path class="i-mark" d="M18 26h7v20h-7zm3.5-10a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM29 26h6.6v2.8c1-1.8 3.2-3.3 6.5-3.3 6.9 0 7.9 4.4 7.9 10V46h-7v-9c0-2.4-.1-5.2-3.2-5.2-3.2 0-3.7 2.4-3.7 5V46h-7z"/></svg>`,
  trash: `<svg viewBox="0 0 64 64"><path class="i-front" d="M15 18h34l-3 36a4 4 0 0 1-4 4H22a4 4 0 0 1-4-4z"/><path class="i-back" d="M10 13h44v6H10zM25 8h14v5H25z"/><path class="i-mark-line" d="M26 26v24M32 26v24M38 26v24"/></svg>`,
} as const;

const POWER = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v8"/><path d="M6.3 6.8a8 8 0 1 0 11.4 0"/></svg>`;

/**
 * The laptop's screen: «DevOS», a desktop of its own in the manner of the familiar ones (icons, windows, a taskbar with
 * a start button, a clock), shown over the whole page while the character works at the laptop. The world is paused
 * behind it. Keys, the gamepad and touches stay inside it; Escape closes the front window or, with none, shuts it down.
 */
export class Desktop {
  readonly root: HTMLDivElement;
  private readonly host: HTMLElement;
  private readonly options: DesktopOptions;
  private readonly windows: WindowManager;
  private readonly icons: HTMLUListElement;
  private readonly menu: HTMLDivElement;
  private readonly menuApps: HTMLUListElement;
  private readonly startButton: HTMLButtonElement;
  private readonly clock: HTMLTimeElement;
  private readonly abort = new AbortController();
  private state: 'closed' | 'booting' | 'open' | 'closing' = 'closed';
  private timer = 0;
  private clockTimer = 0;
  private apps: DesktopApp[] = [];
  private inerted: HTMLElement[] = [];
  private returnFocus?: HTMLElement;

  constructor(parent: HTMLElement, host: HTMLElement, options: DesktopOptions) {
    this.host = host;
    this.options = options;
    this.root = document.createElement('div');
    this.root.className = 'desktop';
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.dataset.i18nLabel = 'desktop.label';
    this.root.innerHTML = `
      <div class="desk-boot" aria-hidden="true">${head('desk-boot-head')}<span class="desk-boot-name">DevOS</span><span class="desk-boot-bar"><span></span></span></div>
      <div class="desk-screen">
        <div class="desk-wallpaper" aria-hidden="true">${WALL_HEAD}<span>DevOS</span></div>
        <ul class="desk-icons" data-i18n-label="desktop.icons"></ul>
        <div class="desk-windows"></div>
        <div class="desk-menu" id="desk-menu" hidden>
          <div class="desk-menu-user"><span class="desk-avatar">${head('')}</span><span><strong data-i18n="desktop.user"></strong><small data-i18n="desktop.role"></small></span></div>
          <p class="desk-menu-label" data-i18n="desktop.apps"></p>
          <ul class="desk-menu-apps"></ul>
          <button type="button" class="desk-power is-wide" data-power>${POWER}<span data-i18n="desktop.power"></span></button>
        </div>
        <footer class="desk-taskbar" data-i18n-label="desktop.taskbar">
          <button type="button" class="desk-start" aria-expanded="false" aria-controls="desk-menu" data-i18n-label="desktop.start">${head('')}</button>
          <div class="desk-tasks"></div>
          <time class="desk-clock"></time>
          <button type="button" class="desk-power" data-power data-i18n-label="desktop.powerHint">${POWER}</button>
        </footer>
      </div>`;
    parent.append(this.root);
    this.icons = this.root.querySelector('.desk-icons')!;
    this.menu = this.root.querySelector('.desk-menu')!;
    this.menuApps = this.root.querySelector('.desk-menu-apps')!;
    this.startButton = this.root.querySelector('.desk-start')!;
    this.clock = this.root.querySelector('.desk-clock')!;
    this.windows = new WindowManager(this.root.querySelector('.desk-windows')!, this.root.querySelector('.desk-tasks')!);
    this.windows.translate = (root) => this.translate(root);
    this.windows.onChange = (top) => { if (this.state !== 'closed') this.host.dataset.desktop = top ?? 'open'; };
    host.dataset.desktop = 'closed';

    const signal = this.abort.signal;
    this.startButton.addEventListener('click', () => this.setMenu(this.menu.hidden !== false), { signal });
    for (const power of this.root.querySelectorAll<HTMLButtonElement>('[data-power]')) power.addEventListener('click', () => this.close(), { signal });
    this.root.addEventListener('click', (event) => {
      if ((event.target as Element).closest('button')) this.options.click?.();
    }, { signal });
    this.root.addEventListener('pointerdown', (event) => {
      if (this.menu.hidden || this.menu.contains(event.target as Node) || this.startButton.contains(event.target as Node)) return;
      this.setMenu(false);
    }, { signal });
    // In the capture phase so nothing of the page (the character's keys, M, the menu's Escape) sees keys meanwhile.
    window.addEventListener('keydown', this.onKey, { capture: true, signal });
    window.addEventListener('keyup', this.onKeyUp, { capture: true, signal });
  }

  get isOpen(): boolean {
    return this.state !== 'closed';
  }

  /** Programs offered on the desktop (the games folder, the album, the links, the bin). */
  setApps(apps: DesktopApp[]): void {
    this.apps = apps;
  }

  open(): void {
    if (this.state !== 'closed') return;
    this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    this.renderIcons();
    this.root.hidden = false;
    this.translate(this.root);
    this.tick();
    this.clockTimer = window.setInterval(() => this.tick(), 10_000);
    // Everything else on the page is out of reach while the desktop is up.
    this.inerted = Array.from(this.root.parentElement!.children).filter((child): child is HTMLElement => child !== this.root && child instanceof HTMLElement && !child.inert);
    for (const element of this.inerted) element.inert = true;
    const reduced = document.documentElement.dataset.reducedMotion === 'true';
    this.state = 'booting';
    this.host.dataset.desktop = 'open';
    this.root.dataset.state = 'booting';
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.state = 'open';
      this.root.dataset.state = 'open';
      this.icons.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    }, reduced ? 0 : BOOT_TIME * 1000);
  }

  /** Shut down: windows close, the screen switches off, then the page gets the world back. */
  close(): void {
    if (this.state === 'closed' || this.state === 'closing') return;
    this.setMenu(false);
    this.state = 'closing';
    this.root.dataset.state = 'closing';
    window.clearTimeout(this.timer);
    const reduced = document.documentElement.dataset.reducedMotion === 'true';
    this.timer = window.setTimeout(() => {
      this.windows.closeAll();
      this.root.hidden = true;
      this.state = 'closed';
      this.host.dataset.desktop = 'closed';
      window.clearInterval(this.clockTimer);
      for (const element of this.inerted) element.inert = false;
      this.inerted = [];
      this.returnFocus?.focus({ preventScroll: true });
      this.options.onClose();
    }, reduced ? 0 : OFF_TIME * 1000);
  }

  /** Open one of the desktop's programs by id (the games folder opens a game this way too). */
  launch(id: string): void {
    const app = this.apps.find((candidate) => candidate.id === id);
    if (app) this.windows.open(app);
  }

  /** Close a window by id. */
  closeWindow(id: string): void {
    this.windows.close(id);
  }

  /** The gamepad while the desktop is up: the cross moves the focus, ✕ presses, ○ goes back, □ shuts down. */
  pad(button: string): boolean {
    if (this.state === 'closed') return false;
    if (this.state !== 'open') return true;
    if (this.menu.hidden && this.windows.topHandle()?.pad?.(button)) return true;
    if (button === 'up' || button === 'down' || button === 'left' || button === 'right') this.moveFocus(button);
    else if (button === 'cross') (document.activeElement instanceof HTMLElement && this.root.contains(document.activeElement) ? document.activeElement : undefined)?.click();
    else if (button === 'circle') this.back();
    else if (button === 'square') this.close();
    else if (button === 'start') this.setMenu(this.menu.hidden !== false);
    return true;
  }

  /** Language change: the clock's format follows it (the page refills the data-i18n texts). */
  setLanguage(): void {
    if (this.state === 'closed') return;
    this.tick();
    for (const handle of this.windows.handles()) handle.language?.();
  }

  dispose(): void {
    window.clearTimeout(this.timer);
    window.clearInterval(this.clockTimer);
    this.windows.closeAll();
    for (const element of this.inerted) element.inert = false;
    this.abort.abort();
    this.root.remove();
  }

  /** Escape: the start menu, then the front window, then the desktop itself. */
  private back(): void {
    if (!this.menu.hidden) {
      this.setMenu(false);
      this.startButton.focus();
    } else if (!this.windows.closeTop()) {
      this.close();
    } else if (!this.windows.count) {
      this.icons.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    }
  }

  private readonly onKey = (event: KeyboardEvent): void => {
    if (this.state === 'closed') return;
    event.stopPropagation();
    if (this.state !== 'open') {
      event.preventDefault();
      return;
    }
    const inside = event.target instanceof Element && this.root.contains(event.target);
    // The front program (a game) takes its own keys first.
    if (this.menu.hidden && !event.ctrlKey && !event.metaKey && !event.altKey && this.windows.topHandle()?.key?.(event, true)) {
      event.preventDefault();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!event.repeat) this.back();
    } else if (event.code === 'KeyL' && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey && !this.ownsKey(event)) {
      this.close();
    } else if (event.key === 'Meta' || (event.key === 'F1' && !inside)) {
      event.preventDefault();
      this.setMenu(this.menu.hidden !== false);
    } else if (event.key.startsWith('Arrow') && !this.ownsKey(event)) {
      event.preventDefault();
      this.moveFocus(event.key.slice(5).toLowerCase() as Direction);
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (this.state === 'closed') return;
    event.stopPropagation();
    if (this.windows.topHandle()?.key?.(event, false)) event.preventDefault();
  };

  /** Keys that a focused program handles itself (a game marks its area with data-owns-keys). */
  private ownsKey(event: KeyboardEvent): boolean {
    return event.target instanceof Element && !!event.target.closest('input, textarea, select, [contenteditable], [data-owns-keys]');
  }

  private setMenu(open: boolean): void {
    this.menu.hidden = !open;
    this.startButton.setAttribute('aria-expanded', String(open));
    if (open) this.menuApps.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  }

  private renderIcons(): void {
    const links = this.options.links();
    const linkApps: DesktopApp[] = links.map((link) => ({
      id: link.id,
      title: (`apps.${link.id}` as MessageKey),
      icon: ICONS[link.id as keyof typeof ICONS] ?? ICONS.portfolio,
      launch: () => openLink(link.link),
    }));
    const shown = this.apps.filter((app) => !app.inFolder);
    const all = [...shown.filter((app) => app.id !== 'trash'), ...linkApps, ...shown.filter((app) => app.id === 'trash')];
    this.icons.replaceChildren(...all.map((app) => this.iconButton(app, 'desk-icon')));
    this.menuApps.replaceChildren(...all.filter((app) => app.id !== 'trash').map((app) => this.iconButton(app, 'desk-menu-app')));
  }

  private iconButton(app: DesktopApp, className: string): HTMLLIElement {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.dataset.app = app.id;
    button.innerHTML = `<span class="desk-icon-art" aria-hidden="true">${app.icon}</span><span class="desk-icon-name" data-i18n="${app.title}"></span>`;
    button.addEventListener('click', () => {
      this.setMenu(false);
      this.windows.open(app);
    });
    // A double click is what a desktop expects; a single click (or a tap) already opens it, so the second is ignored.
    item.append(button);
    return item;
  }

  private translate(root: HTMLElement): void {
    for (const node of [root, ...root.querySelectorAll<HTMLElement>('[data-i18n], [data-i18n-label]')]) {
      if (node.dataset.i18n) node.textContent = t(node.dataset.i18n as MessageKey);
      if (node.dataset.i18nLabel) node.setAttribute('aria-label', t(node.dataset.i18nLabel as MessageKey));
    }
  }

  private tick(): void {
    const now = new Date();
    const language = getLanguage() === 'es' ? 'es-CO' : 'en-US';
    this.clock.dateTime = now.toISOString();
    this.clock.innerHTML = `<span>${now.toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' })}</span><small>${now.toLocaleDateString(language, { day: 'numeric', month: 'short' })}</small>`;
  }

  /** Move the focus to the nearest button in that direction, within the front window (or the desktop when none). */
  private moveFocus(direction: Direction): void {
    const scope = !this.menu.hidden ? this.menu : this.windows.topElement() ?? this.root.querySelector<HTMLElement>('.desk-screen')!;
    const candidates = Array.from(scope.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex="0"]')).filter((element) => element.offsetParent !== null && !element.closest('[hidden]'));
    // From the desktop the taskbar is reachable too.
    if (scope === this.windows.topElement()) candidates.push(...Array.from(this.root.querySelectorAll<HTMLElement>('.desk-taskbar button')));
    const current = document.activeElement instanceof HTMLElement && candidates.includes(document.activeElement) ? document.activeElement : undefined;
    if (!current) {
      candidates[0]?.focus({ preventScroll: true });
      return;
    }
    const from = centre(current);
    const [dx, dy] = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[direction];
    let best: HTMLElement | undefined;
    let bestScore = Infinity;
    for (const candidate of candidates) {
      if (candidate === current) continue;
      const to = centre(candidate);
      const along = (to.x - from.x) * dx + (to.y - from.y) * dy;
      if (along <= 4) continue;
      const across = Math.abs((to.x - from.x) * dy) + Math.abs((to.y - from.y) * dx);
      const score = along + across * 2.5;
      if (score < bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    best?.focus({ preventScroll: true });
  }
}

function centre(element: HTMLElement): { x: number; y: number } {
  const box = element.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

/** Open a link in a new tab the way a link click does (see CharacterViewer's openLink). */
function openLink(href: string): void {
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  anchor.click();
}

export { ICONS as DESKTOP_ICONS };
