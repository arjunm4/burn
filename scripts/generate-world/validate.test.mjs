import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateWorld } from './validate.mjs';
import { checkTime, toPacificIso } from './schema.mjs';

const root = new URL('../../fixtures/world/', import.meta.url);
const load = (p) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
const world = load('example/world.json');
const answers = load('example/answers.json');

test('example world and answers are valid', () => {
  const r = validateWorld(world, answers);
  assert.deepEqual(r.errors, []);
  assert.equal(r.counts.people, 5);
  assert.equal(r.counts.orders_xometry, 2);
});

test('wrong Pacific offset and unresolved reference fail', () => {
  const w = structuredClone(world);
  w.orders[0].placed_at = '2026-09-08T14:12:00-08:00'; // September is PDT
  w.events[0].by = 'p-nobody';
  const { errors } = validateWorld(w, answers);
  assert.ok(errors.some((e) => e.includes('placed_at') && e.includes('should be -07:00')), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('unresolved people reference p-nobody')), errors.join('\n'));
});

test('missing answers entry and unordered history fail', () => {
  const a = structuredClone(answers);
  a.orders = a.orders.filter((x) => x.order !== 'ord-x-00002');
  const w = structuredClone(world);
  w.deliverables[0].eta.reverse();
  const { errors } = validateWorld(w, a);
  assert.ok(errors.some((e) => e.includes('no answers entry for Xometry order ord-x-00002')), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('history not ordered by known_at')), errors.join('\n'));
});

test('bad enum and missing required field fail', () => {
  const w = structuredClone(world);
  w.orders[0].chosen_tier = 'rush';
  delete w.people[0].email;
  const { errors } = validateWorld(w, answers);
  assert.ok(errors.some((e) => e.includes('"rush" not in enum tier')));
  assert.ok(errors.some((e) => e.includes('.email: required')));
});

test('time helpers follow US Pacific DST', () => {
  assert.equal(checkTime('2026-03-08T01:59:00-08:00'), null);
  assert.equal(checkTime('2026-03-08T03:00:00-07:00'), null);
  assert.equal(checkTime('2026-11-01T01:30:00-08:00'), null);
  assert.match(checkTime('2026-11-10T10:30:00-07:00'), /should be -08:00/);
  assert.equal(toPacificIso(Date.parse('2026-11-10T18:30:00Z')), '2026-11-10T10:30:00-08:00');
});

test('an order ref must sit on the right side of T', () => {
  const w = structuredClone(world);
  const late = w.events.find((e) => e.id === 'ev-000014');
  late.orders = late.orders_after; late.orders_after = [];
  const { errors } = validateWorld(w, answers);
  assert.ok(errors.some((e) => e.includes('ev-000014') && e.includes('orders_after')), errors.join('\n'));
});

test('per-tier totals, tier order and order times are checked', () => {
  const w = structuredClone(world);
  w.orders[0].tiers[0].total_usd += 5; // economy total no longer adds up
  w.orders[0].tiers[1].lead_business_days = 2; // standard faster than expedite
  w.orders[0].requested_at = '2026-09-08T10:00:00-07:00'; // before the quote
  const { errors } = validateWorld(w, answers);
  assert.ok(errors.some((e) => e.includes('tiers(economy).total_usd')), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('expedite must be faster than standard')), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('requested_at') && e.includes('earlier than quoted_at')), errors.join('\n'));
});

test('stated versus true value, edge reveal and link quality are checked', () => {
  const w = structuredClone(world);
  delete w.events.find((e) => e.truth === 'stale').claim.true_value;
  w.edges.find((e) => e.reveal === 'never').revealed_by = ['ev-000001'];
  w.orders[1].link_quality = 'never_discussed'; // it has crumbs before T
  const { errors } = validateWorld(w, answers);
  assert.ok(errors.some((e) => e.includes('claim.true_value')), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('must be empty when reveal is never')), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('never_discussed must have no crumbs')), errors.join('\n'));
});

test('answers cover every quoted tier and agree with the hidden reason', () => {
  const a = structuredClone(answers);
  a.orders[0].tier_outcomes.pop();
  a.orders[1].expedite_helped = true; // no_gain_other_input_later
  delete a.orders[1].belief;
  const { errors } = validateWorld(world, a);
  assert.ok(errors.some((e) => e.includes('missing quoted tier expedite')), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('no_gain needs expedite chosen')), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('belief: required')), errors.join('\n'));
});

test('demands, slips and the new collections are required and consistent', () => {
  const w = structuredClone(world);
  w.demands[0].order = 'ord-x-00002';
  w.slips[0].announced_at = '2026-10-13T09:00:00-07:00'; // before discovery
  delete w.meta.sim_horizon;
  const { errors } = validateWorld(w, answers);
  assert.ok(errors.some((e) => e.includes('demand dmd-00001 points at order ord-x-00002')), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('slips(slip-00001).announced_at')), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('meta.sim_horizon: required')), errors.join('\n'));
});

test('demo cases A, B and D land on the stated calendar dates', () => {
  const off = new Set(world.meta.holidays.filter((h) => h.observance === 'full').map((h) => h.date));
  const addWd = (date, n) => {
    const d = new Date(`${date}T12:00:00Z`);
    while (n > 0) { d.setUTCDate(d.getUTCDate() + 1); const s = d.toISOString().slice(0, 10); if (d.getUTCDay() % 6 && !off.has(s)) n--; }
    return d.toISOString().slice(0, 10);
  };
  const day = (n) => addWd('2026-11-10', n);
  const done = (ready, motor) => addWd(day(Math.max(ready, motor)), world.demo.test_duration_working_days);
  const tier = Object.fromEntries(world.demo.quote.tiers.map((t) => [t.tier, t]));
  assert.equal(day(1), '2026-11-11'); // Veterans Day is worked
  assert.equal(tier.standard.ready_date, day(10));
  assert.equal(tier.expedite.ready_date, day(5));
  assert.equal(world.demo.motor.ready_date, day(8));
  const c = world.demo.cases;
  assert.deepEqual([done(10, 8), done(5, 8)], ['2026-12-01', '2026-11-25']);
  assert.deepEqual(c.A.done_date, { standard: '2026-12-01', expedite: '2026-11-25' });
  assert.deepEqual([done(10, 12), done(5, 12)], ['2026-12-03', '2026-12-03']);
  assert.deepEqual(c.B.done_date, { standard: '2026-12-03', expedite: '2026-12-03' });
  // D: expedite is worth $900 more only while the motor is ready by day 8
  const worth = (m) => (new Date(done(10, m)) - new Date(done(5, m)) > 0 ? [10, 5].map((r) => Math.max(r, m)).reduce((a, b) => a - b) * 600 : 0);
  assert.ok(worth(8) > 900 && worth(9) < 900);
  assert.equal(c.D.expedite_wins_if_motor_day_le, 8);
  assert.equal(day(8), '2026-11-20');
});
