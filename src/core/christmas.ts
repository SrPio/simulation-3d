/**
 * The Christmas season: from 1 December to 5 January of the next year (months count from 0: 11 is December, 0 January).
 * The range wraps round the new year.
 */
export const CHRISTMAS = { from: { month: 11, day: 1 }, to: { month: 0, day: 5 } } as const;

/** Whether `date` (the system's today by default) falls in the Christmas season. */
export function isChristmasSeason(date: Date = new Date()): boolean {
  const month = date.getMonth();
  const day = date.getDate();
  const after = month > CHRISTMAS.from.month || (month === CHRISTMAS.from.month && day >= CHRISTMAS.from.day);
  const before = month < CHRISTMAS.to.month || (month === CHRISTMAS.to.month && day <= CHRISTMAS.to.day);
  // The season crosses the new year, so either end is enough.
  return after || before;
}

const ON = ['', '1', 'on', 'true', 'yes', 'si', 'sí'];
const OFF = ['0', 'off', 'false', 'no'];

/**
 * Whether the room page dresses up for Christmas: `?navidad=1` or `?christmas=1` (or on, true) forces it on and
 * `=0` (or off, false) off whatever the date; without either parameter it follows the season.
 */
export function christmasMode(search: string, date: Date = new Date()): boolean {
  const params = new URLSearchParams(search);
  for (const name of ['navidad', 'christmas']) {
    const value = params.get(name);
    if (value === null) continue;
    const forced = value.trim().toLowerCase();
    if (ON.includes(forced)) return true;
    if (OFF.includes(forced)) return false;
  }
  return isChristmasSeason(date);
}

export type Season = 'christmas' | 'halloween' | 'none';

/** One season at a time: the dates never overlap, and when both are forced on by the URL Christmas wins. */
export function seasonOf(christmas: boolean, halloween: boolean): Season {
  return christmas ? 'christmas' : halloween ? 'halloween' : 'none';
}

/**
 * Whole days from `date` to the next 24 December (Christmas Eve, when the celebration starts): 0 on the 24th and 25th,
 * and null after the 25th until the season ends (nothing left to count).
 */
export function daysToChristmas(date: Date = new Date()): number | null {
  const month = date.getMonth();
  const day = date.getDate();
  if (month === 11 && (day === 24 || day === 25)) return 0;
  if ((month === 11 && day > 25) || month < 11 && isChristmasSeason(date)) return null;
  const today = Date.UTC(date.getFullYear(), month, day);
  const eve = Date.UTC(date.getFullYear(), 11, 24);
  return Math.round((eve - today) / 86_400_000);
}
