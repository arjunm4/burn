#!/usr/bin/env node
// checks: enforces the (C) invariants of simulation-spec §4 over the world, planned/, jobs/ and the
// assembled files; runs the learnability probe; writes coverage.json. Never fixes data.
// The only module besides the simulator that reads answers.json.
//
//   node scripts/generate-world/checks.mjs [--weeks 13] [--world fixtures/world] [--out fixtures/flintlock]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { toMs, dateOf, addDays, mondayOf, wdBetween, textStartFor } from './render/common-b.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

export const HIDDEN_KEYS = new Set([
  'true_value', 'truth', 'demands', 'slips', 'habit', 'habit_strength', 'wtp_per_day_usd', 'checks_dependencies',
  'expressiveness', 'tier_decided_by', 'need_identified_at', 'reveal', 'link_quality', 'budget_windows',
  'pressure_windows', 'hidden_reason', 'belief', 'true_need_date', 'true_links', 'links_revealed_before_t',
  'true_pressure', 'expressed_pressure', 'tier_outcomes', 'expedite_helped', 'break_even_usd_per_day',
  'dominating_input', 'crumbs_after', 'never_revealed', 'days_gained', 'true_slack_days', 'gated_date',
  'true_progress', 'true_rank', 'pressure_value', 'true_arrival', 'actual_date', 'actual_start', 'actual_end', 'actual_done',
]);
const REASON_LABELS = [
  'genuine_gain', 'test_slot_cliff', 'no_gain_other_input_later', 'pressure_manager_or_demo', 'ordered_late',
  'insurance_or_spare', 'personal_habit', 'budget_squeeze', 'cheap_default',
  'genuine schedule gain', 'test-slot cliff', 'test slot cliff', 'no gain because another input was later',
  'pressure from a manager or a demo date', 'insurance or spare', 'budget squeeze', 'cheap part, default tier',
];
const INTERNAL_ID = /(?<![\w-])(?<!cal-)(?:ord-[xo]-\d{5}|ev-\d{6}|dmd-\d{5}|slip-\d{5}|e-\d{5}|wi-\d{5}|bk-\d{5}|mtg-\d{5}|pw-\d{2}|bw-\d{2}|sl-[a-z][a-z0-9-]+|ms-[a-z][a-z0-9-]+|pt-[a-z][a-z0-9-]+|dl-[a-z][a-z0-9-]+|rig-[a-z][a-z0-9-]+|res-[a-z][a-z0-9-]+)(?![\w])/;
const STORYLINE_ID = /(?<![\w-])sl-[a-z][a-z0-9-]+/;

function parseArgs(argv) {
  const a = { weeks: null, world: path.join(ROOT, 'fixtures/world'), out: path.join(ROOT, 'fixtures/flintlock') };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--weeks') a.weeks = +argv[++i];
    else if (argv[i] === '--world') a.world = path.resolve(argv[++i]);
    else if (argv[i] === '--out') a.out = path.resolve(argv[++i]);
  }
  return a;
}

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
function walkFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkFiles(p));
    else out.push(p);
  }
  return out;
}
function walkJson(v, fn, keyPath = []) {
  if (Array.isArray(v)) v.forEach((x, i) => walkJson(x, fn, keyPath.concat(i)));
  else if (v && typeof v === 'object') {
    fn(v, keyPath);
    for (const [k, x] of Object.entries(v)) walkJson(x, fn, keyPath.concat(k));
  }
}
const quantile = (xs, q) => { const s = xs.slice().sort((a, b) => a - b); if (!s.length) return NaN; const i = (s.length - 1) * q; const lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo); };
const share = (xs, f) => (xs.length ? xs.filter(f).length / xs.length : 0);

export async function runChecks({ world: worldDir, out: outDir, weeks = null, writeCoverage = true } = {}) {
  const errors = [];
  const warnings = [];
  const info = {};
  const err = (inv, msg) => errors.push(`I${inv}: ${msg}`);
  const warn = (inv, msg) => warnings.push(`I${inv}: ${msg}`);

  const world = readJson(path.join(worldDir, 'world.json'));
  const answersPath = path.join(worldDir, 'answers.json');
  const answers = fs.existsSync(answersPath) ? readJson(answersPath) : null;
  const knobsPath = fs.existsSync(path.join(worldDir, 'knobs.json')) ? path.join(worldDir, 'knobs.json') : path.join(ROOT, 'fixtures/world/knobs.json');
  const knobs = fs.existsSync(knobsPath) ? readJson(knobsPath) : {};
  weeks = weeks ?? knobs.weeks_of_context ?? 13;
  const meta = world.meta;
  const nowMs = toMs(meta.demo_now);
  const today = dateOf(meta.demo_now);
  const textStart = textStartFor(world, weeks);
  const textStartMs = toMs(textStart);
  info.weeks = weeks;
  info.text_start = textStart;

  const orders = world.orders || [];
  const xorders = orders.filter((o) => o.type === 'xometry_cnc');
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const txById = new Map((world.ramp_transactions || []).map((t) => [t.id, t]));

  // ---- load planned, jobs, rendered ----
  const plannedDir = path.join(worldDir, 'planned');
  const planned = {};
  for (const f of walkFiles(plannedDir).filter((f) => f.endsWith('.json'))) planned[path.basename(f, '.json')] = readJson(f);
  const jobFiles = walkFiles(path.join(worldDir, 'jobs')).filter((f) => f.endsWith('.json'));
  const jobs = jobFiles.map((f) => ({ file: f, raw: fs.readFileSync(f, 'utf8'), job: readJson(f) }));
  const rendered = walkFiles(outDir).map((f) => ({ rel: path.relative(outDir, f).split(path.sep).join('/'), raw: fs.readFileSync(f, 'utf8') }));
  const renderedMap = new Map(rendered.map((r) => [r.rel, r.raw]));
  info.planned_sources = Object.keys(planned).sort();
  info.jobs = jobs.length;
  info.rendered_files = rendered.length;

  // ---- I13: nothing rendered after demo_now; no text record before the text window ----
  const getJson = (rel) => { try { return JSON.parse(renderedMap.get(rel)); } catch { return null; } };
  const xo = getJson('xometry/orders.json');
  const xq = getJson('xometry/quotes.json');
  const rt = getJson('ramp/transactions.json');
  const rb = getJson('ramp/bills.json');
  for (const q of xq?.quotes || []) if (toMs(q.created_at) > nowMs) err(13, `quote ${q.quote_id} created after demo_now`);
  for (const o of xo?.orders || []) {
    if (toMs(o.placed_at) > nowMs) err(13, `order ${o.order_number} placed after demo_now`);
    for (const h of o.status_history || []) if (toMs(h.at) > nowMs) err(13, `order ${o.order_number} status ${h.status} after demo_now`);
    if (o.delivered_at && toMs(o.delivered_at) > nowMs) err(13, `order ${o.order_number} delivered after demo_now`);
  }
  for (const t of rt?.data || []) {
    if (toMs(t.user_transaction_time) > nowMs) err(13, `ramp ${t.id} after demo_now`);
    if (t.settlement_date && t.settlement_date > today) err(13, `ramp ${t.id} settles after demo_now`);
  }
  for (const b of rb?.data || []) {
    if (b.issued_at > today) err(13, `bill ${b.id} issued after demo_now`);
    if (b.payment_date && b.payment_date > today) err(13, `bill ${b.id} paid after demo_now`);
  }
  for (const r of rendered.filter((r) => r.rel.startsWith('meetings/'))) {
    const d = r.rel.slice('meetings/'.length, 'meetings/'.length + 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && (d > today || d < dateOf(textStart))) err(13, `${r.rel} outside the text window`);
  }
  const ISO_T = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?([+-]\d{2}:\d{2}|Z)$/;
  for (const r of rendered.filter((r) => /^(slack|jira)\//.test(r.rel) && r.rel.endsWith('.json'))) {
    let v; try { v = JSON.parse(r.raw); } catch { err(13, `${r.rel} is not valid JSON`); continue; }
    let late = 0; let early = 0;
    walkJson(v, (obj) => {
      for (const [k, x] of Object.entries(obj)) {
        if (typeof x === 'string' && ISO_T.test(x) && toMs(x) > nowMs && !/due|end/i.test(k)) late++;
        if ((k === 'ts' || k === 'thread_ts') && typeof x === 'string' && /^\d+\.\d+$/.test(x)) {
          const ms = +x * 1000;
          if (ms > nowMs) late++;
          if (k === 'ts' && ms < textStartMs) early++;
        }
      }
    });
    if (late) err(13, `${r.rel}: ${late} timestamps after demo_now`);
    if (early) err(13, `${r.rel}: ${early} messages before the text window`);
  }

  // ---- I16: text-window crumbs appear with their must_mention strings ----
  const plannedByEvent = new Map();
  const SOURCE_DIR = { slack: 'slack', jira: 'jira', meeting: 'meetings' };
  for (const [src, data] of Object.entries(planned)) {
    walkJson(data, (obj) => {
      const evs = Array.isArray(obj.events) ? obj.events : obj.event ? [obj.event] : [];
      for (const e of evs) {
        if (typeof e !== 'string') continue;
        if (!plannedByEvent.has(e)) plannedByEvent.set(e, []);
        plannedByEvent.get(e).push({ src, must: Array.isArray(obj.must_mention) ? obj.must_mention : null });
      }
    });
  }
  const sourceText = {};
  for (const r of rendered) { const d = r.rel.split('/')[0]; sourceText[d] = (sourceText[d] || '') + '\n' + r.raw; }
  let i16checked = 0;
  for (const ev of world.events || []) {
    if (ev.kind !== 'crumb' || !SOURCE_DIR[ev.source]) continue;
    const k = toMs(ev.known_at);
    if (k < textStartMs || k > nowMs) continue;
    const dir = SOURCE_DIR[ev.source];
    const hasPlanned = Object.keys(planned).some((s) => s === dir || s === ev.source);
    if (!hasPlanned) continue; // that source was not planned in this run
    i16checked++;
    const hits = plannedByEvent.get(ev.id);
    if (!hits) { err(16, `crumb ${ev.id} (${ev.source}) has no planned record`); continue; }
    const own = hits.filter((h) => h.src === dir || h.src === ev.source);
    if (!own.length) { err(16, `crumb ${ev.id} (${ev.source}) has no planned ${dir} record`); continue; }
    const must = [...new Set(own.flatMap((h) => h.must || []))];
    if (!rendered.length) continue; // nothing assembled yet
    if (!sourceText[dir]) { err(16, `crumb ${ev.id}: no rendered ${dir}/ files`); continue; }
    for (const s of must) if (!sourceText[dir].includes(s)) err(16, `crumb ${ev.id}: "${s}" not found in rendered ${dir}/`);
  }
  info.i16_crumbs_checked = i16checked;

  // ---- I18: Ramp amount = Xometry total; one email per person ----
  if (xo && rt) {
    const totals = new Map((xo.orders || []).map((o) => [o.order_number, o.total]));
    const sums = new Map();
    for (const t of (rt.data || []).concat(rb?.data || [])) {
      const w = txById.get(t.id);
      if (!w) { err(18, `rendered Ramp ${t.id} not in the world`); continue; }
      const o = w.order && orderById.get(w.order);
      if (!o || o.type !== 'xometry_cnc') continue;
      if (t.state === 'DECLINED' || t.amount < 0 || w.kind === 'refund' || w.kind === 'decline') continue;
      sums.set(o.order_number, Math.round(((sums.get(o.order_number) || 0) + t.amount) * 100) / 100);
    }
    for (const [num, sum] of sums) {
      if (!totals.has(num)) continue;
      if (Math.abs(sum - totals.get(num)) > 0.005) err(18, `Ramp charges for ${num} sum to ${sum}, Xometry total ${totals.get(num)}`);
    }
    for (const o of xo.orders || []) if (!sums.has(o.order_number)) warn(18, `${o.order_number} has no visible Ramp charge`);
  }
  const emails = new Map();
  for (const p of world.people || []) { if (emails.has(p.email)) err(18, `email ${p.email} used twice`); emails.set(p.email, p.id); }

  // ---- I19 / I20: secrecy in rendered files and jobs ----
  const reasonRe = new RegExp(REASON_LABELS.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i');
  for (const r of rendered) {
    const m = reasonRe.exec(r.raw);
    if (m) err(19, `${r.rel} contains hidden-reason label "${m[0]}"`);
    const id = INTERNAL_ID.exec(r.raw);
    if (id) err(19, `${r.rel} contains internal id "${id[0]}"`);
    if (r.rel.endsWith('.json')) {
      try { walkJson(JSON.parse(r.raw), (obj) => { for (const k of Object.keys(obj)) if (HIDDEN_KEYS.has(k)) err(20, `${r.rel} has hidden key "${k}"`); }); }
      catch { err(19, `${r.rel} is not valid JSON`); }
    }
  }
  for (const j of jobs) {
    const rel = path.relative(worldDir, j.file);
    const m = reasonRe.exec(j.raw);
    if (m) err(19, `job ${rel} contains hidden-reason label "${m[0]}"`);
    const sl = STORYLINE_ID.exec(j.raw);
    if (sl) err(20, `job ${rel} contains storyline id "${sl[0]}"`);
    walkJson(j.job, (obj) => { for (const k of Object.keys(obj)) if (HIDDEN_KEYS.has(k)) err(20, `job ${rel} has hidden key "${k}"`); });
  }
  for (const [src, data] of Object.entries(planned)) {
    walkJson(data, (obj) => { for (const k of Object.keys(obj)) if (HIDDEN_KEYS.has(k)) err(20, `planned/${src} has hidden key "${k}"`); });
  }

  // ---- I21: the app never reads fixtures/world/ (except the provenance view) ----
  for (const dir of ['server', 'src', 'app']) {
    for (const f of walkFiles(path.join(ROOT, dir))) {
      if (!/\.(m?js|jsx|ts|tsx)$/.test(f) || /provenance/i.test(f) || /node_modules/.test(f)) continue;
      if (/fixtures\/world/.test(fs.readFileSync(f, 'utf8'))) err(21, `${path.relative(ROOT, f)} references fixtures/world`);
    }
  }

  // ---- I22: rendered structured sources equal a re-emit of planned/ ----
  const ctxBase = { seed: meta.seed, weeks, textStart, demoNow: meta.demo_now, knobs };
  for (const [src, mod] of [['xometry', 'xometry'], ['ramp', 'ramp'], ['calendar', 'calendar'], ['demo', 'demo']]) {
    const recs = planned[src]?.records || (Array.isArray(planned[src]) ? planned[src] : null);
    if (!recs) continue;
    const r = await import(pathToFileURL(path.join(HERE, 'render', `${mod}.mjs`)).href);
    for (const f of r.emit(recs, {}, ctxBase).files) {
      if (!renderedMap.has(f.path)) warn(22, `${f.path} not assembled`);
      else if (renderedMap.get(f.path) !== f.content) err(22, `${f.path} differs from planned/${src}`);
    }
  }
  const plannedMeetings = planned.meetings?.records || (Array.isArray(planned.meetings) ? planned.meetings : null);
  if (plannedMeetings && rendered.length) {
    for (const r of plannedMeetings) if (r.crumbs?.length && !renderedMap.has(r.file)) err(22, `meeting file ${r.file} with crumbs is missing`);
  }

  // ---- I23: filled job texts ----
  const CTRL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
  const BG_BAD = /FL-[A-Z]{3}-\d{4}|Q-\d{7}|XO-\d{7}|\$\s?(?:[5-9]\d|\d{3,}|\d{1,3},\d{3})|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.? \d{1,2}\b|\b\d{1,2}\/\d{1,2}\b|\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]* (?:the )?\d{1,2}(?:st|nd|rd|th)\b/;
  let filled = 0;
  for (const { file, job } of jobs) {
    if (job.status !== 'filled') continue;
    filled++;
    const rel = path.relative(worldDir, file);
    const texts = [];
    const checkText = (s, where) => {
      if (s == null) return;
      if (typeof s !== 'string') { warn(23, `${rel} ${where}: text is not a string`); return; }
      if (s.length > 4000) warn(23, `${rel} ${where}: over 4,000 characters`);
      if (CTRL.test(s)) warn(23, `${rel} ${where}: control characters`);
      texts.push(s);
    };
    for (const m of job.messages || []) {
      checkText(m.text, `message ${m.ts}`);
      const must = m.must_mention || [];
      if (must.length) { for (const s of must) if (!String(m.text || '').includes(s)) warn(23, `${rel} ${m.ts}: missing "${s}" (falls back)`); }
      else if (m.text && BG_BAD.test(m.text)) warn(23, `${rel} ${m.ts}: background text breaks the §3.4 rule (dropped)`);
    }
    for (const t of job.tickets || []) {
      const all = [t.summary, t.description, ...(t.comments || []).map((c) => c.body)];
      all.forEach((s, i) => checkText(s, `ticket ${t.key} field ${i}`));
      for (const s of t.must_mention || []) if (!all.join('\n').includes(s)) warn(23, `${rel} ${t.key}: missing "${s}"`);
    }
    if (job.source === 'meeting') {
      const known = plannedMeetings ? new Set(plannedMeetings.map((r) => r.record_id)) : null;
      if (known && !known.has(job.meeting?.id)) err(23, `${rel}: meeting ${job.meeting?.id} was not planned`);
      for (const x of job.transcript || []) {
        checkText(x.text, `transcript ${x.start_s}`);
        if (!job.meeting.present.includes(x.speaker)) warn(23, `${rel}: speaker ${x.speaker} not present`);
        if (!(x.start_s >= 0 && x.start_s < job.meeting.actual_min * 60)) warn(23, `${rel}: start_s ${x.start_s} out of range`);
      }
      const blob = JSON.stringify(job.summary || {}) + (job.transcript || []).map((x) => x.text).join('\n');
      for (const c of job.crumbs || []) for (const s of c.must_mention || []) if (!blob.includes(s)) warn(23, `${rel} ${c.event}: missing "${s}" (falls back)`);
    }
  }
  info.filled_jobs = filled;

  // ---- I24: determinism of every renderer's plan ----
  let rngMod = null; let calMod = null;
  try { rngMod = await import(pathToFileURL(path.join(HERE, 'lib/rng.mjs')).href); } catch { /* lib not there yet */ }
  try { calMod = await import(pathToFileURL(path.join(HERE, 'lib/calendar.mjs')).href); } catch { /* lib not there yet */ }
  for (const name of ['meetings', 'calendar', 'xometry', 'ramp', 'demo', 'slack', 'jira']) {
    const p = path.join(HERE, 'render', `${name}.mjs`);
    if (!fs.existsSync(p)) continue;
    try {
      const mod = await import(pathToFileURL(p).href);
      const mk = () => ({ ...ctxBase, rng: rngMod?.makeRng ? rngMod.makeRng(meta.seed).fork(name) : undefined, cal: calMod?.makeCalendar ? calMod.makeCalendar(meta) : undefined });
      const a = JSON.stringify(mod.plan(world, mk()));
      const b = JSON.stringify(mod.plan(world, mk()));
      if (a !== b) err(24, `render/${name}.mjs plan is not deterministic`);
      const j1 = mod.plan(world, { ...mk(), weeks: 1, textStart: textStartFor(world, 1) }).jobs || [];
      const j13 = new Map((mod.plan(world, mk()).jobs || []).map((j) => [j.job_id, JSON.stringify(j)]));
      for (const j of j1) if (j13.has(j.job_id) && j13.get(j.job_id) !== JSON.stringify(j)) err(24, `render/${name}.mjs job ${j.job_id} differs between --weeks 1 and --weeks ${weeks}`);
    } catch (e) { warn(24, `render/${name}.mjs could not be run: ${e.message}`); }
  }

  // ---- coverage.json ----
  const usableFrom = addDays(dateOf(textStart), 30);
  const usable = xorders.filter((o) => dateOf(o.placed_at) >= usableFrom && toMs(o.placed_at) <= nowMs)
    .sort((a, b) => (toMs(a.placed_at) - toMs(b.placed_at)) || (a.id < b.id ? -1 : 1));
  const nTest = Math.round(usable.length * 0.3);
  const coverage = {
    weeks, text_start: textStart, usable_from: usableFrom, usable: usable.length,
    train: usable.length - nTest, test: nTest,
    orders: usable.map((o, i) => ({ order: o.id, order_number: o.order_number, placed_at: o.placed_at, set: i >= usable.length - nTest ? 'test' : 'train' })),
  };
  if (writeCoverage) fs.writeFileSync(path.join(worldDir, 'coverage.json'), JSON.stringify(coverage, null, 2) + '\n');
  info.coverage = { usable: coverage.usable, train: coverage.train, test: coverage.test };

  // ---- statistics (full worlds only) ----
  const stats = {};
  if (xorders.length >= 100) {
    const band = (inv, name, v, lo, hi) => { stats[name] = Math.round(v * 1000) / 1000; if (!(v >= lo && v <= hi)) err(inv, `${name} = ${stats[name]} outside ${lo}-${hi}`); };
    const weekKind = new Map((meta.weeks || []).map((w) => [w.week_start, w.kind]));
    const kindOf = (o) => weekKind.get(mondayOf(dateOf(o.placed_at))) || 'normal';
    // Targets come from knobs.targets where one exists; the spec's §4 numbers are the fallback.
    const tg = knobs.targets || {};
    const T = (v, lo, hi) => (Array.isArray(v) && v.length === 2 ? v : [lo, hi]);
    const note = (name, v) => { stats[name] = Math.round(v * 1000) / 1000; };
    band(25, 'xometry_orders', xorders.length, ...T(tg.xometry_orders, 400, 550));
    band(25, 'distinct_requesters', new Set(xorders.map((o) => o.requester)).size, 16, 22);
    band(25, 'buyer_placed_share', share(xorders, (o) => o.placer !== o.requester), 0.33, 0.47);
    const perWeek = new Map((meta.weeks || []).map((w) => [w.week_start, 0]));
    for (const o of xorders) { const w = mondayOf(dateOf(o.placed_at)); perWeek.set(w, (perWeek.get(w) || 0) + 1); }
    const wk = (k) => (meta.weeks || []).filter((w) => w.kind === k && w.week_start > dateOf(meta.window.start)).map((w) => perWeek.get(w.week_start) || 0);
    band(26, 'median_normal_week', quantile(wk('normal'), 0.5), 8, 14);
    band(26, 'mean_burst_week', wk('burst').reduce((s, x) => s + x, 0) / Math.max(1, wk('burst').length), 20, 30);
    band(26, 'mean_quiet_week', wk('quiet').reduce((s, x) => s + x, 0) / Math.max(1, wk('quiet').length), 3, 5);
    band(27, 'expedite_share', share(xorders, (o) => o.chosen_tier === 'expedite'), ...T(tg.tier_mix?.expedite, 0.2, 0.3));
    band(27, 'standard_share', share(xorders, (o) => o.chosen_tier === 'standard'), ...T(tg.tier_mix?.standard, 0.5, 0.6));
    band(27, 'economy_share', share(xorders, (o) => o.chosen_tier === 'economy'), ...T(tg.tier_mix?.economy, 0.15, 0.2));
    band(27, 'burst_expedite_share', share(xorders.filter((o) => kindOf(o) === 'burst'), (o) => o.chosen_tier === 'expedite'), ...T(tg.burst_expedite, 0.36, 0.52));
    band(28, 'revision_share', share(xorders, (o) => o.is_revision), ...T(tg.revision_share, 0.3, 0.4));
    band(28, 'lines_median', quantile(xorders.map((o) => o.lines.length), 0.5), 2, 2);
    band(28, 'lines_max', Math.max(...xorders.map((o) => o.lines.length)), 1, 6);
    const totals = xorders.map((o) => o.total_usd);
    band(29, 'total_median', quantile(totals, 0.5), 600, 900);
    band(29, 'total_p99', quantile(totals, 0.99), 8000, 15000);
    band(29, 'total_sum', totals.reduce((s, x) => s + x, 0), 400000, 700000);
    const lq = knobs.link_quality_mix || { clean_id: 0.45, alias_only: 0.33, never_discussed: 0.22 };
    for (const k of Object.keys(lq)) band(31, `link_${k}`, share(xorders, (o) => o.link_quality === k), lq[k] - 0.04, lq[k] + 0.04);
    if (weeks === 13) band('31b', 'usable_orders', coverage.usable, 120, 170);
    const delivered = xorders.filter((o) => o.delivered_at);
    // I33: the owner's late rate (knobs.targets.late_share, 1 order in 40) replaces the spec's lateness bands.
    band(33, 'late_share', share(delivered, (o) => dateOf(o.delivered_at) > o.promised_date), ...T(tg.late_share, 0.02, 0.03));
    note('late_3wd_plus', share(delivered, (o) => wdBetween(meta, o.promised_date, dateOf(o.delivered_at)) >= 3));
    // I30: hidden reasons within their bands +-2 points; expedites that truly gained time.
    if (answers) {
      const ans = answers.orders || [];
      for (const [k, b] of Object.entries(tg.hidden_reason_mix || {})) band(30, `reason_${k}`, share(ans, (a) => a.hidden_reason === k), b[0] - 0.02, b[1] + 0.02);
      const xById = new Map(xorders.map((o) => [o.id, o]));
      const exps = ans.filter((a) => xById.get(a.order)?.chosen_tier === 'expedite');
      band(30, 'expedite_true_gain_share', share(exps, (a) => a.expedite_helped === true), ...T(tg.expedite_true_gain_share, 0.45, 0.6));
    }
    const other = orders.filter((o) => o.type === 'other');
    band(34, 'other_vendor_orders', other.filter((o) => !o.recurring).length, 1250, 2200);
    band(34, 'saas_charges', other.filter((o) => o.recurring).length, 250, 400);
    const txs = world.ramp_transactions || [];
    band(34, 'missing_memo', share(txs, (t) => !t.memo_present), 0.15, 0.3);
    band(34, 'missing_receipt', share(txs, (t) => !t.receipt_present), 0.1, 0.2);
    const rec = (world.meetings || []).filter((m) => m.recorded && !m.cancelled);
    const nWeeks = (meta.weeks || []).length || 39;
    band(39, 'recorded_meetings_per_week', rec.length / nWeeks, 12, 18);
    band(39, 'meeting_len_multiple_of_30', share(rec, (m) => m.actual_min % 30 === 0), 0, 0.05);
    band(40, 'totals_ending_00', share(xorders, (o) => Math.round(o.total_usd * 100) % 100 === 0), 0, 0.03);
    const byT = xorders.slice().sort((a, b) => toMs(a.placed_at) - toMs(b.placed_at));
    const leads = (o) => o.tiers.map((t) => `${t.tier}:${t.lead_business_days}`).sort().join(',');
    let same = 0;
    for (let i = 1; i < byT.length; i++) if (leads(byT[i]) === leads(byT[i - 1])) same++;
    band(40, 'consecutive_equal_leads', same / Math.max(1, byT.length - 1), 0, 0.15);
    if (answers) Object.assign(stats, probe(world, answers, band, T(tg.probe_accuracy, 0.66, 0.78)));
    else warn(41, 'answers.json missing: probe not run');
  } else {
    info.statistics = `skipped (${xorders.length} Xometry orders: not a full world)`;
  }
  info.stats = stats;
  info.not_implemented = ['I18 Jira quote id and Slack/Jira identity agreement', 'I32', 'I35', 'I36', 'I37', 'I38', 'I42'];
  return { errors, warnings, info, coverage };
}

// §2 learnability probe on truth-side proxies of the visible attributes.
export function probe(world, answers, band, accBand = [0.66, 0.78]) {
  const meta = world.meta;
  const ans = new Map(answers.orders.map((a) => [a.order, a]));
  const weekKind = new Map((meta.weeks || []).map((w) => [w.week_start, w.kind]));
  const LV = { low: 0, elevated: 1, high: 2 };
  const rows = [];
  for (const o of world.orders.filter((x) => x.type === 'xometry_cnc')) {
    const a = ans.get(o.id);
    if (!a || (a.split !== 'train' && a.split !== 'test')) continue;
    const lead = (k) => o.tiers.find((t) => t.tier === k)?.lead_business_days;
    const std = lead('standard') ?? 8; const econ = lead('economy') ?? std + 5;
    let bin = 'unknown';
    if (o.link_quality !== 'never_discussed' && o.need_by_believed) {
      const d = wdBetween(meta, dateOf(o.placed_at), o.need_by_believed);
      bin = d < std ? 'lt_std' : d <= econ ? 'std_econ' : d <= econ + 10 ? 'econ_10' : 'more';
    }
    const ep = a.expressed_pressure || {};
    const pres = ['low', 'elevated', 'high'][Math.max(0, ...['0-1', '1-3', '3-7'].map((b) => LV[ep[b]] ?? 0))];
    rows.push({ o, a, bin, pres, burst: weekKind.get(mondayOf(dateOf(o.placed_at))) === 'burst', y: o.chosen_tier, split: a.split, reason: a.hidden_reason });
  }
  const train = rows.filter((r) => r.split === 'train');
  const test = rows.filter((r) => r.split === 'test');
  const rate = new Map();
  for (const r of train) { const s = rate.get(r.o.requester) || [0, 0]; s[0] += r.y === 'expedite' ? 1 : 0; s[1]++; rate.set(r.o.requester, s); }
  const sorted = [...rate.entries()].map(([p, [e, n]]) => [p, e / n]).sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1));
  const terc = new Map(sorted.map(([p], i) => [p, Math.min(2, Math.floor((3 * i) / Math.max(1, sorted.length)))]));
  for (const r of rows) r.terc = terc.has(r.o.requester) ? terc.get(r.o.requester) : 1;
  const fit = (keysList) => {
    const tables = keysList.map((keys) => { const m = new Map(); for (const r of train) { const k = keys(r); const c = m.get(k) || {}; c[r.y] = (c[r.y] || 0) + 1; m.set(k, c); } return m; });
    return (r) => {
      for (let i = 0; i < keysList.length; i++) {
        const c = tables[i].get(keysList[i](r));
        const n = c ? Object.values(c).reduce((s, x) => s + x, 0) : 0;
        if (n >= 5 || i === keysList.length - 1) return c ? Object.entries(c).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0] : 'standard';
      }
      return 'standard';
    };
  };
  const levels = [(r) => `${r.bin}|${r.pres}|${r.terc}|${r.burst}`, (r) => `${r.bin}|${r.pres}|${r.terc}`, (r) => `${r.bin}|${r.pres}`, (r) => r.bin, () => ''];
  const predict = fit(levels);
  const predictHidden = fit([(r) => `${r.reason}|${levels[0](r)}`, (r) => `${r.reason}|${r.bin}`, (r) => r.reason, () => '']);
  const acc = (rs, f) => (rs.length ? rs.filter((r) => f(r) === r.y).length / rs.length : NaN);
  const out = {};
  if (!test.length) return out;
  band(41, 'probe_always_standard', acc(test, () => 'standard'), 0.5, 0.6);
  band(41, 'probe_days_to_need_rule', acc(test, (r) => (r.bin === 'lt_std' ? 'expedite' : 'standard')), 0, 0.7);
  band(41, 'probe_accuracy', acc(test, predict), ...accBand);
  const clean = test.filter((r) => r.o.link_quality === 'clean_id');
  const never = test.filter((r) => r.o.link_quality === 'never_discussed');
  if (clean.length >= 10) band(41, 'probe_clean_id', acc(clean, predict), 0.74, 0.85);
  if (never.length >= 10) band(41, 'probe_never_discussed', acc(never, predict), 0.52, 0.62);
  const exp = test.filter((r) => r.y === 'expedite');
  if (exp.length) band(41, 'probe_expedite_recall', exp.filter((r) => predict(r) === 'expedite').length / exp.length, 0.5, 0.7);
  band(41, 'probe_with_hidden_reason', acc(test, predictHidden), 0.9, 1);
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { errors, warnings, info } = await runChecks(args);
  console.log(`checks: world ${path.relative(ROOT, args.world) || '.'}, out ${path.relative(ROOT, args.out)}, weeks ${info.weeks} (text from ${info.text_start})`);
  console.log(`  planned: ${info.planned_sources.join(', ') || 'none'} · jobs ${info.jobs} (${info.filled_jobs} filled) · rendered files ${info.rendered_files}`);
  console.log(`  coverage: ${info.coverage.usable} usable orders (${info.coverage.train} train, ${info.coverage.test} test)`);
  if (info.statistics) console.log(`  statistics: ${info.statistics}`);
  for (const [k, v] of Object.entries(info.stats || {})) console.log(`  ${k}: ${v}`);
  console.log(`  not yet checked: ${info.not_implemented.join('; ')}`);
  for (const w of warnings.slice(0, 50)) console.log(`  warn ${w}`);
  if (warnings.length > 50) console.log(`  ... ${warnings.length - 50} more warnings`);
  for (const e of errors.slice(0, 100)) console.log(`  FAIL ${e}`);
  if (errors.length > 100) console.log(`  ... ${errors.length - 100} more errors`);
  console.log(errors.length ? `checks: ${errors.length} violation(s)` : 'checks: ok');
  process.exit(errors.length ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
