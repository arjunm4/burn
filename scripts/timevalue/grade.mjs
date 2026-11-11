// Grading for Time Value (docs/build/time-value-impl.md, "scripts/timevalue/grade.mjs (G)").
// The only Burn script besides export-settings that may read fixtures/world/: it holds the answer key.
//
//   node scripts/timevalue/grade.mjs [--world fixtures/world] [--sources fixtures/flintlock] [--out fixtures/timevalue]
//
// Writes <out>/grading.json and prints a short summary. Every part grades whatever exists:
// a module or output that has not landed yet is reported as { available: false, reason }.
//
// 1. Engine exact: true inputs from world.json -> A's solve/compare -> test_start, gated_date, days_gained
//    against answers.tier_outcomes (simulation-spec S2, S9).
// 2. Habit: habit-model.json accuracy vs never-expedite and the need-by rule, 95% interval.
// 3. Wasted expedites: expedited orders with expedite_helped = false; how many Burn's graphAt(T) + compare catches.
// 4. Graph recall by edges.reveal; Ramp <-> Xometry link rate.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeCalendar, localDate } from '../generate-world/lib/calendar.mjs';
import { milestoneDate } from '../generate-world/sim/solve.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TIER_ORDER = ['economy', 'international_economy', 'standard', 'expedite'];

// ---------- helpers ----------

export function parseArgs(argv) {
  const a = { world: 'fixtures/world', sources: 'fixtures/flintlock', out: 'fixtures/timevalue' };
  for (let i = 0; i < argv.length; i++) {
    const m = /^--(world|sources|out)$/.exec(argv[i]);
    if (m) a[m[1]] = argv[++i];
  }
  for (const k of Object.keys(a)) a[k] = resolve(ROOT, a[k]);
  return a;
}

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const errText = (e) => String(e?.message || e).split('\n')[0];

// Import a module if its file exists. -> { mod } | { mod: null, reason }
export async function tryImport(rel) {
  const p = join(ROOT, rel);
  if (!existsSync(p)) return { mod: null, reason: `${rel} not available yet` };
  try { return { mod: await import(pathToFileURL(p).href) }; } catch (e) { return { mod: null, reason: `${rel} failed to load: ${errText(e)}` }; }
}

// Wilson score interval, 95%.
export function wilson(k, n, z = 1.96) {
  if (!n) return null;
  const p = k / n;
  const den = 1 + (z * z) / n;
  const mid = (p + (z * z) / (2 * n)) / den;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
  return [round(Math.max(0, mid - half), 3), round(Math.min(1, mid + half), 3)];
}
const round = (x, d = 3) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);
const money = (x) => Math.round(x * 100) / 100;
const dateOf = (x) => (x == null ? null : typeof x === 'string' ? x.slice(0, 10) : x);

// ---------- 1. engine exact: build the true cases ----------

// One case per Xometry order whose consumer is a test (primary) or an order-specific work item (secondary).
// Each case carries the inputs A's solve/compare take and the expected outcome per tier from answers.json.
export function buildEngineCases(world, answers) {
  const cal = makeCalendar(world.meta);
  const ans = new Map(answers.orders.map((a) => [a.order, a]));
  const tests = new Map(world.tests.map((t) => [t.id, t]));
  const wis = new Map(world.work_items.map((w) => [w.id, w]));
  const dls = new Map(world.deliverables.map((d) => [d.id, d]));
  const parts = new Set(world.parts.map((p) => p.id));
  const units = new Map([...world.test_rigs, ...world.resources].map((u) => [u.id, u]));
  const people = new Map(world.people.map((p) => [p.id, p]));
  const milestones = new Map(world.milestones.map((m) => [m.id, m]));
  const xo = world.orders.filter((o) => o.type === 'xometry_cnc');
  const edgesTo = new Map();
  for (const e of world.edges) { if (!edgesTo.has(e.to)) edgesTo.set(e.to, []); edgesTo.get(e.to).push(e); }
  const chosenReady = (o) => {
    const a = ans.get(o.id);
    return a?.tier_outcomes.find((t) => t.tier === o.chosen_tier)?.ready_date ?? (o.ready_at ? localDate(o.ready_at) : null);
  };
  // The order whose parts gate a test's part input: the simulator keeps the last order placed for that part
  // and that test (orders are created in id order), so an earlier order for the same part no longer gates.
  const gatingOrder = new Map(); // `${test}|${part}` -> order
  for (const o of xo.slice().sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (!o.feeds_test || o.feeds_work_item || o.cancelled) continue; // a work item's order sets no test input
    for (const l of o.lines) gatingOrder.set(`${o.feeds_test}|${l.part}`, o);
  }
  const pinned = new Set([world.demo?.test, world.demo?.milestone].filter(Boolean));

  const cases = [];
  const skipped = [];
  for (const o of xo) {
    const a = ans.get(o.id);
    if (!a?.tier_outcomes?.length) { skipped.push({ order: o.id, reason: 'no tier_outcomes' }); continue; }
    const base = o.tiers.some((t) => t.tier === 'economy') ? 'economy' : 'standard';
    const tiers = o.tiers.map((t) => {
      const exp = a.tier_outcomes.find((x) => x.tier === t.tier);
      return { tier: t.tier, total: t.total_usd, ready: exp.ready_date, expected: { test_start: exp.test_start ?? null, gated_date: exp.gated_date ?? null, days_gained: exp.days_gained } };
    });
    // An order placed for a work item names the test that work item prepares for in feeds_test too, but its
    // consumer in the simulator (orders.mjs: consumer = wi) is the work item: only structural orders (no work
    // item) are inputs of the test itself.
    if (o.feeds_test && !o.feeds_work_item && tests.has(o.feeds_test)) {
      const t = tests.get(o.feeds_test);
      if (pinned.has(t.id) || pinned.has(t.milestone)) { skipped.push({ order: o.id, reason: `feeds the pinned demo test ${t.id}` }); continue; }
      const us = [t.rig, ...(t.resources || [])].filter(Boolean);
      let slot = null;
      for (const u of us) { const sd = units.get(u)?.slot_days; if (sd?.length) slot = slot ? slot.filter((x) => sd.includes(x)) : sd.slice(); }
      if (slot && !slot.length) slot = null;
      const bookings = [];
      for (const u of us) for (const b of units.get(u)?.bookings || []) {
        // The truth (sim/solve.mjs) is blocked only by other tests' realized runs: confirmed bookings with a test.
        // Ad hoc or tentative holds (e.g. a double-booking with conflict_with) do not move a true start.
        if (!b.test || b.test === t.id || b.status !== 'confirmed') continue;
        bookings.push({ id: b.id, unit: u, test: b.test ?? null, start: localDate(b.start), end: localDate(b.end) });
      }
      bookings.sort((x, y) => (x.start < y.start ? -1 : x.start > y.start ? 1 : x.id < y.id ? -1 : 1));
      const owner = people.get(t.owner);
      const inputs = [];
      const mine = [];
      for (const e of edgesTo.get(t.id) || []) {
        const id = e.from;
        if (units.has(id)) continue;
        if (dls.has(id)) inputs.push({ id, kind: 'deliverable', ready: dls.get(id).true_arrival ?? null });
        else if (wis.has(id)) inputs.push({ id, kind: 'work_item', ready: wis.get(id).actual_done ? localDate(wis.get(id).actual_done) : null });
        else if (parts.has(id)) {
          const g = gatingOrder.get(`${t.id}|${id}`);
          if (!g) continue; // never ordered for this test: no constraint in the truth (an engine would call it unknown)
          else if (g.id === o.id) mine.push(id);
          else inputs.push({ id, kind: 'part', order: g.id, ready: chosenReady(g) });
        }
      }
      const m = t.milestone ? milestones.get(t.milestone) : null;
      const feeders = m ? world.tests.filter((x) => x.milestone === m.id && x.id !== t.id).map((x) => ({ id: x.id, end: x.actual_end ? localDate(x.actual_end) : null })) : [];
      cases.push({
        order: o.id, kind: 'test', consumer: t.id, base, chosen_tier: o.chosen_tier, placed: localDate(o.placed_at),
        order_parts: mine, // empty = a later order for the same parts gates the test, so every tier lands the same
        test: {
          planned_start: t.earliest_start ?? t.planned_date[0].value, duration_days: Math.max(1, Math.round(t.duration_true_days)),
          // The simulator does not model owner out-of-office, so grading against it passes none; the owner's
          // outages ride along (owner_ooo) only to explain a mismatch from an engine that is fed them.
          rig_slot_days: slot, bookings, owner_out: [], owner: t.owner,
        },
        owner_ooo: (owner?.ooo || []).map((x) => ({ start: x.start, end: x.end })),
        inputs, tiers,
        milestone: m ? { id: m.id, target: m.date[0].value, hardness: m.hardness, kind: m.kind, policy: null, feeders } : null,
        _m: m,
      });
    } else if (o.feeds_work_item && wis.has(o.feeds_work_item)) {
      // Work items: the simulator's earliest start is not stored in world.json. The start with this order's
      // parts at minus infinity is answers.true_need_date + 1 wd; it already folds in the earliest start,
      // the slot day and every sibling input, so it is the planned start (exact by S9.4).
      const w = wis.get(o.feeds_work_item);
      if (!a.true_need_date) { skipped.push({ order: o.id, reason: 'work item without true_need_date' }); continue; }
      const unit = (w.blocked_by || []).map((x) => units.get(x)).find(Boolean);
      const inputs = (w.blocked_by || []).filter((x) => dls.has(x)).map((id) => ({ id, kind: 'deliverable', ready: dls.get(id).true_arrival ?? null }));
      cases.push({
        order: o.id, kind: 'work_item', consumer: w.id, base, chosen_tier: o.chosen_tier, placed: localDate(o.placed_at), order_parts: o.lines.map((l) => l.part),
        test: { planned_start: cal.addWd(a.true_need_date, 1), duration_days: Math.max(1, Math.round(w.duration_true_days)), rig_slot_days: unit?.slot_days?.length ? unit.slot_days.slice() : null, bookings: [], owner_out: [], owner: w.owner },
        inputs, tiers, milestone: null,
      });
    } else skipped.push({ order: o.id, reason: 'feeds nothing (all gains 0)' });
  }
  return { cases, skipped, cal, holidays: world.meta.holidays || [] };
}

// Milestone date from this test's finish and the other feeders' realized ends (S2: soft moves, hard keeps its
// date, builds/gates/demos/reviews are held on their date).
function gatedFrom(c, finish) {
  if (c.kind !== 'test' || !c._m) return finish;
  const ends = [finish, ...c.milestone.feeders.map((f) => f.end)];
  return milestoneDate(c._m, ends);
}

const tierRank = (t) => { const i = TIER_ORDER.indexOf(t); return i < 0 ? 99 : i; };

// Pull a single finish date out of compare's finish_by_scenario (object, array or date).
function scenarioFinish(f) {
  if (f == null) return null;
  if (typeof f === 'string') return dateOf(f);
  if (Array.isArray(f)) { const x = f[0]; return x == null ? null : typeof x === 'string' ? dateOf(x) : dateOf(x.finish ?? x.date ?? x.value); }
  if (typeof f === 'object') { const vals = Object.values(f); return vals.length ? scenarioFinish(vals[0]) : null; }
  return null;
}

// Why an engine answer differs from the truth. Rules (impl.md, A): ready on R -> usable nextWd(R);
// start = first wd >= max(planned start, usable dates) on a slot day, with no booking over the whole run;
// finish = addWd(start, duration - 1). The simulator does not model owner out-of-office.
export function diagnose(cal, c, tierReady, got, exp) {
  const why = [];
  const t = c.test;
  const readies = [...c.inputs.map((i) => i.ready), tierReady].filter(Boolean).sort();
  const lastReady = readies[readies.length - 1] || null;
  const usable = lastReady ? cal.addWd(lastReady, 1) : null;
  const dow = (d) => new Date(`${d}T12:00:00Z`).getUTCDay();
  if (got.error) return [`engine threw: ${got.error}`];
  if (!got.start) return ['engine returned no start date'];
  if (exp.test_start && got.start !== exp.test_start) {
    if (got.start < exp.test_start) {
      if (usable && got.start < usable) why.push(`starts ${got.start}, before the last input is usable (${lastReady} ready -> usable ${usable}; ready on R is usable from nextWd(R))`);
      if (got.start < t.planned_start) why.push(`starts before planned_start ${t.planned_start}`);
      if (t.rig_slot_days && !t.rig_slot_days.includes(dow(got.start))) why.push(`starts on weekday ${dow(got.start)}, outside rig_slot_days [${t.rig_slot_days}]`);
      if (!cal.isWd(got.start)) why.push(`starts on a non-working day ${got.start} (weekend or full holiday)`);
      const gotEnd = cal.addWd(got.start, t.duration_days - 1);
      const clash = t.bookings.find((b) => !(gotEnd < b.start || got.start > b.end));
      if (clash) why.push(`run ${got.start}..${gotEnd} overlaps booking ${clash.id} (${clash.start}..${clash.end}); a booking blocks every day of the run, not just the start day`);
    } else {
      const ooo = [...t.owner_out, ...(c.owner_ooo || [])].find((x) => !(cal.addWd(exp.test_start, t.duration_days - 1) < x.start || exp.test_start > x.end));
      if (ooo) why.push(`owner out ${ooo.start}..${ooo.end} pushed the start; the simulator's truth does not model owner out-of-office`);
      const expEnd = cal.addWd(exp.test_start, t.duration_days - 1);
      const near = t.bookings.find((b) => b.end === exp.test_start || b.start === expEnd || cal.addWd(b.end, 1) === exp.test_start);
      if (near) why.push(`true start ${exp.test_start} touches booking ${near.id} (${near.start}..${near.end}); bookings are inclusive date ranges and a run may start the wd after one ends`);
      if (usable && got.start === cal.addWd(usable, 1)) why.push('one wd late: usable date counted as addWd(R, 2) or ready treated as end of next day');
      if (t.rig_slot_days && !t.rig_slot_days.includes(dow(got.start))) why.push(`starts outside rig_slot_days [${t.rig_slot_days}]`);
      if (!why.length) why.push(`starts ${got.start}, later than the first feasible day ${exp.test_start}`);
    }
  }
  const expFinish = exp.test_start ? cal.addWd(exp.test_start, t.duration_days - 1) : null;
  if (got.start === exp.test_start && got.finish && expFinish && got.finish !== expFinish) {
    why.push(`finish ${got.finish} != addWd(start, duration - 1) = ${expFinish} (duration ${t.duration_days})`);
  }
  if (got.compare_finish && expFinish && got.compare_finish !== expFinish) why.push(`compare finish ${got.compare_finish} != solve/true finish ${expFinish}`);
  if (got.compare_days_saved != null && got.expected_days_saved != null && got.compare_days_saved !== got.expected_days_saved) {
    why.push(`compare days_saved ${got.compare_days_saved} != ${got.expected_days_saved} (working days between this tier's finish and the cheapest tier's)`);
  }
  if (!why.length && got.gated_date !== exp.gated_date) why.push(`gated_date ${got.gated_date} != ${exp.gated_date} with the same start (milestone rule)`);
  if (!why.length && got.days_gained !== exp.days_gained) why.push(`days_gained ${got.days_gained} != ${exp.days_gained}`);
  return why;
}

// engine = { solve, compare? }. Exact = every tier's start, gated date and days gained match.
export function gradeEngine(built, engine) {
  const { cases, skipped, cal } = built;
  const groups = { test: { orders: 0, exact: 0, rows: 0, rows_exact: 0 }, work_item: { orders: 0, exact: 0, rows: 0, rows_exact: 0 } };
  const mismatches = [];
  let checkedCompare = 0;
  const holidays = engineHolidays(built);
  for (const c of cases) {
    const g = groups[c.kind];
    g.orders++;
    const got = {};
    for (const tr of c.tiers) {
      const inputs = [...c.inputs.map(({ id, ready }) => ({ id, ready })), ...(c.order_parts.length ? [{ id: c.order, ready: tr.ready }] : [])];
      try {
        const r = engine.solve({ holidays, test: c.test, inputs });
        got[tr.tier] = { start: dateOf(r?.start), finish: dateOf(r?.finish), limiter: r?.limiter ?? null };
      } catch (e) { got[tr.tier] = { error: errText(e) }; }
    }
    let cmp = null;
    if (engine.compare) {
      try {
        cmp = engine.compare({
          // A superseded order's parts gate nothing: give compare a ready date that never binds.
          holidays, quote: c.tiers.map((t) => ({ tier: t.tier, total: t.total, ready: c.order_parts.length ? t.ready : cal.addWd(c.test.planned_start, -1) })),
          test: c.test, inputs: c.inputs.map(({ id, ready }) => ({ id, ready })),
          milestone: { target: c.milestone?.target ?? null, policy: null }, now: c.placed,
        });
      } catch (e) { cmp = { error: errText(e) }; }
    }
    const cheapest = c.tiers.slice().sort((a, b) => tierRank(a.tier) - tierRank(b.tier))[0].tier;
    for (const tr of c.tiers) {
      const r = got[tr.tier];
      if (!r.error) r.gated_date = r.finish ? gatedFrom(c, r.finish) : null;
    }
    let orderExact = true;
    for (const tr of c.tiers) {
      g.rows++;
      const r = got[tr.tier];
      const exp = tr.expected;
      if (!r.error) {
        const gb = got[c.base]?.gated_date;
        r.days_gained = r.gated_date && gb ? Math.max(0, cal.wdBetween(r.gated_date, gb)) : 0;
        if (cmp && !cmp.error) {
          const ct = (cmp.tiers || []).find((x) => x.tier === tr.tier);
          r.compare_finish = ct ? scenarioFinish(ct.finish_by_scenario) : null;
          if (r.compare_finish) checkedCompare++;
          r.compare_days_saved = ct && typeof ct.days_saved === 'number' ? ct.days_saved : ct && ct.days_saved && typeof ct.days_saved === 'object' ? Object.values(ct.days_saved)[0] : null;
          const fe = exp.test_start ? cal.addWd(exp.test_start, c.test.duration_days - 1) : null;
          const fc = c.tiers.find((x) => x.tier === cheapest).expected.test_start;
          r.expected_days_saved = fe && fc ? Math.max(0, cal.wdBetween(fe, cal.addWd(fc, c.test.duration_days - 1))) : null;
        }
      }
      const ok = !r.error && r.start === exp.test_start && r.gated_date === exp.gated_date && r.days_gained === exp.days_gained
        && (!cmp || cmp.error || ((r.compare_finish == null || r.compare_finish === cal.addWd(exp.test_start, c.test.duration_days - 1))
          && (r.compare_days_saved == null || r.compare_days_saved === r.expected_days_saved)));
      if (ok) { g.rows_exact++; continue; }
      orderExact = false;
      mismatches.push({
        order: c.order, kind: c.kind, consumer: c.consumer, tier: tr.tier, ready: tr.ready,
        expected: exp, got: { start: r.start ?? null, finish: r.finish ?? null, gated_date: r.gated_date ?? null, days_gained: r.days_gained ?? null, limiter: r.limiter ?? null, error: r.error, compare_finish: r.compare_finish, compare_days_saved: r.compare_days_saved },
        reasons: (() => {
          const why = diagnose(cal, c, tr.ready, r, exp);
          const b = c.tiers.find((x) => x.tier === c.base);
          if (tr.tier !== c.base && r.start === exp.test_start && got[c.base]?.start !== b.expected.test_start) {
            return [`knock-on: this tier is right, but the cheapest tier (${c.base}) starts ${got[c.base]?.start ?? 'nowhere'} instead of ${b.expected.test_start}, so the days gained are off (see that row)`];
          }
          return why;
        })(),
        inputs: { test: c.test, inputs: c.inputs, order_parts: c.order_parts },
      });
    }
    if (cmp?.error) mismatches.push({ order: c.order, kind: c.kind, consumer: c.consumer, tier: null, reasons: [`compare threw: ${cmp.error}`] });
    if (orderExact && !cmp?.error) g.exact++;
  }
  const share = (g) => (g.orders ? round(g.exact / g.orders, 4) : null);
  const all = { orders: groups.test.orders + groups.work_item.orders, exact: groups.test.exact + groups.work_item.exact };
  const causes = {};
  for (const m of mismatches) for (const r of m.reasons) { const key = r.replace(/\d{4}-\d{2}-\d{2}/g, 'D').replace(/bk-\d+/g, 'bk').replace(/-?\d+(\.\d+)?/g, 'N'); causes[key] = (causes[key] || 0) + 1; }
  const compareRows = mismatches.length + groups.test.rows_exact + groups.work_item.rows_exact;
  return {
    available: true, target: 0.95, compare_rows_checked: checkedCompare, rows_total: compareRows,
    test_fed: { ...groups.test, exact_share: share(groups.test), meets_target: share(groups.test) != null && share(groups.test) >= 0.95 },
    work_item_fed: { ...groups.work_item, exact_share: share(groups.work_item), note: 'planned start = true_need_date + 1 wd (work-item earliest start is not stored in world.json)' },
    all: { ...all, exact_share: all.orders ? round(all.exact / all.orders, 4) : null },
    compare_checked: !!engine.compare,
    mismatch_causes: Object.entries(causes).sort((a, b) => b[1] - a[1]).map(([cause, n]) => ({ cause, n })),
    mismatches, skipped,
  };
}

function engineHolidays(built) { return built.holidays || []; }

export async function loadEngine() {
  const idx = await tryImport('src/timevalue/index.mjs');
  let solve = idx.mod?.solve;
  let compare = idx.mod?.compare;
  const reasons = idx.mod ? [] : [idx.reason];
  if (!solve) { const s = await tryImport('src/timevalue/solve.mjs'); solve = s.mod?.solve; if (!s.mod) reasons.push(s.reason); }
  if (!compare) { const c = await tryImport('src/timevalue/compare.mjs'); compare = c.mod?.compare; if (!c.mod) reasons.push(c.reason); }
  if (typeof solve !== 'function') return { engine: null, reason: reasons.join('; ') || 'src/timevalue has no solve export' };
  return { engine: { solve, compare: typeof compare === 'function' ? compare : null }, reason: compare ? null : 'compare not available yet; solve graded alone' };
}

// ---------- 2. habit ----------

const isExp = (o) => o.chosen_tier === 'expedite';
const needRule = (o) => { const std = o.tiers.find((t) => t.tier === 'standard'); return !!(o.need_by_believed && std && std.est_delivery > o.need_by_believed); };

// The habit test set: the model's own list when it gives one, else the newest 30% of usable orders by T
// (usable = T >= text start + 30 days, from answers.summary.usable_orders.from, and a Ramp card charge).
export function habitTestSet(world, answers, model) {
  const xo = world.orders.filter((o) => o.type === 'xometry_cnc');
  const ids = model?.test_orders || model?.test_order_numbers || model?.test_ids;
  if (Array.isArray(ids) && ids.length) {
    const want = new Set(ids.map((x) => (typeof x === 'string' ? x : x.order_number || x.order || x.id)));
    return { orders: xo.filter((o) => want.has(o.id) || want.has(o.order_number)), from: 'habit-model.json test list' };
  }
  const from = answers.summary?.usable_orders?.from;
  const charged = new Set((world.ramp_transactions || []).filter((t) => t.kind === 'charge' && t.order).map((t) => t.order));
  const usable = xo.filter((o) => (!from || localDate(o.placed_at) >= from) && charged.has(o.id)).sort((a, b) => Date.parse(a.placed_at) - Date.parse(b.placed_at) || (a.id < b.id ? -1 : 1));
  const nTest = Math.round(usable.length * 0.3);
  return { orders: usable.slice(usable.length - nTest), from: `newest 30% of ${usable.length} usable orders (T >= ${from})` };
}

export function gradeHabit(world, answers, model) {
  const { orders, from } = habitTestSet(world, answers, model);
  const n = orders.length;
  const never = orders.filter((o) => !isExp(o)).length;
  const rule = orders.filter((o) => needRule(o) === isExp(o)).length;
  const baselines = {
    test_set: from, n_test_set: n,
    never_expedite: { accuracy: n ? round(never / n) : null, ci95: wilson(never, n) },
    need_by_rule: { accuracy: n ? round(rule / n) : null, ci95: wilson(rule, n), note: 'expedite iff Standard est_delivery > need_by_believed' },
    need_by_rule_answers_summary: answers.summary?.probe?.days_to_need_rule_accuracy ?? null,
  };
  if (!model) return { available: false, reason: 'fixtures/timevalue/habit-model.json not available yet', baselines };
  const acc = typeof model.accuracy === 'number' ? model.accuracy : null;
  const nT = model.n_test ?? null;
  const ci = model.accuracy_ci95 || (acc != null && nT ? wilson(Math.round(acc * nT), nT) : null);
  return {
    available: acc != null, reason: acc == null ? 'habit-model.json has no accuracy' : undefined,
    accuracy: round(acc), n_train: model.n_train ?? null, n_test: nT, ci95: ci, lambda: model.lambda ?? null,
    model_baseline_never_expedite: model.baseline_never_expedite ?? null,
    vs_never_expedite: acc != null && baselines.never_expedite.accuracy != null ? round(acc - baselines.never_expedite.accuracy) : null,
    vs_need_by_rule: acc != null ? round(acc - (answers.summary?.probe?.days_to_need_rule_accuracy ?? NaN)) : null,
    baselines,
  };
}

// ---------- 3. wasted expedites ----------

export function wastedExpedites(world, answers) {
  const ans = new Map(answers.orders.map((a) => [a.order, a]));
  const xo = world.orders.filter((o) => o.type === 'xometry_cnc');
  // Orders feeding the pinned demo test have no outcome yet (gated_date null), so they are not counted.
  const demoTest = world.demo?.test;
  const exp = xo.filter((o) => o.chosen_tier === 'expedite' && !(demoTest && o.feeds_test === demoTest));
  const wasted = exp.filter((o) => ans.get(o.id)?.expedite_helped === false);
  const prem = (o) => o.total_usd - (o.tiers.find((t) => t.tier === 'standard')?.total_usd ?? o.total_usd);
  return {
    expedited: exp.length,
    count: wasted.length,
    premium_usd: money(wasted.reduce((s, o) => s + prem(o), 0)),
    total_usd: money(wasted.reduce((s, o) => s + o.total_usd, 0)),
    by_reason: wasted.reduce((m, o) => { const r = ans.get(o.id).hidden_reason; m[r] = (m[r] || 0) + 1; return m; }, {}),
    orders: wasted.map((o) => ({ order: o.id, order_number: o.order_number, placed_at: o.placed_at, premium_usd: money(prem(o)), hidden_reason: ans.get(o.id).hidden_reason, dominating_input: ans.get(o.id).dominating_input })),
  };
}

// Burn's own view: graphAt(T) -> demoInputs(part) -> compare. Caught = Expedite saves 0 days vs Standard.
export async function burnCatches(ctx, world, wasted) {
  const { graphMod, compare, graph } = ctx;
  if (!graph) return { available: false, reason: ctx.reason };
  if (!compare) return { available: false, reason: 'src/timevalue compare not available yet' };
  const orders = new Map(world.orders.map((o) => [o.id, o]));
  const units = new Map([...world.test_rigs, ...world.resources].map((u) => [u.id, u]));
  let caught = 0; let caughtUsd = 0; let errors = 0;
  const rows = [];
  for (const w of wasted.orders) {
    const o = orders.get(w.order);
    const T = o.placed_at;
    let row = { order: o.id, premium_usd: w.premium_usd };
    try {
      const view = graphMod.graphAt(graph, T);
      let di = null;
      for (const l of o.lines) { di = graphMod.demoInputs(view, l.part); if (di?.test) break; }
      if (!di?.test) { row.result = 'no_test_found'; rows.push(row); continue; }
      const dur = Array.isArray(di.duration) ? Math.max(...di.duration) : (di.duration?.max ?? di.duration);
      const rig = di.rig ? (typeof di.rig === 'string' ? units.get(di.rig) : di.rig) : null;
      const res = compare({
        holidays: world.meta.holidays,
        quote: o.tiers.map((t) => ({ tier: t.tier, total: t.total_usd, ready: t.est_delivery })),
        test: { planned_start: dateOf(di.planned_start?.value ?? di.planned_start), duration_days: dur, rig_slot_days: rig?.slot_days ?? null, bookings: (rig?.bookings || []).filter((b) => b.test !== (di.test?.id ?? di.test)).map((b) => ({ id: b.id, start: localDate(b.start), end: localDate(b.end) })), owner_out: [] },
        inputs: (di.inputs || []).filter((i) => !o.lines.some((l) => l.part === i.id)),
        milestone: { target: dateOf(di.milestone?.target ?? null), policy: di.policy ?? null }, now: localDate(T),
      });
      const e = (res.tiers || []).find((t) => t.tier === 'expedite');
      const s = (res.tiers || []).find((t) => t.tier === 'standard');
      const saved = (t) => (typeof t?.days_saved === 'number' ? t.days_saved : t?.days_saved && typeof t.days_saved === 'object' ? Math.max(...Object.values(t.days_saved)) : null);
      const noGain = res.outcome === 'cheapest' || (e && s && saved(e) != null && saved(e) === saved(s));
      row = { ...row, result: noGain ? 'caught' : 'missed', outcome: res.outcome, reason: res.reason ?? undefined, test: di.test?.id ?? di.test, expedite_days_saved: saved(e) };
      if (noGain) { caught++; caughtUsd += w.premium_usd; }
    } catch (err) { errors++; row.result = 'error'; row.error = errText(err); }
    rows.push(row);
  }
  return { available: true, caught, caught_premium_usd: money(caughtUsd), of: wasted.count, of_premium_usd: wasted.premium_usd, errors, orders: rows };
}

// ---------- 4. graph recall, link rate ----------

export async function buildBurnGraph(args) {
  const settingsPath = join(args.out, 'settings.json');
  const [src, refs, claims, graphMod] = await Promise.all([
    tryImport('server/timevalue/sources.mjs'), tryImport('server/timevalue/refs.mjs'), tryImport('server/timevalue/claims.mjs'), tryImport('server/timevalue/graph.mjs'),
  ]);
  const missing = [src, refs, claims, graphMod].filter((x) => !x.mod).map((x) => x.reason);
  if (!existsSync(settingsPath)) missing.unshift('fixtures/timevalue/settings.json not available yet');
  const base = { sourcesMod: src.mod, graphMod: graphMod.mod };
  if (src.mod?.loadSources && existsSync(settingsPath)) {
    try { base.sources = await src.mod.loadSources(args.sources); } catch (e) { missing.push(`loadSources failed: ${errText(e)}`); }
  }
  if (missing.length) return { ...base, graph: null, reason: missing.join('; ') };
  try {
    const settings = readJson(settingsPath);
    const resolveRef = refs.mod.makeResolver(settings);
    const cl = base.sources.docs.flatMap((d) => claims.mod.extractClaims(d, resolveRef) || []);
    const graph = await graphMod.mod.buildGraph({ settings, sources: base.sources, claims: cl });
    return { ...base, settings, graph, n_claims: cl.length };
  } catch (e) { return { ...base, graph: null, reason: `buildGraph failed: ${errText(e)}` }; }
}

// Burn never sees world work-item ids (wi-NNNNN); it names a work item by the name written in the text,
// as `wk:<slug of the name>`. Match a true edge through that name. World names are not unique (two work items can
// share a name), so one Burn node can stand for several true work items; that is the most the text allows.
const slugName = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export function workNodeIds(world) { return new Map((world.work_items || []).map((w) => [w.id, `wk:${slugName(w.name)}`])); }

// rendered: edges with at least one revealing event that reached the text (provenance.events); `null` when unknown.
export function gradeGraphRecall(world, ctx, provenance = null) {
  if (!ctx.graph) return { available: false, reason: ctx.reason };
  let view = ctx.graph;
  try { view = ctx.graphMod.graphAt(ctx.graph, world.meta.demo_now) || ctx.graph; } catch { /* full graph */ }
  const wk = workNodeIds(world);
  const id = (x) => wk.get(x) || x;
  const k = (e) => `${id(e.from)}|${id(e.to)}`;
  const have = new Set((view.edges || []).map((e) => `${e.from}|${e.to}`));
  const accepted = new Set((view.edges || []).filter((e) => !e.status || e.status === 'accepted').map((e) => `${e.from}|${e.to}`));
  const shown = (e) => (provenance?.events ? (e.revealed_by || []).some((ev) => provenance.events[ev]) : null);
  const by = {};
  for (const e of world.edges) {
    const r = (by[e.reveal] ||= { n: 0, found: 0, accepted: 0, ...(provenance ? { n_in_text: 0, found_in_text: 0 } : {}) });
    r.n++;
    const f = have.has(k(e));
    if (f) r.found++;
    if (accepted.has(k(e))) r.accepted++;
    if (shown(e)) { r.n_in_text++; if (f) r.found_in_text++; }
  }
  for (const r of Object.values(by)) {
    r.recall = round(r.found / r.n); r.recall_accepted = round(r.accepted / r.n);
    if (r.n_in_text != null) r.recall_in_text = r.n_in_text ? round(r.found_in_text / r.n_in_text) : null;
  }
  const truth = new Set(world.edges.map(k));
  const n = world.edges.length;
  const found = Object.values(by).reduce((s, r) => s + r.found, 0);
  // Precision over the edge kinds the world models (ordered_as part -> order edges are not in world.edges).
  const comparable = (view.edges || []).filter((e) => e.kind !== 'ordered_as');
  const tp = comparable.filter((e) => truth.has(`${e.from}|${e.to}`)).length;
  return { available: true, recall: round(found / n), by_reveal: by, precision: comparable.length ? round(tp / comparable.length) : null, graph_edges: view.edges?.length || 0, compared_edges: comparable.length, true_edges: n };
}

export async function gradeLinks(world, args, ctx) {
  const lab = await tryImport('server/timevalue/labels.mjs');
  if (!lab.mod?.linkRampToXometry) return { available: false, reason: lab.reason || 'labels.mjs has no linkRampToXometry' };
  let srcs = ctx.sources;
  if (!srcs) {
    // sources.mjs not there yet: hand labels the rendered files as they are.
    const rj = (p) => (existsSync(join(args.sources, p)) ? readJson(join(args.sources, p)) : null);
    const unwrap = (x, k) => (Array.isArray(x) ? x : x?.[k] || x?.data || []);
    srcs = { ramp: { transactions: unwrap(rj('ramp/transactions.json'), 'transactions'), bills: unwrap(rj('ramp/bills.json'), 'bills') }, xometry: { quotes: unwrap(rj('xometry/quotes.json'), 'quotes'), orders: unwrap(rj('xometry/orders.json'), 'orders') } };
  }
  let res;
  try { res = await lab.mod.linkRampToXometry({ ramp: srcs.ramp, xometry: srcs.xometry }); } catch (e) { return { available: false, reason: `linkRampToXometry threw: ${errText(e)}` }; }
  const links = Array.isArray(res) ? res : res?.links || res?.labels || [];
  const unlinked = (Array.isArray(res) ? res.unlinked : res?.unlinked) || [];
  const byId = new Map(world.orders.map((o) => [o.id, o]));
  const truth = new Map(world.ramp_transactions.filter((t) => t.order && byId.get(t.order)?.type === 'xometry_cnc').map((t) => [t.id, byId.get(t.order).order_number]));
  const correct = links.filter((l) => truth.get(l.ramp_id) === l.order_number).length;
  const xoCount = world.orders.filter((o) => o.type === 'xometry_cnc').length;
  const charges = links.length + unlinked.length;
  return {
    available: true, linked: links.length, unlinked: unlinked.length,
    link_rate: charges ? round(links.length / charges) : null,
    correct, precision: links.length ? round(correct / links.length) : null,
    coverage_of_xometry_orders: round(new Set(links.map((l) => l.order_number)).size / xoCount),
    true_xometry_charges: truth.size,
  };
}

// ---------- main ----------

export async function grade(args) {
  const t0 = performance.now();
  const world = readJson(join(args.world, 'world.json'));
  const answers = readJson(join(args.world, 'answers.json'));
  const out = { generated_from: ['world.json', 'answers.json'], demo_now: world.meta.demo_now };

  const built = buildEngineCases(world, answers);
  built.holidays = world.meta.holidays.map(({ date, name, observance }) => ({ date, name, observance }));
  const { engine, reason } = await loadEngine();
  out.engine = engine ? { ...gradeEngine(built, engine), note: reason || undefined } : { available: false, reason, cases_ready: { test_fed: built.cases.filter((c) => c.kind === 'test').length, work_item_fed: built.cases.filter((c) => c.kind === 'work_item').length, skipped: built.skipped.length } };

  const modelPath = join(args.out, 'habit-model.json');
  out.habit = gradeHabit(world, answers, existsSync(modelPath) ? readJson(modelPath) : null);

  const wasted = wastedExpedites(world, answers);
  const ctx = await buildBurnGraph(args);
  out.wasted_expedites = { ...wasted, burn: await burnCatches({ ...ctx, compare: engine?.compare }, world, wasted) };
  const provPath = join(args.world, 'provenance.json');
  out.graph_recall = gradeGraphRecall(world, ctx, existsSync(provPath) ? readJson(provPath) : null);
  out.links = await gradeLinks(world, args, ctx);
  out.runtime_s = round((performance.now() - t0) / 1000, 2);
  return out;
}

export function summarize(g) {
  const L = [];
  const pct = (x) => (x == null ? 'n/a' : `${(x * 100).toFixed(1)}%`);
  const ci = (c) => (c ? ` [${pct(c[0])}, ${pct(c[1])}]` : '');
  const e = g.engine;
  if (!e.available) L.push(`Engine exact: not available yet (${e.reason}); ${e.cases_ready.test_fed} test-fed + ${e.cases_ready.work_item_fed} work-item cases ready`);
  else {
    L.push(`Engine exact (test-fed): ${e.test_fed.exact}/${e.test_fed.orders} orders = ${pct(e.test_fed.exact_share)} (target 95%)${e.compare_checked ? '' : ' [solve only]'}`);
    L.push(`Engine exact (work-item-fed): ${e.work_item_fed.exact}/${e.work_item_fed.orders} = ${pct(e.work_item_fed.exact_share)}`);
    for (const c of e.mismatch_causes.slice(0, 8)) L.push(`  ${c.n} x ${c.cause}`);
  }
  const h = g.habit;
  const b = h.baselines;
  L.push(`Habit: ${h.available ? `accuracy ${pct(h.accuracy)}${ci(h.ci95)} on n=${h.n_test}` : `not available yet (${h.reason})`}; never-expedite ${pct(b.never_expedite.accuracy)}, need-by rule ${pct(b.need_by_rule.accuracy)} on ${b.n_test_set} (answers.summary: ${pct(b.need_by_rule_answers_summary)})`);
  const w = g.wasted_expedites;
  L.push(`Wasted expedites: ${w.count} of ${w.expedited} expedites bought no time, $${w.premium_usd.toLocaleString('en-US')} premium over Standard; Burn caught: ${w.burn.available ? `${w.burn.caught}/${w.burn.of} ($${w.burn.caught_premium_usd.toLocaleString('en-US')})` : `not available yet (${w.burn.reason})`}`);
  L.push(`Graph recall: ${g.graph_recall.available ? `${pct(g.graph_recall.recall)} (${Object.entries(g.graph_recall.by_reveal).map(([k, v]) => `${k} ${pct(v.recall)}${v.recall_in_text != null ? ` [${pct(v.recall_in_text)} of ${v.n_in_text} in text]` : ''}`).join(', ')})` : `not available yet (${g.graph_recall.reason})`}`);
  L.push(`Ramp-Xometry link rate: ${g.links.available ? `${pct(g.links.link_rate)} (${g.links.linked} linked, ${g.links.unlinked} unlinked, precision ${pct(g.links.precision)})` : `not available yet (${g.links.reason})`}`);
  L.push(`(${g.runtime_s}s)`);
  return L.join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = parseArgs(process.argv.slice(2));
  const g = await grade(args);
  mkdirSync(args.out, { recursive: true });
  writeFileSync(join(args.out, 'grading.json'), `${JSON.stringify(g, null, 2)}\n`);
  console.log(summarize(g));
}
