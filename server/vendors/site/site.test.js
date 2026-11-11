import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {createXometrySite} from './index.js';
import {createFakeVendor} from '../fake.js';

const fixed = () => new Date('2026-11-09T17:00:00Z');
const fields = {material: '6061-T6', finish: 'Type II black anodize', tolerance: 'ISO 2768-m', quantity: 2, revision: 'B', inspection: 'Standard', shipTo: 'Emeryville'};
const cadBytes = Buffer.from('solid bracket');
let site, base;
before(async () => { site = createXometrySite({now: fixed, filename: ':memory:', hangMs: 300}); const a = await site.listen(0); base = `http://127.0.0.1:${a.port}`; });
after(() => site.close());

const form = (obj, file) => { const fd = new FormData(); for (const [k, v] of Object.entries(obj)) fd.append(k, String(v)); if (file) fd.append('file', new Blob([file.bytes]), file.name); return fd; };
const attr = (html, selector, name) => { const re = new RegExp(`<[^>]*${selector}[^>]*>`); const tag = html.match(re)?.[0]; return tag?.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? null; };
const rows = html => [...html.matchAll(/<tr data-tier="([^"]+)" data-price-cents="(\d+)" data-mfg-days="(\d+)" data-ship-days="(\d+)" data-ships-on="([^"]+)" data-ready-on="([^"]+)"/g)].map(m => ({tier: m[1], priceCents: +m[2], mfgDays: +m[3], shipDays: +m[4], shipsOn: m[5], readyOn: m[6]}));
const readBack = html => Object.fromEntries([...html.matchAll(/<tr data-field="([^"]+)"><th>[^<]*<\/th><td data-value="([^"]*)"/g)].map(m => [m[1], m[2]]));

async function newQuote(f = fields) {
  const r = await fetch(`${base}/quote/new`, {method: 'POST', body: form(f, {name: 'bracket.step', bytes: cadBytes}), redirect: 'manual'});
  assert.equal(r.status, 303);
  const id = r.headers.get('location').match(/\/quote\/(Q-[A-Z0-9]+)$/)[1];
  return id;
}
const checkoutBody = (tier, extra = {}) => new URLSearchParams({tier, card_name: 'Burn', card_number: '4242 4242 4242 4242', card_exp: '12/29', card_cvc: '123', ...extra});

test('landing links to a new quote; upload creates a quote whose tiers match the in-process fake exactly', async () => {
  const landing = await (await fetch(`${base}/`)).text();
  assert.match(landing, /Xometry <small>\(simulated\)/); assert.match(landing, /Simulated vendor site for the Burn demo/); assert.match(landing, /id="start-quote" href="\/quote\/new"/);
  const id = await newQuote();
  const html = await (await fetch(`${base}/quote/${id}`)).text();
  assert.equal(attr(html, 'data-quote-id', 'data-quote-id'), id);
  assert.match(html, /Quote #Q-/); assert.match(html, /2:00 PM PT/);
  const fake = createFakeVendor({now: fixed});
  const fq = await fake.quote({fields, cad: {hash: 'x'}});
  const tiers = rows(html);
  assert.deepEqual(tiers.map(({shipsOn, ...t}) => t), fq.options);
  assert.equal(attr(html, 'data-valid-until', 'data-valid-until'), fq.validUntil);
  assert.equal(attr(html, 'data-cutoff', 'data-cutoff'), fq.cutoff);
  for (const t of tiers) assert.match(html, new RegExp(`id="tier-${t.tier.toLowerCase()}"`));
});

test('configurator changes re-price the quote and bump the configuration revision', async () => {
  const id = await newQuote({});
  const before = await (await fetch(`${base}/quote/${id}`)).text();
  const r = await fetch(`${base}/quote/${id}/configure`, {method: 'POST', body: new URLSearchParams({...fields, quantity: '5'}), redirect: 'manual'});
  assert.equal(r.status, 303);
  const after = await (await fetch(`${base}/quote/${id}`)).text();
  assert.notEqual(attr(after, 'data-config-revision', 'data-config-revision'), attr(before, 'data-config-revision', 'data-config-revision'));
  assert.equal(attr(after, 'id="field-quantity"', 'value'), '5');
  assert.ok(rows(after)[1].priceCents > rows(before)[1].priceCents);
});

test('checkout reads every field back, places the order, and the order shows up in the account list', async () => {
  const id = await newQuote();
  const co = await (await fetch(`${base}/checkout/${id}?tier=Expedited`)).text();
  const back = readBack(co);
  for (const [k, v] of Object.entries(fields)) assert.equal(back[k], String(v), k);
  assert.equal(back.tier, 'Expedited'); assert.ok(back.cad.length === 64); assert.match(co, /id="place-order"/);
  const r = await fetch(`${base}/checkout/${id}`, {method: 'POST', body: checkoutBody('Expedited', {po_number: 'att-1', reference: 'spec-1'}), redirect: 'manual'});
  assert.equal(r.status, 303);
  const orderNumber = r.headers.get('location').match(/\/orders\/(XO-[A-Z0-9]+)$/)[1];
  const conf = await (await fetch(`${base}/orders/${orderNumber}`)).text();
  assert.equal(attr(conf, 'data-order-number', 'data-order-number'), orderNumber);
  assert.equal(attr(conf, 'data-status', 'data-status'), 'in_production');
  assert.equal(readBack(conf).tier, 'Expedited'); assert.equal(readBack(conf).price, String(rows(await (await fetch(`${base}/quote/${id}`)).text())[2].priceCents));
  const list = await (await fetch(`${base}/account/orders`)).text();
  assert.match(list, new RegExp(`data-order-number="${orderNumber}" data-attempt-id="att-1" data-reference="spec-1"`));
});

test('faults: drift changes the price between quote and checkout; drop-option removes the tier; reject declines; timeout records then hangs', async () => {
  const id = await newQuote();
  const quoted = rows(await (await fetch(`${base}/quote/${id}`)).text()).find(t => t.tier === 'Standard').priceCents;
  const drift = readBack(await (await fetch(`${base}/checkout/${id}?tier=Standard&__fault=drift`)).text());
  assert.equal(+drift.price, Math.round(quoted * 1.08));
  assert.equal(readBack(await (await fetch(`${base}/checkout/${id}?tier=Standard`)).text()).price, String(quoted), 'without the fault the price is unchanged');
  const dropped = await (await fetch(`${base}/checkout/${id}?tier=Standard&__fault=drop-option`)).text();
  assert.equal(readBack(dropped).tier, ''); assert.match(dropped, /id="place-order" type="submit" disabled/);
  const rej = await fetch(`${base}/checkout/${id}`, {method: 'POST', body: checkoutBody('Standard', {__fault: 'reject'}), redirect: 'manual'});
  assert.equal(rej.status, 402); assert.match(await rej.text(), /declined/);
  const t0 = Date.now();
  const to = await fetch(`${base}/checkout/${id}`, {method: 'POST', body: checkoutBody('Standard', {__fault: 'timeout', po_number: 'att-timeout'}), redirect: 'manual'});
  assert.equal(to.status, 303); assert.ok(Date.now() - t0 >= 250, 'the response hung');
  assert.match(await (await fetch(`${base}/account/orders`)).text(), /data-attempt-id="att-timeout"/, 'the order was recorded before the hang');
});

test('a card that fails validation is rejected on the page and no order is created', async () => {
  const id = await newQuote();
  const r = await fetch(`${base}/checkout/${id}`, {method: 'POST', body: checkoutBody('Rush', {card_number: '1234 5678 9012 3456'}), redirect: 'manual'});
  assert.equal(r.status, 402); assert.match(await r.text(), /id="checkout-error"/);
  assert.equal(site._records.orders.list().filter(o => o.quoteId === id).length, 0);
  const strict = createXometrySite({now: fixed, filename: ':memory:', acceptedLast4: ['1111']});
  const a = await strict.listen(0);
  try {
    const q = await fetch(`http://127.0.0.1:${a.port}/quote/new`, {method: 'POST', body: form(fields, {name: 'b.step', bytes: cadBytes}), redirect: 'manual'});
    const qid = q.headers.get('location').match(/Q-[A-Z0-9]+/)[0];
    assert.equal((await fetch(`http://127.0.0.1:${a.port}/checkout/${qid}`, {method: 'POST', body: checkoutBody('Rush'), redirect: 'manual'})).status, 402, 'valid card but wrong last4');
    assert.equal((await fetch(`http://127.0.0.1:${a.port}/checkout/${qid}`, {method: 'POST', body: checkoutBody('Rush', {card_number: '4111 1111 1111 1111'}), redirect: 'manual'})).status, 303);
  } finally { await strict.close(); }
});

test('the site serves under a base path and JSON uploads work too', async () => {
  const mounted = createXometrySite({now: fixed, filename: ':memory:', basePath: '/xometry-sim'});
  const a = await mounted.listen(0);
  try {
    assert.match(await (await fetch(`http://127.0.0.1:${a.port}/xometry-sim`)).text(), /href="\/xometry-sim\/quote\/new"/);
    assert.equal((await fetch(`http://127.0.0.1:${a.port}/other`)).status, 404);
    const r = await fetch(`http://127.0.0.1:${a.port}/xometry-sim/quote/new`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({...fields, file: {name: 'b.step', base64: cadBytes.toString('base64')}}), redirect: 'manual'});
    assert.match(r.headers.get('location'), /^\/xometry-sim\/quote\/Q-/);
  } finally { await mounted.close(); }
});
