import type { MessageKey } from '../../core/i18n.ts';

/**
 * What a running program hands back from `render`: what to undo on close, and (for a game) the keys and gamepad
 * buttons it takes while its window is in front (true = used; the desktop leaves it alone), and word of being in front.
 */
export type AppHandle = {
  dispose?: () => void;
  key?: (event: KeyboardEvent, down: boolean) => boolean;
  pad?: (button: string) => boolean;
  front?: (front: boolean) => void;
  /** The page's language changed: texts drawn without data-i18n are redrawn. */
  language?: () => void;
};

/** One program of the laptop's desktop. `render` fills the window's body and may return what to undo on close. */
export type DesktopApp = {
  id: string;
  title: MessageKey;
  /** SVG markup for the icon (desktop, taskbar, start menu, title bar). */
  icon: string;
  /** Preferred size in px; small screens always get the window maximised. */
  size?: { width: number; height: number };
  render?: (body: HTMLElement) => (() => void) | AppHandle | void;
  /** Opened from a folder (a game), not shown on the desktop or in the start menu. */
  inFolder?: boolean;
  /** Runs instead of opening a window (a link shortcut). */
  launch?: () => void;
};

type OpenWindow = { app: DesktopApp; element: HTMLElement; task: HTMLButtonElement; handle: AppHandle };

/** Below this width every window fills the screen above the taskbar and cannot be dragged. */
const NARROW = 720;
/** Each new window opens this much lower and further right than the previous one (px). */
const CASCADE = 28;

/**
 * Windows on the desktop: open (or bring forward), focus, maximise, close, drag by the title bar. Titles carry
 * data-i18n so the page's language switch renames them.
 */
export class WindowManager {
  private readonly windows = new Map<string, OpenWindow>();
  private readonly layer: HTMLElement;
  private readonly tasks: HTMLElement;
  private order: string[] = [];
  private opened = 0;
  private drag?: { id: string; pointer: number; dx: number; dy: number };
  /** Called whenever a window opens, closes or comes forward (the desktop keeps `data-desktop` up to date). */
  onChange?: (top: string | undefined) => void;
  /** Fills the data-i18n texts of new elements (the page fills them again on a language change). */
  translate?: (root: HTMLElement) => void;

  constructor(layer: HTMLElement, tasks: HTMLElement) {
    this.layer = layer;
    this.tasks = tasks;
  }

  get top(): string | undefined {
    return this.order[this.order.length - 1];
  }

  get count(): number {
    return this.windows.size;
  }

  /** Every open program, for the language switch. */
  handles(): AppHandle[] {
    return [...this.windows.values()].map((window) => window.handle);
  }

  /** What the front window's program takes (keys, gamepad), if anything. */
  topHandle(): AppHandle | undefined {
    const top = this.top;
    return top ? this.windows.get(top)?.handle : undefined;
  }

  /** The front window's element, for keyboard focus and the gamepad. */
  topElement(): HTMLElement | undefined {
    const top = this.top;
    return top ? this.windows.get(top)?.element : undefined;
  }

  open(app: DesktopApp): void {
    if (app.launch) {
      app.launch();
      return;
    }
    const existing = this.windows.get(app.id);
    if (existing) {
      this.focus(app.id);
      return;
    }
    const element = document.createElement('section');
    element.className = 'desk-window';
    element.dataset.app = app.id;
    element.setAttribute('role', 'dialog');
    element.setAttribute('aria-labelledby', `desk-title-${app.id}`);
    element.innerHTML = `
      <header class="desk-titlebar">
        <span class="desk-title-icon" aria-hidden="true">${app.icon}</span>
        <h2 class="desk-title" id="desk-title-${app.id}" data-i18n="${app.title}"></h2>
        <button type="button" class="desk-window-button" data-action="maximize" data-i18n-label="desktop.maximize"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="3" width="10" height="10" rx="1.5"/></svg></button>
        <button type="button" class="desk-window-button is-close" data-action="close" data-i18n-label="desktop.close"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg></button>
      </header>
      <div class="desk-window-body"></div>`;
    const size = app.size ?? { width: 560, height: 400 };
    const area = this.layer.getBoundingClientRect();
    const width = Math.min(size.width, area.width - 24);
    const height = Math.min(size.height, area.height - 24);
    const shift = (this.opened++ % 5) * CASCADE;
    element.style.width = `${width}px`;
    element.style.height = `${height}px`;
    element.style.left = `${Math.max(12, (area.width - width) / 2 - 2 * CASCADE + shift)}px`;
    element.style.top = `${Math.max(12, (area.height - height) / 2 - 2 * CASCADE + shift)}px`;
    if (area.width < NARROW) element.classList.add('is-maximized');
    const titlebar = element.querySelector<HTMLElement>('.desk-titlebar')!;
    element.addEventListener('pointerdown', () => this.focus(app.id));
    element.querySelector<HTMLButtonElement>('[data-action="close"]')!.addEventListener('click', () => this.close(app.id));
    element.querySelector<HTMLButtonElement>('[data-action="maximize"]')!.addEventListener('click', () => element.classList.toggle('is-maximized'));
    titlebar.addEventListener('dblclick', (event) => {
      if (!(event.target as Element).closest('button')) element.classList.toggle('is-maximized');
    });
    titlebar.addEventListener('pointerdown', (event) => this.startDrag(event, app.id, element));
    titlebar.addEventListener('pointermove', (event) => this.moveDrag(event, element));
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) titlebar.addEventListener(type, () => { this.drag = undefined; });

    const task = document.createElement('button');
    task.type = 'button';
    task.className = 'desk-task';
    task.dataset.app = app.id;
    task.innerHTML = `<span aria-hidden="true">${app.icon}</span><span data-i18n="${app.title}"></span>`;
    task.addEventListener('click', () => this.focus(app.id));
    this.tasks.append(task);

    this.layer.append(element);
    const made = app.render?.(element.querySelector<HTMLElement>('.desk-window-body')!) ?? undefined;
    const handle: AppHandle = typeof made === 'function' ? { dispose: made } : made ?? {};
    this.translate?.(element);
    this.translate?.(task);
    this.windows.set(app.id, { app, element, task, handle });
    this.focus(app.id);
  }

  focus(id: string): void {
    const window = this.windows.get(id);
    if (!window) return;
    this.order = [...this.order.filter((other) => other !== id), id];
    this.order.forEach((other, index) => {
      const open = this.windows.get(other)!;
      open.element.style.zIndex = String(index + 1);
      open.element.classList.toggle('is-active', other === id);
      open.task.setAttribute('aria-pressed', String(other === id));
      open.handle.front?.(other === id);
    });
    if (!window.element.contains(document.activeElement)) {
      const first = window.element.querySelector<HTMLElement>('.desk-window-body button:not([disabled]), .desk-window-body [tabindex]') ?? window.element.querySelector<HTMLElement>('[data-action="close"]');
      first?.focus({ preventScroll: true });
    }
    this.onChange?.(this.top);
  }

  close(id: string): void {
    const window = this.windows.get(id);
    if (!window) return;
    window.handle.dispose?.();
    window.element.remove();
    window.task.remove();
    this.windows.delete(id);
    this.order = this.order.filter((other) => other !== id);
    const top = this.top;
    if (top) this.focus(top);
    else this.onChange?.(undefined);
  }

  /** Close the front window; false when none is open. */
  closeTop(): boolean {
    const top = this.top;
    if (!top) return false;
    this.close(top);
    return true;
  }

  closeAll(): void {
    for (const id of [...this.windows.keys()]) this.close(id);
    this.opened = 0;
  }

  private startDrag(event: PointerEvent, id: string, element: HTMLElement): void {
    if ((event.target as Element).closest('button') || element.classList.contains('is-maximized') || event.pointerType === 'touch') return;
    const box = element.getBoundingClientRect();
    this.drag = { id, pointer: event.pointerId, dx: event.clientX - box.left, dy: event.clientY - box.top };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  private moveDrag(event: PointerEvent, element: HTMLElement): void {
    if (!this.drag || this.drag.pointer !== event.pointerId) return;
    const area = this.layer.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    // Keep the title bar on screen.
    const left = Math.min(Math.max(event.clientX - area.left - this.drag.dx, 80 - box.width), area.width - 80);
    const top = Math.min(Math.max(event.clientY - area.top - this.drag.dy, 0), area.height - 40);
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
  }
}
