import './seatBubble.css';
import { t } from '../core/i18n.ts';

/** Seconds the leave animation may take before the bubble is removed anyway (no animation with reduced motion). */
const LEAVE_FALLBACK = 260;

/**
 * Speech bubble over the character's head near the chair or the bed: the E key and "sit down". It lives in
 * the page, not in the 3D scene, so it always faces the screen, sharp at any camera angle or zoom. It pops
 * in when a seat is in reach and shrinks away when the character sits down or walks off.
 */
export class SeatBubble {
  private readonly element: HTMLDivElement;
  private readonly text: HTMLSpanElement;
  private readonly host: HTMLElement;
  private shown = false;
  private timer?: number;

  constructor(host: HTMLElement) {
    this.host = host;
    this.element = document.createElement('div');
    this.element.className = 'seat-bubble';
    this.element.setAttribute('aria-hidden', 'true');
    this.element.hidden = true;
    const body = document.createElement('div');
    body.className = 'seat-bubble-body';
    const key = document.createElement('span');
    key.className = 'seat-bubble-key';
    key.textContent = 'E';
    this.text = document.createElement('span');
    this.text.className = 'seat-bubble-text';
    body.append(key, this.text);
    this.element.append(body);
    this.element.addEventListener('animationend', this.onAnimationEnd);
    host.append(this.element);
    this.setLanguage();
    host.dataset.bubble = 'hidden';
  }

  setLanguage(): void {
    this.text.textContent = t('bubble.sit');
  }

  /** Show or hide it; `x`/`y` place the tip of its tail (CSS pixels in the host). */
  update(visible: boolean, x = 0, y = 0): void {
    if (visible) this.element.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    if (visible === this.shown) return;
    this.shown = visible;
    window.clearTimeout(this.timer);
    if (visible) {
      this.element.hidden = false;
      this.element.dataset.state = 'in';
    } else {
      this.element.dataset.state = 'out';
      this.timer = window.setTimeout(this.finishLeave, LEAVE_FALLBACK);
    }
    this.host.dataset.bubble = visible ? 'shown' : 'hidden';
  }

  private readonly onAnimationEnd = (): void => {
    if (!this.shown) this.finishLeave();
  };

  private readonly finishLeave = (): void => {
    window.clearTimeout(this.timer);
    if (!this.shown) this.element.hidden = true;
  };

  dispose(): void {
    window.clearTimeout(this.timer);
    this.element.removeEventListener('animationend', this.onAnimationEnd);
    this.element.remove();
  }
}
