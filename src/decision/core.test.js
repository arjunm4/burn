import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decide, explain} from './core.js';

// The worked example from docs/architecture.md §7, in calendar days from placement on Mon Nov 9.
const ORDER = '2026-11-09';
const day = n => new Date(Date.parse(ORDER + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const options = [
  {tier: 'Standard', priceCents: 300000, mfgDays: 10, shipDays: 0, readyOn: day(10)},
  {tier: 'Expedited', priceCents: 390000, mfgDays: 5, shipDays: 0, readyOn: day(5)},
];
// Spin test needs the bracket AND the motor; it takes 3 days; the milestone is the test itself.
const graph = motorDay => ({
  nodes: [
    {id: 'part:bracket', kind: 'part', label: 'Bracket', attrs: {}},
    {id: 'part:motor', kind: 'part', label: 'Motor', attrs: {date: day(motorDay)}},
    {id: 'work:spin-test', kind: 'work', label: 'Spin test', attrs: {durationDays: 3}},
    {id: 'milestone:spin', kind: 'milestone', label: 'Spin test done', attrs: {date: day(11)}},
  ],
  edges: [
    {id: 'e1', from: 'part:bracket', to: 'work:spin-test', kind: 'blocks', evidence: ['s1']},
    {id: 'e2', from: 'part:motor', to: 'work:spin-test', kind: 'blocks', evidence: ['s1']},
    {id: 'e3', from: 'work:spin-test', to: 'milestone:spin', kind: 'due', evidence: ['s1']},
  ],
});
const base = (motorDay, extra = {}) => decide({
  options, quote: {validUntil: day(30), cutoff: null}, graph: graph(motorDay), partNodeId: 'part:bracket', milestoneId: 'milestone:spin',
  orderDate: ORDER, now: ORDER + 'T10:00:00Z', policy: {valuePerDayCents: 60000, targetOn: day(11), hard: false, owner: 'Arjun'}, ...extra,
});
const opt = (r, tier) => r.options.find(o => o.tier === tier);

test('case A: partial acceleration → economics picks Expedited at $450/day break-even', () => {
  const r = base(8);
  assert.deepEqual([opt(r, 'Standard').finishOn, opt(r, 'Expedited').finishOn], [day(13), day(11)]);
  assert.equal(opt(r, 'Expedited').deltaDays, 2);
  assert.equal(opt(r, 'Expedited').breakEvenCentsPerDay, 45000);
  assert.deepEqual(r.recommended, {tier: 'Expedited', basis: 'economics'});
  assert.match(explain(r, {milestoneLabel: 'the spin test'}), /Expedited gets the spin test done 2 days sooner for \+\$900: worth it if a day is worth more than \$450/);
  assert.ok(r.assumptions.some(a => /valued at \$600 \(Arjun's policy\)/.test(a)));
});

test('case B: another input dominates → Standard by dominance, no valuation needed', () => {
  const r = base(12, {policy: {valuePerDayCents: null, targetOn: null, hard: false, owner: null}});
  assert.equal(opt(r, 'Standard').finishOn, opt(r, 'Expedited').finishOn);
  assert.equal(opt(r, 'Expedited').deltaDays, 0);
  assert.equal(opt(r, 'Expedited').breakEvenCentsPerDay, null);
  assert.deepEqual(r.recommended, {tier: 'Standard', basis: 'dominance'});
  assert.deepEqual(r.dominated, ['Expedited']);
  assert.match(explain(r), /paying more buys no time.*Motor gates it/);
});

test('case C: every option late, linear policy → Expedited still wins', () => {
  const r = base(8, {policy: {valuePerDayCents: 60000, targetOn: day(10), hard: false, owner: 'Arjun'}});
  assert.deepEqual(r.recommended, {tier: 'Expedited', basis: 'economics'});
});

test('case D: unknown motor date → the question goes to the motor owner, with a switching condition', () => {
  const r = base(8, {uncertain: [{nodeId: 'part:motor', label: 'motor ready', owner: 'Arjun', current: day(8), plausible: [day(7), day(8), day(9), day(12)]}]});
  assert.equal(r.recommended, null, 'nothing is preselected while the flip question is open');
  assert.deepEqual(r.tentative, {tier: 'Expedited', basis: 'economics'});
  assert.ok(r.question && r.question.flips && r.question.owner === 'Arjun', JSON.stringify(r.question));
  assert.match(r.switching, /Standard wins if motor ready 2026-11-18/);
  assert.match(explain(r), /Leaning Expedited, but it hinges on motor ready/);
});

test('no policy and a real trade-off → nothing preselected; break-even shown', () => {
  const r = base(8, {policy: {valuePerDayCents: null, targetOn: null, hard: false, owner: null}});
  assert.equal(r.recommended, null);
  assert.match(explain(r), /no value-of-time policy.*Expedited at \$450\/day/);
  assert.ok(r.assumptions.some(a => /No value-of-time policy/.test(a)));
});

test('unknown duration → unknown outcome, no recommendation, unknowns listed', () => {
  const g = graph(8); g.nodes[2].attrs = {};
  const r = base(8, {graph: g});
  assert.equal(r.recommended, null);
  assert.ok(r.unknowns.includes('milestone:spin'));
  assert.equal(opt(r, 'Expedited').deltaDays, null);
});

test('a hard deadline makes late options inadmissible; the one that makes it is recommended', () => {
  // Hard target day 11: Standard finishes day 13 (misses), Expedited day 11 (makes it).
  const r = base(8, {policy: {valuePerDayCents: null, targetOn: day(11), hard: true, owner: 'Arjun'}});
  assert.equal(opt(r, 'Standard').admissible, false);
  assert.match(opt(r, 'Standard').why, /hard deadline/);
  assert.deepEqual(r.recommended, {tier: 'Expedited', basis: 'dominance'});
  // Nothing makes it: no valid option, say so.
  const none = base(12, {policy: {valuePerDayCents: null, targetOn: day(11), hard: true, owner: 'Arjun'}});
  assert.equal(none.recommended, null);
  assert.match(explain(none), /No valid option: misses the hard deadline/);
});

test('expired quote → inadmissible, explained', () => {
  const r = base(8, {quote: {validUntil: day(-1), cutoff: null}});
  assert.ok(r.options.every(o => !o.admissible && o.why === 'quote expired'));
  assert.equal(r.recommended, null);
  assert.match(explain(r), /No valid option: quote expired/);
});

test('latest placement: the last order day per tier that still makes the target, from the vendor arithmetic', () => {
  // Fake tiers from Mon Nov 9: Standard 10 mfg + 2 ship → ready Wed Nov 25; Expedited 5 + 2 → ready Wed Nov 18.
  const shipped = [
    {tier: 'Standard', priceCents: 300000, mfgDays: 10, shipDays: 2, readyOn: '2026-11-25'},
    {tier: 'Expedited', priceCents: 390000, mfgDays: 5, shipDays: 2, readyOn: '2026-11-18'},
  ];
  // Target Tue Nov 24, calendar days: spin test (3d) must start by Sat Nov 21, so the bracket must be ready by Nov 21.
  // Expedited ordered Thu Nov 12 → 5 business days → Thu Nov 19, +2 ship → Sat Nov 21 (makes it); Fri Nov 13 → Nov 22 (misses).
  // Standard ordered Mon Nov 9 is already ready Nov 25 → misses even today.
  const r = base(8, {options: shipped, policy: {valuePerDayCents: 60000, targetOn: '2026-11-24', hard: false, owner: 'Arjun'}});
  assert.equal(opt(r, 'Expedited').orderBy, '2026-11-12');
  assert.equal(opt(r, 'Expedited').slackDays, 3);
  assert.equal(opt(r, 'Expedited').missesTarget, undefined);
  assert.equal(opt(r, 'Standard').orderBy, null);
  assert.equal(opt(r, 'Standard').slackDays, null);
  assert.equal(opt(r, 'Standard').missesTarget, true);
  assert.deepEqual(r.recommended, {tier: 'Expedited', basis: 'economics'});
  assert.match(explain(r, {milestoneLabel: 'the spin test'}), /worth it if a day is worth more than \$\d+, and it can wait until Nov 12 to be placed\./);

  // No target: nothing to hold the order to, so no placement window.
  const none = base(8, {options: shipped, policy: {valuePerDayCents: 60000, targetOn: null, hard: false, owner: 'Arjun'}});
  assert.ok(none.options.every(o => o.orderBy === null && o.slackDays === null && o.missesTarget === undefined));
  assert.doesNotMatch(explain(none), /can wait until/);

  // Options without mfgDays/shipDays (a provider that only gives readyOn) have no window either.
  const bare = base(8, {options: shipped.map(({mfgDays, shipDays, ...o}) => o), policy: {valuePerDayCents: 60000, targetOn: '2026-11-24', hard: false, owner: 'Arjun'}});
  assert.ok(bare.options.every(o => o.orderBy === null && o.slackDays === null && o.missesTarget === undefined));

  // Company calendar, target Fri Dec 4: the bracket must land by Tue Dec 1 (usable Wed, test Wed–Fri). Standard ordered
  // Fri Nov 13 → Fri Nov 27 + 2 → Sun Nov 29 (makes it); a Sat/Sun order would too, but those are not order days, and Mon
  // Nov 16 → Dec 2 misses. Expedited: Fri Nov 20 → Nov 27 + 2 → Nov 29; Mon Nov 23 → Dec 2 misses.
  const wd = base(8, {options: shipped, calendar: {holidays: []}, policy: {valuePerDayCents: 60000, targetOn: '2026-12-04', hard: false, owner: 'Arjun'}});
  assert.deepEqual([opt(wd, 'Standard').orderBy, opt(wd, 'Standard').slackDays], ['2026-11-13', 4]);
  assert.deepEqual([opt(wd, 'Expedited').orderBy, opt(wd, 'Expedited').slackDays], ['2026-11-20', 9]);
});

test('same inputs → same snapshot hash; a changed assumption changes it', () => {
  assert.equal(base(8).snapshotHash, base(8).snapshotHash);
  assert.notEqual(base(8).snapshotHash, base(9).snapshotHash);
});
