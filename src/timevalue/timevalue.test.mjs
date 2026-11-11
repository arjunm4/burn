// Cases A-E from docs/architecture.md §7 with the pinned dates in docs/build/simulation-spec.md S14.
// Hand-made fixtures only (shaped like fixtures/flintlock/demo/{quote,policy}.json); no generated data is read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCalendar, addDays, solve, compare, rubric } from './index.mjs';
import { makeCalendar as simCalendar } from '../../scripts/generate-world/lib/calendar.mjs';

const quoteJson = {
  expires_on: '2026-12-10',
  lead_time_options: [
    { lead_time: 'Standard', total: 3000, estimated_delivery_date: '2026-11-24' }, // day 10
    { lead_time: 'Expedite', total: 3900, estimated_delivery_date: '2026-11-17' }, // day 5
  ],
};
const policyJson = {
  milestone: 'Hip actuator DVT spin test complete', milestone_date: '2026-11-24', type: 'per_day', usd_per_day: 600,
  set_by: { name: 'Arjun Venkatesan' },
};
const curvePolicy = { type: 'curve', curve: [{ days_late: 1, usd: 4000 }, { days_late: 3, usd: 25000 }, { days_late: 5, usd: 80000 }] };

// S1 holidays (the subset that matters here plus the observance kinds).
const holidays = [
  { date: '2026-09-07', name: 'Labor Day', observance: 'full' },
  { date: '2026-11-11', name: 'Veterans Day', observance: 'worked' },
  { date: '2026-11-26', name: 'Thanksgiving', observance: 'full' },
  { date: '2026-11-27', name: 'Day after Thanksgiving', observance: 'full' },
  { date: '2026-06-19', name: 'Juneteenth', observance: 'partial' },
];
const NOW = '2026-11-10T10:30:00-08:00';
const quote = quoteJson.lead_time_options.map((o) => ({ tier: o.lead_time, total: o.total, ready: o.estimated_delivery_date }));
const spinTest = { id: 'test-hip-spin', planned_start: '2026-11-18', duration_days: 3, rig_slot_days: null, bookings: [], owner_out: [] };
const policy = { type: policyJson.type, usd_per_day: policyJson.usd_per_day, by: policyJson.set_by.name };
const milestone = { name: policyJson.milestone, target: policyJson.milestone_date, owner: 'Arjun Venkatesan', policy };
const motor = (ready) => ({ id: 'dl-hip-motor-dvt', name: 'the DVT hip frameless motor', owner: 'Arjun Venkatesan', ready });
const base = { holidays, quote, test: spinTest, milestone, now: NOW, part: 'pt-hip-bracket', quoteValidUntil: quoteJson.expires_on };
const tier = (c, name) => c.tiers.find((t) => t.tier === name);

test('calendar matches the generator calendar and the S14 day numbers', () => {
  const cal = makeCalendar(holidays);
  const sim = simCalendar({ holidays, window: { start: '2026-02-10T00:00:00-08:00', end: '2026-11-10T23:59:59-08:00' } });
  for (let d = '2026-08-01'; d <= '2027-01-15'; d = addDays(d, 1)) {
    assert.equal(cal.isWd(d), sim.isWd(d), d);
    assert.equal(cal.addWd(d, 7), sim.addWd(d, 7), d);
    assert.equal(cal.wdBetween('2026-11-10', d), sim.wdBetween('2026-11-10', d), d);
  }
  const day = (n) => cal.addWd('2026-11-10', n);
  assert.deepEqual([5, 7, 8, 10, 11, 12, 13, 15].map(day),
    ['2026-11-17', '2026-11-19', '2026-11-20', '2026-11-24', '2026-11-25', '2026-11-30', '2026-12-01', '2026-12-03']);
});

test('solve: ready on R is usable from the next wd; finish = addWd(start, duration - 1)', () => {
  const r = solve({ holidays, test: spinTest, inputs: [{ id: 'bracket', ready: '2026-11-24' }, motor('2026-11-20')] });
  assert.deepEqual(r, { start: '2026-11-25', finish: '2026-12-01', limiter: { kind: 'input', id: 'bracket' } });
  const early = solve({ holidays, test: { ...spinTest, planned_start: '2026-11-30' }, inputs: [{ id: 'bracket', ready: '2026-11-17' }] });
  assert.deepEqual(early.limiter, { kind: 'planned_start', id: 'test-hip-spin' });
  assert.equal(early.start, '2026-11-30');
  const out = solve({ holidays, test: { ...spinTest, owner: 'arjun', owner_out: [{ start: '2026-11-23', end: '2026-11-23' }] }, inputs: [motor('2026-11-20')] });
  assert.equal(out.start, '2026-11-24');
  assert.equal(out.limiter.kind, 'owner_out');
  assert.equal(solve({ holidays, test: spinTest, inputs: [motor(null)] }).finish, null);
});

test('case A: motor 11/20 -> Standard 12/01, Expedite 11/25, 2 days, break-even $450, policy $600 -> pay', () => {
  const c = compare({ ...base, inputs: [motor('2026-11-20')] });
  assert.equal(tier(c, 'Standard').finish_by_scenario.base, '2026-12-01');
  assert.equal(tier(c, 'Expedite').finish_by_scenario.base, '2026-11-25');
  assert.equal(tier(c, 'Expedite').days_saved, 2);
  assert.equal(tier(c, 'Expedite').break_even, 450);
  assert.equal(tier(c, 'Expedite').by_scenario.base.net, 300);
  assert.equal(c.outcome, 'pay');
  assert.equal(c.recommended, 'Expedite');
  assert.deepEqual(c.limiter, { kind: 'input', id: 'dl-hip-motor-dvt' });
  assert.equal(c.switching, null);
});

test('case B: motor 11/30 -> both 12/03 -> cheapest, the motor limits', () => {
  const c = compare({ ...base, inputs: [motor('2026-11-30')] });
  assert.equal(tier(c, 'Standard').finish_by_scenario.base, '2026-12-03');
  assert.equal(tier(c, 'Expedite').finish_by_scenario.base, '2026-12-03');
  assert.equal(tier(c, 'Expedite').days_saved, 0);
  assert.equal(tier(c, 'Expedite').break_even, null);
  assert.equal(c.outcome, 'cheapest');
  assert.equal(c.recommended, 'Standard');
  assert.deepEqual(c.limiter, { kind: 'input', id: 'dl-hip-motor-dvt' });
});

test('case C: target 11/24 -> Standard 3 days late, Expedite 1 -> Expedite', () => {
  const c = compare({ ...base, inputs: [motor('2026-11-20')] });
  assert.equal(tier(c, 'Standard').by_scenario.base.days_late, 3);
  assert.equal(tier(c, 'Expedite').by_scenario.base.days_late, 1);
  assert.equal(c.recommended, 'Expedite');
  // Same question as an owner curve: $4,000 at 1 day late vs $25,000 at 3 -> $21,000 avoided > $900.
  const k = compare({ ...base, inputs: [motor('2026-11-20')], milestone: { ...milestone, policy: curvePolicy } });
  assert.equal(tier(k, 'Expedite').by_scenario.base.value, 21000);
  assert.equal(k.outcome, 'pay');
});

test('case D: motor 11/19-11/30 -> depends; switching by Fri 11/20; ask the motor owner', () => {
  const c = compare({ ...base, inputs: [motor({ min: '2026-11-19', max: '2026-11-30' })] });
  assert.equal(c.outcome, 'depends');
  assert.equal(c.recommended, null);
  assert.deepEqual(c.switching, { input: 'dl-hip-motor-dvt', by_date: '2026-11-20' });
  assert.deepEqual(c.scenarios.map((s) => [s.label, s.outcome]), [['min', 'pay'], ['switch', 'pay'], ['max', 'cheapest']]);
  assert.deepEqual(tier(c, 'Expedite').finish_by_scenario, { min: '2026-11-24', switch: '2026-11-25', max: '2026-12-03' });
  assert.equal(c.question.to, 'Arjun Venkatesan');
  assert.match(c.question.text, /ready by Fri Nov 20/);
  // One wd later (Mon 11/23, day 9): ΔT = 1 and $600 < $900 -> Standard.
  const d9 = compare({ ...base, inputs: [motor('2026-11-23')] });
  assert.equal(tier(d9, 'Expedite').days_saved, 1);
  assert.equal(d9.outcome, 'dont_pay');
  assert.equal(d9.recommended, 'Standard');
});

test('case E: a Monday-only rig turns a one-day miss into a week', () => {
  const rig = { id: 'test-rig', planned_start: null, duration_days: 1, rig_slot_days: [1], bookings: [], owner_out: [] };
  const onFri = solve({ holidays, test: rig, inputs: [{ id: 'p', ready: '2026-11-13' }] });
  const onMon = solve({ holidays, test: rig, inputs: [{ id: 'p', ready: '2026-11-16' }] });
  assert.equal(onFri.start, '2026-11-16');
  assert.equal(onMon.start, '2026-11-23');
  assert.deepEqual(onMon.limiter, { kind: 'slot', id: 'slot_days' });
  const c = compare({ holidays, test: rig, now: NOW, part: 'p', milestone,
    quote: [{ tier: 'Standard', total: 1000, ready: '2026-11-16' }, { tier: 'Expedite', total: 1500, ready: '2026-11-13' }] });
  assert.equal(tier(c, 'Expedite').days_saved, 5);
  assert.equal(c.outcome, 'pay');
  // A booked Monday pushes it another week.
  const booked = solve({ holidays, test: { ...rig, bookings: [{ id: 'cal:abc', start: '2026-11-16', end: '2026-11-16' }] }, inputs: [{ id: 'p', ready: '2026-11-13' }] });
  assert.equal(booked.start, '2026-11-23');
  assert.deepEqual(booked.limiter, { kind: 'slot', id: 'cal:abc' });
});

test('no policy -> ask_owner with the break-even', () => {
  const c = compare({ ...base, inputs: [motor('2026-11-20')], milestone: { ...milestone, policy: null } });
  assert.equal(c.outcome, 'ask_owner');
  assert.equal(c.recommended, null);
  assert.equal(tier(c, 'Expedite').break_even, 450);
  assert.equal(c.question.to, 'Arjun Venkatesan');
  assert.match(c.question.text, /\$450/);
  // No gain needs no policy.
  assert.equal(compare({ ...base, inputs: [motor('2026-11-30')], milestone: { ...milestone, policy: null } }).outcome, 'cheapest');
});

test('expired quote -> blocked', () => {
  const c = compare({ ...base, inputs: [motor('2026-11-20')], now: '2026-12-11T09:00:00-08:00' });
  assert.equal(c.outcome, 'blocked');
  assert.equal(c.recommended, null);
  const r = rubric(c, { quoteValidUntil: quoteJson.expires_on, now: '2026-12-11T09:00:00-08:00', facts: [] });
  assert.equal(r.blocked, true);
  assert.equal(r.checks[0].status, 'fail');
});

const facts = [
  { text: 'Quote Q-2617750-1: Standard $3,000, Expedite $3,900', by: 'Xometry', at: '2026-11-10T10:05:00-08:00', doc_id: 'xometry:Q-2617750-1', about: 'quote' },
  { text: 'motor ETA 11/20', by: 'Arjun Venkatesan', at: '2026-11-07T11:00:00-08:00', doc_id: 'slack:C07FLK0ACTU:1762542000.000100', about: 'limiter' },
  { text: 'Spin test: $600/day', by: 'Arjun Venkatesan', at: '2026-10-05T09:15:00-07:00', doc_id: 'policy:m-hip-spin-test', about: 'value' },
];

test('rubric: case A passes every guard and cites sources', () => {
  const c = compare({ ...base, inputs: [motor('2026-11-20')] });
  const r = rubric(c, { quoteValidUntil: quoteJson.expires_on, now: NOW, facts });
  assert.equal(r.blocked, false);
  assert.ok(r.guards.every((g) => g.ok));
  assert.deepEqual(r.checks.map((k) => k.n), [1, 2, 3, 4, 5]);
  assert.deepEqual(r.checks.find((k) => k.label === 'Value of a day').sources, ['policy:m-hip-spin-test']);
  assert.match(r.checks.at(-1).text, /Expedite: saves 2 working days, worth it above \$450\/day/);
});

test('rubric guards', () => {
  const c = compare({ ...base, inputs: [motor('2026-11-20')] });
  const guard = (fs, cc = c) => Object.fromEntries(rubric(cc, { quoteValidUntil: quoteJson.expires_on, now: NOW, facts: fs }).guards.map((g) => [g.rule, g.ok]));
  // No invented $/day: the $600 must come from a cited fact.
  assert.equal(guard(facts.filter((f) => f.about !== 'value'))['no invented $/day'], false);
  assert.equal(guard([{ ...facts[2], text: 'Spin test: $6000/day' }])['no invented $/day'], false);
  // No fact after now.
  assert.equal(guard([...facts, { ...facts[1], at: '2026-11-10T11:00:00-08:00' }])['no fact after now'], false);
  // Every fact has a source.
  assert.equal(guard([...facts, { ...facts[1], doc_id: null }])['every fact has a source'], false);
  // No confident card with an open gap (a quote with no expiry is a gap).
  const r = rubric(c, { now: NOW, facts });
  assert.equal(r.guards.find((g) => g.rule === 'no confident card with an open gap').ok, false);
  assert.equal(r.blocked, true);
  // Depends and ask_owner are not confident, so their open gaps are fine.
  const d = compare({ ...base, inputs: [motor({ min: '2026-11-19', max: '2026-11-30' })], milestone: { ...milestone, policy: null } });
  assert.equal(guard(facts.filter((f) => f.about !== 'value'), d)['no confident card with an open gap'], true);
});

// Check 7: what the conversation says (advisory; Owen 2026-11-10).
const conv = (o = {}) => ({ target: '2026-11-24', test_owner: 'p-arjun', earlier_need: [], conflicts: [], pressure: null, ...o });
const urgent = { doc_id: 'slack:C1:1', by: 'p-arjun', at: '2026-11-09T09:00:00-08:00', pressure: 0.8, relative: 0.6, need_earlier: false };
const motorConflict = (subject = 'dl-hip-motor-dvt') => ({ subject, name: 'motor', owner: 'p-arjun', kind: 'eta',
  values: [{ value: '2026-11-20', by: 'Arjun', doc_id: 'slack:C1:2' }, { value: '2026-11-30', by: 'Lena', doc_id: 'meeting:m1' }] });
const check7 = (r) => r.checks.find((k) => k.advisory);

test('check 7: never changes the maths; no citations → not shown', () => {
  const c = compare({ ...base, inputs: [motor('2026-11-20')] });
  const plain = rubric(c, { quoteValidUntil: quoteJson.expires_on, now: NOW, facts });
  const withConv = rubric(c, { quoteValidUntil: quoteJson.expires_on, now: NOW, facts,
    conversation: conv({ pressure: { level: 'high', n: 4, snippets: [{ doc_id: 'slack:C1:1', text: 'asap!!' }] } }) });
  assert.deepEqual(withConv.checks.slice(0, 5), plain.checks);
  assert.equal(withConv.blocked, false);
  const k = check7(withConv);
  assert.equal(k.n, 6);
  assert.equal(k.label, 'What the conversation says · from the LLM read');
  assert.match(k.items.find((i) => i.key === 'pressure').text, /high.*"asap!!"/);
  // e. reason reuses the limiter fact and the decision only.
  assert.equal(k.items.find((i) => i.key === 'reason').text, 'motor ETA 11/20, so expedite: saves 2 working days, worth it above $450/day.');
  // Uncited pressure and no limiter fact → nothing to show.
  const none = rubric(c, { quoteValidUntil: quoteJson.expires_on, now: NOW, facts: facts.filter((f) => f.about !== 'limiter'),
    conversation: conv({ pressure: { level: 'low', n: 0, snippets: [] } }) });
  assert.equal(check7(none), undefined);
});

test('check 7a: urgent talk with slack asks the test owner about an earlier need, without blocking', () => {
  const early = compare({ ...base, inputs: [motor('2026-11-12')] });
  // Target Fri 12/4: Standard (done Tue 12/1) still meets it, so the schedule shows slack.
  const r = rubric(early, { quoteValidUntil: quoteJson.expires_on, now: NOW, facts, conversation: conv({ target: '2026-12-04', earlier_need: [urgent] }) });
  const a = check7(r).items.find((i) => i.key === 'earlier_need');
  assert.equal(a.status, 'unknown');
  assert.deepEqual(a.question, { to: 'p-arjun', text: 'Is there an earlier need, e.g. a test slot?' });
  assert.deepEqual(a.sources, ['slack:C1:1']);
  assert.equal(r.blocked, false);
  assert.equal(r.checks.find((k) => k.label === 'Decision').text, rubric(early, { quoteValidUntil: quoteJson.expires_on, now: NOW, facts }).checks.at(-1).text);
  // No slack (case A: cheapest finishes after the target) → no earlier-need item.
  const late = compare({ ...base, inputs: [motor('2026-11-20')] });
  const r2 = rubric(late, { quoteValidUntil: quoteJson.expires_on, now: NOW, facts, conversation: conv({ earlier_need: [urgent] }) });
  assert.equal(check7(r2).items.some((i) => i.key === 'earlier_need'), false);
});

test('check 7b: a conflict warns; on the limiter it blocks a confident card', () => {
  const c = compare({ ...base, inputs: [motor('2026-11-20')] });
  assert.equal(c.limiter.id, 'dl-hip-motor-dvt');
  const crit = rubric(c, { quoteValidUntil: quoteJson.expires_on, now: NOW, facts, conversation: conv({ conflicts: [motorConflict()] }) });
  const b = check7(crit).items.find((i) => i.key === 'conflict');
  assert.equal(b.status, 'fail');
  assert.equal(b.blocks, true);
  assert.equal(b.question.to, 'p-arjun');
  assert.deepEqual(b.sources, ['slack:C1:2', 'meeting:m1']);
  assert.equal(crit.blocked, true);
  assert.equal(c.recommended, 'Expedite'); // the tier itself is untouched
  const side = rubric(c, { quoteValidUntil: quoteJson.expires_on, now: NOW, facts, conversation: conv({ conflicts: [motorConflict('gearbox')] }) });
  assert.equal(check7(side).items[0].blocks, false);
  assert.equal(side.blocked, false);
});

test('bad input: blocked or null with a reason, never a guessed date', () => {
  const blocked = (args) => compare({ ...base, inputs: [motor('2026-11-20')], ...args });
  // Quote shape.
  assert.equal(blocked({ quote: [] }).reason, 'no quote tiers');
  assert.equal(blocked({ quote: undefined }).outcome, 'blocked');
  assert.match(blocked({ quote: [{ tier: 'Standard', ready: '2026-11-24' }] }).reason, /Standard has no total/);
  // A one-tier quote has nothing faster to buy.
  const one = blocked({ quote: [quote[0]] });
  assert.equal(one.outcome, 'cheapest');
  assert.equal(one.recommended, 'Standard');
  // Malformed dates: no rollover of Feb 31, no free-text dates.
  assert.match(blocked({ quote: [{ ...quote[0], ready: '2026-02-31' }, quote[1]] }).reason, /not a date/);
  assert.match(blocked({ inputs: [motor('next tues')] }).reason, /not a date/);
  assert.match(blocked({ inputs: [motor({ min: '2026-11-30', max: '2026-11-19' })] }).reason, /range/);
  assert.match(blocked({ test: { ...spinTest, planned_start: 'soon' } }).reason, /planned start "soon"/);
  assert.equal(solve({ holidays, test: { ...spinTest, bookings: [{ start: 'x' }] }, inputs: [motor('2026-11-20')] }).limiter.unknown, true);
  assert.equal(blocked({ test: undefined }).outcome, 'blocked');
  // Calendar helpers refuse what they cannot read instead of looping or rolling over.
  assert.throws(() => makeCalendar(holidays).wdBetween('2026-11-10', 'garbage'), RangeError);
  assert.throws(() => addDays('2026-02-31', 1), RangeError);
  // Two ranged inputs: depends without a single switching date, and the rubric still reads.
  const two = compare({ ...base, inputs: [motor({ min: '2026-11-19', max: '2026-11-30' }), { id: 'gearbox', ready: { min: '2026-11-10', max: '2026-11-12' } }] });
  assert.equal(two.outcome, 'depends');
  assert.equal(two.switching, null);
  assert.match(rubric(two, { quoteValidUntil: quoteJson.expires_on, now: NOW, facts }).checks.at(-1).text, /Depends on when/);
  // A quote expiry that is not a date is an open gap, not a pass.
  const r = rubric(compare({ ...base, inputs: [motor('2026-11-20')] }), { quoteValidUntil: 'soon', now: NOW, facts });
  assert.equal(r.checks[0].status, 'unknown');
  assert.equal(r.blocked, true);
  assert.throws(() => rubric(null), TypeError);
});
