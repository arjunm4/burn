import test from 'node:test';
import assert from 'node:assert/strict';
import { heatmap, ROWS, BAND_DAYS, requesterRate, extraUsd, settingsIndex } from './heatmap.mjs';

// Small stand-ins for B (settings, labels, docs) and D (reads); shapes follow the contracts.
const settings = {
  people: [
    { id: 'p-owen', name: 'Owen', email: 'owen@x.com', slack_id: 'U1', team: 't-act', manager: 'p-arjun' },
    { id: 'p-arjun', name: 'Arjun', email: 'arjun@x.com', slack_id: 'U2', team: 't-act', manager: null },
    { id: 'p-mo', name: 'Mo', email: 'mo@x.com', slack_id: 'U3', team: 't-leg', manager: null },
  ],
  teams: [{ id: 't-act', lead: 'p-arjun' }, { id: 't-leg', lead: 'p-mo' }],
  parts: [{ id: 'pt-hip', part_number: 'FL-HIP-1042', name: 'Hip bracket', aliases: ['hip bracket'], assembly: 'a-hip' }],
};
const T = '2026-11-10T11:30:00-08:00';
const label = {
  order_number: 'XO-1', quote_id: 'Q-1', T, tier: 'expedite', requester_email: 'owen@x.com',
  part_numbers: ['FL-HIP-1042'],
  tiers: [
    { tier: 'economy', total: 900, lead_days: 14 },
    { tier: 'standard', total: 1000, lead_days: 10 },
    { tier: 'expedite', total: 1999, lead_days: 4 },
  ],
};
const doc = (id, at, text, author, extra = {}) => ({
  id, source: 'slack', container: 'C1', thread: id, author, at, text, ...extra,
});
const owen = { email: 'owen@x.com', slack_id: 'U1', name: 'Owen' };
const arjun = { email: 'arjun@x.com', slack_id: 'U2', name: 'Arjun' };
const docs = [
  doc('d0', '2026-10-01T10:00:00-07:00', 'too old', owen),
  doc('d1', '2026-10-20T10:00:00-07:00', 'FL-HIP-1042 eta 11/20', owen),
  doc('d2', '2026-11-09T10:00:00-08:00', 'hip bracket slipped, eta 11/25', arjun),
  doc('d3', '2026-11-09T10:05:00-08:00', 'ugh', owen, { thread: 'd2' }),
  doc('d4', '2026-11-10T12:00:00-08:00', 'FL-HIP-1042 after T', owen),
  doc('d5', '2026-11-08T10:00:00-08:00', 'unrelated', owen),
];
const reads = [
  { doc_id: 'd0', refs: [{ id: 'pt-hip', mode: 'id' }], claims: [], pressure: 0.1 },
  { doc_id: 'd1', refs: [{ id: 'pt-hip', mode: 'id', token: 'FL-HIP-1042' }],
    claims: [{ kind: 'eta', subject: 'pt-hip', value: '2026-11-20' }], pressure: 0.2 },
  { doc_id: 'd2', refs: [{ id: 'pt-hip', mode: 'alias' }],
    claims: [{ kind: 'eta', subject: 'pt-hip', value: '2026-11-25' }, { kind: 'needs', subject: 'pt-hip' }], pressure: 0.8 },
  { doc_id: 'd3', refs: [], claims: [], pressure: 0.5 },
  { doc_id: 'd4', refs: [{ id: 'pt-hip', mode: 'id' }], claims: [{ kind: 'blocked', subject: 'pt-hip' }], pressure: 1 },
  { doc_id: 'd5', refs: [], claims: [], pressure: 0 },
];

test('links docs in [T−30d, T) plus their thread, never after T', () => {
  const hm = heatmap({ label, docs, reads, settings });
  assert.deepEqual(hm.linked, ['d1', 'd2', 'd3']);
  assert.equal(hm.flags.no_context, false);
  assert.equal(hm.order_number, 'XO-1');
  for (const r of ROWS) assert.equal(hm.cells[r].length, 5);
});

test('per day cells, slips, deadline talk, manager, id share', () => {
  const hm = heatmap({ label, docs, reads, settings });
  // d1 is 21 days before T → band b14_30 (16 days); d2/d3 ~1.06 days before → b1_3 (2 days)
  assert.equal(hm.cells.messages[0], 1 / BAND_DAYS[0]);
  assert.equal(hm.cells.messages[3], 2 / 2);
  assert.equal(hm.cells.slips[3], 0.5); // 11/25 differs from earlier 11/20
  assert.equal(hm.cells.slips[0], 0);
  assert.equal(hm.cells.deadline_talk[3], 0.5);
  assert.equal(hm.cells.waiting_talk.every((v) => v === 0), true); // the blocked claim is after T
  assert.equal(hm.cells.manager[3], 0.5); // arjun is owen's manager
  assert.equal(hm.cells.people[3], 1); // 2 people / 2 days
  assert.equal(hm.cells.id_share[0], 1);
  assert.equal(hm.cells.id_share[3], 0); // alias + thread only
  assert.equal(hm.cells.id_share[4], null); // empty band
});

test('pressure is relative to the team baseline from docs before T', () => {
  const hm = heatmap({ label, docs, reads, settings });
  // team t-act docs before T: d0 .1, d1 .2, d5 0, d2 .8, d3 .5 → mean .32
  const base = (0.1 + 0.2 + 0 + 0.8 + 0.5) / 5;
  assert.ok(Math.abs(hm.cells.pressure[3] - ((0.8 - base) + (0.5 - base)) / 2) < 1e-3);
});

test('no linked context → flag and null grid, not zeros', () => {
  const hm = heatmap({ label: { ...label, part_numbers: ['FL-NOPE-1'], order_number: 'XO-2', quote_id: 'Q-2' }, docs, reads, settings });
  assert.equal(hm.flags.no_context, true);
  assert.deepEqual(hm.linked, []);
  assert.ok(ROWS.every((r) => hm.cells[r].every((v) => v === null)));
});

test('progress rank by band from rows or a function', () => {
  const progress = [
    { week_start: '2026-10-12', assembly: 'a-hip', rank: 3 },
    { week_start: '2026-11-09', assembly: 'a-hip', rank: 1 },
  ];
  const hm = heatmap({ label, docs, reads, settings, progress });
  assert.equal(hm.cells.progress_rank[0], 3);
  assert.equal(hm.cells.progress_rank[4], 1);
  const hm2 = heatmap({ label, docs, reads, settings, progress: () => 2 });
  assert.deepEqual(hm2.cells.progress_rank, [2, 2, 2, 2, 2]);
});

test('extras: smoothed requester rate from earlier orders only; extra dollars', () => {
  const sidx = settingsIndex(settings);
  const history = [
    { order_number: 'A', T: '2026-10-01T10:00:00-07:00', tier: 'expedite', requester_email: 'owen@x.com' },
    { order_number: 'B', T: '2026-10-02T10:00:00-07:00', tier: 'standard', requester_email: 'mo@x.com' },
    { order_number: 'C', T: '2026-12-01T10:00:00-08:00', tier: 'expedite', requester_email: 'owen@x.com' },
  ];
  const all = 0.5;
  const team = (1 + 3 * all) / (1 + 3);
  assert.ok(Math.abs(requesterRate(label, history, sidx) - (1 + 3 * team) / (1 + 3)) < 1e-9);
  assert.equal(requesterRate(label, [], sidx), null);
  assert.ok(Math.abs(extraUsd(label) - Math.log(1000)) < 1e-9);
  assert.equal(extraUsd({ tiers: [] }), null);
});
