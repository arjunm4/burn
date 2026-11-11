import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createOrchestrator} from '../flow/orchestrator.js';
import {createOrderStore} from '../orders/store.js';
import {createRampClient} from '../ramp/index.js';
import {createVendorProvider} from '../vendors/index.js';
import {loadConfig, policyHash} from '../config.js';
import {rampRoutes} from './ramp.js';
import {notificationsRoutes} from './notifications.js';
import {createNotifier} from '../notify/index.js';

// The same tiny world as orchestrator.test.js: a dated milestone a few weeks out. `motorDay` moves the sibling input.
const ORDER = '2026-12-07';
const d = n => new Date(Date.parse(ORDER + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const world = (motorDay = 8) => ({
  listDocuments: () => [{id: 's1', source: 'slack', channel: '#actuator', author: 'Arjun', at: '2026-12-04T18:00:00Z', text: `Motor magnets land ${d(motorDay)}; the spin test needs the hip actuator bracket and the motor and takes 3 days.`}],
  latestGraph: () => ({graph: {nodes: [
    {id: 'part:motor', kind: 'part', label: 'Motor', attrs: {date: d(motorDay), evidence: 's1'}}, {id: 'work:spin-test', kind: 'work', label: 'Spin test', attrs: {durationDays: 3, evidence: 's1'}},
    {id: 'milestone:spin', kind: 'milestone', label: 'Spin test done', attrs: {date: d(11), evidence: 's1'}}],
    edges: [{id: 'e2', from: 'part:motor', to: 'work:spin-test', kind: 'blocks', evidence: ['s1']}, {id: 'e3', from: 'work:spin-test', to: 'milestone:spin', kind: 'due', evidence: ['s1']}]}, evidence: {s1: {id: 's1', at: '2026-12-04T18:00:00Z', author: 'Arjun'}}}),
});
const POLICY = {valuePerDayCents: 60000, owner: 'Arjun'};
const settle = () => new Promise(r => setTimeout(r, 30));
function boot({motorDay = 8} = {}) {
  const store = createOrderStore({filename: ':memory:'}), ramp = createRampClient({mode: 'mock', filename: ':memory:'});
  const vendor = createVendorProvider({mode: 'fake', now: () => new Date(ORDER + 'T17:00:00Z'), basePriceCents: 300000});
  const config = {...loadConfig(), company: {name: 'Demo', currency: 'USD', timeZone: 'America/Los_Angeles', manager: 'Ingrid'}, milestones: {'milestone:spin': POLICY}, scenarios: {slipDays: [1, 4]}};
  const o = createOrchestrator({store, vendor, ramp, ingest: world(motorDay), config, now: () => ORDER + 'T17:00:00Z'});
  const notifier = createNotifier({bus: o.bus, filename: ':memory:', config});
  return {o, ramp, store, notifier, handle: rampRoutes({ramp, orchestrator: o}), notify: notificationsRoutes({notifier})};
}
// Drive a handler the way server/index.js does, with a fake req/res; SSE writes are collected.
async function call(handle, path, method = 'GET') {
  const out = {status: null, body: null, writes: [], headers: null}; const req = Object.assign(new EventEmitter(), {method, url: path, headers: {}});
  const res = {destroyed: false, writeHead: (s, h) => { out.status = s; out.headers = h; }, write: line => out.writes.push(line), end() {}};
  const handled = await handle(req, res, new URL(path, 'http://x').pathname, (v, s = 200) => { out.status = s; out.body = v; });
  return {handled, ...out, req, res};
}

test('the Ramp view: requests, cards and transactions follow a full okay → approve → charge flow, joined to the order and free of secrets', async () => {
  const {o, ramp, handle} = boot();
  let order = o.enter({name: 'Hip actuator bracket', note: 'for the spin test', cad: {fileName: 'bracket.step', bytes: Buffer.from('solid bracket')}, engineer: 'Owen', fields: {material: '6061-T6', quantity: 2, revision: 'B', shipTo: 'Emeryville'}});
  await settle(); order = o.get(order.id);
  assert.deepEqual((await call(handle, '/api/ramp/requests')).body, {requests: []});
  order = await o.okay(order.id, order.revision, {tier: order.decision.recommended.tier});

  // Inbox: one pending request carrying the justification, cutoff and the frozen order.
  let {body} = await call(handle, '/api/ramp/requests');
  assert.equal(body.requests.length, 1);
  const r = body.requests[0];
  assert.equal(r.status, 'PENDING'); assert.equal(r.orderId, order.id); assert.equal(r.requester, 'Owen'); assert.equal(r.vendor, 'xometry');
  assert.equal(r.amountCents, order.frozen.priceCents); assert.equal(r.specHash, order.specHash); assert.equal(r.decisionRevision, order.decisionRevision);
  assert.match(r.justification, /Vendor cutoff: approve by/); assert.equal(r.cutoff, order.quote.cutoff);
  // The decision as structured data: two lines (cheapest valid tier + premium) that sum to the total, and a verdict rules can route on.
  const chosen = order.decision.options.find(x => x.tier === order.frozen.tier), cheapest = order.quote.options.find(x => x.tier === 'Economy');
  assert.deepEqual(r.lineItems, [{description: 'Hip actuator bracket, Economy (cheapest valid lead time)', amountCents: cheapest.priceCents, kind: 'base'},
    {description: `Expedite premium: ${order.frozen.tier} over Economy, ${chosen.deltaDays} working days sooner`, amountCents: order.frozen.priceCents - cheapest.priceCents, kind: 'premium'}]);
  assert.deepEqual(r.verdict, {verdict: 'worth_it', daysGained: chosen.deltaDays, breakEvenCentsPerDay: chosen.breakEvenCentsPerDay, cheapestTier: 'Economy', chosenTier: order.frozen.tier, recommendedTier: order.frozen.tier,
    dominatingInput: null, milestone: 'Spin test done', policy: {valuePerDayCents: 60000, owner: 'Arjun', version: 1, hash: policyHash('milestone:spin', POLICY)}, cutoff: order.quote.cutoff, assumptions: order.decision.assumptions});
  assert.ok(chosen.deltaDays > 0 && chosen.breakEvenCentsPerDay > 0);
  assert.match(r.verdict.policy.hash, /^[0-9a-f]{12}$/); assert.notEqual(r.verdict.policy.hash, policyHash('milestone:spin', {...POLICY, version: 2}), 'a new policy version is a new hash');
  assert.deepEqual(Object.keys(r.order.entry), ['name', 'note', 'engineer']);
  assert.equal(r.order.frozen.tier, order.frozen.tier); assert.ok(r.order.frozen.readyOn);
  assert.ok(!JSON.stringify(body).includes('credentialRef') && !JSON.stringify(body).includes('"bytes"'));

  // Stream: a connected approver hears the approval and the card.
  const stream = await call(handle, '/api/ramp/stream');
  assert.equal(stream.status, 200); assert.match(stream.headers['Content-Type'], /event-stream/);
  await (await ramp.simulate()).approve(order.ramp.requestId);
  order = o.get(order.id); assert.equal(order.state, 'placed');
  const causes = stream.writes.filter(w => w.startsWith('event:')).map(w => JSON.parse(w.split('data: ')[1]).cause);
  assert.ok(causes.includes('ramp.approved') && causes.includes('card.issued') && causes.includes('placement.succeeded'), causes.join(','));
  stream.req.emit('close');

  ({body} = await call(handle, '/api/ramp/requests'));
  assert.equal(body.requests[0].status, 'APPROVED'); assert.ok(body.requests[0].approvedAt); assert.equal(body.requests[0].order.state, 'placed');
  ({body} = await call(handle, '/api/ramp/cards'));
  assert.equal(body.cards.length, 1);
  const c = body.cards[0];
  assert.deepEqual({last4: c.last4, limitCents: c.limitCents, spentCents: c.spentCents, allowedVendors: c.allowedVendors, state: c.state, orderId: c.orderId}, {last4: '4242', limitCents: order.frozen.priceCents, spentCents: 0, allowedVendors: ['Xometry'], state: 'active', orderId: order.id});
  assert.equal(c.lockDate, order.quote.validUntil); assert.ok(!('credentialRef' in c));
  assert.deepEqual((await call(handle, '/api/ramp/transactions')).body, {transactions: []});

  // Xometry charges the card: the transaction appears with its booking.
  await (await ramp.simulate()).charge(order.ramp.cardId, order.frozen.priceCents, {idempotencyKey: 'ui:test'});
  ({body} = await call(handle, '/api/ramp/transactions'));
  assert.equal(body.transactions.length, 1);
  const t = body.transactions[0];
  assert.equal(t.amountCents, order.frozen.priceCents); assert.equal(t.merchant, 'xometry'); assert.equal(t.status, 'CLEARED'); assert.equal(t.cardId, order.ramp.cardId); assert.ok(t.at);
  assert.match(t.booking.memo, /Hip actuator bracket/); assert.match(t.booking.receipt.fileName, /^xometry-XO-/); assert.equal(t.booking.coding.burn_order_id, order.id);
  assert.ok(!('bytes' in t.booking.receipt));
  assert.equal((await call(handle, '/api/ramp/cards')).body.cards[0].state, 'spent');
  assert.equal((await call(handle, '/api/ramp/requests', 'POST')).handled, false, 'read-only');
});

test('the cheapest tier is one base line: overridden when Burn recommended faster, dominated when another input gates the milestone', async () => {
  const enter = o => o.enter({name: 'Hip actuator bracket', note: 'for the spin test', cad: {fileName: 'bracket.step', bytes: Buffer.from('solid bracket')}, engineer: 'Owen', fields: {material: '6061-T6', quantity: 2, revision: 'B', shipTo: 'Emeryville'}});
  // The engineer picks Economy against an Expedited recommendation.
  let {o, handle} = boot();
  let order = enter(o); await settle(); order = o.get(order.id);
  assert.notEqual(order.decision.recommended.tier, 'Economy');
  order = await o.okay(order.id, order.revision, {tier: 'Economy'});
  let r = (await call(handle, '/api/ramp/requests')).body.requests[0];
  assert.deepEqual(r.lineItems.map(l => l.kind), ['base']); assert.equal(r.amountCents, order.frozen.priceCents);
  assert.equal(r.verdict.verdict, 'overridden'); assert.equal(r.verdict.recommendedTier, order.decision.recommended.tier); assert.equal(r.verdict.chosenTier, 'Economy'); assert.equal(r.verdict.dominatingInput, null);
  // The motor lands so late that every faster tier finishes the spin test on the same day: Economy by dominance, and the motor is named.
  ({o, handle} = boot({motorDay: 40}));
  order = enter(o); await settle(); order = o.get(order.id);
  assert.deepEqual(order.decision.recommended, {tier: 'Economy', basis: 'dominance'});
  order = await o.okay(order.id, order.revision, {tier: 'Economy'});
  r = (await call(handle, '/api/ramp/requests')).body.requests[0];
  assert.deepEqual(r.lineItems.map(l => l.kind), ['base']);
  assert.deepEqual({verdict: r.verdict.verdict, daysGained: r.verdict.daysGained, breakEvenCentsPerDay: r.verdict.breakEvenCentsPerDay, dominatingInput: r.verdict.dominatingInput, version: r.verdict.policy.version},
    {verdict: 'dominated', daysGained: 0, breakEvenCentsPerDay: null, dominatingInput: 'Motor', version: 1});
});

test('outside mock mode the Ramp view is a 404, like the simulate routes', async () => {
  const ramp = createRampClient({mode: 'sandbox'});
  const handle = rampRoutes({ramp, orchestrator: {bus: new EventEmitter(), get: () => null}});
  await assert.rejects(call(handle, '/api/ramp/requests'), /only available in mock mode/);
});

test('notifications: the engineer and the manager each see their side of the same flow, live and by list', async () => {
  const {o, ramp, notify} = boot();
  const stream = await call(notify, '/api/notifications/stream?to=Ingrid');
  let order = o.enter({name: 'Hip actuator bracket', note: 'for the spin test', cad: {fileName: 'bracket.step', bytes: Buffer.from('solid bracket')}, engineer: 'Owen', fields: {material: '6061-T6', quantity: 2, revision: 'B', shipTo: 'Emeryville'}});
  await settle(); order = o.get(order.id);
  order = await o.okay(order.id, order.revision, {tier: order.decision.recommended.tier});
  await (await ramp.simulate()).approve(order.ramp.requestId);
  await (await ramp.simulate()).charge(o.get(order.id).ramp.cardId, order.frozen.priceCents, {idempotencyKey: 'ui:test'});
  const owen = (await call(notify, '/api/notifications?to=Owen')).body;
  assert.deepEqual(owen.recipients.sort(), ['Ingrid', 'Owen']);
  assert.deepEqual(owen.notifications.map(n => n.kind), ['quote', 'status', 'approved', 'placement', 'placed', 'charge', 'booked']);
  assert.ok(owen.notifications.every(n => n.to === 'Owen' && n.orderId === order.id));
  const ingrid = (await call(notify, '/api/notifications?to=Ingrid&limit=1')).body.notifications;
  assert.equal(ingrid.length, 1); assert.equal(ingrid[0].kind, 'booked');
  const live = stream.writes.filter(w => w.startsWith('event:')).map(w => JSON.parse(w.split('data: ')[1]));
  assert.deepEqual(live.map(n => n.kind), ['approval', 'booked']); assert.ok(live.every(n => n.to === 'Ingrid'));
  assert.match(live[0].text, /^Approval needed: Owen's Xometry order — \$[\d,]+ base \+ \$[\d,]+ expedite premium \(\d+ working days sooner, break-even \$\d+\/day vs policy \$600\/day, Arjun v1\)\. Approve by 2:00 PM PT\.$/);
  stream.req.emit('close');
});
