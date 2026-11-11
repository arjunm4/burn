// Ramp renderer (no writer). Card transactions and bills for every vendor in Ramp's Transaction
// shape, as of demo "now". Memos come from code templates. Always the full window.
// Emits ramp/transactions.json and ramp/bills.json.
import { toMs, byId, resolveCtx, cmpTimeId, round2, json, uuidFrom, pick, dateOf, addDays } from './common-b.mjs';

const SK_CATEGORY = {
  cnc_xometry: 'Manufacturing Services', fasteners: 'Industrial Supplies', amazon_consumables: 'Supplies',
  electronics: 'Electronics', pcb: 'Electronics', other_custom_fab: 'Manufacturing Services',
  motors_gearing_bearings: 'Industrial Supplies', sensors: 'Electronics', batteries_power: 'Electronics',
  tools_test_equipment: 'Tools and Equipment', raw_stock: 'Industrial Supplies', shipping: 'Shipping', saas: 'Software',
};

// Merchant category codes (ISO 18245) by vendor category, with a few vendor-specific overrides.
// Codes are plausible, not verified against real card statements; consistent per vendor.
const MCC = {
  cnc_xometry: ['5085', 'Industrial Supplies (Not Elsewhere Classified)'],
  fasteners: ['5072', 'Hardware Equipment and Supplies'],
  amazon_consumables: ['5999', 'Miscellaneous and Specialty Retail Stores'],
  electronics: ['5065', 'Electrical Parts and Equipment'],
  pcb: ['5065', 'Electrical Parts and Equipment'],
  other_custom_fab: ['5085', 'Industrial Supplies (Not Elsewhere Classified)'],
  motors_gearing_bearings: ['5085', 'Industrial Supplies (Not Elsewhere Classified)'],
  sensors: ['5065', 'Electrical Parts and Equipment'],
  batteries_power: ['5065', 'Electrical Parts and Equipment'],
  tools_test_equipment: ['5085', 'Industrial Supplies (Not Elsewhere Classified)'],
  raw_stock: ['5051', 'Metal Service Centers and Offices'],
  shipping: ['4215', 'Courier Services (Air and Ground) and Freight Forwarders'],
  saas: ['5734', 'Computer Software Stores'],
};
const MCC_BY_NAME = [
  [/home depot/i, ['5200', 'Home Supply Warehouse Stores']],
  [/harbor freight/i, ['5251', 'Hardware Stores']],
  [/uline/i, ['5111', 'Stationery, Office Supplies, Printing and Writing Paper']],
  [/amazon web services|aws|google cloud|github|slack|atlassian|jira/i, ['5734', 'Computer Software Stores']],
];
export function mccFor(vendor, merchantName) {
  for (const [re, v] of MCC_BY_NAME) if (re.test(merchantName || vendor?.name || '')) return v;
  return MCC[vendor?.category] || ['5999', 'Miscellaneous and Specialty Retail Stores'];
}

function xometryMemo(o, parts, label) {
  const p = parts.get(o.lines[0].part);
  const qty = o.lines.reduce((s, l) => s + l.quantity, 0);
  const alias = (p.aliases || [])[0] || p.name.toLowerCase();
  const more = o.lines.length > 1 ? ` +${o.lines.length - 1}` : '';
  return pick([
    `${p.part_number} x${o.lines[0].quantity}${more}`,
    `${alias} rev ${o.lines[0].revision}${more}`,
    `CNC parts, ${o.order_number}`,
    `xometry ${o.order_number}`,
    `${alias}${more} (${qty} pcs)`,
    `machined ${alias}s`,
  ], label);
}

function otherMemo(o, label) {
  const d = String(o.description || '').trim();
  if (o.recurring) return pick([d, 'monthly subscription', d.toLowerCase()], label);
  const short = d.split(/[,(]/)[0].trim();
  return pick([d, short, short.toLowerCase(), `${short} for the lab`], label);
}

export function plan(world, ctx0 = {}) {
  const ctx = resolveCtx(world, ctx0);
  const nowMs = toMs(ctx.demoNow);
  const today = dateOf(ctx.demoNow);
  const people = byId(world.people);
  const parts = byId(world.parts);
  const orders = byId(world.orders);
  const vendors = byId(world.vendors);
  const gl = new Map((world.finance?.gl_accounts || []).map((g) => [g.id, g.name]));
  const pcode = new Map((world.finance?.project_codes || []).map((p) => [p.code, p.name]));
  const txs = (world.ramp_transactions || []).filter((t) => toMs(t.user_transaction_time) <= nowMs)
    .sort((a, b) => cmpTimeId(a.user_transaction_time, a.id, b.user_transaction_time, b.id));
  const records = [];
  for (const t of txs) {
    const o = t.order ? orders.get(t.order) : null;
    const v = (o ? vendors.get(o.vendor) : null) || (world.vendors || []).find((x) => x.name === t.merchant_name) || null;
    const [mccCode, mccDesc] = t.mcc ? [t.mcc, null] : mccFor(v, t.merchant_name);
    const holder = people.get(t.card_holder);
    const [first, ...rest] = String(holder?.name || '').split(' ');
    const settled = t.settlement_date && t.settlement_date <= today;
    const state = t.state === 'DECLINED' ? 'DECLINED' : settled ? 'CLEARED' : 'PENDING';
    let memo = null;
    if (t.memo_present && o) memo = o.type === 'xometry_cnc' ? xometryMemo(o, parts, `memo:${t.id}`) : otherMemo(o, `memo:${t.id}`);
    if (t.kind === 'refund' && memo) memo = `refund - ${memo}`;
    const afs = [];
    if (t.gl_account) afs.push({ category_info: { type: 'GL_ACCOUNT', name: 'GL Account' }, external_code: t.gl_account, name: `${t.gl_account} ${gl.get(t.gl_account) || ''}`.trim() });
    if (t.project_code) afs.push({ category_info: { type: 'OTHER', name: 'Project' }, external_code: t.project_code, name: pcode.get(t.project_code) || t.project_code });
    const category = v?.category || o?.category || null;
    const base = {
      id: t.id,
      amount: round2(t.amount_usd),
      currency_code: 'USD',
      state,
      user_transaction_time: t.user_transaction_time,
      settlement_date: state === 'CLEARED' ? t.settlement_date : null,
      accounting_date: state === 'CLEARED' ? t.settlement_date : null,
      merchant_name: t.merchant_name,
      merchant_descriptor: t.merchant_descriptor,
      merchant_id: uuidFrom(`merchant:${t.merchant_name}`),
      merchant_category_code: mccCode,
      merchant_category_code_description: mccDesc ?? mccFor(v, t.merchant_name)[1],
      sk_category_name: category ? SK_CATEGORY[category] || null : null,
      memo,
      receipts: t.receipt_present ? [uuidFrom(`receipt:${t.id}`)] : [],
      accounting_field_selections: afs,
      original_transaction_id: t.original_transaction_id ?? null,
    };
    let data;
    if (t.instrument === 'card') {
      data = {
        ...base,
        card_id: t.card_id ?? null,
        card_holder: { first_name: first, last_name: rest.join(' '), user_id: holder?.ramp_user_id ?? null, department_name: t.department ?? null },
        policy_violations: !t.receipt_present && Math.abs(t.amount_usd) >= 75 && state === 'CLEARED'
          ? [{ type: 'MISSING_RECEIPT', memo: 'Receipt required for transactions over $75' }] : [],
        sync_status: state === 'CLEARED' && toMs(`${addDays(t.settlement_date, 5)}T00:00:00-08:00`) <= nowMs ? 'SYNCED' : 'NOT_SYNC_READY',
      };
    } else {
      const issued = dateOf(t.user_transaction_time);
      const due = addDays(issued, 30);
      data = {
        id: t.id,
        vendor_name: t.merchant_name,
        invoice_number: `INV-${String(1000 + (parseInt(t.id.replace(/-/g, '').slice(0, 8), 16) % 900000)).padStart(6, '0')}`,
        amount: round2(t.amount_usd),
        currency_code: 'USD',
        issued_at: issued,
        due_at: due,
        status: state === 'CLEARED' ? 'PAID' : state === 'DECLINED' ? 'REJECTED' : 'APPROVED',
        payment_date: state === 'CLEARED' ? t.settlement_date : null,
        created_by: { first_name: first, last_name: rest.join(' '), user_id: holder?.ramp_user_id ?? null, department_name: t.department ?? null },
        memo,
        attachments: base.receipts,
        accounting_field_selections: afs,
        original_transaction_id: base.original_transaction_id,
      };
    }
    records.push({ record_id: t.id, source: 'ramp', kind: t.instrument === 'card' ? 'transaction' : 'bill', order: t.order ?? null, events: [], data });
  }
  return { records, jobs: [] };
}

export function emit(records) {
  const sortT = (a, b) => cmpTimeId(a.user_transaction_time || a.issued_at, a.id, b.user_transaction_time || b.issued_at, b.id);
  const tx = records.filter((r) => r.kind === 'transaction').map((r) => r.data).sort(sortT);
  const bills = records.filter((r) => r.kind === 'bill').map((r) => r.data).sort(sortT);
  return {
    files: [
      { path: 'ramp/bills.json', content: json({ data: bills }) },
      { path: 'ramp/transactions.json', content: json({ data: tx }) },
    ],
  };
}
