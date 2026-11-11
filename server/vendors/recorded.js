// Recorded vendor quotes. A recorded world (BURN_WORLD) can ship Xometry quotes in Xometry's own
// export shape (xometry/quotes.json, demo/quote.json). The fake vendor and the simulated site use a
// recorded quote for a part they recognise (same CAD file, or same part number and revision), so the
// demo prices and dates are the world's, and fall back to the formula for anything else.
import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const cents = usd => Math.round(Number(usd || 0) * 100);

/** Normalises one Xometry-shaped quote: {quoteId, fileName, partNumber, revision, quantity, fields, validUntil, createdAt, options}. */
export function normalizeQuote(q) {
  const p = q.parts?.[0] || {};
  return {
    quoteId: q.quote_id, createdAt: q.created_at || null, validUntil: q.expires_on || null, fileName: p.file_name || null, partNumber: p.part_number || null, revision: p.revision || null, quantity: p.quantity ?? null,
    fields: {material: p.material || null, finish: p.finish || null, tolerance: p.tolerance || null, process: p.process || null},
    options: (q.lead_time_options || []).map(o => ({tier: o.lead_time, businessDays: o.lead_time_business_days ?? null, priceCents: cents(o.total ?? o.subtotal), shipsOn: o.estimated_ship_date || null, readyOn: o.estimated_delivery_date || null})),
  };
}

export function loadRecordedQuotes(env = process.env) {
  const world = path.resolve(ROOT, env.BURN_WORLD || 'fixtures/flintlock');
  const out = [];
  for (const f of ['xometry/quotes.json', 'demo/quote.json']) {
    const file = path.join(world, f);
    if (!existsSync(file)) continue;
    const body = JSON.parse(readFileSync(file, 'utf8'));
    for (const q of Array.isArray(body) ? body : body.quotes ? body.quotes : [body]) if (q?.quote_id && q.lead_time_options?.length) out.push(normalizeQuote(q));
  }
  return out;
}

/** The recorded quote for this part, if any: same CAD file name first, else part number + revision; newest wins. */
export function findRecorded(quotes, {fileName = null, partNumber = null, fields = {}} = {}) {
  if (!quotes?.length) return null;
  const rev = fields.revision ? String(fields.revision).toUpperCase() : null;
  const byFile = fileName ? quotes.filter(q => q.fileName === fileName) : [];
  const byNumber = partNumber ? quotes.filter(q => q.partNumber && q.partNumber.toUpperCase() === partNumber.toUpperCase() && (!rev || !q.revision || q.revision.toUpperCase() === rev)) : [];
  const pool = byFile.length ? byFile : byNumber;
  if (!pool.length) return null;
  const qty = fields.quantity != null ? Number(fields.quantity) : null;
  const same = qty != null ? pool.filter(q => q.quantity === qty) : [];
  return (same.length ? same : pool).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
}
