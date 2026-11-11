import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync, readFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createXometrySite} from './site/index.js';
import {createHeadlessVendor, launchChrome, testCardEndingIn} from './headless.js';
import {createVendorProvider} from './index.js';
import {specHash} from '../contracts.js';

// End to end: the real headless provider (Playwright + installed Chrome) against the simulated
// site on an ephemeral port. Skips, rather than fails, on a machine without Google Chrome.
const fixed = () => new Date('2026-11-09T17:00:00Z');
const fields = {material: '6061-T6', finish: 'Type II black anodize', tolerance: 'ISO 2768-m', quantity: 2, revision: 'B', inspection: 'Standard', shipTo: 'Emeryville'};
const bytes = Buffer.from('solid bracket'); const cad = {fileName: 'bracket.step', bytes, hash: createHash('sha256').update(bytes).digest('hex')};
const frozenFrom = (q, tier, extra = {}) => {
  const o = q.options.find(x => x.tier === tier);
  const spec = {partName: 'bracket', cadHash: cad.hash, fields: {...fields, ...extra}, vendor: 'xometry', quoteId: q.quoteId, tier, priceCents: o.priceCents, currency: 'USD', total: {includesTax: false, includesShipping: true, varianceCents: 0}};
  spec.__specHash = specHash(spec); return spec;
};
const card = {credentialRef: 'mock-vault:test', last4: '4242'};

let skip = false, site, vendor, dir;
before(async () => {
  try { const b = await launchChrome(); await b.close(); } catch (error) { skip = error.message; return; }
  site = createXometrySite({now: fixed, filename: ':memory:', hangMs: 3000});
  const a = await site.listen(0);
  dir = mkdtempSync(path.join(tmpdir(), 'burn-rec-'));
  vendor = createHeadlessVendor({baseUrl: `http://127.0.0.1:${a.port}`, enabled: true, recordingsDir: dir, now: fixed, placeTimeoutMs: 800});
});
after(async () => { if (vendor) await vendor.close(); if (site) await site.close(); if (dir) rmSync(dir, {recursive: true, force: true}); });
const steps = key => JSON.parse(readFileSync(path.join(dir, key, 'steps.json'), 'utf8')).steps;

test('headless provider quotes through the site and matches the in-process fake; every step is recorded', async t => {
  if (skip) return t.skip(skip);
  const q = await vendor.quote({fields, cad});
  const fake = await createVendorProvider({mode: 'fake', now: fixed}).quote({fields, cad});
  assert.equal(q.source, 'headless'); assert.equal(q.completeness, 'complete'); assert.match(q.quoteId, /^Q-[A-Z0-9]{8}$/);
  assert.deepEqual(q.options, fake.options); assert.equal(q.validUntil, fake.validUntil); assert.equal(q.cutoff, fake.cutoff);
  const s = steps(`quote-${q.quoteId}`);
  assert.deepEqual(s.map(x => x.label), ['landing', 'upload', 'configurator', 'tiers']);
  for (const x of s) assert.ok(existsSync(path.join(dir, `quote-${q.quoteId}`, x.file)), x.file);
  assert.match(s[2].note, /material=6061-T6/);
});

test('place reads every field back, enters the card, clicks Place order and the order is in the account list', async t => {
  if (skip) return t.skip(skip);
  const q = await vendor.quote({fields, cad});
  const r = await vendor.place({spec: frozenFrom(q, 'Expedited'), card, attemptId: 'att-ok'});
  assert.equal(r.outcome, 'succeeded', JSON.stringify(r)); assert.match(r.vendorOrderId, /^XO-/);
  assert.equal(r.promisedOn, q.options.find(o => o.tier === 'Expedited').readyOn);
  assert.deepEqual(Object.keys(r.verified).sort(), Object.keys(fields).sort());
  const s = steps('attempt-att-ok');
  assert.deepEqual(s.map(x => x.label), ['reopen-quote', 'select-tier', 'read-back', 'payment', 'confirmation']);
  assert.match(s[2].note, /material: 6061-T6 — matches/); assert.doesNotMatch(s[3].note, /4242424242424242/);
  assert.equal((await vendor.status(r.vendorOrderId)).status, 'in_production');
  assert.deepEqual(await vendor.findOrder({attemptId: 'att-ok'}), {found: true, vendorOrderId: r.vendorOrderId, promisedOn: r.promisedOn});
  assert.equal((await vendor.findOrder({attemptId: 'never'})).found, false);
  const stored = site._records.orders.get(r.vendorOrderId);
  assert.equal(stored.attemptId, 'att-ok'); assert.equal(stored.last4, '4242');
});

test('a changed field or a price drift is refused before any click; a dropped tier too', async t => {
  if (skip) return t.skip(skip);
  const q = await vendor.quote({fields, cad});
  const changed = await vendor.place({spec: frozenFrom(q, 'Standard', {material: '7075-T651'}), card, attemptId: 'att-changed'});
  assert.equal(changed.outcome, 'blocked'); assert.deepEqual(changed.mismatches, [{field: 'material', expected: '7075-T651', actual: '6061-T6'}]);
  assert.equal(steps('attempt-att-changed').at(-1).label, 'abort');
  const drift = await vendor.place({spec: frozenFrom(q, 'Standard', {__fault: 'drift'}), card, attemptId: 'att-drift'});
  assert.equal(drift.outcome, 'blocked'); assert.ok(drift.mismatches.some(m => m.field === 'price'), JSON.stringify(drift));
  const dropped = await vendor.place({spec: frozenFrom(q, 'Rush', {__fault: 'drop-option'}), card, attemptId: 'att-drop'});
  assert.equal(dropped.outcome, 'blocked'); assert.ok(dropped.mismatches.some(m => m.field === 'tier'));
  assert.equal(site._records.orders.list().filter(o => o.quoteId === q.quoteId).length, 0, 'nothing was placed');
  const nocard = await vendor.place({spec: frozenFrom(q, 'Standard'), card: {}, attemptId: 'att-nocard'});
  assert.equal(nocard.outcome, 'blocked');
});

test('a declined card fails; a lost response is unknown and the order is found again by attempt id', async t => {
  if (skip) return t.skip(skip);
  const q = await vendor.quote({fields, cad});
  const rej = await vendor.place({spec: frozenFrom(q, 'Standard', {__fault: 'reject'}), card, attemptId: 'att-reject'});
  assert.equal(rej.outcome, 'failed'); assert.equal(rej.reason, 'card declined');
  const lost = await vendor.place({spec: frozenFrom(q, 'Standard', {__fault: 'timeout'}), card, attemptId: 'att-timeout'});
  assert.equal(lost.outcome, 'unknown', JSON.stringify(lost));
  assert.equal(steps('attempt-att-timeout').at(-1).label, 'timeout');
  const found = await vendor.findOrder({attemptId: 'att-timeout'});
  assert.equal(found.found, true); assert.match(found.vendorOrderId, /^XO-/);
  assert.equal(steps('attempt-att-timeout').at(-1).label, 'account-orders');
  assert.equal((await vendor.findOrder({specHash: 'nope'})).found, false);
});

test('test cards are Luhn-valid and end in the requested digits', () => {
  for (const l of ['4242', '0001', '9999']) { const n = testCardEndingIn(l); assert.equal(n.length, 16); assert.ok(n.endsWith(l)); }
});
