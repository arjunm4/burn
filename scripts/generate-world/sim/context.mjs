// S4b tickets, S11 other-vendor orders, S12 events (crumbs and background), edge reveal.
import { atLocal, atLocalMinutes, addMinutes, addDays, localDate, daysBetween } from '../lib/calendar.mjs';
import { cmp, roundMoney } from '../lib/io.mjs';
import { uuid } from './setup.mjs';

const OTHER = {
  fasteners: [9, 85, 900], amazon_consumables: [11, 45, 600], electronics: [7, 140, 2500], pcb: [1.2, 380, 4000],
  other_custom_fab: [2.5, 420, 6000], motors_gearing_bearings: [1, 1400, 18000], sensors: [0.6, 900, 9000],
  batteries_power: [0.4, 700, 8000], tools_test_equipment: [4, 120, 5000], raw_stock: [2, 160, 2500], shipping: [4, 60, 900],
};
const DESC = {
  fasteners: ['Socket head cap screws assortment', 'Shoulder bolts and locknuts', 'Dowel pins and shims', 'Helicoil inserts', 'Retaining rings and washers'],
  amazon_consumables: ['Isopropyl alcohol and wipes', 'Zip ties and cable sleeves', 'Kapton tape rolls', 'Nitrile gloves', 'Label printer tape', 'Storage bins'],
  electronics: ['Connectors and crimp terminals', 'MOSFETs and gate drivers', 'Passives restock', 'Encoder ICs', 'Wire spools 18-22 AWG'],
  pcb: ['Prototype PCB lot', 'PCBA respin lot', 'Breakout board panel'],
  other_custom_fab: ['Laser-cut sheet metal brackets', 'SLS nylon covers', 'Waterjet plates', 'Local shop rework'],
  motors_gearing_bearings: ['Frameless motor samples', 'Harmonic drive component set', 'Crossed-roller bearings', 'Planetary gearhead'],
  sensors: ['Force-torque sensor', 'IMU module', 'Depth camera'], batteries_power: ['Cell lot', 'Bench power supply modules'],
  tools_test_equipment: ['Torque wrench', 'Hex driver set', 'Thermocouples', 'Shop consumables', 'Calipers'],
  raw_stock: ['6061 plate and bar stock', '4140 round bar', 'Delrin sheet'], shipping: ['Overnight shipment', 'Ground shipment', 'Freight pickup'],
};

export function runContext(S) {
  const { world, cal, k, rng } = S;
  const orders = world.orders.filter((o) => o.type === 'xometry_cnc');
  const vague = (name) => `the ${name.toLowerCase().split(/[ :]+/).filter(Boolean).slice(-1)[0]}`;
  const nameOf = (id) => S.TS.get(id)?.name || world.work_items.find((w) => w.id === id)?.name || S.DL.get(id)?.name || S.PT.get(id)?.name || id;
  const wiById = new Map(world.work_items.map((w) => [w.id, w]));
  const entName = (id) => S.TS.get(id)?.name || wiById.get(id)?.name || S.DL.get(id)?.name || S.PT.get(id)?.name || world.test_rigs.find((x) => x.id === id)?.name || world.resources.find((x) => x.id === id)?.name || S.M.get(id)?.name || id;
  let tseq = 0;
  const mkTicket = (t) => {
    const created = t.created;
    const ticket = {
      id: null, tmp: `t${String(++tseq).padStart(6, '0')}`, project: t.project, type: t.type || 'Task', brief: t.brief, assembly: t.assembly ?? null, work_item: t.work_item ?? null,
      order: t.order ?? null, test: t.test ?? null, reporter: t.reporter, assignee: t.assignee ?? null, labels: t.labels || [], components: t.components || [],
      priority: t.priority || 'Medium', parent: null, created,
      status: [{ value: 'To Do', effective: created, known_at: created, by: t.reporter, where: null }],
      due_date: [{ value: t.due ?? null, effective: null, known_at: created, by: t.reporter, where: null }], links: [],
    };
    world.tickets.push(ticket);
    return ticket;
  };
  const pushStatus = (ticket, value, at, by) => { if (S.inWin(at) && Date.parse(at) > Date.parse(ticket.status[ticket.status.length - 1].known_at)) ticket.status.push({ value, effective: at, known_at: at, by: by ?? ticket.assignee ?? ticket.reporter, where: null }); };
  const projOf = (assembly) => S.A.get(assembly)?.jira_project || world.jira_projects[0].id;
  const scm = world.jira_projects.find((j) => j.id === 'SCM')?.id || world.jira_projects[0].id;

  // ---------------- order crumbs ----------------
  const feeding = new Map(); // entity id -> [order info]
  const cands = []; // order crumbs that may be misstated (S12.3)
  for (const o of orders) {
    const info = S.info.get(o.id);
    const r = rng.fork(`crumbs:${o.id}`);
    const lq = r.weighted(k.link_quality_mix);
    const T = o.placed_at;
    const A = S.A.get(info.assembly);
    const part0 = S.PT.get(o.lines[0].part);
    // need identified
    let ni;
    {
      const backDays = Math.min(30, r.lognormal(5.6, 0.7));
      let day = localDate(addMinutes(T, -Math.round(backDays * 1440)));
      if (day < cal.windowStart) day = cal.windowStart;
      day = cal.onOrAfter(day);
      ni = cal.sampleTime(r, day);
      if (Date.parse(ni) >= Date.parse(o.quoted_at) - 60e3) ni = addMinutes(o.quoted_at, -r.int(20, 200));
      if (Date.parse(ni) < S.winStart) ni = addMinutes(world.meta.window.start, r.int(1, 30));
      if (Date.parse(ni) >= Date.parse(o.quoted_at)) ni = o.quoted_at;
    }
    o.need_identified_at = ni;
    o.link_quality = lq;
    info.crumbs = []; info.crumbsAfter = [];
    const consumer = info.consumer;
    // conditional on the order being discussed at all, so the overall mix lands on k.edge_reveal_mix
    const disc = 1 - k.link_quality_mix.never_discussed;
    const pRev = Math.min(0.9, k.edge_reveal_mix.revealed / disc);
    const reveal = consumer ? r.weighted({ revealed: pRev, hinted: Math.max(0.02, 1 - pRev - 0.08), never: 0.08 }) : 'never';
    info.revealWanted = reveal;
    let ticket = null;
    const procTicket = (at, by) => {
      if (!ticket) ticket = mkTicket({ project: r.chance(0.5) ? scm : projOf(info.assembly), type: 'Task', brief: `Order ${o.lines.map((l) => `${l.quantity}x ${S.PT.get(l.part).name}`).join(', ')}`, assembly: info.assembly, order: o.id, test: o.feeds_test, reporter: by, assignee: o.placer, labels: ['procurement'], priority: info.cls.startsWith('late') ? 'High' : 'Medium', created: at, due: o.need_by_believed && r.chance(0.6) ? o.need_by_believed : null });
      return ticket;
    };
    const partRef = (mode) => {
      if (mode === 'part_number') return { id: part0.id, mode, token: part0.part_number };
      if (mode === 'alias' && part0.aliases.length) return { id: part0.id, mode, token: r.pick(part0.aliases) };
      return { id: part0.id, mode: 'vague', token: r.pick(['the part', vague(part0.name), 'that order']) };
    };
    const consRef = (mode) => (mode === 'vague' ? { id: consumer.id, mode: 'vague', token: consumer.type === 'test' ? 'the test' : r.pick(['the build', 'the fit check', 'next week']) } : { id: consumer.id, mode: 'alias', token: entName(consumer.id) });
    const pressureAt = (iso) => {
      const day = localDate(iso);
      let urg = 0.2;
      if (o.need_by_believed) { const s = cal.wdBetween(day, o.need_by_believed); urg = s < 8 ? 0.8 : s < 12 ? 0.5 : 0.2; }
      return S.level(0.6 * S.expressed(info.assembly, day, r) + 0.4 * urg);
    };
    const place = (time, by, extra) => {
      const src = r.weighted({ slack: 60, jira: 25, meeting: 15 });
      let where; let source = 'slack'; let known = time;
      if (src === 'jira') { const tk = procTicket(time, by); where = { ticket: tk, ticket_field: tk.created === time ? 'created' : 'comment' }; source = 'jira'; if (Date.parse(time) < Date.parse(tk.created)) { known = addMinutes(tk.created, r.int(1, 30)); } } else if (src === 'meeting') {
        const m = S.nextMeeting(['supply_chain_mech', 'supply_chain_sync', 'standup', 'design_review', 'build_readiness'], localDate(time), 3);
        const mt = m ? addMinutes(m.start, r.int(2, Math.max(3, m.actual_min - 1))) : null;
        if (mt && Date.parse(mt) < extra.before && Date.parse(mt) >= extra.after) { where = { meeting: m.id }; source = 'meeting'; known = mt; by = m.present.includes(by) ? by : m.present[0]; }
      }
      if (!where) where = { channel: r.chance(0.7) ? A.channel : (S.CH.has('ch-procurement') ? r.pick(['ch-procurement', 'ch-hw-purchasing'].filter((c) => S.CH.has(c))) : A.channel), thread_of: null };
      if (Date.parse(known) >= extra.before || Date.parse(known) < extra.after) return null;
      return { where, source, known, by };
    };
    if (lq !== 'never_discussed') {
      const n = lq === 'clean_id' ? Math.max(2, Math.min(9, Math.round(r.lognormal(4, 0.45)))) : Math.max(1, Math.min(6, Math.round(r.lognormal(3, 0.45))));
      const times = [ni];
      for (let j = 1; j < n; j++) { const t = S.humanBetween(r, ni, o.requested_at); if (t) times.push(t); }
      times.sort((a, b) => cmp(Date.parse(a), Date.parse(b)));
      const askIdx = r.chance(o.chosen_tier === 'expedite' ? k.crumb.asks_expedite_if_expedite : k.crumb.asks_expedite_otherwise) ? times.length - 1 : -1;
      const window = { before: Date.parse(T), after: Date.parse(ni) };
      times.forEach((time, j) => {
        const by = j === 0 || r.chance(0.6) ? o.requester : r.chance(0.5) ? o.placer : (S.P.get(o.requester).manager || o.requester);
        let pl = place(time, by, window);
        if (!pl) pl = { where: { channel: A.channel, thread_of: null }, source: 'slack', known: time, by };
        const mix = k.crumb.ref_mix;
        let mode = lq === 'clean_id' ? (j === 0 ? 'part_number' : r.weighted({ part_number: mix.id_or_part_number, alias: mix.alias, vague: mix.vague })) : (j === 0 ? 'alias' : r.weighted({ alias: mix.alias, vague: mix.vague }));
        const refs = [partRef(mode)];
        if (j === 0 && reveal !== 'never') for (const l of o.lines.slice(1)) { const p = S.PT.get(l.part); refs.push(lq === 'clean_id' ? { id: p.id, mode: 'part_number', token: p.part_number } : { id: p.id, mode: 'alias', token: p.aliases.length ? r.pick(p.aliases) : p.name }); }
        let forUse = null;
        if (consumer && reveal !== 'never' && (j === 0 || r.chance(0.35))) { refs.push(consRef(reveal === 'revealed' && (j === 0 || r.chance(0.5)) ? 'alias' : 'vague')); forUse = consumer.id; }
        const value = { qty: o.lines[0].quantity, by: o.need_by_believed };
        const ev = S.event({
          known_at: pl.known, source: pl.source, where: pl.where, by: pl.by, kind: 'crumb',
          claim: { kind: 'needs', subject: part0.id, value, true_value: value, effective: o.need_by_believed, for_use: forUse },
          refs: refs.slice(0, 1).concat(refs.filter((x) => x.id === consumer?.id), refs.slice(1).filter((x) => x.id !== consumer?.id)), pressure: pressureAt(pl.known), asks_expedite: j === askIdx,
          brief: `${refs[0].token}: need ${value.qty}${value.by ? ` by ${value.by}` : ''}${forUse ? ` for ${refs.find((x) => x.id === consumer.id).token}` : ''}${j === askIdx ? '; asks whether expediting is worth it' : ''}`,
        });
        if (ev && Date.parse(ev.known_at) < Date.parse(T)) { ev.orders.push(o.id); info.crumbs.push(ev); } else if (ev) { ev.orders_after.push(o.id); info.crumbsAfter.push(ev); }
        if (ev) cands.push({ ev, info, o });
      });
      if (lq === 'clean_id' && r.chance(0.45) && Date.parse(o.requested_at) - Date.parse(o.quoted_at) > 6 * 60e3) {
        const t = addMinutes(o.quoted_at, r.int(2, Math.max(3, Math.floor((Date.parse(o.requested_at) - Date.parse(o.quoted_at)) / 60e3) - 1)));
        const std = o.tiers.find((x) => x.tier === 'standard');
        const value = { qty: o.lines[0].quantity, by: o.need_by_believed, quote_id: o.quote_id, price_usd: std.total_usd, lead_days: std.lead_business_days };
        const ev = S.event({
          known_at: t, source: 'slack', where: { channel: S.CH.has('ch-procurement') ? 'ch-procurement' : A.channel, thread_of: null }, by: o.placer, kind: 'crumb',
          claim: { kind: 'needs', subject: part0.id, value, true_value: value, effective: o.need_by_believed, for_use: null },
          refs: [{ id: o.id, mode: 'id', token: o.quote_id }, partRef('part_number')], pressure: pressureAt(t),
          brief: `Quote ${o.quote_id} for ${part0.part_number}: standard $${std.total_usd.toFixed(2)}, ${std.lead_business_days} BD`,
        });
        if (ev && Date.parse(ev.known_at) < Date.parse(T)) { ev.orders.push(o.id); info.crumbs.push(ev); }
      }
      if (lq === 'clean_id' && !info.crumbs.some((e) => e.refs.some((x) => x.mode === 'part_number' || x.mode === 'id'))) o.link_quality = info.crumbs.length ? 'alias_only' : 'never_discussed';
      if (!info.crumbs.length) o.link_quality = 'never_discussed';
    }
    // procurement ticket without a Jira crumb (35% of orders get one overall)
    if (!ticket && r.chance(0.22)) procTicket(addMinutes(T, r.int(3, 90)), o.placer);
    if (ticket) {
      pushStatus(ticket, 'In Progress', addMinutes(T, r.int(5, 200)), o.placer);
      if (!r.chance(k.ticket.close_lag.never)) pushStatus(ticket, 'Done', addMinutes(o.delivered_at, r.int(30, 3 * 1440)), o.requester);
    }
    // after T
    const post = (time, by, claim, refs, brief, src = r.weighted({ slack: 70, jira: ticket ? 30 : 0 })) => {
      if (!S.inWin(time) || Date.parse(time) < Date.parse(T)) return null;
      const where = src === 'jira' ? { ticket, ticket_field: 'comment' } : { channel: r.chance(0.6) ? A.channel : (S.CH.has('ch-supply-chain') ? 'ch-supply-chain' : A.channel), thread_of: null };
      const ev = S.event({ known_at: time, source: src === 'jira' ? 'jira' : 'slack', where, by, kind: 'crumb', claim, refs, pressure: pressureAt(time), reports: o.id, brief });
      if (ev) { ev.orders_after.push(o.id); info.crumbsAfter.push(ev); if (claim.kind !== 'done') cands.push({ ev, info, o }); }
      return ev;
    };
    const aliasRef = part0.aliases.length ? { id: part0.id, mode: 'alias', token: r.pick(part0.aliases) } : partRef('vague');
    if (r.chance(0.35)) post(addMinutes(T, r.int(2, 240)), o.placer, { kind: 'eta', subject: o.id, value: o.promised_date, true_value: o.promised_date, effective: o.promised_date, for_use: null }, [{ id: o.id, mode: 'id', token: o.order_number }, aliasRef], `Order ${o.order_number} placed, promised ${o.promised_date}`);
    if (r.chance(0.5)) post(addMinutes(o.delivered_at, r.int(10, 300)), o.inspection?.by || o.requester, { kind: 'stock', subject: part0.id, value: o.lines[0].quantity, true_value: o.lines[0].quantity, effective: localDate(o.delivered_at), for_use: null }, [aliasRef], `${aliasRef.token} arrived (${o.lines[0].quantity})`);
    const slot = consumer ? S.slots.get(consumer.id) : null;
    let fuAt = slot ? atLocal(slot.start, '09:30') : atLocalMinutes(cal.addWd(localDate(o.ready_at), r.int(1, 10)), r.int(9 * 60, 16 * 60));
    if (Date.parse(fuAt) < Date.parse(o.ready_at)) fuAt = addMinutes(o.ready_at, r.int(20, 200));
    const rec = r.chance(k.fulfil.first_use_recorded);
    let evidence = null;
    if (rec) {
      const ev = post(addMinutes(fuAt, r.int(30, 2 * 1440)), o.requester, { kind: 'done', subject: consumer ? consumer.id : part0.id, value: localDate(fuAt), true_value: localDate(fuAt), effective: localDate(fuAt), for_use: null }, consumer && (reveal !== 'never' || (lq === 'never_discussed' && r.chance(0.5))) ? [aliasRef, { id: consumer.id, mode: 'vague', token: consumer.type === 'test' ? 'the test' : 'the build' }] : [aliasRef], `${aliasRef.token} in use`);
      evidence = ev ? ev.id : null;
    }
    o.first_use = { at: fuAt, recorded: rec && !!evidence, evidence };
    info.ticket = ticket;
    if (consumer) {
      for (const id of [consumer.id, ...consumer.inputs.filter((i) => S.DL.has(i.id)).map((i) => i.id)]) { if (!feeding.has(id)) feeding.set(id, []); feeding.get(id).push(info); }
    }
  }

  // ---------------- dependency crumbs for edges not covered by order crumbs ----------------
  const edgeKey = new Map(world.edges.map((e) => [`${e.from}|${e.to}`, e]));
  const orderEdge = new Set();
  for (const o of orders) { const c = S.info.get(o.id).consumer; if (c) for (const l of o.lines) orderEdge.add(`${l.part}|${c.id}`); }
  for (const e of world.edges) {
    if (orderEdge.has(`${e.from}|${e.to}`)) continue;
    const r = rng.fork(`edge:${e.id}`);
    const want = r.weighted(k.edge_reveal_mix);
    if (want === 'never') continue;
    const slot = S.slots.get(e.to) || (S.TS.has(e.from) ? S.slots.get(e.from) : null);
    const anchor = slot ? slot.start : (S.M.get(e.to)?.date[0].value || cal.windowEnd);
    let day = cal.addWd(anchor, -r.int(3, 20));
    if (day < cal.windowStart) day = cal.addWd(cal.windowStart, r.int(0, 4));
    if (day > cal.windowEnd) continue;
    const t = cal.sampleTime(r, day);
    const owner = S.TS.get(e.to)?.owner || wiById.get(e.to)?.owner || S.M.get(e.to)?.owner || world.people[0].id;
    const asm = S.TS.get(e.to)?.assembly || wiById.get(e.to)?.assembly || S.TS.get(e.from)?.assembly;
    const channel = S.A.get(asm)?.channel || world.channels[0].id;
    const ev = S.event({
      known_at: t, source: 'slack', where: { channel, thread_of: null }, by: owner, kind: 'crumb',
      claim: { kind: 'blocked', subject: e.to, value: e.from, true_value: e.from, effective: null, for_use: null },
      refs: [{ id: e.from, mode: 'alias', token: entName(e.from) }, want === 'revealed' ? { id: e.to, mode: 'alias', token: entName(e.to) } : { id: e.to, mode: 'vague', token: vague(entName(e.to)) }],
      pressure: asm ? S.level(S.expressed(asm, day, r)) : 'low', about: e.to, brief: `${entName(e.to)} waits on ${entName(e.from)}`,
    });
    if (ev) ev._dep = true;
  }

  // ---------------- attach sibling and consumer events to orders (S12.6) ----------------
  for (const [entity, infos] of feeding) {
    for (const ev of S.eventsAbout.get(entity) || []) {
      const t = Date.parse(ev.known_at);
      for (const info of infos) {
        const o = info.order;
        const T = Date.parse(o.placed_at);
        if (t < T - 30 * 86400e3 || t > T + 60 * 86400e3) continue;
        if (ev.orders.includes(o.id) || ev.orders_after.includes(o.id)) continue;
        if (t < T) { if (o.link_quality === 'never_discussed') continue; ev.orders.push(o.id); info.crumbs.push(ev); } else { ev.orders_after.push(o.id); info.crumbsAfter.push(ev); }
      }
    }
  }

  // ---------------- revision releases (S12 table) and the list of changed facts ----------------
  const changes = []; // facts whose stated value changed: someone may repeat the old one (stale)
  const mechCh = S.CH.has('ch-mech') ? 'ch-mech' : world.channels[0].id;
  for (const p of world.parts) {
    const r = rng.fork(`rev:${p.id}`);
    const asm = S.A.get(p.belongs_to);
    for (let i = 1; i < p.revisions.length; i++) {
      const h = p.revisions[i];
      if (!S.inWin(h.known_at)) continue;
      const by = S.P.has(h.by) ? h.by : (asm?.owner || world.people[0].id);
      const channel = r.chance(0.6) ? (asm?.channel || mechCh) : mechCh;
      if (r.chance(0.8)) {
        let t = cal.sampleTime(r, cal.addWd(localDate(h.known_at), r.int(0, 2)));
        if (Date.parse(t) <= Date.parse(h.known_at)) t = addMinutes(h.known_at, r.int(5, 120));
        S.event({
          known_at: t, source: 'slack', where: { channel, thread_of: null }, by, kind: 'crumb',
          claim: { kind: 'substitute', subject: p.id, value: `rev ${h.value}`, true_value: `rev ${h.value}`, effective: h.effective ?? null, for_use: null },
          refs: [{ id: p.id, mode: 'part_number', token: p.part_number }], brief: `${p.part_number} rev ${h.value} released${h.reason ? `: ${h.reason}` : ''}`,
        });
      }
      changes.push({ kind: 'substitute', subject: p.id, prev: `rev ${p.revisions[i - 1].value}`, cur: `rev ${h.value}`, at: h.known_at, until: p.revisions[i + 1]?.known_at, name: p.aliases[0] || p.name, mode: 'alias', channel: asm?.channel || mechCh, by: asm?.owner || by });
    }
  }
  const histChanges = (list, key, channelOf) => {
    for (const x of list) {
      if (S.pinned.has(x.id)) continue;
      const h = x[key];
      for (let i = 1; i < h.length; i++) if (h[i].value !== h[i - 1].value) changes.push({ kind: 'eta', subject: x.id, prev: h[i - 1].value, cur: h[i].value, at: h[i].known_at, until: h[i + 1]?.known_at, name: x.name, mode: 'alias', channel: channelOf(x), by: S.A.get(x.assembly)?.owner || x.owner });
    }
  };
  histChanges(world.deliverables, 'eta', (d) => S.A.get(d.assembly)?.channel || world.channels[0].id);
  histChanges(world.tests, 'planned_date', (t) => S.A.get(t.assembly)?.channel || world.channels[0].id);
  histChanges(world.milestones, 'date', () => (S.CH.has('ch-build') ? 'ch-build' : world.channels[0].id));

  // ---------------- imperfections at the knob rates (S12.3) ----------------
  // Counts are set from the final crumb total so the realized rates sit on k.imperfection_rates at any volume.
  {
    const ir = k.imperfection_rates;
    const ri = rng.fork('imperfections');
    const crumbs0 = world.events.filter((x) => x.kind === 'crumb');
    const added = ir.stale_fact + ir.wrong_date_corrected + ir.contradiction; // each adds one event
    const total = crumbs0.length / (1 - added);
    const already = crumbs0.filter((x) => x.truth === 'wrong');
    const alreadyCorrected = already.filter((x) => crumbs0.some((y) => y.corrects === x.id)).length;
    let wantCorrected = Math.max(0, Math.round(ir.wrong_date_corrected * total) - alreadyCorrected);
    let wantNever = Math.max(0, Math.round(ir.wrong_never_corrected * total) - (already.length - alreadyCorrected));
    let wantContra = Math.round(ir.contradiction * total);
    let wantStale = Math.round(ir.stale_fact * total);
    const attach = (ev, c) => { if (Date.parse(ev.known_at) < Date.parse(c.o.placed_at)) { ev.orders.push(c.o.id); c.info.crumbs.push(ev); } else { ev.orders_after.push(c.o.id); c.info.crumbsAfter.push(ev); } };
    const shiftDate = (r, d) => { const n = r.int(1, 3); const w = cal.addWd(d, r.chance(0.5) ? n : -n); return w === d ? cal.addWd(d, n) : w; };
    // a wrong version of a claim value, with the brief rewritten to match; null if the claim has nothing to get wrong
    const misstate = (r, ev) => {
      const c = ev.claim;
      const base = ev.brief.split('; asks')[0];
      if (c.kind === 'needs' && c.value.by) { const by = shiftDate(r, c.value.by); return { value: { ...c.value, by }, brief: base.replace(c.value.by, by) }; }
      if (c.kind === 'needs') { const qty = c.value.qty + r.pick([1, 2, 4]); return { value: { ...c.value, qty }, brief: base.replace(`need ${c.value.qty}`, `need ${qty}`) }; }
      if (c.kind === 'eta' && typeof c.value === 'string') { const d = shiftDate(r, c.value); return { value: d, brief: base.replace(c.value, d) }; }
      if (c.kind === 'stock' && Number.isInteger(c.value)) { const q = Math.max(1, c.value + r.pick([-2, -1, 1, 2])); if (q === c.value) return null; return { value: q, brief: base.replace(`(${c.value})`, `(${q})`) }; }
      return null;
    };
    for (const c of ri.shuffle(cands)) {
      if (!wantCorrected && !wantNever && !wantContra) break;
      const ev = c.ev;
      if (ev.truth !== 'true' || ev.corrects || ev.contradicts || ev._used) continue;
      const r = ri.fork(ev.id);
      const A = S.A.get(c.info.assembly);
      const clean = ev.brief.split('; asks')[0];
      if (wantCorrected || wantNever) {
        const m = misstate(r, ev);
        if (!m) continue;
        if (wantCorrected) {
          let tc = addMinutes(ev.known_at, r.int(5, 2 * 1440));
          if (!S.inWin(tc) || !cal.isWd(localDate(tc))) tc = addMinutes(ev.known_at, r.int(5, 55));
          if (!S.inWin(tc)) continue;
          const where = ev.source === 'slack' ? { channel: ev.where.channel, thread_of: ev.id } : ev.source === 'jira' ? { ticket: ev.where.ticket, ticket_field: 'comment' } : { channel: A.channel, thread_of: null };
          const fix = S.event({
            known_at: tc, source: ev.source === 'jira' ? 'jira' : 'slack', where, by: r.chance(0.6) ? ev.by : c.o.requester, kind: 'crumb',
            claim: { ...ev.claim }, refs: ev.refs.map((x) => ({ ...x })), corrects: ev.id, pressure: ev.pressure, reports: ev.reports, brief: `Correction: ${clean}`,
          });
          if (!fix) continue;
          attach(fix, c);
          wantCorrected--;
        } else wantNever--;
        ev.claim = { ...ev.claim, value: m.value };
        ev.truth = 'wrong';
        ev.brief = m.brief + (ev.asks_expedite ? '; asks whether expediting is worth it' : '');
        ev._used = true;
      } else {
        // a second source states a conflicting value within 3 wd
        const m = misstate(r, ev);
        if (!m) continue;
        let t2 = cal.sampleTime(r, cal.addWd(localDate(ev.known_at), r.int(0, 3)));
        if (Date.parse(t2) <= Date.parse(ev.known_at)) t2 = addMinutes(ev.known_at, r.int(20, 400));
        if (!S.inWin(t2)) continue;
        let where = null; let source = 'slack'; let by = r.chance(0.5) ? c.o.placer : (S.P.get(c.o.requester).manager || c.o.requester);
        if (ev.source === 'slack') {
          const mt = S.nextMeeting(['supply_chain_mech', 'supply_chain_sync', 'program_review', 'build_readiness', 'standup'], localDate(ev.known_at), 4);
          const tm = mt ? addMinutes(mt.start, r.int(2, Math.max(3, mt.actual_min - 1))) : null;
          if (tm && Date.parse(tm) > Date.parse(ev.known_at) && S.inWin(tm)) { where = { meeting: mt.id }; source = 'meeting'; t2 = tm; by = mt.present.includes(by) ? by : mt.present[0]; } else if (c.info.ticket && Date.parse(c.info.ticket.created) <= Date.parse(t2)) { where = { ticket: c.info.ticket, ticket_field: 'comment' }; source = 'jira'; } else {
            const other = ['ch-supply-chain', 'ch-procurement', 'ch-hw-purchasing', 'ch-mech', A.channel].filter((x) => S.CH.has(x) && x !== ev.where.channel);
            where = { channel: other.length ? r.pick(other) : ev.where.channel, thread_of: null };
          }
        } else where = { channel: A.channel, thread_of: null };
        const other = S.event({
          known_at: t2, source, where, by, kind: 'crumb', truth: 'wrong',
          claim: { ...ev.claim, value: m.value, true_value: ev.claim.value }, refs: ev.refs.map((x) => ({ ...x })), contradicts: [ev.id], pressure: ev.pressure, reports: ev.reports, brief: m.brief,
        });
        if (!other) continue;
        attach(other, c);
        ev._used = true;
        wantContra--;
      }
    }
    // stale: someone repeats the previous value after the change, before the next one
    const slots = ri.shuffle(changes.flatMap((c, i) => [{ c, n: 0, i }, { c, n: 1, i }]));
    for (const { c, n, i } of slots) {
      if (!wantStale) break;
      const r = ri.fork(`stale:${i}:${n}`);
      const t = cal.sampleTime(r, cal.addWd(localDate(c.at), r.int(1, 4) + 2 * n));
      if (!S.inWin(t) || Date.parse(t) <= Date.parse(c.at) || (c.until && Date.parse(t) >= Date.parse(c.until))) continue;
      const members = S.CH.get(c.channel)?.members || [];
      const by = n === 0 || !members.length ? c.by : r.pick(members);
      const ev = S.event({
        known_at: t, source: 'slack', where: { channel: c.channel, thread_of: null }, by, kind: 'crumb', truth: 'stale',
        claim: { kind: c.kind, subject: c.subject, value: c.prev, true_value: c.cur, effective: c.kind === 'eta' ? c.prev : null, for_use: null },
        refs: [{ id: c.subject, mode: c.mode, token: c.name }], brief: `${c.name}: still quoting ${c.prev} (it changed to ${c.cur})`,
      });
      if (!ev) continue;
      wantStale--;
      for (const info of feeding.get(c.subject) || []) {
        const o = info.order; const T = Date.parse(o.placed_at); const tt = Date.parse(ev.known_at);
        if (tt < T - 30 * 86400e3 || tt > T + 60 * 86400e3) continue;
        if (tt < T) { if (o.link_quality === 'never_discussed') continue; ev.orders.push(o.id); info.crumbs.push(ev); } else { ev.orders_after.push(o.id); info.crumbsAfter.push(ev); }
      }
    }
    for (const x of world.events) delete x._used;
  }


  // ---------------- edge reveal from the events that exist ----------------
  for (const ev of world.events) {
    if (ev.kind !== 'crumb' || ev.refs.length < 2) continue;
    for (let i = 0; i < ev.refs.length; i++) for (let j = 0; j < ev.refs.length; j++) {
      if (i === j) continue;
      const e = edgeKey.get(`${ev.refs[i].id}|${ev.refs[j].id}`);
      if (!e) continue;
      e.revealed_by.push(ev.id);
      const both = ev.refs[i].mode !== 'vague' && ev.refs[j].mode !== 'vague';
      if (both) e.reveal = 'revealed'; else if (e.reveal === 'never') e.reveal = 'hinted';
      if (!e._first || ev.known_at < e._first) e._first = ev.known_at;
    }
  }
  for (const e of world.edges) e.revealed_by = [...new Set(e.revealed_by)].sort();
  for (const ev of world.events) delete ev._dep;

  // ---------------- tickets (S4b) ----------------
  const rt = rng.fork('tickets');
  for (const w of world.work_items) {
    const r = rt.fork(w.id);
    const created = w.status[0].known_at;
    const tk = mkTicket({ project: projOf(w.assembly), type: r.weighted({ Task: 55, Story: 20, 'Sub-task': 10 }), brief: w.name, assembly: w.assembly, work_item: w.id, reporter: r.chance(0.7) ? w.owner : S.A.get(w.assembly).owner, assignee: r.chance(0.85) ? w.owner : null, labels: r.chance(0.4) ? [r.pick(['build', 'fit-check', 'dvt', 'evt', 'rig'])] : [], priority: r.weighted({ Highest: 1, High: 3, Medium: 5, Low: 2 }), created, due: r.chance(k.ticket.due_date_rate) ? cal.addWd(localDate(w.actual_done), r.int(-3, 2)) : null });
    pushStatus(tk, 'In Progress', atLocalMinutes(cal.addWd(localDate(w.actual_start), r.int(0, 3)), r.int(9 * 60, 17 * 60), r.int(0, 59)), w.owner);
    const lag = r.weighted(k.ticket.close_lag);
    if (lag !== 'never') { const [lo, hi] = lag.split('-').map(Number); pushStatus(tk, 'Done', atLocalMinutes(cal.addWd(localDate(w.actual_done), r.int(lo, hi ?? lo)), r.int(15 * 60, 18 * 60), r.int(0, 59)), w.owner); }
  }
  for (const m of world.milestones) {
    const proj = world.jira_projects.find((j) => j.id === 'BLD')?.id || world.jira_projects[0].id;
    mkTicket({ project: proj, type: 'Epic', brief: m.name, reporter: m.owner, assignee: m.owner, labels: ['milestone'], priority: 'High', created: atLocal(cal.onOrAfter(cal.windowStart), '09:20'), due: m.date[0].value });
  }
  for (const t of world.tests) if (t.result === 'fail' && S.inWin(t.actual_end)) mkTicket({ project: world.jira_projects.find((j) => j.id === 'TEST')?.id || projOf(t.assembly), type: 'Bug', brief: `${t.name}: failed, root cause open`, assembly: t.assembly, test: t.id, reporter: t.owner, assignee: t.owner, labels: ['test-failure'], priority: 'High', created: addMinutes(t.actual_end, rt.fork(t.id).int(5, 120)) });
  // background chores up to the monthly volume
  const months = daysBetween(cal.windowStart, cal.windowEnd) / 30.4;
  const want = Math.round(k.ticket.per_month * months) - world.tickets.length;
  const weeks = world.meta.weeks;
  const chores = ['Update drawing and BOM', 'Clean up CAD configs', 'Investigate noise on bench unit', 'Review DFM feedback', 'Torque spec audit', 'Harness routing cleanup', 'Document test procedure', 'Calibrate instrument', 'Firmware flag for bench mode', 'Label and bin received parts', 'Update assembly work instructions', 'Tolerance stack review', 'Follow up vendor question', 'Rework fixture clamp', 'Capture lessons learned'];
  const eng = world.people.filter((p) => !['t-leadership', 't-ops'].includes(p.team));
  for (let i = 0; i < want; i++) {
    const r = rt.fork(`bg:${i}`);
    const w = r.weighted(weeks, weeks.map((x) => x.activity));
    const wds = cal.wdsOfWeek(w.week_start);
    if (!wds.length) continue;
    const created = cal.sampleTime(r, r.pick(wds));
    if (!S.inWin(created)) continue;
    const proj = r.pick(world.jira_projects);
    const asm = proj.assemblies.length ? r.pick(proj.assemblies) : null;
    const team = world.people.filter((p) => p.team === proj.team);
    const reporter = (team.length ? r.pick(team) : r.pick(eng)).id;
    const type = r.weighted({ Task: 50, Bug: 22, Story: 18, 'Sub-task': 10 });
    const due = r.chance(k.ticket.due_date_rate) ? cal.addWd(localDate(created), r.int(3, 20)) : null;
    const tk = mkTicket({ project: proj.id, type, brief: `${r.pick(chores)}${asm ? ` (${S.A.get(asm).name.toLowerCase()})` : ''}`, assembly: asm, reporter, assignee: r.chance(0.85) ? (team.length ? r.pick(team).id : reporter) : null, labels: r.chance(0.4) ? [r.pick(['cleanup', 'docs', 'bench', 'dfm', 'tech-debt'])] : [], components: r.chance(0.12) ? [r.pick(['mechanical', 'electrical', 'firmware', 'test'])] : [], priority: r.weighted({ Highest: 1, High: 3, Medium: 6, Low: 3 }), created, due });
    const closes = !r.chance(0.2);
    const startLag = Math.round(r.lognormal(1.5, 0.9) * 1440);
    if (r.chance(0.85)) pushStatus(tk, 'In Progress', addMinutes(created, 30 + startLag), tk.assignee);
    if (closes) pushStatus(tk, 'Done', addMinutes(created, 60 + startLag + Math.round(r.lognormal(5, 0.9) * 1440)), tk.assignee);
    else if (r.chance(0.2)) pushStatus(tk, 'Blocked', addMinutes(created, 90 + startLag + r.int(60, 6000)), tk.assignee);
    if (due && r.chance(k.ticket.due_edit_rate)) { const at = addMinutes(created, r.int(600, 12000)); if (S.inWin(at)) tk.due_date.push({ value: cal.addWd(due, r.int(5, 10)), effective: null, known_at: at, by: tk.assignee ?? reporter, where: null }); }
    if (r.chance(0.15) && world.tickets.length > 30) { const other = world.tickets[r.int(0, world.tickets.length - 2)]; if (other !== tk && other.project === tk.project) tk.links.push({ type: r.chance(0.6) ? 'blocks' : 'relates_to', key: other }); }
  }

  // ---------------- background events from storylines ----------------
  const topics = ['tradeoff', 'test_result', 'failure', 'debate', 'status', 'question'];
  for (const s of world.storylines) {
    const r = rng.fork(`story:${s.id}`);
    const team = S.T.get(s.team);
    const channel = team?.channels?.[0] || world.channels[0].id;
    const ppl = s.people.length ? s.people : (team?.members || [world.people[0].id]);
    for (const b of s.beats) {
      const wds = cal.wdsOfWeek(cal.weekOf(b.week));
      if (!wds.length) continue;
      const n = r.int(2, 5);
      for (let i = 0; i < n; i++) {
        const t = cal.sampleTime(r, r.pick(wds));
        S.event({ known_at: t, source: 'slack', where: { channel: S.CH.has(channel) ? channel : world.channels[0].id, thread_of: null }, by: r.pick(ppl), kind: 'background', topic: r.pick(topics), storyline: s.id, brief: b.summary });
      }
    }
  }

  // one background beat per recorded meeting that is not a standup
  for (const m of world.meetings) {
    if (!m.recorded || m.type === 'standup') continue;
    const r = rng.fork(`mtgbg:${m.id}`);
    S.event({ known_at: addMinutes(m.start, r.int(1, Math.max(2, m.actual_min - 1))), source: 'meeting', where: { meeting: m.id }, by: r.pick(m.present), kind: 'background', topic: r.pick(['status', 'logistics', 'question', 'debate']), brief: `${m.name}: round of updates` });
  }

  // ---------------- other-vendor orders (S11) ----------------
  const ro = rng.fork('other');
  const byCat = new Map();
  for (const v of world.vendors) { if (!byCat.has(v.category)) byCat.set(v.category, []); byCat.get(v.category).push(v); }
  const buyersAll = world.people.filter((p) => p.orders.weight !== 'none' || p.team === 't-techs');
  const deptOf = (p) => world.finance.ramp_departments.find((d) => d.teams.includes(p.team))?.name || null;
  const glOf = { fasteners: '5110', amazon_consumables: '6500', electronics: '5130', pcb: '5130', other_custom_fab: '5110', motors_gearing_bearings: '5140', sensors: '5170', batteries_power: '5180', tools_test_equipment: '5160', raw_stock: '5150', shipping: '5210', saas: '6400' };
  const glIds = new Set(world.finance.gl_accounts.map((g) => g.id));
  const addOther = (r, { vendor, category, description, amount, at, by, deliverable = null, recurring = false }) => {
    if (!S.inWin(at)) return null;
    const id = S.nextId('ord-o', 5);
    const bill = vendor.payment_method !== 'card' && vendor.payment_method !== 'paypal';
    const txId = uuid(r);
    const person = S.P.get(by);
    const noMemo = r.chance(['amazon_consumables', 'tools_test_equipment'].includes(category) ? 0.34 : 0.18);
    const delivered = recurring ? null : atLocalMinutes(cal.addWd(localDate(at), r.int(1, 6)), r.int(9 * 60, 16 * 60));
    const past = delivered && Date.parse(delivered) <= Date.parse(world.meta.demo_now);
    world.orders.push({ id, type: 'other', vendor: vendor.id, category, description, amount_usd: amount, placed_at: at, by, payment_method: vendor.payment_method, status: recurring || past ? 'delivered' : 'shipped', delivered_at: delivered, ramp_transaction_ids: [txId], deliverable, test: null, recurring, duplicate_of: null });
    world.ramp_transactions.push({
      id: txId, order: id, instrument: bill ? 'bill' : 'card', kind: 'charge', state: 'CLEARED', amount_usd: amount, user_transaction_time: at, settlement_date: addDays(localDate(at), r.int(1, 3)),
      card_id: bill ? null : (person.ramp_card_ids[0] || null), card_holder: by, merchant_name: vendor.name, merchant_descriptor: r.pick(vendor.descriptors), mcc: vendor.mcc,
      memo_present: !noMemo, receipt_present: !r.chance(0.15), original_transaction_id: null, department: deptOf(person), gl_account: glIds.has(glOf[category]) ? glOf[category] : null, project_code: null,
    });
    return id;
  };
  for (const w of world.meta.weeks) {
    const wds = cal.wdsOfWeek(w.week_start);
    if (!wds.length) continue;
    const act = Math.sqrt(w.activity) * (wds.length / 5);
    for (const cat of Object.keys(OTHER)) {
      const vs = byCat.get(cat); if (!vs?.length) continue;
      const r = ro.fork(`${w.week_start}:${cat}`);
      const [rate, median, cap] = OTHER[cat];
      const n = r.poisson(rate * act);
      for (let i = 0; i < n; i++) {
        let amount = Math.min(cap, r.lognormal(median, 0.85));
        amount = roundMoney(Math.max(4.5, amount) + 0.01 * r.int(1, 98));
        const by = r.pick(buyersAll).id;
        addOther(r, { vendor: r.pick(vs), category: cat, description: r.pick(DESC[cat]), amount, at: cal.sampleTime(r, r.pick(wds)), by });
      }
    }
  }
  // bought deliverables: one order each, placed at the seed order date when it falls in the window
  for (const d of world.deliverables) {
    if (!d.vendor || !d._order_date || d._order_date < cal.windowStart || d._order_date > cal.windowEnd) continue;
    const r = ro.fork(`dl:${d.id}`);
    const v = S.V.get(d.vendor);
    const med = (OTHER[v.category] || [0, 800])[1];
    const by = S.buyers[0] || d.owner;
    const id = addOther(r, { vendor: v, category: v.category, description: d.name, amount: roundMoney(r.lognormal(med * 2, 0.5) + 0.37), at: cal.sampleBusinessTime(r, cal.onOrAfter(d._order_date)), by, deliverable: d.id });
    if (id) { d.order = id; const o = world.orders[world.orders.length - 1]; const arr = atLocal(d.true_arrival, '11:00'); o.delivered_at = arr; o.status = Date.parse(arr) <= Date.parse(world.meta.demo_now) ? 'delivered' : 'placed'; }
  }
  // SaaS: 30 subscriptions on a fixed day each month
  const saas = byCat.get('saas') || [];
  const admin = world.people.find((p) => /finance|ops/i.test(p.title)) || world.people[0];
  for (let i = 0; i < 30 && saas.length; i++) {
    const r = ro.fork(`saas:${i}`);
    const v = saas[i % saas.length];
    const dayOfMonth = r.int(1, 28);
    const amount = roundMoney(r.lognormal(180, 1.0) + 0.99);
    const holder = r.chance(0.6) ? admin.id : r.pick(world.people.filter((p) => /lead/i.test(p.title))).id;
    for (let mo = 2; mo <= 11; mo++) {
      const day = `2026-${String(mo).padStart(2, '0')}-${String(dayOfMonth).padStart(2, '0')}`;
      if (day < cal.windowStart || day > cal.windowEnd) continue;
      addOther(r, { vendor: v, category: 'saas', description: `${v.name} subscription ${i < saas.length ? '' : `(seat pack ${Math.floor(i / saas.length) + 1})`}`.trim(), amount, at: atLocalMinutes(day, r.int(60, 400), r.int(0, 59)), by: holder, recurring: true });
    }
  }
}
