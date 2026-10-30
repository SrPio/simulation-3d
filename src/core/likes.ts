/** How often the shared count is asked again while the page is visible (ms). */
export const LIKE_POLL = 15_000;
/** One like per visitor per day, as the server counts it (api/likes.ts LIKE_WINDOW). */
export const LIKE_WINDOW_MS = 24 * 60 * 60 * 1000;
/** After its own like, a count older than this one is not shown for a while (the CDN may still hold a stale one, ms). */
const CONFIRMED_HOLD = 35_000;
const LIKED_KEY = 'simulation-3d:liked-until';

/** A server reply's count and wait, or undefined when it is not one (never trust the network blindly). */
export function readReply(data: unknown): { likes: number; retryAfter: number } | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const { likes, retryAfter } = data as { likes?: unknown; retryAfter?: unknown };
  if (typeof likes !== 'number' || !Number.isSafeInteger(likes) || likes < 0) return undefined;
  const wait = typeof retryAfter === 'number' && Number.isFinite(retryAfter) ? Math.min(Math.max(retryAfter, 0), LIKE_WINDOW_MS / 1000) : 0;
  return { likes, retryAfter: wait };
}

/** The count as painted on the ground: whole up to 9,999, then 12.3k, 125k, 1.2M; a dash while unknown. */
export function formatLikes(likes: number | undefined): string {
  if (likes === undefined) return '—';
  if (likes < 10_000) return String(likes);
  const [value, unit] = likes < 1_000_000 ? [likes / 1000, 'k'] : [likes / 1_000_000, 'M'];
  return `${value < 100 ? Math.floor(value * 10) / 10 : Math.floor(value)}${unit}`;
}

type Options = { url: string; storage?: Storage; fetch?: typeof fetch; now?: () => number };

/**
 * The room page's like counter: the shared count from /api/likes, asked again every LIKE_POLL while the page is
 * visible, and this visitor's like (one a day). A like shows at once and is put right by the server's answer; when
 * the server is out of reach the count is a dash and the world goes on. The browser only remembers until when its
 * like holds (to light the key); the server alone decides what counts.
 */
export class LikeCounter {
  /** Called whenever the count or the liked state changes. */
  onChange?: () => void;
  private count: number | undefined;
  private likedUntil: number;
  private pending = false;
  private confirmed = { likes: 0, at: -Infinity };
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly url: string;
  private readonly storage?: Storage;
  private readonly request: typeof fetch;
  private readonly now: () => number;

  constructor(options: Options) {
    this.url = options.url;
    this.storage = options.storage;
    this.request = options.fetch ?? ((input, init) => fetch(input, init));
    this.now = options.now ?? Date.now;
    let stored = 0;
    try { stored = Number(this.storage?.getItem(LIKED_KEY)) || 0; } catch { /* blocked storage */ }
    // A stored time far in the future is not believed.
    this.likedUntil = stored > this.now() + LIKE_WINDOW_MS ? 0 : stored;
  }

  get likes(): number | undefined {
    return this.count;
  }

  /** Whether this visitor's like still holds (the key stays lit). */
  get liked(): boolean {
    return this.likedUntil > this.now();
  }

  /** Asks for the count now and then every LIKE_POLL while the page is visible. */
  start(): void {
    if (this.timer !== undefined) return;
    void this.refresh();
    this.timer = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') void this.refresh();
    }, LIKE_POLL);
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async refresh(): Promise<void> {
    if (this.pending) return;
    const reply = await this.call('GET');
    if (this.pending || !reply) return;
    const fresh = this.now() - this.confirmed.at < CONFIRMED_HOLD;
    this.set(fresh ? Math.max(reply.likes, this.confirmed.likes) : reply.likes);
  }

  /** This visitor likes the project: false when its like still holds or one is on its way. */
  async like(): Promise<boolean> {
    if (this.liked || this.pending) return false;
    const before = this.count;
    this.pending = true;
    this.likedUntil = this.now() + LIKE_WINDOW_MS;
    this.set(before === undefined ? undefined : before + 1);
    const reply = await this.call('POST');
    this.pending = false;
    if (reply) {
      // Counted, or already liked today from this connection: either way the key stays lit until the server's time.
      this.likedUntil = this.now() + (reply.retryAfter > 0 ? reply.retryAfter * 1000 : LIKE_WINDOW_MS);
      this.confirmed = { likes: reply.likes, at: this.now() };
      this.remember();
      this.set(reply.likes);
      return true;
    }
    this.likedUntil = 0;
    this.set(before);
    return false;
  }

  private set(likes: number | undefined): void {
    this.count = likes;
    this.onChange?.();
  }

  private remember(): void {
    try { this.storage?.setItem(LIKED_KEY, String(this.likedUntil)); } catch { /* blocked storage */ }
  }

  /** One request; the reply when it carries a count (also a 429 "already liked"), else undefined. */
  private async call(method: 'GET' | 'POST'): Promise<{ likes: number; retryAfter: number } | undefined> {
    try {
      const response = await this.request(this.url, { method, credentials: 'same-origin', headers: { Accept: 'application/json' } });
      if (!response.ok && response.status !== 429) return undefined;
      return readReply(await response.json());
    } catch {
      return undefined;
    }
  }
}
