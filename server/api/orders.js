// HTTP API for orders (mounted from server/index.js). JSON in, JSON out; one SSE stream
// per order for live progress. CAD files arrive as base64 in JSON (STEP files are small
// enough), capped at 20 MB. Mutations carry expectedRevision and get 409 on conflict.
import {AppError} from '../contracts.js';
import {verifyWebhook} from '../ramp/index.js';

const LIMIT = 20 * 1024 * 1024;
async function rawBody(req) {
  let text = '';
  for await (const chunk of req) { text += chunk; if (text.length > LIMIT) throw new AppError('Request too large', 413); }
  return text;
}
async function body(req) { const text = await rawBody(req); try { return JSON.parse(text || '{}'); } catch { throw new AppError('Invalid JSON'); } }
// Audit events are served to the UI with secrets and file contents stripped at any depth.
const SECRET_KEYS = new Set(['credentialRef', 'bytes', 'base64', 'cad', 'password', 'token']);
export function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([k]) => !SECRET_KEYS.has(k)).map(([k, v]) => [k, sanitize(v)]));
  return value;
}
export const publicEvent = e => sanitize(e);
const cadFrom = b => (b?.cad?.base64 ? {fileName: b.cad.fileName || 'part.step', bytes: Buffer.from(b.cad.base64, 'base64')} : null);
// What the UI may see: never the card credential, never the CAD bytes.
export function publicOrder(o) {
  if (!o) return o;
  const {context, ramp, ...rest} = o;
  const {cad, graph, ...ctx} = context || {};
  const {credentialRef, ...r} = ramp || {};
  return {...rest, context: ctx, ramp: r};
}

export function ordersRoutes(orchestrator, {ramp, vendor, config, webhookSecret = process.env.RAMP_WEBHOOK_SECRET}) {
  const subscribers = new Map(); // orderId -> Set(res)
  orchestrator.bus.on('order', e => {
    const subs = subscribers.get(e.orderId); if (!subs) return;
    const line = `event: ${e.type}\ndata: ${JSON.stringify({...e, order: publicOrder(e.order)})}\n\n`;
    for (const res of subs) { if (res.destroyed) subs.delete(res); else res.write(line); }
  });

  return async function handle(req, res, pathname, json) {
    const sameOrigin = () => { if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) throw new AppError('Origin not allowed', 403); };
    if (pathname === '/api/system' && req.method === 'GET') {
      return json({vendor: vendor.describe(), ramp: ramp.describe(), company: config.company, specFields: config.specFields, milestones: Object.keys(config.milestones)}), true;
    }
    if (pathname === '/api/orders' && req.method === 'GET') return json({orders: orchestrator.list().map(publicOrder)}), true;
    if (pathname === '/api/orders' && req.method === 'POST') {
      sameOrigin(); const b = await body(req);
      return json({order: publicOrder(orchestrator.enter({name: b.name, note: b.note, cad: cadFrom(b), engineer: b.engineer, fields: b.fields || {}}))}, 201), true;
    }
    const m = pathname.match(/^\/api\/orders\/([A-Za-z0-9_-]+)(?:\/(events|stream|answer|argue|okay|reconcile|place))?$/);
    if (m) {
      const [, id, action] = m;
      if (!action && req.method === 'GET') return json({order: publicOrder(orchestrator.get(id)), events: orchestrator.events(id).map(publicEvent)}), true;
      if (action === 'events' && req.method === 'GET') return json({events: orchestrator.events(id).map(publicEvent)}), true;
      if (action === 'stream' && req.method === 'GET') {
        res.writeHead(200, {'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive'});
        res.write(`event: snapshot\ndata: ${JSON.stringify({order: publicOrder(orchestrator.get(id))})}\n\n`);
        if (!subscribers.has(id)) subscribers.set(id, new Set());
        subscribers.get(id).add(res);
        const ping = setInterval(() => { if (!res.destroyed) res.write(': ping\n\n'); }, 15000);
        req.on('close', () => { clearInterval(ping); subscribers.get(id)?.delete(res); });
        return true;
      }
      if (req.method !== 'POST') throw new AppError('Method not allowed', 405);
      sameOrigin(); const b = await body(req);
      if (action === 'answer') return json({order: publicOrder(await orchestrator.answer(id, b.expectedRevision, {fields: b.fields, cad: cadFrom(b), fact: b.fact, demand: b.demand}))}), true;
      if (action === 'argue') return json({order: publicOrder(await orchestrator.argue(id, b.expectedRevision, {text: b.text, type: b.type, fact: b.fact}))}), true;
      if (action === 'okay') return json({order: publicOrder(await orchestrator.okay(id, b.expectedRevision, {tier: b.tier}))}), true;
      if (action === 'reconcile') return json({order: publicOrder(await orchestrator.reconcile(id))}), true;
      if (action === 'place') { const r = await orchestrator.placeNow(id); return json({...r, order: publicOrder(orchestrator.get(id))}), true; }
    }
    // Ramp inbound events: verified on the raw body, fail closed. (Mock mode delivers in-process unless a webhook URL is configured.)
    if (pathname === '/api/ramp/webhook' && req.method === 'POST') {
      if (!webhookSecret) throw new AppError('Webhook not configured: set RAMP_WEBHOOK_SECRET', 503);
      const raw = await rawBody(req);
      if (!verifyWebhook(raw, req.headers['x-ramp-signature'], webhookSecret)) throw new AppError('Bad signature', 401);
      let event; try { event = JSON.parse(raw); } catch { throw new AppError('Invalid JSON'); }
      return json(await orchestrator.handleRampEvent(event)), true;
    }
    // Mock-only controls: the stand-in for approving in demo.ramp.com and ⌘J "add transaction".
    const sim = pathname.match(/^\/api\/ramp\/simulate\/(approve|reject|charge)$/);
    if (sim && req.method === 'POST') {
      sameOrigin(); if (!ramp.simulate) throw new AppError('Simulation is only available in mock mode', 404);
      const b = await body(req); const s = await ramp.simulate();
      let r;
      if (sim[1] === 'approve') r = await s.approve(b.requestId);
      else if (sim[1] === 'reject') r = await s.reject(b.requestId);
      else { const order = orchestrator.get(b.orderId); r = await s.charge(order.ramp.cardId, order.frozen.priceCents, {idempotencyKey: `ui:${order.id}:${order.ramp.cardId}`}); if (typeof r === 'string') r = {ok: true, transactionId: r}; }
      if (!r?.ok) return json({ok: false, reason: r?.reason || 'simulation refused'}, 409), true;
      return json({ok: true, order: b.orderId ? publicOrder(orchestrator.get(b.orderId)) : undefined}), true;
    }
    return false;
  };
}
