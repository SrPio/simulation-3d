import { t } from '../../core/i18n.ts';
import { DESKTOP_ICONS } from './Desktop.ts';
import type { AppHandle, DesktopApp } from './WindowManager.ts';

/** What Canela's program needs from the page. */
export type DogHooks = {
  /** Canela is with the character now. */
  present: () => boolean;
  /** What happens when the laptop is closed: she comes, she goes home, or nothing. */
  pending: () => 'invite' | 'dismiss' | undefined;
  /** Bring her (when the laptop closes), send her home, or take either back. */
  invite: () => void;
  dismiss: () => void;
  cancel: () => void;
  /** Shut the laptop down now (she comes, or goes home, as it closes). */
  shutdown: () => void;
  /** The keys to name: throwing and sit/follow, for the current input. */
  keys: () => { throw: string; sit: string };
  /** Her picture (under public/). */
  picture: string;
  click?: () => void;
};

/** «Canela»: asks whether to bring the beagle along (she comes when the laptop is closed), or sends her home. */
export function dogApp(hooks: DogHooks): DesktopApp {
  return {
    id: 'canela',
    title: 'apps.dog',
    icon: DESKTOP_ICONS.dog,
    size: { width: 440, height: 430 },
    render: (body): AppHandle => {
      body.classList.add('desk-note', 'desk-dog');
      const draw = () => {
        const pending = hooks.pending();
        const present = hooks.present();
        const text = pending === 'invite' ? t('dog.coming') : pending === 'dismiss' ? t('dog.leaving')
          : present ? t('dog.here', hooks.keys()) : t('dog.ask');
        // The first button is the main one: once she is asked for (or sent home), shutting down shows it happen.
        const buttons = pending === 'invite' ? [['shutdown', t('dog.showMe')], ['cancel', t('dog.cancel')]]
          : pending === 'dismiss' ? [['shutdown', t('dog.goodbye')], ['cancel', t('dog.stay')]]
            : present ? [['close', t('dog.close')], ['dismiss', t('dog.home')]] : [['invite', t('dog.yes')], ['close', t('dog.no')]];
        body.innerHTML = `
          <img class="desk-dog-picture" src="${hooks.picture}" alt="${t('dog.picture')}">
          <p>${text}</p>
          <div class="desk-dog-actions">${buttons.map(([action, label], i) =>
            `<button type="button" class="desk-dog-button${i === 0 ? ' is-main' : ''}" data-dog="${action}">${label}</button>`).join('')}</div>`;
        for (const button of body.querySelectorAll<HTMLButtonElement>('[data-dog]')) {
          button.addEventListener('click', () => {
            hooks.click?.();
            const action = button.dataset.dog;
            if (action === 'invite') hooks.invite();
            else if (action === 'dismiss') hooks.dismiss();
            else if (action === 'cancel') hooks.cancel();
            else if (action === 'shutdown') return hooks.shutdown();
            else if (action === 'close') body.closest('.desk-window')?.querySelector<HTMLButtonElement>('[data-action="close"]')?.click();
            draw();
            body.querySelector<HTMLButtonElement>('.desk-dog-button')?.focus();
          });
        }
      };
      draw();
      return { language: draw };
    },
  };
}
