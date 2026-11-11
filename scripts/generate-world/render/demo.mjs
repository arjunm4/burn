// Demo renderer (no writer). What a person or a mocked service would legitimately see for the demo
// order, from the world's pinned demo block: demo/quote.json, demo/part-entry.json,
// demo/live-changes.json, demo/policy.json. No case labels, no truth, nothing hidden (I20).
import { toMs, byId, resolveCtx, beliefAt, md, json, round2, firstName } from './common-b.mjs';

const PROCESS_LABEL = {
  cnc_milling_3axis: 'CNC Milling (3-axis)', cnc_milling_5axis: 'CNC Milling (5-axis)', cnc_turning: 'CNC Turning', cnc_mill_turn: 'CNC Mill-Turn',
};
const TIER_LABEL = { economy: 'Economy', standard: 'Standard', expedite: 'Expedite', international_economy: 'International Economy' };
const TIER_ORDER = ['international_economy', 'economy', 'standard', 'expedite'];

function changeText(c, world) {
  const subj = (world.deliverables || []).find((d) => d.id === c.claim?.subject) || (world.parts || []).find((p) => p.id === c.claim?.subject);
  const what = subj ? subj.name.toLowerCase() : 'that';
  const v = c.claim?.value;
  if (c.claim?.kind === 'eta' && typeof v === 'string') return `heads up, vendor slipped the ${what} again. new ETA ${md(v)}`;
  if (c.claim?.kind === 'eta' && v && v.min && v.max) return `${what}: vendor won't commit to a date. somewhere between ${md(v.min)} and ${md(v.max)}`;
  return `update on the ${what}`;
}

export function plan(world, ctx0 = {}) {
  const ctx = resolveCtx(world, ctx0);
  const d = world.demo;
  if (!d) return { records: [], jobs: [] };
  const nowMs = toMs(ctx.demoNow);
  const people = byId(world.people);
  const parts = byId(world.parts);
  const tests = byId(world.tests);
  const channels = byId(world.channels);
  const part = parts.get(d.part);
  const req = people.get(d.requester);
  const cad = String(part.cad_file).replace(/_rev[^_.]+\.step$/i, `_rev${d.revision}.step`);
  const item = {
    part_number: part.part_number, part_name: part.name, file_name: cad, revision: d.revision,
    material: part.material, process: PROCESS_LABEL[part.process] || part.process, finish: part.finish, tolerance: part.tolerance,
    quantity: d.quantity,
  };
  // The demo block gives one all-in price per tier; it is shown as the total (no separate tax line is known).
  const quote = {
    quote_id: d.quote.quote_id, created_at: d.quote.captured_at, expires_on: d.quote.valid_until, customer_email: req.email,
    shipping_address: 'Flintlock Robotics, Receiving', parts: [item],
    lead_time_options: d.quote.tiers.slice().sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier)).map((t) => ({
      lead_time: TIER_LABEL[t.tier], lead_time_business_days: t.ready_working_day,
      subtotal: round2(t.price_usd), shipping: 0, tax: 0, total: round2(t.price_usd),
      estimated_ship_date: null, estimated_delivery_date: t.ready_date,
    })),
    status: 'Open', order_number: null,
  };
  const test = tests.get(d.test);
  const alias = (part.aliases || [])[0] || part.name.toLowerCase();
  const partEntry = {
    part_name: part.name, part_number: part.part_number, revision: d.revision, quantity: d.quantity, cad_file: cad,
    summary: `${d.quantity}x ${alias} rev ${d.revision} for the ${test ? test.name.toLowerCase() : 'test'}`,
    requester: { name: req.name, email: req.email },
    entered_at: d.quote.captured_at,
  };
  const changes = (d.live_changes || []).slice().sort((a, b) => (toMs(a.at) - toMs(b.at)) || (a.id < b.id ? -1 : 1)).map((c, i) => {
    const by = people.get(c.by);
    const ch = channels.get(c.where);
    return {
      order: i + 1,
      label: `Change ${i + 1}`,
      source: c.source,
      offset_minutes: Math.round((toMs(c.at) - nowMs) / 60000),
      message: c.source === 'slack'
        ? { type: 'message', channel: ch?.slack_id ?? null, channel_name: ch?.name ?? null, user: by?.slack_id ?? null, user_name: by?.display_name ?? firstName(by), text: changeText(c, world) }
        : { author: by?.name ?? null, where: ch?.name ?? null, text: changeText(c, world) },
    };
  });
  const policies = [];
  for (const m of (world.milestones || []).slice().sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const p = beliefAt(m.value_policy, nowMs);
    if (!p?.value || p.value.type === 'none') continue;
    const owner = people.get(p.by || m.owner);
    const date = beliefAt(m.date, nowMs)?.value ?? null;
    policies.push({
      milestone: m.name, milestone_date: date, type: p.value.type,
      usd_per_day: p.value.type === 'per_day' ? p.value.usd_per_day : null,
      curve: p.value.type === 'curve' ? p.value.curve : null,
      set_by: owner ? { name: owner.name, email: owner.email } : null, set_at: p.known_at,
    });
  }
  const rec = (record_id, file, data) => ({ record_id, source: 'demo', file, events: [], data });
  return {
    records: [
      rec('demo-quote', 'demo/quote.json', quote),
      rec('demo-part-entry', 'demo/part-entry.json', partEntry),
      rec('demo-live-changes', 'demo/live-changes.json', { changes }),
      rec('demo-policy', 'demo/policy.json', { policies }),
    ],
    jobs: [],
  };
}

export function emit(records) {
  return { files: records.map((r) => ({ path: r.file, content: json(r.data) })).sort((a, b) => (a.path < b.path ? -1 : 1)) };
}
