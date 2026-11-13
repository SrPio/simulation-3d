import { ACTION_ICONS, type ActionIcon } from '../ui/silhouettes.ts';

export type Toast = {
  /** Kept on the host as `data-toast` while it shows. */
  id: string;
  text: string;
  /** A touch-button silhouette beside the text; the laptop's by default. */
  icon?: ActionIcon;
  /** SVG markup drawn instead of the silhouette (a sticker). */
  art?: string;
  /** Seconds on screen. */
  duration?: number;
};

const DEFAULT_DURATION = 6;
/** Seconds the leaving animation takes (matches toasts.css). */
const LEAVE_TIME = 0.28;

/**
 * Short friendly messages at the top of the page, one at a time: the next waits until the current one leaves. Each
 * carries an action silhouette (the same figures as the touch buttons). Closable; read out politely by screen readers.
 */
export class Toasts {
  private readonly root: HTMLDivElement;
  private readonly host: HTMLElement;
  private readonly queue: Toast[] = [];
  private current?: { toast: Toast; element: HTMLDivElement; timer: number };
  private disposed = false;

  constructor(parent: HTMLElement, host: HTMLElement) {
    this.host = host;
    this.root = document.createElement('div');
    this.root.className = 'toasts';
    this.root.setAttribute('role', 'status');
    this.root.setAttribute('aria-live', 'polite');
    parent.append(this.root);
    host.dataset.toast = 'none';
  }

  show(toast: Toast): void {
    if (this.disposed) return;
    if (this.current?.toast.id === toast.id || this.queue.some((queued) => queued.id === toast.id)) return;
    this.queue.push(toast);
    if (!this.current) this.next();
  }

  /** Close the toast on screen now (and everything waiting when `all`). */
  dismiss(all = false): void {
    if (all) this.queue.length = 0;
    if (this.current) this.leave();
  }

  private next(): void {
    const toast = this.queue.shift();
    if (!toast || this.disposed) return;
    const element = document.createElement('div');
    element.className = 'toast';
    element.innerHTML = `<span class="toast-icon" aria-hidden="true">${toast.art ?? `<svg viewBox="0 0 100 100"><path fill-rule="evenodd" d="${ACTION_ICONS[toast.icon ?? 'laptop']}"></path></svg>`}</span><p class="toast-text"></p><button type="button" class="toast-close" aria-label="×">×</button>`;
    element.querySelector('.toast-text')!.textContent = toast.text;
    element.querySelector('button')!.addEventListener('click', () => this.leave());
    this.root.append(element);
    this.host.dataset.toast = toast.id;
    const timer = window.setTimeout(() => this.leave(), (toast.duration ?? DEFAULT_DURATION) * 1000);
    this.current = { toast, element, timer };
  }

  private leave(): void {
    const current = this.current;
    if (!current) return;
    this.current = undefined;
    window.clearTimeout(current.timer);
    current.element.classList.add('is-leaving');
    this.host.dataset.toast = 'none';
    const reduced = document.documentElement.dataset.reducedMotion === 'true';
    window.setTimeout(() => {
      current.element.remove();
      this.next();
    }, reduced ? 0 : LEAVE_TIME * 1000);
  }

  dispose(): void {
    this.disposed = true;
    if (this.current) window.clearTimeout(this.current.timer);
    this.queue.length = 0;
    this.root.remove();
  }
}
