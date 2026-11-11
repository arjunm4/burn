import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { demoCard, FIXTURE_SOURCES, wastedExpedites, WASTED_FALLBACK } from './demo.mjs';
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
  assert.ok(c.tiers.length >= 2 && c.tiers.every((t) => t.finish === '2026-12-03')); // every tier, Rush included
  assert.match(c.change.text, /11\/30/);
});

test('change 2 is case D: depends, ask Arjun about Fri 11/20', async () => {
  const c = await card(2);
  assert.equal(c.outcome, 'depends');
  assert.equal(c.recommended, null);
  assert.equal(c.switching.by_date, '2026-11-20');
  assert.match(c.detail.join(' '), /Ask Arjun/);
});

test('a missing demo source is a clear error, not a crash', async () => {
  await assert.rejects(demoCard({ sourcesDir: '/nonexistent-tv-sources' }), /part-entry\.json.*quote\.json/);
});

test('a one-tier quote still renders a card', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tv-one-tier-'));
  cpSync(FIXTURE_SOURCES, dir, { recursive: true });
  const file = path.join(dir, 'demo/quote.json');
  const q = JSON.parse(readFileSync(file, 'utf8'));
  q.lead_time_options = q.lead_time_options.slice(0, 1);
  writeFileSync(file, JSON.stringify(q));
  const c = (await demoCard({ sourcesDir: dir })).card;
  assert.equal(c.tiers.length, 1);
  assert.equal(c.dominated.length, 0);
  assert.ok(c.headline);
});

test('routes reject a bad change and unknown paths', async () => {
  const out = [];
  const json = (v, s = 200) => out.push([s, v]);
  await timevalueRoutes({ method: 'GET', url: '/api/timevalue/demo?change=7' }, null, '/api/timevalue/demo', json);
  await timevalueRoutes({ method: 'GET', url: '/api/timevalue/demo?change=1.5' }, null, '/api/timevalue/demo', json);
  await timevalueRoutes({ method: 'GET', url: '/api/timevalue/demo?change=abc' }, null, '/api/timevalue/demo', json);
  await timevalueRoutes({ method: 'GET', url: '/api/timevalue/nope' }, null, '/api/timevalue/nope', json);
  await timevalueRoutes({ method: 'GET', url: '/api/timevalue/habit' }, null, '/api/timevalue/habit', json);
  await timevalueRoutes({ method: 'POST', url: '/api/timevalue/demo' }, null, '/api/timevalue/demo', json);
  assert.deepEqual(out.map((o) => o[0]), [400, 400, 400, 404, 404, 405]);
  assert.equal(await timevalueRoutes({ method: 'GET', url: '/api/x' }, null, '/api/x', json), false);
});

test('check 7 on the flintlock cards: advisory, cited, outcomes unchanged', async () => {
  const { existsSync } = await import('node:fs');
  const dir = new URL('../../fixtures/flintlock', import.meta.url).pathname;
  if (!existsSync(dir)) return;
  const expect = { 0: 'pay', 1: 'cheapest', 2: 'depends' };
  for (const change of [0, 1, 2]) {
    const c = (await demoCard({ change, sourcesDir: dir })).card;
    assert.equal(c.outcome, expect[change]);
    const k = c.checks.find((x) => x.advisory);
    assert.equal(k.label, 'What the conversation says · from the LLM read');
    assert.ok(k.items.length > 0 && k.items.every((i) => i.sources.length > 0));
    assert.equal(c.blocked, false);
  }
});

test('change 3 on the flintlock cards: Samir contradicts Arjun, check 7b fires and the card asks', async () => {
  const { existsSync } = await import('node:fs');
  const dir = new URL('../../fixtures/flintlock', import.meta.url).pathname;
  if (!existsSync(dir)) return;
  const c = (await demoCard({ change: 3, sourcesDir: dir })).card;
  assert.equal(c.change.by, 'Samir Khoury');
  assert.equal(c.now, '2026-11-10T11:15:00-08:00');
  assert.equal(c.outcome, 'ask_owner');
  assert.equal(c.recommended, null);
  assert.equal(c.blocked, false);
  const k = c.checks.find((x) => x.advisory).items.find((i) => i.key === 'conflict');
  assert.ok(k && k.blocks && k.status === 'fail');
  assert.equal(k.sources.length, 2);
  assert.ok(k.sources.includes(c.change.doc_id));
  assert.match(c.headline, /Arjun says Fri 11\/20, Samir says Fri 11\/27/);
  assert.match(c.detail.join(' '), /Ask Arjun/);
});

test('dominated tier is its own line and marks the row', async () => {
  const c = await card(0);
  assert.ok(c.dominated.length > 0 && c.dominated.every((d) => /for nothing/.test(d)));
  assert.ok(!c.detail.some((d) => /for nothing/.test(d)));
  const rush = c.tiers.find((t) => t.tier === 'rush');
  if (rush) assert.equal(rush.no_faster_than, 'Expedite');
});

test('wasted banner numbers come from grading.json', async () => {
  const w = await wastedExpedites();
  assert.deepEqual(w, WASTED_FALLBACK);
  assert.deepEqual(await wastedExpedites({ outDir: '/nonexistent' }), WASTED_FALLBACK);
});

test('routes accept change 3', async () => {
  const out = [];
  await timevalueRoutes({ method: 'GET', url: '/api/timevalue/demo?change=3' }, null, '/api/timevalue/demo', (v, s = 200) => out.push(s));
  assert.deepEqual(out, [200]);
});
