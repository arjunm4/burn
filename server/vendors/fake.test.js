import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createVendorProvider} from './index.js';
import {specHash} from '../contracts.js';

const cad = {fileName: 'bracket.step', bytes: Buffer.from('solid'), hash: 'cad-abc'};
const fields = {material: '6061-T6', finish: 'Type II black anodize', tolerance: 'ISO 2768-m', quantity: 2, revision: 'B', inspection: 'standard', shipTo: 'Emeryville'};
const fixed = () => new Date('2026-11-09T17:00:00Z');
const frozenFrom = (q, tier, extra = {}) => {
  const o = q.options.find(x => x.tier === tier);
  const spec = {partName: 'bracket', cadHash: cad.hash, fields: {...fields, ...extra}, vendor: 'xometry', quoteId: q.quoteId, tier, priceCents: o.priceCents, currency: 'USD', total: {includesTax: false, includesShipping: true, varianceCents: 0}};
  spec.__specHash = specHash(spec);
  return spec;
};

test('fake vendor quotes four tiers, cheaper-slower to dearer-faster, with cutoff and 30-day validity', async () => {
  const v = createVendorProvider({mode: 'fake', now: fixed});
  const q = await v.quote({fields, cad});
  assert.equal(q.options.length, 4);
  assert.equal(q.completeness, 'complete');
  for (let i = 1; i < q.options.length; i++) {
    assert.ok(q.options[i].priceCents > q.options[i - 1].priceCents);
    assert.ok(q.options[i].readyOn < q.options[i - 1].readyOn);
  }
  assert.equal(q.validUntil, '2026-12-09');
  assert.ok(q.cutoff.startsWith('2026-11-09T22:00'));
  assert.ok((await createVendorProvider({mode: 'fake', now: () => new Date('2026-11-09T23:30:00Z')}).quote({fields, cad})).cutoff.startsWith('2026-11-10T22:00'), 'after the cutoff, the next cutoff is quoted');
  // Quoting after the cutoff pushes every tier out by a business day.
  const late = createVendorProvider({mode: 'fake', now: () => new Date('2026-11-09T23:30:00Z')});
  const lq = await late.quote({fields, cad});
  assert.ok(lq.options[1].readyOn > q.options[1].readyOn);
  // Same fields + CAD -> same quote id; a changed field -> a new configuration.
  assert.equal((await v.quote({fields, cad})).quoteId, q.quoteId);
  assert.notEqual((await v.quote({fields: {...fields, quantity: 5}, cad})).configurationRevision, q.configurationRevision);
});

test('place verifies every field and succeeds only on an exact match', async () => {
  const v = createVendorProvider({mode: 'fake', now: fixed});
  const q = await v.quote({fields, cad});
  const ok = await v.place({spec: frozenFrom(q, 'Expedited'), card: {credentialRef: 'ref-1'}, attemptId: 'a1'});
  assert.equal(ok.outcome, 'succeeded');
  assert.ok(ok.vendorOrderId.startsWith('XO-'));
  assert.equal(Object.values(ok.verified).every(Boolean), true);
  assert.equal((await v.status(ok.vendorOrderId)).status, 'in_production');
});

test('mismatches block placement: a changed field, a price drift, a dropped tier, no card', async () => {
  const v = createVendorProvider({mode: 'fake', now: fixed});
  const q = await v.quote({fields, cad});
  const changed = await v.place({spec: frozenFrom(q, 'Standard', {material: '7075-T651'}), card: {credentialRef: 'r'}, attemptId: 'a'});
  assert.equal(changed.outcome, 'blocked'); assert.equal(changed.mismatches[0].field, 'material');
  const drift = await v.place({spec: frozenFrom(q, 'Standard', {__fault: 'drift'}), card: {credentialRef: 'r'}, attemptId: 'b'});
  assert.equal(drift.outcome, 'blocked'); assert.ok(drift.mismatches.some(m => m.field === 'price'));
  const q2 = await v.quote({fields: {...fields, quantity: 3}, cad});
  const dropped = await v.place({spec: frozenFrom(q2, 'Rush', {quantity: 3, __fault: 'drop-option'}), card: {credentialRef: 'r'}, attemptId: 'c'});
  assert.equal(dropped.outcome, 'blocked'); assert.ok(dropped.mismatches.some(m => m.field === 'tier'));
  const nocard = await v.place({spec: frozenFrom(q, 'Standard'), card: {}, attemptId: 'd'});
  assert.equal(nocard.outcome, 'blocked');
});

test('a lost response is reported as unknown, and the order can be found again for reconciliation', async () => {
  const v = createVendorProvider({mode: 'fake', now: fixed});
  const q = await v.quote({fields, cad});
  const spec = frozenFrom(q, 'Standard', {__fault: 'timeout'});
  const r = await v.place({spec, card: {credentialRef: 'r'}, attemptId: 'att-9'});
  assert.equal(r.outcome, 'unknown');
  const found = await v.findOrder({attemptId: 'att-9'});
  assert.equal(found.found, true);
  assert.equal((await v.findOrder({attemptId: 'never'})).found, false);
  // Another attempt with the same spec is a different order: an explicit attempt id never matches it.
  assert.equal((await v.findOrder({attemptId: 'att-10', specHash: spec.__specHash})).found, false);
  assert.equal((await v.findOrder({specHash: spec.__specHash})).found, true, 'spec-only lookups still work for reconciliation');
});

test('headless provider reports itself disabled and never pretends to place', async () => {
  const v = createVendorProvider({mode: 'headless', credentials: {}});
  assert.equal(v.describe().capabilities.place, false);
  assert.equal((await v.place({})).outcome, 'failed');
  await assert.rejects(v.quote({}), /not enabled/);
});
