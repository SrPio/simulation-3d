import { t, type MessageKey } from '../../core/i18n.ts';
import { ACTION_ICONS } from '../../ui/silhouettes.ts';
import { bottlePath, BOTTLE_UNITS, type Vessel } from '../../ui/bottle.ts';
import type { Season } from './SledRunView.ts';

/**
 * The start screen's instructions as a sheet of illustrated tiles: each rule has a small drawing, a title, one line and
 * the controls for it as keys, touch gestures or pad buttons (shown by the page's input: `:root[data-touch]`,
 * `:root[data-input='gamepad']`, `[data-gamepad='xbox']`). Drawings are inline SVG in the desktop theme's colours.
 */

/** The nitro pickup drawn as this season's vessel. */
const VESSELS: Record<Season, Vessel> = { none: 'bottle', halloween: 'tube', christmas: 'thruster' };

/** A rider silhouette (from the touch buttons) placed in a drawing: `size` units wide with its top left at x, y. */
const rider = (x: number, y: number, size: number, className = 'h-fill') =>
  `<path class="${className}" fill-rule="evenodd" transform="translate(${x} ${y}) scale(${size / 100})" d="${ACTION_ICONS.nitro}"/>`;

const svg = (body: string) => `<svg class="sled-how-art" viewBox="0 0 96 64" aria-hidden="true">${body}</svg>`;

/** Three lanes seen from above, the rider sliding over to the next one. */
const LANES = svg(`
  <rect class="h-soft" x="8" y="2" width="80" height="60" rx="6"/>
  <path class="h-dash" d="M34.7 6V58M61.3 6V58"/>
  <path class="h-edge" d="M8 8V56M88 8V56"/>
  ${rider(8, 4, 28, 'h-fill h-faint')}
  ${rider(34, 4, 28)}
  <path class="h-arrow" d="M26 50C32 58 42 58 48 50"/><path class="h-arrow" d="M43.5 49.5L48 50L47.5 54.5"/>`);

/** A traffic cone and a striped works barrier. */
const DODGE = svg(`
  <path class="h-ground" d="M8 56H88"/>
  <path class="h-cone" d="M24 12L35 54H13Z"/>
  <path class="h-stripe" d="M20.4 26H27.6L29.4 33H18.6Z"/>
  <rect class="h-cone" x="9" y="52" width="30" height="5" rx="1.5"/>
  <rect class="h-line-fill" x="46" y="22" width="40" height="13" rx="2"/>
  <path class="h-stripe" d="M50 22L46 30V22ZM60 22L51 35H57L66 22ZM72 22L63 35H69L78 22ZM84 22L75 35H81L86 27.5V22Z"/>
  <path class="h-leg" d="M51 35V56M81 35V56"/>`);

/** The season's vessel glowing, with sparks and ×3: the soda bottle in cola with its red cap, the test tube, the thruster. */
function nitroArt(vessel: Vessel): string {
  const scale = 52 / BOTTLE_UNITS;
  return svg(`
  <circle class="h-glow" cx="34" cy="32" r="24"/>
  <path class="h-vessel is-${vessel}" transform="translate(34 6) scale(${scale})" d="${bottlePath(vessel)}"/>
  ${vessel === 'bottle' ? '<rect class="h-cap" x="31.3" y="3.6" width="5.4" height="4" rx="1"/>' : ''}
  <path class="h-spark" d="M58 12L60 17L65 19L60 21L58 26L56 21L51 19L56 17Z"/>
  <path class="h-spark h-small" d="M14 42L15.2 45L18 46L15.2 47L14 50L12.8 47L10 46L12.8 45Z"/>
  <text class="h-text" x="72" y="48" text-anchor="middle">×3</text>`);
}

/** A ramp throwing the rider over a cone along a dashed arc. */
const RAMP = svg(`
  <path class="h-ground" d="M4 56H92"/>
  <path class="h-ramp" d="M6 56L30 56L30 38Z"/>
  <path class="h-plank" d="M12 51.5L30 38M18 56L22 50M24 56L27 52"/>
  <path class="h-trail" d="M31 36C40 14 62 8 84 40"/>
  <path class="h-cone" d="M60 36L66 56H54Z"/><path class="h-stripe" d="M58 43H62L63 47H57Z"/>
  ${rider(44, -6, 28)}`);

/** The two tricks: round on its own axis (spin) and over backwards (flip). */
const TRICKS = svg(`
  <ellipse class="h-trail-solid" cx="24" cy="50" rx="21" ry="8"/>
  <path class="h-arrow" d="M40.5 44.5L45 50L39 53"/>
  ${rider(10, 14, 30)}
  <circle class="h-trail-solid" cx="72" cy="34" r="21"/>
  <path class="h-arrow" d="M51.5 30L51 35L55.5 32.5"/>
  <g transform="rotate(180 72 34)">${rider(58, 20, 28)}</g>`);

/** Three lives and a heart giving one back. */
const LIVES = svg(`
  ${rider(-4, 14, 28)}
  ${rider(16, 14, 28)}
  ${rider(36, 14, 28, 'h-fill h-faint')}
  <path class="h-heart" d="M78 52C74 48 64 42 64 33C64 28 68 25 71.5 25C74.5 25 76.8 27 78 29.5C79.2 27 81.5 25 84.5 25C88 25 92 28 92 33C92 42 82 48 78 52Z"/>
  <text class="h-text h-small-text" x="78" y="19" text-anchor="middle">+1</text>`);

type Control = { keys?: string[]; pad?: [string, string][]; touch?: MessageKey; label?: MessageKey };
type Tile = { art: string; title: MessageKey; text: MessageKey; controls: Control[] };

const kbd = (label: string) => `<kbd>${label}</kbd>`;

/** One control: its keys, pad buttons (PlayStation, Xbox) and touch gesture, each shown for its input, plus what it does. */
function control({ keys, pad, touch, label }: Control): string {
  const what = label ? `<span class="sled-how-what">${t(label)}</span>` : '';
  return `<span class="sled-how-control">
    ${keys ? `<span class="is-keys">${keys.map(kbd).join('')}</span>` : ''}
    ${pad ? `<span class="is-pad">${pad.map(([ps, xbox]) => `<kbd class="is-ps">${ps}</kbd><kbd class="is-xbox">${xbox}</kbd>`).join('')}</span>` : ''}
    ${touch ? `<span class="is-touch"><span class="sled-gesture">${t(touch)}</span></span>` : ''}
    ${what}</span>`;
}

/** The sheet of tiles for the start card. */
export function howToSheet(season: Season): string {
  const tiles: Tile[] = [
    { art: LANES, title: 'sled.how.lanes', text: 'sled.how.lanesText', controls: [{ keys: ['←', '→'], pad: [['◀', '◀'], ['▶', '▶']], touch: 'sled.how.swipe' }] },
    { art: DODGE, title: 'sled.how.dodge', text: 'sled.how.dodgeText', controls: [] },
    { art: nitroArt(VESSELS[season]), title: 'sled.how.nitro', text: 'sled.how.nitroText', controls: [] },
    { art: RAMP, title: 'sled.how.ramps', text: 'sled.how.rampsText', controls: [] },
    {
      art: TRICKS, title: 'sled.how.tricks', text: 'sled.how.tricksText', controls: [
        { keys: [t('sled.how.space')], pad: [['✕', 'A']], touch: 'sled.how.tap', label: 'sled.trick.spin' },
        { keys: ['X'], pad: [['△', 'Y']], touch: 'sled.how.swipeUp', label: 'sled.trick.flip' },
      ],
    },
    { art: LIVES, title: 'sled.how.lives', text: 'sled.how.livesText', controls: [] },
  ];
  return `<ol class="sled-how-sheet">${tiles.map((tile, i) => `
    <li class="sled-how-tile" style="--i: ${i}">
      ${tile.art}
      <strong>${t(tile.title)}</strong>
      <span class="sled-how-text">${t(tile.text)}</span>
      ${tile.controls.length ? `<span class="sled-how-controls">${tile.controls.map(control).join('')}</span>` : ''}
    </li>`).join('')}</ol>`;
}
