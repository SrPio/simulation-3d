import { ACTION_ICONS } from '../../ui/silhouettes.ts';
import { DESKTOP_ICONS } from './Desktop.ts';
import type { DesktopApp } from './WindowManager.ts';
import { sledRunApp, type SledHooks } from '../../minigames/sledRun/SledRunApp.ts';
import { albumApp, type AlbumHooks } from '../album/Album.ts';

/** A minigame in the games folder; `app` opens its own window, missing while it is still being made. */
export type GameCard = { id: string; title: string; copy: string; art: string; app?: string };

export type AppHooks = {
  /** Open another program of the desktop (a game's window). */
  launch: (id: string) => void;
  /** What the chair downhill needs from the page. */
  sled: SledHooks;
  /** What the sticker album needs from the page. */
  album: AlbumHooks;
};

const silhouette = (d: string) => `<svg viewBox="0 0 100 100" aria-hidden="true"><path fill-rule="evenodd" d="${d}"/></svg>`;

/** The games folder's contents; `app` is the program each opens. */
export const GAMES: GameCard[] = [
  { id: 'sled', title: 'games.sled', copy: 'games.sledCopy', art: silhouette(ACTION_ICONS.nitro), app: 'sled' },
];

/** The desktop's own programs (the links to the signs are added by the desktop itself). */
export function desktopApps(hooks: AppHooks): DesktopApp[] {
  return [
    {
      id: 'games',
      title: 'apps.games',
      icon: DESKTOP_ICONS.games,
      size: { width: 620, height: 420 },
      render: (body) => {
        body.classList.add('desk-folder');
        body.innerHTML = `
          <nav class="desk-path" aria-hidden="true"><span>DevOS</span><span>›</span><span data-i18n="apps.games"></span></nav>
          <ul class="desk-games">
            ${GAMES.map((game) => `
              <li><button type="button" class="desk-game" data-game="${game.id}" ${game.app ? '' : 'aria-disabled="true"'}>
                <span class="desk-game-art">${game.art}</span>
                <span class="desk-game-text">${game.app ? '' : '<span class="desk-badge" data-i18n="games.soon"></span>'}<strong data-i18n="${game.title}"></strong><small data-i18n="${game.copy}"></small></span>
              </button></li>`).join('')}
            <li class="desk-game is-placeholder"><span class="desk-game-art">?</span><span class="desk-game-text"><strong data-i18n="games.more"></strong></span></li>
          </ul>`;
        for (const button of body.querySelectorAll<HTMLButtonElement>('[data-game]')) {
          button.addEventListener('click', () => {
            const game = GAMES.find((candidate) => candidate.id === button.dataset.game);
            if (game?.app) {
              hooks.launch(game.app);
              return;
            }
            // Not ready yet: a little shake (restarted on every press).
            button.classList.remove('is-nudged');
            void button.offsetWidth;
            button.classList.add('is-nudged');
          });
        }
      },
    },
    albumApp(hooks.album),
    {
      ...sledRunApp(hooks.sled),
      inFolder: true,
    },
    {
      id: 'trash',
      title: 'apps.trash',
      icon: DESKTOP_ICONS.trash,
      size: { width: 420, height: 280 },
      render: (body) => {
        body.classList.add('desk-note');
        body.innerHTML = `<span class="desk-note-art">${DESKTOP_ICONS.trash}</span><p data-i18n="trash.empty"></p>`;
      },
    },
  ];
}
