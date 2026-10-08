import './chargeMeter.css';

/**
 * Bar over the character's head while J or K is held: it fills as the punch or kick charges and glows once
 * full. Like the seat bubble it lives in the page, placed each frame on the projected head point.
 */
export class ChargeMeter {
  private readonly element: HTMLDivElement;
  private readonly fill: HTMLDivElement;
  private readonly host: HTMLElement;
  private shown = false;
  private level = -1;

  constructor(host: HTMLElement) {
    this.host = host;
    this.element = document.createElement('div');
    this.element.className = 'charge-meter';
    this.element.setAttribute('aria-hidden', 'true');
    this.element.hidden = true;
    const track = document.createElement('div');
    track.className = 'charge-meter-track';
    this.fill = document.createElement('div');
    this.fill.className = 'charge-meter-fill';
    track.append(this.fill);
    this.element.append(track);
    host.append(this.element);
    host.dataset.charge = 'none';
  }

  /** Show it with `charge` 0…1 at `x`/`y` (CSS pixels in the host, the bottom middle of the bar), or hide it. */
  update(visible: boolean, charge = 0, x = 0, y = 0): void {
    if (visible) {
      this.element.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      const level = Math.round(Math.min(Math.max(charge, 0), 1) * 100);
      if (level !== this.level) {
        this.level = level;
        this.fill.style.transform = `scaleX(${level / 100})`;
        this.element.dataset.full = String(level >= 100);
        this.host.dataset.charge = (level / 100).toFixed(2);
      }
    }
    if (visible === this.shown) return;
    this.shown = visible;
    this.element.hidden = !visible;
    if (!visible) {
      this.level = -1;
      this.host.dataset.charge = 'none';
    }
  }

  dispose(): void {
    this.element.remove();
  }
}
