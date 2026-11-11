import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createNotifier, messagesFor} from './index.js';

// A frozen order the way the orchestrator publishes it: real numbers, nothing invented here.
const order = (over = {}) => ({id: 'o1', revision: 7, state: 'requested', entry: {name: 'Hip actuator bracket', note: 'for the spin test', engineer: 'Owen'},
  quote: {cutoff: '2026-11-17T22:00:00.000Z', options: [{tier: 'Standard', priceCents: 300000, readyOn: '2026-11-24'}, {tier: 'Expedited', priceCents: 390000, readyOn: '2026-11-17'}]},
  decision: {recommended: {tier: 'Expedited', basis: 'policy'}, text: 'Expedited gets Spin test done 2 days sooner for +$900: worth it if a day is worth more than $450.',
    options: [{tier: 'Standard', admissible: true}, {tier: 'Expedited', admissible: true}]},
  frozen: {tier: 'Expedited', priceCents: 390000}, ramp: {cardLast4: '4242'}, vendorOrder: {vendorOrderId: 'XO-1', promisedOn: '2026-11-17'}, context: {milestoneLabel: 'Spin test'}, question: null, ...over});
const boot = (config = {}) => { const bus = new EventEmitter(); const n = createNotifier({bus, filename: ':memory:', config}); return {bus, n}; };

test('a recommendation becomes one quote message to the engineer, with the real tiers and the break-even', () => {
  const {bus, n} = boot();
  bus.emit('order', {type: 'recommended', orderId: 'o1', order: order({state: 'recommended'})});
  const [m] = n.list({to: 'Owen'});
  assert.equal(m.kind, 'quote');
  assert.match(m.text, /^Quote ready for Hip actuator bracket: Standard \$3,000 ready Nov 24 vs Expedited \$3,900 ready Nov 17\. Recommendation: Expedited gets Spin test done 2 days sooner.*\$450/);
  assert.equal(n.list({to: 'manager'}).length, 0);
});

test('approval goes to the manager with the cutoff; approval and booking come back to the engineer', () => {
  const {bus, n} = boot({company: {manager: 'Ingrid', timeZone: 'America/Los_Angeles'}});
  const o = order();
  bus.emit('order', {type: 'ramp.requested', orderId: 'o1', order: o});
  bus.emit('order', {type: 'ramp.approved', orderId: 'o1', order: {...o, revision: 8, state: 'approved'}});
  bus.emit('order', {type: 'placement.notice', orderId: 'o1', order: {...o, revision: 8}, text: 'Placing your Xometry order now (Expedited, $3,900).'});
  bus.emit('order', {type: 'placement.succeeded', orderId: 'o1', order: {...o, revision: 9, state: 'placed'}});
  bus.emit('order', {type: 'charge.cleared', orderId: 'o1', order: {...o, revision: 10}});
  bus.emit('order', {type: 'booked', orderId: 'o1', order: {...o, revision: 11}});
  const manager = n.list({to: 'Ingrid'});
  assert.equal(manager[0].kind, 'approval');
  assert.match(manager[0].text, /^Approval needed: Owen's Xometry order \$3,900 \(Hip actuator bracket, Expedited\)\. Expedited gets .* Approve by 2:00 PM PST to start production today\.$/);
  const owen = n.list({to: 'Owen'}).map(m => m.text);
  assert.match(owen[1], /^Ingrid approved your Xometry order \(Hip actuator bracket, \$3,900\)\. Placing now\.$/);
  assert.equal(owen[2], 'Placing your Xometry order now (Expedited, $3,900).');
  assert.equal(owen[3], 'Placed. Xometry order XO-1, ready Nov 17.');
  assert.match(owen[4], /^Charged \$3,900 on the Xometry card •••• 4242/);
  assert.match(owen[5], /Receipt, memo and project code \(Spin test\) attached/);
  assert.deepEqual(n.recipients(), ['Ingrid', 'Owen']);
});

test('questions go to whoever owns the fact; stops before buying say why', () => {
  const {bus, n} = boot();
  bus.emit('order', {type: 'question', orderId: 'o1', order: order({state: 'needs_answer'}), question: {kind: 'fact', owner: 'Arjun', text: 'Motor magnets: when do they land?'}});
  bus.emit('order', {type: 'question', orderId: 'o1', order: order({state: 'needs_answer', revision: 8}), question: {kind: 'spec', text: 'Confirm: Material, Quantity.'}});
  bus.emit('order', {type: 'placement.blocked', orderId: 'o1', order: order({revision: 9}), result: {outcome: 'blocked', mismatches: [{field: 'price', expected: 390000, actual: 400000}]}});
  assert.match(n.list({to: 'Arjun'})[0].text, /^Hip actuator bracket: Motor magnets: when do they land\? \(asked for Owen's order/);
  const owen = n.list({to: 'Owen'}).map(m => m.text);
  assert.equal(owen[0], 'Hip actuator bracket: Confirm: Material, Quantity.');
  assert.match(owen[1], /^Stopped before buying: price changed \(expected 390000, got 400000\)\. Nothing was ordered\.$/);
});

test('replays are idempotent: the same event twice is one message; a new revision is a new message', () => {
  const {bus, n} = boot();
  const seen = []; n.subscribe(m => seen.push(m.id));
  const e = {type: 'ramp.requested', orderId: 'o1', order: order()};
  bus.emit('order', e); bus.emit('order', e); bus.emit('order', structuredClone(e));
  assert.equal(n.list({}).length, 2, 'manager + engineer, once each');
  assert.equal(seen.length, 2, 'subscribers hear each message once');
  bus.emit('order', {...e, order: order({revision: 12})});
  assert.equal(n.list({}).length, 4);
  assert.equal(n.list({limit: 1}).length, 1);
  n.close();
  bus.emit('order', e);   // closed: no listener, no throw
});

test('events without a message produce nothing', () => {
  assert.deepEqual(messagesFor({type: 'context.built', order: order()}), []);
  assert.deepEqual(messagesFor({type: 'ramp.requested'}), []);
});
