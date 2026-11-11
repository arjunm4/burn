// Checks the validator does not make (spec section 4): the solver reproduces the realized schedule (I17),
// causality (I9, I11 belief half, I12), history order (I3), order times (I5), pinned records (I8),
// both-ends rule for revealed links (I14), and the statistics against knobs.targets (warnings unless structural).
import { resolveOne, milestoneDate } from './solve.mjs';
import { believedAt, beliefCutoff } from './orders.mjs';
import { tierOutcomes } from './answers.mjs';
import { localDate } from '../lib/calendar.mjs';

export function selfcheck(S, world, answers) {
  const errors = [];
  const warnings = [];
  const { cal, k } = S;
  const err = (m) => errors.push(m);
  const xo = world.orders.filter((o) => o.type === 'xometry_cnc');
  const ans = new Map(answers.orders.map((a) => [a.order, a]));
  const evById = new Map(world.events.map((e) => [e.id, e]));
  const slipById = new Map(world.slips.map((s) => [s.id, s]));
  const dl = new Map(world.deliverables.map((d) => [d.id, d]));
  const winEnd = Date.parse(world.meta.window.end);

  // I17 / S9.6: the solver with no override reproduces every realized date
  for (const [id, c] of S.consumers) {
    if (S.pinned.has(id)) continue;
    const real = S.slots.get(id);
    const res = resolveOne(cal, c, S.busy, null);
    if (!real || res.start !== real.start || res.end !== real.end) err(`solver: ${id} re-solves to ${res.start}..${res.end}, realized ${real?.start}..${real?.end}`);
  }
  for (const t of world.tests) {
    if (S.pinned.has(t.id)) continue;
    const s = S.slots.get(t.id);
    if (localDate(t.actual_start) !== s.start || localDate(t.actual_end) !== s.end) err(`solver: test ${t.id} actual dates differ from its slot`);
    const c = S.consumers.get(t.id);
    for (const i of c.inputs) if (i.ready && !(cal.addWd(i.ready, 1) <= s.start)) err(`I7: ${t.id} started ${s.start} before input ${i.id} was usable (${i.ready})`);
    if (c.slotDays && !c.slotDays.includes(new Date(`${s.start}T12:00:00Z`).getUTCDay())) err(`I7: ${t.id} starts off-slot`);
  }
  for (const [unit, list] of S.busy) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    if (!(list[i].end < list[j].start || list[j].end < list[i].start)) err(`I7: ${unit} holds ${list[i].test} and ${list[j].test} at once`);
  }
  for (const m of world.milestones) {
    if (S.pinned.has(m.id) || !m.actual_date) continue;
    const feeders = world.tests.filter((t) => t.milestone === m.id);
    if (feeders.length && milestoneDate(S.M.get(m.id), feeders.map((t) => S.slots.get(t.id).end)) !== m.actual_date) err(`solver: milestone ${m.id} actual_date not reproduced`);
  }
  for (const o of xo) {
    const info = S.info.get(o.id);
    const a = ans.get(o.id);
    const { out } = tierOutcomes(S, info);
    const chosen = a.tier_outcomes.find((t) => t.tier === o.chosen_tier);
    if (info.consumer) {
      const real = S.slots.get(info.consumer.id);
      if (out[o.chosen_tier].start !== real.start) err(`solver: ${o.id} chosen-tier outcome ${out[o.chosen_tier].start} is not the realized start ${real.start}`);
      if (chosen.test_start !== real.start) err(`answers: ${o.id} chosen tier test_start differs from the realized start`);
    }
    if (chosen.ready_date !== localDate(o.ready_at)) err(`answers: ${o.id} chosen ready_date ${chosen.ready_date} != ready_at ${o.ready_at}`);
    // I5
    if (!(Date.parse(o.placed_at) < Date.parse(`${o.promised_date}T23:59:59-08:00`))) err(`I5: ${o.id} placed after its promise`);
    if (localDate(o.placed_at) > o.quote_expires) err(`I5: ${o.id} placed after the quote expired`);
    if (Date.parse(o.delivered_at) > Date.parse(o.ready_at) || Date.parse(o.ready_at) > Date.parse(o.first_use.at)) err(`I5: ${o.id} delivered <= ready <= first use violated`);
    for (let i = 1; i < o.status.length; i++) if (!(Date.parse(o.status[i].known_at) > Date.parse(o.status[i - 1].known_at))) err(`I5: ${o.id} status timeline not increasing`);
    if (o.need_identified_at && Date.parse(o.need_identified_at) > Date.parse(o.quoted_at)) err(`I5: ${o.id} need identified after the quote`);
    // I11 belief half
    const cutoff = beliefCutoff(cal, o.requested_at, a.belief.stale, k.belief.stale_age_days);
    for (const [id, date] of Object.entries(a.belief.inputs)) {
      const d = dl.get(id);
      if (!d) { err(`I11: ${o.id} belief input ${id} is not a deliverable`); continue; }
      if (believedAt(d.eta, cutoff) !== date) err(`I11: ${o.id} belief about ${id} (${date}) is not the announcement as of ${cutoff}`);
    }
    // I12
    for (const id of a.crumbs) {
      const e = evById.get(id);
      const text = JSON.stringify([e.brief, e.refs, e.claim]);
      if (text.includes(o.order_number)) err(`I12: ${id} mentions ${o.order_number} before T`);
      if (e.claim?.kind === 'eta' && e.claim.subject === o.id) err(`I12: ${id} states the promise of ${o.id} before T`);
      if (/expedite|economy|standard/i.test(e.brief) && !e.asks_expedite && !/standard \$/.test(e.brief)) err(`I12: ${id} names a tier before T`);
    }
    if (o.status.some((s) => Date.parse(s.known_at) > winEnd)) err(`I1: ${o.id} status after the window end`);
  }
  // I9 causality
  for (const e of world.events) {
    const s = e.reports ? slipById.get(e.reports) : null;
    if (s && Date.parse(e.known_at) < Date.parse(s.discovered_at || s.occurs_at)) err(`I9: ${e.id} reports ${s.id} before it was discovered`);
    if (e.truth === 'stale' && e.claim.value === e.claim.true_value) err(`I10: ${e.id} is stale but states the current value`);
  }
  // I10 / I32: imperfections exist at the knob rates and are internally consistent
  {
    const ir = k.imperfection_rates;
    const m = answers.summary.crumb_truth_mix;
    const tol = 0.015;
    for (const [name, got, want] of [['stale', m.stale, ir.stale_fact], ['wrong then corrected', m.wrong_corrected, ir.wrong_date_corrected], ['wrong never corrected', m.wrong_never_corrected, ir.wrong_never_corrected], ['contradiction', m.contradiction, ir.contradiction]]) {
      if (Math.abs(got - want) > tol) err(`I32: crumb rate ${name} ${got.toFixed(4)} is not within ${tol} of ${want}`);
    }
    for (const e of world.events) {
      if (e.truth === 'wrong' && JSON.stringify(e.claim.value) === JSON.stringify(e.claim.true_value)) err(`I10: ${e.id} is wrong but states the true value`);
      if (e.truth === 'true' && e.claim && e.claim.true_value !== undefined && JSON.stringify(e.claim.value) !== JSON.stringify(e.claim.true_value)) err(`I10: ${e.id} is marked true but its stated value differs from true_value`);
      if (e.corrects) {
        const t = evById.get(e.corrects);
        if (t.truth !== 'wrong') err(`I10: ${e.id} corrects ${t.id}, which is not wrong`);
        if (JSON.stringify(e.claim.value) !== JSON.stringify(t.claim.true_value)) err(`I10: ${e.id} does not state the true value of ${t.id}`);
        if (!(Date.parse(e.known_at) > Date.parse(t.known_at)) || Date.parse(e.known_at) - Date.parse(t.known_at) > 4 * 86400e3) err(`I10: ${e.id} is not within 5 min-2 wd after ${t.id}`);
      }
      for (const id of e.contradicts || []) {
        const t = evById.get(id);
        if (JSON.stringify(e.claim.value) === JSON.stringify(t.claim.value)) err(`I10: ${e.id} contradicts ${id} but states the same value`);
        if (e.source === t.source && e.where.channel === t.where.channel) err(`I10: ${e.id} contradicts ${id} from the same place`);
        if (Date.parse(e.known_at) < Date.parse(t.known_at) || cal.wdBetween(localDate(t.known_at), localDate(e.known_at)) > 3) err(`I10: ${e.id} is not within 3 wd after ${id}`);
      }
    }
  }
  for (const s of world.slips) if (s.event && evById.get(s.event).known_at !== s.announced_at) err(`I9: ${s.id} announced_at differs from its event`);
  // I3 history order and creation
  const hists = [];
  for (const t of world.tests) hists.push([t.id, t.planned_date]);
  for (const d of world.deliverables) hists.push([d.id, d.eta]);
  for (const m of world.milestones) hists.push([m.id, m.date]);
  for (const p of world.parts) hists.push([p.id, p.revisions]);
  for (const t of world.tickets) { hists.push([t.id, t.status]); if (Date.parse(t.status[0].known_at) < Date.parse(t.created)) err(`I3: ${t.id} status before creation`); }
  for (const [id, h] of hists) for (let i = 1; i < h.length; i++) if (Date.parse(h[i].known_at) < Date.parse(h[i - 1].known_at)) err(`I3: history of ${id} not sorted`);
  // I8 pinned
  const demo = world.demo;
  if (demo) {
    const guard = cal.addWd(cal.demoNow, -30);
    for (const o of xo) if (o.lines.some((l) => l.part === demo.part) && localDate(o.placed_at) > guard) err(`I8: ${o.id} orders the demo part inside the last 30 wd`);
    const prog = S.seedProgram;
    if (prog) for (const [coll, id] of [['parts', demo.part], ['tests', demo.test], ['deliverables', demo.motor.deliverable], ['milestones', demo.milestone]]) {
      const seed = (prog[coll] || []).find((x) => x.id === id);
      const got = world[coll].find((x) => x.id === id);
      if (!seed || !got) { err(`I8: pinned ${id} missing`); continue; }
      for (const key of ['revisions', 'planned_date', 'eta', 'date', 'true_arrival', 'earliest_start']) if (key in seed && Array.isArray(seed[key]) && JSON.stringify(seed[key]) !== JSON.stringify(got[key])) err(`I8: pinned ${id}.${key} changed`);
      if (seed.true_arrival && seed.true_arrival !== got.true_arrival) err(`I8: pinned ${id}.true_arrival changed`);
    }
  }
  // I14 both ends
  for (const e of world.edges) {
    const evs = e.revealed_by.map((id) => evById.get(id));
    const both = (ev) => { const a = ev.refs.find((r) => r.id === e.from); const b = ev.refs.find((r) => r.id === e.to); return a && b && a.mode !== 'vague' && b.mode !== 'vague'; };
    if (evs.some((ev) => !ev.refs.some((r) => r.id === e.from) || !ev.refs.some((r) => r.id === e.to))) err(`I14: ${e.id} lists an event that does not reference both ends`);
    if (e.reveal === 'revealed' && !evs.some(both)) err(`I14: ${e.id} revealed without an event naming both ends`);
    if (e.reveal === 'hinted' && evs.some(both)) err(`I14: ${e.id} hinted but an event names both ends`);
  }
  // statistics against the targets (warnings: tuning, not structure)
  const s = answers.summary;
  const range = (name, v, [lo, hi]) => { if (!(v >= lo && v <= hi)) warnings.push(`${name} ${typeof v === 'number' ? +v.toFixed(3) : v} outside ${lo}-${hi}`); };
  const tg = k.targets;
  range('xometry orders', s.xometry_orders, tg.xometry_orders);
  for (const t of ['expedite', 'standard', 'economy']) range(`tier ${t}`, s.tier_mix[t], tg.tier_mix[t]);
  range('burst expedite', s.tier_mix_burst.expedite, tg.burst_expedite);
  for (const [r, band] of Object.entries(tg.hidden_reason_mix)) range(`reason ${r}`, s.hidden_reason_mix[r] || 0, [band[0] - 0.02, band[1] + 0.02]);
  range('expedites that truly gained', s.expedite_true_gain_share, tg.expedite_true_gain_share);
  range('revision share', s.revision_share, tg.revision_share);
  // owner decision: 1 Xometry order in 40 arrives after its promised date (hard check)
  if (tg.late_share && !(s.late_share >= tg.late_share[0] && s.late_share <= tg.late_share[1])) err(`late share ${s.late_share.toFixed(4)} outside ${tg.late_share[0]}-${tg.late_share[1]} (k.targets.late_share)`);
  range('distinct requesters', s.distinct_requesters, [16, 22]);
  range('buyer-placed share', s.buyer_placed_share, [0.33, 0.47]);
  range('order total median', s.order_total_usd.median, [600, 900]);
  range('order total sum', s.order_total_usd.sum, [400000, 700000]);
  range('other-vendor orders', world.orders.filter((o) => o.type === 'other' && !o.recurring).length, [1250, 2200]);
  range('SaaS charges', world.orders.filter((o) => o.recurring).length, [250, 400]);
  range('usable orders', s.usable_orders.count, [120, 170]);
  for (const [q, v] of Object.entries(k.link_quality_mix)) range(`link quality ${q}`, s.link_quality_mix[q], [v - 0.04, v + 0.04]);
  return { errors, warnings };
}
