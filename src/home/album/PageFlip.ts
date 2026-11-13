import { CURL, ease, edgeAt, relativeAngles, stripAngles, stripShade } from './pageCurl.ts';

/** Two pages side by side (a magazine opened flat), or one page at a time on a narrow screen. */
export type FlipMode = 'spread' | 'single';

export type FlipOptions = {
  /** How many page faces the book has (even: each leaf has a front and a back). */
  faces: number;
  /** A fresh element for a page face (it is copied for the strips of a turning page). */
  render: (face: number) => HTMLElement;
  reducedMotion: () => boolean;
  /** After each finished turn (and on a mode change): the faces now showing. */
  onChange?: (shown: number[]) => void;
  /** A turn starts (for its rustle). */
  onTurn?: () => void;
};

type Turn = {
  /** The leaf turning (spread) or the face turning (single), and where it is heading: 1 over to the left, 0 back. */
  index: number;
  from: number;
  to: number;
  progress: number;
  /** Seconds into the animation once let go; undefined while dragged. */
  time?: number;
  duration: number;
  /** The turn moves the book on by one (forwards) or back by one. */
  forward: boolean;
  leaf: HTMLDivElement;
  strips: HTMLDivElement[];
};

/** Movement (px) before a press on a page becomes a drag instead of a click. */
const DRAG_START = 6;
/** Width (px) of the soft shadow a lifted page throws on the page under it. */
const CAST = 70;

/**
 * A book whose pages turn like paper: the turning page is cut into vertical strips (nested, each turned a little more
 * than the last, see pageCurl.ts) with its front on one side and its back on the other, shaded as they turn away from
 * the light, throwing a shadow on the page below. A page can be dragged over by its edge with the mouse or a finger
 * and is let go to finish or fall back; a click, the arrows or `next`/`prev` turn it whole. With reduced motion pages
 * simply change.
 *
 * In spread mode `position` counts the leaves turned (0 closed on its cover … faces/2 closed on its back), and the
 * book slides so a closed book sits in the middle. In single mode it is the face shown.
 */
export class PageFlip {
  readonly element: HTMLDivElement;
  private readonly options: FlipOptions;
  private readonly left: HTMLDivElement;
  private readonly right: HTMLDivElement;
  private readonly castLeft: HTMLDivElement;
  private readonly castRight: HTMLDivElement;
  private mode: FlipMode = 'spread';
  private position = 0;
  private turn?: Turn;
  private frame = 0;
  private last = 0;
  private width = 300;
  private height = 420;
  private press?: { id: number; x: number; y: number; dragging: boolean; forward: boolean; lastX: number; speed: number; time: number };

  constructor(parent: HTMLElement, options: FlipOptions) {
    this.options = options;
    this.element = document.createElement('div');
    this.element.className = 'album-book';
    this.element.innerHTML = `
      <div class="album-sheet is-left"><div class="album-slot"></div><div class="album-cast"></div></div>
      <div class="album-sheet is-right"><div class="album-slot"></div><div class="album-cast"></div></div>`;
    this.left = this.element.querySelector('.is-left')!;
    this.right = this.element.querySelector('.is-right')!;
    this.castLeft = this.left.querySelector('.album-cast')!;
    this.castRight = this.right.querySelector('.album-cast')!;
    parent.append(this.element);
    this.element.addEventListener('pointerdown', this.onDown);
    this.element.addEventListener('pointermove', this.onMove);
    this.element.addEventListener('pointerup', this.onUp);
    this.element.addEventListener('pointercancel', this.onUp);
    this.show();
  }

  private get leaves(): number {
    return this.options.faces / 2;
  }

  /** The last position: every leaf turned (spread) or the last face (single). */
  private get end(): number {
    return this.mode === 'spread' ? this.leaves : this.options.faces - 1;
  }

  get turning(): boolean {
    return !!this.turn;
  }

  /** The faces showing now (for the page counter and tests). */
  get shown(): number[] {
    if (this.mode === 'single') return [this.position];
    return [2 * this.position - 1, 2 * this.position].filter((face) => face >= 0 && face < this.options.faces);
  }

  /** Page size and mode; the page shown stays the same across a mode change. */
  layout(mode: FlipMode, width: number, height: number): void {
    this.finishNow();
    if (mode !== this.mode) {
      const face = this.shown[this.shown.length - 1] ?? 0;
      this.position = mode === 'single' ? face : Math.ceil(face / 2);
      this.mode = mode;
    }
    this.width = Math.max(1, Math.round(width));
    this.height = Math.max(1, Math.round(height));
    this.element.dataset.mode = mode;
    this.element.style.setProperty('--page-w', `${this.width}px`);
    this.element.style.setProperty('--page-h', `${this.height}px`);
    this.show();
  }

  next(): void {
    this.start(true);
  }

  prev(): void {
    this.start(false);
  }

  /** Jump to a position (the contents page's links), turning one page if it is next door. */
  go(position: number): void {
    const target = Math.max(0, Math.min(this.end, position));
    if (target === this.position || this.turn) return;
    if (Math.abs(target - this.position) === 1) {
      this.start(target > this.position);
      return;
    }
    this.position = target;
    this.show();
  }

  /** Show the spread or page holding this face. */
  goToFace(face: number): void {
    this.go(this.mode === 'spread' ? Math.ceil(face / 2) : face);
  }

  /** Repaint the pages showing (a sticker was got, the language changed). */
  refresh(): void {
    if (!this.turn) this.show();
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.element.remove();
  }

  /** The faces lying flat: idle, or under a turning page. */
  private show(turn?: { index: number; forward: boolean }): void {
    let left: number | undefined;
    let right: number | undefined;
    const faces = this.options.faces;
    if (this.mode === 'spread') {
      const k = turn ? turn.index : this.position;
      left = k > 0 ? 2 * k - 1 : undefined;
      right = turn ? (2 * k + 2 < faces ? 2 * k + 2 : undefined) : (2 * k < faces ? 2 * k : undefined);
      // A closed book sits in the middle: on its cover, or on its back cover.
      const at = turn ? (turn.forward ? this.position + 1 : this.position - 1) : this.position;
      this.element.dataset.at = at === 0 ? 'cover' : at === this.leaves ? 'back' : 'open';
    } else {
      // Under the turning page lies the one after it.
      right = turn ? turn.index + 1 : this.position;
      this.element.dataset.at = 'open';
    }
    this.fill(this.left, left);
    this.fill(this.right, right);
    this.left.hidden = this.mode === 'single';
    this.setCast(0, 0);
    if (!turn) this.options.onChange?.(this.shown);
  }

  private fill(sheet: HTMLDivElement, face: number | undefined): void {
    const slot = sheet.querySelector<HTMLDivElement>('.album-slot')!;
    sheet.classList.toggle('is-empty', face === undefined);
    if (face === undefined) {
      slot.replaceChildren();
      delete sheet.dataset.face;
      return;
    }
    sheet.dataset.face = String(face);
    slot.replaceChildren(this.options.render(face));
  }

  /** Begin turning the next page over (forward) or the last one back; false when there is none or one is turning. */
  private start(forward: boolean, progress?: number): boolean {
    if (this.turn) return false;
    if (forward ? this.position >= this.end : this.position <= 0) return false;
    if (this.options.reducedMotion()) {
      this.position += forward ? 1 : -1;
      this.options.onTurn?.();
      this.show();
      return true;
    }
    const index = forward ? this.position : this.position - 1;
    const from = forward ? 0 : 1;
    const [front, back] = this.mode === 'spread' ? [2 * index, 2 * index + 1] : [index, undefined];
    const { leaf, strips } = this.buildLeaf(front, back);
    this.turn = { index, from, to: forward ? 1 : 0, progress: progress ?? from, time: progress === undefined ? 0 : undefined, duration: CURL.duration, forward, leaf, strips };
    this.show({ index, forward });
    this.element.append(leaf);
    this.pose();
    this.options.onTurn?.();
    this.last = performance.now();
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(this.tick);
    return true;
  }

  /** The turning page: nested strips, each with its slice of the front and of the back. */
  private buildLeaf(front: number, back: number | undefined): { leaf: HTMLDivElement; strips: HTMLDivElement[] } {
    const leaf = document.createElement('div');
    leaf.className = 'album-leaf';
    const count = CURL.strips;
    const width = this.width / count;
    const frontPage = this.options.render(front);
    const backPage = back === undefined ? blankBack() : this.options.render(back);
    const strips: HTMLDivElement[] = [];
    let parent: HTMLElement = leaf;
    for (let i = 0; i < count; i++) {
      const strip = document.createElement('div');
      strip.className = 'album-strip';
      strip.style.width = `${width + 0.6}px`;
      strip.style.left = i === 0 ? '0' : `${width}px`;
      const faceFront = document.createElement('div');
      faceFront.className = 'album-face is-front';
      const copyFront = i === 0 ? frontPage : (frontPage.cloneNode(true) as HTMLElement);
      copyFront.style.left = `${-i * width}px`;
      faceFront.append(copyFront);
      const faceBack = document.createElement('div');
      faceBack.className = 'album-face is-back';
      const copyBack = i === 0 ? backPage : (backPage.cloneNode(true) as HTMLElement);
      copyBack.style.left = `${-(this.width - (i + 1) * width)}px`;
      faceBack.append(copyBack);
      strip.append(faceFront, faceBack);
      parent.append(strip);
      strips.push(strip);
      parent = strip;
    }
    return { leaf, strips };
  }

  private readonly tick = (now: number): void => {
    const turn = this.turn;
    if (!turn) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (turn.time !== undefined) {
      turn.time += dt;
      const t = ease(turn.time / turn.duration);
      turn.progress = turn.from + (turn.to - turn.from) * t;
      this.pose();
      if (t >= 1) {
        this.finish();
        return;
      }
    }
    this.frame = requestAnimationFrame(this.tick);
  };

  /** Turn the strips to the turn's progress, shade them, and move the shadow on the page below. */
  private pose(): void {
    const turn = this.turn;
    if (!turn) return;
    const angles = stripAngles(turn.progress);
    const relative = relativeAngles(angles);
    turn.strips.forEach((strip, i) => {
      strip.style.transform = `rotateY(${-relative[i]}rad)`;
      strip.style.setProperty('--shade', stripShade(angles[i]).toFixed(3));
    });
    this.setCast(edgeAt(angles), Math.sin(turn.progress * Math.PI));
  }

  /** The lifted page's shadow: on the right page beside its edge while over it, on the left page while over that one. */
  private setCast(edge: number, strength: number): void {
    const px = edge * this.width;
    const alpha = (0.42 * strength).toFixed(3);
    this.castRight.style.opacity = edge > 0 ? '1' : '0';
    this.castRight.style.background = `linear-gradient(90deg, transparent ${Math.max(0, px - 2)}px, rgba(20, 8, 30, ${alpha}) ${px}px, transparent ${px + CAST}px)`;
    const fromRight = this.width + px;
    this.castLeft.style.opacity = edge < 0 ? '1' : '0';
    this.castLeft.style.background = `linear-gradient(90deg, transparent ${fromRight - CAST}px, rgba(20, 8, 30, ${alpha}) ${fromRight}px, transparent ${fromRight + 2}px)`;
  }

  private finish(): void {
    const turn = this.turn;
    if (!turn) return;
    this.turn = undefined;
    turn.leaf.remove();
    const done = turn.to === (turn.forward ? 1 : 0);
    if (done) this.position += turn.forward ? 1 : -1;
    this.show();
  }

  /** A turn in progress jumps to its end (before a resize). */
  private finishNow(): void {
    if (!this.turn) return;
    this.turn.progress = this.turn.to;
    this.finish();
  }

  /** Where a pointer is across the book, in page widths from the spine (spread) or the page's left edge (single). */
  private across(event: PointerEvent): number {
    const box = this.element.getBoundingClientRect();
    const spine = this.mode === 'spread' ? box.left + box.width / 2 : box.left;
    return (event.clientX - spine) / Math.max(1, box.width / (this.mode === 'spread' ? 2 : 1));
  }

  private readonly onDown = (event: PointerEvent): void => {
    if (this.turn || event.button > 0) return;
    const x = this.across(event);
    const forward = this.mode === 'spread' ? x > 0 : x > 0.5;
    this.press = { id: event.pointerId, x: event.clientX, y: event.clientY, dragging: false, forward, lastX: event.clientX, speed: 0, time: performance.now() };
  };

  private readonly onMove = (event: PointerEvent): void => {
    const press = this.press;
    if (!press || press.id !== event.pointerId) return;
    const now = performance.now();
    press.speed = (event.clientX - press.lastX) / Math.max(1, now - press.time);
    press.lastX = event.clientX;
    press.time = now;
    if (!press.dragging) {
      if (Math.abs(event.clientX - press.x) < DRAG_START) return;
      // Only a drag towards the spine turns a page.
      if ((event.clientX - press.x < 0) !== press.forward) {
        this.press = undefined;
        return;
      }
      if (!this.start(press.forward, press.forward ? 0 : 1) || !this.turn) {
        this.press = undefined;
        return;
      }
      press.dragging = true;
      this.element.setPointerCapture(event.pointerId);
    }
    const turn = this.turn;
    if (!turn) return;
    // The edge follows the pointer: seen from ahead a page turned by θ shows its edge cos θ page widths from the spine.
    turn.progress = Math.acos(Math.min(1, Math.max(-1, this.across(event)))) / Math.PI;
    this.pose();
  };

  private readonly onUp = (event: PointerEvent): void => {
    const press = this.press;
    if (!press || press.id !== event.pointerId) return;
    this.press = undefined;
    if (!press.dragging) {
      if (event.type === 'pointerup' && !(event.target as Element).closest('a, button')) this.start(press.forward);
      return;
    }
    const turn = this.turn;
    if (!turn) return;
    // A quick flick decides on its own; otherwise past the middle goes over.
    // A single page can only be pulled to its left edge (half a turn): past a third of the way it goes over.
    const over = this.mode === 'single' ? 0.33 : 0.5;
    const flick = Math.abs(press.speed) > 0.5 ? (press.speed < 0 ? 1 : 0) : turn.progress > over ? 1 : 0;
    turn.from = turn.progress;
    turn.to = flick;
    turn.duration = Math.max(0.18, CURL.duration * Math.abs(flick - turn.progress));
    turn.time = 0;
    this.last = performance.now();
  };
}

/** The back of a single page in single mode: plain paper. */
function blankBack(): HTMLElement {
  const page = document.createElement('div');
  page.className = 'album-page is-blank';
  return page;
}
