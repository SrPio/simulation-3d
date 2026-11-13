/**
 * When the room page invites the player to sit down and take out the laptop. Pure: fed with what the player is doing
 * every frame, it answers which hint to show, if any. Few and in context: once the laptop has been opened (stored by
 * the page), none show again.
 */
export type HintId = 'laptop-intro' | 'laptop-seat' | 'laptop-seated';

export type HintSituation = {
  /** START was pressed. */
  started: boolean;
  /** Something covers the world or the player is busy with the page: the menu, the desktop, the recording mode. */
  blocked: boolean;
  /** The seat in reach (the host's `data-prompt`), 'none' when there is none. */
  prompt: string;
  /** Sitting on a seat with the laptop closed (not riding the office chair). */
  seatedIdle: boolean;
  /** The laptop's desktop has been opened before (on this browser). */
  laptopFound: boolean;
};

export const HINTS = {
  /** Seconds of play after START before the first invitation, if the laptop was never opened. */
  introAfter: 40,
  /** Seconds between two invitations near a seat. */
  seatEvery: 180,
  /** Seconds sitting with the laptop closed before the key is pointed out. */
  seatedAfter: 5,
  /** Seconds after a hint before any other may show. */
  gap: 12,
} as const;

/** Seats that have a laptop to take out (the office chair is ridden, not worked at). */
const LAPTOP_SEATS = new Set(['chair', 'bed', 'bench']);

export class HintRules {
  private played = 0;
  private seated = 0;
  private sinceHint = Infinity;
  private lastSeatHint = -Infinity;
  private readonly shown = new Set<HintId>();

  /** Advance by `dt` seconds; returns the hint to show now, or undefined. */
  step(dt: number, situation: HintSituation): HintId | undefined {
    if (!situation.started || situation.laptopFound) return undefined;
    const step = Math.max(0, dt);
    this.sinceHint += step;
    if (situation.blocked) return undefined;
    this.played += step;
    this.seated = situation.seatedIdle ? this.seated + step : 0;
    if (this.sinceHint < HINTS.gap) return undefined;
    if (this.seated >= HINTS.seatedAfter && !this.shown.has('laptop-seated')) return this.show('laptop-seated');
    const seat = seatOf(situation.prompt);
    if (seat && this.played - this.lastSeatHint >= HINTS.seatEvery) {
      this.lastSeatHint = this.played;
      return this.show('laptop-seat');
    }
    if (this.played >= HINTS.introAfter && !this.shown.has('laptop-intro') && !situation.seatedIdle) return this.show('laptop-intro');
    return undefined;
  }

  private show(id: HintId): HintId {
    this.shown.add(id);
    this.sinceHint = 0;
    return id;
  }
}

function seatOf(prompt: string): string | undefined {
  return LAPTOP_SEATS.has(prompt) ? prompt : undefined;
}

/** The stored mark that the laptop's desktop has been opened, tolerant of blocked storage. */
export const LAPTOP_FOUND_KEY = 'simulation-3d:laptop-found';

export function readLaptopFound(storage: Pick<Storage, 'getItem'> | undefined): boolean {
  try {
    return storage?.getItem(LAPTOP_FOUND_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveLaptopFound(storage: Pick<Storage, 'setItem'> | undefined): void {
  try {
    storage?.setItem(LAPTOP_FOUND_KEY, '1');
  } catch {
    // Blocked storage: the hints simply stop for this visit.
  }
}
