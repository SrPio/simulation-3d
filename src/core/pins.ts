/**
 * Season pins: one collectible picture per season event, lying somewhere on the map while that event lasts (its season
 * on and its edition: the Christmas of 2026, say). Walked over, it is picked up and kept for good in the sticker
 * album, where it can be stuck on the cover; once the event is over it can no longer be found, but a pin already got
 * is never taken away (even if a later version of the page drops it from PINS, its record stays in storage).
 * The pictures are made by scripts/season_pins.ts (public/pins/<id>.webp).
 */
import type { Season } from './christmas.ts';
import { seasonId } from './hoverboard.ts';

export type Pin = {
  id: string;
  /** The season whose dress-up shows it, and the edition of that season it belongs to (see pinEdition). */
  season: Exclude<Season, 'none'>;
  edition: string;
  /** Its picture under public/ and that picture's width over its height. */
  image: string;
  aspect: number;
  /** Where it stands on the outside ground (three.js x, z) and its height there (m). */
  at: { x: number; z: number };
  height: number;
};

/**
 * Every pin there has been, oldest first. Its name and where it came from are the messages `pins.<id>.name` and
 * `pins.<id>.from`.
 */
export const PINS: readonly Pin[] = [
  // The snowman in the cap, Christmas 2026: past the giant tree, between it and the forest.
  { id: 'christmas-snowman', season: 'christmas', edition: '2026', image: 'pins/christmas-snowman.webp', aspect: 396 / 480, at: { x: 41.2, z: 1.4 }, height: 0.8 },
];

/** The edition of a season a date belongs to: the year of the December a Christmas began in, or the year otherwise. */
export function pinEdition(season: Season, date: Date = new Date()): string {
  return season === 'christmas' ? seasonId(date) : String(date.getFullYear());
}

export const PINS_KEY = 'simulation-3d:pins';

/** Where a pin is stuck on the album's cover: its middle as fractions of the cover (0…1), and its tilt in degrees. */
export type PinPlace = { x: number; y: number; turn: number };

/** What is stored: the pins got (id → when, ms since 1970) and the ones stuck on the cover. */
export type PinState = { got: Record<string, number>; cover: Record<string, PinPlace> };

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

export function readPins(storage: Pick<Storage, 'getItem'> | undefined): PinState {
  const state: PinState = { got: {}, cover: {} };
  try {
    const value = JSON.parse(storage?.getItem(PINS_KEY) ?? 'null') as unknown;
    if (!value || typeof value !== 'object') return state;
    const { got, cover } = value as { got?: unknown; cover?: unknown };
    // Every pin ever got is kept, known to this version of the page or not.
    if (got && typeof got === 'object') {
      for (const [id, when] of Object.entries(got as Record<string, unknown>)) {
        if (typeof when === 'number' && Number.isFinite(when) && when > 0) state.got[id] = when;
      }
    }
    if (cover && typeof cover === 'object') {
      for (const [id, place] of Object.entries(cover as Record<string, unknown>)) {
        const { x, y, turn } = (place ?? {}) as Record<string, unknown>;
        if (!state.got[id] || typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) continue;
        state.cover[id] = { x: clamp(x, 0, 1), y: clamp(y, 0, 1), turn: typeof turn === 'number' && Number.isFinite(turn) ? clamp(turn, -30, 30) : 0 };
      }
    }
  } catch {
    // Unreadable: start empty (nothing is written until a pin is got).
  }
  return state;
}

function save(storage: Pick<Storage, 'setItem'> | undefined, state: PinState): void {
  try {
    storage?.setItem(PINS_KEY, JSON.stringify(state));
  } catch {
    // Blocked storage: the pins last until the page closes.
  }
}

/** The pins to lay on the map now: those of this season's edition not got yet. */
export function pinsOnMap(state: PinState, season: Season, date: Date = new Date()): Pin[] {
  if (season === 'none') return [];
  const edition = pinEdition(season, date);
  return PINS.filter((pin) => pin.season === season && pin.edition === edition && !state.got[pin.id]);
}

/** The pins the album shows: every known pin got, and the ones that can still be found now (as empty slots). */
export function albumPins(state: PinState, season: Season, date: Date = new Date()): { pin: Pin; got?: number }[] {
  const open = new Set(pinsOnMap(state, season, date).map((pin) => pin.id));
  return PINS.filter((pin) => state.got[pin.id] || open.has(pin.id)).map((pin) => ({ pin, got: state.got[pin.id] }));
}

/** Whether a point (x, z) is close enough to a pin to pick it up. */
export const PIN_REACH = 0.85;
export function pinReached(pin: Pin, x: number, z: number): boolean {
  return Math.hypot(x - pin.at.x, z - pin.at.z) <= PIN_REACH;
}

/** The page's pin book: the stored state, picking a pin up, and sticking pins on the album's cover. */
export class PinBook {
  readonly state: PinState;
  private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | undefined;
  private readonly listeners = new Set<(id: string) => void>();

  constructor(storage: Pick<Storage, 'getItem' | 'setItem'> | undefined) {
    this.storage = storage;
    this.state = readPins(storage);
  }

  /** Keep a pin for good. False when it is unknown or was already got. */
  collect(id: string, now = Date.now()): boolean {
    if (!PINS.some((pin) => pin.id === id) || this.state.got[id]) return false;
    this.state.got[id] = now;
    save(this.storage, this.state);
    for (const listener of this.listeners) listener(id);
    return true;
  }

  /** Stick a pin got on the cover at (x, y) (fractions of the cover), or take it off with `place` undefined. */
  place(id: string, place: PinPlace | undefined): void {
    if (!this.state.got[id]) return;
    if (place) this.state.cover[id] = { x: clamp(place.x, 0, 1), y: clamp(place.y, 0, 1), turn: clamp(place.turn, -30, 30) };
    else delete this.state.cover[id];
    save(this.storage, this.state);
    for (const listener of this.listeners) listener(id);
  }

  /** Called with a pin's id when it is got or moved; returns what stops listening. */
  onChange(listener: (id: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
