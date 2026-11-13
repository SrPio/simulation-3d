/**
 * The sticker album's stickers (stage 6, phase C): which stickers each section of the album has and which the visitor
 * has got, kept in localStorage. What earns each one is in src/core/achievements.ts; `StampBook.unlock` is the one door
 * they go through, and the page shows a toast when it opens.
 */

export type StampSection = 'world' | 'games' | 'secrets';

/** The album's sections in page order: one page each. */
export const STAMP_SECTIONS: readonly StampSection[] = ['world', 'games', 'secrets'];

/**
 * One sticker. `art` names the silhouette drawn on it for now (src/ui/silhouettes.ts ACTION_ICONS, or 'head' for the
 * character's head) until its own drawing exists; its name and hint are the messages `stamps.<id>.name` and
 * `stamps.<id>.hint`.
 */
export type Stamp = { id: string; section: StampSection; art: string };

/** Stickers per section page (a 2 × 3 grid). */
export const SLOTS_PER_PAGE = 6;

export const STAMPS: readonly Stamp[] = [
  { id: 'first-steps', section: 'world', art: 'run' },
  { id: 'devos', section: 'world', art: 'laptop' },
  { id: 'tourist', section: 'world', art: 'head' },
  { id: 'colombia', section: 'world', art: 'open' },
  { id: 'experience', section: 'world', art: 'jump' },
  { id: 'connected', section: 'world', art: 'open' },
  { id: 'sled-run', section: 'games', art: 'nitro' },
  { id: 'sled-1000', section: 'games', art: 'nitro' },
  { id: 'strike', section: 'games', art: 'kick' },
  { id: 'bullseye', section: 'games', art: 'throw' },
  { id: 'demolition', section: 'games', art: 'kick' },
  { id: 'lap', section: 'games', art: 'sit' },
  { id: 'konami', section: 'secrets', art: 'jump' },
  { id: 'heavyweight', section: 'secrets', art: 'punch' },
  { id: 'liftoff', section: 'secrets', art: 'nitro' },
  { id: 'hoverboard', section: 'secrets', art: 'jump' },
  { id: 'splinters', section: 'secrets', art: 'punch' },
  { id: 'festive', section: 'secrets', art: 'head' },
];

export const STAMPS_KEY = 'simulation-3d:stamps';

/** The stickers got so far: id → when (ms since 1970). Unknown ids and bad values are dropped. */
export type StampState = Record<string, number>;

export function readStamps(storage: Pick<Storage, 'getItem'> | undefined): StampState {
  try {
    const value = JSON.parse(storage?.getItem(STAMPS_KEY) ?? 'null') as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const state: StampState = {};
    for (const stamp of STAMPS) {
      const when = Number((value as Record<string, unknown>)[stamp.id]);
      if (Number.isFinite(when) && when > 0) state[stamp.id] = when;
    }
    return state;
  } catch {
    return {};
  }
}

/** Mark a sticker as got. False when the id is unknown or it was already got. Storage failures keep it for this page only. */
export function unlockStamp(storage: Pick<Storage, 'getItem' | 'setItem'> | undefined, state: StampState, id: string, now = Date.now()): boolean {
  if (!STAMPS.some((stamp) => stamp.id === id) || state[id]) return false;
  state[id] = now;
  try {
    storage?.setItem(STAMPS_KEY, JSON.stringify(state));
  } catch {
    // Blocked storage: the sticker lasts until the page closes.
  }
  return true;
}

/** How many of a section's (or all) stickers are got. */
export function stampCount(state: StampState, section?: StampSection): { got: number; total: number } {
  const stamps = STAMPS.filter((stamp) => !section || stamp.section === section);
  return { got: stamps.filter((stamp) => state[stamp.id]).length, total: stamps.length };
}

/** The page's sticker book: the stored state, unlocking, and word of each new sticker (the toast, the open album). */
export class StampBook {
  readonly state: StampState;
  private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | undefined;
  private readonly listeners = new Set<(id: string) => void>();

  constructor(storage: Pick<Storage, 'getItem' | 'setItem'> | undefined) {
    this.storage = storage;
    this.state = readStamps(storage);
  }

  unlock(id: string): boolean {
    if (!unlockStamp(this.storage, this.state, id)) return false;
    for (const listener of this.listeners) listener(id);
    return true;
  }

  /** Called with each new sticker's id; returns what stops listening. */
  onUnlock(listener: (id: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
