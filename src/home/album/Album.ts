import './album.css';
import { getLanguage, t, type MessageKey } from '../../core/i18n.ts';
import { STAMPS, STAMP_SECTIONS, stampCount, type Stamp, type StampBook, type StampSection } from '../../core/stamps.ts';
import { ACTION_ICONS, HEAD_OUTLINE } from '../../ui/silhouettes.ts';
import type { AppHandle, DesktopApp } from '../desktop/WindowManager.ts';
import { PageFlip, type FlipMode } from './PageFlip.ts';
import { stampIcon } from './stampIcons.ts';

export type AlbumHooks = {
  stamps: StampBook;
  /** The page's viewer host: `data-album` (the faces showing) is kept on it for tests. */
  host: HTMLElement;
  reducedMotion: () => boolean;
  /** A page turning. */
  rustle?: () => void;
};

/** The album's faces in order: two per leaf, the cover first and the back cover last. */
const FACES = ['cover', 'contents', ...STAMP_SECTIONS, 'soon', 'inside', 'back'] as const;
type Face = (typeof FACES)[number];
/** A page's width over its height (a magazine). */
const PAGE_RATIO = 0.72;
/** Below this page width the album shows one page at a time. */
const SINGLE_BELOW = 230;
const STAGE_PADDING = 18;

const ICON = `<svg viewBox="0 0 64 64" aria-hidden="true"><path class="i-back" d="M12 8h38a4 4 0 0 1 4 4v42a4 4 0 0 1-4 4H12z"/><path class="i-spine" d="M8 8h8v50H8a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z"/><path class="i-stamp" d="M24 18h22v26H24z" stroke-dasharray="2.5 2.5"/><path class="i-mark" d="M35 24l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/></svg>`;
const ARROW = (d: string) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;

const head = (className = '') => `<svg class="${className}" viewBox="0 0 ${HEAD_OUTLINE.width} ${HEAD_OUTLINE.height}" aria-hidden="true"><path d="${HEAD_OUTLINE.d}"/></svg>`;

/** A sticker's picture: the head or one of the action figures, and its own small icon on a badge in the corner. */
function art(stamp: Stamp): string {
  const icon = stampIcon(stamp.id);
  if (stamp.art === 'head') return head('album-art') + icon;
  const d = ACTION_ICONS[stamp.art as keyof typeof ACTION_ICONS] ?? ACTION_ICONS.laptop;
  return `<svg class="album-art" viewBox="0 0 100 100" aria-hidden="true"><path fill-rule="evenodd" d="${d}"/></svg>${icon}`;
}

/** The album in a desktop window. */
export function albumApp(hooks: AlbumHooks): DesktopApp {
  return {
    id: 'album',
    title: 'apps.album',
    icon: ICON,
    size: { width: 940, height: 640 },
    render: (body) => new Album(body, hooks).handle,
  };
}

/**
 * The sticker album: a magazine whose pages turn like paper (PageFlip.ts). A cover with how many stickers are got, a
 * contents page whose lines open each section, one page per section with its slots (got stickers in colour with their
 * date, the rest as «?» waiting to be found), a page for what is coming and the back cover. Two pages side by side in
 * a wide window, one at a time in a narrow one.
 */
class Album {
  readonly handle: AppHandle;
  private readonly hooks: AlbumHooks;
  private readonly stage: HTMLDivElement;
  private readonly label: HTMLSpanElement;
  private readonly prevButton: HTMLButtonElement;
  private readonly nextButton: HTMLButtonElement;
  private readonly flip: PageFlip;
  private readonly resizer: ResizeObserver;
  private readonly stopListening: () => void;
  private readonly abort = new AbortController();

  constructor(body: HTMLElement, hooks: AlbumHooks) {
    this.hooks = hooks;
    body.classList.add('album-body');
    body.innerHTML = `
      <div class="album" data-owns-keys tabindex="0" data-i18n-label="album.title">
        <div class="album-stage"></div>
        <nav class="album-nav">
          <button type="button" class="album-turn" data-turn="-1" data-i18n-label="album.prev">${ARROW('M15 5l-7 7 7 7')}</button>
          <span class="album-where" aria-live="polite"></span>
          <button type="button" class="album-turn" data-turn="1" data-i18n-label="album.next">${ARROW('M9 5l7 7-7 7')}</button>
        </nav>
      </div>`;
    this.stage = body.querySelector('.album-stage')!;
    this.label = body.querySelector('.album-where')!;
    this.prevButton = body.querySelector('[data-turn="-1"]')!;
    this.nextButton = body.querySelector('[data-turn="1"]')!;
    this.flip = new PageFlip(this.stage, {
      faces: FACES.length,
      render: (face) => this.page(FACES[face], face),
      reducedMotion: hooks.reducedMotion,
      onChange: (shown) => this.changed(shown),
      onTurn: () => hooks.rustle?.(),
    });
    const signal = this.abort.signal;
    this.prevButton.addEventListener('click', () => this.flip.prev(), { signal });
    this.nextButton.addEventListener('click', () => this.flip.next(), { signal });
    // The contents page's lines go to their section.
    this.stage.addEventListener('click', (event) => {
      const go = (event.target as Element).closest<HTMLElement>('[data-go]')?.dataset.go;
      if (go !== undefined) this.flip.goToFace(Number(go));
    }, { signal });
    this.stopListening = hooks.stamps.onUnlock(() => this.flip.refresh());
    this.resizer = new ResizeObserver(() => this.layout());
    this.resizer.observe(this.stage);
    this.layout();
    this.handle = {
      dispose: () => this.dispose(),
      key: (event, down) => this.key(event, down),
      pad: (button) => this.pad(button),
      language: () => {
        this.flip.refresh();
        this.changed(this.flip.shown);
      },
    };
  }

  /** Pick one or two pages and their size from the room the window gives. */
  private layout(): void {
    const box = this.stage.getBoundingClientRect();
    const width = Math.max(0, box.width - STAGE_PADDING * 2);
    const height = Math.max(0, box.height - STAGE_PADDING * 2);
    if (width < 10 || height < 10) return;
    let mode: FlipMode = 'spread';
    let pageHeight = Math.min(height, width / 2 / PAGE_RATIO);
    if (pageHeight * PAGE_RATIO < SINGLE_BELOW || width < height * 0.95) {
      mode = 'single';
      pageHeight = Math.min(height, width / PAGE_RATIO);
    }
    this.flip.layout(mode, pageHeight * PAGE_RATIO, pageHeight);
  }

  /** After a turn: the page counter, the arrows, and `data-album`. */
  private changed(shown: number[]): void {
    const inside = shown.filter((face) => FACES[face] !== 'cover' && FACES[face] !== 'back');
    this.label.textContent = inside.length === 2 ? t('album.pages', { from: String(inside[0]), to: String(inside[1]) }) : shown.map((face) => this.faceName(face)).join(' · ');
    const first = shown[0] ?? 0;
    const last = shown[shown.length - 1] ?? 0;
    this.prevButton.disabled = first <= 0;
    this.nextButton.disabled = last >= FACES.length - 1;
    this.hooks.host.dataset.album = shown.join(',');
  }

  private faceName(face: number): string {
    const kind = FACES[face];
    if (kind === 'cover') return t('album.cover');
    if (kind === 'back') return t('album.backCover');
    return t('album.page', { n: String(face) });
  }

  private key(event: KeyboardEvent, down: boolean): boolean {
    const code = event.code;
    const ours = ['ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', 'KeyA', 'KeyD'].includes(code);
    if (!down || !ours) return ours;
    if (code === 'ArrowRight' || code === 'PageDown' || code === 'KeyD') this.flip.next();
    else if (code === 'ArrowLeft' || code === 'PageUp' || code === 'KeyA') this.flip.prev();
    else if (code === 'Home') this.flip.goToFace(0);
    else this.flip.goToFace(FACES.length - 1);
    return true;
  }

  private pad(button: string): boolean {
    if (button === 'right' || button === 'r1') this.flip.next();
    else if (button === 'left' || button === 'l1') this.flip.prev();
    else return false;
    return true;
  }

  /** One page face, freshly built in the current language with the current stickers. */
  private page(kind: Face, face: number): HTMLElement {
    const page = document.createElement('div');
    page.className = `album-page is-${kind}`;
    page.dataset.face = String(face);
    const state = this.hooks.stamps.state;
    const all = stampCount(state);
    const number = `<span class="album-number">${face}</span>`;
    if (kind === 'cover') {
      page.innerHTML = `
        <div class="album-masthead"><span>${t('album.edition')}</span><span>${t('album.issue')}</span></div>
        <h2 class="album-cover-title">${t('album.title')}</h2>
        <div class="album-cover-art">${head()}</div>
        <p class="album-cover-count"><strong>${all.got}</strong> / ${all.total}<small>${t('album.collected')}</small></p>
        <div class="album-barcode" aria-hidden="true"></div>`;
    } else if (kind === 'contents') {
      page.innerHTML = `
        <h3 class="album-heading">${t('album.contents')}</h3>
        <ol class="album-contents">${STAMP_SECTIONS.map((section) => {
          const at = FACES.indexOf(section);
          const count = stampCount(state, section);
          return `<li><button type="button" data-go="${at}"><span>${t(`album.section.${section}` as MessageKey)}</span><i></i><small>${count.got}/${count.total}</small><b>${at}</b></button></li>`;
        }).join('')}</ol>
        <p class="album-intro">${t('album.intro')}</p>${number}`;
    } else if (kind === 'world' || kind === 'games' || kind === 'secrets') {
      page.innerHTML = this.sectionPage(kind, face) + number;
    } else if (kind === 'soon') {
      page.innerHTML = `
        <h3 class="album-heading">${t('album.soonPage')}</h3>
        <p class="album-intro">${t('album.soonCopy')}</p>
        <div class="album-ghosts" aria-hidden="true">${'<span></span>'.repeat(4)}</div>${number}`;
    } else if (kind === 'inside') {
      page.innerHTML = `<p class="album-colophon">${t('album.colophon')}</p>${number}`;
    } else {
      page.innerHTML = `<div class="album-back-art">${head()}<span>DevOS</span></div><div class="album-barcode" aria-hidden="true"></div>`;
    }
    return page;
  }

  private sectionPage(section: StampSection, face: number): string {
    const state = this.hooks.stamps.state;
    const count = stampCount(state, section);
    const date = new Intl.DateTimeFormat(getLanguage() === 'es' ? 'es-CO' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' });
    const slots = STAMPS.filter((stamp) => stamp.section === section).map((stamp) => {
      const got = state[stamp.id];
      const name = t(`stamps.${stamp.id}.name` as MessageKey);
      if (!got) {
        // Locked: a «?» and the clue (vague for the secrets).
        const hint = t(`stamps.${stamp.id}.hint` as MessageKey);
        return `<li class="album-stamp is-locked" data-stamp="${stamp.id}"><span class="album-stamp-face"><span class="album-unknown">?</span></span><small>${hint}</small></li>`;
      }
      return `<li class="album-stamp is-got" data-stamp="${stamp.id}"><span class="album-stamp-face">${art(stamp)}</span><strong>${name}</strong><small>${t('album.got', { date: date.format(got) })}</small></li>`;
    }).join('');
    return `
      <header class="album-section">
        <span class="album-section-no">${String(STAMP_SECTIONS.indexOf(section) + 1).padStart(2, '0')}</span>
        <span><h3>${t(`album.section.${section}` as MessageKey)}</h3><small>${t(`album.sectionCopy.${section}` as MessageKey)}</small></span>
        <em>${count.got}/${count.total}</em>
      </header>
      <ul class="album-stamps" data-face="${face}">${slots}</ul>`;
  }

  private dispose(): void {
    this.abort.abort();
    this.resizer.disconnect();
    this.stopListening();
    this.flip.dispose();
    delete this.hooks.host.dataset.album;
  }
}
