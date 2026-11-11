// The schedule solver (spec S2 "true schedule" and S9). Dates only; working-day arithmetic through lib/calendar.
//
// A consumer is a test or a work item:
//   { id, type: 'test' | 'work_item', earliest, slotDays | null, duration, units: [rig/resource ids],
//     inputs: [{ id, ready }], milestone | null }
// start = first working day in slotDays (null = any) that is >= max(earliest, addWd(latest input ready, 1))
//         with every unit free for the whole duration; end = addWd(start, duration - 1).
import { dow } from '../lib/calendar.mjs';

const NEG = '0000-00-00';

export function latestReady(inputs, override) {
  let max = NEG;
  let who = null;
  for (const i of inputs) {
    const r = override && i.order && i.order === override.order ? override.ready : i.ready;
    if (r && r > max) { max = r; who = i.id; }
  }
  return { date: max === NEG ? null : max, id: who };
}

// busy: [{ start, end }] date intervals already taken on the consumer's units.
export function solveStart(cal, c, readyDate, busy = []) {
  let d = c.earliest;
  if (readyDate) { const r = cal.addWd(readyDate, 1); if (r > d) d = r; }
  d = cal.onOrAfter(d);
  const dur = Math.max(1, Math.round(c.duration));
  for (let guard = 0; guard < 600; guard++) {
    if (!c.slotDays || c.slotDays.includes(dow(d))) {
      const end = cal.addWd(d, dur - 1);
      let clash = false;
      for (const b of busy) if (!(end < b.start || d > b.end)) { clash = true; break; }
      if (!clash) return { start: d, end: dur === 1 ? d : end };
    }
    d = cal.nextWd(d);
  }
  throw new Error(`solver: no slot for ${c.id}`);
}

// Milestone achieved date from the ends of the tests that feed it.
export function milestoneDate(m, testEnds) {
  if (!testEnds.length || testEnds.some((e) => !e)) return null;
  let d = testEnds.reduce((a, b) => (a > b ? a : b));
  const planned = m.date[0].value;
  if (m.hardness === 'hard') return planned;
  if (m.kind !== 'test' && planned > d) d = planned; // builds, gates, demos and reviews are held on a date
  return d;
}

// Realized schedule. consumers: Map id -> consumer. Work items first (dependency order), then tests greedily
// by (first possible day, id) with capacity 1 per unit. Returns Map id -> { start, end }.
export function solveAll(cal, consumers, skip = new Set()) {
  const out = new Map();
  const visiting = new Set();
  const readyOf = (c) => {
    for (const i of c.inputs) if (i.consumer) { const r = solveWork(consumers.get(i.consumer)); i.ready = r ? r.end : null; }
    return latestReady(c.inputs).date;
  };
  function solveWork(c) {
    if (!c) return null;
    if (out.has(c.id)) return out.get(c.id);
    if (visiting.has(c.id)) throw new Error(`solver: cycle through ${c.id}`);
    visiting.add(c.id);
    const r = solveStart(cal, c, readyOf(c));
    visiting.delete(c.id);
    out.set(c.id, r);
    return r;
  }
  const ids = [...consumers.keys()].sort();
  for (const id of ids) { const c = consumers.get(id); if (c.type === 'work_item' && !skip.has(id)) solveWork(c); }
  const tests = ids.map((id) => consumers.get(id)).filter((c) => c.type === 'test' && !skip.has(c.id));
  const day0 = new Map();
  for (const t of tests) {
    const r = readyOf(t);
    let d = t.earliest;
    if (r && cal.addWd(r, 1) > d) d = cal.addWd(r, 1);
    day0.set(t.id, d);
  }
  tests.sort((a, b) => (day0.get(a.id) < day0.get(b.id) ? -1 : day0.get(a.id) > day0.get(b.id) ? 1 : a.id < b.id ? -1 : 1));
  const busy = new Map();
  for (const t of tests) {
    const taken = t.units.flatMap((u) => busy.get(u) || []);
    const r = solveStart(cal, t, latestReady(t.inputs).date, taken);
    out.set(t.id, r);
    for (const u of t.units) { if (!busy.has(u)) busy.set(u, []); busy.get(u).push({ start: r.start, end: r.end, test: t.id }); }
  }
  return { slots: out, busy };
}

// Re-solve one consumer with one input's ready date overridden (null override = realized; ready null = "at minus infinity").
// Other tests keep their realized slots.
export function resolveOne(cal, c, busy, override) {
  const taken = c.type === 'test' ? c.units.flatMap((u) => (busy.get(u) || []).filter((b) => b.test !== c.id)) : [];
  const lr = latestReady(c.inputs, override);
  return { ...solveStart(cal, c, lr.date, taken), dominating: lr.id };
}
