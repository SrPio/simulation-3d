/**
 * What earns each sticker of the album (src/core/stamps.ts). Pure rules over a snapshot of the page's state as the
 * viewer, the desktop and the minigame keep it on the viewer host (`data-*` attributes, read as `host.dataset`), plus a
 * little progress kept between visits (the sign zones visited). The page checks them a few times a second.
 */

/** The viewer host's data attributes (`host.dataset`). */
export type Snapshot = Readonly<Record<string, string | undefined>>;

/** What has to add up over time: the sign zones walked into. */
export type AchievementProgress = { signs: string[] };

export const PROGRESS_KEY = 'simulation-3d:stamp-progress';
/** The three sign zones the «Conectado» sticker asks for. */
export const SIGNS = ['portfolio', 'github', 'linkedin'] as const;

/** Thresholds of the stickers that ask for an amount. */
export const GOALS = {
  /** Points in one chair downhill run. */
  sledScore: 1000,
  /** Bowling pins down at once. */
  pins: 10,
  /** Bricks down (playground and the circuit's end wall). */
  bricks: 15,
  /** A punching bag swung at least this far (degrees) by a blow at least this strong (0…1). */
  bagSwing: 20,
  strikePower: 0.9,
  /** Below this the character stands on the outside ground, out of the room (m). */
  outside: -0.05,
} as const;

const count = (value: string | undefined) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

/** The largest swing in `data-bags` ("js:12,ts:3"). */
const bagSwing = (value: string | undefined) => Math.max(0, ...(value ?? '').split(',').map((entry) => count(entry.split(':')[1])));

/** Each sticker and when it is earned. */
export const RULES: Record<string, (state: Snapshot, progress: AchievementProgress) => boolean> = {
  'first-steps': (s) => s.elevation !== undefined && count(s.elevation) < GOALS.outside,
  devos: (s) => s.desktop !== undefined && s.desktop !== 'closed',
  tourist: (s) => s.shout === 'bust',
  colombia: (s) => s.shout === 'colombia',
  experience: (s) => s.rubik === 'solved',
  connected: (_, p) => SIGNS.every((sign) => p.signs.includes(sign)),
  'sled-run': (s) => s.minigame === 'over',
  'sled-1000': (s) => count(s.mgScore) >= GOALS.sledScore,
  strike: (s) => count(s.pins) >= GOALS.pins,
  bullseye: (s) => count(s.bullseyes) >= 1,
  demolition: (s) => count(s.bricks) >= GOALS.bricks,
  lap: (s) => s.lap !== undefined && Number.isFinite(Number(s.lap)) && s.lap !== '',
  konami: (s) => count(s.konami) >= 1,
  heavyweight: (s) => bagSwing(s.bags) >= GOALS.bagSwing && count(s.strikePower) >= GOALS.strikePower,
  liftoff: (s) => count(s.chairJumps) >= 1,
  // Christmas: every snowman destroyed unlocks the snow hoverboard (data-board leaves 'locked').
  hoverboard: (s) => s.board !== undefined && s.board !== 'locked',
  splinters: (s) => count(s.broken) >= 1,
  festive: (s) => s.halloween === 'on' || s.christmas === 'on',
};

/** Remember what adds up over time; true when the progress changed (to be stored). */
export function trackProgress(state: Snapshot, progress: AchievementProgress): boolean {
  const sign = state.sign;
  if (sign && (SIGNS as readonly string[]).includes(sign) && !progress.signs.includes(sign)) {
    progress.signs.push(sign);
    return true;
  }
  return false;
}

/** The stickers earned now that are not got yet. */
export function earned(state: Snapshot, progress: AchievementProgress, got: Readonly<Record<string, number>>): string[] {
  return Object.entries(RULES).filter(([id, rule]) => !got[id] && rule(state, progress)).map(([id]) => id);
}

export function readProgress(storage: Pick<Storage, 'getItem'> | undefined): AchievementProgress {
  try {
    const value = JSON.parse(storage?.getItem(PROGRESS_KEY) ?? 'null') as Partial<AchievementProgress> | null;
    const signs = Array.isArray(value?.signs) ? value.signs.filter((sign): sign is string => (SIGNS as readonly string[]).includes(sign as string)) : [];
    return { signs: [...new Set(signs)] };
  } catch {
    return { signs: [] };
  }
}

export function saveProgress(storage: Pick<Storage, 'setItem'> | undefined, progress: AchievementProgress): void {
  try {
    storage?.setItem(PROGRESS_KEY, JSON.stringify(progress));
  } catch {
    // Blocked storage: the progress lasts for this page only.
  }
}
