import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSettings, validateSettings, exportSettings, parseArgs } from './export-settings.mjs';

// Hand-made world: only the fields buildSettings reads (format as fixtures/world/SCHEMA.md).
const h = (value, known_at, by, where) => ({ value, effective: null, known_at, by, where });
const world = {
  meta: {
    demo_now: '2026-11-10T10:30:00-08:00', time_zone: 'America/Los_Angeles',
    context_first_pass: { start: '2026-08-11', end: '2026-11-10' },
    holidays: [
      { date: '2026-11-26', name: 'Thanksgiving', observance: 'full', in_window: false },
      { date: '2026-11-11', name: 'Veterans Day', observance: 'worked', in_window: false },
    ],
  },
  channels: [{ id: 'ch-actuators', slack_id: 'C07FLK0ACTU', name: 'actuators', type: 'public', assembly: 'a-hip-actuator', members: [] }],
  teams: [{ id: 't-mech', name: 'Mech', lead: 'p-arjun', members: ['p-arjun', 'p-owen'], channels: ['ch-actuators'], jira_project: 'HIP', expressiveness: 0.2 }],
  people: [
    { id: 'p-owen', name: 'Owen Halloran', email: 'owen@x.com', slack_id: 'U07FLK0OWEN', jira_account_id: 'a1', team: 't-mech', title: 'ME', manager: 'p-arjun', orders: { habit: 'over_expedites' }, ooo: [] },
    { id: 'p-arjun', name: 'Arjun V', email: 'arjun@x.com', slack_id: 'U07FLK0ARJN', jira_account_id: 'a2', team: 't-mech', title: 'Lead', manager: null, orders: {}, ooo: [] },
  ],
  assemblies: [{ id: 'a-hip-actuator', name: 'Hip actuator', jira_project: 'HIP', channel: 'ch-actuators', team: 't-mech', owner: 'p-arjun' }],
  parts: [
    { id: 'pt-hip-bracket', name: 'Hip bracket', part_number: 'FL-HIP-1042', aliases: ['the bracket'], belongs_to: 'a-hip-actuator', kind: 'robot_part', price_hint_usd: 300 },
    { id: 'pt-dyno-plate', name: 'Dyno plate', part_number: 'FL-TST-2001', aliases: [], belongs_to: 'rig-dyno', kind: 'test_hardware' },
  ],
  deliverables: [{ id: 'dl-motor', name: 'Motor', kind: 'motor', owner: 'p-arjun', assembly: 'a-hip-actuator', eta: [h('2026-11-20', 't', 'p-arjun', 'ev-1')], true_arrival: '2026-11-30' }],
  tests: [{
    id: 'test-hip-spin', name: 'Spin', assembly: 'a-hip-actuator', rig: 'rig-dyno', resources: [], owner: 'p-owen', milestone: 'm-spin',
    duration_true_days: 3, duration_estimate_days: [2, 3], earliest_start: '2026-11-16', actual_start: 'x',
    planned_date: [h('2026-11-16', '2026-02-10T09:00:00-08:00', 'p-owen', null), h('2026-11-19', '2026-10-01T09:00:00-07:00', 'p-owen', 'ev-2')],
  }],
  test_rigs: [{ id: 'rig-dyno', name: 'Dyno', owner: 'p-andre', slot_days: [2, 5], needs: [], bookings: [{ id: 'bk-1' }] }],
  resources: [{ id: 'res-chamber', name: 'Chamber', kind: 'chamber', owner: 'p-andre', needs: [], bookings: [] }],
  milestones: [{
    id: 'm-spin', name: 'Spin test', owner: 'p-arjun', hardness: 'soft', assemblies: ['a-hip-actuator'], kind: 'test', actual_date: '2026-12-01',
    date: [h('2026-11-18', '2026-02-10T09:00:00-08:00', 'p-arjun', null), h('2026-11-24', '2026-10-05T09:15:00-07:00', 'p-arjun', 'ev-3')],
    value_policy: [h({ type: 'per_day', usd_per_day: 600 }, '2026-10-05T09:15:00-07:00', 'p-arjun', null)],
  }],
  edges: [{ id: 'e-1' }], demands: [{ id: 'dmd-1' }], slips: [], events: [], orders: [],
};

test('settings follow the contract and hide what Burn must find', () => {
  const s = buildSettings(world);
  for (const k of ['generated_from', 'demo_now', 'time_zone', 'holidays', 'people', 'teams', 'assemblies', 'parts', 'deliverables', 'tests', 'rigs', 'milestones']) {
    assert.ok(k in s, k);
  }
  const text = JSON.stringify(s);
  for (const leak of ['edges', 'demands', 'true_arrival', 'actual_', 'duration_true', 'earliest_start', '"eta"', 'where', 'bookings', 'habit', 'price_hint', 'expressiveness']) {
    assert.ok(!text.includes(leak), leak);
  }
  assert.deepEqual(s.holidays.map((x) => x.date), ['2026-11-11', '2026-11-26']);
  assert.deepEqual(s.people[1], { id: 'p-owen', name: 'Owen Halloran', email: 'owen@x.com', slack_id: 'U07FLK0OWEN', jira_account_id: 'a1', team: 't-mech', title: 'ME', manager: 'p-arjun' });
  assert.deepEqual(s.teams[0].channels, ['C07FLK0ACTU']);
  assert.equal(s.assemblies[0].slack_channel, 'C07FLK0ACTU');
  assert.deepEqual(s.parts.map((p) => [p.id, p.assembly, p.belongs_to]), [['pt-dyno-plate', null, 'rig-dyno'], ['pt-hip-bracket', 'a-hip-actuator', 'a-hip-actuator']]);
  assert.deepEqual(s.deliverables[0], { id: 'dl-motor', name: 'Motor', aliases: [], owner: 'p-arjun', assembly: 'a-hip-actuator', kind: 'motor' });
  // the original plan, then only announced (where != null) changes
  assert.deepEqual(s.tests[0].planned_date, [
    { value: '2026-11-16', known_at: '2026-02-10T09:00:00-08:00', by: 'p-owen' },
    { value: '2026-11-19', known_at: '2026-10-01T09:00:00-07:00', by: 'p-owen' },
  ]);
  assert.deepEqual(s.tests[0].duration_estimate_days, [2, 3]);
  assert.deepEqual(s.milestones[0].date, [
    { value: '2026-11-18', known_at: '2026-02-10T09:00:00-08:00', by: 'p-arjun' },
    { value: '2026-11-24', known_at: '2026-10-05T09:15:00-07:00', by: 'p-arjun' },
  ]);
  // value policy history is configuration: kept whole
  assert.deepEqual(s.milestones[0].value_policy, [{ value: { type: 'per_day', usd_per_day: 600 }, known_at: '2026-10-05T09:15:00-07:00', by: 'p-arjun' }]);
  assert.deepEqual(s.rigs, [
    { id: 'res-chamber', name: 'Chamber', slot_days: null, owner: 'p-andre', kind: 'chamber' },
    { id: 'rig-dyno', name: 'Dyno', slot_days: [2, 5], owner: 'p-andre', kind: 'rig' },
  ]);
  assert.equal(s.usable_from, '2026-09-10');
  assert.deepEqual(validateSettings(s), []);
});

test('the example world exports', () => {
  const ex = JSON.parse(readFileSync('fixtures/world/example/world.json', 'utf8'));
  const s = buildSettings(ex);
  assert.equal(s.tests.length, ex.tests.length);
  assert.equal(s.rigs.length, ex.test_rigs.length + ex.resources.length);
  assert.ok(!JSON.stringify(s).includes('"where"'));
  assert.deepEqual(validateSettings(s), []);
});

test('validation: broken references and duplicate ids stop the write', () => {
  const s = buildSettings(world);
  s.tests[0].rig = 'rig-gone';
  s.parts.push({ ...s.parts[0] });
  const errs = validateSettings(s);
  assert.ok(errs.some((e) => e.includes('duplicate id pt-dyno-plate')), errs.join('\n'));
  assert.deepEqual(validateSettings({ ...buildSettings(world), tests: [{ ...s.tests[0], rig: 'rig-gone' }] }), ['test test-hip-spin names unknown rigs rig-gone']);

  const dir = mkdtempSync(join(tmpdir(), 'export-settings-'));
  assert.throws(() => exportSettings({ world: join(dir, 'world.json'), out: dir }), /missing world/);
  const bad = structuredClone(world);
  bad.tests[0].milestone = 'm-gone';
  writeFileSync(join(dir, 'world.json'), JSON.stringify(bad));
  assert.throws(() => exportSettings({ world: join(dir, 'world.json'), out: dir }), /settings not written.*m-gone/s);
  assert.ok(!existsSync(join(dir, 'settings.json')));
  writeFileSync(join(dir, 'world.json'), JSON.stringify(world));
  const r = exportSettings({ world: join(dir, 'world.json'), out: dir });
  assert.equal(JSON.parse(readFileSync(r.file, 'utf8')).tests.length, 1);
});

test('parseArgs: defaults, flags, and clear errors', () => {
  assert.equal(parseArgs([]).world, 'fixtures/world/world.json');
  assert.equal(parseArgs(['--out', 'x']).out, 'x');
  assert.throws(() => parseArgs(['--out']), /--out needs a path/);
  assert.throws(() => parseArgs(['--wrold', 'x']), /unknown argument --wrold/);
});
