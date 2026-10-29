/** The Halloween season: from 1 October to 5 November of every year (months count from 0: 9 is October, 10 November). */
export const HALLOWEEN = { from: { month: 9, day: 1 }, to: { month: 10, day: 5 } } as const;

/** Whether `date` (the system's today by default) falls in the Halloween season. */
export function isHalloweenSeason(date: Date = new Date()): boolean {
  const month = date.getMonth();
  const day = date.getDate();
  const after = month > HALLOWEEN.from.month || (month === HALLOWEEN.from.month && day >= HALLOWEEN.from.day);
  const before = month < HALLOWEEN.to.month || (month === HALLOWEEN.to.month && day <= HALLOWEEN.to.day);
  return after && before;
}

/**
 * Whether the room page dresses up for Halloween: `?halloween=1` (or on, true) forces it on and `?halloween=0` (or off,
 * false) off whatever the date; without the parameter it follows the season.
 */
export function halloweenMode(search: string, date: Date = new Date()): boolean {
  const value = new URLSearchParams(search).get('halloween');
  if (value !== null) {
    const forced = value.trim().toLowerCase();
    if (['', '1', 'on', 'true', 'yes', 'si', 'sí'].includes(forced)) return true;
    if (['0', 'off', 'false', 'no'].includes(forced)) return false;
  }
  return isHalloweenSeason(date);
}
