// Fake Xometry: an in-process vendor with the same behaviour the headless provider has to
// cope with, so the order flow, verification and failure handling can be exercised without
// touching xometry.com. It keeps its own quotes and orders (the "vendor's records"), so
// findOrder() can reconcile a lost response the same way the real one would.
//
// Behaviour knobs (for tests and the demo) are per-call, never global:
//   fields.__fault = 'drift' | 'drop-option' | 'timeout' | 'reject'   on place()
import {createHash, randomUUID} from 'node:crypto';
import {findRecorded} from './recorded.js';

const DAY = 86400000;
const addDays = (iso, n) => new Date(Date.parse(iso) + n * DAY).toISOString().slice(0, 10);

// Prices scale with quantity and material; tiers are Xometry-like. Exported so the simulated
// Xometry site (server/vendors/site) prices and schedules exactly like this in-process fake.
export const MATERIAL = {'6061-T6': 1, '7075-T651': 1.35, '17-4PH': 1.9, 'PEEK': 2.6};
export const TIERS = [
  {tier: 'Economy', mfgDays: 14, shipDays: 3, factor: 0.85},
  {tier: 'Standard', mfgDays: 10, shipDays: 2, factor: 1},
  {tier: 'Expedited', mfgDays: 5, shipDays: 2, factor: 1.3},
  {tier: 'Rush', mfgDays: 3, shipDays: 1, factor: 1.75},
];

export function priceFor(fields, factor, basePriceCents = 300000) {
  const qty = Number(fields.quantity) || 1;
  const mat = MATERIAL[fields.material] ?? 1.2;
  const finish = fields.finish && !/none|as machined/i.test(String(fields.finish)) ? 1.1 : 1;
  // Unit price falls with quantity; the base is for qty 1 of a mid-size part.
  const unit = basePriceCents * mat * finish * Math.pow(qty, -0.25);
  return Math.round(unit * qty * factor);
}

/**
 * Pure quote arithmetic: tiers, prices, dates, cutoff and validity for `fields` quoted at `now`.
 * Orders placed after 14:00 local start production the next business day, so the quote's cutoff
 * is always the NEXT one: order by then and production starts on `startsOn`.
 */
export function quoteOptions({fields, now, basePriceCents = 300000, receivingDays = 0, recorded = null}) {
  const t = now instanceof Date ? now : now();
  const today = t.toISOString().slice(0, 10);
  const todayCutoff = new Date(Date.parse(today + 'T14:00:00-08:00')).toISOString();
  const afterCutoff = t.toISOString() > todayCutoff;
  const startsOn = afterCutoff ? addDays(today, businessDaysToCalendar(1, today)) : today;
  const cutoff = afterCutoff ? new Date(Date.parse(startsOn + 'T14:00:00-08:00')).toISOString() : todayCutoff;
  // A recorded quote (server/vendors/recorded.js) is the vendor's own answer for this part: its tiers, prices
  // and dates are used as recorded, shifted only if the quote's day has passed its cutoff.
  const options = recorded
    ? recorded.options.map(o => { const bd = o.businessDays ?? 10; const ready = o.readyOn && !afterCutoff ? o.readyOn : addDays(startsOn, businessDaysToCalendar(bd, startsOn) + receivingDays);
      return {tier: o.tier, priceCents: o.priceCents, mfgDays: bd, shipDays: 0, shipsOn: o.shipsOn && !afterCutoff ? o.shipsOn : ready, readyOn: ready}; })
    : TIERS.map(x => ({tier: x.tier, priceCents: priceFor(fields, x.factor, basePriceCents), mfgDays: x.mfgDays, shipDays: x.shipDays,
      shipsOn: addDays(startsOn, businessDaysToCalendar(x.mfgDays, startsOn)),
      readyOn: addDays(startsOn, businessDaysToCalendar(x.mfgDays, startsOn) + x.shipDays + receivingDays)}));
  const config = createHash('sha1').update(JSON.stringify(fields)).digest('hex').slice(0, 6);
  return {options, cutoff, startsOn, validUntil: recorded?.validUntil || addDays(today, 30), config, capturedAt: t.toISOString(), recordedQuoteId: recorded?.quoteId || null};
}

export function createFakeVendor({now = () => new Date(), basePriceCents = 300000, receivingDays = 0, quotes: recordedQuotes = []} = {}) {
  const quotes = new Map();   // quoteId -> {fields, cadHash, options, validUntil, config}
  const orders = new Map();   // vendorOrderId -> {quoteId, specHash, tier, priceCents, placedAt, promisedOn}

  return {
    describe: () => ({vendor: 'xometry', mode: 'fake', capabilities: {quote: true, place: true, status: true, teamspaceReuse: true}}),

    async quote({fields, cad, partNumber = null}) {
      if (!cad?.hash) throw new Error('CAD file required');
      const t = now();
      const recorded = findRecorded(recordedQuotes, {fileName: cad.fileName, partNumber, fields});
      const {options: priced, cutoff, validUntil, config, recordedQuoteId} = quoteOptions({fields, now: t, basePriceCents, receivingDays, recorded});
      const options = priced.map(({shipsOn, ...o}) => o); // QuoteOption has no shipsOn; the site shows it
      const quoteId = recordedQuoteId || 'Q-' + createHash('sha1').update(cad.hash + JSON.stringify(fields)).digest('hex').slice(0, 8).toUpperCase();
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
      // An attempt id is an exact identity: when given, only that attempt's order counts, never another order with the same spec.
      if (attemptId) { for (const [id, o] of orders) if (o.attemptId === attemptId) return {found: true, vendorOrderId: id, promisedOn: o.promisedOn}; return {found: false}; }
      for (const [id, o] of orders) if (specHash && o.specHash === specHash && (!since || o.placedAt >= since)) return {found: true, vendorOrderId: id, promisedOn: o.promisedOn};
      return {found: false};
    },

    _records: {quotes, orders},
  };
}

// Business days → calendar days, counting from the given day (Mon–Fri shop).
export function businessDaysToCalendar(n, fromIso) {
  let days = 0, remaining = n; const start = Date.parse(fromIso + 'T00:00:00Z');
  while (remaining > 0) { days++; const w = new Date(start + days * DAY).getUTCDay(); if (w !== 0 && w !== 6) remaining--; }
  return days;
}
