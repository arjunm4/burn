import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createOrchestrator} from '../flow/orchestrator.js';
import {createOrderStore} from '../orders/store.js';
import {createRampClient} from '../ramp/index.js';
import {createVendorProvider} from '../vendors/index.js';
import {loadConfig} from '../config.js';
import {rampRoutes} from './ramp.js';
import {notificationsRoutes} from './notifications.js';
import {createNotifier} from '../notify/index.js';

// The same tiny world as orchestrator.test.js: a dated milestone a few weeks out.
const ORDER = '2026-12-07';
const d = n => new Date(Date.parse(ORDER + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const world = {
  listDocuments: () => [{id: 's1', source: 'slack', channel: '#actuator', author: 'Arjun', at: '2026-12-04T18:00:00Z', text: `Motor magnets land ${d(8)}; the spin test needs the hip actuator bracket and the motor and takes 3 days.`}],
  latestGraph: () => ({graph: {nodes: [
    {id: 'part:motor', kind: 'part', label: 'Motor', attrs: {date: d(8), evidence: 's1'}}, {id: 'work:spin-test', kind: 'work', label: 'Spin test', attrs: {durationDays: 3, evidence: 's1'}},
    {id: 'milestone:spin', kind: 'milestone', label: 'Spin test done', attrs: {date: d(11), evidence: 's1'}}],
    edges: [{id: 'e2', from: 'part:motor', to: 'work:spin-test', kind: 'blocks', evidence: ['s1']}, {id: 'e3', from: 'work:spin-test', to: 'milestone:spin', kind: 'due', evidence: ['s1']}]}, evidence: {s1: {id: 's1', at: '2026-12-04T18:00:00Z', author: 'Arjun'}}}),
};
const settle = () => new Promise(r => setTimeout(r, 30));
function boot() {
  const store = createOrderStore({filename: ':memory:'}), ramp = createRampClient({mode: 'mock', filename: ':memory:'});
  const vendor = createVendorProvider({mode: 'fake', now: () => new Date(ORDER + 'T17:00:00Z'), basePriceCents: 300000});
  const config = {...loadConfig(), company: {name: 'Demo', currency: 'USD', timeZone: 'America/Los_Angeles', manager: 'Ingrid'}, milestones: {'milestone:spin': {valuePerDayCents: 60000, owner: 'Arjun'}}, scenarios: {slipDays: [1, 4]}};
  const o = createOrchestrator({store, vendor, ramp, ingest: world, config, now: () => ORDER + 'T17:00:00Z'});
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
  assert.match(live[0].text, /^Approval needed: Owen's Xometry order \$[\d,]+ \(Hip actuator bracket, \w+\)\./);
  stream.req.emit('close');
});
