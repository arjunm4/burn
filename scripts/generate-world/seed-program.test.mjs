import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ENUMS, checkTime, isDate } from './schema.mjs';

const root = new URL('../../fixtures/world/seed/', import.meta.url);
const load = (p) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
const prog = load('program.json');
const canon = load('canon.json');

const roster = new Set(canon.roster.map((p) => p.id));
const COLLS = ['assemblies', 'parts', 'test_rigs', 'resources', 'tests', 'deliverables', 'work_items', 'milestones', 'storylines'];
const ids = new Set();
for (const c of COLLS) for (const r of prog[c] ?? []) ids.add(r.id);
const canonIds = new Set([
  ...canon.assemblies, ...canon.test_rigs, ...canon.resources, ...canon.tests, ...canon.milestones,
  ...canon.deliverables, ...canon.parts, ...canon.teams, ...canon.channels, ...canon.jira_projects,
].map((x) => x.id));
const vendors = new Set(Object.values(canon.vendors).flat());
const known = (id) => ids.has(id) || canonIds.has(id);
const person = (id) => roster.has(id);
const W_START = '2026-02-10';
const W_END = '2026-11-10';

test('program.json parses and has every §7 key', () => {
  for (const k of [...COLLS, 'demo']) assert.ok(prog[k], `missing ${k}`);
});

test('ids are unique across the file', () => {
  const all = COLLS.flatMap((c) => (prog[c] ?? []).map((r) => r.id));
  const dups = all.filter((x, i) => all.indexOf(x) !== i);
  assert.deepEqual(dups, []);
  const pns = prog.parts.map((p) => p.part_number);
  assert.equal(new Set(pns).size, pns.length, 'duplicate part numbers');
});

test('canon entities are present and not renamed', () => {
  for (const c of ['assemblies', 'test_rigs', 'resources', 'tests', 'milestones', 'deliverables', 'parts']) {
    for (const x of canon[c]) {
      const r = prog[c].find((y) => y.id === x.id);
      assert.ok(r, `${c}: canon id ${x.id} missing`);
      if (x.name) assert.equal(r.name, x.name, `${x.id} renamed`);
      if (x.part_number) assert.equal(r.part_number, x.part_number);
    }
  }
});

test('people are referenced only by roster ids', () => {
  const bad = [];
  const chk = (where, id) => { if (id != null && !person(id)) bad.push(`${where}: ${id}`); };
  for (const c of ['assemblies', 'test_rigs', 'resources', 'tests', 'deliverables', 'work_items', 'milestones']) {
    for (const r of prog[c]) chk(`${r.id}.owner`, r.owner);
  }
  for (const s of prog.storylines) for (const p of s.people) chk(s.id, p);
  for (const m of prog.milestones) if (!Array.isArray(m.value_policy)) chk(`${m.id}.set_by`, m.value_policy.set_by);
  const hists = (r) => ['working_state', 'revision', 'revisions', 'planned_date', 'date', 'value_policy', 'eta', 'status']
    .filter((f) => Array.isArray(r[f])).flatMap((f) => r[f]);
  for (const c of COLLS) for (const r of prog[c]) for (const h of hists(r)) chk(r.id, h.by);
  for (const r of [...prog.test_rigs, ...prog.resources]) for (const b of r.bookings) chk(b.id, b.by);
  const d = prog.demo;
  [d.requester, d.motor.owner, d.motor.stated_by, d.policy.set_by, ...d.live_changes.map((l) => l.by)].forEach((p) => chk('demo', p));
  assert.deepEqual(bad, []);
});

test('every reference resolves', () => {
  const bad = [];
  const chk = (where, id) => { if (id != null && !known(id)) bad.push(`${where}: ${id}`); };
  for (const a of prog.assemblies) { chk(a.id, a.team); chk(a.id, a.jira_project); chk(a.id, a.channel); }
  for (const p of prog.parts) { chk(p.id, p.belongs_to); if (!vendors.has(p.vendor)) bad.push(`${p.id}: vendor ${p.vendor}`); }
  for (const r of [...prog.test_rigs, ...prog.resources]) {
    r.needs.forEach((n) => chk(r.id, n));
    r.bookings.forEach((b) => chk(b.id, b.test));
  }
  for (const t of prog.tests) {
    chk(t.id, t.assembly); chk(t.id, t.rig); chk(t.id, t.milestone); chk(t.id, t.rerun_of);
    t.resources.forEach((r) => chk(t.id, r));
  }
  for (const d of prog.deliverables) { chk(d.id, d.assembly); if (d.vendor && !vendors.has(d.vendor)) bad.push(`${d.id}: vendor ${d.vendor}`); }
  for (const w of prog.work_items) { chk(w.id, w.assembly); chk(w.id, w.milestone); w.blocked_by.forEach((b) => chk(w.id, b)); }
  for (const m of prog.milestones) m.assemblies.forEach((a) => chk(m.id, a));
  for (const s of prog.storylines) chk(s.id, s.team);
  const d = prog.demo;
  [d.part, d.test, d.milestone, d.motor.deliverable, ...d.inputs].forEach((x) => chk('demo', x));
  assert.deepEqual(bad, []);
});

test('every test has inputs that exist, an earliest_start and a duration', () => {
  for (const t of prog.tests) {
    assert.ok(Array.isArray(t.inputs) && t.inputs.length > 0, `${t.id}: no inputs`);
    for (const i of t.inputs) assert.ok(ids.has(i), `${t.id}: input ${i} not in program.json`);
    assert.ok(isDate(t.earliest_start), `${t.id}: earliest_start`);
    assert.ok(t.duration_true_days > 0 && t.duration_estimate_days.length === 2, t.id);
  }
  const drop = prog.tests.find((t) => t.id === 'test-leg-drop');
  for (const i of ['pt-leg-lift-hook', 'pt-leg-gantry-adapter']) assert.ok(drop.inputs.includes(i));
  assert.ok(drop.inputs.some((i) => i.startsWith('wi-')), 'leg drop needs the leg assembly work item');
  assert.equal(drop.rig, 'rig-leg-drop-gantry');
  assert.ok(prog.test_rigs.find((r) => r.id === 'rig-leg-drop-gantry').slot_days?.length, 'gantry has slot days');
  assert.deepEqual(prog.tests.find((t) => t.id === 'test-hip-spin').inputs.slice().sort(), ['dl-hip-motor-dvt', 'pt-hip-bracket']);
});

test('parts: category, kind, owner, process and at least 40% test hardware', () => {
  assert.ok(prog.parts.length >= 160 && prog.parts.length <= 200, `part count ${prog.parts.length}`);
  for (const p of prog.parts) {
    assert.ok(ENUMS.part_category.includes(p.category), `${p.id}: category ${p.category}`);
    assert.ok(ENUMS.part_kind.includes(p.kind), `${p.id}: kind`);
    assert.ok(ENUMS.process.includes(p.process), `${p.id}: process`);
    assert.match(p.part_number, /^FL-(HIP|KNE|ANK|LEG|HND|STR|BAT|TST)-\d{4}$/);
    assert.match(p.cad_file, new RegExp(`^${p.part_number}_[a-z0-9-]+_rev[A-Z]\\.step$`));
    assert.ok(p.cad_file.endsWith(`rev${p.revisions.at(-1).value}.step`), `${p.id}: CAD rev`);
    assert.ok(p.aliases.length >= 2 && p.aliases.length <= 4, `${p.id}: aliases`);
    for (const f of ['material', 'finish', 'tolerance']) assert.ok(p[f], `${p.id}: ${f}`);
    assert.ok(Number.isInteger(p.typical_qty) && p.typical_qty > 0);
    const owner = p.belongs_to;
    if (p.kind === 'test_hardware') assert.ok(/^(rig|res)-/.test(owner), `${p.id}: test hardware must belong to a rig or resource`);
    else assert.ok(owner.startsWith('a-'), `${p.id}: robot part must belong to an assembly`);
  }
  const th = prog.parts.filter((p) => p.kind === 'test_hardware').length;
  assert.ok(th / prog.parts.length >= 0.4, `test hardware share ${th}/${prog.parts.length}`);
});

test('history entries have valid in-window times and stay ordered', () => {
  const lists = [];
  for (const c of COLLS) for (const r of prog[c]) {
    for (const f of ['working_state', 'revision', 'revisions', 'planned_date', 'date', 'value_policy', 'eta', 'status']) {
      if (Array.isArray(r[f]) && f !== 'status') lists.push([`${r.id}.${f}`, r[f]]);
    }
  }
  for (const [where, list] of lists) {
    let prev = '';
    for (const h of list) {
      assert.equal(checkTime(h.known_at), null, `${where}: ${h.known_at}`);
      const d = h.known_at.slice(0, 10);
      assert.ok(d >= W_START && d <= W_END, `${where}: known_at outside window`);
      assert.ok(Date.parse(h.known_at) >= (prev ? Date.parse(prev) : 0), `${where}: unordered`);
      prev = h.known_at;
    }
  }
});

test('no true_arrival except the demo motor', () => {
  const withTruth = prog.deliverables.filter((d) => d.true_arrival != null).map((d) => d.id);
  assert.deepEqual(withTruth, ['dl-hip-motor-dvt']);
  assert.equal(prog.deliverables.find((d) => d.id === 'dl-hip-motor-dvt').true_arrival, '2026-11-20');
});

test('assemblies: none complete, owners set', () => {
  for (const a of prog.assemblies) {
    for (const h of a.working_state) assert.ok(ENUMS.working_state.includes(h.value));
    const want = canon.assemblies.find((c) => c.id === a.id).state_at_window_end;
    assert.equal(a.working_state.at(-1).value, want, `${a.id} end state`);
  }
  assert.ok(prog.assemblies.some((a) => a.working_state.at(-1).value !== 'working'));
});

test('milestones keep canon dates; hip spin test is $600/day by Arjun', () => {
  for (const m of prog.milestones) {
    const c = canon.milestones.find((x) => x.id === m.id);
    const date = Array.isArray(m.date) ? m.date.at(-1).value : m.date;
    assert.equal(date, c.date, m.id);
    assert.ok(ENUMS.hardness.includes(m.hardness));
    const vp = Array.isArray(m.value_policy) ? m.value_policy.at(-1).value : m.value_policy;
    assert.ok(ENUMS.value_policy_type.includes(vp.type), m.id);
  }
  const hs = prog.milestones.find((m) => m.id === 'm-hip-spin-test');
  assert.deepEqual(hs.value_policy.at(-1).value, { type: 'per_day', usd_per_day: 600 });
  assert.equal(hs.value_policy.at(-1).by, 'p-arjun');
  const types = new Set(prog.milestones.map((m) => (Array.isArray(m.value_policy) ? m.value_policy.at(-1).value : m.value_policy).type));
  assert.ok(types.has('per_day') && types.has('none'));
});

test('demo block equals spec S14', () => {
  const d = prog.demo;
  assert.equal(d.part, 'pt-hip-bracket');
  assert.equal(d.revision, 'C');
  assert.equal(d.quantity, 4);
  assert.equal(d.requester, 'p-owen');
  assert.equal(d.placed_at, '2026-11-10T11:30:00-08:00');
  const tier = (n) => d.quote.tiers.find((t) => t.tier === n);
  assert.deepEqual([tier('standard').price_usd, tier('standard').ready_working_day, tier('standard').ready_date], [3000, 10, '2026-11-24']);
  assert.deepEqual([tier('expedite').price_usd, tier('expedite').ready_working_day, tier('expedite').ready_date], [3900, 5, '2026-11-17']);
  assert.equal(d.test, 'test-hip-spin');
  assert.equal(d.test_duration_working_days, 3);
  assert.deepEqual(d.inputs.slice().sort(), ['dl-hip-motor-dvt', 'pt-hip-bracket']);
  assert.equal(d.motor.deliverable, 'dl-hip-motor-dvt');
  assert.equal(d.motor.owner, 'p-arjun');
  assert.equal(d.motor.ready_working_day, 8);
  assert.equal(d.motor.ready_date, '2026-11-20');
  assert.deepEqual(d.motor.uncertain_range_days, [7, 12]);
  assert.equal(d.milestone, 'm-hip-spin-test');
  assert.equal(d.target_working_day, 10);
  assert.deepEqual(d.policy, { type: 'per_day', usd_per_day: 600, set_by: 'p-arjun' });
  assert.deepEqual(d.cases.A.done_date, { standard: '2026-12-01', expedite: '2026-11-25' });
  assert.equal(d.cases.A.break_even_usd_per_day, 450);
  assert.deepEqual(d.cases.B.done_date, { standard: '2026-12-03', expedite: '2026-12-03' });
  assert.equal(d.cases.D.expedite_wins_if_motor_day_le, 8);
  const live = Object.fromEntries(d.live_changes.map((l) => [l.id, l]));
  assert.equal(live['live-b'].claim.value, '2026-11-30');
  assert.deepEqual(live['live-d'].claim.working_days, [7, 12]);
  // the pinned entities agree with the block
  const motor = prog.deliverables.find((x) => x.id === 'dl-hip-motor-dvt');
  assert.equal(motor.eta.at(-1).value, '2026-11-20');
  const bracket = prog.parts.find((x) => x.id === 'pt-hip-bracket');
  assert.equal(bracket.revisions.at(-1).value, 'C');
  assert.equal(bracket.typical_qty * bracket.price_hint_usd, 3000);
  assert.equal(prog.test_rigs.find((r) => r.id === 'rig-spin-test-stand').slot_days, null);
  assert.equal(prog.tests.find((t) => t.id === 'test-hip-spin').duration_true_days, 3);
});

test('storylines: 30-40, 4-8 beats on Mondays inside the window', () => {
  assert.ok(prog.storylines.length >= 30 && prog.storylines.length <= 40, `${prog.storylines.length}`);
  for (const s of prog.storylines) {
    assert.ok(s.topic && s.people.length >= 1, s.id);
    assert.ok(s.beats.length >= 4 && s.beats.length <= 8, `${s.id}: ${s.beats.length} beats`);
    for (const b of s.beats) {
      assert.ok(isDate(b.week) && b.week >= W_START && b.week <= W_END, `${s.id}: beat ${b.week}`);
      assert.equal(new Date(b.week + 'T12:00:00Z').getUTCDay(), 1, `${s.id}: ${b.week} not a Monday`);
      assert.ok(b.summary.length > 20, s.id);
    }
    assert.ok(s.start <= s.beats[0].week && s.end >= s.beats.at(-1).week && s.end <= W_END, `${s.id}: start/end`);
  }
});
