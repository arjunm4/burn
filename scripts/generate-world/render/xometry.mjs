// Xometry renderer (no writer). Quotes show every quoted tier; orders show the chosen tier and
// the status as of demo "now". Always the full window. Emits xometry/quotes.json and xometry/orders.json.
import { toMs, byId, resolveCtx, cmpTimeId, round2, json } from './common-b.mjs';

const TIER_LABEL = { economy: 'Economy', standard: 'Standard', expedite: 'Expedite', international_economy: 'International Economy' };
const TIER_ORDER = ['international_economy', 'economy', 'standard', 'expedite'];
const STATUS_LABEL = {
  quote: 'Quote', order_placed: 'Order Placed', dfm_review: 'DFM Review', dfm_action_required: 'DFM Review - Action Required',
  in_production: 'In Production', quality_inspection: 'Quality Inspection', shipped: 'Shipped', delivered: 'Delivered',
  cancelled: 'Cancelled', refunded: 'Refunded',
};
const PROCESS_LABEL = {
  cnc_milling_3axis: 'CNC Milling (3-axis)', cnc_milling_5axis: 'CNC Milling (5-axis)', cnc_turning: 'CNC Turning', cnc_mill_turn: 'CNC Mill-Turn',
};

function cadFor(part, rev) {
  return String(part.cad_file).replace(/_rev[^_.]+\.step$/i, `_rev${rev}.step`);
}

export function plan(world, ctx0 = {}) {
  const ctx = resolveCtx(world, ctx0);
  const nowMs = toMs(ctx.demoNow);
  const parts = byId(world.parts);
  const people = byId(world.people);
  const orders = (world.orders || []).filter((o) => o.type === 'xometry_cnc')
    .sort((a, b) => cmpTimeId(a.quoted_at, a.id, b.quoted_at, b.id));
  const records = [];
  for (const o of orders) {
    if (toMs(o.quoted_at) > nowMs) continue;
    const email = (id) => people.get(id)?.email || null;
    const items = o.lines.map((l) => {
      const p = parts.get(l.part);
      return {
        part_number: p.part_number, part_name: p.name, file_name: cadFor(p, l.revision), revision: l.revision,
        material: p.material, process: PROCESS_LABEL[p.process] || p.process, finish: p.finish, tolerance: p.tolerance,
        quantity: l.quantity,
      };
    });
    const tiers = o.tiers.slice().sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier)).map((t) => ({
      lead_time: TIER_LABEL[t.tier], lead_time_business_days: t.lead_business_days,
      subtotal: round2(t.subtotal_usd), shipping: round2(t.shipping_usd), tax: round2(t.tax_usd), total: round2(t.total_usd),
      estimated_ship_date: t.est_ship, estimated_delivery_date: t.est_delivery,
    }));
    const quote = {
      quote_id: o.quote_id, created_at: o.quoted_at, expires_on: o.quote_expires, customer_email: email(o.requester),
      shipping_address: 'Flintlock Robotics, Receiving', parts: items, lead_time_options: tiers,
      status: toMs(o.placed_at) <= nowMs ? 'Ordered' : (toMs(o.quote_expires) < nowMs ? 'Expired' : 'Open'),
      order_number: toMs(o.placed_at) <= nowMs ? o.order_number : null,
    };
    records.push({ record_id: o.quote_id, source: 'xometry', kind: 'quote', order: o.id, events: [], data: quote });
    if (toMs(o.placed_at) > nowMs) continue;
    const hist = (o.status || []).filter((h) => toMs(h.known_at) <= nowMs)
      .map((h) => ({ status: STATUS_LABEL[h.value] || h.value, at: h.effective && h.effective.length > 10 ? h.effective : h.known_at }));
    const shippedKnown = (o.status || []).some((h) => h.value === 'shipped' && toMs(h.known_at) <= nowMs);
    const delivered = o.delivered_at && toMs(o.delivered_at) <= nowMs ? o.delivered_at : null;
    const chosen = o.tiers.find((t) => t.tier === o.chosen_tier);
    const order = {
      order_number: o.order_number, quote_id: o.quote_id, placed_at: o.placed_at, placed_by: email(o.placer),
      requested_by: email(o.requester), lead_time: TIER_LABEL[o.chosen_tier], lead_time_business_days: chosen.lead_business_days,
      line_items: o.lines.map((l, i) => ({ ...items[i], unit_price: round2(l.unit_price_usd), line_total: round2(l.unit_price_usd * l.quantity) })),
      subtotal: round2(o.subtotal_usd), shipping: round2(o.shipping_usd), tax: round2(o.tax_usd), total: round2(o.total_usd),
      promised_delivery_date: o.promised_date, estimated_ship_date: chosen.est_ship,
      status: hist.length ? hist[hist.length - 1].status : STATUS_LABEL.order_placed,
      status_history: hist,
      carrier: shippedKnown ? o.carrier || null : null, tracking_number: shippedKnown ? o.tracking || null : null,
      delivered_at: delivered, certifications: o.certifications || [],
    };
    records.push({ record_id: o.order_number, source: 'xometry', kind: 'order', order: o.id, events: [], data: order });
  }
  return { records, jobs: [] };
}

export function emit(records) {
  const quotes = records.filter((r) => r.kind === 'quote').map((r) => r.data)
    .sort((a, b) => cmpTimeId(a.created_at, a.quote_id, b.created_at, b.quote_id));
  const orders = records.filter((r) => r.kind === 'order').map((r) => r.data)
    .sort((a, b) => cmpTimeId(a.placed_at, a.order_number, b.placed_at, b.order_number));
  return {
    files: [
      { path: 'xometry/orders.json', content: json({ orders }) },
      { path: 'xometry/quotes.json', content: json({ quotes }) },
    ],
  };
}
