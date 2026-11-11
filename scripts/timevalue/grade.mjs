// Grading for Time Value (docs/build/time-value-impl.md, "scripts/timevalue/grade.mjs (G)").
// The only Burn script besides export-settings that may read fixtures/world/: it holds the answer key.
//
//   node scripts/timevalue/grade.mjs [--world fixtures/world] [--sources fixtures/flintlock] [--out fixtures/timevalue]
//
// Writes <out>/grading.json (same inputs -> same file) and prints a short summary plus the runtime.
//
// 1. Engine exact: true inputs from world.json -> solve/compare -> test_start, gated_date, days_gained
//    against answers.tier_outcomes (simulation-spec S2, S9).
// 2. Wasted expedites: expedited orders with expedite_helped = false; how many Burn's graphAt(T) + compare catches.
// 3. Graph recall by edges.reveal; Ramp <-> Xometry link rate.
//
// Optional inputs: <out>/settings.json (from export-settings.mjs; without it there is no Burn graph, so
// graph recall and Burn's catches are reported as { available: false, reason }) and <world>/provenance.json
// (without it graph recall has no in-text split).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeCalendar, localDate } from '../generate-world/lib/calendar.mjs';
import { milestoneDate } from '../generate-world/sim/solve.mjs';
import { solve } from '../../src/timevalue/solve.mjs';
import { compare } from '../../src/timevalue/compare.mjs';
import { loadSources } from '../../server/timevalue/sources.mjs';
import { makeResolver, workId } from '../../server/timevalue/refs.mjs';
import { extractClaims } from '../../server/timevalue/claims.mjs';
import * as graphMod from '../../server/timevalue/graph.mjs';
import { linkRampToXometry } from '../../server/timevalue/labels.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TIER_ORDER = ['economy', 'international_economy', 'standard', 'expedite'];
export const ENGINE = { solve, compare };

// ---------- helpers ----------

export function parseArgs(argv) {
  const a = { world: 'fixtures/world', sources: 'fixtures/flintlock', out: 'fixtures/timevalue' };
  for (let i = 0; i < argv.length; i++) {
    const m = /^--(world|sources|out)$/.exec(argv[i]);
    if (!m) continue;
    if (argv[i + 1] == null || argv[i + 1].startsWith('--')) throw new Error(`${argv[i]} needs a path`);
    a[m[1]] = argv[++i];
  }
  for (const k of Object.keys(a)) a[k] = resolve(ROOT, a[k]);
  return a;
}

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const readRequired = (p) => {
  if (!existsSync(p)) throw new Error(`missing ${p} (pass --world <dir> holding world.json and answers.json)`);
  return readJson(p);
};
const errText = (e) => String(e?.message || e).split('\n')[0];
const round = (x, d = 3) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);
const money = (x) => Math.round(x * 100) / 100;
const dateOf = (x) => (x == null ? null : typeof x === 'string' ? x.slice(0, 10) : x);
const xometryOrders = (world) => world.orders.filter((o) => o.type === 'xometry_cnc');
const overlaps = (start, end, r) => !(end < r.start || start > r.end); // inclusive date ranges

// ---------- 1. engine exact: build the true cases ----------

// One case per Xometry order whose consumer is a test (primary) or an order-specific work item (secondary).
// Each case carries the inputs solve/compare take and the expected outcome per tier from answers.json.
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
  const xo = xometryOrders(world);
  const edgesTo = new Map();
  for (const e of world.edges) { if (!edgesTo.has(e.to)) edgesTo.set(e.to, []); edgesTo.get(e.to).push(e); }
  const chosenReady = (o) => ans.get(o.id)?.tier_outcomes.find((t) => t.tier === o.chosen_tier)?.ready_date ?? (o.ready_at ? localDate(o.ready_at) : null);
  // The order whose parts gate a test's part input: the simulator keeps the last order placed for that part
  // and that test (orders are created in id order), so an earlier order for the same part no longer gates.
  const gatingOrder = new Map(); // `${test}|${part}` -> order
  for (const o of xo.slice().sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (!o.feeds_test || o.feeds_work_item || o.cancelled) continue; // a work item's order sets no test input
    for (const l of o.lines) gatingOrder.set(`${o.feeds_test}|${l.part}`, o);
  }
  const pinned = new Set([world.demo?.test, world.demo?.milestone].filter(Boolean));
  const deliverableInput = (id) => ({ id, kind: 'deliverable', ready: dls.get(id).true_arrival ?? null });

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
    const head = { order: o.id, base, chosen_tier: o.chosen_tier, placed: localDate(o.placed_at) };
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
        bookings.push({ id: b.id, unit: u, test: b.test, start: localDate(b.start), end: localDate(b.end) });
      }
      bookings.sort((x, y) => (x.start < y.start ? -1 : x.start > y.start ? 1 : x.id < y.id ? -1 : 1));
      const inputs = [];
      const mine = [];
      for (const { from: id } of edgesTo.get(t.id) || []) {
        if (units.has(id)) continue;
        if (dls.has(id)) inputs.push(deliverableInput(id));
        else if (wis.has(id)) inputs.push({ id, kind: 'work_item', ready: wis.get(id).actual_done ? localDate(wis.get(id).actual_done) : null });
        else if (parts.has(id)) {
          const g = gatingOrder.get(`${t.id}|${id}`);
          if (!g) continue; // never ordered for this test: no constraint in the truth (an engine would call it unknown)
          if (g.id === o.id) mine.push(id);
          else inputs.push({ id, kind: 'part', order: g.id, ready: chosenReady(g) });
        }
      }
      const m = t.milestone ? milestones.get(t.milestone) : null;
      const feeders = m ? world.tests.filter((x) => x.milestone === m.id && x.id !== t.id).map((x) => ({ id: x.id, end: x.actual_end ? localDate(x.actual_end) : null })) : [];
      cases.push({
        ...head, kind: 'test', consumer: t.id,
        order_parts: mine, // empty = a later order for the same parts gates the test, so every tier lands the same
        test: {
          planned_start: t.earliest_start ?? t.planned_date[0].value, duration_days: Math.max(1, Math.round(t.duration_true_days)),
          // The simulator does not model owner out-of-office, so grading against it passes none; the owner's
          // outages ride along (owner_ooo) only to explain a mismatch from an engine that is fed them.
          rig_slot_days: slot, bookings, owner_out: [], owner: t.owner,
        },
        owner_ooo: (people.get(t.owner)?.ooo || []).map((x) => ({ start: x.start, end: x.end })),
        inputs, tiers,
        milestone: m ? { id: m.id, target: m.date[0].value, hardness: m.hardness, kind: m.kind, policy: null, feeders } : null,
        _m: m, // the world milestone, for milestoneDate
      });
    } else if (o.feeds_work_item && wis.has(o.feeds_work_item)) {
      // Work items: the simulator's earliest start is not stored in world.json. The start with this order's
      // parts at minus infinity is answers.true_need_date + 1 wd; it already folds in the earliest start,
      // the slot day and every sibling input, so it is the planned start (exact by S9.4).
      const w = wis.get(o.feeds_work_item);
      if (!a.true_need_date) { skipped.push({ order: o.id, reason: 'work item without true_need_date' }); continue; }
      const unit = (w.blocked_by || []).map((x) => units.get(x)).find(Boolean);
      cases.push({
        ...head, kind: 'work_item', consumer: w.id, order_parts: o.lines.map((l) => l.part),
        test: { planned_start: cal.addWd(a.true_need_date, 1), duration_days: Math.max(1, Math.round(w.duration_true_days)), rig_slot_days: unit?.slot_days?.length ? unit.slot_days.slice() : null, bookings: [], owner_out: [], owner: w.owner },
        inputs: (w.blocked_by || []).filter((x) => dls.has(x)).map(deliverableInput),
        tiers, milestone: null,
      });
    } else skipped.push({ order: o.id, reason: 'feeds nothing (all gains 0)' });
  }
  const holidays = (world.meta.holidays || []).map(({ date, name, observance }) => ({ date, name, observance }));
  return { cases, skipped, cal, holidays };
}

// Milestone date from this test's finish and the other feeders' realized ends (S2: soft moves, hard keeps its
// date, builds/gates/demos/reviews are held on their date).
function gatedFrom(c, finish) {
  if (c.kind !== 'test' || !c._m) return finish;
  return milestoneDate(c._m, [finish, ...c.milestone.feeders.map((f) => f.end)]);
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

// compare's days_saved is a number or { scenario: days }; `pick` folds the scenarios into one number.
const daysSaved = (t, pick) => {
  const v = t?.days_saved;
  if (typeof v === 'number') return v;
  return v && typeof v === 'object' ? pick(Object.values(v)) : null;
};

// Why an engine answer differs from the truth. Rules (impl.md, A): ready on R -> usable nextWd(R);
// start = first wd >= max(planned start, usable dates) on a slot day, with no booking over the whole run;
// finish = addWd(start, duration - 1). The simulator does not model owner out-of-office.
export function diagnose(cal, c, tierReady, got, exp) {
  if (got.error) return [`engine threw: ${got.error}`];
  if (!got.start) return ['engine returned no start date'];
  const why = [];
  const t = c.test;
  const readies = [...c.inputs.map((i) => i.ready), tierReady].filter(Boolean).sort();
  const lastReady = readies[readies.length - 1] || null;
  const usable = lastReady ? cal.addWd(lastReady, 1) : null;
  const dow = (d) => new Date(`${d}T12:00:00Z`).getUTCDay();
  const runEnd = (start) => cal.addWd(start, t.duration_days - 1);
  if (exp.test_start && got.start !== exp.test_start) {
    if (got.start < exp.test_start) {
      if (usable && got.start < usable) why.push(`starts ${got.start}, before the last input is usable (${lastReady} ready -> usable ${usable}; ready on R is usable from nextWd(R))`);
      if (got.start < t.planned_start) why.push(`starts before planned_start ${t.planned_start}`);
      if (t.rig_slot_days && !t.rig_slot_days.includes(dow(got.start))) why.push(`starts on weekday ${dow(got.start)}, outside rig_slot_days [${t.rig_slot_days}]`);
      if (!cal.isWd(got.start)) why.push(`starts on a non-working day ${got.start} (weekend or full holiday)`);
      const gotEnd = runEnd(got.start);
      const clash = t.bookings.find((b) => overlaps(got.start, gotEnd, b));
      if (clash) why.push(`run ${got.start}..${gotEnd} overlaps booking ${clash.id} (${clash.start}..${clash.end}); a booking blocks every day of the run, not just the start day`);
    } else {
      const expEnd = runEnd(exp.test_start);
      const ooo = [...t.owner_out, ...(c.owner_ooo || [])].find((x) => overlaps(exp.test_start, expEnd, x));
      if (ooo) why.push(`owner out ${ooo.start}..${ooo.end} pushed the start; the simulator's truth does not model owner out-of-office`);
      const near = t.bookings.find((b) => b.end === exp.test_start || b.start === expEnd || cal.addWd(b.end, 1) === exp.test_start);
      if (near) why.push(`true start ${exp.test_start} touches booking ${near.id} (${near.start}..${near.end}); bookings are inclusive date ranges and a run may start the wd after one ends`);
      if (usable && got.start === cal.addWd(usable, 1)) why.push('one wd late: usable date counted as addWd(R, 2) or ready treated as end of next day');
      if (t.rig_slot_days && !t.rig_slot_days.includes(dow(got.start))) why.push(`starts outside rig_slot_days [${t.rig_slot_days}]`);
      if (!why.length) why.push(`starts ${got.start}, later than the first feasible day ${exp.test_start}`);
    }
  }
  const expFinish = exp.test_start ? runEnd(exp.test_start) : null;
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

// Run solve (every tier) and compare (once) for one case. -> { got: tier -> result, cmp }
function runEngine(c, engine, { cal, holidays }) {
  const plain = (list) => list.map(({ id, ready }) => ({ id, ready }));
  const got = {};
  for (const tr of c.tiers) {
    const inputs = [...plain(c.inputs), ...(c.order_parts.length ? [{ id: c.order, ready: tr.ready }] : [])];
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
        test: c.test, inputs: plain(c.inputs),
        milestone: { target: c.milestone?.target ?? null, policy: null }, now: c.placed,
      });
    } catch (e) { cmp = { error: errText(e) }; }
  }
  for (const r of Object.values(got)) if (!r.error) r.gated_date = r.finish ? gatedFrom(c, r.finish) : null;
  return { got, cmp };
}

// engine = { solve, compare? }. Exact = every tier's start, gated date and days gained match.
export function gradeEngine(built, engine) {
  const { cases, skipped, cal } = built;
  const groups = { test: { orders: 0, exact: 0, rows: 0, rows_exact: 0 }, work_item: { orders: 0, exact: 0, rows: 0, rows_exact: 0 } };
  const mismatches = [];
  let checkedCompare = 0;
  for (const c of cases) {
    const g = groups[c.kind];
    g.orders++;
    const { got, cmp } = runEngine(c, engine, built);
    const cmpOk = cmp && !cmp.error;
    const finishOf = (start) => cal.addWd(start, c.test.duration_days - 1);
    const cheapest = c.tiers.slice().sort((a, b) => tierRank(a.tier) - tierRank(b.tier))[0];
    const base = c.tiers.find((x) => x.tier === c.base);
    let orderExact = true;
    for (const tr of c.tiers) {
      g.rows++;
      const r = got[tr.tier];
      const exp = tr.expected;
      if (!r.error) {
        const gb = got[c.base]?.gated_date;
        r.days_gained = r.gated_date && gb ? Math.max(0, cal.wdBetween(r.gated_date, gb)) : 0;
        if (cmpOk) {
          const ct = (cmp.tiers || []).find((x) => x.tier === tr.tier);
          r.compare_finish = ct ? scenarioFinish(ct.finish_by_scenario) : null;
          if (r.compare_finish) checkedCompare++;
          r.compare_days_saved = ct ? daysSaved(ct, (v) => v[0]) : null;
          const fe = exp.test_start ? finishOf(exp.test_start) : null;
          const fc = cheapest.expected.test_start;
          r.expected_days_saved = fe && fc ? Math.max(0, cal.wdBetween(fe, finishOf(fc))) : null;
        }
      }
      const ok = !r.error && r.start === exp.test_start && r.gated_date === exp.gated_date && r.days_gained === exp.days_gained
        && (!cmpOk || ((r.compare_finish == null || r.compare_finish === finishOf(exp.test_start))
          && (r.compare_days_saved == null || r.compare_days_saved === r.expected_days_saved)));
      if (ok) { g.rows_exact++; continue; }
      orderExact = false;
      // A right tier looks wrong when the cheapest tier is wrong: days gained are measured from it.
      const knockOn = tr.tier !== c.base && r.start === exp.test_start && got[c.base]?.start !== base.expected.test_start;
      mismatches.push({
        order: c.order, kind: c.kind, consumer: c.consumer, tier: tr.tier, ready: tr.ready,
        expected: exp, got: { start: r.start ?? null, finish: r.finish ?? null, gated_date: r.gated_date ?? null, days_gained: r.days_gained ?? null, limiter: r.limiter ?? null, error: r.error, compare_finish: r.compare_finish, compare_days_saved: r.compare_days_saved },
        reasons: knockOn
          ? [`knock-on: this tier is right, but the cheapest tier (${c.base}) starts ${got[c.base]?.start ?? 'nowhere'} instead of ${base.expected.test_start}, so the days gained are off (see that row)`]
          : diagnose(cal, c, tr.ready, r, exp),
        inputs: { test: c.test, inputs: c.inputs, order_parts: c.order_parts },
      });
    }
    if (cmp?.error) mismatches.push({ order: c.order, kind: c.kind, consumer: c.consumer, tier: null, reasons: [`compare threw: ${cmp.error}`] });
    if (orderExact && !cmp?.error) g.exact++;
  }
  const share = (x) => (x.orders ? round(x.exact / x.orders, 4) : null);
  const all = { orders: groups.test.orders + groups.work_item.orders, exact: groups.test.exact + groups.work_item.exact };
  const causes = {};
  for (const m of mismatches) for (const r of m.reasons) {
    const key = r.replace(/\d{4}-\d{2}-\d{2}/g, 'D').replace(/bk-\d+/g, 'bk').replace(/-?\d+(\.\d+)?/g, 'N');
    causes[key] = (causes[key] || 0) + 1;
  }
  return {
    available: true, target: 0.95, compare_rows_checked: checkedCompare,
    rows_total: mismatches.length + groups.test.rows_exact + groups.work_item.rows_exact,
    test_fed: { ...groups.test, exact_share: share(groups.test), meets_target: share(groups.test) != null && share(groups.test) >= 0.95 },
    work_item_fed: { ...groups.work_item, exact_share: share(groups.work_item), note: 'planned start = true_need_date + 1 wd (work-item earliest start is not stored in world.json)' },
    all: { ...all, exact_share: share(all) },
    compare_checked: !!engine.compare,
    mismatch_causes: Object.entries(causes).sort((a, b) => b[1] - a[1]).map(([cause, n]) => ({ cause, n })),
    mismatches, skipped,
  };
}

// ---------- 2. wasted expedites ----------

export function wastedExpedites(world, answers) {
  const ans = new Map(answers.orders.map((a) => [a.order, a]));
  // Orders feeding the pinned demo test have no outcome yet (gated_date null), so they are not counted.
  const demoTest = world.demo?.test;
  const exp = xometryOrders(world).filter((o) => o.chosen_tier === 'expedite' && !(demoTest && o.feeds_test === demoTest));
  const wasted = exp.filter((o) => ans.get(o.id)?.expedite_helped === false);
  const prem = (o) => o.total_usd - (o.tiers.find((t) => t.tier === 'standard')?.total_usd ?? o.total_usd);
  const by_reason = {};
  for (const o of wasted) { const r = ans.get(o.id).hidden_reason; by_reason[r] = (by_reason[r] || 0) + 1; }
  return {
    expedited: exp.length,
    count: wasted.length,
    premium_usd: money(wasted.reduce((s, o) => s + prem(o), 0)),
    total_usd: money(wasted.reduce((s, o) => s + o.total_usd, 0)),
    by_reason,
    orders: wasted.map((o) => ({ order: o.id, order_number: o.order_number, placed_at: o.placed_at, premium_usd: money(prem(o)), hidden_reason: ans.get(o.id).hidden_reason, dominating_input: ans.get(o.id).dominating_input })),
  };
}

// Burn's own view: graphAt(T) -> demoInputs(part) -> compare. Caught = Expedite saves 0 days vs Standard.
export function burnCatches(ctx, world, wasted) {
  if (!ctx.graph) return { available: false, reason: ctx.reason };
  const orders = new Map(world.orders.map((o) => [o.id, o]));
  let caught = 0; let caughtUsd = 0; let errors = 0;
  const rows = [];
  for (const w of wasted.orders) {
    const o = orders.get(w.order);
    const T = o.placed_at;
    let row = { order: o.id, premium_usd: w.premium_usd };
    try {
      const view = ctx.graphMod.graphAt(ctx.graph, T);
      let di = null;
      for (const l of o.lines) { di = ctx.graphMod.demoInputs(view, l.part); if (di?.test) break; }
      if (!di?.test) { row.result = 'no_test_found'; rows.push(row); continue; }
      const testId = di.test.id;
      const res = compare({
        holidays: world.meta.holidays,
        quote: o.tiers.map((t) => ({ tier: t.tier, total: t.total_usd, ready: t.est_delivery })),
        test: {
          planned_start: dateOf(di.planned_start?.value ?? null), duration_days: di.duration?.max ?? null,
          rig_slot_days: di.rig?.slot_days ?? null,
          bookings: (di.rig?.bookings || []).filter((b) => b.test !== testId).map((b) => ({ id: b.id, start: localDate(b.start), end: localDate(b.end) })),
          owner_out: [],
        },
        inputs: (di.inputs || []).filter((i) => !o.lines.some((l) => l.part === i.id)),
        milestone: { target: dateOf(di.milestone?.target ?? null), policy: di.policy ?? null }, now: localDate(T),
      });
      const e = (res.tiers || []).find((t) => t.tier === 'expedite');
      const s = (res.tiers || []).find((t) => t.tier === 'standard');
      const saved = (t) => daysSaved(t, (v) => Math.max(...v));
      const noGain = res.outcome === 'cheapest' || (e && s && saved(e) != null && saved(e) === saved(s));
      row = { ...row, result: noGain ? 'caught' : 'missed', outcome: res.outcome, reason: res.reason ?? undefined, test: testId, expedite_days_saved: saved(e) };
      if (noGain) { caught++; caughtUsd += w.premium_usd; }
    } catch (err) { errors++; row.result = 'error'; row.error = errText(err); }
    rows.push(row);
  }
  return { available: true, caught, caught_premium_usd: money(caughtUsd), of: wasted.count, of_premium_usd: wasted.premium_usd, errors, orders: rows };
}

// ---------- 3. graph recall, link rate ----------

// Load the rendered sources and build Burn's graph from them. -> { sources, graphMod, graph, n_claims }
// or { graph: null, reason } (sources unreadable, or no settings.json yet).
export function buildBurnGraph(args) {
  const ctx = { sources: null, graphMod, graph: null };
  try { ctx.sources = loadSources(args.sources); } catch (e) { return { ...ctx, reason: `loadSources(${args.sources}) failed: ${errText(e)}` }; }
  const settingsPath = join(args.out, 'settings.json');
  if (!existsSync(settingsPath)) return { ...ctx, reason: `${settingsPath} not found (run scripts/timevalue/export-settings.mjs)` };
  try {
    const settings = readJson(settingsPath);
    const resolveRef = makeResolver(settings);
    const claims = ctx.sources.docs.flatMap((d) => extractClaims(d, resolveRef) || []);
    return { ...ctx, settings, graph: graphMod.buildGraph({ settings, sources: ctx.sources, claims }), n_claims: claims.length };
  } catch (e) { return { ...ctx, reason: `buildGraph failed: ${errText(e)}` }; }
}

// Burn never sees world work-item ids (wi-NNNNN); it names a work item by the name written in the text,
// as `wk:<slug of the name>`. Match a true edge through that name. World names are not unique (two work items can
// share a name), so one Burn node can stand for several true work items; that is the most the text allows.
export function workNodeIds(world) { return new Map((world.work_items || []).map((w) => [w.id, workId(w.name)])); }

// in_text: edges with at least one revealing event that reached the text (provenance.events); only with provenance.
export function gradeGraphRecall(world, ctx, provenance = null) {
  if (!ctx.graph) return { available: false, reason: ctx.reason };
  let view = ctx.graph;
  try { view = ctx.graphMod.graphAt(ctx.graph, world.meta.demo_now) || ctx.graph; } catch { /* full graph */ }
  const edges = view.edges || [];
  const wk = workNodeIds(world);
  const id = (x) => wk.get(x) || x;
  const k = (e) => `${id(e.from)}|${id(e.to)}`;
  const have = new Set(edges.map((e) => `${e.from}|${e.to}`));
  const accepted = new Set(edges.filter((e) => !e.status || e.status === 'accepted').map((e) => `${e.from}|${e.to}`));
  const by = {};
  for (const e of world.edges) {
    const r = (by[e.reveal] ||= { n: 0, found: 0, accepted: 0, ...(provenance ? { n_in_text: 0, found_in_text: 0 } : {}) });
    const f = have.has(k(e));
    r.n++;
    if (f) r.found++;
    if (accepted.has(k(e))) r.accepted++;
    if (provenance?.events && (e.revealed_by || []).some((ev) => provenance.events[ev])) { r.n_in_text++; if (f) r.found_in_text++; }
  }
  for (const r of Object.values(by)) {
    r.recall = round(r.found / r.n); r.recall_accepted = round(r.accepted / r.n);
    if (r.n_in_text != null) r.recall_in_text = r.n_in_text ? round(r.found_in_text / r.n_in_text) : null;
  }
  const truth = new Set(world.edges.map(k));
  const n = world.edges.length;
  const found = Object.values(by).reduce((s, r) => s + r.found, 0);
  // Precision over the edge kinds the world models (ordered_as part -> order edges are not in world.edges).
  const comparable = edges.filter((e) => e.kind !== 'ordered_as');
  const tp = comparable.filter((e) => truth.has(`${e.from}|${e.to}`)).length;
  return { available: true, recall: round(found / n), by_reveal: by, precision: comparable.length ? round(tp / comparable.length) : null, graph_edges: edges.length, compared_edges: comparable.length, true_edges: n };
}

export function gradeLinks(world, ctx) {
  if (!ctx.sources) return { available: false, reason: ctx.reason };
  let links;
  try { links = linkRampToXometry({ ramp: ctx.sources.ramp, xometry: ctx.sources.xometry }); } catch (e) { return { available: false, reason: `linkRampToXometry threw: ${errText(e)}` }; }
  const unlinked = links.unlinked || [];
  const byId = new Map(world.orders.map((o) => [o.id, o]));
  const truth = new Map(world.ramp_transactions.filter((t) => t.order && byId.get(t.order)?.type === 'xometry_cnc').map((t) => [t.id, byId.get(t.order).order_number]));
  const correct = links.filter((l) => truth.get(l.ramp_id) === l.order_number).length;
  const charges = links.length + unlinked.length;
  return {
    available: true, linked: links.length, unlinked: unlinked.length,
    link_rate: charges ? round(links.length / charges) : null,
    correct, precision: links.length ? round(correct / links.length) : null,
    coverage_of_xometry_orders: round(new Set(links.map((l) => l.order_number)).size / xometryOrders(world).length),
    true_xometry_charges: truth.size,
  };
}

// ---------- main ----------

export function grade(args) {
  const world = readRequired(join(args.world, 'world.json'));
  const answers = readRequired(join(args.world, 'answers.json'));
  const out = { generated_from: ['world.json', 'answers.json'], demo_now: world.meta.demo_now };
  out.engine = gradeEngine(buildEngineCases(world, answers), ENGINE);
  const wasted = wastedExpedites(world, answers);
  const ctx = buildBurnGraph(args);
  out.wasted_expedites = { ...wasted, burn: burnCatches(ctx, world, wasted) };
  const provPath = join(args.world, 'provenance.json');
  out.graph_recall = gradeGraphRecall(world, ctx, existsSync(provPath) ? readJson(provPath) : null);
  out.links = gradeLinks(world, ctx);
  return out;
}

export function summarize(g) {
  const pct = (x) => (x == null ? 'n/a' : `${(x * 100).toFixed(1)}%`);
  const usd = (x) => `$${x.toLocaleString('en-US')}`;
  const or = (part, ok) => (part.available ? ok() : `not available (${part.reason})`);
  const { engine: e, wasted_expedites: w, graph_recall: r, links } = g;
  return [
    `Engine exact (test-fed): ${e.test_fed.exact}/${e.test_fed.orders} orders = ${pct(e.test_fed.exact_share)} (target 95%)${e.compare_checked ? '' : ' [solve only]'}`,
    `Engine exact (work-item-fed): ${e.work_item_fed.exact}/${e.work_item_fed.orders} = ${pct(e.work_item_fed.exact_share)}`,
    ...e.mismatch_causes.slice(0, 8).map((c) => `  ${c.n} x ${c.cause}`),
    `Wasted expedites: ${w.count} of ${w.expedited} expedites bought no time, ${usd(w.premium_usd)} premium over Standard; Burn caught: ${or(w.burn, () => `${w.burn.caught}/${w.burn.of} (${usd(w.burn.caught_premium_usd)})`)}`,
    `Graph recall: ${or(r, () => `${pct(r.recall)} (${Object.entries(r.by_reveal).map(([k, v]) => `${k} ${pct(v.recall)}${v.recall_in_text != null ? ` [${pct(v.recall_in_text)} of ${v.n_in_text} in text]` : ''}`).join(', ')})`)}`,
    `Ramp-Xometry link rate: ${or(links, () => `${pct(links.link_rate)} (${links.linked} linked, ${links.unlinked} unlinked, precision ${pct(links.precision)})`)}`,
  ].join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try {
    const t0 = performance.now();
    const args = parseArgs(process.argv.slice(2));
    const g = grade(args);
    mkdirSync(args.out, { recursive: true });
    writeFileSync(join(args.out, 'grading.json'), `${JSON.stringify(g, null, 2)}\n`);
    console.log(summarize(g));
    console.log(`(${((performance.now() - t0) / 1000).toFixed(2)}s)`);
  } catch (e) {
    console.error(`grade: ${errText(e)}`);
    process.exit(1);
  }
}
