// The training anchor: link Ramp card charges to Xometry orders.
// Contract: docs/build/time-value-impl.md, "server/timevalue/labels.mjs".
//
//   linkRampToXometry({ramp, xometry}) -> links
//     links: [{order_number, quote_id, ramp_id, T, tier, total, requester_email, placer_email,
//              part_numbers, tiers: [{tier, total, lead_days, est_delivery}]}]   sorted by (T, order_number)
//     links.unlinked: [{ramp_id, amount, at, descriptor, reason}]   Xometry charges with no order (count toward
//                     the link rate, never toward training)
//     links.orders_unlinked: [order_number]                         orders no charge matched
//     links.summary: {charges, linked, unlinked, link_rate, orders, orders_linked, order_link_rate}
//   (unlinked / orders_unlinked / summary are non-enumerable properties of the returned array, so it
//    still behaves as the plain array of the contract.)
//
// Match rule: a Ramp card transaction whose merchant is Xometry pairs with the Xometry order of the same
// total (within $0.01) whose placed_at is within 1 day of user_transaction_time. One-to-one; when several
// pairs qualify, the closest in time wins (ties by ids). Declined, refunded or negative charges are skipped
// as charges (they are not purchases) and are not counted.
const DAY = 86400e3;

export const tierKey = (s) => (s == null ? null : String(s).trim().toLowerCase().replace(/[\s-]+/g, '_'));
const isXometry = (t) => /xometry/i.test(`${t.merchant_name ?? ''} ${t.merchant_descriptor ?? ''}`);
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function linkRampToXometry({ ramp, xometry }) {
  const charges = (ramp?.transactions || []).filter(
    (t) => isXometry(t) && t.state !== 'DECLINED' && Number(t.amount) > 0 && !t.original_transaction_id,
  );
  const orders = xometry?.orders || [];
  const quotes = new Map((xometry?.quotes || []).map((q) => [q.quote_id, q]));

  // candidate pairs, bucketed by cents so this stays linear-ish at any volume
  const byCents = new Map();
  for (const o of orders) {
    const c = Math.round(Number(o.total) * 100);
    if (!byCents.has(c)) byCents.set(c, []);
    byCents.get(c).push(o);
  }
  const pairs = [];
  for (const t of charges) {
    const tm = Date.parse(t.user_transaction_time);
    const c = Math.round(Number(t.amount) * 100);
    for (const k of [c - 1, c, c + 1]) {
      for (const o of byCents.get(k) || []) {
        if (Math.abs(Number(o.total) - Number(t.amount)) > 0.01 + 1e-9) continue;
        const dt = Math.abs(Date.parse(o.placed_at) - tm);
        if (dt <= DAY) pairs.push({ t, o, dt });
      }
    }
  }
  pairs.sort((a, b) => a.dt - b.dt || cmp(a.o.order_number, b.o.order_number) || cmp(a.t.id, b.t.id));
  const usedT = new Set();
  const usedO = new Set();
  const links = [];
  for (const { t, o } of pairs) {
    if (usedT.has(t.id) || usedO.has(o.order_number)) continue;
    usedT.add(t.id);
    usedO.add(o.order_number);
    const q = quotes.get(o.quote_id);
    links.push({
      order_number: o.order_number,
      quote_id: o.quote_id ?? null,
      ramp_id: t.id,
      T: o.placed_at,
      tier: tierKey(o.lead_time),
      total: o.total,
      requester_email: o.requested_by ?? null,
      placer_email: o.placed_by ?? null,
      part_numbers: [...new Set((o.line_items || []).map((l) => l.part_number).filter(Boolean))],
      tiers: q
        ? (q.lead_time_options || []).map((x) => ({
            tier: tierKey(x.lead_time), total: x.total, lead_days: x.lead_time_business_days ?? null,
            est_delivery: x.estimated_delivery_date ?? null,
          }))
        : [],
    });
  }
  links.sort((a, b) => Date.parse(a.T) - Date.parse(b.T) || cmp(a.order_number, b.order_number));

  const unlinked = charges
    .filter((t) => !usedT.has(t.id))
    .map((t) => {
      const sameAmount = orders.some((o) => Math.abs(Number(o.total) - Number(t.amount)) <= 0.01 + 1e-9);
      return {
        ramp_id: t.id, amount: t.amount, at: t.user_transaction_time, descriptor: t.merchant_descriptor ?? null,
        reason: sameAmount ? 'no order with this total placed within 1 day' : 'no order with this total',
      };
    })
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || cmp(a.ramp_id, b.ramp_id));
  const ordersUnlinked = orders.map((o) => o.order_number).filter((n) => !usedO.has(n)).sort();
  const summary = {
    charges: charges.length,
    linked: links.length,
    unlinked: unlinked.length,
    link_rate: charges.length ? links.length / charges.length : null,
    orders: orders.length,
    orders_linked: links.length,
    order_link_rate: orders.length ? links.length / orders.length : null,
  };
  Object.defineProperties(links, {
    unlinked: { value: unlinked, enumerable: false },
    orders_unlinked: { value: ordersUnlinked, enumerable: false },
    summary: { value: summary, enumerable: false },
  });
  return links;
}

// Usable for training/testing: linked, and T at or after `from` (text start + 30 days).
export function usableLinks(links, from = '2026-09-10T00:00:00-07:00') {
  const f = Date.parse(from);
  return links.filter((l) => Date.parse(l.T) >= f);
}
