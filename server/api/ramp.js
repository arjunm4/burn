// The Ramp side of the demo: what the approver sees. Read-only listings over the Ramp
// mock's records, joined with the order they belong to, plus one SSE stream so the
// simulated inbox updates when the flow moves. Mock mode only: there is no sandbox, and
// a real Ramp would show these in its own UI. Approve/reject stay on /api/ramp/simulate/*.
import {AppError} from '../contracts.js';

const RAMP_EVENTS = /^(ramp\.|card\.|charge\.|booked$|booking\.|order\.frozen$|placement\.)/;

// The slice of an order an approver may see: never the card credential, never the CAD.
function orderView(orchestrator, id) {
  let o; try { o = id ? orchestrator.get(id) : null; } catch { return null; }
  if (!o) return null;
  const tier = o.frozen && o.quote?.options.find(x => x.tier === o.frozen.tier);
  return {id: o.id, state: o.state, entry: {name: o.entry.name, note: o.entry.note, engineer: o.entry.engineer}, milestoneLabel: o.context?.milestoneLabel || null,
    decisionText: o.decision?.text || null, cutoff: o.quote?.cutoff || null, vendorOrderId: o.vendorOrder?.vendorOrderId || null,
    frozen: o.frozen ? {tier: o.frozen.tier, priceCents: o.frozen.priceCents, readyOn: tier?.readyOn || null, fields: o.frozen.fields, vendor: o.frozen.vendor} : null};
}

export function rampRoutes({ramp, orchestrator}) {
  const streams = new Set();
  orchestrator.bus.on('order', e => {
    if (!RAMP_EVENTS.test(e.type) || !streams.size) return;
    const line = `event: ramp.changed\ndata: ${JSON.stringify({type: 'ramp.changed', orderId: e.orderId, cause: e.type})}\n\n`;
    for (const res of streams) { if (res.destroyed) streams.delete(res); else res.write(line); }
  });
  const mockOnly = async () => { if (!ramp.simulate) throw new AppError('The Ramp view is only available in mock mode', 404); return ramp.simulate(); };

  return async function handle(req, res, pathname, json) {
    if (req.method !== 'GET') return false;
    if (pathname === '/api/ramp/requests') {
      const s = await mockOnly();
      return json({requests: s.list('request').map(r => {
        const order = orderView(orchestrator, r.orderId);
        return {id: r.id, orderId: r.orderId, status: r.status, amountCents: r.line_items?.[0]?.amount?.amount ?? null, currency: r.currency, name: r.name,
          vendor: order?.frozen?.vendor || 'xometry', requester: r.request_owner_id, justification: r.field_answers?.justification || '', cutoff: order?.cutoff || null,
          chosenTier: r.field_answers?.chosen_tier || null, recommendedTier: r.field_answers?.recommended_tier || null,
          specHash: r.specHash, decisionRevision: r.decisionRevision, createdAt: r.created_at, approvedAt: r.approvedAt || null, order};
      })}), true;
    }
    if (pathname === '/api/ramp/cards') {
      const s = await mockOnly();
      return json({cards: s.list('card').map(c => ({id: c.id, orderId: c.orderId, last4: c.last4, limitCents: c.spending_restrictions?.limit ?? null, spentCents: c.spentCents || 0,
        allowedVendors: c.allowed_vendors, lockDate: c.lock_date, state: Date.parse(c.lock_date) <= Date.now() ? 'locked' : (c.spentCents || 0) >= (c.spending_restrictions?.limit ?? 0) ? 'spent' : 'active',
        order: orderView(orchestrator, c.orderId)}))}), true;
    }
    if (pathname === '/api/ramp/transactions') {
      const s = await mockOnly();
      return json({transactions: s.list('transaction').map(t => {
        const b = s.inspect('booking', t.id);   // bookings are keyed by transaction id
        return {id: t.id, orderId: t.orderId, cardId: t.card_id, amountCents: t.amount, merchant: t.merchant_name, status: t.status, at: t.created_at || null,
          booking: b ? {memo: b.memo ?? null, receipt: b.receipt ? {fileName: b.receipt.name} : null, coding: b.coding ?? null} : null, order: orderView(orchestrator, t.orderId)};
      })}), true;
    }
    if (pathname === '/api/ramp/stream') {
      await mockOnly();
      res.writeHead(200, {'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive'});
      res.write(`event: ramp.changed\ndata: ${JSON.stringify({type: 'ramp.changed', cause: 'open'})}\n\n`);
      streams.add(res);
      const ping = setInterval(() => { if (!res.destroyed) res.write(': ping\n\n'); }, 15000);
      req.on('close', () => { clearInterval(ping); streams.delete(res); });
      return true;
    }
    return false;
  };
}
