import { BOTTLE_UNITS, bottlePath, liquidLevel } from '../ui/bottle.ts';
import { NITRO } from '../world/chairDrive.ts';

/** What the gauge shows: spraying, too little left to light, filling back up, or full. */
export type GaugeState = 'boosting' | 'empty' | 'refilling' | 'full';

/** The gauge's look for the viewer's `data-nitro` and `data-fuel`. */
export function gaugeState(nitro: string | undefined, fuel: number): GaugeState {
  if (nitro === 'boosting') return 'boosting';
  if (fuel >= 0.995) return 'full';
  return nitro === 'empty' || fuel < NITRO.restart ? 'empty' : 'refilling';
}

/** Bubbles rising through the cola: x, size, delay (s). */
const BUBBLES = [[-6, 1.6, 0], [3, 1.2, 0.35], [-1, 1.9, 0.7], [7, 1.1, 1.05], [-8.5, 1.3, 1.4], [1.5, 1.5, 1.75]] as const;

/**
 * The nitro's gauge, bottom right while riding the office chair: the silhouette of the chair's soda bottle (the same
 * outline as the 3D one, see src/ui/bottle.ts) filled with cola up to the fuel left. It drains while the nitro sprays
 * (the bottle shakes and foams), bubbles up as it refills, dims and pulses below the level the nitro lights again at
 * and glows once when full. Reads `data-drive`, `data-nitro` and `data-fuel` from the viewer's host.
 */
export class NitroGauge {
  readonly root: HTMLDivElement;
  private readonly liquid: SVGGElement;
  private readonly clip: SVGRectElement;
  private readonly observer: MutationObserver;

  constructor(parent: HTMLElement, host: HTMLElement) {
    const path = bottlePath();
    const restart = liquidLevel(NITRO.restart);
    this.root = document.createElement('div');
    this.root.className = 'nitro-gauge';
    this.root.setAttribute('role', 'meter');
    this.root.setAttribute('aria-valuemin', '0');
    this.root.setAttribute('aria-valuemax', '100');
    this.root.dataset.i18nLabel = 'nitro.gauge';
    this.root.innerHTML = `
      <svg viewBox="-17 -3 34 ${BOTTLE_UNITS + 6}" aria-hidden="true">
        <defs>
          <clipPath id="nitro-bottle"><path d="${path}"/></clipPath>
          <clipPath id="nitro-cola"><rect x="-17" width="34" height="${BOTTLE_UNITS + 6}"/></clipPath>
          <linearGradient id="nitro-cola-fill" x1="0" x2="1">
            <stop offset="0" stop-color="#2a1208"/><stop offset="0.3" stop-color="#6e3a1a"/>
            <stop offset="0.55" stop-color="#532810"/><stop offset="1" stop-color="#220e06"/>
          </linearGradient>
        </defs>
        <path class="nitro-glass" d="${path}"/>
        <g clip-path="url(#nitro-bottle)">
          <g class="nitro-liquid">
            <path class="nitro-foam" d="${wave(-2.2)}"/>
            <path class="nitro-cola" d="${wave(0)}"/>
          </g>
          <g clip-path="url(#nitro-cola)">
            ${BUBBLES.map(([x, r, delay]) => `<circle class="nitro-bubble" cx="${x}" cy="${BOTTLE_UNITS - 3}" r="${r}" style="animation-delay:${delay}s"/>`).join('')}
          </g>
          <path class="nitro-shine" d="M-8.6 86 C-10.6 70 -10.4 58 -9.2 48"/>
        </g>
        <line class="nitro-mark" x1="10" x2="16" y1="${restart}" y2="${restart}"/>
        <path class="nitro-outline" d="${path}"/>
      </svg>`;
    this.liquid = this.root.querySelector('.nitro-liquid')!;
    this.clip = this.root.querySelector('#nitro-cola rect')!;
    parent.append(this.root);
    this.observer = new MutationObserver(() => this.sync(host));
    this.observer.observe(host, { attributes: true, attributeFilter: ['data-drive', 'data-nitro', 'data-fuel'] });
    this.sync(host);
  }

  private sync(host: HTMLElement): void {
    const { drive = 'none', nitro, fuel: text = '1' } = host.dataset;
    const fuel = Number.parseFloat(text);
    const level = liquidLevel(fuel);
    this.root.classList.toggle('is-shown', drive !== 'none');
    this.root.dataset.state = gaugeState(nitro, fuel);
    this.root.setAttribute('aria-valuenow', String(Math.round(fuel * 100)));
    // CSS px on an SVG element are its user units, so the surface eases between the viewer's 0.01 fuel steps.
    this.liquid.style.transform = `translateY(${level.toFixed(2)}px)`;
    this.clip.setAttribute('y', level.toFixed(2));
  }

  dispose(): void {
    this.observer.disconnect();
    this.root.remove();
  }
}

/** The cola: a gently waving surface at y = top (16 units a wave, wide enough to slide one wave along) and the body below. */
function wave(top: number): string {
  let d = `M-48 ${top}`;
  for (let x = -48; x < 32; x += 16) d += ` q4 -1.3 8 0 q4 1.3 8 0`;
  return `${d} V${BOTTLE_UNITS + 6} H-48 Z`;
}
