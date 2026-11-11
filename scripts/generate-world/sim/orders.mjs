// S6 demand, S7 quotes, S8 the decision, S10 approval and fulfilment for Xometry orders.
import { solveStart } from './solve.mjs';
import { atLocal, atLocalMinutes, addMinutes, addDays, dow, localDate, localMinutes } from '../lib/calendar.mjs';
import { cmp, roundMoney } from '../lib/io.mjs';
import { uuid } from './setup.mjs';

const CAT = {
  sensor_bracket: { price: [60, 250], lead: [[12, 15], [7, 10], [3, 4]], prem: [0.4, 0.8] },
  motor_mount_plate: { price: [180, 600], lead: [[13, 14], [8, 10], [4, 4]], prem: [0.5, 0.9] },
  housing: { price: [350, 1400], lead: [[14, 15], [9, 10], [5, 5]], prem: [0.5, 1.0] },
  drive_shaft: { price: [150, 700], lead: [[14, 15], [9, 10], [4, 5]], prem: [0.5, 0.9] },
  adapter_plate: { price: [90, 450], lead: [[11, 12], [7, 9], [3, 4]], prem: [0.4, 0.8] },
  test_fixture: { price: [120, 900], lead: [[10, 14], [7, 8], [3, 4]], prem: [0.4, 1.0] },
  spacer_bushing: { price: [80, 400], lead: [[11, 12], [7, 8], [3, 3]], prem: [0.3, 0.7] },
  arm_link: { price: [250, 1100], lead: [[14, 15], [9, 10], [4, 5]], prem: [0.5, 1.0] },
};
const TIERS = ['economy', 'standard', 'expedite'];
const WEIGHT = { heavy: 6, medium: 2.5, light: 0.7, none: 0 };
const DL_KINDS = [['pcba', 3, 'Driver PCBA respin'], ['pcb', 2, 'Sensor breakout PCB'], ['firmware', 4, 'Firmware build'], ['harness', 3, 'Wire harness'], ['sensor', 2, 'Encoder kit'], ['motor', 2, 'Motor sample lot'], ['other', 2, 'Bearing set']];
const WI_NAMES = {
  test_hardware: ['Rig setup', 'Fixture install and shakedown', 'Instrumentation fit-up', 'Test stand rework'],
  build_part: ['Build sub-assembly', 'Assemble build unit', 'Kit and assemble', 'Install and torque'],
  iteration: ['Fit check', 'Design iteration bench trial', 'Tolerance stack check', 'Prototype fit-up'],
};

export function believedAt(hist, iso) {
  const t = Date.parse(iso);
  let v = null;
  for (const h of hist) if (Date.parse(h.known_at) <= t) v = h.value;
  return v ?? hist[0].value;
}
// The moment whose announcements the decider had seen: requested_at, or stale_age wd earlier.
export function beliefCutoff(cal, requestedAt, stale, ageDays) {
  if (!stale) return requestedAt;
  return atLocalMinutes(cal.addWd(localDate(requestedAt), -ageDays), localMinutes(requestedAt));
}

export function runOrders(S) {
  const { world, cal, k, rng } = S;
  const ko = k.orders;
  const people = world.people;
  const buyers = people.filter((p) => p.team === 't-supply' && p.orders.weight === 'heavy').map((p) => p.id);
  if (!buyers.length) buyers.push(...people.filter((p) => p.team === 't-supply').slice(0, 2).map((p) => p.id));
  S.buyers = buyers;
  let requesters = people.filter((p) => p.orders.weight !== 'none' && !buyers.includes(p.id));
  requesters.sort((a, b) => WEIGHT[b.orders.weight] - WEIGHT[a.orders.weight] || cmp(a.id, b.id));
  requesters = requesters.slice(0, 20);
  const reqW = requesters.map((p) => WEIGHT[p.orders.weight]);
  const demoNowDay = cal.demoNow;
  const demoGuard = cal.addWd(demoNowDay, -30);
  const unitIds = new Set([...world.test_rigs, ...world.resources].map((u) => u.id));
  const slotted = [...world.test_rigs, ...world.resources].filter((u) => u.slot_days?.length);
  const asmOfUnit = new Map();
  for (const t of world.tests) for (const u of [t.rig, ...t.resources].filter(Boolean)) { if (!asmOfUnit.has(u)) asmOfUnit.set(u, []); asmOfUnit.get(u).push(t.assembly); }
  const robotParts = new Map(world.assemblies.map((a) => [a.id, world.parts.filter((p) => p.belongs_to === a.id && p.kind === 'robot_part')]));
  const thParts = new Map(world.assemblies.map((a) => [a.id, world.parts.filter((p) => p.kind === 'test_hardware' && (p.belongs_to === a.id || (asmOfUnit.get(p.belongs_to) || []).includes(a.id)))]));
  const allTh = world.parts.filter((p) => p.kind === 'test_hardware');
  const asmOfTeam = (team) => world.assemblies.filter((a) => a.team === team);
  const orderedRevs = new Map(); // part -> Set of revisions ordered
  const edgeMap = new Map();
  S.edge = (from, to, kind = 'requires_all') => {
    const key = `${from}|${to}`;
    if (!edgeMap.has(key)) { const e = { id: S.nextId('e', 5), from, to, kind, group: null, reveal: 'never', revealed_by: [], note: null }; edgeMap.set(key, e); world.edges.push(e); }
    return edgeMap.get(key);
  };
  S.info = new Map();
  const weekOfDay = (d) => world.meta.weeks.find((w) => w.week_start === cal.weekOf(d));
  const lastDay = cal.windowEnd;
  const firstDay = cal.addWd(cal.windowStart, 0);

  // ---- intents ----
  const intents = [];
  const structuralPerWeek = new Map();
  for (const t of world.tests) {
    if (S.pinned.has(t.id)) continue;
    const c = S.consumers.get(t.id);
    const r = rng.fork(`structural:${t.id}`);
    const partsIn = c.inputs.filter((i) => i.part).map((i) => S.PT.get(i.id));
    const owner = S.P.get(t.owner);
    let i = 0;
    while (i < partsIn.length) {
      const n = Math.min(partsIn.length - i, +r.weighted([1, 2, 3, 4], [3, 4, 2, 1]));
      const chunk = partsIn.slice(i, i + n); i += n;
      const requester = owner.orders.weight !== 'none' && !buyers.includes(owner.id) ? owner : (requesters.find((p) => p.team === S.A.get(t.assembly).team && r.chance(0.5)) || requesters.find((p) => p.team === 't-test') || requesters[0]);
      const cls = drawClass(r, requester, 'normal');
      // working days from the order to the need-by (2 wd before the planned start), by trigger class
      const span = cls === 'early' ? r.int(18, 28) : cls === 'on_time' ? r.int(11, 12) : r.int(3, 6);
      let day = cal.addWd(t.planned_date[0].value, -(2 + span));
      if (day < firstDay) day = cal.addWd(firstDay, r.int(0, 3));
      if (day > lastDay) continue;
      intents.push({ day, structural: true, test: t, parts: chunk, requester, cls, kind: 'test_hardware' });
      const ws = cal.weekOf(day);
      structuralPerWeek.set(ws, (structuralPerWeek.get(ws) || 0) + 1);
    }
  }
  for (const w of world.meta.weeks) {
    const r = rng.fork(`week:${w.week_start}`);
    const wds = cal.wdsOfWeek(w.week_start);
    if (!wds.length) continue;
    const lambda = ko.per_week * w.activity * Math.min(1, wds.length / 5 + (wds.length < 4 ? 0.1 : 0.2));
    const n = Math.max(0, r.poisson(lambda) - (structuralPerWeek.get(w.week_start) || 0));
    for (let i = 0; i < n; i++) intents.push({ day: cal.orderDay(r, w.week_start), structural: false });
  }
  intents.forEach((x, i) => { x.seq = i; });
  intents.sort((a, b) => cmp(a.day, b.day) || a.seq - b.seq);

  function drawClass(r, requester, weekKind) {
    const burst = weekKind === 'burst';
    const pLate = ko.trigger_mix.late * (burst ? ko.burst_late_mult : 1) * (requester.orders.habit === 'last_minute' ? ko.last_minute_late_mult : 1);
    const pRel = (ko.late_release_rate ?? 0.1) * (burst ? (ko.burst_release_mult ?? ko.burst_late_mult) : 1);
    const u = r.float();
    if (u < pLate) return 'late';
    if (u < pLate + pRel) return 'late_release';
    const pEarly = ko.trigger_mix.early * (burst ? (ko.burst_early_mult ?? 1) : 1);
    return r.chance(pEarly / (pEarly + ko.trigger_mix.on_time)) ? 'early' : 'on_time';
  }
  const released = (p, iso) => { let v = null; for (const h of p.revisions) if (Date.parse(h.known_at) <= Date.parse(iso)) v = h.value; return v; };
  const priceQ1 = (p, rev) => {
    const pr = rng.fork(`price:${p.id}:${rev}`);
    const c = CAT[p.category] || CAT.adapter_plate;
    const typ = Math.max(1, p.typical_qty);
    const lot = p.price_hint_usd ? p.price_hint_usd * pr.uniform(0.85, 1.2) : Math.exp(pr.uniform(Math.log(c.price[0]), Math.log(c.price[1]))) * Math.pow(typ, 0.35);
    return (lot / typ) * Math.pow(typ, -k.quote.qty_exponent);
  };

  let seq = 0;
  let placedCount = 0;
  const lateOffset = rng.fork("lateness").float();
  for (const it of intents) {
    seq++;
    const r = rng.fork(`order:${seq}`);
    const day = it.day;
    const week = weekOfDay(day);
    let burst = week?.kind === 'burst';
    // --- who, what for ---
    const kind = it.kind || r.weighted(ko.kind_mix);
    const requester = it.requester || r.weighted(requesters, reqW);
    let assembly;
    if (it.test) assembly = it.test.assembly;
    else {
      const own = asmOfTeam(requester.team);
      assembly = (own.length ? r.pick(own) : r.pick(world.assemblies)).id;
    }
    const trigger_at = cal.sampleBusinessTime(r, day, 8 * 60, 14 * 60 + 30);
    const buyerPlaced = r.chance(ko.buyer_placed_share);
    const placer = buyerPlaced ? S.P.get(r.pick(buyers)) : requester;
    let reqDay = day;
    if (buyerPlaced) {
      const qd = placer.orders.queue_delay_days || [0, 2];
      reqDay = cal.addWd(day, r.int(qd[0], qd[1]));
      if (placer.orders.batch_days?.length) for (let g = 0; g < 6 && !placer.orders.batch_days.includes(dow(reqDay)); g++) reqDay = cal.nextWd(reqDay);
      if (reqDay > lastDay) reqDay = day;
    }
    burst = weekOfDay(reqDay)?.kind === 'burst'; // the week the tier is decided in
    const requested_at = reqDay === day ? addMinutes(trigger_at, r.int(15, 150)) : cal.sampleBusinessTime(r, reqDay, 8 * 60 + 30, 15 * 60 + 30);
    let quoted_at = addMinutes(requested_at, -r.int(10, 120));
    if (reqDay === day && Date.parse(quoted_at) < Date.parse(trigger_at) + 180e3) quoted_at = addMinutes(trigger_at, 3);
    const decider = buyerPlaced && r.chance(ko.buyer_decides_share) ? placer : requester;

    // --- lines ---
    let lineParts = it.parts;
    if (!lineParts) {
      const n = +r.weighted([1, 2, 3, 4, 5, 6], ko.lines_mix);
      let pool = kind === 'test_hardware' ? thParts.get(assembly) : kind === 'rig_misc' ? allTh : robotParts.get(assembly);
      if (!pool || !pool.length) pool = kind === 'test_hardware' || kind === 'rig_misc' ? allTh : world.parts.filter((p) => p.kind === 'robot_part');
      pool = pool.filter((p) => released(p, quoted_at) && !(S.pinned.has(p.id) && day > demoGuard));
      if (!pool.length) {
        // nothing of this assembly is released yet: order for another assembly that has released parts
        const any = world.parts.filter((p) => released(p, quoted_at) && !S.pinned.has(p.id) && S.A.has(p.belongs_to) && p.kind === 'robot_part');
        if (!any.length) continue;
        assembly = r.pick(any).belongs_to;
        pool = any.filter((p) => p.belongs_to === assembly);
      }
      lineParts = r.sample(pool, Math.min(n, pool.length));
    } else {
      lineParts = lineParts.filter((p) => !(S.pinned.has(p.id) && day > demoGuard));
      if (!lineParts.length) continue;
    }
    let isRevision = false;
    let newRev = false;
    const lines = [];
    for (const p of lineParts) {
      let rev = released(p, quoted_at);
      const had = orderedRevs.get(p.id) || new Set();
      const last = p.revisions[p.revisions.length - 1];
      if (!rev) {
        // structural part not yet released: release it now (a late design release)
        const at = addMinutes(quoted_at, -r.int(30, 600));
        const t = Date.parse(at) < S.winStart ? world.meta.window.start : at;
        if (Date.parse(p.revisions[0].known_at) > Date.parse(t)) { p.revisions[0].known_at = t; p.revisions[0].effective = localDate(t); }
        rev = p.revisions[0].value;
      } else if (had.size && !S.pinned.has(p.id) && last.value === rev && r.chance(ko.new_rev_rate)) {
        const relDay = cal.addWd(day, -r.int(0, 2));
        let at = cal.sampleBusinessTime(r, relDay);
        if (Date.parse(at) >= Date.parse(quoted_at)) at = addMinutes(quoted_at, -r.int(20, 90));
        if (Date.parse(at) > Date.parse(last.known_at) && Date.parse(at) >= S.winStart) {
          const next = String.fromCharCode(Math.min(90, rev.charCodeAt(rev.length - 1) + 1));
          const owner = S.A.get(p.belongs_to)?.owner || requester.id;
          p.revisions.push({ value: next, effective: localDate(at), known_at: at, by: owner, where: null, reason: r.pick(['tolerance relaxed after DFM feedback', 'hole pattern moved', 'wall thickened after test', 'clearance for harness', 'material change', 'fit issue found at assembly']) });
          rev = next; newRev = true;
        }
      }
      if (had.size && !had.has(rev)) isRevision = true;
      const qmw = ko.qty_mult_weights ?? [1, 5, 2, 0.5];
      const qty = Math.min(ko.max_line_qty ?? 24, Math.max(1, Math.round(Math.min(p.typical_qty, 12) * +r.weighted([0.5, 1, 2, 3, 6, 14, 30].slice(0, qmw.length), qmw))));
      const unitStd = Math.max(k.quote.min_unit_usd ?? 18, priceQ1(p, rev) * Math.pow(qty, k.quote.qty_exponent) * r.uniform(0.97, 1.03) * k.quote.price_scale) + 0.01 * r.int(0, 9);
      lines.push({ p, rev, qty, unitStd });
    }

    // --- quote (S7) ---
    const cats = lines.map((l) => CAT[l.p.category] || CAT.adapter_plate);
    const lead = [0, 1, 2].map((i) => Math.max(...cats.map((c) => r.int(c.lead[i][0], c.lead[i][1]))));
    if (lead[1] >= lead[0]) lead[0] = lead[1] + r.int(2, 4);
    if (lead[2] >= lead[1]) lead[2] = lead[1] - 3;
    const stdSub = lines.reduce((s, l) => s + roundMoney(l.unitStd) * l.qty, 0);
    let prem = r.uniform(cats[0].prem[0], cats[0].prem[1]);
    if (stdSub < k.quote.small_lot_usd) prem *= k.quote.small_lot_premium_mult;
    const factor = [1 - r.uniform(k.quote.economy_discount[0], k.quote.economy_discount[1]), 1, 1 + prem];
    const startDay = localMinutes(requested_at) < 12 * 60 ? reqDay : cal.nextWd(reqDay);
    const transit = [r.int(1, 4), 0, r.int(1, 2)]; transit[1] = transit[0];
    const tiersAll = TIERS.map((tier, i) => {
      const units = lines.map((l) => { let u = roundMoney(l.unitStd * factor[i]); if (Math.round(u * 100) % 100 === 0) u = roundMoney(u + 0.01 * r.int(11, 89)); return u; });
      const subtotal = roundMoney(units.reduce((s, u, j) => s + u * lines[j].qty, 0));
      const shipping = i === 2 ? roundMoney(r.uniform(k.quote.expedite_shipping_usd[0], k.quote.expedite_shipping_usd[1])) : 0;
      const tax = roundMoney(k.quote.tax_rate * subtotal);
      const est_ship = cal.addWd(startDay, lead[i]);
      return { tier, units, subtotal_usd: subtotal, shipping_usd: shipping, tax_usd: tax, total_usd: roundMoney(subtotal + shipping + tax), lead_business_days: lead[i], est_ship, est_delivery: cal.addWd(est_ship, transit[i]) };
    });
    if (!(tiersAll[0].subtotal_usd < tiersAll[1].subtotal_usd && tiersAll[1].subtotal_usd < tiersAll[2].subtotal_usd)) continue;
    const econQuoted = !r.chance(0.08);
    const [tE, tS, tX] = tiersAll;

    // --- consumer ---
    const id = S.nextId('ord-x', 5);
    let cls = it.cls || drawClass(r, requester, burst ? 'burst' : 'normal');
    // spares are never urgent; a rig part has no design release to be late
    if (kind === 'spare') cls = 'early';
    if (kind === 'rig_misc' && cls === 'late_release') cls = 'on_time';
    // Need-by by trigger class, in working days from the request (S6.3):
    //   early    Economy still arrives with 11-22 wd to spare
    //   on time  Standard arrives in time, Economy would not
    //   late     needed sooner than the Standard lead time (late by choice, or a late design release)
    const stdTot = cal.wdBetween(reqDay, tS.est_delivery);
    const econTot = cal.wdBetween(reqDay, tE.est_delivery);
    const spanOf = () => (cls === 'early' ? econTot + r.int(11, 22) : cls === 'on_time' ? r.int(stdTot, Math.max(stdTot, Math.min(lead[0], econTot - 1))) : Math.max(1, lead[1] - r.int(1, 5)));
    const lateByChoice = cls === 'late';
    let consumer = null;
    let needWritten = null;
    let hiddenNeed = null;
    let sibling = null;
    let wi = null;
    let target = null;
    if (it.test) {
      consumer = S.consumers.get(it.test.id);
    } else if (kind !== 'spare' && kind !== 'rig_misc') {
      needWritten = cal.addWd(reqDay, spanOf());
      let P = cal.addWd(needWritten, 1);
      let slotDays = null;
      let unit = null;
      if (slotted.length && (cls === 'late' || cls === 'late_release') && r.chance(ko.slotted_rate ?? 0.1)) {
        // a slotted resource: the work can only start on its slot days
        unit = r.pick(slotted); slotDays = unit.slot_days;
        // the slot at or before the planned start if there is still one ahead, else the next one
        let back = P;
        for (let g = 0; g < 7 && !slotDays.includes(dow(back)); g++) back = cal.prevWd(back);
        if (slotDays.includes(dow(back)) && back > cal.addWd(reqDay, 2)) P = back;
        else for (let g = 0; g < 7 && !slotDays.includes(dow(P)); g++) P = cal.nextWd(P);
        needWritten = cal.addWd(P, -1);
      }
      if (cls !== 'late' && cls !== 'late_release' && r.chance(ko.hidden_need_rate)) hiddenNeed = cal.addWd(reqDay, Math.max(1, lead[1] - r.int(1, 5)));
      const est = r.int(1, 5);
      const dur = Math.max(1, Math.round(est * r.lognormal(1.25, 0.45)));
      const owner = r.chance(0.7) ? requester.id : (S.A.get(assembly).owner);
      const ms = S.nextMilestone(assembly, P);
      wi = {
        id: S.nextId('wi', 5), name: `${r.pick(WI_NAMES[kind])}: ${lines[0].p.name}`, owner, assembly, duration_true_days: dur,
        duration_estimate_days: [est, est + r.int(0, 1)], blocked_by: [], status: [], milestone: ms ? ms.id : null, actual_start: null, actual_done: null,
      };
      world.work_items.push(wi);
      // the owner is often not free on the planned day (serial work): the true earliest start is later than the written one
      const lateCls = cls === "late" || cls === "late_release";
      const ownerDelay = !hiddenNeed && !lateCls && r.chance(ko.start_delay_rate ?? 0.5) ? r.int(3, 9) : 0;
      let earliest = hiddenNeed ? cal.addWd(hiddenNeed, 1) : cal.addWd(P, ownerDelay);
      if (slotDays) for (let g = 0; g < 7 && !slotDays.includes(dow(earliest)); g++) earliest = cal.nextWd(earliest);
      consumer = { id: wi.id, type: 'work_item', earliest, believedStart: P, slotDays, duration: dur, units: [], unit: unit?.id || null, milestone: null, inputs: [], created: cal.addWd(reqDay, -r.int(2, 12)), kind };
      S.consumers.set(wi.id, consumer);
      if (unit) { wi.blocked_by.push(unit.id); S.edge(unit.id, wi.id); }
      // The real test run or build this step prepares for: test hardware feeds the next test on its rig or assembly,
      // robot parts feed the next build of their assembly. The step must be done before it (a true edge).
      {
        const after = cal.addWd(P, dur + (ko.step_margin_days ?? 12));
        const home = lines[0].p.belongs_to;
        if (kind === 'test_hardware') {
          const ts = world.tests.filter((t) => !S.pinned.has(t.id) && (t.rig === home || t.resources.includes(home) || t.assembly === assembly) && believedAt(t.planned_date, requested_at) >= after)
            .sort((a, b) => cmp(believedAt(a.planned_date, requested_at), believedAt(b.planned_date, requested_at)) || cmp(a.id, b.id));
          if (ts.length) target = { test: ts[0] };
        }
        if (!target) {
          const ms = world.milestones.filter((m) => !S.pinned.has(m.id) && m.assemblies.includes(assembly) && believedAt(m.date, requested_at) >= after)
            .sort((a, b) => cmp(believedAt(a.date, requested_at), believedAt(b.date, requested_at)) || cmp(a.id, b.id));
          const pick = ms.find((m) => m.kind === 'build') || ms[0];
          if (pick) target = { ms: pick };
        }
        const tn = target?.test || target?.ms;
        if (tn) { wi.name = wi.name.replace(': ', ` for ${tn.name}: `); S.edge(wi.id, tn.id); }
        if (target?.test) { wi.milestone = target.test.milestone ?? wi.milestone; S.consumers.get(target.test.id).inputs.push({ id: wi.id, consumer: wi.id, ready: null }); }
        if (target?.ms) wi.milestone = target.ms.id;
      }
      // sibling input
      if (r.chance(lateCls ? (ko.late_sibling_rate ?? 0.55) : (ko.sibling_rate ?? 0.38))) {
        const lo = cal.addWd(P, -12); const hi = cal.addWd(P, 2);
        const cands = world.deliverables.filter((d) => !S.pinned.has(d.id) && d.assembly === assembly && !d._gen && (() => { const b = believedAt(d.eta, requested_at); return b >= lo && b <= hi && Date.parse(d.eta[0].known_at) <= Date.parse(requested_at); })());
        if (cands.length) sibling = r.pick(cands);
        else {
          const kd = r.weighted(DL_KINDS.map((x) => [x, x[1]]));
          const internal = ['firmware', 'harness'].includes(kd[0]);
          const team = kd[0] === 'firmware' ? 't-firmware' : ['pcb', 'pcba', 'harness'].includes(kd[0]) ? 't-electrical' : null;
          const members = team ? (S.T.get(team)?.members || []) : [];
          const dOwner = members.length ? r.pick(members) : S.A.get(assembly).owner;
          const firstKnown = cal.addWd(reqDay, -r.int(5, 25));
          const fk = firstKnown < firstDay ? firstDay : firstKnown;
          const did = `dl-gen-${String(S.nextId('dlg', 4)).slice(4)}`;
          sibling = { id: did, name: `${kd[2]} for ${S.A.get(assembly).name.toLowerCase()} (${lines[0].p.aliases[0] || lines[0].p.name})`, kind: kd[0], owner: dOwner, assembly, vendor: null, order: null, eta: [{ value: lateCls ? cal.addWd(tS.est_delivery, r.int(ko.late_sibling_eta_offset?.[0] ?? 0, ko.late_sibling_eta_offset?.[1] ?? 5)) : cal.addWd(P, -r.int(1, 7)), effective: null, known_at: cal.sampleBusinessTime(r, fk), by: dOwner, where: null }], true_arrival: null, _gen: true };
          if (Date.parse(sibling.eta[0].known_at) >= Date.parse(requested_at)) sibling.eta[0].known_at = addMinutes(requested_at, -r.int(60, 600));
          if (Date.parse(sibling.eta[0].known_at) < S.winStart) sibling.eta[0].known_at = world.meta.window.start;
          world.deliverables.push(sibling); S.DL.set(did, sibling);
          S.simulateDeliverable(S, sibling, { internal, estimate: r.int(5, 15) });
        }
        consumer.inputs.push({ id: sibling.id, ready: sibling.true_arrival });
        wi.blocked_by.push(sibling.id);
        S.edge(sibling.id, wi.id);
      }
    }

    // spares and rig parts feed nothing, but people still write a soft need-by for them
    if (!consumer) needWritten = cal.addWd(reqDay, spanOf());

    // --- belief snapshot and decision (S8) ---
    const stale = r.chance(k.belief.stale_rate);
    const ignored = !r.chance(decider.orders.checks_dependencies ?? 0.6);
    const cutoff = beliefCutoff(cal, requested_at, stale, k.belief.stale_age_days);
    let needBelieved = needWritten;
    let believedStart = null;
    const beliefInputs = {};
    if (consumer) {
      if (it.test) { believedStart = believedAt(it.test.planned_date, cutoff); needWritten = cal.addWd(believedAt(it.test.planned_date, requested_at), -2); needBelieved = cal.addWd(believedStart, -2); } else { believedStart = hiddenNeed ? cal.addWd(hiddenNeed, 1) : consumer.believedStart; needBelieved = hiddenNeed || needWritten; }
      for (const i of consumer.inputs) { const d = S.DL.get(i.id); if (d && Date.parse(d.eta[0].known_at) <= Date.parse(cutoff)) beliefInputs[i.id] = believedAt(d.eta, cutoff); }
    }
    const gain = { economy: 0, standard: 0, expedite: 0 };
    if (consumer) {
      const others = ignored ? [] : Object.values(beliefInputs);
      const bc = { id: consumer.id, earliest: believedStart, slotDays: consumer.slotDays, duration: consumer.duration };
      const st = tiersAll.map((t) => solveStart(cal, bc, [t.est_delivery, ...others].reduce((a, b) => (a > b ? a : b))).start);
      const base = econQuoted ? st[0] : st[1];
      gain.economy = 0; gain.standard = cal.wdBetween(st[1], base); gain.expedite = cal.wdBetween(st[2], base);
      gain._exp_std = cal.wdBetween(st[2], st[1]);
    }
    const pv = S.pressureValue(assembly, reqDay);
    const habit = decider.orders.habit;
    const ms = consumer?.milestone ? S.M.get(consumer.milestone) : (wi?.milestone ? S.M.get(wi.milestone) : null);
    const policy = ms ? believedAt(ms.value_policy, requested_at) : null;
    const wtp = !ignored && policy?.type === 'per_day' ? policy.usd_per_day : (decider.orders.wtp_per_day_usd ?? k.decide.wtp_median_usd);
    const slack = needBelieved ? cal.wdBetween(reqDay, needBelieved) : null;
    let rule; let tier;
    const kd = k.decide;
    const noise = r.chance(kd.noise);
    const habitFire = r.chance(Math.min(1, (decider.orders.habit_strength ?? kd.habit_strength) * (kd.habit_scale ?? 1) * (kd.habit_scale_by_habit?.[habit] ?? 1)));
    const budgetFire = r.chance(kd.budget_fire);
    const pressFire = r.chance(kd.pressure_factor * pv * (burst ? kd.burst_pressure_mult : 1));
    const jitter = r.lognormal(1, kd.wtp_jitter_sigma);
    const extra = tX.total_usd - tS.total_usd;
    if (kind === 'spare') { rule = 1; tier = r.weighted(kd.spare_tier); }
    else if (['over_expedites', 'always_standard', 'budget_conscious'].includes(habit) && habitFire) { rule = 2; tier = habit === 'over_expedites' ? 'expedite' : habit === 'always_standard' ? 'standard' : 'economy'; }
    else if (S.inBudgetWindow(reqDay) && budgetFire) { rule = 3; tier = r.weighted(kd.budget_tier); }
    else if (needBelieved && tS.est_delivery > needBelieved && lateByChoice) { rule = 4; tier = r.weighted(kd.late_tier); }
    else if ((S.level(pv) === 'high' || S.inPressureWindow(reqDay, assembly)) && pressFire) { rule = 5; tier = r.weighted(kd.pressure_tier); }
    else if (!noise && consumer && gain._exp_std >= 1 && extra / gain._exp_std <= wtp * (kd.wtp_scale ?? 1) * jitter * (burst ? kd.burst_wtp_mult : 1)) { rule = 6; tier = 'expedite'; }
    else if (econQuoted && needBelieved && tE.est_delivery > needBelieved && tS.est_delivery <= needBelieved) { rule = 6; tier = 'standard'; }
    else { rule = 7; const m = { ...kd.default_tier }; if (slack != null && slack > 15) { m.economy = kd.default_economy_if_slack_over_15; m.standard = 1 - m.economy - m.expedite; } tier = r.weighted(m); }
    if (tier === 'economy' && !econQuoted) tier = 'standard';
    delete gain._exp_std;
    if (!econQuoted) delete gain.economy;
    const chosen = tiersAll[TIERS.indexOf(tier)];

    // --- approval (S10) ---
    const fin = world.finance.approval;
    const auto = chosen.total_usd < fin.auto_approve_under_usd;
    const mgr = S.P.get(requester.manager) || requester;
    const approver = chosen.total_usd > fin.second_approver_over_usd ? fin.second_approver : mgr.id;
    let approved_at;
    if (auto) approved_at = addMinutes(requested_at, r.int(1, 5));
    else {
      const u = r.float();
      const mins = Math.max(4, Math.round(r.lognormal(150, 0.8)));
      approved_at = addMinutes(requested_at, mins);
      if (u < 0.13 || localMinutes(approved_at) > 18 * 60 || localDate(approved_at) !== reqDay) approved_at = cal.sampleBusinessTime(r, cal.addWd(reqDay, u < 0.03 ? 2 : 1), 8 * 60 + 15, 11 * 60);
    }
    let placed_at = addMinutes(approved_at, r.int(2, 40));
    if (Date.parse(placed_at) > S.winEnd) { approved_at = addMinutes(requested_at, 6); placed_at = addMinutes(approved_at, 4); }
    if (Date.parse(placed_at) > S.winEnd) continue;
    if (!(localDate(placed_at) < chosen.est_delivery)) continue;

    // --- fulfilment, pre-drawn for every tier from shared uniforms (S9.1) ---
    const kf = k.fulfil;
    // stratified over orders (golden-ratio sequence) so the late share is 1 in 40 at any volume, not 1 in 40 on average
    placedCount++;
    const uLate = (lateOffset + placedCount * 0.6180339887498949) % 1; const uSize = r.float(); const inspLag = r.int(0, 1);
    const lateOf = (isExp) => {
      const m = isExp ? kf.expedite_late_mult : 1;
      const L = kf.lateness;
      const bands = [[L.late_7_15 * m, 7, 15], [L.late_3_6 * m, 3, 6], [L.late_1_2 * m, 1, 2]];
      let acc = 0;
      for (const [p, lo, hi] of bands) { acc += p; if (uLate < acc) return lo + Math.floor(uSize * (hi - lo + 1)); }
      if (uLate > 1 - L.early) return -(1 + Math.floor(uSize * 2));
      return 0;
    };
    const delivered = {}; const ready = {};
    tiersAll.forEach((t, i) => {
      let d = cal.addWd(t.est_delivery, lateOf(i === 2));
      if (d <= cal.addWd(localDate(placed_at), 1)) d = t.est_delivery;
      delivered[t.tier] = d; ready[t.tier] = inspLag ? cal.addWd(d, 1) : d;
    });
    const recorded = r.chance(kf.inspection_recorded);
    const dDay = delivered[tier];
    const delivered_at = atLocalMinutes(dDay, r.int(9 * 60 + 30, 15 * 60), r.int(0, 59));
    const inspAt = inspLag ? atLocalMinutes(ready[tier], r.int(8 * 60 + 30, 11 * 60), r.int(0, 59)) : addMinutes(delivered_at, r.int(20, 150));
    const inspector = S.T.get('t-techs')?.members?.length ? r.pick(S.T.get('t-techs').members) : requester.id;
    const shipDay = cal.addWd(dDay, -transit[TIERS.indexOf(tier)]);
    const status = [{ value: 'order_placed', effective: placed_at, known_at: placed_at, by: placer.id, where: null }];
    const pushStatus = (value, at) => { if (Date.parse(at) <= S.winEnd && Date.parse(at) > Date.parse(status[status.length - 1].known_at)) status.push({ value, effective: at, known_at: at, by: null, where: null }); };
    // DFM hold (S10): Xometry asks a question before production starts; the answer comes 1-3 wd later.
    // The hold is absorbed inside the quoted lead time, so the promise and the delivery do not move.
    const rd = rng.fork(`dfm:${id}`);
    const hold = rd.chance(kf.dfm_hold) ? rd.int(1, 3) : 0;
    const prodDay = cal.addWd(localDate(placed_at), 1 + hold);
    const prodAt = atLocalMinutes(cal.addWd(localDate(placed_at), 1), r.int(6 * 60, 9 * 60), r.int(0, 59));
    if (hold && prodDay < shipDay) {
      pushStatus('dfm_review', addMinutes(placed_at, rd.int(8, 55)));
      pushStatus('dfm_action_required', atLocalMinutes(cal.addWd(localDate(placed_at), 1), rd.int(5 * 60, 8 * 60), rd.int(0, 59)));
      pushStatus('in_production', atLocalMinutes(prodDay, rd.int(9 * 60, 15 * 60), rd.int(0, 59)));
    } else pushStatus('in_production', prodAt);
    if (shipDay > cal.addWd(localDate(placed_at), 1)) pushStatus('shipped', atLocalMinutes(shipDay, r.int(13 * 60, 17 * 60), r.int(0, 59)));
    pushStatus('delivered', delivered_at);

    // --- records ---
    const dmdIds = [];
    for (const l of lines) {
      const did = S.nextId('dmd', 5);
      dmdIds.push(did);
      world.demands.push({
        id: did, kind, cause: kind === 'spare' ? 'top_up' : (orderedRevs.get(l.p.id)?.size && !(orderedRevs.get(l.p.id).has(l.rev))) ? 'revision' : 'planned', part: l.p.id, revision: l.rev, quantity: l.qty,
        assembly, requester: requester.id, feeds: consumer ? consumer.id : null, need_by_believed: needWritten, trigger_at, late_by_choice: lateByChoice,
        hidden_earlier_need: hiddenNeed, order: id, caused_by: null,
      });
    }
    for (const l of lines) { if (!orderedRevs.has(l.p.id)) orderedRevs.set(l.p.id, new Set()); orderedRevs.get(l.p.id).add(l.rev); }
    const ci = TIERS.indexOf(tier);
    const xo = S.V.get('v-xometry');
    const descriptor = r.pick(xo.descriptors);
    const txId = uuid(r);
    const memo = r.chance(0.8); const receipt = r.chance(0.88);
    const txTime = addMinutes(placed_at, r.int(0, 3));
    const dept = world.finance.ramp_departments.find((d) => d.teams.includes(placer.team));
    world.ramp_transactions.push({
      id: txId, order: id, instrument: 'card', kind: 'charge', state: daysAfter(txTime, world.meta.window.end) < 1.5 ? 'PENDING' : 'CLEARED', amount_usd: chosen.total_usd,
      user_transaction_time: Date.parse(txTime) > S.winEnd ? placed_at : txTime, settlement_date: addDays(localDate(placed_at), r.int(1, 3)), card_id: placer.ramp_card_ids[0] || null, card_holder: placer.id,
      merchant_name: xo.name, merchant_descriptor: descriptor, mcc: xo.mcc, memo_present: memo, receipt_present: receipt, original_transaction_id: null,
      department: dept ? dept.name : null, gl_account: kind === 'test_hardware' || kind === 'rig_misc' ? '5120' : '5110', project_code: S.A.get(assembly).project_code,
    });
    const order = {
      id, type: 'xometry_cnc', vendor: 'v-xometry', quote_id: '', order_number: '',
      lines: lines.map((l, j) => ({ part: l.p.id, revision: l.rev, quantity: l.qty, unit_price_usd: chosen.units[j], demand: dmdIds[j] })),
      tiers: tiersAll.filter((t) => econQuoted || t.tier !== 'economy').map(({ units, ...t }) => t),
      chosen_tier: tier, quoted_at, quote_expires: addDays(localDate(quoted_at), k.quote.valid_days),
      requester: requester.id, placer: placer.id, approver, tier_decided_by: decider.id,
      need_identified_at: null, requested_at, approved_at, auto_approved: auto, placed_at,
      subtotal_usd: chosen.subtotal_usd, shipping_usd: chosen.shipping_usd, tax_usd: chosen.tax_usd, total_usd: chosen.total_usd,
      promised_date: chosen.est_delivery, status, delivered_at, carrier: 'FedEx', tracking: r.id(12),
      inspection: recorded ? { result: r.chance(0.02) ? 'partial' : 'pass', at: inspAt, by: inspector } : null,
      ready_at: recorded || inspLag ? inspAt : addMinutes(delivered_at, r.int(10, 90)), first_use: null,
      feeds_test: it.test ? it.test.id : (target?.test?.id ?? null), feeds_work_item: wi ? wi.id : null, feeds_milestone: it.test ? it.test.milestone : (target?.test ? target.test.milestone : (target?.ms?.id ?? null)),
      need_by_believed: needWritten, link_quality: 'never_discussed', is_revision: isRevision, cancelled: false, remade_from: null,
      ramp_transaction_ids: [txId], descriptor, memo_present: memo, receipt_present: receipt, certifications: r.chance(0.15) ? ['CoC'] : [],
    };
    world.orders.push(order);
    if (consumer) {
      if (it.test) { for (const i of consumer.inputs) if (i.part && lines.some((l) => l.p.id === i.id)) { i.order = id; i.ready = ready[tier]; } } else consumer.inputs.push({ id, order: id, ready: ready[tier] });
      for (const l of lines) S.edge(l.p.id, consumer.id);
    }
    S.info.set(id, {
      order, kind, assembly, consumer, wi, test: it.test || null, target, sibling, stdMisses: !!(needWritten && tS.est_delivery > needWritten), econFits: !!(needWritten && tE.est_delivery <= needWritten), ready, delivered, tiersAll, econQuoted, rule, cls, burst, newRev,
      belief: { need_by: needBelieved, inputs: beliefInputs, gain_days: gain, stale, ignored_siblings: ignored }, hiddenNeed, requester, decider, placer, reqDay,
    });
  }

  // seed graph edges
  for (const t of world.tests) {
    const c = S.consumers.get(t.id);
    for (const i of c.inputs) S.edge(i.id, t.id);
    for (const u of c.units) S.edge(u, t.id);
    if (t.milestone) S.edge(t.id, t.milestone);
  }
  for (const w of world.work_items) for (const b of w.blocked_by) S.edge(b, w.id);

  // quote ids and order numbers increase with time, with random gaps
  const rq = rng.fork('numbers');
  let q = 2400000 + rq.int(0, 9000);
  for (const o of world.orders.slice().sort((a, b) => cmp(Date.parse(a.quoted_at), Date.parse(b.quoted_at)) || cmp(a.id, b.id))) { q += rq.int(40, 900); o.quote_id = `Q-${q}-1`; }
  let n = 5300000 + rq.int(0, 9000);
  for (const o of world.orders.slice().sort((a, b) => cmp(Date.parse(a.placed_at), Date.parse(b.placed_at)) || cmp(a.id, b.id))) { n += rq.int(60, 1100); o.order_number = `XO-${n}`; }
}

function daysAfter(a, b) { return (Date.parse(b) - Date.parse(a)) / 86400e3; }
