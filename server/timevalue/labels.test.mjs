import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkRampToXometry, usableLinks, tierKey } from './labels.mjs';

const order = (n, total, placed_at, lead_time = 'Standard', extra = {}) => ({
  order_number: n, quote_id: `Q-${n}`, placed_at, placed_by: 'talia@flintlockrobotics.com', requested_by: 'owen@flintlockrobotics.com',
  lead_time, total, line_items: [{ part_number: 'FL-HIP-1042' }, { part_number: 'FL-HIP-1042' }, { part_number: 'FL-KNE-1120' }], ...extra,
});
const charge = (id, amount, at, extra = {}) => ({
  id, amount, user_transaction_time: at, state: 'CLEARED', merchant_name: 'Xometry', merchant_descriptor: 'XOMETRY*ORDER',
  original_transaction_id: null, ...extra,
});
const quote = (n) => ({
  quote_id: `Q-${n}`, lead_time_options: [
    { lead_time: 'Economy', lead_time_business_days: 14, total: 90, estimated_delivery_date: '2026-10-20' },
    { lead_time: 'Standard', lead_time_business_days: 10, total: 100, estimated_delivery_date: '2026-10-14' },
    { lead_time: 'Expedite', lead_time_business_days: 5, total: 180, estimated_delivery_date: '2026-10-07' },
  ],
});

test('links charges to orders by total and time, one-to-one, closest first', () => {
  const xometry = {
    quotes: [quote('XO-1')],
    orders: [
      order('XO-1', 100, '2026-09-29T10:00:00-07:00', 'Expedite'),
      order('XO-2', 100, '2026-09-29T12:00:00-07:00'), // same total, later
      order('XO-3', 250.5, '2026-10-01T09:00:00-07:00', 'Economy'),
      order('XO-4', 77, '2026-10-02T09:00:00-07:00'), // charge too late
    ],
  };
  const ramp = {
    transactions: [
      charge('r-a', 100, '2026-09-29T12:01:00-07:00'), // closest to XO-2
      charge('r-b', 100.01, '2026-09-29T10:00:30-07:00'), // within a cent of XO-1
      charge('r-c', 250.5, '2026-10-02T08:59:00-07:00'), // 23h59 later
      charge('r-d', 77, '2026-10-03T09:00:01-07:00'), // just over a day
      charge('r-e', 55, '2026-10-03T09:00:00-07:00'), // no such total
      charge('r-f', 77, '2026-10-02T09:00:00-07:00', { state: 'DECLINED' }),
      charge('r-g', -100, '2026-09-30T09:00:00-07:00', { original_transaction_id: 'r-a' }),
      { ...charge('r-h', 100, '2026-09-29T10:00:00-07:00'), merchant_name: 'McMaster-Carr', merchant_descriptor: 'MCMASTER-CARR' },
    ],
    bills: [],
  };
  const links = linkRampToXometry({ ramp, xometry });
  assert.deepEqual(links.map((l) => [l.order_number, l.ramp_id]), [['XO-1', 'r-b'], ['XO-2', 'r-a'], ['XO-3', 'r-c']]);
  const l1 = links[0];
  assert.equal(l1.tier, 'expedite');
  assert.equal(l1.T, '2026-09-29T10:00:00-07:00');
  assert.equal(l1.requester_email, 'owen@flintlockrobotics.com');
  assert.equal(l1.placer_email, 'talia@flintlockrobotics.com');
  assert.deepEqual(l1.part_numbers, ['FL-HIP-1042', 'FL-KNE-1120']);
  assert.deepEqual(l1.tiers[2], { tier: 'expedite', total: 180, lead_days: 5, est_delivery: '2026-10-07' });
  assert.deepEqual(links[1].tiers, []); // no quote on file
  assert.deepEqual(links.unlinked.map((u) => [u.ramp_id, u.reason]), [
    ['r-e', 'no order with this total'],
    ['r-d', 'no order with this total placed within 1 day'],
  ]);
  assert.deepEqual(links.orders_unlinked, ['XO-4']);
  assert.deepEqual(links.summary, { charges: 5, linked: 3, unlinked: 2, link_rate: 0.6, orders: 4, orders_linked: 3, order_link_rate: 0.75 });
  assert.equal(Object.keys(links).length, 3); // extras are non-enumerable
});

test('usable = linked and T at or after text start + 30 days', () => {
  const links = [{ T: '2026-09-09T23:59:59-07:00' }, { T: '2026-09-10T00:00:00-07:00' }, { T: '2026-11-09T10:00:00-08:00' }];
  assert.equal(usableLinks(links).length, 2);
  assert.equal(usableLinks(links, '2026-11-01T00:00:00-07:00').length, 1);
});

test('tierKey', () => {
  assert.equal(tierKey('International Economy'), 'international_economy');
  assert.equal(tierKey('Expedite'), 'expedite');
});

test('empty input', () => {
  const links = linkRampToXometry({ ramp: {}, xometry: {} });
  assert.deepEqual([...links], []);
  assert.equal(links.summary.link_rate, null);
});
