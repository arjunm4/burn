// Fake Xometry: an in-process vendor with the same behaviour the headless provider has to
// cope with, so the order flow, verification and failure handling can be exercised without
// touching xometry.com. It keeps its own quotes and orders (the "vendor's records"), so
// findOrder() can reconcile a lost response the same way the real one would.
//
// Behaviour knobs (for tests and the demo) are per-call, never global:
//   fields.__fault = 'drift' | 'drop-option' | 'timeout' | 'reject'   on place()
import {createHash, randomUUID} from 'node:crypto';

const DAY = 86400000;
const addDays = (iso, n) => new Date(Date.parse(iso) + n * DAY).toISOString().slice(0, 10);

// Prices scale with quantity and material; tiers are Xometry-like.
const MATERIAL = {'6061-T6': 1, '7075-T651': 1.35, '17-4PH': 1.9, 'PEEK': 2.6};
const TIERS = [
  {tier: 'Economy', mfgDays: 14, shipDays: 3, factor: 0.85},
  {tier: 'Standard', mfgDays: 10, shipDays: 2, factor: 1},
  {tier: 'Expedited', mfgDays: 5, shipDays: 2, factor: 1.3},
  {tier: 'Rush', mfgDays: 3, shipDays: 1, factor: 1.75},
];

export function createFakeVendor({now = () => new Date(), basePriceCents = 300000, receivingDays = 0} = {}) {
  const quotes = new Map();   // quoteId -> {fields, cadHash, options, validUntil, config}
  const orders = new Map();   // vendorOrderId -> {quoteId, specHash, tier, priceCents, placedAt, promisedOn}

  const priceFor = (fields, factor) => {
    const qty = Number(fields.quantity) || 1;
    const mat = MATERIAL[fields.material] ?? 1.2;
    const finish = fields.finish && !/none|as machined/i.test(String(fields.finish)) ? 1.1 : 1;
    // Unit price falls with quantity; the base is for qty 1 of a mid-size part.
    const unit = basePriceCents * mat * finish * Math.pow(qty, -0.25);
    return Math.round(unit * qty * factor);
  };

  return {
    describe: () => ({vendor: 'xometry', mode: 'fake', capabilities: {quote: true, place: true, status: true, teamspaceReuse: true}}),

    async quote({fields, cad}) {
      if (!cad?.hash) throw new Error('CAD file required');
      const t = now();
      const today = t.toISOString().slice(0, 10);
      // Orders placed after 14:00 local start production the next business day.
      const cutoff = new Date(Date.parse(today + 'T14:00:00-08:00')).toISOString();
      const options = TIERS.map(x => ({tier: x.tier, priceCents: priceFor(fields, x.factor), mfgDays: x.mfgDays, shipDays: x.shipDays,
        readyOn: addDays(today, businessDaysToCalendar(x.mfgDays, today) + x.shipDays + receivingDays)}));
      const quoteId = 'Q-' + createHash('sha1').update(cad.hash + JSON.stringify(fields)).digest('hex').slice(0, 8).toUpperCase();
      const config = createHash('sha1').update(JSON.stringify(fields)).digest('hex').slice(0, 6);
      const validUntil = addDays(today, 30);
      quotes.set(quoteId, {fields: {...fields}, cadHash: cad.hash, options, validUntil, config});
      return {vendor: 'xometry', quoteId, configurationRevision: config, capturedAt: t.toISOString(), validUntil, cutoff, completeness: 'complete', options, source: 'fake'};
    },

    // Reads every field back from the "checkout page" (the stored quote) and compares with the spec.
    async place({spec, card, attemptId}) {
      const q = quotes.get(spec.quoteId);
      if (!q) return {outcome: 'failed', reason: 'quote not found'};
      if (!card?.credentialRef) return {outcome: 'blocked', mismatches: [{field: 'payment', expected: 'card', actual: 'none'}]};
      const fault = spec.fields.__fault;
      const page = {...q.fields}; delete page.__fault;
      const option = q.options.find(o => o.tier === spec.tier);
      if (fault === 'drift' && option) option.priceCents = Math.round(option.priceCents * 1.08);
      if (fault === 'drop-option') q.options = q.options.filter(o => o.tier !== spec.tier);

      const mismatches = [];
      for (const [k, v] of Object.entries(spec.fields)) { if (k === '__fault') continue; if (String(page[k]) !== String(v)) mismatches.push({field: k, expected: v, actual: page[k] ?? null}); }
      if (q.cadHash !== spec.cadHash) mismatches.push({field: 'cad', expected: spec.cadHash, actual: q.cadHash});
      const live = q.options.find(o => o.tier === spec.tier);
      if (!live) mismatches.push({field: 'tier', expected: spec.tier, actual: null});
      else if (live.priceCents !== spec.priceCents) mismatches.push({field: 'price', expected: spec.priceCents, actual: live.priceCents});
      if (Date.parse(q.validUntil) < now().getTime()) mismatches.push({field: 'validUntil', expected: 'valid', actual: 'expired'});
      if (mismatches.length) return {outcome: 'blocked', mismatches};

      if (fault === 'reject') return {outcome: 'failed', reason: 'card declined'};
      // The vendor records the order before answering; a 'timeout' loses the answer on the way back.
      const vendorOrderId = 'XO-' + randomUUID().slice(0, 8).toUpperCase();
      const promisedOn = live.readyOn;
      orders.set(vendorOrderId, {quoteId: spec.quoteId, specHash: spec.__specHash || null, tier: spec.tier, priceCents: live.priceCents, placedAt: now().toISOString(), promisedOn, attemptId});
      if (fault === 'timeout') return {outcome: 'unknown', reason: 'no response from vendor after submit'};
      return {outcome: 'succeeded', vendorOrderId, promisedOn, verified: Object.fromEntries(Object.keys(spec.fields).filter(k => k !== '__fault').map(k => [k, true]))};
    },

    async status(vendorOrderId) {
      const o = orders.get(vendorOrderId);
      return o ? {status: 'in_production', promisedOn: o.promisedOn, tracking: null} : {status: 'unknown', promisedOn: null, tracking: null};
    },

    // Reconciliation: does the vendor have an order for this spec since the attempt began?
    async findOrder({specHash, since, attemptId}) {
      // An attempt id is exact; a spec match additionally has to fall inside the attempt's window.
      for (const [id, o] of orders) if ((attemptId && o.attemptId === attemptId) || (specHash && o.specHash === specHash && (!since || o.placedAt >= since))) return {found: true, vendorOrderId: id, promisedOn: o.promisedOn};
      return {found: false};
    },

    _records: {quotes, orders},
  };
}

// Business days → calendar days, counting from the given day (Mon–Fri shop).
function businessDaysToCalendar(n, fromIso) {
  let days = 0, remaining = n; const start = Date.parse(fromIso + 'T00:00:00Z');
  while (remaining > 0) { days++; const w = new Date(start + days * DAY).getUTCDay(); if (w !== 0 && w !== 6) remaining--; }
  return days;
}
