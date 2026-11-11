import test from 'node:test';
import assert from 'node:assert/strict';
import { demoCard, FIXTURE_SOURCES, tsToIso } from './demo.mjs';
import { timevalueRoutes } from './routes.mjs';

// The demo fixture carries the pinned dates of simulation-spec.md S14: cases A, B and D.
const card = async (change) => (await demoCard({ change, sourcesDir: FIXTURE_SOURCES })).card;

test('change 0 is case A: Expedite, 2 wd for $900, break-even $450, policy $600', async () => {
  const c = await card(0);
  assert.equal(c.outcome, 'pay');
  assert.equal(c.recommended, 'expedite');
  const [std, exp] = c.tiers;
  assert.deepEqual([std.finish, exp.finish], ['2026-12-01', '2026-11-25']);
  assert.equal(exp.days_saved, 2);
  assert.equal(exp.break_even, 450);
  assert.match(c.headline, /\+\$300/);
  assert.match(c.detail.join(' '), /Fri 11\/20 \(Arjun, 3 days ago\)/);
});

test('change 1 is case B: the motor dominates, Standard', async () => {
  const c = await card(1);
  assert.equal(c.outcome, 'cheapest');
  assert.equal(c.recommended, 'standard');
  assert.deepEqual(c.tiers.map((t) => t.finish), ['2026-12-03', '2026-12-03']);
  assert.match(c.change.text, /11\/30/);
});

test('change 2 is case D: depends, ask Arjun about Fri 11/20', async () => {
  const c = await card(2);
  assert.equal(c.outcome, 'depends');
  assert.equal(c.recommended, null);
  assert.equal(c.switching.by_date, '2026-11-20');
  assert.match(c.detail.join(' '), /Ask Arjun/);
});

test('slack ts → Pacific ISO', () => {
  assert.equal(tsToIso('1794075120.000000'), '2026-11-07T10:12:00-08:00');
  assert.equal(tsToIso('1792514500.000000'), '2026-10-20T09:41:40-07:00');
});

test('routes reject a bad change and unknown paths', async () => {
  const out = [];
  const json = (v, s = 200) => out.push([s, v]);
  await timevalueRoutes({ method: 'GET', url: '/api/timevalue/demo?change=7' }, null, '/api/timevalue/demo', json);
  await timevalueRoutes({ method: 'GET', url: '/api/timevalue/nope' }, null, '/api/timevalue/nope', json);
  assert.deepEqual(out.map((o) => o[0]), [400, 404]);
  assert.equal(await timevalueRoutes({ method: 'GET', url: '/api/x' }, null, '/api/x', json), false);
});
