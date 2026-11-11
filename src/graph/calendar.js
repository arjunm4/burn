// Working-day calendar, isomorphic. Hardware teams count lead times and lateness in working
// days (Mon–Fri minus company holidays); the engine and the decision core use these helpers
// whenever a calendar is given, and fall back to calendar days when it is not.
const DAY = 86400000;
export const toDay = iso => Math.round(Date.parse(iso.slice(0, 10) + 'T00:00:00Z') / DAY);
export const toIso = day => new Date(day * DAY).toISOString().slice(0, 10);

/** @param {{holidays?: string[]}} [calendar] holidays as ISO dates (full closures only) */
export function makeCalendar(calendar = {}) {
  const holidays = new Set((calendar.holidays || []).map(h => (typeof h === 'string' ? h : h.date)).map(toDay));
  const isWorking = day => { const wd = (day + 4) % 7; return wd !== 0 && wd !== 6 && !holidays.has(day); }; // day 0 (1970-01-01) was a Thursday
  // The n-th working day after `day` (n >= 1); n = 0 returns `day` itself.
  const addWorkingDays = (day, n) => { let d = day; for (let i = 0; i < n; i++) { d++; while (!isWorking(d)) d++; } return d; };
  // Working days in (from, to]; negative when `to` is earlier.
  const workingDaysBetween = (from, to) => { if (to < from) return -workingDaysBetween(to, from); let n = 0; for (let d = from + 1; d <= to; d++) if (isWorking(d)) n++; return n; };
  return {isWorking, addWorkingDays, workingDaysBetween, holidays: [...holidays].map(toIso)};
}
