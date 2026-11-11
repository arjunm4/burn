// Seed normalisation: turns canon + org + program seeds into schema-shaped base collections.
// Every field a seed omits gets a deterministic default, so a thin seed (or none) still gives a valid world.
import { makeCalendar, atLocal, addDays } from '../lib/calendar.mjs';
import { cmp, sha256 } from '../lib/io.mjs';

const clone = (x) => JSON.parse(JSON.stringify(x));
const byId = (arr) => new Map(arr.map((x) => [x.id, x]));
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function uuid(rng) {
  const hex = (n) => { let s = ''; for (let i = 0; i < n; i++) s += '0123456789abcdef'[rng.int(0, 15)]; return s; };
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${'89ab'[rng.int(0, 3)]}${hex(3)}-${hex(12)}`;
}
const upperId = (rng, n) => { let s = ''; for (let i = 0; i < n; i++) s += 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789'[rng.int(0, 33)]; return s; };

function mergeById(base = [], over = []) {
  const m = new Map();
  for (const x of base) m.set(x.id, clone(x));
  for (const x of over) m.set(x.id, { ...(m.get(x.id) || {}), ...clone(x) });
  return [...m.values()];
}

const SURNAMES = ['Okafor', 'Lindqvist', 'Marsh', 'Raman', 'Castell', 'Brandt', 'Zhou', 'Haddad', 'Nair', 'Vega', 'Sato', 'Reid', 'Moreau', 'Tanaka', 'Eze', 'Weber', 'Dubois', 'Aziz', 'Qureshi', 'Tran', 'Keller', 'Chen', 'Menon', 'Petrova', 'Volkov', 'Adler', 'Costa', 'Wu', 'Ruiz', 'Park', 'Byrne', 'Farouk', 'Mehta', 'Arnett', 'Lowe', 'Siddiqui', 'Fontaine', 'Ilves', 'Kovac', 'Osei'];
const CATEGORIES = ['sensor_bracket', 'motor_mount_plate', 'housing', 'drive_shaft', 'adapter_plate', 'test_fixture', 'spacer_bushing', 'arm_link'];
const CAT_NAMES = {
  sensor_bracket: ['encoder bracket', 'IMU bracket', 'load-cell bracket', 'sensor mount'],
  motor_mount_plate: ['motor mount plate', 'stator carrier', 'motor flange'],
  housing: ['gear housing', 'output housing', 'bearing housing', 'cover'],
  drive_shaft: ['output shaft', 'input shaft', 'pin shaft'],
  adapter_plate: ['adapter plate', 'interface plate', 'coupling plate'],
  test_fixture: ['test fixture', 'clamp block', 'alignment jig', 'load adapter'],
  spacer_bushing: ['spacer', 'bushing', 'shim ring', 'standoff'],
  arm_link: ['link', 'yoke', 'clevis', 'crank arm'],
};
const AREA = { 'a-hip-actuator': 'HIP', 'a-knee-actuator': 'KNE', 'a-ankle': 'ANK', 'a-leg': 'LEG', 'a-hand': 'HND', 'a-torso-pelvis': 'STR', 'a-battery-enclosure': 'BAT' };
const MATERIALS = ['Aluminum 6061-T6', 'Aluminum 7075-T651', 'Steel 4140, pre-hardened', 'Stainless 17-4 PH', 'Titanium Ti-6Al-4V', 'Aluminum MIC-6'];
const FINISHES = ['As machined', 'Type II anodize, clear', 'Type III hard anodize, black', 'Black oxide', 'Bead blast'];

export function setup({ canon, org = {}, program = {}, knobs, seed, rng }) {
  const r = rng.fork('setup');
  const meta = clone(canon.meta);
  meta.seed = seed;
  const cal = makeCalendar(meta);
  const t0 = atLocal(cal.onOrAfter(cal.windowStart), '09:00');
  const notes = [];

  // ---- people ----
  const rosterAsPeople = (canon.roster || []).map((p) => ({ id: p.id, first_name: p.first_name, team: p.team, title: p.role }));
  let people = mergeById(mergeById(rosterAsPeople, canon.fixed_people || []), org.people || []);
  const teamsSeed = mergeById(canon.teams || [], org.teams || []);
  const isLead = (p) => /lead|head of|ceo|cto|vp /i.test(p.title || p.role || '');
  const leadOf = new Map();
  for (const t of teamsSeed) {
    const members = people.filter((p) => p.team === t.id);
    const lead = (t.lead && members.find((p) => p.id === t.lead)) || members.find(isLead) || members[0] || people[0];
    leadOf.set(t.id, lead?.id);
  }
  const ceo = people.find((p) => /ceo/i.test(p.title || '')) || people[0];
  const vpHw = people.find((p) => /vp hardware/i.test(p.title || '')) || ceo;
  people = people.map((p, i) => {
    const pr = r.fork(`person:${p.id}`);
    const first = p.first_name || (p.name ? p.name.split(' ')[0] : p.id.replace(/^p-/, '').replace(/^./, (c) => c.toUpperCase()));
    const name = p.name || `${first} ${SURNAMES[i % SURNAMES.length]}`;
    const title = p.title || p.role || 'Engineer';
    const lead = leadOf.get(p.team);
    const manager = p.manager !== undefined ? p.manager : (lead && lead !== p.id ? lead : (p.id === ceo.id ? null : (p.team === 't-leadership' ? ceo.id : vpHw.id === p.id ? ceo.id : vpHw.id)));
    const mech = /^t-mech/.test(p.team);
    const supply = p.team === 't-supply';
    const test = p.team === 't-test';
    const defWeight = supply ? (isLead(p) ? 'light' : 'heavy') : mech ? (isLead(p) ? 'medium' : pr.weighted({ heavy: 2, medium: 5, light: 2 })) : test ? 'medium' : ['t-techs', 't-mfg', 't-electrical'].includes(p.team) ? 'light' : 'none';
    const o = p.orders || {};
    const habit = o.habit || (defWeight === 'none' ? 'none' : pr.weighted(knobs.ordering_habit_mix));
    const range = knobs.belief.checks_dependencies_range;
    const orders = {
      weight: o.weight || defWeight,
      habit,
      habit_strength: o.habit_strength ?? knobs.decide.habit_strength,
      wtp_per_day_usd: o.wtp_per_day_usd ?? Math.round(pr.lognormal(knobs.decide.wtp_median_usd, knobs.decide.wtp_sigma)),
      checks_dependencies: o.checks_dependencies ?? +pr.uniform(range[0], range[1]).toFixed(2),
      queue_delay_days: o.queue_delay_days ?? (supply ? [0, 2] : null),
      batch_days: o.batch_days ?? null,
    };
    const s = p.style || {};
    const out = {
      ...p,
      id: p.id, name, display_name: p.display_name || first.toLowerCase(), title, team: p.team,
      manager: manager === p.id ? null : manager,
      email: p.email || `${first.toLowerCase()}@flintlockrobotics.com`,
      slack_id: p.slack_id || `U07${upperId(pr, 8)}`,
      jira_account_id: p.jira_account_id || uuid(pr).replace(/-/g, '').slice(0, 24),
      ramp_user_id: p.ramp_user_id || uuid(pr),
      ramp_card_ids: p.ramp_card_ids || [uuid(pr)],
      start_date: p.start_date || addDays('2024-01-08', pr.int(0, 600)),
      end_date: p.end_date ?? null,
      ooo: p.ooo || [],
      orders,
      delegate: p.delegate ?? null,
      style: {
        case: s.case || pr.pick(['lower', 'mixed', 'proper']), punctuation: s.punctuation || pr.pick(['none', 'light', 'full']),
        typos: s.typos || pr.pick(['none', 'rare', 'some']), emoji: s.emoji || pr.pick(['none', 'rare', 'some']),
        length: s.length || pr.pick(['terse', 'medium', 'long']), hedging: s.hedging || pr.pick(['low', 'medium', 'high']),
        quirks: s.quirks || [],
      },
      chattiness: p.chattiness ?? +pr.uniform(0.4, 1.6).toFixed(2),
      lurker: p.lurker ?? false,
      authority_on: p.authority_on || [],
    };
    for (const k of ['first_name', 'role', 'note']) delete out[k];
    return out;
  });
  const P = byId(people);
  const anyPerson = (id) => (P.has(id) ? id : null);

  // ---- resolve @role:<team> and unknown person ids in the program seed ----
  const resolveRoles = (v) => {
    if (typeof v === 'string') return v.startsWith('@role:') ? (leadOf.get(v.slice(6)) || people[0].id) : v;
    if (Array.isArray(v)) return v.map(resolveRoles);
    if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = resolveRoles(x); return o; }
    return v;
  };
  const prog = resolveRoles(clone(program));

  // ---- teams ----
  const channelsSeed = mergeById(canon.channels || [], org.channels || []);
  const assembliesSeed = mergeById(canon.assemblies || [], prog.assemblies || []);
  const jiraSeed = mergeById(canon.jira_projects || [], org.jira_projects || []);
  const teams = teamsSeed.map((t) => {
    const members = people.filter((p) => p.team === t.id).map((p) => p.id);
    const out = {
      ...t, id: t.id, name: t.name || t.id, headcount: t.headcount ?? members.length, lead: leadOf.get(t.id), members,
      channels: (t.channels || assembliesSeed.filter((a) => a.team === t.id).map((a) => a.channel)).filter((c, i, a) => c && a.indexOf(c) === i),
      jira_project: t.jira_project ?? (jiraSeed.find((j) => j.team === t.id)?.id || null),
      department: t.department || t.name || t.id,
      expressiveness: t.expressiveness ?? +r.fork(`team:${t.id}`).uniform(-0.25, 0.25).toFixed(2),
    };
    delete out.note;
    return out;
  });
  const T = byId(teams);

  // ---- channels ----
  const channels = channelsSeed.map((c) => {
    const out = {
      ...c, id: c.id, name: c.name || c.id.replace(/^ch-/, ''), slack_id: c.slack_id || `C07${upperId(r.fork(`ch:${c.id}`), 8)}`,
      purpose: c.purpose || '', type: c.type || 'public',
      members: (c.members || people.map((p) => p.id)).filter(anyPerson), bots: c.bots || [],
      base_rate_per_day: c.base_rate_per_day ?? 15, on_topic_share: c.on_topic_share ?? 0.85,
      purchasing_relevant: c.purchasing_relevant ?? false, assembly: c.assembly ?? null,
    };
    delete out.note;
    return out;
  });
  const C = byId(channels);
  for (const t of teams) t.channels = t.channels.filter((c) => C.has(c));

  // ---- assemblies ----
  const assemblies = assembliesSeed.map((a) => {
    const owner = anyPerson(a.owner) || T.get(a.team)?.lead || people[0].id;
    const wrap = (v, def) => (Array.isArray(v) ? v : [{ value: v ?? def, effective: null, known_at: t0, by: owner, where: null }]);
    const out = {
      ...a, id: a.id, name: a.name, owner, team: a.team,
      working_state: wrap(a.working_state, 'design'), revision: wrap(a.revision, 'EVT'),
      jira_project: a.jira_project, channel: C.has(a.channel) ? a.channel : channels[0].id, project_code: a.project_code || `PRJ-${slug(a.id).toUpperCase()}`,
      parent: a.parent ?? null, description: a.description ?? null,
    };
    delete out.state_at_window_end; delete out.note;
    return out;
  });
  const A = byId(assemblies);

  // ---- jira projects ----
  const jira_projects = jiraSeed.map((j) => ({
    ...j, id: j.id, name: j.name || j.id, lead: anyPerson(j.lead) || T.get(j.team)?.lead || people[0].id, team: j.team,
    assemblies: (j.assemblies || assemblies.filter((a) => a.jira_project === j.id).map((a) => a.id)).filter((x) => A.has(x)),
  }));

  // ---- vendors ----
  let vendorsSeed = org.vendors;
  if (!Array.isArray(vendorsSeed)) {
    vendorsSeed = [];
    for (const [category, ids] of Object.entries(canon.vendors || {})) for (const id of ids) vendorsSeed.push({ id, category });
  } else {
    const have = new Set(vendorsSeed.map((v) => v.id));
    for (const [category, ids] of Object.entries(canon.vendors || {})) for (const id of ids) if (!have.has(id)) vendorsSeed.push({ id, category });
  }
  const vendors = vendorsSeed.map((v) => {
    const nm = v.name || v.id.replace(/^v-/, '').replace(/-/g, ' ').replace(/\b./g, (c) => c.toUpperCase());
    const sh = v.shipping || {};
    return {
      ...v, id: v.id, name: nm, category: v.category,
      descriptors: v.descriptors?.length ? v.descriptors : (v.id === 'v-xometry' ? ['XOMETRY INC NORTH BETHESDA MD', 'XOMETRY.COM DERWOOD MD', 'XOMETRY*ORDER'] : [nm.toUpperCase().slice(0, 22)]),
      payment_method: v.payment_method || 'card', terms: v.terms ?? null, mcc: v.mcc ?? null, local: v.local ?? false,
      shipping: { carrier: sh.carrier || 'UPS', transit_days: sh.transit_days || [1, 5], splits_shipments: sh.splits_shipments ?? false, cutoff_local: sh.cutoff_local ?? null },
    };
  });
  if (!vendors.some((v) => v.id === 'v-xometry')) vendors.push({ id: 'v-xometry', name: 'Xometry', category: 'cnc_xometry', descriptors: ['XOMETRY INC NORTH BETHESDA MD'], payment_method: 'card', terms: null, mcc: null, local: false, shipping: { carrier: 'FedEx', transit_days: [1, 5], splits_shipments: false, cutoff_local: null } });

  // ---- finance ----
  const fin = org.finance || {};
  const claire = people.find((p) => /finance/i.test(p.title)) || ceo;
  const finance = {
    gl_accounts: fin.gl_accounts || [{ id: '5110', name: 'Prototype materials and parts' }, { id: '5120', name: 'Test equipment and fixtures' }, { id: '5130', name: 'Lab consumables' }, { id: '6400', name: 'Software subscriptions' }, { id: '6500', name: 'Shipping and freight' }],
    project_codes: fin.project_codes || assemblies.map((a) => ({ code: a.project_code, name: a.name, assembly: a.id })),
    ramp_departments: fin.ramp_departments || [...new Set(teams.map((t) => t.department))].map((d) => ({ id: `dept-${slug(d)}`, name: d, teams: teams.filter((t) => t.department === d).map((t) => t.id) })),
    approval: {
      rule: fin.approval?.rule || "requester's manager approves", auto_approve_under_usd: fin.approval?.auto_approve_under_usd ?? 250,
      second_approver_over_usd: fin.approval?.second_approver_over_usd ?? 5000, second_approver: anyPerson(fin.approval?.second_approver) || claire.id,
    },
  };

  // ---- meeting series ----
  const supplyLead = T.get('t-supply')?.lead || people[0].id;
  const tpm = T.get('t-program')?.lead || people[0].id;
  const mechLeads = teams.filter((t) => /^t-mech/.test(t.id)).map((t) => t.lead).filter(Boolean);
  const supplyAll = people.filter((p) => p.team === 't-supply').map((p) => p.id);
  const defaultSeries = [
    { id: 'ms-supply-chain-sync', name: 'Supply chain sync', type: 'supply_chain_sync', rrule: 'FREQ=WEEKLY;BYDAY=TU', start_local: '10:00', duration_min: 30, organizer: supplyLead, attendees: [...supplyAll, tpm], note_taker: 'fireflies', recorded: true },
    { id: 'ms-sc-mech', name: 'Supply chain + mech sync', type: 'supply_chain_mech', rrule: 'FREQ=WEEKLY;BYDAY=TH', start_local: '10:30', duration_min: 30, organizer: supplyAll[1] || supplyLead, attendees: [...supplyAll, ...mechLeads], note_taker: 'granola', recorded: true },
    { id: 'ms-program-review', name: 'Program review', type: 'program_review', rrule: 'FREQ=WEEKLY;BYDAY=MO', start_local: '14:00', duration_min: 60, organizer: tpm, attendees: [tpm, ...mechLeads, supplyLead, vpHw.id], note_taker: 'fireflies', recorded: true },
  ];
  const meeting_series = (org.meeting_series?.length ? org.meeting_series : defaultSeries).map((s) => ({
    ...s, id: s.id, name: s.name || s.id, type: s.type, rrule: s.rrule || 'FREQ=WEEKLY;BYDAY=WE', start_local: s.start_local || '10:00',
    duration_min: s.duration_min ?? 30, organizer: anyPerson(s.organizer) || tpm,
    attendees: [...new Set((s.attendees || []).filter(anyPerson))], optional_attendees: (s.optional_attendees || []).filter(anyPerson),
    note_taker: s.note_taker || 'none', recorded: s.recorded ?? false, conference: s.conference ?? null,
  }));

  // ---- pinned demo entities ----
  const demo = prog.demo || null;
  const pinned = new Set();
  if (demo) for (const id of [demo.part, demo.test, demo.motor?.deliverable, demo.milestone]) if (id) pinned.add(id);

  // ---- parts ----
  const partsSeed = mergeById(canon.parts || [], prog.parts || []);
  const usedPn = new Set(partsSeed.map((p) => p.part_number).filter(Boolean));
  const rigsSeed = mergeById(canon.test_rigs || [], prog.test_rigs || []);
  const resSeed = mergeById(canon.resources || [], prog.resources || []);
  const placeIds = new Set([...assemblies.map((a) => a.id), ...rigsSeed.map((x) => x.id), ...resSeed.map((x) => x.id)]);
  const mkPn = (pr, area) => { let pn; do { pn = `FL-${area}-${pr.int(1001, 4999)}`; } while (usedPn.has(pn)); usedPn.add(pn); return pn; };
  const normPart = (p) => {
    const pr = r.fork(`part:${p.id}`);
    const belongs = placeIds.has(p.belongs_to) ? p.belongs_to : (assemblies.find((a) => p.id.includes(a.id.slice(2)))?.id || assemblies[0].id);
    const kind = p.kind || 'robot_part';
    const pn = p.part_number || mkPn(pr, kind === 'test_hardware' ? 'TST' : AREA[belongs] || 'STR');
    const owner = A.get(belongs)?.owner || T.get('t-test')?.lead || people[0].id;
    let revisions = p.revisions;
    if (!Array.isArray(revisions)) revisions = [{ value: revisions || 'A', effective: cal.windowStart, known_at: t0, by: owner, where: null, reason: 'initial release' }];
    const out = {
      ...p, id: p.id, name: p.name, part_number: pn,
      cad_file: p.cad_file || `${pn}_${slug(p.name)}_rev${revisions[revisions.length - 1].value}.step`,
      aliases: p.aliases?.length ? p.aliases : [p.name.toLowerCase().split(' ').slice(-2).join(' '), `the ${p.name.toLowerCase().split(' ').slice(-1)[0]}`, pn.slice(-4)],
      belongs_to: belongs, kind, category: CATEGORIES.includes(p.category) ? p.category : (kind === 'test_hardware' ? 'test_fixture' : pr.pick(CATEGORIES)),
      material: p.material || pr.pick(MATERIALS), finish: p.finish || pr.pick(FINISHES), tolerance: p.tolerance || '+/-0.005 in',
      process: p.process || pr.weighted({ cnc_milling_3axis: 6, cnc_milling_5axis: 2, cnc_turning: 2, cnc_mill_turn: 1 }),
      typical_qty: p.typical_qty ?? pr.weighted([[1, 3], [2, 4], [4, 2], [6, 1], [10, 1]]), vendor: 'v-xometry', revisions,
      price_hint_usd: p.price_hint_usd ?? null,
    };
    delete out.note;
    return out;
  };
  const parts = partsSeed.map(normPart);
  // Top up thin catalogs so order volume never depends on the seed's size.
  for (const a of assemblies) {
    const have = parts.filter((p) => p.belongs_to === a.id).length;
    const pr = r.fork(`fillparts:${a.id}`);
    for (let i = have; i < 10; i++) {
      const category = pr.pick(CATEGORIES);
      const kind = category === 'test_fixture' ? 'test_hardware' : 'robot_part';
      const base = pr.pick(CAT_NAMES[category]);
      const name = `${a.name.split(' ')[0]} ${base} ${i + 1}`;
      parts.push(normPart({ id: `pt-${slug(a.id.slice(2))}-${slug(base)}-${i + 1}`, name, belongs_to: a.id, kind, category, aliases: [base, `the ${base.split(' ').slice(-1)[0]}`, `${a.name.split(' ')[0].toLowerCase()} ${base.split(' ').slice(-1)[0]}`] }));
    }
  }
  if (parts.some((p) => !p.aliases.length)) notes.push('part without aliases');

  // ---- milestones ----
  const milestonesSeed = mergeById(canon.milestones || [], prog.milestones || []);
  const milestones = milestonesSeed.map((m) => {
    const owner = anyPerson(m.owner) || tpm;
    const wrapD = (v) => (Array.isArray(v) ? v : [{ value: v, effective: null, known_at: t0, by: owner, where: null }]);
    const vp = m.value_policy;
    const out = {
      ...m, id: m.id, name: m.name, owner, kind: m.kind, hardness: m.hardness || 'soft',
      assemblies: (m.assemblies || []).filter((x) => A.has(x)),
      date: wrapD(m.date),
      value_policy: Array.isArray(vp) ? vp : [{ value: vp ? { type: vp.type, usd_per_day: vp.usd_per_day, curve: vp.curve } : { type: 'none' }, effective: null, known_at: t0, by: anyPerson(vp?.set_by) || owner, where: null }],
      burst_weeks: m.burst_weeks ?? null, actual_date: m.actual_date ?? null,
    };
    delete out.note;
    return out;
  });
  const M = byId(milestones);

  // ---- rigs, resources ----
  const testLead = T.get('t-test')?.lead || people[0].id;
  const partIds = new Set(parts.map((p) => p.id));
  const normRig = (x) => { const o = { ...x, owner: anyPerson(x.owner) || testLead, needs: (x.needs || []).filter((n) => partIds.has(n)), slot_days: x.slot_days ?? null, bookings: x.bookings || [] }; delete o.note; return o; };
  const test_rigs = rigsSeed.map(normRig);
  const resources = resSeed.map((x) => ({ ...normRig(x), kind: x.kind || 'bench' }));
  if (![...test_rigs, ...resources].some((x) => x.slot_days)) {
    // No slotted resource in the seed: give two a slot pattern so test-slot cliffs exist.
    const a = resources.find((x) => x.kind === 'metrology') || resources[0];
    const b = resources.find((x) => x.kind === 'chamber') || resources[1];
    if (a) a.slot_days = [2, 4];
    if (b && b !== a) b.slot_days = [1];
  }

  // ---- deliverables ----
  const dlSeed = mergeById(canon.deliverables || [], prog.deliverables || []);
  const deliverables = dlSeed.map((d) => {
    const owner = anyPerson(d.owner) || A.get(d.assembly)?.owner || people[0].id;
    const out = {
      ...d, id: d.id, name: d.name, kind: d.kind || 'other', owner, assembly: A.has(d.assembly) ? d.assembly : null,
      vendor: vendors.some((v) => v.id === d.vendor) ? d.vendor : null, order: null,
      eta: Array.isArray(d.eta) ? d.eta : (d.eta ? [{ value: d.eta, effective: null, known_at: t0, by: owner, where: null }] : null),
      true_arrival: d.true_arrival ?? null,
    };
    delete out.note;
    return out;
  });

  // ---- tests ----
  const testsSeed = mergeById(canon.tests || [], prog.tests || []);
  const testInputs = new Map();
  const tests = testsSeed.map((t) => {
    const pr = r.fork(`test:${t.id}`);
    const owner = anyPerson(t.owner) || testLead;
    const ms = M.get(t.milestone);
    const msDate = ms ? ms.date[0].value : null;
    let planned = t.planned_date;
    const dur = t.duration_true_days ?? pr.int(1, 5);
    if (!Array.isArray(planned)) {
      const d = planned || t.earliest_start || (msDate ? cal.addWd(msDate, -(dur + pr.int(1, 6))) : cal.addWd(cal.windowStart, pr.int(20, 150)));
      planned = [{ value: cal.onOrAfter(d), effective: null, known_at: t0, by: owner, where: null }];
    }
    testInputs.set(t.id, t.inputs || []);
    const out = {
      ...t, id: t.id, name: t.name, assembly: A.has(t.assembly) ? t.assembly : assemblies[0].id,
      rig: test_rigs.some((x) => x.id === t.rig) ? t.rig : null, resources: (t.resources || []).filter((x) => resources.some((y) => y.id === x)),
      owner, milestone: M.has(t.milestone) ? t.milestone : null, duration_true_days: dur,
      duration_estimate_days: t.duration_estimate_days || [Math.max(1, dur - 1), dur],
      planned_date: planned, earliest_start: t.earliest_start || planned[0].value,
      actual_start: t.actual_start ?? null, actual_end: t.actual_end ?? null, result: t.result ?? 'not_run', rerun_of: t.rerun_of ?? null,
    };
    delete out.inputs; delete out.note;
    return out;
  });

  // ---- storylines ----
  const storylines = (prog.storylines || []).map((s) => ({
    ...s, id: s.id, name: s.name || s.id, team: T.has(s.team) ? s.team : teams[0].id, topic: s.topic || s.name || '',
    people: (s.people || []).filter(anyPerson), start: s.start || cal.windowStart, end: s.end || cal.windowEnd, beats: s.beats || [],
  }));

  meta.weeks = cal.buildWeeks(milestones, knobs.orders);
  meta.pressure_windows = [];
  meta.budget_windows = [];
  meta.knobs_hash = sha256(JSON.stringify(knobs)).slice(0, 16);

  const sortId = (arr) => arr.sort((a, b) => cmp(a.id, b.id));
  return {
    cal, t0, pinned, testInputs, notes, prog, leadOf,
    world: {
      meta, teams: sortId(teams), people: sortId(people), assemblies: sortId(assemblies), parts: sortId(parts),
      test_rigs: sortId(test_rigs), resources: sortId(resources), tests: sortId(tests), deliverables: sortId(deliverables),
      work_items: [], milestones: sortId(milestones), edges: [], demands: [], slips: [], storylines: sortId(storylines),
      channels: sortId(channels), jira_projects: sortId(jira_projects), meeting_series: sortId(meeting_series), meetings: [],
      tickets: [], vendors: sortId(vendors), finance, orders: [], ramp_transactions: [], events: [], demo,
    },
  };
}
