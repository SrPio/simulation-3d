import './album.css';
import { getLanguage, t, type MessageKey } from '../../core/i18n.ts';
import { STAMPS, STAMP_SECTIONS, stampCount, type Stamp, type StampBook, type StampSection } from '../../core/stamps.ts';
import { PINS, albumPins, type PinBook, type PinPlace } from '../../core/pins.ts';
import type { Season } from '../../core/christmas.ts';
import { ACTION_ICONS, HEAD_OUTLINE } from '../../ui/silhouettes.ts';
import type { AppHandle, DesktopApp } from '../desktop/WindowManager.ts';
import { PageFlip, type FlipMode } from './PageFlip.ts';
import { stampIcon } from './stampIcons.ts';

export type AlbumHooks = {
  stamps: StampBook;
  /** The season pins got, and where they are stuck on the cover. */
  pins: PinBook;
  /** The season on now (which pins can still be found, shown as empty slots). */
  season: Season;
  /** A pin stuck on the cover. */
  stick?: () => void;
  /** The page's viewer host: `data-album` (the faces showing) is kept on it for tests. */
  host: HTMLElement;
  reducedMotion: () => boolean;
  /** A page turning. */
  rustle?: () => void;
};

/** The album's faces in order: two per leaf, the cover first and the back cover last. */
const FACES = ['cover', 'contents', ...STAMP_SECTIONS, 'pins', 'inside', 'back'] as const;
type Face = (typeof FACES)[number];
/** A page's width over its height (a magazine). */
const PAGE_RATIO = 0.72;
/** Below this page width the album shows one page at a time. */
const SINGLE_BELOW = 230;
const STAGE_PADDING = 18;
/** A pin on the cover: its width as a fraction of the cover's; its middle is kept this far inside the cover's edges. */
const COVER_PIN = { width: 0.26, margin: 0.06 };
/** Movement (px) before a press on a pin becomes a drag. */
const PIN_DRAG = 5;
/** Where pins put on the cover without dragging go, one after another round the head (fractions of the cover). */
const COVER_SPOTS = [[0.2, 0.62], [0.8, 0.6], [0.24, 0.3], [0.78, 0.32], [0.5, 0.8], [0.5, 0.45]] as const;

const pinImage = (image: string) => `${import.meta.env.BASE_URL}${image}`;

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
  private readonly tray: HTMLDivElement;
  private readonly stopPins: () => void;
  private drag?: { id: string; from: 'tray' | 'cover'; pointer: number; x: number; y: number; moved: boolean; source: HTMLElement; ghost?: HTMLImageElement; turn: number };
  private onCover = false;

  constructor(body: HTMLElement, hooks: AlbumHooks) {
    this.hooks = hooks;
    body.classList.add('album-body');
    body.innerHTML = `
      <div class="album" data-owns-keys tabindex="0" data-i18n-label="album.title">
        <div class="album-stage"></div>
        <div class="album-tray" hidden><p class="album-tray-title"></p><div class="album-tray-pins"></div><small class="album-tray-hint"></small></div>
        <nav class="album-nav">
          <button type="button" class="album-turn" data-turn="-1" data-i18n-label="album.prev">${ARROW('M15 5l-7 7 7 7')}</button>
          <span class="album-where" aria-live="polite"></span>
          <button type="button" class="album-turn" data-turn="1" data-i18n-label="album.next">${ARROW('M9 5l7 7-7 7')}</button>
        </nav>
      </div>`;
    this.stage = body.querySelector('.album-stage')!;
    this.label = body.querySelector('.album-where')!;
    this.tray = body.querySelector('.album-tray')!;
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
    this.stopPins = hooks.pins.onChange(() => {
      this.flip.refresh();
      this.fillTray();
    });
    const album = body.querySelector<HTMLElement>('.album')!;
    // Pins are dragged from the tray onto the cover, moved about on it, or dragged off it; caught before the book sees
    // the press, so no page turns.
    album.addEventListener('pointerdown', (event) => this.pinDown(event), { signal, capture: true });
    window.addEventListener('pointermove', (event) => this.pinMove(event), { signal });
    window.addEventListener('pointerup', (event) => this.pinUp(event), { signal });
    window.addEventListener('pointercancel', (event) => this.pinUp(event, true), { signal });
    // Without a pointer (Enter or Space on a focused pin): a tray pin goes on the cover, a cover pin comes off.
    album.addEventListener('click', (event) => {
      const button = (event.target as Element).closest<HTMLElement>('[data-pin]');
      if (!button || event.detail !== 0) return;
      this.toggle(button.dataset.pin!, button.dataset.from === 'cover');
    }, { signal });
    album.addEventListener('keydown', (event) => {
      const button = (event.target as Element).closest<HTMLElement>('[data-from="cover"]');
      if (!button || (event.key !== 'Delete' && event.key !== 'Backspace')) return;
      event.preventDefault();
      this.toggle(button.dataset.pin!, true);
    }, { signal });
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
    (this.stage.parentElement as HTMLElement).dataset.mode = mode;
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
    this.onCover = shown.length === 1 && shown[0] === 0;
    this.fillTray();
  }

  /** The tray beside the closed book: the pins got and not on the cover yet. Only while the cover shows. */
  private fillTray(): void {
    const { got, cover } = this.hooks.pins.state;
    const owned = PINS.filter((pin) => got[pin.id]);
    this.tray.hidden = !this.onCover || owned.length === 0;
    this.hooks.host.dataset.albumCover = Object.keys(cover).join(',') || 'none';
    if (this.tray.hidden) return;
    const loose = owned.filter((pin) => !cover[pin.id]);
    this.tray.querySelector('.album-tray-title')!.textContent = t('album.tray');
    this.tray.querySelector('.album-tray-hint')!.textContent = t(loose.length ? 'album.trayHint' : 'album.trayEmpty');
    this.tray.querySelector('.album-tray-pins')!.innerHTML = loose.map((pin) => {
      const name = t(`pins.${pin.id}.name` as MessageKey);
      return `<button type="button" class="album-tray-pin" data-pin="${pin.id}" data-from="tray" aria-label="${name}" title="${name}"><img src="${pinImage(pin.image)}" alt="" draggable="false"></button>`;
    }).join('');
  }

  /** Put a pin on the cover at the next free-looking spot, or take it off. */
  private toggle(id: string, off: boolean): void {
    if (off) {
      this.hooks.pins.place(id, undefined);
      return;
    }
    const placed = Object.keys(this.hooks.pins.state.cover).length;
    const [x, y] = COVER_SPOTS[placed % COVER_SPOTS.length];
    this.hooks.pins.place(id, { x, y, turn: placed % 2 ? 8 : -8 });
    this.hooks.stick?.();
  }

  /** The cover lying flat, if it shows. */
  private coverPage(): HTMLElement | null {
    return this.stage.querySelector<HTMLElement>('.album-sheet:not(.is-empty) .album-slot > .album-page.is-cover');
  }

  private pinDown(event: PointerEvent): void {
    const source = (event.target as Element).closest<HTMLElement>('[data-pin]');
    if (!source || event.button > 0 || this.flip.turning) return;
    event.stopPropagation();
    event.preventDefault();
    const id = source.dataset.pin!;
    const turn = this.hooks.pins.state.cover[id]?.turn ?? Math.round((Math.random() * 2 - 1) * 12);
    this.drag = { id, from: source.dataset.from === 'cover' ? 'cover' : 'tray', pointer: event.pointerId, x: event.clientX, y: event.clientY, moved: false, source, turn };
  }

  private pinMove(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || drag.pointer !== event.pointerId) return;
    if (!drag.moved) {
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < PIN_DRAG) return;
      drag.moved = true;
      const pin = PINS.find((item) => item.id === drag.id);
      if (!pin) return;
      // The pin in the hand is as large as it will be on the cover.
      const cover = this.coverPage()?.getBoundingClientRect();
      const ghost = document.createElement('img');
      ghost.className = 'album-pin-ghost';
      ghost.src = pinImage(pin.image);
      ghost.alt = '';
      ghost.style.width = `${cover ? cover.width * COVER_PIN.width : drag.source.getBoundingClientRect().width}px`;
      ghost.style.setProperty('--turn', `${drag.turn}deg`);
      document.body.append(ghost);
      drag.ghost = ghost;
      drag.source.classList.add('is-lifted');
    }
    if (drag.ghost) {
      drag.ghost.style.left = `${event.clientX}px`;
      drag.ghost.style.top = `${event.clientY}px`;
      this.coverPage()?.classList.toggle('is-target', this.overCover(event) !== undefined);
    }
  }

  /** Where the pointer is on the cover (fractions, kept inside its margin), or undefined off it. */
  private overCover(event: PointerEvent): { x: number; y: number } | undefined {
    const cover = this.coverPage()?.getBoundingClientRect();
    if (!cover) return undefined;
    const x = (event.clientX - cover.left) / cover.width;
    const y = (event.clientY - cover.top) / cover.height;
    if (x < 0 || y < 0 || x > 1 || y > 1) return undefined;
    const m = COVER_PIN.margin;
    return { x: Math.min(1 - m, Math.max(m, x)), y: Math.min(1 - m, Math.max(m, y)) };
  }

  private pinUp(event: PointerEvent, cancel = false): void {
    const drag = this.drag;
    if (!drag || drag.pointer !== event.pointerId) return;
    this.drag = undefined;
    drag.ghost?.remove();
    drag.source.classList.remove('is-lifted');
    this.coverPage()?.classList.remove('is-target');
    if (cancel) return;
    if (!drag.moved) {
      // A tap on a tray pin puts it on the cover; one on the cover leaves it where it is.
      if (drag.from === 'tray') this.toggle(drag.id, false);
      return;
    }
    const at = this.overCover(event);
    if (at) {
      const place: PinPlace = { ...at, turn: drag.turn };
      this.hooks.pins.place(drag.id, place);
      this.hooks.stick?.();
    } else if (drag.from === 'cover') {
      this.hooks.pins.place(drag.id, undefined);
    }
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
        <div class="album-barcode" aria-hidden="true"></div>${this.coverPins()}`;
    } else if (kind === 'contents') {
      page.innerHTML = `
        <h3 class="album-heading">${t('album.contents')}</h3>
        <ol class="album-contents">${STAMP_SECTIONS.map((section) => {
          const at = FACES.indexOf(section);
          const count = stampCount(state, section);
          return `<li><button type="button" data-go="${at}"><span>${t(`album.section.${section}` as MessageKey)}</span><i></i><small>${count.got}/${count.total}</small><b>${at}</b></button></li>`;
        }).join('')}${this.pinsLine()}</ol>
        <p class="album-intro">${t('album.intro')}</p>${number}`;
    } else if (kind === 'world' || kind === 'games' || kind === 'secrets') {
      page.innerHTML = this.sectionPage(kind, face) + number;
    } else if (kind === 'pins') {
      page.innerHTML = this.pinsPage() + number;
    } else if (kind === 'inside') {
      page.innerHTML = `<p class="album-colophon">${t('album.colophon')}</p>${number}`;
    } else {
      page.innerHTML = `<div class="album-back-art">${head()}<span>DevOS</span></div><div class="album-barcode" aria-hidden="true"></div>`;
    }
    return page;
  }

  /** The contents' line for the pins page: how many pins are got. */
  private pinsLine(): string {
    const at = FACES.indexOf('pins');
    const got = PINS.filter((pin) => this.hooks.pins.state.got[pin.id]).length;
    return `<li><button type="button" data-go="${at}"><span>${t('album.pinsPage')}</span><i></i><small>${got}</small><b>${at}</b></button></li>`;
  }

  /** The pins stuck on the cover, where the visitor left them. */
  private coverPins(): string {
    const { cover } = this.hooks.pins.state;
    return `<div class="album-cover-pins">${PINS.filter((pin) => cover[pin.id]).map((pin) => {
      const { x, y, turn } = cover[pin.id];
      const name = t(`pins.${pin.id}.name` as MessageKey);
      return `<button type="button" class="album-cover-pin" data-pin="${pin.id}" data-from="cover" aria-label="${name}" title="${name}" style="left:${(x * 100).toFixed(2)}%;top:${(y * 100).toFixed(2)}%;width:${COVER_PIN.width * 100}%;--turn:${turn}deg"><img src="${pinImage(pin.image)}" alt="" draggable="false"></button>`;
    }).join('')}</div>`;
  }

  /** The season pins: the ones got with where and when, and the ones still to find this season as shadows. */
  private pinsPage(): string {
    const list = albumPins(this.hooks.pins.state, this.hooks.season);
    const date = new Intl.DateTimeFormat(getLanguage() === 'es' ? 'es-CO' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' });
    const items = list.map(({ pin, got }) => {
      const from = t(`pins.${pin.id}.from` as MessageKey);
      const picture = `<img src="${pinImage(pin.image)}" alt="" draggable="false">`;
      if (!got) return `<li class="album-pin is-locked" data-season-pin="${pin.id}"><span class="album-pin-face">${picture}</span><strong>${from}</strong><small>${t('album.pinHidden')}</small></li>`;
      return `<li class="album-pin is-got" data-season-pin="${pin.id}"><span class="album-pin-face">${picture}</span><strong>${t(`pins.${pin.id}.name` as MessageKey)}</strong><small>${from} · ${date.format(got)}</small></li>`;
    }).join('');
    return `
      <h3 class="album-heading">${t('album.pinsPage')}</h3>
      <p class="album-intro">${t(list.length ? 'album.pinsCopy' : 'album.pinsNone')}</p>
      ${list.length ? `<ul class="album-pins">${items}</ul>` : '<div class="album-ghosts" aria-hidden="true"><span></span><span></span></div>'}
      <p class="album-pins-soon">${t('album.pinsSoon')}</p>`;
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
    this.stopPins();
    this.drag?.ghost?.remove();
    this.flip.dispose();
    delete this.hooks.host.dataset.album;
    delete this.hooks.host.dataset.albumCover;
  }
}
