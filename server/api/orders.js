// HTTP API for orders (mounted from server/index.js). JSON in, JSON out; one SSE stream
// per order for live progress. CAD files arrive as base64 in JSON (STEP files are small
// enough), capped at 20 MB. Mutations carry expectedRevision and get 409 on conflict.
import {AppError} from '../contracts.js';

const LIMIT = 20 * 1024 * 1024;
async function body(req) {
  let text = '';
  for await (const chunk of req) { text += chunk; if (text.length > LIMIT) throw new AppError('Request too large', 413); }
  try { return JSON.parse(text || '{}'); } catch { throw new AppError('Invalid JSON'); }
}
const cadFrom = b => (b?.cad?.base64 ? {fileName: b.cad.fileName || 'part.step', bytes: Buffer.from(b.cad.base64, 'base64')} : null);
// What the UI may see: never the card credential, never the CAD bytes.
export function publicOrder(o) {
  if (!o) return o;
  const {context, ramp, ...rest} = o;
  const {cad, graph, ...ctx} = context || {};
  const {credentialRef, ...r} = ramp || {};
  return {...rest, context: ctx, ramp: r};
}

export function ordersRoutes(orchestrator, {ramp, vendor, config}) {
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
      if (!action && req.method === 'GET') return json({order: publicOrder(orchestrator.get(id)), events: orchestrator.events(id)}), true;
      if (action === 'events' && req.method === 'GET') return json({events: orchestrator.events(id)}), true;
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
    // Ramp inbound events. The client verifies the signature in sandbox mode; the mock posts to itself.
    if (pathname === '/api/ramp/webhook' && req.method === 'POST') {
      const event = await body(req);
      if (ramp.verifyWebhook && !ramp.verifyWebhook(req.headers['x-ramp-signature'], event)) throw new AppError('Bad signature', 401);
      return json(await orchestrator.handleRampEvent(event)), true;
    }
    // Mock-only controls: the stand-in for approving in demo.ramp.com and ⌘J "add transaction".
    const sim = pathname.match(/^\/api\/ramp\/simulate\/(approve|reject|charge)$/);
    if (sim && req.method === 'POST') {
      sameOrigin(); if (!ramp.simulate) throw new AppError('Simulation is only available in mock mode', 404);
      const b = await body(req); const s = await ramp.simulate();
      if (sim[1] === 'approve') { await s.approve(b.requestId); }
      else if (sim[1] === 'reject') { await s.reject(b.requestId); }
      else { const order = orchestrator.get(b.orderId); await s.charge(order.ramp.cardId, order.frozen.priceCents); }
      return json({ok: true, order: b.orderId ? publicOrder(orchestrator.get(b.orderId)) : undefined}), true;
    }
    return false;
  };
}
