// When does a test start and finish, given when its inputs are ready? Same rules as the simulator's solver
// (scripts/generate-world/sim/solve.mjs, spec S2):
//   ready on R -> usable from nextWd(R)
//   start  = first wd >= max(planned start, every usable date) on a rig slot day (null = any wd),
//            with no booking on the rig and the owner in, for the whole run
//   finish = addWd(start, duration - 1)
import { makeCalendar, dow, toDate } from './calendar.mjs';

// Date ranges given as 'YYYY-MM-DD' or {start, end}.
const span = (x) => (typeof x === 'string' ? { start: x, end: x, id: null } : { start: toDate(x.start), end: toDate(x.end ?? x.start), id: x.id ?? null });
const overlaps = (a, b) => !(a.end < b.start || a.start > b.end);

export function solve({ holidays = [], cal = makeCalendar(holidays), test, inputs = [] }) {
  const dur = test.duration_days;
  const unknown = inputs.find((i) => !i.ready);
  if (unknown) return { start: null, finish: null, limiter: { kind: 'input', id: unknown.id, unknown: true } };
  if (!(dur >= 1)) return { start: null, finish: null, limiter: { kind: 'duration', id: test.id ?? null, unknown: true } };

  let base = null;
  let limiter = null;
  if (test.planned_start) { base = toDate(test.planned_start); limiter = { kind: 'planned_start', id: test.id ?? null }; }
  for (const i of inputs) {
    const usable = cal.nextWd(toDate(i.ready));
    if (!base || usable > base) { base = usable; limiter = { kind: 'input', id: i.id }; }
  }
  if (!base) return { start: null, finish: null, limiter: { kind: 'planned_start', id: test.id ?? null, unknown: true } };

  const slots = test.rig_slot_days ?? null;
  const bookings = (test.bookings || []).map(span);
  const out = (test.owner_out || []).map(span);
  // The limiter is whatever turned away the first day we could otherwise have started.
  let d = cal.onOrAfter(base);
  let first = true;
  for (let guard = 0; guard < 600; guard++, first = false, d = cal.nextWd(d)) {
    const run = { start: d, end: cal.addWd(d, Math.round(dur) - 1) };
    let why = null;
    if (slots && !slots.includes(dow(d))) why = { kind: 'slot', id: 'slot_days' };
    else if (bookings.some((b) => overlaps(run, b))) why = { kind: 'slot', id: bookings.find((b) => overlaps(run, b)).id ?? 'booking' };
    else if (out.some((o) => overlaps(run, o))) why = { kind: 'owner_out', id: test.owner ?? null };
    else return { start: run.start, finish: run.end, limiter };
    if (first) limiter = why;
  }
  return { start: null, finish: null, limiter: { kind: 'slot', id: 'none_free', unknown: true } };
}
