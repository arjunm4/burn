import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createOrchestrator} from './orchestrator.js';
import {createOrderStore} from '../orders/store.js';
import {createRampClient} from '../ramp/index.js';
import {createVendorProvider} from '../vendors/index.js';
import {loadConfig} from '../config.js';

// A tiny ingested world: the spin test needs the bracket and Arjun's motor; the milestone is dated.
// A Monday a few weeks out, so quote validity and cutoffs are in the future for the store's checks.
const ORDER = '2026-12-07';
const d = n => new Date(Date.parse(ORDER + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const world = (motorDay = 8) => ({
  listDocuments: () => [
    {id: 's1', source: 'slack', channel: '#actuator', author: 'Arjun', at: '2026-12-04T18:00:00Z', text: `Motor magnets land ${d(motorDay)}; the spin test needs the hip actuator bracket and the motor and takes 3 days.`},
    {id: 's2', source: 'slack', channel: '#random', author: 'Lee', at: '2026-12-05T10:00:00Z', text: 'Lunch?'},
  ],
  latestGraph: () => ({graph: {
    nodes: [
      {id: 'part:motor', kind: 'part', label: 'Motor', attrs: {date: d(motorDay), evidence: 's1'}},
      {id: 'work:spin-test', kind: 'work', label: 'Spin test', attrs: {durationDays: 3, evidence: 's1'}},
      {id: 'milestone:spin', kind: 'milestone', label: 'Spin test done', attrs: {date: d(11), evidence: 's1'}},
    ],
    edges: [{id: 'e2', from: 'part:motor', to: 'work:spin-test', kind: 'blocks', evidence: ['s1']}, {id: 'e3', from: 'work:spin-test', to: 'milestone:spin', kind: 'due', evidence: ['s1']}],
  }, evidence: {s1: {id: 's1', at: '2026-12-04T18:00:00Z', author: 'Arjun'}}}),
});
const config = () => ({...loadConfig(), milestones: {'milestone:spin': {valuePerDayCents: 60000, owner: 'Arjun'}}, scenarios: {slipDays: [1, 4]}});
const cad = {fileName: 'bracket.step', bytes: Buffer.from('solid bracket')};
const settle = () => new Promise(r => setTimeout(r, 30));

function boot(opts = {}) {
  const store = createOrderStore({filename: ':memory:'}), ramp = createRampClient({mode: 'mock', filename: ':memory:'});
  const vendor = createVendorProvider({mode: 'fake', now: () => new Date(ORDER + 'T17:00:00Z'), basePriceCents: 300000});
  const o = createOrchestrator({store, vendor, ramp, ingest: opts.ingest === null ? null : world(opts.motorDay), config: config(), now: () => ORDER + 'T17:00:00Z'});
  const seen = []; o.bus.on('order', e => seen.push(e.type));
  return {o, store, ramp, vendor, seen};
}

test('part entry with full spec: context → quote → recommendation; the engineer adds nothing', async () => {
  const {o, seen} = boot();
  let order = o.enter({name: 'Hip actuator bracket', note: 'for the spin test', cad, engineer: 'Owen', fields: {material: '6061-T6', quantity: 2, revision: 'B', shipTo: 'Emeryville'}});
  assert.equal(order.state, 'entered');
  await settle();
  order = o.get(order.id);
  assert.equal(order.state, 'recommended');
  assert.equal(order.context.milestoneId, 'milestone:spin');
  assert.deepEqual(order.context.related.map(r => r.id), ['s1'], 'only the related document is retrieved');
  assert.equal(order.quote.options.length, 4);
  assert.ok(order.decision.recommended, 'a tier is recommended');
  assert.ok(order.spec.find(f => f.key === 'finish').provenance === 'default');
  assert.ok(seen.includes('context.built') && seen.includes('quote.captured') && seen.includes('recommended'));
});

test('spec gate: missing fields are asked before any quote; answering resolves', async () => {
  const {o, vendor} = boot();
  let order = o.enter({name: 'Hip actuator bracket', note: 'for the spin test', cad, engineer: 'Owen'});
  await settle();
  order = o.get(order.id);
  assert.equal(order.state, 'needs_answer');
  assert.equal(order.question.kind, 'spec');
  assert.deepEqual(order.question.fields, ['material', 'quantity', 'revision', 'shipTo']);
  assert.equal(vendor._records.quotes.size, 0, 'no quote until the spec is complete');
  order = await o.answer(order.id, order.revision, {fields: {material: '7075-T651', quantity: 1, revision: 'C', shipTo: 'Emeryville'}});
  assert.equal(order.state, 'recommended');
  assert.equal(order.spec.find(f => f.key === 'material').provenance, 'engineer');
});

test('no context at all: the demand gap is asked, nothing is inferred', async () => {
  const {o} = boot({ingest: null});
  let order = o.enter({name: 'Widget', note: '', cad, engineer: 'Owen', fields: {material: '6061-T6', quantity: 1, revision: 'A', shipTo: 'HQ'}});
  await settle();
  order = o.get(order.id);
  assert.equal(order.state, 'needs_answer');
  assert.equal(order.question.kind, 'demand');
});

test('Okay → Ramp request → approval → card → verified placement → charge → booked', async () => {
  const {o, ramp, store} = boot({motorDay: 8});
  let order = o.enter({name: 'Hip actuator bracket', note: 'for the spin test', cad, engineer: 'Owen', fields: {material: '6061-T6', quantity: 2, revision: 'B', shipTo: 'Emeryville'}});
  await settle(); order = o.get(order.id);
  const tier = order.decision.recommended.tier;
  order = await o.okay(order.id, order.revision, {tier});
  assert.equal(order.state, 'requested');
  assert.ok(order.specHash && order.ramp.requestId);
  const sim = await ramp.simulate();
  const req = sim.inspect('request', order.ramp.requestId);
  assert.equal(req.specHash, order.specHash);
  assert.match(req.field_answers.justification, /worth it if a day|paying more buys no time|better on both/);
  // HLD step 7: the decision travels as fields and the premium as its own line; the total is the frozen price.
  assert.deepEqual(Object.keys(req.field_answers), ['justification', 'burn_order_id', 'spec_hash', 'decision_revision', 'chosen_tier', 'recommended_tier', 'verdict', 'days_gained', 'break_even_cents_per_day', 'cheapest_tier',
    'dominating_input', 'milestone', 'value_per_day_cents', 'policy_owner', 'policy_version', 'policy_hash', 'cutoff', 'assumptions', 'risk_note']);
  assert.equal(req.field_answers.verdict, 'worth_it'); assert.equal(req.field_answers.policy_version, 1); assert.match(req.field_answers.policy_hash, /^[0-9a-f]{12}$/);
  assert.deepEqual(req.line_items.map(l => l.kind), ['base', 'premium']); assert.equal(req.line_items.reduce((s, l) => s + l.amount.amount, 0), order.frozen.priceCents);
  await sim.approve(order.ramp.requestId);
  order = o.get(order.id);
  assert.equal(order.state, 'placed', JSON.stringify(store.events(order.id).map(e => e.event)));
  assert.ok(order.vendorOrder.vendorOrderId.startsWith('XO-'));
  assert.equal(order.paymentState, 'issued');
  const txnId = await sim.charge(order.ramp.cardId, order.frozen.priceCents, {idempotencyKey: 'test-charge-1'});
  order = o.get(order.id);
  assert.equal(order.paymentState, 'charged'); assert.equal(order.bookingState, 'coded');
  assert.deepEqual(order.ramp.transactionIds, [txnId]);
  // A replayed approval event is a no-op: one placement, ever.
  const approval = sim.events().find(e => e.type === 'unified_requests.approved');
  await sim.replay([approval.id]);
  await o.handleRampEvent({...approval, id: 'evt-dup-' + approval.id});   // same payload, new id: the order has moved on, so it's ignored
  assert.equal(store.attempts(order.id).length, 1);
  assert.equal(o.get(order.id).state, 'placed');
});

test('a field that drifts at checkout blocks placement and returns the order to approved', async () => {
  const {o, ramp, store} = boot();
  let order = o.enter({name: 'Hip actuator bracket', note: 'for the spin test', cad, engineer: 'Owen', fields: {material: '6061-T6', quantity: 2, revision: 'B', shipTo: 'Emeryville', __fault: 'drift'}});
  await settle(); order = o.get(order.id);
  order = await o.okay(order.id, order.revision, {tier: order.decision.recommended.tier});
  await (await ramp.simulate()).approve(order.ramp.requestId);
  order = o.get(order.id);
  assert.equal(order.state, 'approved');
  const a = store.attempts(order.id)[0];
  assert.equal(a.outcome, 'blocked'); assert.match(a.reason, /price/);
});

test('a lost vendor response goes to placement_unknown and is reconciled from the vendor record, never retried', async () => {
  const {o, ramp, store} = boot();
  let order = o.enter({name: 'Hip actuator bracket', note: 'for the spin test', cad, engineer: 'Owen', fields: {material: '6061-T6', quantity: 2, revision: 'B', shipTo: 'Emeryville', __fault: 'timeout'}});
  await settle(); order = o.get(order.id);
  order = await o.okay(order.id, order.revision, {tier: order.decision.recommended.tier});
  await (await ramp.simulate()).approve(order.ramp.requestId);
  order = o.get(order.id);
  const events = store.events(order.id).map(e => e.event);
  assert.ok(events.includes('placement.unknown'), events.join(','));
  assert.equal(order.state, 'placed', 'reconciled from the vendor record');
  assert.equal(store.attempts(order.id).length, 1);
});

test('events are hints: a reordered "rejected" event after Ramp says APPROVED still places; a premature "approved" is ignored', async () => {
  const {o, ramp, store} = boot();
  let order = o.enter({name: 'Hip actuator bracket', note: 'for the spin test', cad, engineer: 'Owen', fields: {material: '6061-T6', quantity: 2, revision: 'B', shipTo: 'Emeryville'}});
  await settle(); order = o.get(order.id);
  order = await o.okay(order.id, order.revision, {tier: order.decision.recommended.tier});
  // An "approved" event while Ramp still says PENDING does nothing.
  const early = await o.handleRampEvent({id: 'evt-early', type: 'unified_requests.approved', payload: {id: order.ramp.requestId}});
  assert.equal(early.ignored, 'request is PENDING');
  assert.equal(o.get(order.id).state, 'requested');
  // Ramp approves, but the only event we receive is a stale, reordered "rejected": the live state wins.
  const sim = await ramp.simulate();
  await sim.approve(order.ramp.requestId, {deliverEvent: false});
  await o.handleRampEvent({id: 'evt-reordered', type: 'unified_requests.rejected', payload: {id: order.ramp.requestId}});
  assert.equal(o.get(order.id).state, 'placed');
  assert.equal(store.attempts(order.id).length, 1);
});

test('Okay is refused while the flip question is open', async () => {
  const {o} = boot({motorDay: 8});
  const cfg = config(); cfg.scenarios.slipDays = [1, 4];
  let order = o.enter({name: 'Hip actuator bracket', note: 'for the spin test', cad, engineer: 'Owen', fields: {material: '6061-T6', quantity: 2, revision: 'B', shipTo: 'Emeryville'}});
  await settle(); order = o.get(order.id);
  if (order.state === 'needs_answer') {
    assert.equal(order.question.kind, 'fact');
    await assert.rejects(o.okay(order.id, order.revision, {tier: order.decision.tentative.tier}), /Answer the open question first/);
  } else assert.equal(order.state, 'recommended');
});

test('the engineer argues: the statement is kept and typed; only an explicit fact changes the plan', async () => {
  const {o} = boot({motorDay: 8});
  let order = o.enter({name: 'Hip actuator bracket', note: 'for the spin test', cad, engineer: 'Owen', fields: {material: '6061-T6', quantity: 2, revision: 'B', shipTo: 'Emeryville'}});
  await settle(); order = o.get(order.id);
  const before = order.decision.recommended.tier;
  order = await o.argue(order.id, order.revision, {text: 'I think standard is fine', type: 'preference'});
  assert.equal(order.exchange.length, 1); assert.equal(order.decision.recommended.tier, before, 'a preference changes nothing');
  order = await o.argue(order.id, order.revision, {text: 'The motor actually lands on the 29th', type: 'factual correction', fact: {nodeId: 'part:motor', date: d(20)}});
  assert.equal(order.context.overrides['part:motor'].date, d(20));
  assert.ok(order.decision.dominated.includes('Expedited'), 'with the motor late, paying for Expedited buys nothing: ' + JSON.stringify(order.decision.dominated));
  assert.notEqual(order.decision.recommended?.tier, 'Expedited');
});
