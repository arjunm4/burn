// Headless Xometry provider: Playwright (playwright-core driving the machine's installed Google
// Chrome) against a Xometry-shaped site. By default that is the simulated site in
// server/vendors/site (XOMETRY_BASE_URL, default http://127.0.0.1:5175); pointing it at the real
// xometry.com waits on open questions X1 (terms), X5 (account) and X6 (bot detection).
//
// Plain code decides every click; no model is involved. quote() uploads the CAD, fills the
// configurator from the spec and reads every tier back. place() reopens the quote, selects the
// tier, reads EVERY field on the checkout page back and compares it with the frozen spec before
// anything is typed into the payment form; any mismatch aborts without clicking Place order.
// Every step is screenshotted into XOMETRY_RECORDINGS_DIR/<key>/ with a steps.json index, which
// the "Burn's browser" panel shows (server/api/recordings.js). Card credentials come from a
// server-side vault lookup and are masked in screenshots and never logged.
import {mkdirSync, writeFileSync, readFileSync, existsSync, renameSync, rmSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

const NOT_READY = 'headless Xometry provider not enabled: set XOMETRY_HEADLESS_ENABLED=1 (and XOMETRY_BASE_URL)';
const money = c => '$' + (c / 100).toLocaleString('en-US', {minimumFractionDigits: 2});

/** Launches the user's installed Chrome (no bundled browser download) or explains what is missing. */
export async function launchChrome({headless = true, executablePath = process.env.XOMETRY_CHROME_PATH} = {}) {
  const {chromium} = await import('playwright-core');
  try { return await chromium.launch(executablePath ? {executablePath, headless} : {channel: 'chrome', headless}); }
  catch (error) { throw new Error(`Google Chrome could not be launched for the headless Xometry provider. Install Google Chrome or set XOMETRY_CHROME_PATH to a Chromium binary. (${error.message.split('\n')[0]})`); }
}

// The demo's "vault": the Ramp mock hands out opaque mock-vault: refs for a card ending 4242; a
// real deployment resolves credentialRef against Ramp's card endpoint here, server side only.
const luhnCheck = digits => { let sum = 0; for (let i = 0; i < digits.length; i++) { let d = +digits[digits.length - 1 - i]; if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; } sum += d; } return sum % 10; };
export function testCardEndingIn(last4) { for (let d = 0; d <= 9; d++) { const n = '40000000000' + d + last4; if (luhnCheck(n) === 0) return n; } return '4242424242424242'; }
const defaultVault = {
  async resolve(credentialRef, last4) {
    if (!credentialRef) return null;
    if (credentialRef.startsWith('mock-vault:')) return {number: testCardEndingIn(last4 || '4242'), exp: '12/29', cvc: '123', name: 'Burn (Ramp virtual card)'};
    return null;
  },
};

/** Screenshots + steps.json under <dir>/<key>; rekey() renames the folder once the real id is known. */
function recorder(dir, key) {
  let folder = path.join(dir, key); mkdirSync(folder, {recursive: true});
  // Resume an existing recording (quote, then place, under one order id) rather than restart it.
  let steps = []; try { steps = JSON.parse(readFileSync(path.join(folder, 'steps.json'), 'utf8')).steps || []; } catch { /* fresh */ }
  const save = () => writeFileSync(path.join(folder, 'steps.json'), JSON.stringify({steps}, null, 1));
  return {
    get folder() { return folder; },
    async step(page, label, note, {mask = []} = {}) {
      const n = steps.length + 1, file = `${String(n).padStart(2, '0')}-${label}.png`;
      try { await page.screenshot({path: path.join(folder, file), fullPage: true, mask, maskColor: '#1C1B17'}); } catch { /* page gone (timeout/crash): keep the note without an image */ }
      steps.push({n, at: new Date().toISOString(), label, note, file: existsSync(path.join(folder, file)) ? file : null}); save();
    },
    rekey(newKey) { const target = path.join(dir, newKey); if (target === folder) return; rmSync(target, {recursive: true, force: true}); renameSync(folder, target); folder = target; },
  };
}

export function createHeadlessVendor({
  baseUrl = process.env.XOMETRY_BASE_URL || 'http://127.0.0.1:5175', enabled = process.env.XOMETRY_HEADLESS_ENABLED === '1',
  recordingsDir = process.env.XOMETRY_RECORDINGS_DIR || 'data/recordings', vault = defaultVault, now = () => new Date(),
  placeTimeoutMs = 15000, navTimeoutMs = 15000, video = process.env.XOMETRY_RECORD_VIDEO === '1', launch = launchChrome, credentials, ...rest
} = {}) {
  const base = baseUrl.replace(/\/$/, '');
  let browser = null;
  const getBrowser = async () => { if (!browser || !browser.isConnected()) browser = await launch(); return browser; };
  // One context (and page) per operation, so quotes and placements never share cookies or state.
  async function withPage(rec, fn) {
    const b = await getBrowser();
    const context = await b.newContext({viewport: {width: 1280, height: 900}, ...(video && rec ? {recordVideo: {dir: rec.folder, size: {width: 1280, height: 900}}} : {})});
    const page = await context.newPage(); page.setDefaultTimeout(navTimeoutMs); page.setDefaultNavigationTimeout(navTimeoutMs);
    try { return await fn(page); }
    finally {
      const v = video && rec ? page.video() : null;
      await context.close().catch(() => {});
      if (v) { try { renameSync(await v.path(), path.join(rec.folder, 'video.webm')); } catch { /* no video */ } }
    }
  }
  const dataset = (page, selector) => page.$$eval(selector, els => els.map(e => ({...e.dataset})));
  const attr = async (page, selector, name) => { const el = await page.$(selector); return el ? el.getAttribute(name) : null; };
  const specFields = fields => Object.entries(fields).filter(([k]) => k !== '__fault');

  return {
    describe: () => ({vendor: 'xometry', mode: 'headless', capabilities: {quote: enabled, place: enabled, status: enabled, teamspaceReuse: false}}),

    async quote({fields, cad, orderId = null}) {
      if (!enabled) throw new Error(NOT_READY);
      if (!cad?.bytes) throw new Error('CAD file required');
      const rec = recorder(recordingsDir, orderId || `pending-${randomUUID().slice(0, 8)}`);
      const result = await withPage(rec, async page => {
        await page.goto(base + '/');
        await rec.step(page, 'landing', 'Opened Xometry (simulated)');
        await Promise.all([page.waitForURL(/\/quote\/new/), page.click('#start-quote')]);
        await page.setInputFiles('#cad-file', {name: cad.fileName || 'part.step', mimeType: 'application/octet-stream', buffer: cad.bytes});
        await rec.step(page, 'upload', `Attached ${cad.fileName || 'part.step'} (${cad.bytes.length.toLocaleString('en-US')} bytes)`);
        await Promise.all([page.waitForURL(/\/quote\/Q-/), page.click('#upload-submit')]);
        const quoteId = await attr(page, '[data-quote-id]', 'data-quote-id');
        const siteCad = await attr(page, '[data-cad-hash]', 'data-cad-hash');
        if (cad.hash && siteCad && siteCad !== cad.hash) throw new Error(`uploaded CAD hash ${siteCad.slice(0, 12)} differs from ours ${cad.hash.slice(0, 12)}`);
        // The configurator: one input per spec field; fields the site has no input for are reported, never guessed.
        const set = [], skipped = [];
        for (const [k, v] of specFields(fields)) { if (await page.$(`#field-${k}`)) { await page.fill(`#field-${k}`, String(v)); set.push(`${k}=${v}`); } else skipped.push(k); }
        await rec.step(page, 'configurator', `Set ${set.length} field${set.length === 1 ? '' : 's'}: ${set.join(', ')}${skipped.length ? ` · no input for ${skipped.join(', ')}` : ''}`);
        await Promise.all([page.waitForURL(new RegExp(`/quote/${quoteId}`)), page.click('#update-quote')]);
        for (const [k, v] of specFields(fields)) { const echoed = await page.inputValue(`#field-${k}`).catch(() => null); if (echoed != null && echoed !== String(v)) throw new Error(`site kept ${k}=${echoed}, not ${v}`); }
        const rows = await dataset(page, 'tr[data-tier]');
        const options = rows.map(r => ({tier: r.tier, priceCents: Number(r.priceCents), mfgDays: Number(r.mfgDays), shipDays: Number(r.shipDays), readyOn: r.readyOn}));
        const rowsSeen = rows.length; // every lead-time row the page showed was read; a quote with fewer tiers is still complete
        const validUntil = await attr(page, '[data-valid-until]', 'data-valid-until'), cutoff = await attr(page, '[data-cutoff]', 'data-cutoff');
        const config = await attr(page, '[data-config-revision]', 'data-config-revision');
        await rec.step(page, 'tiers', `Read ${options.length} lead times: ${options.map(o => `${o.tier} ${money(o.priceCents)} ready ${o.readyOn}`).join(' · ')} · valid until ${validUntil}`);
        return {vendor: 'xometry', quoteId, configurationRevision: config || '', capturedAt: now().toISOString(), validUntil, cutoff, completeness: options.length >= 1 && options.every(o => o.priceCents > 0 && o.readyOn) && rowsSeen === options.length ? 'complete' : 'partial', options, source: 'headless'};
      });
      if (!orderId) rec.rekey(`quote-${result.quoteId}`);
      return result;
    },

    async place({spec, card, attemptId, orderId = null}) {
      if (!enabled) return {outcome: 'failed', reason: NOT_READY};
      if (!card?.credentialRef) return {outcome: 'blocked', mismatches: [{field: 'payment', expected: 'card', actual: 'none'}]};
      const rec = recorder(recordingsDir, orderId || `attempt-${attemptId}`);
      const fault = spec.fields?.__fault; const q = fault ? `?__fault=${encodeURIComponent(fault)}` : '';
      let clicked = false;
      try {
        return await withPage(rec, async page => {
          const open = await page.goto(`${base}/quote/${encodeURIComponent(spec.quoteId)}${q}`);
          if (open.status() === 404) { await rec.step(page, 'reopen-quote', `Quote ${spec.quoteId} not found`); return {outcome: 'failed', reason: 'quote not found'}; }
          await rec.step(page, 'reopen-quote', `Reopened quote ${spec.quoteId}`);
          const radio = page.locator(`tr[data-tier="${spec.tier}"] input[type=radio]`);
          if (await radio.count() === 0) { await rec.step(page, 'abort', `Lead time ${spec.tier} is no longer offered; not placing`); return {outcome: 'blocked', mismatches: [{field: 'tier', expected: spec.tier, actual: null}]}; }
          await radio.check();
          await rec.step(page, 'select-tier', `Selected ${spec.tier}`);
          await Promise.all([page.waitForURL(/\/checkout\//), page.click('#continue-checkout')]);
          // Read-back: every field the checkout page shows, compared with the frozen spec. Same rules as fake.js.
          const shown = Object.fromEntries((await page.$$eval('tr[data-field]', rows => rows.map(r => [r.dataset.field, r.querySelector('[data-value]')?.dataset.value ?? null]))));
          const mismatches = [], notes = [];
          for (const [k, v] of specFields(spec.fields)) { const ok = String(shown[k]) === String(v); notes.push(`${k}: ${shown[k] ?? '—'} — ${ok ? 'matches' : `expected ${v}`}`); if (!ok) mismatches.push({field: k, expected: v, actual: shown[k] ?? null}); }
          if (shown.cad !== spec.cadHash) mismatches.push({field: 'cad', expected: spec.cadHash, actual: shown.cad ?? null}); notes.push(`cad: ${(shown.cad || '—').slice(0, 12)} — ${shown.cad === spec.cadHash ? 'matches' : 'differs'}`);
          if (!shown.tier) mismatches.push({field: 'tier', expected: spec.tier, actual: null});
          else if (shown.tier !== spec.tier) mismatches.push({field: 'tier', expected: spec.tier, actual: shown.tier});
          const price = shown.price ? Number(shown.price) : null;
          if (shown.tier && price !== spec.priceCents) mismatches.push({field: 'price', expected: spec.priceCents, actual: price}); notes.push(`tier: ${shown.tier || 'unavailable'} at ${price != null ? money(price) : '—'} — ${shown.tier === spec.tier && price === spec.priceCents ? 'matches' : `expected ${spec.tier} at ${money(spec.priceCents)}`}`);
          const validUntil = await attr(page, '[data-valid-until]', 'data-valid-until');
          if (validUntil && Date.parse(validUntil) < now().getTime()) mismatches.push({field: 'validUntil', expected: 'valid', actual: 'expired'});
          await rec.step(page, 'read-back', `Read back ${notes.length} fields: ${notes.join(' · ')}`);
          if (mismatches.length) { await rec.step(page, 'abort', `Not placing: ${mismatches.map(m => `${m.field} (expected ${m.expected}, got ${m.actual})`).join(', ')}`); return {outcome: 'blocked', mismatches}; }

          const c = await vault.resolve(card.credentialRef, card.last4);
          if (!c) { await rec.step(page, 'abort', 'Card credential could not be resolved from the vault; not placing'); return {outcome: 'failed', reason: 'card credential could not be resolved'}; }
          await page.fill('#po-number', attemptId || ''); await page.fill('#reference', spec.__specHash || '');
          await page.fill('#card-name', c.name); await page.fill('#card-number', c.number); await page.fill('#card-exp', c.exp); await page.fill('#card-cvc', c.cvc);
          await rec.step(page, 'payment', `Entered the Ramp card ending ${c.number.slice(-4)} and PO number ${attemptId} (card masked)`, {mask: [page.locator('#card-number'), page.locator('#card-cvc')]});
          let response;
          try {
            clicked = true;
            [response] = await Promise.all([page.waitForResponse(r => r.request().method() === 'POST' && r.url().includes('/checkout/'), {timeout: placeTimeoutMs}), page.click('#place-order')]);
          } catch (error) {
            await rec.step(page, 'timeout', `Clicked Place order but no response after ${placeTimeoutMs / 1000}s; the order may or may not exist`);
            return {outcome: 'unknown', reason: `no response from vendor after submit (${error.message.split('\n')[0]})`};
          }
          if (response.status() >= 400) {
            await page.waitForLoadState('load').catch(() => {});
            const reason = (await page.textContent('#checkout-error').catch(() => null))?.trim() || `checkout returned ${response.status()}`;
            await rec.step(page, 'declined', `Order not placed: ${reason}`); return {outcome: 'failed', reason: /declined/i.test(reason) ? 'card declined' : reason};
          }
          await page.waitForURL(/\/orders\//);
          const vendorOrderId = await attr(page, '[data-order-number]', 'data-order-number'), promisedOn = await attr(page, '[data-promised-on]', 'data-promised-on');
          await rec.step(page, 'confirmation', `Order ${vendorOrderId} confirmed · promised ${promisedOn}`);
          if (!vendorOrderId) return {outcome: 'unknown', reason: 'confirmation page had no order number'};
          return {outcome: 'succeeded', vendorOrderId, promisedOn, verified: Object.fromEntries(specFields(spec.fields).map(([k]) => [k, true]))};
        });
      } catch (error) {
        // Before the click nothing was submitted, so this is a plain failure; after it, the answer is lost.
        return clicked ? {outcome: 'unknown', reason: error.message.split('\n')[0]} : {outcome: 'failed', reason: error.message.split('\n')[0]};
      }
    },

    async status(vendorOrderId) {
      if (!enabled) return {status: 'unknown', promisedOn: null, tracking: null};
      return withPage(null, async page => {
        const r = await page.goto(`${base}/orders/${encodeURIComponent(vendorOrderId)}`);
        if (r.status() !== 200) return {status: 'unknown', promisedOn: null, tracking: null};
        return {status: await attr(page, '[data-status]', 'data-status') || 'unknown', promisedOn: await attr(page, '[data-promised-on]', 'data-promised-on'), tracking: null};
      });
    },

    // Reconciliation: the account's order list, matched by the attempt id we put in the PO number field
    // (exact identity) or, failing that, by the spec hash in the reference field since the attempt began.
    async findOrder({specHash, since, attemptId, orderId = null}) {
      if (!enabled) return {found: false};
      const rec = attemptId || orderId ? recorder(recordingsDir, orderId || `attempt-${attemptId}`) : null;
      return withPage(rec, async page => {
        await page.goto(`${base}/account/orders`);
        const rows = await dataset(page, 'tr[data-order-number]');
        const hit = attemptId ? rows.find(r => r.attemptId === attemptId) : rows.find(r => specHash && r.reference === specHash && (!since || r.placedAt >= since));
        if (rec) await rec.step(page, 'account-orders', hit ? `Found order ${hit.orderNumber} for attempt ${attemptId || specHash?.slice(0, 8)} in the account's orders` : `No order for attempt ${attemptId || specHash?.slice(0, 8)} among ${rows.length} orders`);
        return hit ? {found: true, vendorOrderId: hit.orderNumber, promisedOn: hit.promisedOn} : {found: false};
      });
    },

    async close() { if (browser) { await browser.close().catch(() => {}); browser = null; } },
  };
}
