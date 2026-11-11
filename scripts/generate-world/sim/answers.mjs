// S9 counterfactual outcomes and S13 the answers extract. Nothing is drawn here except expressed-pressure noise.
import { resolveOne, milestoneDate } from './solve.mjs';
import { addDays, localDate } from '../lib/calendar.mjs';
import { cmp } from '../lib/io.mjs';

const TIERS = ['economy', 'standard', 'expedite'];

// Outcome of one order under each tier on the true graph, everything else at its realized truth.
export function tierOutcomes(S, info) {
  const { cal, world } = S;
  const c = info.consumer;
  const o = info.order;
  const out = {};
  for (const tier of TIERS) {
    const ready = info.ready[tier];
    if (!c) { out[tier] = { ready, start: null, end: null, gated: null }; continue; }
    const res = resolveOne(cal, c, S.busy, { order: o.id, ready });
    let gated = res.end;
    if (c.type === 'test' && c.milestone) {
      const m = S.M.get(c.milestone);
      const feeders = world.tests.filter((t) => t.milestone === m.id);
      gated = feeders.some((t) => S.pinned.has(t.id)) ? null : milestoneDate(m, feeders.map((t) => (t.id === c.id ? res.end : S.slots.get(t.id).end)));
    }
    out[tier] = { ready, start: res.start, end: res.end, gated };
  }
  let need = null;
  let dominating = null;
  if (c) {
    const free = resolveOne(cal, c, S.busy, { order: o.id, ready: null });
    need = cal.addWd(free.start, -1);
    dominating = free.dominating;
  }
  return { out, need, dominating };
}

export function buildAnswers(S) {
  const { world, cal, k, rng } = S;
  const evById = new Map(world.events.map((e) => [e.id, e]));
  const periods = world.meta.periods;
  const orders = [];
  const xo = world.orders.filter((o) => o.type === 'xometry_cnc');
  const edgesTo = new Map();
  for (const e of world.edges) { if (!edgesTo.has(e.to)) edgesTo.set(e.to, []); edgesTo.get(e.to).push(e); }
  const unitById = new Map([...world.test_rigs, ...world.resources].map((u) => [u.id, u]));

  for (const o of xo) {
    const info = S.info.get(o.id);
    const c = info.consumer;
    const r = rng.fork(`answers:${o.id}`);
    const { out, need, dominating } = tierOutcomes(S, info);
    const quoted = o.tiers.map((t) => t.tier);
    const base = quoted.includes('economy') ? 'economy' : 'standard';
    const gainOf = (a, b) => (out[a].gated && out[b].gated ? Math.max(0, cal.wdBetween(out[a].gated, out[b].gated)) : 0);
    const tier_outcomes = quoted.map((tier) => ({
      tier, ready_date: out[tier].ready, test_start: out[tier].start, gated_date: out[tier].gated,
      days_gained: gainOf(tier, base), true_slack_days: need ? cal.wdBetween(out[tier].ready, need) : null,
    }));
    const expGain = c ? gainOf('expedite', 'standard') : 0;
    const helped = expGain > 0;
    const exp = o.chosen_tier === 'expedite';
    let reason;
    switch (info.rule) {
      case 1: reason = 'insurance_or_spare'; break;
      case 2: reason = 'personal_habit'; break;
      case 3: reason = 'budget_squeeze'; break;
      case 4: reason = 'ordered_late'; break;
      case 5: reason = 'pressure_manager_or_demo'; break;
      case 6: {
        if (exp) {
          const sd = c.slotDays || (c.unit ? unitById.get(c.unit)?.slot_days : null);
          const gap = sd?.length ? Math.max(1, Math.round(5 / sd.length)) : null;
          reason = !helped ? 'no_gain_other_input_later' : gap && expGain >= gap ? 'test_slot_cliff' : 'genuine_gain';
        } else reason = quoted.includes('economy') && gainOf('standard', 'economy') > 0 ? 'genuine_gain' : 'cheap_default';
        break;
      }
      default: reason = 'cheap_default';
    }
    info.reason = reason; info.expGain = expGain; info.helped = helped;
    const T = o.placed_at;
    const tDay = localDate(T);
    const bands = { '0-1': [0, 1], '1-3': [1, 3], '3-7': [3, 7], '7-14': [7, 14], '14-30': [14, 30] };
    const true_pressure = {}; const expressed_pressure = {};
    const team = S.T.get(S.A.get(info.assembly)?.team);
    for (const [b, [lo, hi]] of Object.entries(bands)) {
      let sum = 0; let n = 0;
      for (let d = lo; d < hi; d++) { const day = addDays(tDay, -d); if (day >= cal.windowStart && cal.isWd(day)) { sum += S.pressureValue(info.assembly, day); n++; } }
      const v = n ? sum / n : S.pressureValue(info.assembly, cal.onOrBefore(addDays(tDay, -lo)) < cal.windowStart ? tDay : cal.onOrBefore(addDays(tDay, -lo)));
      true_pressure[b] = S.level(v);
      expressed_pressure[b] = S.level(Math.max(0, Math.min(1, v + (team?.expressiveness || 0) + r.normal(0, k.pressure.noise_sd))));
    }
    const mine = new Set([...o.lines.map((l) => l.part), ...(c ? c.inputs.map((i) => i.id) : []), ...(c ? c.units : []), ...(c?.unit ? [c.unit] : [])]);
    const links = c ? (edgesTo.get(c.id) || []).filter((e) => mine.has(e.from)) : [];
    const never = [];
    if (info.hiddenNeed) never.push(`true need was ${info.hiddenNeed}, earlier than the written need-by`);
    if (info.rule === 3) never.push('budget window in force when the tier was chosen');
    if (info.rule === 2) never.push(`decider habit: ${info.decider.orders.habit}`);
    if (info.belief.stale) never.push('decider had not seen announcements from the last 2 working days');
    if (info.belief.ignored_siblings) never.push('decider did not look at the other inputs');
    for (const e of links) if (e.reveal === 'never') never.push(`link ${e.from} -> ${e.to} never written down`);
    const day = tDay;
    orders.push({
      order: o.id, hidden_reason: reason, rule: info.rule, true_need_date: need,
      belief: info.belief,
      true_links: links.map((e) => e.id).sort(),
      links_revealed_before_t: links.filter((e) => e.revealed_by.some((id) => Date.parse(evById.get(id).known_at) < Date.parse(T))).map((e) => e.id).sort(),
      true_pressure, expressed_pressure, tier_outcomes,
      expedite_helped: c ? helped : false,
      break_even_usd_per_day: helped ? (o.tiers.find((t) => t.tier === 'expedite').total_usd - o.tiers.find((t) => t.tier === 'standard').total_usd) / expGain : null,
      dominating_input: c && !helped && dominating && dominating !== o.id && !o.lines.some((l) => l.part === dominating) ? dominating : null,
      crumbs: [...new Set((info.crumbs || []).map((e) => e.id))].sort(),
      crumbs_after: [...new Set((info.crumbsAfter || []).map((e) => e.id))].sort(),
      never_revealed: never,
      split: day <= periods.lead_in.end ? 'lead_in' : day <= periods.train.end ? 'train' : 'test',
    });
  }
  orders.sort((a, b) => cmp(a.order, b.order));

  // ---- assembly weeks (S5 progress) ----
  const assembly_weeks = [];
  const itemsOf = new Map();
  for (const w of world.work_items) { const key = `${w.assembly}|${w.milestone}`; if (!itemsOf.has(key)) itemsOf.set(key, []); itemsOf.get(key).push(w); }
  const progress = (a, m, friday, ws) => {
    const items = m ? itemsOf.get(`${a}|${m.id}`) || [] : [];
    const cutoff = Date.parse(`${friday}T18:30:00-08:00`);
    if (items.length >= 3) {
      let done = 0; let total = 0;
      for (const w of items) {
        total += w.duration_true_days;
        const s = Date.parse(w.actual_start); const e = Date.parse(w.actual_done);
        if (e <= cutoff) done += w.duration_true_days; else if (s < cutoff) done += w.duration_true_days * Math.min(1, (cutoff - s) / Math.max(1, e - s));
      }
      return total ? done / total : 0;
    }
    if (!m) return 1;
    const finish = cal.addWd(m.date[0].value, Math.max(0, S.assemblyLate(a, m.id)));
    const span = Math.max(10, cal.wdBetween(addDays(m.date[0].value, -70), finish));
    return Math.max(0, Math.min(1, 1 - cal.wdBetween(friday, finish) / span));
  };
  for (const w of world.meta.weeks) {
    const friday = addDays(w.week_start, 4) > cal.windowEnd ? cal.windowEnd : addDays(w.week_start, 4);
    const day = cal.onOrBefore(friday) < cal.windowStart ? cal.onOrAfter(cal.windowStart) : cal.onOrBefore(friday);
    const rows = world.assemblies.map((a) => {
      const m = S.nextMilestone(a.id, w.week_start);
      const pv = S.pressureValue(a.id, day);
      return { assembly: a.id, week_start: w.week_start, milestone: m ? m.id : null, true_progress: progress(a.id, m, friday, w.week_start), true_rank: null, pressure_value: pv, true_pressure: S.level(pv), _m: m };
    });
    for (const row of rows) {
      if (row._m) {
        const peers = rows.filter((x) => x._m === row._m && row._m.assemblies.includes(x.assembly)).sort((x, y) => x.true_progress - y.true_progress || cmp(x.assembly, y.assembly));
        row.true_rank = peers.indexOf(row) + 1 || null;
      }
    }
    for (const row of rows) { delete row._m; assembly_weeks.push(row); }
  }

  // ---- summary ----
  const share = (arr, f) => (arr.length ? arr.filter(f).length / arr.length : 0);
  const burstOf = (o) => S.info.get(o.id).burst;
  const tierMix = (arr) => Object.fromEntries(TIERS.map((t) => [t, share(arr, (o) => o.chosen_tier === t)]));
  const reasons = {};
  for (const a of orders) reasons[a.hidden_reason] = (reasons[a.hidden_reason] || 0) + 1 / orders.length;
  const exps = orders.filter((a) => xo.find((o) => o.id === a.order).chosen_tier === 'expedite');
  const textStart = addDays(cal.windowEnd, -7 * k.weeks_of_context);
  const usableFrom = addDays(textStart, 30);
  const usable = xo.filter((o) => localDate(o.placed_at) >= usableFrom);
  const test = xo.filter((o) => orders.find((a) => a.order === o.id).split === 'test');
  const perWeek = new Map(world.meta.weeks.map((w) => [w.week_start, 0]));
  for (const o of xo) perWeek.set(cal.weekOf(localDate(o.placed_at)), (perWeek.get(cal.weekOf(localDate(o.placed_at))) || 0) + 1);
  const kindMean = (kind) => { const ws = world.meta.weeks.filter((w) => w.kind === kind && cal.wdsOfWeek(w.week_start).length >= 4); return ws.length ? ws.reduce((s, w) => s + perWeek.get(w.week_start), 0) / ws.length : 0; };
  const totals = xo.map((o) => o.total_usd).sort((a, b) => a - b);
  const crumbs = world.events.filter((e) => e.kind === 'crumb');
  const correctedIds = new Set(crumbs.filter((e) => e.corrects).map((e) => e.corrects));
  const crumb_truth_mix = {
    crumbs: crumbs.length,
    stale: share(crumbs, (e) => e.truth === 'stale'),
    wrong_corrected: share(crumbs, (e) => e.truth === 'wrong' && correctedIds.has(e.id)),
    wrong_never_corrected: share(crumbs, (e) => e.truth === 'wrong' && !correctedIds.has(e.id) && !(e.contradicts || []).length),
    contradiction: share(crumbs, (e) => (e.contradicts || []).length > 0),
  };
  const summary = {
    xometry_orders: xo.length,
    other_orders: world.orders.length - xo.length,
    distinct_requesters: new Set(xo.map((o) => o.requester)).size,
    buyer_placed_share: share(xo, (o) => S.buyers.includes(o.placer)),
    orders_per_week: { normal_mean: kindMean('normal'), burst_mean: kindMean('burst'), quiet_mean: kindMean('quiet') },
    tier_mix: tierMix(xo), tier_mix_burst: tierMix(xo.filter(burstOf)), tier_mix_non_burst: tierMix(xo.filter((o) => !burstOf(o))),
    burst_order_share: share(xo, burstOf),
    hidden_reason_mix: Object.fromEntries(Object.keys(reasons).sort().map((x) => [x, reasons[x]])),
    expedite_true_gain_share: share(exps, (a) => a.expedite_helped === true),
    late_share: share(xo, (o) => localDate(o.delivered_at) > o.promised_date),
    revision_share: share(xo, (o) => o.is_revision),
    link_quality_mix: Object.fromEntries(['clean_id', 'alias_only', 'never_discussed'].map((q) => [q, share(xo, (o) => o.link_quality === q)])),
    crumb_truth_mix,
    edge_reveal_mix: Object.fromEntries(['revealed', 'hinted', 'never'].map((q) => [q, share(world.edges, (e) => e.reveal === q)])),
    order_total_usd: { median: totals[Math.floor(totals.length / 2)] || 0, p99: totals[Math.floor(totals.length * 0.99)] || 0, sum: totals.reduce((s, x) => s + x, 0) },
    usable_orders: { text_start: textStart, from: usableFrom, count: usable.length },
    probe: {
      note: 'baselines only (spec section 5, cut 2); the lookup-table probe is left to checks',
      always_standard_accuracy: share(test, (o) => o.chosen_tier === 'standard'),
      days_to_need_rule_accuracy: share(test, (o) => { const std = o.tiers.find((t) => t.tier === 'standard'); const pred = o.need_by_believed && std.est_delivery > o.need_by_believed ? 'expedite' : 'standard'; return pred === o.chosen_tier; }),
    },
  };
  for (const e of world.edges) delete e._first;
  for (const d of world.deliverables) delete d._gen;
  return { schema_version: world.meta.schema_version, seed: world.meta.seed, orders, assembly_weeks, summary };
}
