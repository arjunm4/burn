// Tests run on fixtures/world/example/ and a hand-made mini world (the full world is not final).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeCalendar } from '../generate-world/lib/calendar.mjs';
import { buildEngineCases, gradeEngine, wastedExpedites, wilson, gradeHabit, grade, summarize, parseArgs } from './grade.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const EX = join(ROOT, 'fixtures/world/example');
const exWorld = JSON.parse(readFileSync(join(EX, 'world.json'), 'utf8'));
const exAnswers = JSON.parse(readFileSync(join(EX, 'answers.json'), 'utf8'));

// Stub of A's contract (impl.md, src/timevalue/), only to check the harness:
// ready on R -> usable nextWd(R); start = first wd >= max(planned start, usable dates) on a slot day with no
// booking overlapping the run (and, if given outages, the owner in); finish = addWd(start, duration - 1).
function makeRefEngine({ ownerOut = null, usableLag = 1 } = {}) {
  const solve = ({ holidays, test: t, inputs }) => {
    const cal = makeCalendar({ holidays, window: { start: '2026-02-10T00:00:00-08:00', end: '2026-11-10T23:59:59-08:00' } });
    let d = t.planned_start;
    let limiter = { kind: 'planned_start', id: null };
    for (const i of inputs) {
      if (!i.ready) continue;
      const u = cal.addWd(i.ready, usableLag);
      if (u > d) { d = u; limiter = { kind: 'input', id: i.id }; }
    }
    d = cal.onOrAfter(d);
    for (let g = 0; g < 600; g++, d = cal.nextWd(d)) {
      const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
      if (t.rig_slot_days && !t.rig_slot_days.includes(dow)) continue;
      const end = cal.addWd(d, Math.max(1, t.duration_days) - 1);
      const hit = (b) => !(end < b.start || d > b.end);
      if (t.bookings.some(hit)) continue;
      if ([...t.owner_out, ...(ownerOut || [])].some(hit)) continue;
      return { start: d, finish: end, limiter };
    }
    throw new Error('no slot');
  };
  return { solve, compare: null };
}

const built = (w, a) => buildEngineCases(w, a); // carries world.meta.holidays to the engine

// ---- hand-made mini world; every expected date worked out by hand (Thanksgiving 11-26/27 closed) ----
const H = [
  { date: '2026-11-11', name: 'Veterans Day', observance: 'worked' },
  { date: '2026-11-26', name: 'Thanksgiving', observance: 'full' },
  { date: '2026-11-27', name: 'Day after Thanksgiving', observance: 'full' },
];
const tier = (t, total, ready) => ({ tier: t, subtotal_usd: total, shipping_usd: 0, tax_usd: 0, total_usd: total, lead_business_days: 5, est_ship: ready, est_delivery: ready });
const order = (id, o) => ({ id, type: 'xometry_cnc', order_number: `XO-${id.slice(-5)}`, placed_at: '2026-11-09T10:00:00-08:00', cancelled: false, feeds_test: null, feeds_work_item: null, need_by_believed: null, ...o });
function miniWorld() {
  const world = {
    meta: { window: { start: '2026-02-10T00:00:00-08:00', end: '2026-11-10T23:59:59-08:00' }, demo_now: '2026-11-10T10:30:00-08:00', holidays: H },
    people: [{ id: 'p-tess', ooo: [{ start: '2026-12-01', end: '2026-12-02', reason: 'vacation' }] }, { id: 'p-wil', ooo: [] }],
    parts: [{ id: 'pt-a' }, { id: 'pt-b' }],
    deliverables: [{ id: 'dl-motor', true_arrival: '2026-11-17' }],
    work_items: [{ id: 'wi-1', owner: 'p-wil', duration_true_days: 3, blocked_by: [] }],
    test_rigs: [{ id: 'rig-x', slot_days: [2, 4], bookings: [
      { id: 'bk-1', start: '2026-11-19T09:00:00-08:00', end: '2026-11-20T17:00:00-08:00', test: 'test-other', status: 'confirmed' },
      { id: 'bk-2', start: '2026-11-24T09:00:00-08:00', end: '2026-11-25T17:00:00-08:00', test: 'test-1', status: 'confirmed' },
      { id: 'bk-3', start: '2026-11-17T09:00:00-08:00', end: '2026-11-17T17:00:00-08:00', test: null, status: 'tentative' },
    ] }],
    resources: [],
    milestones: [{ id: 'm-1', hardness: 'soft', kind: 'test', date: [{ value: '2026-11-24' }] }],
    tests: [
      { id: 'test-1', rig: 'rig-x', resources: [], owner: 'p-tess', milestone: 'm-1', duration_true_days: 2, earliest_start: '2026-11-16', planned_date: [{ value: '2026-11-16' }], actual_end: '2026-11-25T17:00:00-08:00' },
      { id: 'test-other', rig: 'rig-x', resources: [], owner: 'p-wil', milestone: null, duration_true_days: 2, earliest_start: '2026-11-19', planned_date: [{ value: '2026-11-19' }], actual_end: '2026-11-20T17:00:00-08:00' },
    ],
    edges: [
      { id: 'e-1', from: 'pt-a', to: 'test-1', reveal: 'revealed' }, { id: 'e-2', from: 'dl-motor', to: 'test-1', reveal: 'hinted' },
      { id: 'e-3', from: 'rig-x', to: 'test-1', reveal: 'never' }, { id: 'e-4', from: 'test-1', to: 'm-1', reveal: 'revealed' },
      { id: 'e-5', from: 'pt-b', to: 'wi-1', reveal: 'never' },
    ],
    orders: [
      // superseded: a later order (00002) for the same part gates test-1, so every tier of this one lands the same
      order('ord-x-00001', { feeds_test: 'test-1', lines: [{ part: 'pt-a' }], chosen_tier: 'standard', total_usd: 300, tiers: [tier('standard', 300, '2026-11-12'), tier('expedite', 400, '2026-11-11')] }),
      order('ord-x-00002', { feeds_test: 'test-1', lines: [{ part: 'pt-a' }], chosen_tier: 'expedite', total_usd: 900, need_by_believed: '2026-11-18',
        tiers: [tier('economy', 500, '2026-11-24'), tier('standard', 600, '2026-11-19'), tier('expedite', 900, '2026-11-13')] }),
      // a work item's order also names the test the work item prepares for (as the simulator writes it); its consumer is the work item
      order('ord-x-00003', { feeds_work_item: 'wi-1', feeds_test: 'test-1', lines: [{ part: 'pt-b' }], chosen_tier: 'standard', total_usd: 200,
        tiers: [tier('economy', 150, '2026-11-20'), tier('standard', 200, '2026-11-12'), tier('expedite', 260, '2026-11-10')] }),
    ],
    ramp_transactions: [1, 2, 3].map((n) => ({ id: `rt-${n}`, order: `ord-x-0000${n}`, kind: 'charge' })),
    demo: {},
  };
  const to = (tier, ready, s, g, d) => ({ tier, ready_date: ready, test_start: s, gated_date: g, days_gained: d });
  const answers = {
    summary: { usable_orders: { from: '2026-11-01' }, probe: { days_to_need_rule_accuracy: 0.5 } },
    orders: [
      { order: 'ord-x-00001', expedite_helped: false, hidden_reason: 'cheap_default', tier_outcomes: [to('standard', '2026-11-12', '2026-11-24', '2026-11-25', 0), to('expedite', '2026-11-11', '2026-11-24', '2026-11-25', 0)] },
      // dl-motor usable 11-18; slot Tue/Thu; bk-1 holds 11-19..20 -> 11-24..25. Economy: usable Wed 11-25 ->
      // Thu/Fri closed -> Tue 12-01..12-02. Gained vs economy: 11-30, 12-01, 12-02 = 3 wd.
      { order: 'ord-x-00002', expedite_helped: false, hidden_reason: 'no_gain_other_input_later', tier_outcomes: [
        to('economy', '2026-11-24', '2026-12-01', '2026-12-02', 0), to('standard', '2026-11-19', '2026-11-24', '2026-11-25', 3), to('expedite', '2026-11-13', '2026-11-24', '2026-11-25', 3)] },
      // true_need_date 11-16 -> planned start 11-17; 3 wd -> 11-19. Economy usable Mon 11-23 -> 11-25. Gain 4.
      { order: 'ord-x-00003', expedite_helped: false, hidden_reason: 'cheap_default', true_need_date: '2026-11-16', tier_outcomes: [
        to('economy', '2026-11-20', '2026-11-23', '2026-11-25', 0), to('standard', '2026-11-12', '2026-11-17', '2026-11-19', 4), to('expedite', '2026-11-10', '2026-11-17', '2026-11-19', 4)] },
    ],
  };
  return { world, answers };
}

test('example world: the harness reproduces answers.json with the reference solver', () => {
  const b = built(exWorld, exAnswers);
  assert.equal(b.cases.filter((c) => c.kind === 'test').length, 1);
  assert.ok(b.skipped.some((s) => /pinned demo/.test(s.reason)));
  const g = gradeEngine(b, makeRefEngine());
  assert.deepEqual(g.mismatches, []);
  assert.equal(g.test_fed.exact_share, 1);
});

test('mini world: hand-computed dates, superseded order, work item, holidays, slots, bookings', () => {
  const { world, answers } = miniWorld();
  const b = built(world, answers);
  assert.deepEqual(b.cases.map((c) => [c.order, c.kind, c.order_parts.length]), [['ord-x-00001', 'test', 0], ['ord-x-00002', 'test', 1], ['ord-x-00003', 'work_item', 1]]);
  const c2 = b.cases[1];
  assert.deepEqual(c2.test.bookings.map((x) => x.id), ['bk-1']); // own and tentative ad hoc bookings excluded
  assert.deepEqual(c2.test.rig_slot_days, [2, 4]);
  assert.deepEqual(c2.test.owner_out, []); // the simulator does not model owner out-of-office
  assert.deepEqual(c2.owner_ooo, [{ start: '2026-12-01', end: '2026-12-02' }]);
  const g = gradeEngine(b, makeRefEngine());
  assert.deepEqual(g.mismatches, []);
  assert.equal(g.all.exact_share, 1);
});

test('mini world: engine errors are caught and explained', () => {
  const { world, answers } = miniWorld();
  const early = gradeEngine(built(world, answers), makeRefEngine({ usableLag: 0 }));
  assert.ok(early.mismatches.some((m) => m.reasons.some((r) => r.includes('before the last input is usable'))));
  // an engine that is fed the owner's outage (p-tess out 12-01..12-02) moves Economy past it; the truth does not
  const ooo = gradeEngine(built(world, answers), makeRefEngine({ ownerOut: [{ start: '2026-12-01', end: '2026-12-02' }] }));
  const m = ooo.mismatches.find((x) => x.order === 'ord-x-00002' && x.tier === 'economy');
  assert.ok(m && m.reasons.some((r) => r.includes('owner out')), JSON.stringify(ooo.mismatches.map((x) => x.reasons)));
  const throws = gradeEngine(built(world, answers), { solve: () => { throw new Error('boom'); } });
  assert.equal(throws.all.exact, 0);
  assert.ok(throws.mismatches[0].reasons[0].includes('boom'));
});

test('wasted expedites: count and premium over Standard', () => {
  const { world, answers } = miniWorld();
  const w = wastedExpedites(world, answers);
  assert.equal(w.count, 1);
  assert.equal(w.premium_usd, 300);
  assert.deepEqual(w.by_reason, { no_gain_other_input_later: 1 });
});

test('wilson interval', () => {
  const [lo, hi] = wilson(35, 50);
  assert.ok(lo > 0.55 && lo < 0.57 && hi > 0.8 && hi < 0.82, `${lo} ${hi}`);
  assert.equal(wilson(0, 0), null);
});

test('habit: baselines without a model; with a stub model', () => {
  const { world, answers } = miniWorld();
  const none = gradeHabit(world, answers, null);
  assert.equal(none.available, false);
  assert.equal(none.baselines.n_test_set, 1); // newest 30% of 3 usable orders
  const m = gradeHabit(world, answers, { accuracy: 0.75, n_test: 46, n_train: 108, test_orders: ['ord-x-00002', 'ord-x-00003'] });
  assert.equal(m.available, true);
  assert.equal(m.baselines.n_test_set, 2);
  assert.equal(m.baselines.never_expedite.accuracy, 0.5);
  assert.equal(m.baselines.need_by_rule.accuracy, 1); // 00002: Std 11-19 > need 11-18 -> expedite (right); 00003: no need-by -> standard (right)
  assert.ok(m.ci95[0] < 0.75 && m.ci95[1] > 0.75);
});

test('grade() runs end to end on the example world and summarizes', async () => {
  const out = mkdtempSync(join(tmpdir(), 'grade-'));
  const g = await grade({ ...parseArgs([]), world: EX, out });
  assert.ok(g.runtime_s < 30);
  assert.ok(g.engine);
  assert.match(summarize(g), /Wasted expedites: \d+/);
});

test('grade() on a mini world with a habit model present', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'grade-mini-'));
  const { world, answers } = miniWorld();
  mkdirSync(join(dir, 'world')); mkdirSync(join(dir, 'out'));
  writeFileSync(join(dir, 'world/world.json'), JSON.stringify(world));
  writeFileSync(join(dir, 'world/answers.json'), JSON.stringify(answers));
  writeFileSync(join(dir, 'out/habit-model.json'), JSON.stringify({ accuracy: 0.8, n_test: 2 }));
  const g = await grade({ ...parseArgs([]), world: join(dir, 'world'), out: join(dir, 'out'), sources: join(dir, 'none') });
  assert.equal(g.habit.available, true);
  assert.equal(g.wasted_expedites.count, 1);
});

test("A's engine on the example and mini worlds (skips until src/timevalue lands)", async (t) => {
  const { loadEngine } = await import('./grade.mjs');
  const { engine } = await loadEngine();
  if (!engine) return t.skip('src/timevalue not available yet');
  const ex = gradeEngine(built(exWorld, exAnswers), engine);
  assert.deepEqual(ex.mismatches, []);
  const { world, answers } = miniWorld();
  // owner_out is [] when grading against the simulator, so p-tess's outage (12-01..12-02) moves nothing
  const g = gradeEngine(built(world, answers), engine);
  assert.deepEqual(g.mismatches, []);
  assert.equal(g.all.exact_share, 1);
});
