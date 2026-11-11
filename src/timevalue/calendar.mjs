// Working-day calendar and date helpers for the maths core. Browser-safe: no imports, no Intl, no host time zone.
//
// addDays, dow and makeCalendar copy scripts/generate-world/lib/calendar.mjs so the UI bundle does not pull in the
// generator's makeCalendar(meta), which needs meta.window. Semantics are identical; timevalue.test.mjs checks them
// against the original.
//
// Dates are 'YYYY-MM-DD'. A working day (wd) is Mon-Fri minus holidays with observance 'full'
// ('worked' and 'partial' days are working days). A malformed date throws a RangeError naming it: nothing here
// rolls "2026-02-31" over into March.

const DAY = 86400e3;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const utc = (date) => Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10));
const fmt = (ms) => new Date(ms).toISOString().slice(0, 10);

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** 'YYYY-MM-DD' from numbers (month 1-based), or null when that day does not exist. */
export function ymd(y, m, d) {
  if (![y, m, d].every(Number.isInteger) || y < 0 || y > 9999 || m < 1 || m > 12 || d < 1 || d > new Date(Date.UTC(y, m, 0)).getUTCDate()) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
/** True for a real calendar day written 'YYYY-MM-DD'. */
export const isDate = (s) => typeof s === 'string' && DATE_RE.test(s) && ymd(+s.slice(0, 4), +s.slice(5, 7), +s.slice(8, 10)) === s;
function parse(date) {
  if (!isDate(date)) throw new RangeError(`not a YYYY-MM-DD date: ${JSON.stringify(date)}`);
  return utc(date);
}

export const addDays = (date, n) => fmt(parse(date) + n * DAY);
export const dow = (date) => new Date(parse(date)).getUTCDay(); // 0 = Sunday ... 6 = Saturday
/** The 'YYYY-MM-DD' day of a date or ISO time as written (no time-zone shift); null when missing or malformed. */
export const toDate = (dateOrIso) => {
  if (dateOrIso == null) return null;
  const d = String(dateOrIso).slice(0, 10);
  return isDate(d) ? d : null;
};
/** "Fri Nov 20" */
export const fmtDay = (date) => {
  const d = new Date(parse(date));
  return `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
};

export function makeCalendar(holidays = []) {
  const closed = new Set((holidays || []).filter((h) => h?.observance === 'full').map((h) => h.date));
  const isWd = (date) => { const d = dow(date); return d !== 0 && d !== 6 && !closed.has(date); };
  const nextWd = (date) => { let d = addDays(date, 1); while (!isWd(d)) d = addDays(d, 1); return d; };
  const prevWd = (date) => { let d = addDays(date, -1); while (!isWd(d)) d = addDays(d, -1); return d; };
  const onOrAfter = (date) => (isWd(date) ? date : nextWd(date));
  // n-th wd after date (n < 0: before; n = 0: the date itself, moved forward to a wd).
  const addWd = (date, n) => {
    if (!Number.isFinite(n)) throw new RangeError(`addWd: not a number of days: ${n}`);
    if (n === 0) return onOrAfter(date);
    let d = date;
    for (let i = 0; i < Math.abs(n); i++) d = n > 0 ? nextWd(d) : prevWd(d);
    return d;
  };
  // Number of wd in (a, b]; negative when b < a.
  const wdBetween = (a, b) => {
    parse(a); parse(b); // a malformed bound would otherwise loop forever on the string comparison below
    if (a === b) return 0;
    if (b < a) return -wdBetween(b, a);
    let n = 0;
    for (let d = addDays(a, 1); d <= b; d = addDays(d, 1)) if (isWd(d)) n++;
    return n;
  };
  return { isWd, nextWd, prevWd, onOrAfter, addWd, wdBetween };
}
