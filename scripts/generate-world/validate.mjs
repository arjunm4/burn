#!/usr/bin/env node
// Validates a world (and optionally its answer key) against scripts/generate-world/schema.mjs.
// CLI: node scripts/generate-world/validate.mjs <world.json> [answers.json]   (exit 1 on errors)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ENUMS, SPEC, ANSWERS_SPEC, COLLECTIONS, checkTime, isDate } from './schema.mjs';

export function validateWorld(world, answers) {
  const errors = [];
  const warnings = [];
  const counts = {};
  const err = (p, m) => errors.push(`${p}: ${m}`);

  if (!world || typeof world !== 'object') return { errors: ['world: not an object'], warnings, counts };

  // ---- window ----
  let winStart = -Infinity;
  let winEnd = Infinity;
  if (world.meta?.window) {
    winStart = Date.parse(world.meta.window.start);
    winEnd = Date.parse(world.meta.window.end);
  }

  // ---- id index ----
  const ids = {}; // coll -> Set
  const all = new Map(); // id -> coll
  for (const c of COLLECTIONS) {
    const arr = world[c];
    if (!Array.isArray(arr)) { err(c, 'missing top-level array'); ids[c] = new Set(); continue; }
    ids[c] = new Set();
    arr.forEach((x, i) => {
      if (!x || typeof x.id !== 'string') return err(`${c}[${i}]`, 'missing id');
      if (all.has(x.id)) err(`${c}[${i}]`, `duplicate id ${x.id} (also in ${all.get(x.id)})`);
      all.set(x.id, c);
      ids[c].add(x.id);
    });
  }
  // bookings are referenced by conflict_with
  for (const c of ['test_rigs', 'resources']) {
    for (const r of world[c] || []) for (const b of r.bookings || []) {
      if (b?.id) { if (all.has(b.id)) err(`${c}.${r.id}.bookings`, `duplicate id ${b.id}`); all.set(b.id, 'bookings'); }
    }
  }

  const resolves = (coll, v) => (coll === 'any' ? all.has(v) : ids[coll]?.has(v));

  // ---- generic checker ----
  function checkHist(path, v, inner) {
    if (!Array.isArray(v)) return err(path, 'history must be an array');
    if (v.length === 0) return err(path, 'history is empty');
    let prev = -Infinity;
    v.forEach((h, i) => {
      const p = `${path}[${i}]`;
      if (!h || typeof h !== 'object') return err(p, 'history entry not an object');
      if (!('value' in h)) err(p, 'history entry missing value');
      else if (h.value !== null) checkType(`${p}.value`, h.value, inner);
      checkType(`${p}.known_at`, h.known_at, 'time');
      if (h.effective != null && !isDate(h.effective) && checkTime(h.effective)) err(`${p}.effective`, 'must be a date or Pacific time');
      if (h.by != null && !resolves('people', h.by)) err(`${p}.by`, `unresolved person ${h.by}`);
      if (h.where != null && !resolves('events', h.where)) err(`${p}.where`, `unresolved event ${h.where}`);
      const t = Date.parse(h.known_at);
      if (t < prev) err(p, 'history not ordered by known_at');
      if (!Number.isNaN(t)) prev = t;
    });
  }

  function checkType(path, v, type) {
    if (type.startsWith('[') && type.endsWith(']')) {
      if (!Array.isArray(v)) return err(path, 'must be an array');
      v.forEach((x, i) => checkType(`${path}[${i}]`, x, type.slice(1, -1)));
      return;
    }
    if (type.startsWith('hist:')) return checkHist(path, v, type.slice(5));
    if (type.startsWith('enum:')) {
      const list = ENUMS[type.slice(5)];
      if (!list.includes(v)) err(path, `"${v}" not in enum ${type.slice(5)}`);
      return;
    }
    if (type.startsWith('ref:')) {
      if (typeof v !== 'string') return err(path, 'reference must be an id string');
      if (!resolves(type.slice(4), v)) err(path, `unresolved ${type.slice(4)} reference ${v}`);
      return;
    }
    switch (type) {
      case 'str': if (typeof v !== 'string') err(path, 'must be a string'); break;
      case 'num': if (typeof v !== 'number' || !Number.isFinite(v)) err(path, 'must be a number'); break;
      case 'int': if (!Number.isInteger(v)) err(path, 'must be an integer'); break;
      case 'bool': if (typeof v !== 'boolean') err(path, 'must be a boolean'); break;
      case 'date': if (!isDate(v)) err(path, `"${v}" is not YYYY-MM-DD`); break;
      case 'time':
      case 'ftime': {
        const r = checkTime(v);
        if (r) return err(path, `"${v}" ${r}`);
        const t = Date.parse(v);
        if (t < winStart || (type === 'time' && t > winEnd)) err(path, `"${v}" outside the window`);
        break;
      }
      case 'obj': if (!v || typeof v !== 'object' || Array.isArray(v)) err(path, 'must be an object'); break;
      case 'any': break;
      default: err(path, `schema bug: unknown type ${type}`);
    }
  }

  function checkSpec(path, obj, spec) {
    if (Array.isArray(spec)) {
      if (!Array.isArray(obj)) return err(path, 'must be an array');
      obj.forEach((x, i) => checkSpec(`${path}[${i}]`, x, spec[0]));
      return;
    }
    if (typeof spec === 'string') {
      const req = spec.endsWith('!');
      const type = spec.replace(/[!?]$/, '');
      if (obj === undefined || obj === null) { if (req) err(path, 'required'); return; }
      return checkType(path, obj, type);
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return err(path, 'must be an object');
    for (const [k, s] of Object.entries(spec)) {
      const v = obj[k];
      if (typeof s !== 'string' && (v === undefined || v === null)) continue; // nested objects/arrays optional unless stated below
      checkSpec(`${path}.${k}`, v, s);
    }
  }

  // ---- meta, finance, demo ----
  checkSpec('meta', world.meta, SPEC.meta);
  if (world.meta?.schema_version == null) err('meta', 'missing');
  checkSpec('finance', world.finance, SPEC.finance);
  if (!world.finance) err('finance', 'missing');
  if (world.demo) checkSpec('demo', world.demo, SPEC.demo); else err('demo', 'missing');

  // ---- collections ----
  for (const c of COLLECTIONS) {
    (world[c] || []).forEach((x, i) => {
      const path = `${c}[${i}](${x?.id})`;
      let spec = SPEC[c];
      if (c === 'orders') spec = x?.type === 'xometry_cnc' ? SPEC.orders_xometry : SPEC.orders_other;
      checkSpec(path, x, spec);
    });
    counts[c] = (world[c] || []).length;
  }

  // ---- cross-field rules ----
  const xo = (world.orders || []).filter((o) => o.type === 'xometry_cnc');
  counts.orders_xometry = xo.length;
  counts.orders_other = (world.orders || []).length - xo.length;
  for (const o of xo) {
    const n = (o.tiers || []).length;
    if (n < 2 || n > 4) err(`orders(${o.id}).tiers`, `must have 2-4 tiers, has ${n}`);
    if (!(o.tiers || []).some((t) => t.tier === o.chosen_tier)) err(`orders(${o.id}).chosen_tier`, 'not among tiers');
    if (!(o.lines || []).length) err(`orders(${o.id}).lines`, 'at least one line required');
    if (o.vendor !== 'v-xometry') err(`orders(${o.id}).vendor`, 'Xometry orders use v-xometry');
    const sum = +(o.subtotal_usd + o.shipping_usd + o.tax_usd).toFixed(2);
    if (Math.abs(sum - o.total_usd) > 0.011) err(`orders(${o.id}).total_usd`, `${o.total_usd} != subtotal+shipping+tax ${sum}`);
    for (const t of o.tiers || []) {
      const ts = +(t.subtotal_usd + t.shipping_usd + t.tax_usd).toFixed(2);
      if (Math.abs(ts - t.total_usd) > 0.011) err(`orders(${o.id}).tiers(${t.tier}).total_usd`, `${t.total_usd} != subtotal+shipping+tax ${ts}`);
      if (t.tier === o.chosen_tier) {
        if (Math.abs(t.total_usd - o.total_usd) > 0.011) err(`orders(${o.id}).total_usd`, 'differs from the chosen tier total');
        if (t.est_delivery !== o.promised_date) err(`orders(${o.id}).promised_date`, 'differs from the chosen tier est_delivery');
      }
    }
    // economy < standard < expedite on price; the reverse on lead time
    const rank = ['economy', 'standard', 'expedite'];
    const ts3 = rank.map((r) => (o.tiers || []).find((t) => t.tier === r)).filter(Boolean);
    for (let i = 1; i < ts3.length; i++) {
      if (!(ts3[i - 1].subtotal_usd < ts3[i].subtotal_usd)) err(`orders(${o.id}).tiers`, `${ts3[i].tier} must cost more than ${ts3[i - 1].tier}`);
      if (!(ts3[i - 1].lead_business_days > ts3[i].lead_business_days)) err(`orders(${o.id}).tiers`, `${ts3[i].tier} must be faster than ${ts3[i - 1].tier}`);
    }
    const seq = ['quoted_at', 'requested_at', 'approved_at', 'placed_at'].map((k) => [k, Date.parse(o[k])]);
    for (let i = 1; i < seq.length; i++) if (seq[i][1] < seq[i - 1][1]) err(`orders(${o.id}).${seq[i][0]}`, `earlier than ${seq[i - 1][0]}`);
    for (const l of o.lines || []) {
      if (!l.demand) continue;
      const d = (world.demands || []).find((x) => x.id === l.demand);
      if (d && d.order !== o.id) err(`orders(${o.id}).lines`, `demand ${l.demand} points at order ${d.order}`);
    }
  }
  const placedAt = new Map(xo.map((o) => [o.id, Date.parse(o.placed_at)]));
  const partsOf = new Map(xo.map((o) => [o.id, new Set((o.lines || []).map((l) => l.part))]));
  const preT = new Map(xo.map((o) => [o.id, []]));
  for (const e of world.events || []) {
    const t = Date.parse(e.known_at);
    for (const id of e.orders || []) {
      if (!placedAt.has(id)) continue;
      if (!(t < placedAt.get(id))) err(`events(${e.id}).orders`, `${id} was placed before this event; list it in orders_after`);
      preT.get(id).push(e);
    }
    for (const id of e.orders_after || []) {
      if (placedAt.has(id) && t < placedAt.get(id)) err(`events(${e.id}).orders_after`, `${id} was placed after this event; list it in orders`);
    }
    if (e.truth !== 'true' && e.claim && e.claim.true_value === undefined) err(`events(${e.id}).claim.true_value`, 'required when truth is stale or wrong');
    if (e.corrects) {
      const c = (world.events || []).find((x) => x.id === e.corrects);
      if (c && Date.parse(c.known_at) > t) err(`events(${e.id}).corrects`, 'a correction must be later than its target');
    }
  }
  for (const o of xo) {
    const crumbs = preT.get(o.id).filter((e) => e.kind === 'crumb');
    const byId = crumbs.some((e) => (e.refs || []).some((r) => (r.id === o.id || partsOf.get(o.id).has(r.id)) && (r.mode === 'id' || r.mode === 'part_number')));
    if (o.link_quality === 'clean_id' && !byId) err(`orders(${o.id}).link_quality`, 'clean_id needs a crumb before T that refers to the part or order by id or part number');
    if (o.link_quality === 'alias_only' && (!crumbs.length || byId)) err(`orders(${o.id}).link_quality`, 'alias_only needs crumbs before T, none by id or part number');
    if (o.link_quality === 'never_discussed' && crumbs.length) err(`orders(${o.id}).link_quality`, 'never_discussed must have no crumbs before T');
  }
  for (const e of world.edges || []) {
    const n = (e.revealed_by || []).length;
    if (e.reveal === 'never' && n) err(`edges(${e.id}).revealed_by`, 'must be empty when reveal is never');
    if (e.reveal !== 'never' && !n) err(`edges(${e.id}).revealed_by`, `reveal ${e.reveal} needs at least one event`);
  }
  for (const s of world.slips || []) {
    const [a, b, c] = [s.occurs_at, s.discovered_at, s.announced_at].map((x) => (x ? Date.parse(x) : null));
    if (b != null && b < a) err(`slips(${s.id}).discovered_at`, 'earlier than occurs_at');
    if (c != null && c < (b ?? a)) err(`slips(${s.id}).announced_at`, 'earlier than discovery');
  }
  for (const e of world.events || []) {
    if (e.kind === 'crumb' && !e.claim) err(`events(${e.id}).claim`, 'crumbs need a typed claim');
    if (e.truth !== 'true' && !e.claim) err(`events(${e.id}).truth`, 'stale/wrong needs a claim');
    const w = e.where || {};
    const need = { slack: 'channel', jira: 'ticket', meeting: 'meeting', calendar: 'calendar' }[e.source];
    if (need && !w[need]) err(`events(${e.id}).where.${need}`, `required for source ${e.source}`);
  }
  for (const t of world.teams || []) {
    for (const m of t.members || []) {
      const p = (world.people || []).find((x) => x.id === m);
      if (p && p.team !== t.id) err(`teams(${t.id}).members`, `${m} has team ${p.team}`);
    }
  }
  const head = (world.teams || []).reduce((s, t) => s + (t.headcount || 0), 0);
  if (head && head !== (world.people || []).length) warnings.push(`teams headcount sums to ${head} but there are ${(world.people || []).length} people`);

  // ---- answers ----
  if (answers) {
    for (const k of Object.keys(ANSWERS_SPEC)) {
      if (!Array.isArray(answers[k])) { err(`answers.${k}`, 'missing array'); continue; }
      answers[k].forEach((a, i) => checkSpec(`answers.${k}[${i}]`, a, ANSWERS_SPEC[k]));
    }
    const ans = new Map();
    for (const a of answers.orders || []) {
      if (ans.has(a.order)) err('answers.orders', `duplicate entry for ${a.order}`);
      ans.set(a.order, a);
      const o = (world.orders || []).find((x) => x.id === a.order);
      if (o && o.type !== 'xometry_cnc') err('answers.orders', `${a.order} is not a Xometry order`);
      for (const b of Object.keys(a.true_pressure || {})) if (!ENUMS.time_band.includes(b)) err(`answers.orders(${a.order}).true_pressure`, `bad band ${b}`);
      for (const v of Object.values(a.true_pressure || {})) if (!ENUMS.pressure.includes(v)) err(`answers.orders(${a.order}).true_pressure`, `bad level ${v}`);
      for (const [b, v] of Object.entries(a.expressed_pressure || {})) if (!ENUMS.time_band.includes(b) || !ENUMS.pressure.includes(v)) err(`answers.orders(${a.order}).expressed_pressure`, `bad entry ${b}: ${v}`);
      if (!a.belief) err(`answers.orders(${a.order}).belief`, 'required');
      if (o && o.type === 'xometry_cnc') {
        const got = new Set((a.tier_outcomes || []).map((t) => t.tier));
        for (const t of o.tiers || []) if (!got.has(t.tier)) err(`answers.orders(${a.order}).tier_outcomes`, `missing quoted tier ${t.tier}`);
        for (const t of a.tier_outcomes || []) if (t.days_gained < 0) err(`answers.orders(${a.order}).tier_outcomes`, 'days_gained must be >= 0');
        const T = Date.parse(o.placed_at);
        const when = (id) => Date.parse((world.events || []).find((e) => e.id === id)?.known_at);
        for (const id of a.crumbs || []) if (when(id) >= T) err(`answers.orders(${a.order}).crumbs`, `${id} is not before T; use crumbs_after`);
        for (const id of a.crumbs_after || []) if (when(id) < T) err(`answers.orders(${a.order}).crumbs_after`, `${id} is before T`);
        const exp = o.chosen_tier === 'expedite';
        if (a.hidden_reason === 'no_gain_other_input_later' && (!exp || a.expedite_helped !== false)) err(`answers.orders(${a.order}).hidden_reason`, 'no_gain needs expedite chosen and expedite_helped false');
        if (['genuine_gain', 'test_slot_cliff'].includes(a.hidden_reason) && exp && a.expedite_helped !== true) err(`answers.orders(${a.order}).hidden_reason`, `${a.hidden_reason} with expedite needs expedite_helped true`);
        if (a.hidden_reason === 'budget_squeeze' && exp) err(`answers.orders(${a.order}).hidden_reason`, 'budget_squeeze cannot choose expedite');
      }
    }
    for (const o of xo) if (!ans.has(o.id)) err('answers.orders', `no answers entry for Xometry order ${o.id}`);
    counts.answers_orders = ans.size;
    counts.answers_assembly_weeks = (answers.assembly_weeks || []).length;
  } else {
    warnings.push('no answers given; answer-key checks skipped');
  }

  counts.events_crumb = (world.events || []).filter((e) => e.kind === 'crumb').length;
  counts.events_background = (world.events || []).filter((e) => e.kind === 'background').length;
  return { errors, warnings, counts };
}

// Answers checks need the world's ids; validateWorld does both. This alias reads better in tests.
export const validate = validateWorld;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [wp, ap] = process.argv.slice(2);
  if (!wp) { console.error('usage: node scripts/generate-world/validate.mjs <world.json> [answers.json]'); process.exit(2); }
  const world = JSON.parse(readFileSync(wp, 'utf8'));
  const answers = ap ? JSON.parse(readFileSync(ap, 'utf8')) : undefined;
  const { errors, warnings, counts } = validateWorld(world, answers);
  for (const w of warnings) console.log(`warning: ${w}`);
  for (const e of errors.slice(0, 200)) console.log(`error: ${e}`);
  if (errors.length > 200) console.log(`... ${errors.length - 200} more errors`);
  console.log('counts:', Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' '));
  console.log(errors.length ? `FAIL: ${errors.length} error(s)` : 'OK: world is valid');
  process.exit(errors.length ? 1 : 0);
}
