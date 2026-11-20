import { t, type MessageKey } from '../../core/i18n.ts';
import { ACTION_ICONS, DOG_ICONS, type ActionIcon, type DogIcon } from '../../ui/silhouettes.ts';

/**
 * What can be done with Canela, as a sheet of illustrated tiles in her laptop program (in the manner of the chair
 * downhill's instructions): each tile has a drawing made of the character's and Canela's silhouettes, a title, one line
 * and the controls for it as keys, pad buttons or the touch button, whichever the page is used with
 * (`:root[data-touch]`, `:root[data-input='gamepad']`, `[data-gamepad='xbox']`). Inline SVG in the desktop theme's colours.
 */

/** A figure (100 × 100 box) placed in a drawing: `size` units wide, its top left at x, y, turned to face left by `flip`. */
function figure(d: string, x: number, y: number, size: number, className: string, flip = false): string {
  const scale = size / 100;
  const transform = flip ? `translate(${x + size} ${y}) scale(${-scale} ${scale})` : `translate(${x} ${y}) scale(${scale})`;
  return `<path class="${className}" fill-rule="evenodd" transform="${transform}" d="${d}"/>`;
}
const person = (icon: ActionIcon, x: number, y: number, size: number, extra = '', flip = false) =>
  figure(ACTION_ICONS[icon], x, y, size, `d-person${extra}`, flip);
const dog = (icon: DogIcon, x: number, y: number, size: number, extra = '', flip = false) =>
  figure(DOG_ICONS[icon], x, y, size, `d-dog${extra}`, flip);

const svg = (body: string) => `<svg class="dog-how-art" viewBox="0 0 96 64" aria-hidden="true">${body}</svg>`;
const ground = '<path class="d-ground" d="M4 59H92"/>';
const ball = (x: number, y: number, r = 3.2) =>
  `<circle class="d-ball" cx="${x}" cy="${y}" r="${r}"/><path class="d-seam" d="M${x - r * 0.55} ${y - r * 0.8}Q${x - r * 0.1} ${y} ${x - r * 0.55} ${y + r * 0.8}M${x + r * 0.55} ${y - r * 0.8}Q${x + r * 0.1} ${y} ${x + r * 0.55} ${y + r * 0.8}"/>`;

/** The character runs and Canela runs along behind, a few speed lines after her. */
const FOLLOW = svg(`${ground}
  ${person('run', 42, 4, 58)}
  ${dog('run', 6, 30, 34)}
  <path class="d-speed" d="M4 40H12M2 46H10M6 52H13"/>`);

/** The character throws; the ball flies along a dashed arc and Canela runs after it. */
const FETCH = svg(`${ground}
  ${person('throw', -6, 4, 58)}
  <path class="d-trail" d="M30 14C48 -2 72 4 86 50"/>
  ${ball(86, 54)}
  ${dog('run', 46, 32, 30)}`);

/** Canela walks back with the ball in her mouth to the character, who holds a hand out for it. */
const BRING = svg(`${ground}
  ${person('open', -4, 4, 58)}
  ${dog('carry', 50, 30, 34, '', true)}
  <path class="d-arrow" d="M88 24H70"/><path class="d-arrow" d="M74 20L70 24L74 28"/>`);

/** Sitting and staying, or up and following: the two poses with a two-way arrow between them. */
const STAY = svg(`${ground}
  ${dog('sit', 2, 22, 38)}
  <path class="d-arrow" d="M40 40H56"/><path class="d-arrow" d="M44 36L40 40L44 44M52 36L56 40L52 44"/>
  ${dog('walk', 56, 26, 38)}`);

/** On the bed beside the character with the laptop. */
const SEAT = svg(`
  <rect class="d-bed" x="4" y="42" width="88" height="12" rx="4"/>
  <path class="d-leg" d="M10 54V60M86 54V60"/>
  ${person('laptop', 2, -2, 54)}
  ${dog('sit', 54, 18, 30)}
  <path class="d-heart" d="M84 14C82 12 78 10 78 6.5C78 4.5 79.6 3.4 81 3.4C82.2 3.4 83.4 4.3 84 5.3C84.6 4.3 85.8 3.4 87 3.4C88.4 3.4 90 4.5 90 6.5C90 10 86 12 84 14Z"/>`);

/** Canela trotting home. */
const HOME = svg(`${ground}
  <path class="d-house" d="M58 30L76 14L94 30V59H58Z"/>
  <path class="d-roof" d="M54 32L76 12L98 32"/>
  <rect class="d-door" x="70" y="42" width="12" height="17" rx="5"/>
  ${dog('walk', 8, 28, 36)}
  <path class="d-trail" d="M44 52H56"/>`);

type Control = { keys?: string[]; pad?: [string, string][]; touch?: ActionIcon | 'dog'; label?: MessageKey };
type Tile = { art: string; title: MessageKey; text: MessageKey; controls: Control[] };

const kbd = (label: string) => `<kbd>${label}</kbd>`;

/** A round touch button with its silhouette, as the touch controls draw it. */
const touchButton = (icon: ActionIcon | 'dog') => `<span class="dog-touch-button"><svg viewBox="0 0 100 100" aria-hidden="true">
  <path fill-rule="evenodd" d="${icon === 'dog' ? DOG_ICONS.sit : ACTION_ICONS[icon]}"/></svg></span>`;

function control({ keys, pad, touch, label }: Control): string {
  const what = label ? `<span class="dog-how-what">${t(label)}</span>` : '';
  return `<span class="dog-how-control">
    ${keys ? `<span class="is-keys">${keys.map(kbd).join('')}</span>` : ''}
    ${pad ? `<span class="is-pad">${pad.map(([ps, xbox]) => `<kbd class="is-ps">${ps}</kbd><kbd class="is-xbox">${xbox}</kbd>`).join('')}</span>` : ''}
    ${touch ? `<span class="is-touch">${touchButton(touch)}</span>` : ''}
    ${what}</span>`;
}

/** The sheet of tiles: what Canela does and how to ask her. */
export function dogHowTo(): string {
  const tiles: Tile[] = [
    { art: FOLLOW, title: 'dog.how.follow', text: 'dog.how.followText', controls: [] },
    { art: FETCH, title: 'dog.how.fetch', text: 'dog.how.fetchText', controls: [{ keys: ['F'], pad: [['○', 'B']], touch: 'throw' }] },
    { art: BRING, title: 'dog.how.bring', text: 'dog.how.bringText', controls: [] },
    {
      art: STAY, title: 'dog.how.stay', text: 'dog.how.stayText',
      controls: [{ keys: ['G'], pad: [[t('dog.how.stick'), t('dog.how.stick')]], touch: 'dog' }],
    },
    { art: SEAT, title: 'dog.how.seat', text: 'dog.how.seatText', controls: [] },
    { art: HOME, title: 'dog.how.home', text: 'dog.how.homeText', controls: [] },
  ];
  return `<ol class="dog-how-sheet">${tiles.map((tile, i) => `
    <li class="dog-how-tile" style="--i: ${i}">
      ${tile.art}
      <strong>${t(tile.title)}</strong>
      <span class="dog-how-text">${t(tile.text)}</span>
      ${tile.controls.length ? `<span class="dog-how-controls">${tile.controls.map(control).join('')}</span>` : ''}
    </li>`).join('')}</ol>`;
}
