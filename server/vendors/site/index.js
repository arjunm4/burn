// Simulated Xometry website: a small server-rendered site with the same quote → configure →
// checkout → confirmation flow a headless browser would drive on xometry.com, so the real
// headless provider (server/vendors/headless.js) can be built and demonstrated end to end
// without touching the real vendor. Prices, tiers, dates and cutoffs come from the same pure
// functions the in-process fake uses (server/vendors/fake.js), so both agree exactly.
//
// Records (quotes, orders) live in SQLite (XOMETRY_SIM_DB, default data/xometry-sim.sqlite;
// ':memory:' for tests) so the site survives restarts and findOrder() can read them back.
// Fault knobs ride on the URL (?__fault=drift|drop-option|timeout|reject) and mirror fake.js:
//   drift        the chosen tier's price is 8% higher on the checkout page than on the quote
//   drop-option  the chosen tier is no longer offered
//   timeout      the order is recorded but the checkout response hangs (default 20 s)
//   reject       the card is declined
import http from 'node:http';
import {createHash, randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {quoteOptions, MATERIAL} from '../fake.js';
import {findRecorded} from '../recorded.js';

const FIELDS = [
  {key: 'material', label: 'Material', list: Object.keys(MATERIAL)},
  {key: 'finish', label: 'Finish', list: ['As machined', 'Bead blast', 'Type II black anodize', 'Type III hardcoat']},
  {key: 'tolerance', label: 'Tolerance', list: ['ISO 2768-m', 'ISO 2768-f', '±0.005"']},
  {key: 'inspection', label: 'Inspection', list: ['Standard', 'CMM report', 'FAI (AS9102)']},
  {key: 'quantity', label: 'Quantity', type: 'number'},
  {key: 'revision', label: 'Drawing / CAD revision'},
  {key: 'shipTo', label: 'Ship to'},
];
const FAULTS = ['drift', 'drop-option', 'timeout', 'reject'];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const money = c => '$' + (c / 100).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const longDate = iso => new Date(iso.length === 10 ? iso + 'T00:00:00Z' : iso).toLocaleDateString('en-US', {weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'});
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-');
const luhn = n => { let sum = 0, alt = false; for (let i = n.length - 1; i >= 0; i--) { let d = +n[i]; if (alt) { d *= 2; if (d > 9) d -= 9; } sum += d; alt = !alt; } return sum % 10 === 0; };

/** Persistent key → JSON record tables; SQLite when a filename is given, a Map otherwise. */
function tables(filename) {
  if (!filename) { const m = {}; return name => { const t = m[name] ||= new Map(); return {get: k => t.get(k) ?? null, set: (k, v) => t.set(k, v), list: () => [...t.values()], close() {}}; }; }
  if (filename !== ':memory:') mkdirSync(path.dirname(filename), {recursive: true});
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS records(tbl TEXT NOT NULL, id TEXT NOT NULL, seq INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY(tbl,id));');
  let seq = db.prepare('SELECT COALESCE(MAX(seq),0) AS n FROM records').get().n;
  return name => ({
    get: id => { const r = db.prepare('SELECT body FROM records WHERE tbl=? AND id=?').get(name, id); return r ? JSON.parse(r.body) : null; },
    set: (id, v) => db.prepare('INSERT INTO records VALUES(?,?,?,?) ON CONFLICT(tbl,id) DO UPDATE SET body=excluded.body').run(name, id, ++seq, JSON.stringify(v)),
    list: () => db.prepare('SELECT body FROM records WHERE tbl=? ORDER BY seq').all(name).map(r => JSON.parse(r.body)),
    close: () => db.close(),
  });
}

async function readBody(req, limit = 25 * 1024 * 1024) {
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > limit) throw Object.assign(new Error('Request too large'), {status: 413}); chunks.push(c); }
  return Buffer.concat(chunks);
}
/** Parses JSON, urlencoded or multipart bodies into {fields, file:{name,bytes}|null}. */
async function parseForm(req) {
  const type = req.headers['content-type'] || '';
  const raw = await readBody(req);
  if (type.includes('application/json')) { const b = JSON.parse(raw.toString() || '{}'); const file = b.file?.base64 ? {name: b.file.name || 'part.step', bytes: Buffer.from(b.file.base64, 'base64')} : null; const {file: _, ...fields} = b; return {fields, file}; }
  if (type.includes('multipart/form-data')) {
    const boundary = type.match(/boundary=("?)([^";]+)\1/)?.[2]; if (!boundary) throw Object.assign(new Error('Bad multipart'), {status: 400});
    const fields = {}; let file = null; const sep = Buffer.from('--' + boundary);
    let pos = raw.indexOf(sep) + sep.length;
    while (pos < raw.length) {
      if (raw.slice(pos, pos + 2).toString() === '--') break;
      const headEnd = raw.indexOf('\r\n\r\n', pos); const head = raw.slice(pos, headEnd).toString();
      const next = raw.indexOf(sep, headEnd); const value = raw.slice(headEnd + 4, next - 2); // strip trailing CRLF
      const name = head.match(/name="([^"]*)"/)?.[1]; const filename = head.match(/filename="([^"]*)"/)?.[1];
      if (filename !== undefined) { if (filename) file = {name: path.basename(filename), bytes: value}; } else if (name) fields[name] = value.toString();
      pos = next + sep.length;
    }
    return {fields, file};
  }
  return {fields: Object.fromEntries(new URLSearchParams(raw.toString())), file: null};
}

export function createXometrySite({now = () => new Date(), basePriceCents = 300000, receivingDays = 0, quotes: recordedQuotes = [], filename = process.env.XOMETRY_SIM_DB || 'data/xometry-sim.sqlite', basePath = '', hangMs = 20000, acceptedLast4 = process.env.XOMETRY_SIM_ACCEPT_LAST4 ? process.env.XOMETRY_SIM_ACCEPT_LAST4.split(',') : null} = {}) {
  const table = tables(filename);
  const quotes = table('quotes');   // {id, cadHash, cadName, cadSize, fields, config, createdAt}
  const orders = table('orders');   // {id, quoteId, tier, priceCents, fields, cadHash, attemptId, reference, last4, placedAt, promisedOn, status}
  const base = basePath.replace(/\/$/, '');
  const url = p => base + p;

  // Prices are recomputed from the stored configuration at request time, exactly as fake.js does.
  const priced = (q, fault) => {
    const r = quoteOptions({fields: q.fields, now, basePriceCents, receivingDays, recorded: findRecorded(recordedQuotes, {fileName: q.cadName, fields: q.fields})});
    if (fault === 'drop-option' && q.tier) r.options = r.options.filter(o => o.tier !== q.tier);
    if (fault === 'drift' && q.tier) r.options = r.options.map(o => o.tier === q.tier ? {...o, priceCents: Math.round(o.priceCents * 1.08)} : o);
    return r;
  };
  const cleanFields = input => { const out = {}; for (const f of FIELDS) { const v = input[f.key]; if (v != null && String(v).trim() !== '') out[f.key] = f.type === 'number' ? Number(v) : String(v).trim(); } return out; };

  const page = (title, body, {status = 200, headers = {}} = {}) => ({status, headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...headers}, body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · Xometry (simulated)</title>
<style>${CSS}</style></head><body>
<div class="sim-banner" role="note">Simulated vendor site for the Burn demo. No real orders are placed.</div>
<header class="top"><a class="brand" href="${url('/')}"><span class="mark"></span>Xometry <small>(simulated)</small></a><nav><a href="${url('/quote/new')}">Instant quote</a><a href="${url('/account/orders')}">My orders</a></nav></header>
<main>${body}</main>
<footer>Xometry (simulated) · a stand-in used by Burn's headless provider · ${esc(now().toISOString().slice(0, 10))}</footer>
</body></html>`});
  const redirect = to => ({status: 303, headers: {Location: url(to)}, body: ''});
  const notFound = () => page('Not found', '<h1>Not found</h1><p>That page does not exist.</p>', {status: 404});
  const faultParam = f => FAULTS.includes(f) ? f : null;

  const tierTable = (q, r, selected, fault) => `<table class="tiers" id="lead-times"><thead><tr><th></th><th>Lead time</th><th>Production</th><th>Ships by</th><th>Est. delivery</th><th class="num">Total</th></tr></thead><tbody>
${r.options.map(o => `<tr data-tier="${esc(o.tier)}" data-price-cents="${o.priceCents}" data-mfg-days="${o.mfgDays}" data-ship-days="${o.shipDays}" data-ships-on="${o.shipsOn}" data-ready-on="${o.readyOn}" class="${selected === o.tier ? 'selected' : ''}">
<td><input type="radio" name="tier" id="tier-${slug(o.tier)}" value="${esc(o.tier)}" ${selected === o.tier ? 'checked' : ''} aria-label="${esc(o.tier)}"></td><td><label for="tier-${slug(o.tier)}"><strong>${esc(o.tier)}</strong></label></td><td>${o.mfgDays} business days</td><td>${longDate(o.shipsOn)}</td><td>${longDate(o.readyOn)}</td><td class="num price">${money(o.priceCents)}</td></tr>`).join('\n')}
</tbody></table>`;

  const routes = {
    'GET /': () => page('Custom manufacturing on demand', `<section class="hero"><h1>Custom parts, quoted in seconds.</h1><p>Upload a CAD file, pick a material and lead time, and get a price you can order against today.</p><a class="btn primary" id="start-quote" href="${url('/quote/new')}">Get an instant quote</a></section>
<section class="three"><div><h3>CNC machining</h3><p>Aluminum, steel and engineering plastics; tolerances to ISO 2768-f.</p></div><div><h3>Four lead times</h3><p>Economy, Standard, Expedited and Rush. Order by 2:00 PM PT to start today.</p></div><div><h3>Inspection</h3><p>Standard, CMM report or first-article inspection.</p></div></section>`),

    'GET /quote/new': () => page('New quote', `<h1>Get an instant quote</h1><p class="muted">Upload a STEP or STL file. You can set material, finish and quantity on the next page.</p>
<form id="upload-form" method="post" action="${url('/quote/new')}" enctype="multipart/form-data" class="card">
<label class="drop" for="cad-file"><span>Drop a CAD file here or choose one</span><input type="file" id="cad-file" name="file" accept=".step,.stp,.stl,.iges,.igs" required></label>
<button class="btn primary" id="upload-submit" type="submit">Upload and quote</button></form>`),

    'POST /quote/new': async req => {
      const {fields, file} = await parseForm(req);
      if (!file?.bytes?.length) return page('New quote', '<h1>Get an instant quote</h1><p class="error" role="alert">Please choose a CAD file.</p>', {status: 400});
      const id = 'Q-' + createHash('sha1').update(randomUUID()).digest('hex').slice(0, 8).toUpperCase();
      const f = cleanFields(fields);
      quotes.set(id, {id, cadHash: createHash('sha256').update(file.bytes).digest('hex'), cadName: file.name, cadSize: file.bytes.length, fields: f, config: quoteOptions({fields: f, now, basePriceCents}).config, createdAt: now().toISOString()});
      return redirect(`/quote/${id}`);
    },

    'GET /quote/:id': (req, {id}, query) => {
      const q = quotes.get(id); if (!q) return notFound();
      const fault = faultParam(query.get('__fault')); const selected = query.get('tier') || null;
      const r = priced({...q, tier: selected}, fault);
      const cutoffLocal = new Date(r.cutoff).toLocaleString('en-US', {weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles'});
      return page(`Quote ${id}`, `<div class="quote-head"><div><h1 data-quote-id="${esc(id)}">Quote #${esc(id)}</h1><p class="muted">${esc(q.cadName)} · ${(q.cadSize / 1024).toFixed(1)} KB · sha256 <code data-cad-hash="${q.cadHash}">${q.cadHash.slice(0, 12)}…</code> · configuration <code data-config-revision="${r.config}">${r.config}</code></p></div>
<div class="valid"><div>Valid until <strong data-valid-until="${r.validUntil}">${longDate(r.validUntil)}</strong></div><div class="muted">Order by <strong data-cutoff="${r.cutoff}">2:00 PM PT</strong> (${esc(cutoffLocal)}) to start production ${r.startsOn === now().toISOString().slice(0, 10) ? 'today' : 'on ' + longDate(r.startsOn)}</div></div></div>
<div class="cols"><form id="configurator" class="card" method="post" action="${url(`/quote/${id}/configure`)}"><h2>Part configuration</h2>
${FIELDS.map(f => `<label>${esc(f.label)}<input name="${f.key}" id="field-${f.key}" ${f.type === 'number' ? 'type="number" min="1" step="1"' : 'type="text"'} value="${esc(q.fields[f.key] ?? '')}" ${f.list ? `list="list-${f.key}"` : ''} autocomplete="off">${f.list ? `<datalist id="list-${f.key}">${f.list.map(v => `<option value="${esc(v)}">`).join('')}</datalist>` : ''}</label>`).join('\n')}
${fault ? `<input type="hidden" name="__fault" value="${esc(fault)}">` : ''}
<button class="btn" id="update-quote" type="submit">Update quote</button></form>
<form id="lead-time-form" class="card" method="get" action="${url(`/checkout/${id}`)}"><h2>Lead time</h2>
${tierTable(q, r, selected, fault)}
${fault ? `<input type="hidden" name="__fault" value="${esc(fault)}">` : ''}
<p class="muted small">Totals include shipping; tax is calculated at checkout. Production starts the next business day after the 2:00 PM PT cutoff.</p>
<button class="btn primary" id="continue-checkout" type="submit">Continue to checkout</button></form></div>`);
    },

    'POST /quote/:id/configure': async (req, {id}) => {
      const q = quotes.get(id); if (!q) return notFound();
      const {fields} = await parseForm(req);
      const f = cleanFields(fields);
      quotes.set(id, {...q, fields: f, config: quoteOptions({fields: f, now, basePriceCents}).config});
      const fault = faultParam(fields.__fault);
      return redirect(`/quote/${id}${fault ? `?__fault=${fault}` : ''}`);
    },

    'GET /checkout/:id': (req, {id}, query) => {
      const q = quotes.get(id); if (!q) return notFound();
      const fault = faultParam(query.get('__fault')); const tier = query.get('tier');
      return checkout(q, tier, fault, {});
    },

    'POST /checkout/:id': async (req, {id}) => {
      const q = quotes.get(id); if (!q) return notFound();
      const {fields: f} = await parseForm(req);
      const fault = faultParam(f.__fault); const tier = f.tier;
      const r = priced({...q, tier}, fault); const option = r.options.find(o => o.tier === tier);
      if (!option) return checkout(q, tier, fault, {error: 'The selected lead time is no longer available. Please choose another.', values: f}, 409);
      if (Date.parse(r.validUntil) < now().getTime()) return checkout(q, tier, fault, {error: 'This quote has expired. Please request a new quote.', values: f}, 409);
      const number = String(f.card_number || '').replace(/\D/g, '');
      const cardOk = number.length >= 13 && number.length <= 19 && luhn(number) && (!acceptedLast4 || acceptedLast4.includes(number.slice(-4)));
      if (!cardOk || !/^\d{2}\s*\/\s*\d{2,4}$/.test(f.card_exp || '') || !/^\d{3,4}$/.test(f.card_cvc || '') || !String(f.card_name || '').trim()) return checkout(q, tier, fault, {error: 'Your card could not be verified. Check the number, expiry, CVC and name.', values: f}, 402);
      if (fault === 'reject') return checkout(q, tier, fault, {error: 'Your card was declined by the issuer.', values: f}, 402);
      // The vendor records the order before answering; a 'timeout' loses the answer on the way back.
      const orderNumber = 'XO-' + randomUUID().slice(0, 8).toUpperCase();
      orders.set(orderNumber, {id: orderNumber, quoteId: q.id, tier, priceCents: option.priceCents, mfgDays: option.mfgDays, shipDays: option.shipDays, fields: q.fields, cadHash: q.cadHash, cadName: q.cadName, config: r.config,
        attemptId: String(f.po_number || '').trim() || null, reference: String(f.reference || '').trim() || null, last4: number.slice(-4), placedAt: now().toISOString(), promisedOn: option.readyOn, shipsOn: option.shipsOn, status: 'in_production'});
      if (fault === 'timeout') await new Promise(res => setTimeout(res, hangMs));
      return redirect(`/orders/${orderNumber}`);
    },

    'GET /orders/:id': (req, {id}) => {
      const o = orders.get(id); if (!o) return notFound();
      return page(`Order ${id}`, `<div class="confirm"><h1>Thanks, your order is in.</h1><p>Order <strong data-order-number="${esc(o.id)}">${esc(o.id)}</strong> · status <span class="pill" data-status="${esc(o.status)}">${esc(o.status.replace('_', ' '))}</span> · placed ${esc(new Date(o.placedAt).toLocaleString('en-US', {timeZone: 'America/Los_Angeles'}))} PT</p></div>
<div class="cols"><div class="card"><h2>Part</h2>${specTable(o.fields, o.cadHash, o.cadName)}</div>
<div class="card"><h2>Delivery and payment</h2><table class="kv">
<tr data-field="tier"><th>Lead time</th><td data-value="${esc(o.tier)}">${esc(o.tier)}</td></tr>
<tr><th>Ships by</th><td data-ships-on="${o.shipsOn}">${longDate(o.shipsOn)}</td></tr>
<tr><th>Estimated delivery</th><td data-promised-on="${o.promisedOn}">${longDate(o.promisedOn)}</td></tr>
<tr data-field="price"><th>Total charged</th><td data-value="${o.priceCents}" class="price">${money(o.priceCents)}</td></tr>
<tr><th>Card</th><td>•••• ${esc(o.last4)}</td></tr>
<tr><th>PO number</th><td data-attempt-id="${esc(o.attemptId || '')}">${esc(o.attemptId || '—')}</td></tr>
<tr><th>Quote</th><td><a href="${url(`/quote/${o.quoteId}`)}">${esc(o.quoteId)}</a></td></tr></table></div></div>`);
    },

    'GET /account/orders': () => page('My orders', `<h1>My orders</h1>${orders.list().length ? `<table class="list" id="orders"><thead><tr><th>Order</th><th>Placed</th><th>Part</th><th>Lead time</th><th>PO number</th><th>Est. delivery</th><th>Status</th><th class="num">Total</th></tr></thead><tbody>
${orders.list().reverse().map(o => `<tr data-order-number="${esc(o.id)}" data-attempt-id="${esc(o.attemptId || '')}" data-reference="${esc(o.reference || '')}" data-placed-at="${o.placedAt}" data-promised-on="${o.promisedOn}" data-status="${esc(o.status)}" data-quote-id="${esc(o.quoteId)}">
<td><a href="${url(`/orders/${o.id}`)}">${esc(o.id)}</a></td><td>${esc(new Date(o.placedAt).toLocaleDateString('en-US', {month: 'short', day: 'numeric', timeZone: 'UTC'}))}</td><td>${esc(o.cadName)}</td><td>${esc(o.tier)}</td><td>${esc(o.attemptId || '—')}</td><td>${longDate(o.promisedOn)}</td><td><span class="pill">${esc(o.status.replace('_', ' '))}</span></td><td class="num">${money(o.priceCents)}</td></tr>`).join('\n')}
</tbody></table>` : '<p class="muted">No orders yet.</p>'}`),
  };

  function specTable(fields, cadHash, cadName) {
    return `<table class="kv spec" id="spec">${FIELDS.map(f => `<tr data-field="${f.key}"><th>${esc(f.label)}</th><td data-value="${esc(fields[f.key] ?? '')}">${esc(fields[f.key] ?? '—')}</td></tr>`).join('\n')}
<tr data-field="cad"><th>CAD file</th><td data-value="${cadHash}">${esc(cadName)} <code class="muted">sha256 ${cadHash.slice(0, 12)}…</code></td></tr></table>`;
  }

  function checkout(q, tier, fault, {error, values = {}}, status = 200) {
    const r = priced({...q, tier}, fault); const option = r.options.find(o => o.tier === tier);
    const v = k => esc(values[k] ?? '');
    return page(`Checkout ${q.id}`, `<h1>Checkout</h1><p class="muted">Quote <a href="${url(`/quote/${q.id}`)}" data-quote-id="${esc(q.id)}">#${esc(q.id)}</a> · valid until <span data-valid-until="${r.validUntil}">${longDate(r.validUntil)}</span> · configuration <code data-config-revision="${r.config}">${r.config}</code></p>
${error ? `<p class="error" role="alert" id="checkout-error">${esc(error)}</p>` : ''}
<div class="cols"><div class="card"><h2>Review your part</h2>${specTable(q.fields, q.cadHash, q.cadName)}
<h2>Lead time</h2><table class="kv" id="summary">
<tr data-field="tier"><th>Lead time</th><td data-value="${esc(option?.tier ?? '')}">${option ? esc(option.tier) : '<span class="error">no longer available</span>'}</td></tr>
${option ? `<tr><th>Production</th><td data-mfg-days="${option.mfgDays}">${option.mfgDays} business days</td></tr><tr><th>Ships by</th><td data-ships-on="${option.shipsOn}">${longDate(option.shipsOn)}</td></tr><tr><th>Estimated delivery</th><td data-ready-on="${option.readyOn}">${longDate(option.readyOn)}</td></tr>` : ''}
<tr data-field="price"><th>Total</th><td data-value="${option?.priceCents ?? ''}" class="price" id="total">${option ? money(option.priceCents) : '—'}</td></tr></table></div>
<form id="payment" class="card" method="post" action="${url(`/checkout/${q.id}`)}" autocomplete="off"><h2>Payment</h2>
<input type="hidden" name="tier" value="${esc(tier ?? '')}">${fault ? `<input type="hidden" name="__fault" value="${esc(fault)}">` : ''}
<label>Name on card<input type="text" name="card_name" id="card-name" value="${v('card_name')}" required></label>
<label>Card number<input type="text" name="card_number" id="card-number" inputmode="numeric" value="${v('card_number')}" placeholder="1234 5678 9012 3456" required></label>
<div class="row"><label>Expiry<input type="text" name="card_exp" id="card-exp" value="${v('card_exp')}" placeholder="MM/YY" required></label><label>CVC<input type="text" name="card_cvc" id="card-cvc" inputmode="numeric" value="${v('card_cvc')}" placeholder="123" required></label></div>
<h2>Order details</h2>
<label>PO number<input type="text" name="po_number" id="po-number" value="${v('po_number')}" placeholder="optional"></label>
<label>Your reference<input type="text" name="reference" id="reference" value="${v('reference')}" placeholder="optional"></label>
<button class="btn primary" id="place-order" type="submit" ${option ? '' : 'disabled'}>Place order · ${option ? money(option.priceCents) : '—'}</button>
<p class="muted small">By placing this order you agree to the simulated terms. Nothing is manufactured or charged.</p></form></div>`, {status});
  }

  const match = (method, pathname) => {
    for (const key of Object.keys(routes)) {
      const [m, pattern] = key.split(' '); if (m !== method) continue;
      const re = new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[A-Za-z0-9_-]+)') + '/?$');
      const hit = pathname.match(re); if (hit) return {route: routes[key], params: hit.groups || {}};
    }
    return null;
  };

  async function handler(req, res) {
    const u = new URL(req.url, 'http://localhost');
    let pathname = u.pathname;
    if (base) { if (pathname !== base && !pathname.startsWith(base + '/')) { res.writeHead(404); res.end(); return; } pathname = pathname.slice(base.length) || '/'; }
    try {
      const hit = match(req.method, pathname);
      const out = hit ? await hit.route(req, hit.params, u.searchParams) : notFound();
      res.writeHead(out.status, out.headers); res.end(out.body);
    } catch (error) {
      if (!res.headersSent) { const p = page('Error', `<h1>Something went wrong</h1><p class="error">${esc(error.message)}</p>`, {status: error.status || 500}); res.writeHead(p.status, p.headers); res.end(p.body); } else res.end();
    }
  }

  let server = null;
  return {
    handler,
    listen: (port = Number(process.env.XOMETRY_SIM_PORT) || 5175, host = '127.0.0.1') => new Promise(resolve => { server = http.createServer(handler); server.listen(port, host, () => resolve(server.address())); }),
    close: () => new Promise(resolve => { quotes.close(); if (server) server.close(() => resolve()); else resolve(); }),
    _records: {quotes, orders},
  };
}

// One shared instance for mounting under the main app (server/index.js), created on first use.
let shared = null;
export const sharedXometrySite = options => (shared ||= createXometrySite(options));

const CSS = `
:root{--blue:#1F5FD6;--ink:#1a1f2b;--muted:#6b7280;--line:#e5e7eb;--bg:#f6f8fb}
*{box-sizing:border-box}body{margin:0;font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--ink);background:#fff}
.sim-banner{background:#fff7cc;color:#5a4a00;text-align:center;font-size:12px;padding:5px 12px;border-bottom:1px solid #f0e2a0}
header.top{display:flex;align-items:center;gap:24px;padding:12px 32px;border-bottom:1px solid var(--line)}
.brand{display:flex;align-items:center;gap:8px;font-weight:700;font-size:18px;color:var(--ink);text-decoration:none}.brand small{font-weight:400;color:var(--muted);font-size:12px}
.mark{width:18px;height:18px;border-radius:4px;background:linear-gradient(135deg,var(--blue),#6aa2ff)}
nav{margin-left:auto;display:flex;gap:18px}nav a{color:var(--muted);text-decoration:none}nav a:hover{color:var(--blue)}
main{max-width:1080px;margin:0 auto;padding:28px 32px 60px}footer{text-align:center;color:var(--muted);font-size:12px;padding:20px;border-top:1px solid var(--line)}
h1{font-size:26px;margin:0 0 8px;letter-spacing:-.01em}h2{font-size:15px;margin:0 0 12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}h3{margin:0 0 6px}
.muted{color:var(--muted)}.small{font-size:12px}.error{color:#b42318;background:#fef3f2;border:1px solid #fecdca;border-radius:8px;padding:10px 12px}
.hero{background:var(--bg);border-radius:16px;padding:48px 40px;margin-bottom:24px}.hero h1{font-size:34px}.hero p{font-size:16px;color:var(--muted);max-width:520px}
.three{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.three div{border:1px solid var(--line);border-radius:12px;padding:18px}.three p{color:var(--muted);margin:0}
.btn{display:inline-block;border:1px solid var(--line);background:#fff;color:var(--ink);border-radius:8px;padding:10px 16px;font:inherit;font-weight:600;cursor:pointer;text-decoration:none}
.btn.primary{background:var(--blue);border-color:var(--blue);color:#fff}.btn:disabled{opacity:.5;cursor:default}
.card{border:1px solid var(--line);border-radius:12px;padding:20px;background:#fff;display:flex;flex-direction:column;gap:12px}
.cols{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.4fr);gap:20px;align-items:start}
label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--muted)}input[type=text],input[type=number]{font:inherit;font-size:14px;color:var(--ink);padding:8px 10px;border:1px solid var(--line);border-radius:8px}
.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.drop{border:2px dashed var(--line);border-radius:12px;padding:36px;text-align:center;color:var(--muted);background:var(--bg)}
table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:8px 10px;border-top:1px solid var(--line);vertical-align:top}thead th{border-top:0;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.num,.price{text-align:right;font-variant-numeric:tabular-nums}.price{font-weight:600}
.tiers tr.selected{background:#eef4ff}.tiers input{width:16px;height:16px}
.kv th{color:var(--muted);font-weight:500;width:40%}
.quote-head{display:flex;justify-content:space-between;gap:20px;margin-bottom:20px;align-items:flex-start}.valid{text-align:right;font-size:13px}
.pill{display:inline-block;border:1px solid var(--line);border-radius:10px;padding:1px 8px;font-size:12px;background:var(--bg)}
.confirm{background:#eefbf2;border:1px solid #bfe8cc;border-radius:12px;padding:20px 24px;margin-bottom:20px}
code{font-size:12px;background:var(--bg);padding:1px 5px;border-radius:4px}
@media(max-width:760px){.cols,.three{grid-template-columns:1fr}.quote-head{flex-direction:column}.valid{text-align:left}main,header.top{padding-left:16px;padding-right:16px}}
`;
