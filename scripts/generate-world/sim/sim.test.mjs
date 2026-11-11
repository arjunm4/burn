import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { simulate } from '../simulate.mjs';
import { selfcheck } from './selfcheck.mjs';
import { validateWorld } from '../validate.mjs';
import { stringify, sha256, readJson } from '../lib/io.mjs';
import { makeCalendar } from '../lib/calendar.mjs';
import { solveStart, resolveOne } from './solve.mjs';

const TESTDATA = fileURLToPath(new URL('./testdata/', import.meta.url));
const REAL = fileURLToPath(new URL('../../../fixtures/world/seed/', import.meta.url));
const hasReal = existsSync(`${REAL}org.json`) && existsSync(`${REAL}program.json`);

function run(opts) {
  const t0 = performance.now();
  const { world, answers, state } = simulate(opts);
  const ms = performance.now() - t0;
  const w = JSON.parse(stringify(world));
  const a = JSON.parse(stringify(answers));
  return { world: w, answers: a, state, ms, hash: sha256(stringify(world) + stringify(answers)) };
}

function structural(r) {
  const v = validateWorld(r.world, r.answers);
  assert.deepEqual(v.errors.slice(0, 5), [], 'validator errors');
  const sc = selfcheck(r.state, r.world, r.answers);
  assert.deepEqual(sc.errors.slice(0, 5), [], 'selfcheck errors');
  return sc;
}

test('solver: start respects earliest, readiness, slot days and busy intervals', () => {
  const canon = readJson(`${REAL}canon.json`);
  const cal = makeCalendar(canon.meta);
  const c = { id: 'x', type: 'test', earliest: '2026-11-16', slotDays: null, duration: 3, units: ['rig'], inputs: [{ id: 'a', ready: '2026-11-20' }, { id: 'o', order: 'o', ready: '2026-11-24' }] };
  // spec S14 case A: bracket ready 11-24 (standard) -> 11-25, 11-30, 12-01; ready 11-17 (expedite), motor 11-20 -> 11-23..11-25
  assert.deepEqual(solveStart(cal, c, '2026-11-24'), { start: '2026-11-25', end: '2026-12-01' });
  const busy = new Map();
  assert.equal(resolveOne(cal, c, busy, { order: 'o', ready: '2026-11-17' }).end, '2026-11-25');
  assert.equal(resolveOne(cal, c, busy, { order: 'o', ready: null }).start, '2026-11-23');
  assert.equal(solveStart(cal, { ...c, slotDays: [1] }, '2026-11-24').start, '2026-11-30');
  assert.equal(solveStart(cal, c, '2026-11-10', [{ start: '2026-11-17', end: '2026-11-18' }]).start, '2026-11-19');
  assert.equal(solveStart(cal, c, null).start, '2026-11-16');
});

test('test seed: valid, self-consistent, deterministic, inside the window', () => {
  const a = run({ seedDir: TESTDATA });
  const b = run({ seedDir: TESTDATA });
  assert.equal(a.hash, b.hash, 'same seed and knobs must give byte-identical output');
  assert.notEqual(run({ seedDir: TESTDATA, seed: 7 }).hash, a.hash);
  structural(a);
  const end = Date.parse(a.world.meta.window.end);
  for (const e of a.world.events) assert.ok(Date.parse(e.known_at) <= end);
  const xo = a.world.orders.filter((o) => o.type === 'xometry_cnc');
  assert.ok(xo.length >= 400 && xo.length <= 550, `xometry orders ${xo.length}`);
  for (const o of xo) assert.ok(Date.parse(o.placed_at) <= end);
  assert.ok(a.ms < 5000, `runtime ${a.ms} ms`);
});

test('real seeds: valid, deterministic, under five seconds, volumes and tier mix inside knobs.targets', { skip: !hasReal }, (t) => {
  const a = run({});
  const b = run({});
  assert.equal(a.hash, b.hash);
  assert.ok(a.ms < 5000, `runtime ${a.ms} ms`);
  const sc = structural(a);
  const s = a.answers.summary;
  const k = readJson(fileURLToPath(new URL('../../../fixtures/world/knobs.json', import.meta.url)));
  const within = (v, [lo, hi], name) => assert.ok(v >= lo && v <= hi, `${name} ${v} outside ${lo}-${hi}`);
  within(s.xometry_orders, k.targets.xometry_orders, 'xometry orders');
  for (const t of ['expedite', 'standard', 'economy']) within(s.tier_mix[t], k.targets.tier_mix[t], `tier ${t}`);
  within(s.tier_mix_burst.expedite, k.targets.burst_expedite, 'burst expedite');
  within(s.late_share, k.targets.late_share, 'late share');
  within(s.expedite_true_gain_share, k.targets.expedite_true_gain_share, 'expedites that truly gained');
  for (const w of sc.warnings) t.diagnostic(`statistic outside its target: ${w}`);
  const now = Date.parse(a.world.meta.demo_now);
  for (const e of a.world.events) assert.ok(Date.parse(e.known_at) <= now, `${e.id} after demo_now`);
  for (const o of a.world.orders) assert.ok(Date.parse(o.placed_at) <= now, `${o.id} placed after demo_now`);
  // pinned demo case A (spec S14)
  const motor = a.world.deliverables.find((d) => d.id === a.world.demo.motor.deliverable);
  assert.equal(motor.true_arrival, a.world.demo.motor.ready_date);
  assert.equal(a.world.tests.find((t) => t.id === a.world.demo.test).actual_start, null);
});
