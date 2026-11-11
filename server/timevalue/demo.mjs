// Demo service: the recommendation card for the demo order, built from rendered sources only.
//
//   demoCard({change: 0|1|2|3, sourcesDir, outDir}) → {card, sources, engine}
//
// part entry → resolve the part → graphAt(now) → demoInputs → compare → rubric (check 7 from the reads).
// Change 1, 2 or 3 appends demo/live-changes.json[n − 1] as a Slack doc, re-extracts claims and re-solves.
// No model call anywhere: the LLM reads come precomputed from <outDir>/read-cache.json.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compare, rubric } from '../../src/timevalue/index.mjs';
import { loadSources } from './sources.mjs';
import { makeResolver } from './refs.mjs';
import { extractClaims } from './claims.mjs';
import { buildGraph, graphAt, demoInputs } from './graph.mjs';
import { loadReadContext, readDoc, readDocs, loadReadCache, teamBaseline } from './read.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '../..');
// Until the world and its text are final, the demo runs on a small fixture in the rendered-source format
// (fixtures/timevalue/demo-sources/, built from fixtures/flintlock/demo/ and the pinned dates of
// simulation-spec.md S14). Point at the final render with TIMEVALUE_SOURCES=fixtures/flintlock or --sources.
export const FIXTURE_SOURCES = path.join(ROOT, 'fixtures/timevalue/demo-sources');
export const DEFAULT_SOURCES = process.env.TIMEVALUE_SOURCES ? path.resolve(ROOT, process.env.TIMEVALUE_SOURCES) : FIXTURE_SOURCES;
export const DEFAULT_OUT = path.join(ROOT, 'fixtures/timevalue');

// Which code produced each step (kept in the output so a reader can tell where a card came from).
const ENGINE = { settings: 'settings.json', sources: 'sources.mjs', graph: 'graph.mjs', maths: 'src/timevalue' };

async function readJson(file, fallback = null) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
}

// The banner over the card: wasted rush orders in the last 3 months, from grading.json (fallback: the graded numbers).
export const WASTED_FALLBACK = { count: 61, expedited: 133, premium_usd: 31159 };
export async function wastedExpedites({ outDir = DEFAULT_OUT } = {}) {
  const w = (await readJson(path.join(outDir, 'grading.json')))?.wasted_expedites;
  return w && Number.isFinite(w.count) && Number.isFinite(w.expedited) && Number.isFinite(w.premium_usd)
    ? { count: w.count, expedited: w.expedited, premium_usd: Math.round(w.premium_usd) } : { ...WASTED_FALLBACK };
}

// ------------------------------------------------------------------ small helpers

const DAY = 86400e3;
const parseD = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const addDays = (d, n) => new Date(parseD(d) + n * DAY).toISOString().slice(0, 10);
const toDate = (x) => (x == null ? null : String(x).slice(0, 10));
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const shortDate = (d) => (d ? `${WEEKDAY[new Date(parseD(d)).getUTCDay()]} ${+d.slice(5, 7)}/${+d.slice(8, 10)}` : 'unknown');
const money = (n) => (n == null ? '—' : '$' + Math.round(n).toLocaleString('en-US'));
const lc = (s) => String(s || '').toLowerCase();
// Sources carry Pacific times with an offset, so the first 10 characters are the local date.
function ago(at, now) {
  if (!at) return null;
  const days = Math.round((parseD(toDate(now)) - parseD(toDate(at))) / DAY);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
}

const personBySlack = (settings, sid) => settings.people?.find((p) => p.slack_id === sid) || null;
const personById = (settings, id) => settings.people?.find((p) => p.id === id || p.email === id) || null;
const personByName = (settings, name) => settings.people?.find((p) => p.name === name) || null;
const firstName = (p) => (p?.name || '').split(' ')[0] || null;

function readyText(r) {
  if (!r) return 'unknown';
  if (typeof r === 'object') return `between ${shortDate(toDate(r.min))} and ${shortDate(toDate(r.max))}`;
  return shortDate(toDate(r));
}

// "DVT hip frameless motor" → "motor" for prose; keeps the full name elsewhere.
function shortName(name) {
  const words = String(name || '').trim().split(/\s+/);
  return words.length > 2 ? words.at(-1).toLowerCase() : String(name || '').toLowerCase();
}

// Catalogue ids in rubric text ("waiting on dl-hip-motor-dvt") → their names.
function named(text, settings) {
  if (!text) return text;
  return String(text).replace(/\b(?:dl|pt|test|m|rig)-[a-z0-9-]+\b/g, (id) => {
    const hit = ['deliverables', 'parts', 'tests', 'milestones', 'rigs'].map((k) => (settings[k] || []).find((x) => x.id === id)).find(Boolean);
    return hit ? `the ${hit.name}` : id;
  });
}

// ------------------------------------------------------------------ pipeline state (cached per sources dir)

const cache = new Map();

function requireDemoFiles(demo, dir) {
  const need = { partEntry: 'part-entry.json', quote: 'quote.json' };
  const missing = Object.entries(need).filter(([k]) => !demo?.[k]).map(([, f]) => path.join(dir, 'demo', f));
  if (missing.length) throw new Error(`demo source missing or unreadable: ${missing.join(', ')}`);
  if (!Array.isArray(demo.quote.lead_time_options) || !demo.quote.lead_time_options.length) {
    throw new Error(`${path.join(dir, 'demo/quote.json')} has no lead_time_options`);
  }
}

async function baseState(sourcesDir, outDir) {
  const key = `${sourcesDir}|${outDir}`;
  if (!cache.has(key)) {
    const promise = (async () => {
      const settingsFile = path.join(outDir, 'settings.json');
      const settings = await readJson(settingsFile);
      if (!settings) throw new Error(`${settingsFile} missing or unreadable (run scripts/timevalue/export-settings.mjs)`);
      const sources = loadSources(sourcesDir);
      requireDemoFiles(sources.demo, sourcesDir);
      const resolve = makeResolver(settings);
      const baseClaims = sources.docs.flatMap((d) => extractClaims(d, resolve));
      return { settings, sources, resolve, baseClaims, outDir, reads: null };
    })();
    cache.set(key, promise);
    promise.catch(() => cache.delete(key));
  }
  return cache.get(key);
}
export function clearDemoCache() { cache.clear(); }

// demo/live-changes.json entry n as a Slack doc, offset from demo_now.
function liveDoc(sources, settings, change) {
  const list = sources.demo.liveChanges?.changes || [];
  const c = list.find((x) => x.order === change) || list[change - 1];
  if (!c?.message) throw new Error(`no live change ${change} in demo/live-changes.json`);
  const base = settings.demo_now || sources.demo.partEntry.entered_at;
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
  const { settings } = st;
  const engine = { ...ENGINE };
  const { partEntry, quote, policy: policyFile } = st.sources.demo;
  let now = settings.demo_now || partEntry.entered_at;
  if (!now) throw new Error('no demo time: settings.demo_now and part-entry.json entered_at are both missing');

  // Live change: one more Slack doc.
  let docs = st.sources.docs; let live = null; let claims = st.baseClaims;
  if (change > 0) {
    live = liveDoc(st.sources, settings, change);
    docs = [...docs, live.doc];
    if (live.doc.at > now) now = live.doc.at;
    claims = [...claims, ...extractClaims(live.doc, st.resolve)];
  }
  const sources = { ...st.sources, docs };

  // Resolve the part.
  const part = (settings.parts || []).find((p) => p.part_number === partEntry.part_number)
    || { id: partEntry.part_number, part_number: partEntry.part_number, name: partEntry.part_name, aliases: [] };

  // Graph → demo inputs.
  const view = graphAt(buildGraph({ settings, sources, claims }), now);
  const di = demoInputs(view, part.id);

  const test = di.test || {};
  const milestone = di.milestone || {};
  const polRec = (policyFile?.policies || []).find((p) => lc(p.milestone) === lc(milestone.name)) || null;
  const policy = di.policy ? { type: di.policy.type, usd_per_day: di.policy.usd_per_day ?? null, curve: di.policy.curve ?? null }
    : polRec ? { type: polRec.type, usd_per_day: polRec.usd_per_day, curve: polRec.curve } : null;
  const policyOwner = personById(settings, di.policy?.by) || personById(settings, polRec?.set_by?.email) || personById(settings, milestone.owner);
  // A live message can pull the milestone in to a hard date ("has to be done by 11/18 (hard date ...)").
  const hardM = String(live?.doc?.text || live?.text || '').match(/done by (\d{1,2})\/(\d{1,2})[^)]*hard/i);
  const hardDate = hardM ? `${String(now).slice(0, 4)}-${hardM[1].padStart(2, '0')}-${hardM[2].padStart(2, '0')}` : null;
  const target = hardDate || polRec?.milestone_date || null;
  const duration = di.duration?.value ?? null;

  const holidays = settings.holidays || [];
  const tiersIn = quote.lead_time_options.map((o) => ({ tier: lc(o.lead_time), label: o.lead_time, total: o.total, ready: o.estimated_delivery_date, lead_days: o.lead_time_business_days }));
  const others = (di.inputs || []).filter((i) => i.id !== part.id && i.kind !== 'part').map((i) => {
    const dl = (settings.deliverables || []).find((d) => d.id === i.id) || (settings.parts || []).find((p) => p.id === i.id);
    return { ...i, name: i.name || dl?.name || i.id, owner: i.owner || dl?.owner || null, ready: i.ready && typeof i.ready === 'object' && !('min' in i.ready) ? i.ready.value ?? null : i.ready };
  });
  const testIn = { id: test.id, owner: test.owner, planned_start: hardDate ? toDate(now) : toDate(di.planned_start?.value), duration_days: duration, rig_slot_days: di.rig?.slot_days ?? null, bookings: [], owner_out: [] };
  const args = { holidays, part: part.id, quote: tiersIn.map(({ tier, total, ready }) => ({ tier, total, ready })), test: testIn, inputs: others.map((i) => ({ id: i.id, ready: i.ready, owner: i.owner, said_by: i.said_by, name: i.name })), milestone: { id: milestone.id, target, policy, owner: milestone.owner }, now };

  let cmp = compare(args);

  const facts = [
    { about: 'quote', text: `Quote ${quote.quote_id} valid until ${quote.expires_on}`, by: 'Xometry', at: quote.created_at, doc_id: 'demo/quote.json' },
    ...(policy?.usd_per_day != null ? [{ about: 'value', text: `${milestone.name}: $${policy.usd_per_day}/day`, by: di.policy?.by || polRec?.set_by?.email || null, at: di.policy?.at || polRec?.set_at || null, doc_id: 'demo/policy.json' }] : []),
    ...(di.planned_start_doc ? [{ about: 'schedule', text: `${test.name}: starts ${testIn.planned_start}, ${duration} working days`, by: test.owner, at: null, doc_id: di.planned_start_doc }] : []),
    ...others.filter((i) => i.link_doc_id).map((i) => ({ about: 'schedule', text: `${test.name} waits on ${i.name}`, by: test.owner, at: null, doc_id: i.link_doc_id })),
    ...others.filter((i) => i.doc_id).map((i) => ({ about: 'limiter', text: `${i.name} ready ${readyText(i.ready)}`, by: i.said_by, at: i.said_at, doc_id: i.doc_id })),
  ];
  // A calendar booking's doc time is its start (in the future); the fact is the calendar as read now.
  for (const f of facts) if (!f.at && f.doc_id) f.at = f.doc_id.startsWith('cal:') ? now : docs.find((d) => d.id === f.doc_id)?.at || null;

  // Check 7 is advisory: if the reads fail, the card still renders without it.
  let conversation = null;
  try { conversation = await conversationInputs(st, { docs, live, view, part, test, milestone, target, others, now }); engine.conversation = 'read-cache + graph'; }
  catch (e) { engine.conversation = `error (${e.message})`; }
  const rubricArgs = { quoteValidUntil: quote.expires_on, now, facts, conversation };
  let rub = rubric(cmp, rubricArgs);
  engine.rubric = 'src/timevalue';

  // A conflict on the deciding input: the card must not be confident. Ask the owner which date is right.
  const blocking = (rub.checks || []).flatMap((k) => (k.advisory ? k.items : [])).find((i) => i.key === 'conflict' && i.blocks);
  const conflict = blocking && conversation?.conflicts?.find((k) => k.values.every((v) => blocking.sources.includes(v.doc_id)));
  if (conflict && CONFIDENT_OUTCOMES.has(cmp.outcome)) {
    const alts = conflict.values.map((v) => ({ ...v, cmp: compareWith(args, conflict.subject, v.value) }));
    cmp = { ...cmp, outcome: 'ask_owner', recommended: null, conflict: { ...conflict, alts },
      question: { to: conflict.owner, text: `Which is right for the ${shortName(conflict.name)}: ${conflict.values.map((v) => `${readyText(v.value)} (${firstName(personByName(settings, v.by)) || v.by})`).join(' or ')}?` } };
    rub = rubric(cmp, rubricArgs);
  }

  const card = buildCard({ settings, partEntry, quote, part, test, milestone, target, policy, policyOwner, polRec, duration, testIn, tiersIn, others, cmp, rub, live, now, args });
  if (hardDate) applyHardDate(card, hardDate);
  card.wasted = await wastedExpedites({ outDir });
  return { card, sources: sourceList({ card, others, di, live }), engine };
}

// Hard date: a tier that finishes after it is not an option; the cheapest tier that makes it is the answer.
function applyHardDate(card, date) {
  const fin = (t) => (typeof t.finish === 'string' ? t.finish : t.finish?.max) || null;
  const ok = card.tiers.filter((t) => fin(t) && fin(t) <= date).sort((a, b) => a.total - b.total);
  const late = card.tiers.filter((t) => !ok.includes(t));
  const short = (d) => { const x = new Date(d + 'T00:00:00Z'); return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][x.getUTCDay()]} ${x.getUTCMonth() + 1}/${x.getUTCDate()}`; };
  card.milestone = { ...card.milestone, target: date, hard: true };
  if (card.test) card.test = { ...card.test, planned_start: String(card.now || '').slice(0, 10) || card.test.planned_start };
  if (!ok.length) { card.outcome = 'blocked'; card.headline = `No option finishes the spin test by the hard date (${short(date)}).`; return; }
  const pick = ok[0];
  card.tiers = card.tiers.map((t) => ({ ...t, recommended: t.tier === pick.tier, misses_hard_date: !ok.includes(t) }));
  card.outcome = 'pay'; card.recommended = pick.tier; card.outcome_tag = `Pay for ${pick.label}`;
  card.headline = `${pick.label}: the only option that finishes the spin test by the hard date, ${short(date)}.`;
  card.detail = [`The motor is on the bench (Arjun) and the spin test was pulled in to ${short(date)} for the investor visit.`,
    ...late.map((t) => `${t.label} finishes ${short(fin(t))}: misses the hard date.`),
    `${pick.label} finishes ${short(fin(pick))} for ${card.tiers.find((t) => t.tier === pick.tier).total.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}.`];
  card.dominated = null;
}

// compare() with one input's ready date replaced; null if the maths rejects it.
function compareWith(args, inputId, ready) {
  try { return compare({ ...args, inputs: args.inputs.map((i) => (i.id === inputId ? { ...i, ready } : i)) }); } catch { return null; }
}

// ------------------------------------------------------------------ check 7 inputs

// Code reads of the last 45 days with the cached LLM reads (<outDir>/read-cache.json) laid over them.
// Computed once per state, at the first card's `now`.
function ensureReads(st, now) {
  if (!st.reads) {
    st.reads = (async () => {
      const ctx = await loadReadContext(st.settings);
      const recent = st.sources.docs.filter((d) => Date.parse(d.at) >= Date.parse(now) - 45 * DAY);
      return { reads: loadReadCache(st.outDir, readDocs(recent, ctx)), ctx };
    })();
    st.reads.catch(() => { st.reads = null; }); // retry on the next card
  }
  return st.reads;
}

// Check 7 (architecture §8, Owen 2026-11-10): linked reads → earlier-need flags, pressure level with cited
// snippets; graph facts → conflicts. The rubric decides what to show; nothing here changes the maths.
export const EARLIER_NEED_PRESSURE = 0.6;
async function conversationInputs(st, { docs, live, view, part, test, milestone, target, others, now }) {
  const { settings } = st;
  const { reads, ctx } = await ensureReads(st, now);
  const all = new Map(reads);
  if (live) all.set(live.doc.id, readDoc(live.doc, ctx));
  const baseline = teamBaseline(all, settings);
  const t = Date.parse(now);
  const docById = new Map(docs.map((d) => [d.id, d]));
  const ids = new Set([part.id, test.id, milestone.id, ...others.map((i) => i.id)].filter(Boolean));
  const linked = [...all.values()].filter((r) => {
    const at = Date.parse(r.at ?? docById.get(r.doc_id)?.at);
    return at <= t && at >= t - 7 * DAY && ((r.refs || []).some((x) => ids.has(x.id)) || (r.claims || []).some((c) => ids.has(c.subject)));
  }).map((r) => ({ ...r, at: r.at ?? docById.get(r.doc_id)?.at, relative: baseline.relative(r) }));

  const needEarlier = (r) => (r.claims || []).some((c) => c.kind === 'need_earlier');
  const earlier_need = linked.filter((r) => Date.parse(r.at) >= t - 3 * DAY && (((r.pressure || 0) >= EARLIER_NEED_PRESSURE && r.relative > 0) || needEarlier(r)))
    .map((r) => ({ doc_id: r.doc_id, by: r.author_id ?? null, at: r.at, pressure: r.pressure, relative: r.relative, need_earlier: needEarlier(r) }));

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

  // Conflicts: each person's or source's latest accepted-or-disputed ETA for an input within the window (a newer
  // post by someone else does not erase what the first person said); a conflict is two of those that differ.
  const conflicts = [];
  for (const i of others) {
    const fs = (view.facts || []).filter((f) => f.subject === i.id && f.kind === 'eta' && f.status !== 'proposed'
      && f.at && Date.parse(f.at) >= t - 7 * DAY && Date.parse(f.at) <= t);
    const latest = new Map();
    for (const f of fs) { const k = `${f.by}|${String(f.doc_id).split(':')[0]}`; const prev = latest.get(k); if (!prev || Date.parse(f.at) >= Date.parse(prev.at)) latest.set(k, f); }
    const vals = [];
    for (const f of [...latest.values()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) if (!vals.some((v) => JSON.stringify(v.value) === JSON.stringify(f.value))) vals.push(f);
    if (vals.length > 1) conflicts.push({ subject: i.id, name: i.name, owner: i.owner ?? null, kind: 'eta',
      values: vals.map((f) => ({ value: f.value, by: personById(settings, f.by)?.name ?? f.by ?? null, at: f.at, doc_id: f.doc_id, status: f.status })) });
  }

  return { target, test_owner: test.owner ?? null, earlier_need, conflicts, pressure: { level, n: linked.length, snippets } };
}

// ------------------------------------------------------------------ card text

function buildCard({ settings, partEntry, quote, part, test, milestone, target, policy, policyOwner, polRec, duration, testIn, tiersIn, others, cmp, rub, live, now, args }) {
  const qp = quote.parts?.[0] || {};
  const tiers = tiersIn.map((t) => {
    const c = (cmp.tiers || []).find((x) => lc(x.tier) === t.tier) || {};
    const fins = Object.values(c.finish_by_scenario || {}).filter(Boolean).sort();
    return { tier: t.tier, label: t.label, total: t.total, ready: t.ready, lead_days: t.lead_days,
      finish: fins.length === 0 ? null : fins[0] === fins.at(-1) ? fins[0] : { min: fins[0], max: fins.at(-1) },
      days_saved: c.days_saved ?? null, break_even: c.break_even ?? null, recommended: cmp.recommended != null && lc(cmp.recommended) === t.tier };
  }).sort((a, b) => a.total - b.total);
  const cheapest = tiers[0];
  // The faster tier to talk about: the recommended one, else the cheapest tier that reaches the most days saved.
  // Tiers that cost more but save no more days than a cheaper tier are dominated and called out separately.
  // With a single-tier quote, `fastest` is the cheapest tier itself.
  const maxSaved = (t) => t.days_saved ?? 0;
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

  let headline; const detail = []; let outcomeTag;
  const saved = fastest.days_saved;
  const beText = fastest.break_even != null ? money(fastest.break_even) : extra && saved ? money(extra / saved) : null;
  const dominatedLine = dominated.map((t) => `${t.label} (${money(t.total)}) finishes no sooner than ${fastest.label}: +${money(t.total - fastest.total)} for nothing.`);
  for (const t of dominated) t.no_faster_than = fastest.label;
  switch (cmp.outcome) {
    case 'pay': {
      const net = policy?.usd_per_day != null && saved != null ? policy.usd_per_day * saved - extra : null;
      outcomeTag = `Pay for ${fastest.label}`;
      headline = `${fastest.label}: ${net != null ? `+${money(net)} ` : ''}under the ${testShort.replace(/ /g, '-')} policy (${policyText}, owner ${ownerName}).`;
      detail.push(`Finishes the ${testShort} ${saved} working day${saved === 1 ? '' : 's'} sooner for +${money(extra)}. Worth it while a day is worth more than ${beText}.`);
      if (key) detail.push(`Assumes the ${keyShort} is ready by ${readyText(key.ready)}${keySaid ? ` (${keySaid})` : ''}.${slipLine(args, key)}`);
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
      const by = toDate(cmp.switching?.by_date);
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
          const best = (a.cmp?.tiers || []).reduce((m, t) => Math.max(m, t.days_saved ?? 0), 0);
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
    default: { // 'blocked'
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
      summary: partEntry.summary, requester: partEntry.requester?.name ?? null, material: qp.material, process: qp.process, finish: qp.finish, catalogue_id: part.id },
    quote: { id: quote.quote_id, expires_on: quote.expires_on },
    test: { id: test.id, name: test.name, owner: owner(test.owner)?.name || null, duration_days: duration, planned_start: testIn.planned_start },
    milestone: { id: milestone.id, name: milestone.name, target, policy: policy ? { ...policy, owner: policyOwner?.name || null, set_at: polRec?.set_at || null } : null },
    inputs: others.map((i) => ({ id: i.id, name: i.name, ready: i.ready, ready_text: readyText(i.ready), owner: owner(i.owner)?.name || null, said_by: owner(i.said_by)?.name || null, said_at: i.said_at || null, said_ago: ago(i.said_at, now), doc_id: i.doc_id || null })),
    tiers,
    outcome: cmp.outcome, outcome_tag: outcomeTag, recommended: cmp.recommended ?? null,
    headline, detail, dominated: dominatedLine, question: cmp.question || null, switching: cmp.switching || null,
    checks: (rub.checks || []).map((c) => ({ ...c, text: named(c.text, settings), sources: c.sources || [],
      ...(c.items ? { items: c.items.map((i) => ({ ...i, text: named(i.text, settings), question: i.question ? { ...i.question, to_name: owner(i.question.to)?.name || null } : null })) } : {}) })), guards: rub.guards || [], blocked: !!rub.blocked,
  };
}

// "If it slips to Mon 11/23 or later, Standard is as fast": first ready date of the key input at which paying buys nothing.
function slipLine(args, key) {
  if (!key?.ready || typeof key.ready === 'object') return '';
  const start = toDate(key.ready);
  for (let i = 1; i <= 30; i++) {
    const d = addDays(start, i);
    const r = compareWith(args, key.id, d);
    if (!r) return '';
    const gain = Math.max(0, ...(r.tiers || []).map((t) => t.days_saved ?? 0));
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
