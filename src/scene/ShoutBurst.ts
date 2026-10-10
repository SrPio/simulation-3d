import './shoutBurst.css';

/** Milliseconds the leave animation may take before the burst is hidden anyway (no animation with reduced motion). */
const LEAVE_FALLBACK = 260;
/** Points round the burst's outline: spikes alternate with the dips between them. */
const SPIKES = 18;
/** The burst keeps this far (CSS pixels) from the screen's sides. */
const EDGE = 12;

/** A comic burst outline in a 100 × 100 box: an ellipse whose rim alternates between spikes and dips, a little uneven. */
export function burstPoints(spikes = SPIKES, seed = 7): string {
  let state = seed;
  const random = () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
  const points: string[] = [];
  for (let i = 0; i < spikes * 2; i++) {
    const angle = (i / (spikes * 2)) * Math.PI * 2;
    const reach = i % 2 ? 0.8 + random() * 0.04 : 0.96 + random() * 0.04;
    points.push(`${(50 + Math.cos(angle) * 50 * reach).toFixed(1)},${(50 + Math.sin(angle) * 50 * reach).toFixed(1)}`);
  }
  return points.join(' ');
}

/**
 * An onomatopoeia-like comic burst next to the character's head: what the character exclaims near a landmark of the
 * about-me plaza. It lives in the page, like the seat bubble, so it stays sharp and facing the screen; it pops in
 * when a landmark comes in reach, swaps its words when another one does and shrinks away when the character leaves.
 */
export class ShoutBurst {
  private readonly element: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly text: HTMLDivElement;
  private readonly host: HTMLElement;
  private id?: string;
  private timer?: number;

  constructor(host: HTMLElement) {
    this.host = host;
    this.element = document.createElement('div');
    this.element.className = 'shout-burst';
    this.element.setAttribute('role', 'status');
    this.element.hidden = true;
    this.body = document.createElement('div');
    this.body.className = 'shout-burst-body';
    this.body.innerHTML = `<svg class="shout-burst-shape" viewBox="-4 -4 108 108" preserveAspectRatio="none" aria-hidden="true">
      <polygon class="shout-burst-shadow" points="${burstPoints()}" transform="translate(2.5 3.5)"/>
      <polygon class="shout-burst-fill" points="${burstPoints()}"/></svg>`;
    this.text = document.createElement('div');
    this.text.className = 'shout-burst-text';
    this.body.append(this.text);
    this.element.append(this.body);
    this.element.addEventListener('animationend', this.onAnimationEnd);
    host.append(this.element);
    host.dataset.shout = 'none';
  }

  /** Show the burst for landmark `id` with `words` (lines split on \n), or hide it; `x`/`y` is the head on the screen. */
  update(id: string | undefined, words = '', x = 0, y = 0): void {
    if (id !== this.id) this.change(id, words);
    if (!id) return;
    // Beside the head, slid left when it would leave the screen (a phone held upright).
    const room = this.host.clientWidth - EDGE - this.body.offsetWidth - this.body.offsetLeft;
    this.element.style.transform = `translate3d(${Math.max(EDGE, Math.min(x, room)).toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
  }

  private change(id: string | undefined, words: string): void {
    const was = this.id;
    this.id = id;
    window.clearTimeout(this.timer);
    this.host.dataset.shout = id ?? 'none';
    if (!id) {
      this.element.dataset.state = 'out';
      this.timer = window.setTimeout(this.finishLeave, LEAVE_FALLBACK);
      return;
    }
    this.setWords(words);
    this.element.hidden = false;
    // Restart the pop when the words change from one landmark to another.
    if (was) {
      this.element.dataset.state = '';
      void this.element.offsetWidth;
    }
    this.element.dataset.state = 'in';
  }

  /** The current landmark's words in another language. */
  setWords(words: string): void {
    const [first, ...rest] = words.split('\n');
    this.text.replaceChildren();
    const lead = document.createElement('span');
    lead.className = 'shout-burst-lead';
    lead.textContent = first;
    this.text.append(lead);
    for (const line of rest) {
      const span = document.createElement('span');
      span.textContent = line;
      this.text.append(span);
    }
  }

  get current(): string | undefined {
    return this.id;
  }

  private readonly onAnimationEnd = (): void => {
    if (!this.id) this.finishLeave();
  };

  private readonly finishLeave = (): void => {
    window.clearTimeout(this.timer);
    if (!this.id) this.element.hidden = true;
  };

  dispose(): void {
    window.clearTimeout(this.timer);
    this.element.removeEventListener('animationend', this.onAnimationEnd);
    this.element.remove();
  }
}
