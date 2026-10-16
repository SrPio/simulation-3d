import { CINE_SHOTS, type CineShot } from '../scene/CineCamera.ts';
import { onLanguage, t } from '../core/i18n.ts';
import type { CharacterViewer } from '../viewer/CharacterViewer';

/** How much of the page shows while recording: everything plus the key list, no page controls, or nothing but the world. */
const UI_STEPS = ['tools', 'clean', 'bare'] as const;

/**
 * Recording mode for promotional videos, only with `?cine` in the address: 1…9 and Q pick a camera shot round the
 * character, 0 goes back to the game view, C switches between cuts and glides, P locks the camera in place
 * (it only turns to follow the character) and H hides the interface step by step (`data-cine-ui` on the page:
 * tools → clean, without the page's buttons → bare, without the bubbles and the nitro gauge either).
 */
export function setupCineMode(parent: HTMLElement, viewer: () => CharacterViewer | undefined, signal: AbortSignal): void {
  const root = document.documentElement;
  const panel = document.createElement('aside');
  panel.className = 'cine-panel';
  panel.setAttribute('aria-live', 'polite');
  parent.append(panel);
  let shot: CineShot | 'game' = 'game';
  let cut = false;
  let frozen = false;
  let ui = 0;
  root.dataset.cineUi = UI_STEPS[ui];

  const row = (key: string, label: string, active = false) =>
    `<li${active ? ' class="is-active"' : ''}><kbd>${key}</kbd><span>${label}</span></li>`;
  const render = () => {
    panel.innerHTML = `<h2>${t('cine.title')}</h2><ul>${[
      ...CINE_SHOTS.map((id, index) => row(String(index + 1), t(`cine.${id}`), shot === id)),
      row('Q', t('cine.quarter'), shot === 'quarter'),
      row('0', t('cine.game'), shot === 'game'),
      row('C', t('cine.cut', { mode: t(cut ? 'cine.cutOn' : 'cine.cutOff') })),
      row('P', t('cine.freeze', { mode: t(frozen ? 'cine.on' : 'cine.off') }), frozen),
      row('H', t('cine.hide')),
    ].join('')}</ul>`;
  };
  render();
  const stopLanguage = onLanguage(render);
  signal.addEventListener('abort', () => {
    stopLanguage();
    panel.remove();
    delete root.dataset.cineUi;
  });

  // For the shot recording script (scripts/record_shots.ts): the viewer, to place the character and read where things are.
  (window as unknown as { cineViewer?: () => CharacterViewer | undefined }).cineViewer = viewer;

  window.addEventListener('keydown', (event) => {
    if (event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.target instanceof Element && event.target.closest('input, select, textarea')) return;
    const digit = /^(?:Digit|Numpad)(\d)$/.exec(event.code)?.[1];
    const current = viewer();
    if (digit !== undefined || event.code === 'KeyQ') {
      const next = event.code === 'KeyQ' ? 'quarter' : digit === '0' ? 'game' : CINE_SHOTS[Number(digit) - 1];
      if (!next || !current) return;
      shot = next;
      frozen = false;
      current.setCineShot(next);
    } else if (event.code === 'KeyC') {
      cut = current?.toggleCineCut() ?? cut;
    } else if (event.code === 'KeyP') {
      frozen = current?.toggleCineFreeze() ?? frozen;
    } else if (event.code === 'KeyH') {
      ui = (ui + 1) % UI_STEPS.length;
      root.dataset.cineUi = UI_STEPS[ui];
    } else {
      return;
    }
    render();
  }, { signal });
}
