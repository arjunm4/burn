// Builds the whole truth: world.json and answers.json objects from the seeds and knobs (spec S1-S14).
// Pure: no files, no clock, all randomness through rng.fork("<stage>:<id>").
import { setup, uuid } from './setup.mjs';
import { solveStart, solveAll, resolveOne, milestoneDate, latestReady } from './solve.mjs';
import { atLocalMinutes, atLocal, addDays, addMinutes, addSeconds, dow, localDate, localMinutes, weekStart, daysBetween } from '../lib/calendar.mjs';
import { cmp, roundMoney } from '../lib/io.mjs';
import { makeRng } from '../lib/rng.mjs';
import { runOrders } from './orders.mjs';
import { runContext } from './context.mjs';
import { buildAnswers } from './answers.mjs';

export const believed = (hist, iso) => {
  const t = Date.parse(iso);
  let v = null;
  for (const h of hist) if (Date.parse(h.known_at) <= t) v = h.value;
  return v;
};

export function buildWorld({ canon, org, program, knobs, seed }) {
  const rng = makeRng(seed ?? canon.meta.seed);
  const base = setup({ canon, org, program, knobs, seed: seed ?? canon.meta.seed, rng });
  const { world, cal, pinned, testInputs, prog } = base;
  const k = knobs;
  // Nothing is said or recorded after the demo "now" (10:30 on the last day), which is inside the window end.
  const winEnd = Math.min(Date.parse(world.meta.window.end), Date.parse(world.meta.demo_now));
  const winStart = Date.parse(world.meta.window.start);
  const inWin = (iso) => { const t = Date.parse(iso); return t >= winStart && t <= winEnd; };
  const counters = {};
  const nextId = (prefix, digits) => { counters[prefix] = (counters[prefix] || 0) + 1; return `${prefix}-${String(counters[prefix]).padStart(digits, '0')}`; };
  const idx = (name) => new Map(world[name].map((x) => [x.id, x]));
  const S = {
    world, cal, k, rng, pinned, inWin, nextId, winEnd, winStart,
    P: idx('people'), T: idx('teams'), A: idx('assemblies'), PT: idx('parts'), M: idx('milestones'), DL: idx('deliverables'),
    TS: idx('tests'), CH: idx('channels'), V: idx('vendors'),
    seedProgram: prog, consumers: new Map(), usedSeconds: new Map(), eventsAbout: new Map(), slipOfEntity: new Map(),
  };
  for (const r of [...world.test_rigs, ...world.resources]) for (const b of r.bookings) { const n = +b.id.slice(3); counters.bk = Math.max(counters.bk || 0, n); }

  // ---- events ----
  S.event = (e) => {
    let t = e.known_at;
    const key = e.where.channel || e.where.ticket?.tmp || e.where.meeting || e.where.calendar || 'x';
    if (!S.usedSeconds.has(key)) S.usedSeconds.set(key, new Set());
    const used = S.usedSeconds.get(key);
    while (used.has(t)) t = addSeconds(t, 1);
    if (Date.parse(t) > winEnd) return null;
    used.add(t);
    const ev = {
      id: nextId('ev', 6), known_at: t, source: e.source, where: e.where, by: e.by, kind: e.kind, topic: e.topic ?? null,
      claim: e.claim ?? null, refs: e.refs || [], truth: e.truth || 'true', corrects: e.corrects ?? null, contradicts: e.contradicts ?? null,
      pressure: e.pressure ?? null, storyline: e.storyline ?? null, orders: [], orders_after: [], asks_expedite: e.asks_expedite ?? false,
      reports: e.reports ?? null, brief: e.brief || '',
    };
    world.events.push(ev);
    if (e.about) { if (!S.eventsAbout.has(e.about)) S.eventsAbout.set(e.about, []); S.eventsAbout.get(e.about).push(ev); }
    return ev;
  };
  S.humanBetween = (r, a, b) => {
    const ta = Date.parse(a); const tb = Date.parse(b);
    if (tb - ta < 120e3) return null;
    for (let i = 0; i < 8; i++) {
      const day = localDate(addSeconds(a, Math.floor(r.float() * (tb - ta) / 1e3)));
      if (!cal.isWd(day)) continue;
      const t = cal.sampleTime(r, day);
      const tt = Date.parse(t);
      if (tt > ta && tt < tb) return t;
    }
    return addSeconds(a, 30 + Math.floor(r.float() * ((tb - ta) / 1e3 - 60)));
  };

  // ---- meetings (needed as announcement venues) ----
  buildMeetings(S);

  // ---- hidden windows ----
  buildWindows(S);

  // ---- S3 deliverables ----
  for (const d of world.deliverables) {
    const seedD = (prog.deliverables || []).find((x) => x.id === d.id) || {};
    if (pinned.has(d.id)) { delete d.order_date; delete d.estimate_days; continue; }
    if (!d.eta) d.eta = [{ value: cal.addWd(cal.windowStart, 30), effective: null, known_at: base.t0, by: d.owner, where: null }];
    simulateDeliverable(S, d, { internal: !d.vendor, estimate: seedD.estimate_days });
    d._order_date = seedD.order_date || null;
    delete d.order_date; delete d.estimate_days;
  }

  // ---- seed work items and tests as consumers; planned schedule before CNC orders ----
  const r4 = rng.fork('work');
  for (const w of prog.work_items || []) {
    const ms = S.M.get(w.milestone);
    const feedsTest = world.tests.find((t) => (testInputs.get(t.id) || []).includes(w.id));
    const dur = Math.max(1, Math.round(w.duration_true_days ?? 3));
    const anchor = feedsTest ? feedsTest.planned_date[0].value : ms ? ms.date[0].value : cal.addWd(cal.windowStart, 40);
    const wr = r4.fork(w.id);
    let earliest = cal.addWd(anchor, -(dur + wr.int(2, 6)));
    if (earliest < cal.addWd(cal.windowStart, 1)) earliest = cal.addWd(cal.windowStart, 1);
    const owner = S.P.has(w.owner) ? w.owner : world.people[0].id;
    const item = {
      id: w.id, name: w.name, owner, assembly: S.A.has(w.assembly) ? w.assembly : world.assemblies[0].id, duration_true_days: dur,
      duration_estimate_days: w.duration_estimate_days ?? null, blocked_by: (w.blocked_by || []).filter((x) => S.DL.has(x) || (prog.work_items || []).some((y) => y.id === x)),
      status: [], milestone: ms ? ms.id : null, actual_start: null, actual_done: null,
    };
    world.work_items.push(item);
    S.consumers.set(w.id, {
      id: w.id, type: 'work_item', earliest, slotDays: null, duration: dur, units: [], milestone: null, created: cal.addWd(earliest, -wr.int(5, 15)),
      inputs: item.blocked_by.map((b) => (S.DL.has(b) ? { id: b, ready: S.DL.get(b).true_arrival } : { id: b, consumer: b, ready: null })),
    });
  }
  const unitById = new Map([...world.test_rigs, ...world.resources].map((u) => [u.id, u]));
  for (const t of world.tests) {
    const units = [t.rig, ...t.resources].filter(Boolean);
    let slotDays = null;
    for (const u of units) { const sd = unitById.get(u)?.slot_days; if (sd?.length) slotDays = slotDays ? slotDays.filter((x) => sd.includes(x)) : sd.slice(); }
    if (slotDays && !slotDays.length) slotDays = null;
    const inputs = [];
    for (const i of testInputs.get(t.id) || []) {
      if (S.DL.has(i)) inputs.push({ id: i, ready: S.DL.get(i).true_arrival });
      else if (S.consumers.has(i)) inputs.push({ id: i, consumer: i, ready: null });
      else if (S.PT.has(i)) inputs.push({ id: i, part: true, ready: null });
    }
    S.consumers.set(t.id, { id: t.id, type: 'test', earliest: t.earliest_start, slotDays, duration: Math.max(1, Math.round(t.duration_true_days)), units, milestone: t.milestone, inputs });
  }
  // planned schedule without CNC parts -> test and milestone announcements (spec section 5, cut 6)
  const pre = solveAll(cal, S.consumers, pinned);
  S.preSlots = pre.slots;
  const tpm = S.T.get('t-program')?.lead || world.people[0].id;
  for (const t of world.tests) {
    if (pinned.has(t.id)) continue;
    const slot = pre.slots.get(t.id);
    const planned = t.planned_date[0].value;
    const delta = cal.wdBetween(planned, slot.start);
    if (delta > 0) {
      const tr = rng.fork(`testslip:${t.id}`);
      const c = S.consumers.get(t.id);
      const lr = latestReady(c.inputs);
      const viaInput = lr.date && cal.addWd(lr.date, 1) >= slot.start;
      const srcSlip = viaInput ? (S.slipOfEntity.get(lr.id) || []).slice(-1)[0] : null;
      const occurs = srcSlip ? localDate(srcSlip.occurs_at) : cal.addWd(planned, -tr.int(2, 8));
      const who = tr.weighted([[t.owner, 70], [tpm, 20], [S.P.get(t.owner)?.manager || t.owner, 10]]);
      announceSlip(S, tr, { entity: t, hist: t.planned_date, from: planned, to: slot.start, cause: viaInput ? 'input_late' : 'resource_conflict', occursDay: occurs, by: who, channel: S.A.get(t.assembly).channel, internal: true, limitDay: planned });
    }
  }
  for (const m of world.milestones) {
    if (pinned.has(m.id)) continue;
    const feeders = world.tests.filter((t) => t.milestone === m.id);
    if (!feeders.length || feeders.some((t) => pinned.has(t.id))) { m._pre = m.date[0].value; continue; }
    const d = milestoneDate(m, feeders.map((t) => pre.slots.get(t.id).end));
    m._pre = d;
    const planned = m.date[0].value;
    const delta = cal.wdBetween(planned, d);
    if (delta > 0 && m.hardness === 'soft') {
      const mr = rng.fork(`msslip:${m.id}`);
      const late = feeders.map((t) => (S.slipOfEntity.get(t.id) || [])[0]).filter(Boolean).sort((a, b) => cmp(a.occurs_at, b.occurs_at))[0];
      announceSlip(S, mr, { entity: m, hist: m.date, from: planned, to: d, cause: 'input_late', occursDay: late ? localDate(late.occurs_at) : cal.addWd(planned, -mr.int(3, 9)), by: tpm, forceMeeting: 'program_review', channel: 'ch-build', internal: true, limitDay: planned });
    }
  }

  // ---- S5 (first half): true pressure per assembly per day, used by the decision ----
  buildPressure(S);

  // ---- S6-S8, S10: demand, quotes, decisions, fulfilment ----
  S.simulateDeliverable = simulateDeliverable;
  S.announceSlip = announceSlip;
  runOrders(S);

  // ---- realized schedule with every order's chosen-tier ready date ----
  const real = solveAll(cal, S.consumers, pinned);
  S.slots = real.slots;
  S.busy = real.busy;
  const tr = rng.fork('tests');
  for (const t of world.tests) {
    if (pinned.has(t.id)) continue;
    const s = real.slots.get(t.id);
    t.actual_start = atLocal(s.start, '09:00');
    t.actual_end = atLocal(s.end, '17:00');
    const x = tr.fork(t.id);
    t.result = Date.parse(t.actual_end) <= Date.parse(world.meta.demo_now) ? x.weighted({ pass: 1 - k.test.fail_rate - k.test.partial_rate, fail: k.test.fail_rate, partial: k.test.partial_rate }) : 'not_run';
    for (const u of S.consumers.get(t.id).units) {
      unitById.get(u).bookings.push({ id: nextId('bk', 5), start: t.actual_start, end: t.actual_end, test: t.id, by: t.owner, status: 'confirmed', conflict_with: [] });
    }
  }
  for (const m of world.milestones) {
    if (pinned.has(m.id)) continue;
    const feeders = world.tests.filter((t) => t.milestone === m.id);
    if (feeders.some((t) => pinned.has(t.id))) { m.actual_date = null; continue; }
    m.actual_date = feeders.length ? milestoneDate(m, feeders.map((t) => real.slots.get(t.id).end)) : m.date[0].value;
  }
  for (const w of world.work_items) {
    const s = real.slots.get(w.id);
    const c = S.consumers.get(w.id);
    w.actual_start = atLocal(s.start, '09:30');
    w.actual_done = atLocal(s.end, '16:00');
    const created = atLocal(cal.onOrAfter(c.created < cal.windowStart ? cal.windowStart : c.created), '10:00');
    const st = [{ value: 'not_started', effective: created, known_at: created, by: w.owner, where: null }];
    if (inWin(w.actual_start) && w.actual_start > created) st.push({ value: 'in_progress', effective: w.actual_start, known_at: w.actual_start, by: w.owner, where: null });
    if (inWin(w.actual_done) && w.actual_done > created) st.push({ value: 'done', effective: w.actual_done, known_at: w.actual_done, by: w.owner, where: null });
    w.status = st;
  }

  // ---- S4b tickets, S11 other orders, S12 events ----
  runContext(S);

  // ---- finalize ----
  const answers = buildAnswers(S);
  finalize(S);
  return { world, answers, state: S };
}

// ---------------------------------------------------------------------------------------------------------
function buildMeetings(S) {
  const { world, cal, rng } = S;
  const DAYS = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 0 };
  const r = rng.fork('meetings');
  const list = [];
  const end = localDate(world.meta.demo_now);
  for (const s of world.meeting_series) {
    const rule = Object.fromEntries(s.rrule.split(';').map((x) => x.split('=')));
    const by = (rule.BYDAY || 'MO,TU,WE,TH,FR').split(',');
    const interval = +(rule.INTERVAL || 1);
    const dates = [];
    if (rule.FREQ === 'YEARLY' || rule.FREQ === 'MONTHLY') {
      const months = rule.BYMONTH ? rule.BYMONTH.split(',').map(Number) : [2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
      for (const mo of months) for (const b of by) {
        const m = /^(-?\d)?([A-Z]{2})$/.exec(b); if (!m) continue;
        const nth = +(m[1] || 1);
        let d = `2026-${String(mo).padStart(2, '0')}-01`; let n = 0;
        for (let i = 0; i < 31 && d.slice(5, 7) === String(mo).padStart(2, '0'); i++, d = addDays(d, 1)) if (dow(d) === DAYS[m[2]] && ++n === nth) { dates.push(d); break; }
      }
    } else {
      cal.weekStarts.forEach((ws, wi) => {
        if (rule.FREQ === 'WEEKLY' && wi % interval) return;
        for (const b of by) { const dn = DAYS[b.slice(-2)]; if (dn === undefined) continue; dates.push(addDays(ws, (dn + 6) % 7)); }
      });
    }
    let count = 0;
    const max = rule.COUNT ? +rule.COUNT : Infinity;
    for (const d of dates.sort()) {
      if (d < cal.windowStart || d > end || !cal.isWd(d) || count >= max) continue;
      const mr = r.fork(`${s.id}:${d}`);
      const start = atLocal(d, s.start_local);
      if (Date.parse(start) + s.duration_min * 60e3 > Date.parse(world.meta.demo_now)) continue;
      count++;
      if (mr.chance(0.04)) continue;
      const invited = [...new Set([s.organizer, ...s.attendees, ...(s.optional_attendees || [])])];
      const present = invited.filter((p) => p === s.organizer || mr.chance((s.optional_attendees || []).includes(p) ? 0.4 : 0.85));
      const rsvp = {};
      for (const p of invited) rsvp[p] = present.includes(p) ? mr.weighted({ accepted: 8, tentative: 1, needs_action: 1 }) : mr.weighted({ declined: 4, needs_action: 3, tentative: 2, accepted: 1 });
      list.push({
        id: null, name: s.name, series: s.id, type: s.type, start, scheduled_min: s.duration_min,
        actual_min: Math.max(5, Math.round(s.duration_min * mr.uniform(0.55, 1.2)) + mr.int(-2, 3)), invited, present,
        late_joiners: present.filter((p) => p !== s.organizer && mr.chance(0.08)), external: [], note_taker: s.note_taker,
        recorded: s.recorded && mr.chance(s.type === 'standup' ? 0.5 : 0.92), storylines: [], rsvp, moved_from: null, cancelled: false,
      });
    }
  }
  list.sort((a, b) => cmp(Date.parse(a.start), Date.parse(b.start)) || cmp(a.series, b.series));
  for (const m of list) m.id = S.nextId('mtg', 5);
  world.meetings = list;
  S.meetingsByType = new Map();
  for (const m of list) { if (!S.meetingsByType.has(m.type)) S.meetingsByType.set(m.type, []); S.meetingsByType.get(m.type).push(m); }
  // first meeting of one of the types starting on or after `day`, within `withinDays`
  S.nextMeeting = (types, day, withinDays = 9) => {
    let best = null;
    for (const t of types) for (const m of S.meetingsByType.get(t) || []) {
      const d = localDate(m.start);
      if (d >= day && daysBetween(day, d) <= withinDays) { if (!best || m.start < best.start) best = m; break; }
    }
    return best;
  };
}

function buildWindows(S) {
  const { world, cal, rng } = S;
  const r = rng.fork('windows');
  const bw = [];
  for (const q of ['2026-03-31', '2026-06-30', '2026-09-30']) { const e = cal.onOrBefore(q); bw.push({ start: cal.addWd(e, -2), end: e, cause: 'Quarter-end spend freeze' }); }
  const normal = world.meta.weeks.filter((w) => w.kind !== 'quiet' && w.week_start > cal.windowStart).map((w) => w.week_start);
  for (const ws of r.sample(normal, 2)) bw.push({ start: ws, end: addDays(ws, 11), cause: 'Cash review: discretionary spend held' });
  bw.sort((a, b) => cmp(a.start, b.start));
  world.meta.budget_windows = bw.map((b, i) => ({ id: `bw-${String(i + 1).padStart(2, '0')}`, ...b }));
  const pw = [];
  const builds = world.milestones.filter((m) => ['build', 'demo', 'gate'].includes(m.kind) && !S.pinned.has(m.id));
  const demo = world.milestones.find((m) => m.id === 'm-investor-demo') || builds[0];
  const chosen = [demo, ...r.sample(builds.filter((m) => m !== demo), 3)].filter(Boolean);
  for (const m of chosen) {
    const d = m.date[0].value;
    const len = r.int(5, 10);
    const end = cal.addWd(d, -1);
    pw.push({ start: cal.addWd(end, -len), end, assemblies: m.assemblies.slice(), cause: m === demo ? `Exec push before ${m.name}` : `Leadership push: ${m.name} must not move` });
  }
  pw.sort((a, b) => cmp(a.start, b.start));
  world.meta.pressure_windows = pw.filter((p) => p.end >= cal.windowStart).map((p, i) => ({ id: `pw-${String(i + 1).padStart(2, '0')}`, ...p, start: p.start < cal.windowStart ? cal.windowStart : p.start }));
  S.inBudgetWindow = (day) => world.meta.budget_windows.some((b) => day >= b.start && day <= b.end);
  S.inPressureWindow = (day, a) => world.meta.pressure_windows.some((p) => day >= p.start && day <= p.end && p.assemblies.includes(a));
}

// One announced change of a date: slip record, optional event, history entry (spec S2/S3).
function announceSlip(S, r, { entity, hist, from, to, cause, occursDay, by, channel, internal, forceMeeting, limitDay }) {
  const { cal, k, world } = S;
  const lastKnown = localDate(hist[hist.length - 1].known_at);
  let occ = occursDay;
  if (occ <= lastKnown) occ = cal.addWd(lastKnown, 1);
  let disc = r.chance(0.1) && limitDay && limitDay > occ ? limitDay : cal.addWd(occ, r.int(0, internal ? 3 : 2));
  if (disc < occ) disc = occ;
  const slip = {
    id: S.nextId('slip', 5), entity: entity.id, cause, delta_days: cal.wdBetween(from, to), from, to,
    occurs_at: atLocal(occ, '08:00'), discovered_at: atLocal(disc, '09:10'), announced_at: null, by: null, venue: null, event: null,
  };
  world.slips.push(slip);
  if (!S.slipOfEntity.has(entity.id)) S.slipOfEntity.set(entity.id, []);
  S.slipOfEntity.get(entity.id).push(slip);
  const lag = r.weighted(k.slip.announce_lag);
  if (lag === 'never') return slip;
  const [lo, hi] = lag.split('-').map(Number);
  let day = cal.addWd(disc, r.int(lo, hi ?? lo));
  if (lo === 0 && (hi ?? 0) === 0) day = cal.onOrAfter(disc);
  let venue = forceMeeting ? 'meeting' : r.weighted(k.slip.venue_mix);
  if (venue === 'jira') venue = 'slack';
  let when = cal.sampleTime(r, day, { burst: false });
  if (Date.parse(when) < Date.parse(slip.discovered_at)) when = addMinutes(slip.discovered_at, r.int(5, 240));
  let meeting = null;
  if (venue === 'meeting') {
    meeting = S.nextMeeting(forceMeeting ? [forceMeeting] : internal ? ['program_review', 'supply_chain_mech', 'design_review'] : ['supply_chain_sync', 'supply_chain_mech'], day);
    if (meeting && Date.parse(meeting.start) > Date.parse(slip.discovered_at)) { when = addMinutes(meeting.start, r.int(3, Math.max(4, meeting.actual_min - 2))); if (!meeting.present.includes(by)) by = meeting.present[0]; } else { venue = 'slack'; meeting = null; }
  }
  if (!S.inWin(when)) return slip; // never said inside the window
  const optimistic = r.chance(0.35);
  const stated = optimistic ? cal.addWd(to, -Math.max(1, Math.round(r.uniform(0, k.slip.optimism_max) * Math.max(1, slip.delta_days)))) : to;
  const stated1 = stated <= from && to > from ? to : stated;
  const mkEvent = (t, value, v, brief, extra = {}) => {
    if (v === 'nowhere') return null;
    const where = v === 'meeting' ? { meeting: meeting.id } : v === 'calendar' ? { calendar: `cal-${entity.id}` } : { channel: S.CH.has(channel) ? channel : world.channels[0].id, thread_of: null };
    return S.event({
      known_at: t, source: v === 'meeting' ? 'meeting' : v === 'calendar' ? 'calendar' : 'slack', where, by, kind: 'crumb',
      claim: { kind: 'eta', subject: entity.id, value, true_value: extra.trueValue ?? value, effective: value, for_use: null },
      refs: [{ id: entity.id, mode: 'alias', token: entity.name }], reports: slip.id, about: entity.id, brief, truth: extra.truth, corrects: extra.corrects,
    });
  };
  // S12.3: a misstated date. The wrong value is what people believe (and decide on) until someone corrects it.
  const ri = S.rng.fork(`misstate:${slip.id}`);
  const ir = k.imperfection_rates;
  const uW = ri.float();
  let said = stated1;
  if (venue !== 'nowhere' && uW < ir.wrong_date_corrected + ir.wrong_never_corrected) {
    const w = cal.addWd(stated1, ri.chance(0.5) ? ri.int(1, 3) : -ri.int(1, 3));
    if (w !== stated1 && w > localDate(when)) said = w;
  }
  let ev = mkEvent(when, said, venue, `${entity.name}: moved from ${from} to ${said}`, said !== stated1 ? { truth: 'wrong', trueValue: stated1 } : {});
  if (!ev && said !== stated1) said = stated1;
  const kAt = ev ? ev.known_at : when;
  hist.push({ value: said, effective: null, known_at: kAt, by, where: ev ? ev.id : null });
  if (ev && said !== stated1 && uW < ir.wrong_date_corrected) {
    const tc = addMinutes(ev.known_at, ri.int(5, 90));
    if (S.inWin(tc)) {
      const ev2 = mkEvent(tc, stated1, venue === 'slack' ? 'slack' : 'slack', `${entity.name}: correction, ${stated1} not ${said}`, { corrects: ev.id });
      if (ev2) hist.push({ value: stated1, effective: null, known_at: ev2.known_at, by, where: ev2.id });
    }
  }
  slip.announced_at = kAt; slip.by = by; slip.venue = venue; slip.event = ev ? ev.id : null;
  if (stated1 !== to) {
    const d2 = cal.addWd(localDate(kAt), r.int(1, 4));
    const t2 = cal.sampleTime(r, d2, { burst: false });
    if (S.inWin(t2)) {
      const v2 = venue === 'meeting' ? 'slack' : venue;
      const ev2 = mkEvent(t2, to, v2, `${entity.name}: moved again, now ${to}`);
      hist.push({ value: to, effective: null, known_at: ev2 ? ev2.known_at : t2, by, where: ev2 ? ev2.id : null });
    }
  }
  return slip;
}

function simulateDeliverable(S, d, { internal, estimate }) {
  const { cal, k } = S;
  const r = S.rng.fork(`deliverable:${d.id}`);
  const cls = internal ? 'internal' : ['pcb', 'pcba'].includes(d.kind) ? 'pcb' : 'motor';
  const eta0 = d.eta[d.eta.length - 1].value;
  let cur = eta0;
  const firstDay = localDate(d.eta[0].known_at);
  const buyer = S.buyers?.[0] || S.T.get('t-supply')?.members?.[1] || d.owner;
  const by = internal ? d.owner : r.chance(0.6) ? buyer : d.owner;
  const channel = internal ? (S.A.get(d.assembly)?.channel || 'ch-mech') : 'ch-supply-chain';
  if (r.chance(k.deliverable.slip_prob[cls])) {
    const n = cls === 'motor' ? r.weighted([[1, 6], [2, 3], [3, 1]]) : cls === 'pcb' ? r.weighted([[1, 7], [2, 3]]) : 1;
    for (let i = 0; i < n; i++) {
      let delta;
      if (cls === 'internal') { const est = estimate || 8; delta = Math.round(est * (r.lognormal(k.deliverable.internal_overrun.median, k.deliverable.internal_overrun.sigma) - 1)); delta = Math.max(1, Math.min(20, Math.abs(delta))); } else delta = Math.max(1, Math.min(cls === 'motor' ? 25 : 12, Math.round(r.lognormal(k.deliverable.slip_median_days[cls], 0.6))));
      const to = cal.addWd(cur, delta);
      let occ = cal.addWd(cur, -r.int(0, 6));
      if (occ <= firstDay) occ = cal.addWd(firstDay, 1);
      announceSlip(S, r, { entity: d, hist: d.eta, from: cur, to, cause: internal ? 'overrun' : 'vendor', occursDay: occ, by, channel, internal, limitDay: cur });
      cur = to;
    }
  } else if (r.chance(cls === 'motor' ? 0.05 : cls === 'pcb' ? 0.08 : 0.1)) {
    const to = cal.addWd(cur, -r.int(1, 3));
    if (to > firstDay) cur = to;
  }
  d.true_arrival = cur;
  d.eta.sort((a, b) => cmp(Date.parse(a.known_at), Date.parse(b.known_at)));
}

function buildPressure(S) {
  const { world, cal, k, rng } = S;
  const late = new Map();
  for (const m of world.milestones) for (const a of m.assemblies) {
    const base = m._pre ? cal.wdBetween(m.date[0].value, m._pre) : 0;
    late.set(`${a}|${m.id}`, base + Math.round(rng.fork(`late:${a}:${m.id}`).normal(-(k.pressure.slack_mean_days ?? 7), k.pressure.slack_sd_days ?? 5)));
  }
  const ms = world.milestones.slice().sort((x, y) => cmp(x.date[0].value, y.date[0].value) || cmp(x.id, y.id));
  const cache = new Map();
  S.nextMilestone = (a, day) => ms.find((m) => m.assemblies.includes(a) && m.date[0].value >= day) || null;
  S.assemblyLate = (a, m) => late.get(`${a}|${m}`) ?? 0;
  S.pressureValue = (a, day) => {
    const key = `${a}|${day}`;
    if (cache.has(key)) return cache.get(key);
    const m = S.nextMilestone(a, day);
    let v = 0.1;
    if (m) {
      const slack = -late.get(`${a}|${m.id}`);
      v = slack >= 10 ? 0.1 : slack >= 5 ? 0.3 : slack >= 0 ? 0.55 : 0.8;
      if (cal.wdBetween(day, m.date[0].value) <= 15) v += k.pressure.near_milestone_boost;
    }
    if (S.inPressureWindow(day, a)) v += k.pressure.window_boost;
    v = Math.max(0, Math.min(1, v));
    cache.set(key, v);
    return v;
  };
  S.level = (v) => (v < k.pressure.levels[0] ? 'low' : v < k.pressure.levels[1] ? 'elevated' : 'high');
  S.expressed = (a, day, r) => {
    const team = S.T.get(S.A.get(a)?.team);
    return Math.max(0, Math.min(1, S.pressureValue(a, day) + (team?.expressiveness || 0) + r.normal(0, k.pressure.noise_sd)));
  };
}

function finalize(S) {
  const { world } = S;
  // ticket keys: per project, numbered by creation time
  const byProject = new Map();
  for (const t of world.tickets) { if (!byProject.has(t.project)) byProject.set(t.project, []); byProject.get(t.project).push(t); }
  for (const [proj, list] of byProject) {
    list.sort((a, b) => cmp(Date.parse(a.created), Date.parse(b.created)) || cmp(a.tmp, b.tmp));
    list.forEach((t, i) => { t.id = `${proj}-${i + 1}`; });
  }
  for (const t of world.tickets) {
    if (t.parent && typeof t.parent === 'object') t.parent = t.parent.id;
    for (const l of t.links) if (typeof l.key === 'object') l.key = l.key.id;
  }
  for (const e of world.events) if (e.where.ticket && typeof e.where.ticket === 'object') e.where.ticket = e.where.ticket.id;
  for (const t of world.tickets) delete t.tmp;
  for (const d of world.deliverables) delete d._order_date;
  for (const m of world.milestones) delete m._pre;
  for (const e of world.events) { e.orders.sort(); e.orders_after.sort(); }
  const sortId = (a) => a.sort((x, y) => cmp(x.id, y.id));
  for (const c of ['work_items', 'edges', 'demands', 'slips', 'orders', 'ramp_transactions', 'events', 'meetings']) sortId(world[c]);
  world.tickets.sort((a, b) => cmp(a.project, b.project) || cmp(+a.id.split('-')[1], +b.id.split('-')[1]));
  for (const u of [...world.test_rigs, ...world.resources]) u.bookings.sort((a, b) => cmp(a.id, b.id));
}

export { atLocalMinutes, weekStart, localMinutes, roundMoney, uuid, solveStart, resolveOne };
