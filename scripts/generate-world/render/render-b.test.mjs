// Tests for the meetings, calendar, xometry and ramp renderers on the example world.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as meetings from './meetings.mjs';
import * as calendar from './calendar.mjs';
import * as xometry from './xometry.mjs';
import * as ramp from './ramp.mjs';
import * as demo from './demo.mjs';
import { parseCalendar } from '../../../server/connectors/ics.js';
import { HIDDEN_KEYS } from '../checks.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EX = path.resolve(HERE, '../../../fixtures/world/example');
const world = () => JSON.parse(fs.readFileSync(path.join(EX, 'world.json'), 'utf8'));
const filled = JSON.parse(fs.readFileSync(path.join(EX, 'jobs/meeting.filled.json'), 'utf8'));
const W = world();
const NOW = Date.parse(W.meta.demo_now);
const ctx = { seed: 1, weeks: 13, demoNow: W.meta.demo_now };
const texts = { 'mtg-00001': { transcript: filled.transcript, summary: filled.summary } };
const R = { meetings, calendar, xometry, ramp, demo };

function run(name, w = world()) {
  const { records, jobs } = R[name].plan(w, ctx);
  const { files } = R[name].emit(records, name === 'meetings' ? texts : {}, ctx);
  return { records, jobs, files };
}

function keysOf(v, out = new Set()) {
  if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.add(k); keysOf(x, out); }
  return out;
}

for (const name of Object.keys(R)) {
  test(`${name}: two runs are byte-identical`, () => {
    const a = run(name); const b = run(name);
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    assert.ok(a.files.length > 0);
  });

  test(`${name}: no hidden key or hidden-reason label in emitted files or jobs`, () => {
    const { files, jobs } = run(name);
    for (const f of files) {
      assert.ok(!/genuine_gain|test_slot_cliff|no_gain_other_input_later|cheap_default|personal_habit|budget_squeeze|insurance_or_spare|ordered_late|pressure_manager_or_demo/i.test(f.content), f.path);
      assert.ok(!/(?<![\w-])(?<!cal-)(ord-[xo]-\d{5}|ev-\d{6}|dmd-\d{5}|slip-\d{5}|mtg-\d{5}|sl-[a-z]+)/.test(f.content), `${f.path} leaks an internal id`);
      if (f.path.endsWith('.json')) for (const k of keysOf(JSON.parse(f.content))) assert.ok(!HIDDEN_KEYS.has(k), `${f.path}: ${k}`);
    }
    for (const j of jobs) {
      for (const k of keysOf(j)) assert.ok(!HIDDEN_KEYS.has(k), `job key ${k}`);
      assert.ok(!/sl-[a-z]/.test(JSON.stringify(j)), 'storyline id in job');
    }
  });
}

test('xometry: parses, every tier on quotes, nothing after demo now', () => {
  const { files } = run('xometry');
  const orders = JSON.parse(files.find((f) => f.path === 'xometry/orders.json').content).orders;
  const quotes = JSON.parse(files.find((f) => f.path === 'xometry/quotes.json').content).quotes;
  assert.equal(orders.length, 2);
  assert.equal(quotes[0].lead_time_options.length, 3);
  assert.equal(quotes[1].lead_time_options.length, 2);
  for (const o of orders) {
    assert.ok(Date.parse(o.placed_at) <= NOW);
    for (const h of o.status_history) assert.ok(Date.parse(h.at) <= NOW);
    if (o.delivered_at) assert.ok(Date.parse(o.delivered_at) <= NOW);
  }
});

test('xometry: a delivery after demo now is not shown', () => {
  const w = world();
  const o = w.orders.find((x) => x.id === 'ord-x-00002');
  o.delivered_at = '2026-11-12T12:30:00-08:00';
  o.status = o.status.map((h) => (h.value === 'delivered' ? { ...h, effective: o.delivered_at, known_at: o.delivered_at } : h));
  const files = R.xometry.emit(R.xometry.plan(w, ctx).records).files;
  const shown = JSON.parse(files[0].content).orders.find((x) => x.order_number === o.order_number);
  assert.equal(shown.delivered_at, null);
  assert.equal(shown.status, 'Shipped');
});

test('ramp: every Xometry charge equals the order total; pending after demo now', () => {
  const { files } = run('ramp');
  const tx = JSON.parse(files.find((f) => f.path === 'ramp/transactions.json').content).data;
  const xo = JSON.parse(run('xometry').files.find((f) => f.path === 'xometry/orders.json').content).orders;
  for (const o of W.orders.filter((x) => x.type === 'xometry_cnc')) {
    const sum = tx.filter((t) => o.ramp_transaction_ids.includes(t.id)).reduce((s, t) => s + t.amount, 0);
    assert.equal(Math.round(sum * 100) / 100, xo.find((x) => x.order_number === o.order_number).total);
  }
  for (const t of tx) {
    assert.ok(Date.parse(t.user_transaction_time) <= NOW);
    assert.equal(t.currency_code, 'USD');
    assert.ok(t.card_holder.first_name);
  }
  const w = world();
  w.ramp_transactions[1].settlement_date = '2026-11-12';
  w.ramp_transactions[1].user_transaction_time = '2026-11-10T09:00:00-08:00';
  const t2 = JSON.parse(R.ramp.emit(R.ramp.plan(w, ctx).records).files[1].content).data.find((t) => t.id === w.ramp_transactions[1].id);
  assert.equal(t2.state, 'PENDING');
  assert.equal(t2.settlement_date, null);
});

test('calendar: the app connector parses it; milestones at the believed date', () => {
  const ics = run('calendar').files[0].content;
  const docs = parseCalendar(ics, { from: '2026-08-01T00:00:00Z', to: '2026-12-31T00:00:00Z' });
  const titles = docs.map((d) => d.text.split('\n')[0]);
  assert.ok(titles.includes('Hip actuator DVT spin test complete'));
  assert.equal(docs.find((d) => d.text.startsWith('Hip actuator DVT spin test complete')).at, '2026-11-24');
  assert.ok(docs.some((d) => d.attrs.categories.includes('OOO')));
  assert.ok(docs.some((d) => /Overlaps a booking/.test(d.text)));
  const sync = docs.filter((d) => d.text.startsWith('Supply chain + mech sync'));
  assert.ok(sync.length >= 5);
  assert.equal(sync[0].at, '2026-10-22T17:30:00.000Z'); // 10:30 PDT
  assert.ok(sync.some((d) => d.at === '2026-11-05T18:30:00.000Z')); // 10:30 PST after DST ends
});

test('calendar: moved and cancelled instances', () => {
  const w = world();
  w.meetings.push({ ...w.meetings[0], id: 'mtg-00002', start: '2026-10-30T14:00:00-07:00', moved_from: '2026-10-29T10:30:00-07:00' });
  w.meetings.push({ ...w.meetings[0], id: 'mtg-00003', start: '2026-11-05T10:30:00-08:00', cancelled: true });
  const ics = R.calendar.emit(R.calendar.plan(w, ctx).records, {}, ctx).files[0].content;
  const sync = parseCalendar(ics, { from: '2026-10-20T00:00:00Z', to: '2026-11-15T00:00:00Z' }).filter((d) => d.text.startsWith('Supply chain'));
  assert.deepEqual(sync.map((d) => d.at), ['2026-10-22T17:30:00.000Z', '2026-10-30T21:00:00.000Z', '2026-11-12T18:30:00.000Z']);
});

test('meetings: job matches the example format and the file carries the transcript', () => {
  const { jobs, files, records } = run('meetings');
  assert.equal(jobs.length, 1);
  const j = jobs[0];
  assert.deepEqual(Object.keys(j), Object.keys(JSON.parse(fs.readFileSync(path.join(EX, 'jobs/meeting.blank.json'), 'utf8'))));
  assert.deepEqual(j.meeting, filled.meeting);
  assert.deepEqual(j.crumbs[0].must_mention, ['11/20']);
  assert.deepEqual(j.crumbs[0].at_min, [8, 14]);
  assert.equal(j.transcript, null);
  assert.ok(records[0].crumbs[0].fallback_text.includes('11/20'));
  const md = files[0].content;
  assert.match(files[0].path, /^meetings\/2026-10-22-1030-/);
  assert.match(md, /\[08:32\] Arjun Venkatesan: On the motor/);
  assert.match(md, /## Action items/);
});

test('meetings: missing text falls back to the crumb line; window limits', () => {
  const { records } = R.meetings.plan(W, ctx);
  const md = R.meetings.emit(records, {}, ctx).files[0].content;
  assert.match(md, /11\/20/);
  assert.equal(R.meetings.plan(W, { ...ctx, weeks: 1 }).jobs.length, 0);
  const w = world();
  w.meetings[0].start = '2026-11-10T11:00:00-08:00';
  assert.equal(R.meetings.plan(w, ctx).jobs.length, 0, 'meeting after demo now');
});

test('demo: quote tiers equal the demo block; files parse; live changes are offsets', () => {
  const { files } = run('demo');
  const get = (p) => JSON.parse(files.find((f) => f.path === p).content);
  const q = get('demo/quote.json');
  const want = Object.fromEntries(W.demo.quote.tiers.map((t) => [t.tier, t]));
  assert.deepEqual(q.lead_time_options.map((t) => t.total), [want.standard.price_usd, want.expedite.price_usd]);
  assert.deepEqual(q.lead_time_options.map((t) => t.estimated_delivery_date), [want.standard.ready_date, want.expedite.ready_date]);
  assert.equal(q.quote_id, W.demo.quote.quote_id);
  assert.equal(q.parts[0].quantity, W.demo.quantity);
  assert.ok(!('chosen_tier' in q));
  const pe = get('demo/part-entry.json');
  assert.equal(pe.requester.email, 'owen@flintlockrobotics.com');
  const lc = get('demo/live-changes.json').changes;
  assert.equal(lc.length, 2);
  assert.equal(lc[0].offset_minutes, 15);
  assert.match(lc[0].message.text, /11\/30/);
  assert.equal(lc[0].message.channel, 'C07FLK0ACTU');
  const raw = files.map((f) => f.content).join('\n');
  assert.ok(!/live-[a-z]|"case"|true_arrival|dl-hip|\bcase [A-E]\b/i.test(raw));
  assert.equal(get('demo/policy.json').policies[0].usd_per_day, 600);
});
