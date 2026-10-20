/** The year the author started working as a developer. */
export const CAREER_START = 2022;

/** Whole years of experience by the calendar year of `date` (the system's today by default), never less than one. */
export function experienceYears(date: Date = new Date()): number {
  return Math.max(1, date.getFullYear() - CAREER_START);
}
