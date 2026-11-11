// Working-day calendar for the maths core. Browser-safe: no imports, no Intl, no host time zone.
//
// Copied from scripts/generate-world/lib/calendar.mjs (addDays, dow, isWd, nextWd, prevWd, onOrAfter, addWd,
// wdBetween) so the UI bundle does not pull in the generator's makeCalendar(meta), which needs meta.window.
// Semantics are identical; timevalue.test.mjs checks them against the original.
//
// Dates are 'YYYY-MM-DD'. A working day (wd) is Mon-Fri minus holidays with observance 'full'
// ('worked' and 'partial' days are working days).

const DAY = 86400e3;
const parse = (date) => Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10));
const fmt = (ms) => new Date(ms).toISOString().slice(0, 10);

export const addDays = (date, n) => fmt(parse(date) + n * DAY);
export const dow = (date) => new Date(parse(date)).getUTCDay(); // 0 = Sunday ... 6 = Saturday
export const toDate = (dateOrIso) => (dateOrIso == null ? null : String(dateOrIso).slice(0, 10));

export function makeCalendar(holidays = []) {
  const closed = new Set(holidays.filter((h) => h.observance === 'full').map((h) => h.date));
  const isWd = (date) => { const d = dow(date); return d !== 0 && d !== 6 && !closed.has(date); };
  const nextWd = (date) => { let d = addDays(date, 1); while (!isWd(d)) d = addDays(d, 1); return d; };
  const prevWd = (date) => { let d = addDays(date, -1); while (!isWd(d)) d = addDays(d, -1); return d; };
  const onOrAfter = (date) => (isWd(date) ? date : nextWd(date));
  // n-th wd after date (n < 0: before; n = 0: the date itself, moved forward to a wd).
  const addWd = (date, n) => {
    if (n === 0) return onOrAfter(date);
    let d = date;
    for (let i = 0; i < Math.abs(n); i++) d = n > 0 ? nextWd(d) : prevWd(d);
    return d;
  };
  // Number of wd in (a, b]; negative when b < a.
  const wdBetween = (a, b) => {
    if (a === b) return 0;
    if (b < a) return -wdBetween(b, a);
    let n = 0;
    for (let d = addDays(a, 1); d <= b; d = addDays(d, 1)) if (isWd(d)) n++;
    return n;
  };
  return { isWd, nextWd, prevWd, onOrAfter, addWd, wdBetween };
}
