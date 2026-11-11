// When does a test start and finish, given when its inputs are ready? Same rules as the simulator's solver
// (scripts/generate-world/sim/solve.mjs, spec S2):
//   ready on R -> usable from nextWd(R)
//   start  = first wd >= max(planned start, every usable date) on a rig slot day (null = any wd),
//            with no booking on the rig and the owner in, for the whole run
//   finish = addWd(start, duration - 1)
// Anything unknown or malformed gives {start: null, finish: null, limiter: {..., unknown: true}}: never a guessed date.
import { makeCalendar, dow, toDate } from './calendar.mjs';

const MAX_DAYS_SEARCHED = 600;
const unknown = (limiter) => ({ start: null, finish: null, limiter: { ...limiter, unknown: true } });
// Date ranges given as 'YYYY-MM-DD' or {start, end}; null when a bound is malformed.
const span = (x) => {
  const s = typeof x === 'string' ? { start: toDate(x), end: toDate(x), id: null } : { start: toDate(x?.start), end: toDate(x?.end ?? x?.start), id: x?.id ?? null };
  return s.start && s.end ? s : null;
};
const overlaps = (a, b) => !(a.end < b.start || a.start > b.end);

export function solve({ holidays = [], cal = makeCalendar(holidays), test, inputs = [] }) {
  if (!test) return unknown({ kind: 'test', id: null, reason: 'no test given' });
  const testId = test.id ?? null;
  const dur = test.duration_days;
  const missing = inputs.find((i) => !i.ready);
  if (missing) return unknown({ kind: 'input', id: missing.id });
  if (!(dur >= 1)) return unknown({ kind: 'duration', id: testId });
  const bad = inputs.find((i) => !toDate(i.ready));
  if (bad) return unknown({ kind: 'input', id: bad.id, reason: `ready ${JSON.stringify(bad.ready)} is not a date${typeof bad.ready === 'object' ? ' or a {min <= max} range' : ''}` });

  // The latest of the planned start and every input's usable date; the limiter is whichever set it.
  let base = null;
  let limiter = null;
  if (test.planned_start) {
    base = toDate(test.planned_start);
    if (!base) return unknown({ kind: 'planned_start', id: testId, reason: `planned start ${JSON.stringify(test.planned_start)} is not a date` });
    limiter = { kind: 'planned_start', id: testId };
  }
  for (const i of inputs) {
    const usable = cal.nextWd(toDate(i.ready));
    if (!base || usable > base) { base = usable; limiter = { kind: 'input', id: i.id }; }
  }
  if (!base) return unknown({ kind: 'planned_start', id: testId });

  const bookings = (test.bookings || []).map(span);
  const out = (test.owner_out || []).map(span);
  if (bookings.includes(null)) return unknown({ kind: 'slot', id: 'booking', reason: 'a rig booking has a malformed date' });
  if (out.includes(null)) return unknown({ kind: 'owner_out', id: test.owner ?? null, reason: 'an owner absence has a malformed date' });
  const slots = test.rig_slot_days ?? null;
  const runDays = Math.round(dur) - 1;
  // Why a run starting on d cannot go ahead, or null when it can.
  const blockedBy = (run) => {
    if (slots && !slots.includes(dow(run.start))) return { kind: 'slot', id: 'slot_days' };
    const booking = bookings.find((b) => overlaps(run, b));
    if (booking) return { kind: 'slot', id: booking.id ?? 'booking' };
    if (out.some((o) => overlaps(run, o))) return { kind: 'owner_out', id: test.owner ?? null };
    return null;
  };
  // The limiter becomes whatever turned away the first day we could otherwise have started.
  let d = cal.onOrAfter(base);
  for (let i = 0; i < MAX_DAYS_SEARCHED; i++, d = cal.nextWd(d)) {
    const run = { start: d, end: cal.addWd(d, runDays) };
    const why = blockedBy(run);
    if (!why) return { start: run.start, finish: run.end, limiter };
    if (i === 0) limiter = why;
  }
  return unknown({ kind: 'slot', id: 'none_free' });
}
