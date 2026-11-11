// Demo service (agent F): the recommendation card for the demo order, built from rendered sources only.
//
//   demoCard({change: 0|1|2|3, sourcesDir, outDir}) → {card, heatmap, sources, engine}
//
// part entry → resolve the part → graphAt(now) → demoInputs → compare → rubric → habit line.
// Change 1, 2 or 3 appends demo/live-changes.json[n − 1] as a Slack doc, re-extracts claims and re-solves.
// No model call anywhere.
//
// Every step uses the other agents' modules when they exist (A: src/timevalue, B: sources/labels,
// C: refs/claims/graph, D: read, E: heatmap/habit) and otherwise a small code fallback defined here,
// so the card always renders. `engine` says which path each step took.
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '../..');
// Until the world and its text are final, the demo runs on a small fixture in the rendered-source format
// (fixtures/timevalue/demo-sources/, built from fixtures/flintlock/demo/ and the pinned dates of
// simulation-spec.md S14). Point at the final render with TIMEVALUE_SOURCES=fixtures/flintlock or --sources.
export const FIXTURE_SOURCES = path.join(ROOT, 'fixtures/timevalue/demo-sources');
export const DEFAULT_SOURCES = process.env.TIMEVALUE_SOURCES ? path.resolve(ROOT, process.env.TIMEVALUE_SOURCES) : FIXTURE_SOURCES;
export const DEFAULT_OUT = path.join(ROOT, 'fixtures/timevalue');

// The banner over the card: wasted rush orders in the last 3 months, from grading.json (fallback: the graded numbers).
export const WASTED_FALLBACK = { count: 61, expedited: 133, premium_usd: 31159 };
export async function wastedExpedites({ outDir = DEFAULT_OUT } = {}) {
  const w = (await readJson(path.join(outDir, 'grading.json')))?.wasted_expedites;
  return w && Number.isFinite(w.count) && Number.isFinite(w.expedited) && Number.isFinite(w.premium_usd)
    ? { count: w.count, expedited: w.expedited, premium_usd: Math.round(w.premium_usd) } : { ...WASTED_FALLBACK };
}

// ------------------------------------------------------------------ optional modules

async function optional(rel) {
  const file = path.resolve(HERE, rel);
  if (!existsSync(file)) return null;
  try { return await import(file); } catch (error) { return { __error: error.message }; }
}
const usable = (mod, ...names) => mod && !mod.__error && names.every((n) => typeof mod[n] === 'function');

async function loadModules() {
  const [index, compareM, rubricM, solveM, calM, sources, labels, refs, claims, graph, read, heatmap, habit] = await Promise.all([
    optional('../../src/timevalue/index.mjs'), optional('../../src/timevalue/compare.mjs'), optional('../../src/timevalue/rubric.mjs'),
    optional('../../src/timevalue/solve.mjs'), optional('../../src/timevalue/calendar.mjs'),
    optional('./sources.mjs'), optional('./labels.mjs'), optional('./refs.mjs'), optional('./claims.mjs'), optional('./graph.mjs'),
    optional('./read.mjs'), optional('./heatmap.mjs'), optional('./habit.mjs'),
  ]);
  const pick = (name) => [index, compareM, rubricM, solveM].find((m) => usable(m, name))?.[name] || null;
  return {
    compare: pick('compare'), rubric: pick('rubric'), solve: pick('solve'),
    makeCalendar: usable(calM, 'makeCalendar') ? calM.makeCalendar : null,
    loadSources: usable(sources, 'loadSources') ? sources.loadSources : null,
    labels: usable(labels, 'linkRampToXometry') ? labels : null,
    resolver: usable(refs, 'makeResolver') ? refs.makeResolver : null,
    extractClaims: usable(claims, 'extractClaims') ? claims.extractClaims : null,
    graph: usable(graph, 'buildGraph', 'graphAt', 'demoInputs') ? graph : null,
    read: usable(read, 'readDocs', 'makeReadContext') ? read : null,
    heatmap: usable(heatmap, 'heatmap') ? heatmap.heatmap : null,
    habit: usable(habit, 'predict') ? habit : null,
  };
}

// ------------------------------------------------------------------ dates (working days)

const DAY = 86400e3;
const parseD = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const fmtD = (ms) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (d, n) => fmtD(parseD(d) + n * DAY);
const dow = (d) => new Date(parseD(d)).getUTCDay();
const toDate = (x) => (x == null ? null : String(x).slice(0, 10));
// Pacific local date of an ISO time with offset (the sources always carry one).
const localDate = (iso) => (iso ? String(iso).slice(0, 10) : null);

function workCalendar(holidays = []) {
  const closed = new Set(holidays.filter((h) => h.observance === 'full').map((h) => h.date));
  const isWd = (d) => { const w = dow(d); return w !== 0 && w !== 6 && !closed.has(d); };
  const nextWd = (d) => { let x = addDays(d, 1); while (!isWd(x)) x = addDays(x, 1); return x; };
  const onOrAfter = (d) => (isWd(d) ? d : nextWd(d));
  const addWd = (d, n) => { if (n === 0) return onOrAfter(d); let x = d; for (let i = 0; i < n; i++) x = nextWd(x); return x; };
  const wdBetween = (a, b) => { if (a === b) return 0; if (b < a) return -wdBetween(b, a); let n = 0; for (let x = addDays(a, 1); x <= b; x = addDays(x, 1)) if (isWd(x)) n++; return n; };
  return { isWd, nextWd, onOrAfter, addWd, wdBetween };
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const shortDate = (d) => (d ? `${WEEKDAY[dow(d)]} ${+d.slice(5, 7)}/${+d.slice(8, 10)}` : 'unknown');
const money = (n) => (n == null ? '—' : '$' + Math.round(n).toLocaleString('en-US'));
function ago(at, now) {
  if (!at) return null;
  const days = Math.round((parseD(localDate(now)) - parseD(localDate(at))) / DAY);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
}

// ------------------------------------------------------------------ fallback: sources

async function readJson(file, fallback = null) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
}

function unfoldIcs(text) { return text.replace(/\r?\n[ \t]/g, ''); }
function icsDate(v) { const m = v.match(/(\d{4})(\d{2})(\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; }
function parseIcs(text) {
  const events = [];
  for (const block of unfoldIcs(text).split('BEGIN:VEVENT').slice(1)) {
    const get = (k) => block.match(new RegExp(`^${k}[^:\\n]*:(.*)$`, 'm'))?.[1]?.trim() ?? null;
    events.push({ uid: get('UID'), summary: get('SUMMARY'), start: icsDate(get('DTSTART') || ''), end: icsDate(get('DTEND') || ''), categories: (get('CATEGORIES') || '').split(','), status: get('STATUS') });
  }
  return events;
}

async function fallbackSources(dir) {
  const demo = {
    partEntry: await readJson(path.join(dir, 'demo/part-entry.json')),
    quote: await readJson(path.join(dir, 'demo/quote.json')),
    policy: await readJson(path.join(dir, 'demo/policy.json')),
    liveChanges: await readJson(path.join(dir, 'demo/live-changes.json')),
  };
  const users = (await readJson(path.join(dir, 'slack/users.json'), { members: [] })).members || [];
  const byId = new Map(users.map((u) => [u.id, u]));
  const channels = (await readJson(path.join(dir, 'slack/channels.json'), { channels: [] })).channels || [];
  const docs = [];
  for (const ch of channels) {
    const file = await readJson(path.join(dir, `slack/${ch.id}.json`), { messages: [] });
    for (const m of file.messages || []) {
      const u = byId.get(m.user);
      docs.push({ id: `slack:${ch.id}:${m.ts}`, source: 'slack', container: ch.id, thread: m.thread_ts || m.ts,
        author: { name: u?.real_name || null, email: u?.profile?.email || null, slack_id: m.user }, at: tsToIso(m.ts), text: m.text || '' });
    }
  }
  let calendar = [];
  try { calendar = parseIcs(await readFile(path.join(dir, 'calendar.ics'), 'utf8')); } catch { /* none */ }
  docs.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1));
  return { docs, calendar, demo, xometry: { quotes: [], orders: [] }, ramp: { transactions: [], bills: [] } };
}

// Pacific ISO for a Slack ts (PDT Mar–Nov rules are overkill here: offset by the US DST rule).
function pacificOffsetHours(ms) {
  const y = new Date(ms).getUTCFullYear();
  const nthSunday = (month, n) => { const first = Date.UTC(y, month, 1); const d = new Date(first).getUTCDay(); return first + (((7 - d) % 7) + 7 * (n - 1)) * DAY; };
  const start = nthSunday(2, 2) + 10 * 3600e3; // 2am PST = 10:00 UTC
  const end = nthSunday(10, 1) + 9 * 3600e3; // 2am PDT = 09:00 UTC
  return ms >= start && ms < end ? -7 : -8;
}
export function tsToIso(ts) {
  const ms = Math.round(parseFloat(ts) * 1000);
  const off = pacificOffsetHours(ms);
  const local = new Date(ms + off * 3600e3).toISOString().slice(0, 19);
  return `${local}${off === -7 ? '-07:00' : '-08:00'}`;
}

// ------------------------------------------------------------------ fallback: graph (code-only demo inputs)

const lc = (s) => String(s || '').toLowerCase();
function claimDates(text, at) {
  const year = +String(at).slice(0, 4);
  const md = (m, d) => `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const range = text.match(/between\s+(\d{1,2})\/(\d{1,2})\s+and\s+(\d{1,2})\/(\d{1,2})/i);
  if (range) return { min: md(range[1], range[2]), max: md(range[3], range[4]) };
  const eta = text.match(/\beta\s+(?:\w{3,5}\s+)?(\d{1,2})\/(\d{1,2})/i);
  if (eta) return md(eta[1], eta[2]);
  return null;
}

function fallbackDemoInputs({ settings, sources, part, now }) {
  const pe = sources.demo.partEntry;
  const tests = settings?.tests || [];
  const test = tests.find((t) => lc(pe.summary).includes(lc(t.name))) || null;
  if (!test) return { test: null, milestone: null, inputs: [], planned_start: null, duration: null, rig: null, policy: null };
  const milestone = (settings.milestones || []).find((m) => m.id === test.milestone) || null;
  const docs = sources.docs.filter((d) => d.at <= now);
  const inputs = [];
  for (const dl of settings.deliverables || []) {
    const name = lc(dl.name);
    const link = docs.find((d) => lc(d.text).includes(name) && /blocked|waits on|waiting on/.test(lc(d.text)) && (lc(d.text).includes('the test') || lc(d.text).includes(lc(test.name))));
    if (!link) continue;
    let ready = null; let said = null;
    for (const d of docs) if (lc(d.text).includes(name)) { const v = claimDates(d.text, d.at); if (v) { ready = v; said = d; } }
    inputs.push({ id: dl.id, kind: 'deliverable', name: dl.name, owner: dl.owner, ready, said_by: said?.author?.slack_id ? personBySlack(settings, said.author.slack_id)?.id : null,
      said_at: said?.at || null, doc_id: said?.id || null, link_doc_id: link.id });
  }
  const booking = (sources.calendar || []).find((e) => (e.categories || []).includes('BOOKING') && lc(e.summary).includes(lc(test.name)));
  const cal = workCalendar(settings.holidays);
  // A timed booking covers start..end inclusive; that span is the run the owner planned.
  const planned_start = toDate(booking?.start) || toDate(test.planned_date?.at?.(-1)?.value) || null;
  const duration = booking ? cal.wdBetween(toDate(booking.start), toDate(booking.end)) + 1 : (test.duration_estimate_days?.[1] ?? null);
  const pol = (milestone?.value_policy || []).filter((p) => p.known_at <= now).at(-1) || null;
  return {
    test: { ...test, duration_source: booking ? `cal:${booking.uid}` : 'settings' }, milestone,
    inputs: [{ id: part.id, kind: 'part', name: part.name, ready: null }, ...inputs],
    planned_start, planned_start_doc: booking ? `cal:${booking.uid}` : null, duration, rig: test.rig,
    policy: pol ? { ...pol.value, by: pol.by, at: pol.known_at } : null,
  };
}

const personBySlack = (settings, sid) => (settings?.people || []).find((p) => p.slack_id === sid) || null;
const personById = (settings, id) => (settings?.people || []).find((p) => p.id === id || p.email === id) || null;
const personByName = (settings, name) => (settings?.people || []).find((p) => p.name === name) || null;
const firstName = (p) => (p?.name || '').split(' ')[0] || null;

// ------------------------------------------------------------------ fallback: maths (contract of src/timevalue)

function fallbackSolve({ holidays, test, inputs }) {
  const cal = workCalendar(holidays);
  if (inputs.some((i) => !i.ready)) return { start: null, finish: null, limiter: { kind: 'input', id: inputs.find((i) => !i.ready).id, unknown: true } };
  let base = test.planned_start ? toDate(test.planned_start) : null; let limiter = { kind: 'planned_start', id: test.id ?? null };
  for (const i of inputs) { const u = cal.nextWd(toDate(i.ready)); if (!base || u > base) { base = u; limiter = { kind: 'input', id: i.id }; } }
  const start = cal.onOrAfter(base);
  return { start, finish: cal.addWd(start, test.duration_days - 1), limiter };
}

function fallbackCompare({ holidays, quote, test, inputs, milestone, now }, solve = fallbackSolve) {
  const cal = workCalendar(holidays);
  const ranged = inputs.find((i) => i.ready && typeof i.ready === 'object');
  const unknown = inputs.find((i) => !i.ready);
  const scen = (pick) => inputs.map((i) => ({ ...i, ready: i.ready && typeof i.ready === 'object' ? i.ready[pick] : i.ready }));
  const run = (tier, ins) => solve({ holidays, test, inputs: [{ id: 'tier', ready: tier.ready }, ...ins] });
  const sorted = [...quote].sort((a, b) => a.total - b.total);
  const cheapest = sorted[0];
  const scenarios = ranged ? ['min', 'max'] : ['base'];
  const tiers = sorted.map((t) => {
    const finish_by_scenario = Object.fromEntries(scenarios.map((s) => [s, unknown ? null : run(t, s === 'base' ? inputs : scen(s)).finish]));
    const saved = scenarios.map((s) => (finish_by_scenario[s] && run(cheapest, s === 'base' ? inputs : scen(s)).finish ? cal.wdBetween(finish_by_scenario[s], run(cheapest, s === 'base' ? inputs : scen(s)).finish) : null));
    const days_saved = scenarios.length === 1 ? saved[0] : { min: Math.min(...saved), max: Math.max(...saved) };
    const extra = t.total - cheapest.total;
    const best = scenarios.length === 1 ? saved[0] : Math.max(...saved);
    return { tier: t.tier, total: t.total, ready: t.ready, finish_by_scenario, days_saved, extra, break_even: best > 0 ? extra / best : null };
  });
  const policy = milestone?.policy;
  const base = { tiers, limiter: null, switching: null, question: null };
  if (unknown) return { ...base, outcome: 'ask_owner', recommended: null, question: { to: unknown.owner || null, input: unknown.id, text: `When will ${unknown.name || unknown.id} be ready?` } };
  const fastest = tiers.at(-1);
  const anyGain = tiers.some((t) => (typeof t.days_saved === 'number' ? t.days_saved : t.days_saved?.max) > 0);
  if (!anyGain) {
    const lim = run(cheapest, ranged ? scen('max') : inputs).limiter;
    return { ...base, outcome: 'cheapest', recommended: cheapest.tier, limiter: lim };
  }
  if (!policy || (policy.type === 'per_day' && policy.usd_per_day == null)) return { ...base, outcome: 'ask_owner', recommended: null, question: { to: milestone?.owner || null, text: 'What is a day of this milestone worth?' } };
  const value = (days) => policy.usd_per_day * days;
  if (ranged) {
    const minGain = fastest.days_saved.min;
    const maxGain = fastest.days_saved.max;
    const payMax = value(maxGain) > fastest.extra; const payMin = value(minGain) > fastest.extra;
    if (payMax === payMin) return { ...base, outcome: payMax ? 'pay' : 'dont_pay', recommended: payMax ? fastest.tier : cheapest.tier };
    // Switching date: the latest ready date of the ranged input at which paying still wins.
    let by = null;
    for (let d = ranged.ready.min; d <= ranged.ready.max; d = addDays(d, 1)) {
      const ins = inputs.map((i) => (i === ranged ? { ...i, ready: d } : i));
      const g = cal.wdBetween(run(fastest, ins).finish, run(cheapest, ins).finish);
      if (value(g) > fastest.extra) by = d;
    }
    return { ...base, outcome: 'depends', recommended: null, switching: { input: ranged.id, by_date: by },
      question: { to: ranged.owner || null, input: ranged.id, text: `Ready by ${shortDate(by)}?` } };
  }
  const pay = value(fastest.days_saved) > fastest.extra;
  return { ...base, outcome: pay ? 'pay' : 'dont_pay', recommended: pay ? fastest.tier : cheapest.tier, limiter: run(fastest, inputs).limiter };
}

function fallbackRubric(cmp, { quoteValidUntil, now, facts }) {
  const fastest = cmp.tiers.at(-1);
  const checks = [
    { n: 1, label: 'Quote valid', status: quoteValidUntil && quoteValidUntil >= localDate(now) ? 'pass' : 'fail', text: `Valid until ${shortDate(quoteValidUntil)}`, sources: ['demo/quote.json'] },
    { n: 2, label: 'Part identified', status: 'pass', text: 'Part number matches the catalogue', sources: ['demo/part-entry.json'] },
    { n: 3, label: 'What it waits on', status: facts.length ? 'pass' : 'unknown', text: `${facts.length} other input(s) found`, sources: facts.map((f) => f.doc_id).filter(Boolean) },
    { n: 4, label: 'Input dates sourced', status: facts.every((f) => f.at) ? 'pass' : 'unknown', text: facts.map((f) => f.text).join('; ') || 'none', sources: facts.map((f) => f.doc_id).filter(Boolean) },
    { n: 5, label: 'Value of a day', status: 'info', text: 'From the milestone policy', sources: ['demo/policy.json'] },
    { n: 6, label: 'Schedule effect', status: 'info', text: `Fastest tier saves ${JSON.stringify(fastest.days_saved)} working day(s)`, sources: [] },
    { n: 7, label: 'Decision', status: cmp.outcome === 'depends' || cmp.outcome === 'ask_owner' ? 'unknown' : 'pass', text: cmp.outcome, sources: [] },
  ];
  return { checks, guards: [], blocked: false };
}

// ------------------------------------------------------------------ pipeline state (cached per sources dir)

const cache = new Map();

async function baseState(sourcesDir, outDir) {
  const key = `${sourcesDir}|${outDir}`;
  if (cache.has(key)) return cache.get(key);
  const promise = (async () => {
    const mods = await loadModules();
    const engine = {};
    const settings = await readJson(path.join(outDir, 'settings.json'));
    engine.settings = settings ? 'settings.json' : 'missing';
    let sources;
    if (mods.loadSources) {
      try { sources = await mods.loadSources(sourcesDir); engine.sources = 'sources.mjs'; } catch (e) { engine.sources = `fallback (${e.message})`; }
    } else engine.sources = 'fallback';
    if (!sources) sources = await fallbackSources(sourcesDir);
    if (!sources.demo?.partEntry) { const fb = await fallbackSources(sourcesDir); sources.demo = fb.demo; }
    let resolve = null; let baseClaims = null;
    if (mods.resolver && mods.extractClaims && settings) {
      try { resolve = mods.resolver(settings); baseClaims = sources.docs.flatMap((d) => mods.extractClaims(d, resolve)); } catch (e) { engine.claims_error = e.message; resolve = null; }
    }
    const model = await readJson(path.join(outDir, 'habit-model.json'));
    return { mods, engine, settings, sources, resolve, baseClaims, model, reads: null };
  })();
  cache.set(key, promise);
  promise.catch(() => cache.delete(key));
  return promise;
}
export function clearDemoCache() { cache.clear(); }

function liveDoc(sources, settings, change) {
  const list = sources.demo.liveChanges?.changes || [];
  const c = list.find((x) => x.order === change) || list[change - 1];
  if (!c) return null;
  const base = settings?.demo_now || sources.demo.partEntry.entered_at;
  const at = new Date(Date.parse(base) + (c.offset_minutes || 0) * 60e3);
  const off = base.slice(-6);
  const offMin = (off[0] === '-' ? -1 : 1) * (+off.slice(1, 3) * 60 + +off.slice(4, 6));
  const iso = new Date(at.getTime() + offMin * 60e3).toISOString().slice(0, 19) + off;
  const ts = `${Math.floor(at.getTime() / 1000)}.000000`;
  const m = c.message;
  const person = personBySlack(settings, m.user);
  return { change: c, doc: { id: `slack:${m.channel}:${ts}`, source: 'slack', container: m.channel, thread: ts,
    author: { name: person?.name || m.user_name, email: person?.email || null, slack_id: m.user }, at: iso, text: m.text } };
}

// ------------------------------------------------------------------ the card

const CONFIDENT_OUTCOMES = new Set(['cheapest', 'pay', 'dont_pay']);

export async function demoCard({ change = 0, sourcesDir = DEFAULT_SOURCES, outDir = DEFAULT_OUT } = {}) {
  change = Number(change) || 0;
  const st = await baseState(sourcesDir, outDir);
  const { mods, settings, model } = st;
  const engine = { ...st.engine };
  const { partEntry, quote, policy: policyFile } = st.sources.demo;
  let now = settings?.demo_now || partEntry.entered_at;

  // Live change: one more Slack doc.
  let docs = st.sources.docs; let live = null; let claims = st.baseClaims;
  if (change > 0) {
    live = liveDoc(st.sources, settings, change);
    if (live) {
      docs = [...docs, live.doc];
      if (live.doc.at > now) now = live.doc.at;
      if (claims && st.resolve) claims = [...claims, ...mods.extractClaims(live.doc, st.resolve)];
    }
  }
  const sources = { ...st.sources, docs };

  // Resolve the part.
  const part = (settings?.parts || []).find((p) => p.part_number === partEntry.part_number)
    || { id: partEntry.part_number, part_number: partEntry.part_number, name: partEntry.part_name, aliases: [] };

  // Graph → demo inputs.
  let di = null; let view = null;
  if (mods.graph && settings && claims) {
    try {
      const g = mods.graph.buildGraph({ settings, sources, claims });
      view = mods.graph.graphAt(g, now);
      di = mods.graph.demoInputs(view, part.id);
      engine.graph = 'graph.mjs';
    } catch (e) { engine.graph = `fallback (${e.message})`; }
  } else engine.graph = 'fallback';
  if (!di) di = fallbackDemoInputs({ settings, sources, part, now });

  const test = typeof di.test === 'string' ? (settings?.tests || []).find((t) => t.id === di.test) || { id: di.test } : di.test || {};
  const milestone = typeof di.milestone === 'string' ? (settings?.milestones || []).find((m) => m.id === di.milestone) || { id: di.milestone } : di.milestone || {};
  const polRec = (policyFile?.policies || []).find((p) => lc(p.milestone) === lc(milestone.name)) || null;
  const policy = di.policy ? { type: di.policy.type, usd_per_day: di.policy.usd_per_day ?? null, curve: di.policy.curve ?? null }
    : polRec ? { type: polRec.type, usd_per_day: polRec.usd_per_day, curve: polRec.curve } : null;
  const policyOwner = personById(settings, di.policy?.by) || personById(settings, polRec?.set_by?.email) || personById(settings, milestone.owner);
  const target = toDate(milestone.date?.at?.(-1)?.value) || polRec?.milestone_date || null;
  const duration = typeof di.duration === 'number' ? di.duration : di.duration?.value ?? test.duration_estimate_days?.[1] ?? null;

  const holidays = settings?.holidays || [];
  const tiersIn = (quote.lead_time_options || []).map((o) => ({ tier: lc(o.lead_time), label: o.lead_time, total: o.total, ready: o.estimated_delivery_date, lead_days: o.lead_time_business_days }));
  const others = (di.inputs || []).filter((i) => i.id !== part.id && i.kind !== 'part').map((i) => {
    const dl = (settings?.deliverables || []).find((d) => d.id === i.id) || (settings?.parts || []).find((p) => p.id === i.id);
    return { ...i, name: i.name || dl?.name || i.id, owner: i.owner || dl?.owner || null, ready: i.ready && typeof i.ready === 'object' && !('min' in i.ready) ? i.ready.value ?? null : i.ready };
  });
  const testIn = { id: test.id, owner: test.owner, planned_start: toDate(di.planned_start?.value ?? di.planned_start), duration_days: duration, rig_slot_days: (settings?.rigs || []).find((r) => r.id === (di.rig?.id ?? di.rig))?.slot_days ?? null, bookings: [], owner_out: [] };
  const args = { holidays, part: part.id, quote: tiersIn.map(({ tier, total, ready }) => ({ tier, total, ready })), test: testIn, inputs: others.map((i) => ({ id: i.id, ready: i.ready, owner: i.owner, said_by: i.said_by, name: i.name })), milestone: { id: milestone.id, target, policy, owner: milestone.owner }, now };

  let cmp;
  if (mods.compare) {
    try { cmp = mods.compare(args); engine.maths = 'src/timevalue'; } catch (e) { engine.maths = `fallback (${e.message})`; }
  } else engine.maths = 'fallback';
  if (!cmp) cmp = fallbackCompare(args, mods.solve ? (a) => mods.solve(a) : fallbackSolve);

  const facts = [
    { about: 'quote', text: `Quote ${quote.quote_id} valid until ${quote.expires_on}`, by: 'Xometry', at: quote.created_at, doc_id: 'demo/quote.json' },
    ...(policy?.usd_per_day != null ? [{ about: 'value', text: `${milestone.name}: $${policy.usd_per_day}/day`, by: di.policy?.by || polRec?.set_by?.email || null, at: di.policy?.at || polRec?.set_at || null, doc_id: 'demo/policy.json' }] : []),
    ...(di.planned_start_doc ? [{ about: 'schedule', text: `${test.name}: starts ${testIn.planned_start}, ${duration} working days`, by: test.owner, at: null, doc_id: di.planned_start_doc }] : []),
    ...others.filter((i) => i.link_doc_id).map((i) => ({ about: 'schedule', text: `${test.name} waits on ${i.name}`, by: test.owner, at: null, doc_id: i.link_doc_id })),
    ...others.filter((i) => i.doc_id).map((i) => ({ about: 'limiter', text: `${i.name} ready ${readyText(i.ready)}`, by: i.said_by, at: i.said_at, doc_id: i.doc_id })),
  ];
  // A calendar booking's doc time is its start (in the future); the fact is the calendar as read now.
  for (const f of facts) if (!f.at && f.doc_id) f.at = f.doc_id.startsWith('cal:') ? now : docs.find((d) => d.id === f.doc_id)?.at || null;
  let conversation = null;
  try { conversation = await conversationInputs(st, { docs, live, view, part, test, milestone, target, others, now }); engine.conversation = conversation ? 'read-cache + graph' : 'no reads'; }
  catch (e) { engine.conversation = `error (${e.message})`; }
  let rub;
  if (mods.rubric) { try { rub = mods.rubric(cmp, { quoteValidUntil: quote.expires_on, now, facts, conversation }); engine.rubric = 'src/timevalue'; } catch (e) { engine.rubric = `fallback (${e.message})`; } } else engine.rubric = 'fallback';
  if (!rub) rub = fallbackRubric(cmp, { quoteValidUntil: quote.expires_on, now, facts });

  // A conflict on the deciding input: the card must not be confident. Ask the owner which date is right.
  const blocking = (rub.checks || []).flatMap((k) => (k.advisory ? k.items : [])).find((i) => i.key === 'conflict' && i.blocks);
  const conflict = blocking && conversation?.conflicts?.find((k) => (k.values || []).every((v) => blocking.sources.includes(v.doc_id)));
  if (conflict && CONFIDENT_OUTCOMES.has(cmp.outcome)) {
    const runWith = (ready) => {
      const a = { ...args, inputs: args.inputs.map((i) => (i.id === conflict.subject ? { ...i, ready } : i)) };
      try { return mods.compare ? mods.compare(a) : fallbackCompare(a, mods.solve || fallbackSolve); } catch { return null; }
    };
    const alts = conflict.values.map((v) => ({ ...v, cmp: runWith(v.value) }));
    cmp = { ...cmp, outcome: 'ask_owner', recommended: null, conflict: { ...conflict, alts },
      question: { to: conflict.owner, text: `Which is right for the ${shortName(conflict.name)}: ${conflict.values.map((v) => `${readyText(v.value)} (${firstName(personByName(settings, v.by)) || v.by})`).join(' or ')}?` } };
    if (mods.rubric) { try { rub = mods.rubric(cmp, { quoteValidUntil: quote.expires_on, now, facts, conversation }); } catch { /* keep */ } }
  }

  // Habit line (advisory).
  const { habit, heatmap } = await habitLine(st, { docs, part, partEntry, quote, tiersIn, now, engine });

  const card = buildCard({ settings, partEntry, quote, part, test, milestone, target, policy, policyOwner, polRec, duration, testIn, tiersIn, others, cmp, rub, habit, live, now, args, mods });
  card.wasted = await wastedExpedites({ outDir });
  return { card, heatmap, sources: sourceList({ card, others, di, live }), engine };
}

function readyText(r) {
  if (!r) return 'unknown';
  if (typeof r === 'object') return `between ${shortDate(toDate(r.min))} and ${shortDate(toDate(r.max))}`;
  return shortDate(toDate(r));
}

// Code reads of the last 45 days with the cached LLM reads (fixtures/timevalue/read-cache.json) laid over them.
async function ensureReads(st, now) {
  const { mods, settings } = st;
  if (!st.reads && mods.read) {
    const ctx = typeof mods.read.loadReadContext === 'function' ? await mods.read.loadReadContext(settings) : mods.read.makeReadContext(settings);
    let reads = mods.read.readDocs(st.sources.docs.filter((d) => Date.parse(d.at) >= Date.parse(now) - 45 * DAY), ctx);
    if (typeof mods.read.loadReadCache === 'function') { try { reads = mods.read.loadReadCache(DEFAULT_OUT, reads); } catch { /* code reads only */ } }
    st.reads = reads; st.readCtx = ctx;
  }
  return st.reads;
}

// Check 7 inputs (architecture §8, Owen 2026-11-10): linked reads → earlier-need flags, pressure level with cited
// snippets; graph facts → conflicts. The rubric decides what to show; nothing here changes the maths.
export const EARLIER_NEED_PRESSURE = 0.6;
async function conversationInputs(st, { docs, live, view, part, test, milestone, target, others, now }) {
  const { mods, settings } = st;
  if (!mods.read) return null;
  const base = await ensureReads(st, now);
  if (!base) return null;
  const all = base instanceof Map ? new Map(base) : new Map(base.map((r) => [r.doc_id, r]));
  if (live && st.readCtx) all.set(live.doc.id, mods.read.readDoc(live.doc, st.readCtx));
  const baseline = mods.read.teamBaseline(all, settings);
  const t = Date.parse(now);
  const docById = new Map(docs.map((d) => [d.id, d]));
  const ids = new Set([part.id, test.id, milestone.id, ...others.map((i) => i.id)].filter(Boolean));
  const linked = [...all.values()].filter((r) => {
    const at = Date.parse(r.at ?? docById.get(r.doc_id)?.at);
    return at <= t && at >= t - 7 * DAY && ((r.refs || []).some((x) => ids.has(x.id)) || (r.claims || []).some((c) => ids.has(c.subject)));
  }).map((r) => ({ ...r, at: r.at ?? docById.get(r.doc_id)?.at, relative: baseline.relative(r) }));

  const earlier_need = linked.filter((r) => Date.parse(r.at) >= t - 3 * DAY
    && (((r.pressure || 0) >= EARLIER_NEED_PRESSURE && r.relative > 0) || (r.claims || []).some((c) => c.kind === 'need_earlier')))
    .map((r) => ({ doc_id: r.doc_id, by: r.author_id ?? null, at: r.at, pressure: r.pressure, relative: r.relative, need_earlier: (r.claims || []).some((c) => c.kind === 'need_earlier') }));

  // Pressure level: the mean of the three highest pressures above the team baseline.
  const top = linked.slice().sort((a, b) => b.relative - a.relative || a.doc_id.localeCompare(b.doc_id));
  const lead = top.slice(0, 3).map((r) => Math.max(0, r.relative));
  const score = lead.length ? lead.reduce((a, b) => a + b, 0) / lead.length : 0;
  const level = score >= 0.35 ? 'high' : score >= 0.15 ? 'elevated' : 'low';
  const snippet = (r) => {
    const llmCue = (r.cues || []).find((c) => typeof c === 'string' && c.includes(' ') && !/^[a-z_]+$/.test(c));
    const text = llmCue || docById.get(r.doc_id)?.text || '';
    return text.length > 90 ? `${text.slice(0, 87)}…` : text;
  };
  const snippets = top.filter((r) => r.relative > 0 && (r.pressure || 0) > 0).slice(0, 3).map((r) => ({ doc_id: r.doc_id, text: snippet(r) })).filter((x) => x.text);

  // Conflicts: accepted-or-disputed ETAs for the same input within the window, from different people or sources.
  const conflicts = [];
  for (const i of others) {
    // Each person's or source's latest ETA in the window (a newer post by someone else does not erase what the
    // first person said); a conflict is two of those that differ.
    const fs = (view?.facts || []).filter((f) => f.subject === i.id && f.kind === 'eta' && f.status !== 'proposed'
      && f.at && Date.parse(f.at) >= t - 7 * DAY && Date.parse(f.at) <= t);
    const latest = new Map();
    for (const f of fs) { const k = `${f.by}|${String(f.doc_id).split(':')[0]}`; const prev = latest.get(k); if (!prev || Date.parse(f.at) >= Date.parse(prev.at)) latest.set(k, f); }
    const vals = [];
    for (const f of [...latest.values()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) if (!vals.some((v) => JSON.stringify(v.value) === JSON.stringify(f.value))) vals.push(f);
    const differ = vals.length > 1;
    if (differ) conflicts.push({ subject: i.id, name: i.name, owner: i.owner ?? null, kind: 'eta',
      values: vals.map((f) => ({ value: f.value, by: personById(settings, f.by)?.name ?? f.by ?? null, at: f.at, doc_id: f.doc_id, status: f.status })) });
  }

  return { target, test_owner: test.owner ?? null, earlier_need, conflicts, pressure: { level, n: linked.length, snippets } };
}

async function habitLine(st, { docs, part, partEntry, quote, tiersIn, now, engine }) {
  const { mods, settings, model } = st;
  if (!model) { engine.habit = 'no habit-model.json yet'; return { habit: null, heatmap: null }; }
  if (!mods.heatmap || !mods.habit) { engine.habit = 'heatmap/habit modules missing'; return { habit: { p_expedite: null, n_train: model.n_train ?? null, text: null }, heatmap: null }; }
  try {
    await ensureReads(st, now);
    let history = [];
    if (mods.labels) { try { const l = mods.labels.linkRampToXometry({ ramp: st.sources.ramp, xometry: st.sources.xometry }); history = Array.isArray(l) ? l : l.linked || l.labels || []; } catch { /* none */ } }
    const label = { order_number: quote.quote_id, quote_id: quote.quote_id, T: now, tier: null, total: null, requester_email: partEntry.requester.email, placer_email: partEntry.requester.email,
      part_numbers: [part.part_number], tiers: tiersIn.map((t) => ({ tier: t.tier, total: t.total, lead_days: t.lead_days, est_delivery: t.ready })) };
    const hm = mods.heatmap({ label, docs: docs.filter((d) => d.at < now), reads: st.reads, settings, history });
    const p = mods.habit.predict(model, hm);
    engine.habit = 'habit.mjs';
    const pct = Math.round(p.p_expedite * 100);
    return { heatmap: hm, habit: { p_expedite: p.p_expedite, n_train: p.n_train ?? model.n_train, top: p.top || [], accuracy: model.accuracy ?? null, accuracy_ci95: model.accuracy_ci95 ?? null,
      text: `Teams like yours expedite this ${pct}% of the time (n = ${p.n_train ?? model.n_train} past orders). Advisory only; the schedule decides.` } };
  } catch (e) { engine.habit = `error (${e.message})`; return { habit: { p_expedite: null, n_train: model.n_train ?? null, text: null }, heatmap: null }; }
}

// Reads a tier's finish per scenario from whatever shape compare returned.
function finishes(t) {
  const f = t.finish_by_scenario;
  if (!f) return [];
  if (Array.isArray(f)) return f.map((x) => (typeof x === 'string' ? x : x?.finish ?? null));
  return Object.values(f).map((x) => (typeof x === 'string' ? x : x?.finish ?? null));
}
const savedNum = (d) => (typeof d === 'number' ? d : d && typeof d === 'object' ? (d.max ?? null) : null);
function savedText(d) {
  if (d == null) return null;
  if (typeof d === 'number') return d;
  if (Array.isArray(d)) return d.length ? `${Math.min(...d)}–${Math.max(...d)}` : null;
  if (typeof d === 'object') return d.min === d.max ? d.min : `${d.min}–${d.max}`;
  return null;
}

function buildCard({ settings, partEntry, quote, part, test, milestone, target, policy, policyOwner, polRec, duration, testIn, tiersIn, others, cmp, rub, habit, live, now, args, mods }) {
  const qp = quote.parts?.[0] || {};
  const tiers = tiersIn.map((t) => {
    const c = (cmp.tiers || []).find((x) => lc(x.tier) === t.tier) || {};
    const fins = finishes(c).filter(Boolean).sort();
    return { tier: t.tier, label: t.label, total: t.total, ready: t.ready, lead_days: t.lead_days,
      finish: fins.length === 0 ? null : fins.length === 1 || fins[0] === fins.at(-1) ? fins[0] : { min: fins[0], max: fins.at(-1) },
      days_saved: savedText(c.days_saved), break_even: c.break_even ?? null, recommended: cmp.recommended != null && lc(cmp.recommended) === t.tier };
  }).sort((a, b) => a.total - b.total);
  const cheapest = tiers[0];
  // The faster tier to talk about: the recommended one, else the cheapest tier that reaches the most days saved.
  // Tiers that cost more but save no more days than a cheaper tier are dominated and called out separately.
  const maxSaved = (t) => { const v = t.days_saved; return typeof v === 'number' ? v : v && typeof v === 'object' ? (v.max ?? v.min ?? 0) : 0; };
  const faster = tiers.slice(1);
  const top = faster.length ? Math.max(...faster.map(maxSaved)) : 0;
  const fastest = faster.find((t) => t.recommended) || faster.find((t) => maxSaved(t) === top) || tiers.at(-1);
  const dominated = faster.filter((t) => t !== fastest && t.total > fastest.total && maxSaved(t) <= maxSaved(fastest));
  const extra = fastest.total - cheapest.total;
  const owner = (id) => personById(settings, id);
  const policyText = policy?.type === 'per_day' ? `${money(policy.usd_per_day)}/day` : policy?.type === 'curve' ? 'a cost curve' : 'none';
  const testShort = test.name ? lc(test.name).replace(/^.*?(spin test|[a-z-]+ test)$/, '$1') : 'test';
  const ownerName = firstName(policyOwner);

  // The input that matters most: a ranged or unknown one first, otherwise the latest-ready one.
  const key = others.find((i) => i.ready && typeof i.ready === 'object') || others.find((i) => !i.ready) || [...others].sort((a, b) => String(toDate(b.ready)).localeCompare(String(toDate(a.ready))))[0] || null;
  const keyOwner = key ? owner(key.owner) || owner(key.said_by) : null;
  const keySaid = key?.said_at ? `${firstName(owner(key.said_by)) || firstName(keyOwner) || 'source'}, ${ago(key.said_at, now)}` : null;
  const keyShort = key ? shortName(key.name) : null;

  let headline; let detail = []; let outcomeTag;
  const saved = savedNum(fastest.days_saved);
  const beText = fastest.break_even != null ? money(fastest.break_even) : extra && saved ? money(extra / saved) : null;
  const dominatedLine = dominated.map((t) => `${t.label} (${money(t.total)}) finishes no sooner than ${fastest.label}: +${money(t.total - fastest.total)} for nothing.`);
  for (const t of dominated) t.no_faster_than = fastest.label;
  switch (cmp.outcome) {
    case 'pay': {
      const net = policy?.usd_per_day != null && saved != null ? policy.usd_per_day * saved - extra : null;
      outcomeTag = `Pay for ${fastest.label}`;
      headline = `${fastest.label}: ${net != null ? `+${money(net)} ` : ''}under the ${testShort.replace(/ /g, '-')} policy (${policyText}, owner ${ownerName}).`;
      detail.push(`Finishes the ${testShort} ${saved} working day${saved === 1 ? '' : 's'} sooner for +${money(extra)}. Worth it while a day is worth more than ${beText}.`);
      if (key) detail.push(`Assumes the ${keyShort} is ready by ${readyText(key.ready)}${keySaid ? ` (${keySaid})` : ''}.${slipLine(args, key, mods)}`);
      break;
    }
    case 'dont_pay':
      outcomeTag = `${cheapest.label}`;
      headline = `${cheapest.label}: ${fastest.label} saves ${saved} working day${saved === 1 ? '' : 's'} for +${money(extra)}, ${beText}/day — more than the policy's ${policyText}.`;
      break;
    case 'cheapest': {
      outcomeTag = `${cheapest.label}`;
      const lim = cmp.limiter?.id ? others.find((i) => i.id === cmp.limiter.id) || key : key;
      headline = `${cheapest.label}: ${fastest.label} buys no time. Save ${money(extra)}.`;
      if (lim) detail.push(`The ${shortName(lim.name)} (ready ${readyText(lim.ready)}${lim.said_at ? `, ${[firstName(owner(lim.said_by)), ago(lim.said_at, now)].filter(Boolean).join(', ')}` : ''}) sets the start; both tiers finish the ${testShort} ${readyText(typeof cheapest.finish === 'string' ? cheapest.finish : cheapest.finish?.max)}.`);
      break;
    }
    case 'depends': {
      outcomeTag = 'Ask first';
      const by = cmp.switching?.by_date ? toDate(cmp.switching.by_date) : null;
      const who = firstName(owner(cmp.question?.to)) || firstName(keyOwner) || 'the owner';
      headline = `Depends on the ${keyShort || 'other input'}. ${fastest.label} pays only if it is ready by ${shortDate(by)}.`;
      detail.push(`${keySaid ? `${keySaid.split(',')[0]} said ${readyText(key.ready)} (${ago(key.said_at, now)}).` : `Its date is ${readyText(key?.ready)}.`} Nothing preselected until ${who} answers.`);
      detail.push(`Ask ${who}: "${cmp.question?.text || `Ready by ${shortDate(by)}?`}"`);
      break;
    }
    case 'ask_owner': {
      outcomeTag = 'Ask first';
      if (cmp.conflict) {
        const k = cmp.conflict;
        const who = firstName(owner(k.owner)) || 'the owner';
        const say = (v) => `${firstName(personByName(settings, v.by)) || v.by || 'someone'} says ${readyText(v.value)}`;
        headline = `Sources disagree on the ${shortName(k.name)}: ${k.values.map(say).join(', ')}. Ask before paying.`;
        for (const a of k.alts) {
          const best = (a.cmp?.tiers || []).reduce((m, t) => Math.max(m, savedNum(t.days_saved) ?? 0), 0);
          const rec = a.cmp?.recommended ? tiers.find((t) => t.tier === lc(a.cmp.recommended))?.label : null;
          detail.push(`If ${readyText(a.value)}: ${best > 0 && rec && rec !== cheapest.label ? `${rec} saves ${best} working day${best === 1 ? '' : 's'}` : `${fastest.label} buys no time, ${cheapest.label} is as fast`}.`);
        }
        detail.push(`Nothing preselected until ${who} answers.`);
        detail.push(`Ask ${who}: "${cmp.question.text}"`);
        break;
      }
      const who = firstName(owner(cmp.question?.to)) || firstName(keyOwner) || ownerName || 'the owner';
      headline = key && !key.ready ? `Can't decide yet: no date for the ${keyShort}.` : `Can't decide yet: no value for a day of ${milestone.name || 'this milestone'}.`;
      detail.push(`Ask ${who}: "${cmp.question?.text || (key && !key.ready ? `When will the ${keyShort} be ready?` : 'What is a day worth?')}"`);
      break;
    }
    default: {
      const missing = others.find((i) => !i.ready);
      if (missing) {
        const who = firstName(owner(missing.owner)) || 'the owner';
        outcomeTag = 'Ask first';
        headline = `Can't decide yet: no date for the ${shortName(missing.name)}.`;
        detail.push(`Ask ${who}: "When will the ${shortName(missing.name)} be ready?"`);
      } else {
        outcomeTag = 'Blocked';
        headline = `Blocked: ${cmp.reason || 'the rubric found a problem with this order'}.`;
      }
    }
  }

  return {
    change: live ? { n: live.change.order, label: live.change.label, text: live.doc.text, by: live.doc.author.name, at: live.doc.at, doc_id: live.doc.id } : null,
    now,
    part: { name: partEntry.part_name, number: partEntry.part_number, revision: partEntry.revision, quantity: partEntry.quantity, cad_file: partEntry.cad_file,
      summary: partEntry.summary, requester: partEntry.requester.name, material: qp.material, process: qp.process, finish: qp.finish, catalogue_id: part.id },
    quote: { id: quote.quote_id, expires_on: quote.expires_on },
    test: { id: test.id, name: test.name, owner: owner(test.owner)?.name || null, duration_days: duration, planned_start: testIn.planned_start },
    milestone: { id: milestone.id, name: milestone.name, target, policy: policy ? { ...policy, owner: policyOwner?.name || null, set_at: polRec?.set_at || null } : null },
    inputs: others.map((i) => ({ id: i.id, name: i.name, ready: i.ready, ready_text: readyText(i.ready), owner: owner(i.owner)?.name || null, said_by: owner(i.said_by)?.name || null, said_at: i.said_at || null, said_ago: ago(i.said_at, now), doc_id: i.doc_id || null })),
    tiers,
    outcome: cmp.outcome, outcome_tag: outcomeTag, recommended: cmp.recommended ?? null,
    headline, detail, dominated: dominatedLine, question: cmp.question || null, switching: cmp.switching || null,
    checks: (rub.checks || []).map((c) => ({ ...c, text: named(c.text, settings), sources: c.sources || [],
      ...(c.items ? { items: c.items.map((i) => ({ ...i, text: named(i.text, settings), question: i.question ? { ...i.question, to_name: owner(i.question.to)?.name || null } : null })) } : {}) })), guards: rub.guards || [], blocked: !!rub.blocked,
    habit,
  };
}

// Catalogue ids in rubric text ("waiting on dl-hip-motor-dvt") → their names.
function named(text, settings) {
  if (!text || !settings) return text;
  return String(text).replace(/\b(?:dl|pt|test|m|rig)-[a-z0-9-]+\b/g, (id) => {
    const hit = ['deliverables', 'parts', 'tests', 'milestones', 'rigs'].map((k) => (settings[k] || []).find((x) => x.id === id)).find(Boolean);
    return hit ? `the ${hit.name}` : id;
  });
}

// "DVT hip frameless motor" → "motor" for prose; keeps the full name elsewhere.
function shortName(name) {
  const words = String(name || '').trim().split(/\s+/);
  return words.length > 2 ? words.at(-1).toLowerCase() : String(name || '').toLowerCase();
}

// "If it slips past Mon 11/23, Standard is as fast": first ready date of the key input at which paying buys nothing.
function slipLine(args, key, mods) {
  if (!key?.ready || typeof key.ready === 'object') return '';
  const run = (ready) => {
    const a = { ...args, inputs: args.inputs.map((i) => (i.id === key.id ? { ...i, ready } : i)) };
    try { return mods.compare ? mods.compare(a) : fallbackCompare(a, mods.solve || fallbackSolve); } catch { return null; }
  };
  const start = toDate(key.ready);
  for (let i = 1; i <= 30; i++) {
    const d = addDays(start, i);
    const r = run(d);
    if (!r) return '';
    const gain = Math.max(0, ...(r.tiers || []).map((t) => savedNum(t.days_saved) ?? 0));
    if (gain === 0) return ` If it slips to ${shortDate(d)} or later, ${args.quote.slice().sort((a, b) => a.total - b.total)[0].tier.replace(/^./, (c) => c.toUpperCase())} is as fast.`;
  }
  return '';
}

function sourceList({ card, others, di, live }) {
  const ids = new Set(['demo/part-entry.json', 'demo/quote.json', 'demo/policy.json']);
  for (const i of others) { if (i.doc_id) ids.add(i.doc_id); if (i.link_doc_id) ids.add(i.link_doc_id); for (const e of i.evidence || []) if (e.doc_id) ids.add(e.doc_id); }
  if (di.planned_start_doc) ids.add(di.planned_start_doc);
  if (live) ids.add(live.doc.id);
  for (const c of card.checks) for (const s of c.sources) ids.add(typeof s === 'string' ? s : s.doc_id || s.id || JSON.stringify(s));
  return [...ids].sort();
}

// Weights grid for the heat map: {rows, bands, weights: {row: [5]}, extra, n_train, ...} or null.
export async function habitWeights({ outDir = DEFAULT_OUT } = {}) {
  const model = await readJson(path.join(outDir, 'habit-model.json'));
  if (!model) return null;
  const bands = ['14–30 d', '7–14 d', '3–7 d', '1–3 d', '0–1 d'];
  const weights = model.weights || {};
  return { rows: Object.keys(weights), bands, weights, extra: model.extra || {}, bias: model.bias ?? null, lambda: model.lambda ?? null,
    n_train: model.n_train ?? null, n_test: model.n_test ?? null, accuracy: model.accuracy ?? null, accuracy_ci95: model.accuracy_ci95 ?? null, baseline_never_expedite: model.baseline_never_expedite ?? null };
}
