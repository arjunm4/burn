// Working calendar for the Flintlock world. Pure functions of `meta`; never Intl, toLocale* or the host time zone.
//
// Dates are 'YYYY-MM-DD' strings (Pacific local dates). Times are ISO 8601 with the correct Pacific offset.
//
// Standalone helpers (no meta needed):
//   addDays(date, n)            calendar days
//   daysBetween(a, b)           calendar days from a to b (b - a)
//   dow(date)                   0 = Sunday ... 6 = Saturday
//   weekStart(date)             Monday of the date's week
//   localDate(iso)              Pacific local date of an ISO time ('2026-03-01T09:00:00-08:00' -> '2026-03-01')
//   localMinutes(iso)           minutes after local midnight
//   atLocal(date, 'HH:MM[:SS]') ISO time with the right Pacific offset
//   atLocalMinutes(date, minutes, seconds = 0)
//   addMinutes(iso, minutes)    ISO time shifted by real minutes
//   ms(iso)                     Date.parse
//
// const cal = makeCalendar(meta):
//   cal.isWd(date)              Mon-Fri and not a holiday with observance 'full'
//   cal.nextWd(date)            first wd strictly after date;  cal.prevWd(date) strictly before
//   cal.onOrAfter(date) / cal.onOrBefore(date)   nearest wd, the date itself if it is one
//   cal.addWd(date, n)          the n-th wd after date (n < 0: before; n = 0: date itself, moved forward to a wd)
//   cal.wdBetween(a, b)         number of wd in (a, b]; negative when b < a. wdBetween(d, addWd(d, n)) === n
//   cal.holiday(date)           holiday record or null
//   cal.dayActivity(date)       0 closed, 0.5 partial holiday, 1 normal (weekends 0)
//   cal.weekStarts              every Monday from the window start's week to the window end's week
//   cal.weekOf(date)            its week_start
//   cal.wdsOfWeek(week_start)   wd dates in that week that fall inside the window
//   cal.windowStart / cal.windowEnd / cal.horizon / cal.demoNow   (dates; demoNow also as cal.demoNowIso)
//   cal.inWindow(iso)           time is within meta.window
//   cal.clampToWindow(iso)      latest allowed time if past the window end
//   cal.buildWeeks(milestones)  -> meta.weeks [{week_start, activity, kind}] from build milestones (S1)
//   cal.weekKind(date)          kind of that week once meta.weeks exists (default 'normal')
//   cal.weekActivity(date)
//   cal.sampleTime(rng, date, {burst})   a human timestamp on that date following the S1 hour shape
//   cal.sampleBusinessTime(rng, date)    a timestamp between 08:30 and 17:30
//   cal.orderDay(rng, week_start)        a date in that week following the order-weekday mix
import { pacificOffset, toPacificIso } from '../schema.mjs';

const DAY = 86400e3;

function parseDate(date) {
  return Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10));
}
function fmtDate(utcMs) {
  return new Date(utcMs).toISOString().slice(0, 10);
}

export function addDays(date, n) { return fmtDate(parseDate(date) + n * DAY); }
export function daysBetween(a, b) { return Math.round((parseDate(b) - parseDate(a)) / DAY); }
export function dow(date) { return new Date(parseDate(date)).getUTCDay(); }
export function weekStart(date) { return addDays(date, -((dow(date) + 6) % 7)); }
export function ms(iso) { return Date.parse(iso); }
export function localDate(iso) { return iso.slice(0, 10); }
export function localMinutes(iso) { return +iso.slice(11, 13) * 60 + +iso.slice(14, 16); }

export function atLocalMinutes(date, minutes, seconds = 0) {
  const base = parseDate(date) + minutes * 60e3 + seconds * 1e3;
  // Local wall time -> UTC: try both offsets, keep the one that is self-consistent.
  for (const h of [8, 7]) {
    const utc = base + h * 3600e3;
    if (pacificOffset(utc) === (h === 8 ? '-08:00' : '-07:00')) return toPacificIso(utc);
  }
  return toPacificIso(base + 8 * 3600e3);
}
export function atLocal(date, hhmm = '00:00') {
  const [h, m, s] = hhmm.split(':').map(Number);
  return atLocalMinutes(date, h * 60 + (m || 0), s || 0);
}
export function addMinutes(iso, minutes) { return toPacificIso(Date.parse(iso) + Math.round(minutes * 60) * 1e3); }
export function addSeconds(iso, seconds) { return toPacificIso(Date.parse(iso) + Math.round(seconds) * 1e3); }

// Share of a day's human activity per block (S1). [startMinute, endMinute, weight, burstWeight]
const HOUR_SHAPE = [
  [6 * 60, 8 * 60, 2, 2],
  [8 * 60, 9 * 60, 5, 5],
  [9 * 60, 12 * 60, 34, 34],
  [12 * 60, 13 * 60, 7, 7],
  [13 * 60, 17 * 60, 36, 36],
  [17 * 60, 18 * 60 + 30, 10, 10],
  [18 * 60 + 30, 20 * 60, 3, 3],
  [20 * 60, 23 * 60, 3, 6],
];
const ORDER_DOW = { 1: 19, 2: 21, 3: 20, 4: 22, 5: 17, 6: 0.5, 0: 0.5 };

export function makeCalendar(meta) {
  const holidays = new Map((meta.holidays || []).map((h) => [h.date, h]));
  const windowStart = localDate(meta.window.start);
  const windowEnd = localDate(meta.window.end);
  const horizon = meta.sim_horizon || windowEnd;
  const winStartMs = Date.parse(meta.window.start);
  const winEndMs = Date.parse(meta.window.end);

  const isWd = (date) => {
    const d = dow(date);
    if (d === 0 || d === 6) return false;
    const h = holidays.get(date);
    return !(h && h.observance === 'full');
  };
  const nextWd = (date) => { let d = addDays(date, 1); while (!isWd(d)) d = addDays(d, 1); return d; };
  const prevWd = (date) => { let d = addDays(date, -1); while (!isWd(d)) d = addDays(d, -1); return d; };
  const onOrAfter = (date) => (isWd(date) ? date : nextWd(date));
  const onOrBefore = (date) => (isWd(date) ? date : prevWd(date));
  const addWd = (date, n) => {
    let d = date;
    if (n === 0) return onOrAfter(d);
    if (n > 0) for (let i = 0; i < n; i++) d = nextWd(d);
    else for (let i = 0; i < -n; i++) d = prevWd(d);
    return d;
  };
  const wdBetween = (a, b) => {
    if (a === b) return 0;
    if (b < a) return -wdBetween(b, a);
    let n = 0;
    for (let d = addDays(a, 1); d <= b; d = addDays(d, 1)) if (isWd(d)) n++;
    return n;
  };
  const holiday = (date) => holidays.get(date) || null;
  const dayActivity = (date) => {
    if (!isWd(date)) return 0;
    const h = holidays.get(date);
    return h && h.observance === 'partial' ? 0.5 : 1;
  };

  const weekStarts = [];
  for (let w = weekStart(windowStart); w <= windowEnd; w = addDays(w, 7)) weekStarts.push(w);
  const wdsOfWeek = (ws) => {
    const out = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(ws, i);
      if (d >= windowStart && d <= windowEnd && isWd(d)) out.push(d);
    }
    return out;
  };

  let weekIndex = new Map((meta.weeks || []).map((w) => [w.week_start, w]));
  const weekRec = (date) => weekIndex.get(weekStart(date));

  // S1: quiet = the 3 Jul week and the week after each build milestone; burst = burst_weeks before each build
  // milestone (the build week itself is the last burst week); burst wins over quiet.
  const buildWeeks = (milestones, k = {}) => {
    const burstMult = k.burst_mult ?? 2.55;
    const quietMult = k.quiet_mult ?? 0.4;
    const kind = new Map(weekStarts.map((w) => [w, 'normal']));
    const builds = (milestones || []).filter((m) => m.kind === 'build');
    const dateOf = (m) => (Array.isArray(m.date) ? m.date[0].value : m.date);
    for (const h of holidays.values()) {
      if (h.observance === 'full' && h.date.slice(5) === '07-03' && kind.has(weekStart(h.date))) kind.set(weekStart(h.date), 'quiet');
    }
    for (const m of builds) {
      const after = addDays(weekStart(dateOf(m)), 7);
      if (kind.has(after)) kind.set(after, 'quiet');
    }
    for (const m of builds) {
      const n = m.burst_weeks ?? 2;
      for (let i = 0; i < n; i++) {
        const w = addDays(weekStart(dateOf(m)), -7 * i);
        if (kind.has(w)) kind.set(w, 'burst');
      }
    }
    const weeks = weekStarts.map((w) => ({
      week_start: w,
      activity: kind.get(w) === 'burst' ? burstMult : kind.get(w) === 'quiet' ? quietMult : 1,
      kind: kind.get(w),
    }));
    weekIndex = new Map(weeks.map((w) => [w.week_start, w]));
    return weeks;
  };

  const sampleTime = (rng, date, opts = {}) => {
    const burst = opts.burst ?? (weekRec(date)?.kind === 'burst');
    const block = rng.weighted(HOUR_SHAPE, HOUR_SHAPE.map((b) => (burst ? b[3] : b[2])));
    const minute = rng.int(block[0], block[1] - 1);
    return atLocalMinutes(date, minute, rng.int(0, 59));
  };
  const sampleBusinessTime = (rng, date, from = 8 * 60 + 30, to = 17 * 60 + 30) =>
    atLocalMinutes(date, rng.int(from, to - 1), rng.int(0, 59));
  const orderDay = (rng, ws) => {
    const days = [];
    const weights = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(ws, i);
      if (d < windowStart || d > windowEnd) continue;
      const wd = dow(d);
      if (wd >= 1 && wd <= 5 && !isWd(d)) continue;
      let w = ORDER_DOW[wd] * (wd >= 1 && wd <= 5 ? dayActivity(d) : 1);
      // Thu/Fri before a closed day: x1.4
      const nxt = addDays(d, 1);
      const nxt2 = addDays(d, 2);
      const closed = (x) => holidays.get(x)?.observance === 'full';
      if (wd >= 1 && wd <= 5 && (closed(nxt) || closed(nxt2) || (wd === 5 && closed(addDays(d, 3))))) w *= 1.4;
      days.push(d);
      weights.push(w);
    }
    return days.length ? rng.weighted(days, weights) : onOrAfter(ws);
  };

  return {
    isWd, nextWd, prevWd, onOrAfter, onOrBefore, addWd, wdBetween, holiday, dayActivity,
    weekStarts, weekOf: weekStart, wdsOfWeek,
    windowStart, windowEnd, horizon,
    demoNow: localDate(meta.demo_now || meta.window.end), demoNowIso: meta.demo_now || meta.window.end,
    inWindow: (iso) => { const t = Date.parse(iso); return t >= winStartMs && t <= winEndMs; },
    clampToWindow: (iso) => { const t = Date.parse(iso); return t > winEndMs ? meta.window.end : t < winStartMs ? meta.window.start : iso; },
    buildWeeks,
    weekKind: (date) => weekRec(date)?.kind || 'normal',
    weekActivity: (date) => weekRec(date)?.activity ?? 1,
    sampleTime, sampleBusinessTime, orderDay,
  };
}
