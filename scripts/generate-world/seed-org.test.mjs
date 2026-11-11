// Checks fixtures/world/seed/org.json against canon.json, schema.mjs and the realism targets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SPEC, ENUMS, isDate } from './schema.mjs';

const root = new URL('../../fixtures/world/', import.meta.url);
const load = (p) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
const org = load('seed/org.json');
const canon = load('seed/canon.json');
const knobs = load('knobs.json');

const people = org.people;
const byId = new Map(people.map((p) => [p.id, p]));
const teamIds = new Set(org.teams.map((t) => t.id));
const channelIds = new Set(org.channels.map((c) => c.id));
const jiraIds = new Set(org.jira_projects.map((j) => j.id));
const assemblyIds = new Set(canon.assemblies.map((a) => a.id));
const refSets = { people: new Set(byId.keys()), teams: teamIds, channels: channelIds, jira_projects: jiraIds, assemblies: assemblyIds };

// Minimal SPEC-driven checker: required fields, types, enums, refs. Returns error strings.
function check(value, spec, path, errs) {
  if (typeof spec === 'string') {
    const required = spec.endsWith('!');
    const t = spec.replace(/[!?]$/, '');
    if (value === undefined || value === null) {
      if (required) errs.push(`${path}: required`);
      return;
    }
    if (t.startsWith('[')) {
      if (!Array.isArray(value)) return errs.push(`${path}: not an array`);
      value.forEach((v, i) => check(v, t.slice(1, -1) + '!', `${path}[${i}]`, errs));
      return;
    }
    if (t === 'str' && typeof value !== 'string') errs.push(`${path}: not a string`);
    if (t === 'num' && typeof value !== 'number') errs.push(`${path}: not a number`);
    if (t === 'int' && !Number.isInteger(value)) errs.push(`${path}: not an int`);
    if (t === 'bool' && typeof value !== 'boolean') errs.push(`${path}: not a bool`);
    if (t === 'date' && !isDate(value)) errs.push(`${path}: not a date`);
    if (t.startsWith('enum:') && !ENUMS[t.slice(5)].includes(value)) errs.push(`${path}: bad enum ${value}`);
    if (t.startsWith('ref:')) {
      const set = refSets[t.slice(4)];
      if (set && !set.has(value)) errs.push(`${path}: unresolved ${t} ${value}`);
    }
    return;
  }
  if (Array.isArray(spec)) {
    if (value === undefined || value === null) return; // object lists are required-if-present here
    if (!Array.isArray(value)) return errs.push(`${path}: not an array`);
    value.forEach((v, i) => check(v, spec[0], `${path}[${i}]`, errs));
    return;
  }
  if (value === undefined || value === null || typeof value !== 'object') return errs.push(`${path}: missing object`);
  for (const [k, s] of Object.entries(spec)) check(value[k], s, `${path}.${k}`, errs);
}

test('org.json has exactly the seed keys', () => {
  assert.deepEqual(Object.keys(org).sort(), ['channels', 'finance', 'jira_projects', 'meeting_series', 'people', 'teams', 'vendors']);
});

test('every record satisfies schema.mjs (required fields, types, enums, refs)', () => {
  const errs = [];
  for (const coll of ['people', 'teams', 'channels', 'jira_projects', 'meeting_series', 'vendors']) {
    org[coll].forEach((r, i) => check(r, SPEC[coll], `${coll}[${r.id ?? i}]`, errs));
  }
  check(org.finance, SPEC.finance, 'finance', errs);
  for (const k of ['gl_accounts', 'project_codes', 'ramp_departments']) if (!org.finance[k]?.length) errs.push(`finance.${k} empty`);
  assert.deepEqual(errs, []);
});

test('60 people with canon headcounts per team', () => {
  assert.equal(people.length, 60);
  for (const t of canon.teams) {
    const team = org.teams.find((x) => x.id === t.id);
    assert.ok(team, `team ${t.id} missing`);
    assert.equal(team.headcount, t.headcount, t.id);
    assert.equal(team.members.length, t.headcount, t.id);
    assert.equal(people.filter((p) => p.team === t.id).length, t.headcount, t.id);
    for (const m of team.members) assert.equal(byId.get(m)?.team, t.id, `${m} not in ${t.id}`);
    assert.equal(byId.get(team.lead)?.team, t.id, `lead of ${t.id}`);
    assert.ok(team.lead && team.members.includes(team.lead));
    assert.ok(typeof team.expressiveness === 'number' && Math.abs(team.expressiveness) <= 0.25, `expressiveness ${t.id}`);
  }
  assert.equal(org.teams.length, canon.teams.length);
  const ex = org.teams.map((t) => t.expressiveness);
  assert.ok(Math.max(...ex) >= 0.15 && Math.min(...ex) <= -0.15, 'one loud and one stoic team');
});

test('ids, emails, Slack, Jira and Ramp ids are unique and well formed', () => {
  for (const f of ['id', 'email', 'slack_id', 'jira_account_id', 'ramp_user_id', 'display_name']) {
    const vals = people.map((p) => p[f]);
    assert.equal(new Set(vals).size, vals.length, `duplicate ${f}`);
  }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const cards = people.flatMap((p) => p.ramp_card_ids);
  assert.equal(new Set(cards).size, cards.length, 'duplicate card id');
  for (const p of people) {
    assert.match(p.id, /^p-[a-z]+(-[a-z])?$/);
    assert.match(p.slack_id, /^U[A-Z0-9]{10}$/);
    assert.match(p.jira_account_id, /^[0-9a-f]{24}$/);
    assert.match(p.ramp_user_id, uuid);
    for (const c of p.ramp_card_ids) assert.match(c, uuid);
    assert.match(p.email, /^[a-z.]+@flintlockrobotics\.com$/);
  }
  const ch = org.channels.map((c) => c.slack_id);
  assert.equal(new Set(ch).size, ch.length, 'duplicate channel slack id');
  for (const c of org.channels) assert.match(c.slack_id, c.type === 'dm' ? /^D[A-Z0-9]{10}$/ : /^C[A-Z0-9]{10}$/);
});

test('canon roster and fixed people are present unchanged', () => {
  for (const r of canon.roster) {
    const p = byId.get(r.id);
    assert.ok(p, `${r.id} missing`);
    assert.equal(p.team, r.team, r.id);
    assert.equal(p.title, r.role, r.id);
    assert.equal(p.name.split(' ')[0], r.first_name, r.id);
  }
  for (const f of canon.fixed_people) {
    const p = byId.get(f.id);
    for (const k of ['name', 'display_name', 'title', 'team', 'slack_id', 'email']) assert.equal(p[k], f[k], `${f.id}.${k}`);
  }
});

test('canon channels, Jira projects and vendors keep their ids', () => {
  for (const c of canon.channels) {
    const x = org.channels.find((y) => y.id === c.id);
    assert.ok(x, c.id);
    for (const k of ['name', 'slack_id', 'type', 'purchasing_relevant']) assert.equal(x[k], c[k], `${c.id}.${k}`);
  }
  for (const c of org.channels.filter((y) => !canon.channels.some((z) => z.id === y.id))) {
    assert.equal(c.type, 'dm');
    assert.match(c.id, /^dm-[a-z]+-[a-z]+$/);
    const [a, b] = c.id.slice(3).split('-');
    assert.ok(a < b, `${c.id} slugs sorted`);
    assert.deepEqual([...c.members].sort(), [`p-${a}`, `p-${b}`]);
  }
  assert.deepEqual(org.jira_projects.map((j) => j.id).sort(), canon.jira_projects.map((j) => j.id).sort());
  for (const j of org.jira_projects) {
    assert.equal(j.team, canon.jira_projects.find((c) => c.id === j.id).team);
    assert.deepEqual(j.assemblies.sort(), canon.assemblies.filter((a) => a.jira_project === j.id).map((a) => a.id).sort());
  }
  const canonV = Object.entries(canon.vendors).flatMap(([cat, vs]) => vs.map((id) => ({ id, cat })));
  assert.equal(org.vendors.length, canonV.length);
  for (const { id, cat } of canonV) {
    const v = org.vendors.find((x) => x.id === id);
    assert.ok(v, id);
    assert.equal(v.category, cat, id);
    assert.ok(v.descriptors.length >= 1, id);
  }
  const codes = org.finance.project_codes.map((c) => c.code);
  for (const a of canon.assemblies) assert.ok(codes.includes(a.project_code), a.project_code);
});

test('every reference resolves', () => {
  for (const p of people) {
    if (p.manager) assert.ok(byId.has(p.manager), `${p.id} manager`);
    if (p.delegate) assert.ok(byId.has(p.delegate), `${p.id} delegate`);
  }
  for (const c of org.channels) for (const m of c.members) assert.ok(byId.has(m), `${c.id} member ${m}`);
  for (const t of org.teams) for (const c of t.channels) assert.ok(channelIds.has(c), `${t.id} channel ${c}`);
  for (const s of org.meeting_series) {
    for (const a of [s.organizer, ...s.attendees, ...(s.optional_attendees ?? [])]) assert.ok(byId.has(a), `${s.id} ${a}`);
  }
  for (const j of org.jira_projects) assert.ok(byId.has(j.lead), `${j.id} lead`);
  for (const d of org.finance.ramp_departments) for (const t of d.teams) assert.ok(teamIds.has(t), `${d.id} ${t}`);
  const deptTeams = org.finance.ramp_departments.flatMap((d) => d.teams);
  assert.deepEqual([...deptTeams].sort(), [...teamIds].sort(), 'every team in exactly one department');
  assert.ok(byId.has(org.finance.approval.second_approver));
});

test('manager chain: one root, no cycles, spans 4-7', () => {
  const roots = people.filter((p) => !p.manager);
  assert.equal(roots.length, 1);
  for (const p of people) {
    const seen = new Set();
    let x = p;
    while (x.manager) {
      assert.ok(!seen.has(x.id), `cycle at ${p.id}`);
      seen.add(x.id);
      x = byId.get(x.manager);
    }
  }
  const spans = new Map();
  for (const p of people) if (p.manager) spans.set(p.manager, (spans.get(p.manager) ?? 0) + 1);
  for (const [m, n] of spans) assert.ok(n >= 4 && n <= 7, `${m} span ${n}`);
});

test('ordering: 16-22 orderers, buyers set up, habits follow the knob mix', () => {
  const orderers = people.filter((p) => p.orders.weight !== 'none');
  assert.ok(orderers.length >= 16 && orderers.length <= 22, `orderers ${orderers.length}`);
  const heavyEng = orderers.filter((p) => p.orders.weight === 'heavy' && p.team !== 't-supply');
  assert.ok(heavyEng.length >= 3 && heavyEng.length <= 4, `heavy engineers ${heavyEng.length}`);
  const buyers = people.filter((p) => p.team === 't-supply' && /Buyer/.test(p.title));
  assert.equal(buyers.length, 2);
  for (const b of buyers) {
    assert.equal(b.orders.weight, 'heavy');
    assert.equal(b.orders.queue_delay_days.length, 2);
    assert.ok(b.orders.batch_days.length >= 1 && b.orders.batch_days.every((d) => d >= 1 && d <= 5));
  }
  assert.ok(buyers.some((b) => b.orders.habit === 'batches_orders'));
  for (const p of people) {
    const c = p.orders.checks_dependencies;
    assert.ok(typeof c === 'number' && c >= 0.3 && c <= 0.95, `${p.id} checks_dependencies`);
    if (p.orders.weight === 'none') assert.equal(p.orders.habit, 'none', p.id);
    else assert.ok(p.orders.wtp_per_day_usd > 0, `${p.id} wtp`);
    if (p.orders.habit !== 'none') assert.ok(p.orders.habit_strength > 0 && p.orders.habit_strength <= 1, `${p.id} strength`);
  }
  for (const [habit, share] of Object.entries(knobs.ordering_habit_mix)) {
    const n = orderers.filter((p) => p.orders.habit === habit).length;
    assert.ok(Math.abs(n - share * orderers.length) <= 2, `${habit}: ${n} vs ${share * orderers.length}`);
  }
});

test('realism: styles vary, chatty and lurker in each channel, joiners, OOO', () => {
  const styles = new Set(people.map((p) => JSON.stringify(p.style)));
  assert.ok(styles.size >= 8, `styles ${styles.size}`);
  assert.ok(people.some((p) => p.style.case === 'lower' && p.style.punctuation === 'none'));
  assert.ok(people.some((p) => p.style.typos === 'lots'));
  assert.ok(people.some((p) => p.style.emoji === 'lots'));
  assert.ok(people.some((p) => p.style.hedging === 'high'));
  assert.ok(people.some((p) => p.style.length === 'long'));
  const lurkers = people.filter((p) => p.lurker).length;
  assert.ok(lurkers >= 9 && lurkers <= 12, `lurkers ${lurkers}`);
  for (const c of org.channels.filter((x) => x.type !== 'dm')) {
    const ms = c.members.map((m) => byId.get(m));
    assert.ok(ms.some((p) => p.chattiness >= 1.8), `${c.id} has no chatty member`);
    assert.ok(ms.some((p) => p.lurker), `${c.id} has no lurker`);
  }
  const joiners = people.filter((p) => p.start_date >= '2026-02-10' && p.start_date <= '2026-11-10');
  assert.ok(joiners.length >= 3 && joiners.length <= 5, `joiners ${joiners.length}`);
  for (const p of people) for (const o of p.ooo) assert.ok(o.start <= o.end, `${p.id} ooo`);
  // A key owner is out during a milestone week.
  const milestoneWeek = canon.milestones.some((m) => people.some((p) => p.team !== 't-leadership' && org.teams.some((t) => t.lead === p.id)
    && p.ooo.some((o) => o.start <= m.date && m.date <= o.end)));
  assert.ok(milestoneWeek, 'no lead is OOO over a milestone date');
});

test('meeting series cover the required types with varied note takers', () => {
  const types = new Set(org.meeting_series.map((s) => s.type));
  for (const t of ['supply_chain_sync', 'supply_chain_mech', 'program_review', 'design_review', 'standup', 'vendor_call', 'leadership', 'all_hands', 'gate_review']) {
    assert.ok(types.has(t), t);
  }
  assert.ok(new Set(org.meeting_series.map((s) => s.note_taker)).size >= 4);
  for (const s of org.meeting_series) {
    assert.match(s.id, /^ms-[a-z0-9-]+$/);
    assert.match(s.rrule, /^FREQ=/);
    assert.match(s.start_local, /^\d{2}:\d{2}$/);
    assert.ok(s.attendees.includes(s.organizer), `${s.id} organizer attends`);
  }
});
