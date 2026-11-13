/**
 * The snow hoverboard is a seasonal prize: once every snowman has been destroyed it stays unlocked for the rest of that
 * Christmas season (kept in localStorage as the season's year) and is locked again the next one.
 */
export const HOVERBOARD_KEY = 'simulation-3d:hoverboard';

/** The season a date belongs to: the year of the December it started in (5 January 2027 belongs to 2026). */
export function seasonId(date: Date = new Date()): string {
  return String(date.getMonth() < 6 ? date.getFullYear() - 1 : date.getFullYear());
}

export function readBoardUnlocked(storage: Pick<Storage, 'getItem'> | undefined, date: Date = new Date()): boolean {
  try {
    return storage?.getItem(HOVERBOARD_KEY) === seasonId(date);
  } catch {
    return false;
  }
}

export function saveBoardUnlocked(storage: Pick<Storage, 'setItem'> | undefined, date: Date = new Date()): void {
  try {
    storage?.setItem(HOVERBOARD_KEY, seasonId(date));
  } catch {
    // Blocked storage: the board stays unlocked for this visit only.
  }
}
