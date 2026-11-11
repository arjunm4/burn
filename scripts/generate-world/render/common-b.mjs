// Shared helpers for the meetings, calendar, xometry and ramp renderers and for checks.
// Pure and deterministic: no clock, no Math.random, no host time zone.
import { pacificOffset } from '../schema.mjs';
import { atLocal } from '../lib/calendar.mjs';
import { textWeeks } from './slack.mjs';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

// Milliseconds for an ISO time with offset, or a date (read as Pacific midnight).
export function toMs(s) {
  if (s == null) return NaN;
  if (DATE_ONLY.test(s)) {
    const guess = Date.parse(`${s}T08:00:00Z`);
    return Date.parse(`${s}T00:00:00${pacificOffset(guess)}`);
  }
  return Date.parse(s);
}

// Our ISO strings are already Pacific local, so the date is the first ten characters.
export const dateOf = (iso) => String(iso).slice(0, 10);

export function addDays(date, n) {
  const d = new Date(Date.parse(`${date}T12:00:00Z`) + n * 86400e3);
  return d.toISOString().slice(0, 10);
}

export const weekday = (date) => new Date(Date.parse(`${date}T12:00:00Z`)).getUTCDay(); // 0 = Sun

export function mondayOf(date) {
  const wd = weekday(date);
  return addDays(date, -((wd + 6) % 7));
}

// Text window start for --weeks N: midnight Pacific on the Monday that starts the first of the N
// Monday-based weeks ending with the demo week (13 -> 2026-08-17T00:00:00-07:00). Same as plan.mjs makeCtx.
export function textStartFor(world, weeks) {
  return atLocal(textWeeks(world.meta.demo_now, weeks)[0], '00:00');
}

export function resolveCtx(world, ctx = {}) {
  const weeks = ctx.weeks ?? ctx.knobs?.weeks_of_context ?? 13;
  return {
    ...ctx,
    weeks,
    demoNow: ctx.demoNow ?? world.meta.demo_now,
    textStart: ctx.textStart ?? textStartFor(world, weeks),
  };
}

// Last history entry known at or before ms.
export function beliefAt(hist, ms) {
  let cur = null;
  for (const h of hist || []) if (toMs(h.known_at) <= ms) cur = h;
  return cur;
}

export const byId = (arr) => new Map((arr || []).map((x) => [x.id, x]));

// "2026-11-20" -> "11/20"
export const md = (date) => {
  const [, m, d] = String(date).slice(0, 10).split('-');
  return `${+m}/${+d}`;
};

export function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// Deterministic UUID v4-shaped id from a label.
export function uuidFrom(label) {
  let hex = '';
  for (let i = 0; hex.length < 32; i++) hex += hash32(`${label}#${i}`).toString(16).padStart(8, '0');
  const c = hex.slice(0, 32).split('');
  c[12] = '4';
  c[16] = ['8', '9', 'a', 'b'][parseInt(c[16], 16) % 4];
  const s = c.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

export const pick = (arr, label) => arr[hash32(label) % arr.length];

export const round2 = (n) => Math.round(n * 100) / 100;

export const json = (v) => JSON.stringify(v, null, 2) + '\n';

export const cmpTimeId = (ta, ia, tb, ib) => (toMs(ta) - toMs(tb)) || (ia < ib ? -1 : ia > ib ? 1 : 0);

export const firstName = (p) => String(p?.name || '').split(' ')[0];

// Working days strictly after a up to and including b (negative if b < a). Full holidays excluded.
export function wdBetween(meta, a, b) {
  const closed = new Set((meta.holidays || []).filter((h) => h.observance === 'full').map((h) => h.date));
  const isWd = (d) => { const w = weekday(d); return w !== 0 && w !== 6 && !closed.has(d); };
  if (a === b) return 0;
  const sign = a < b ? 1 : -1;
  let n = 0;
  let d = a;
  while (d !== b) { d = addDays(d, sign); if (isWd(d)) n += sign; }
  return n;
}
