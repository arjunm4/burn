// Context heat map: the habit model's only input (architecture §10).
//
// heatmap({label, docs, reads, settings, progress, history}) →
//   {order_number, T, cells: {row: [b14_30, b7_14, b3_7, b1_3, b0_1]}, flags: {no_context},
//    extra: {requester_expedite_rate, extra_usd_expedite}, linked: [doc_id]}
//
// Built from the context linked to the order's parts, never from the dependency graph.
// Only context strictly before T is used (docs, reads, claims, earlier labels, progress).
//
// Inputs
//   label     one row of labels.linkRampToXometry (order_number, quote_id, T, tier, requester_email,
//             part_numbers, tiers: [{tier, total, lead_days}]).
//   docs      sources.docs ({id, source, container, thread, author: {email, slack_id, name}, at, text}).
//   reads     readDoc results ({doc_id, refs, claims, pressure, ...}) as an array, a Map or an object by doc_id.
//   settings  settings.json (people, teams, parts).
//   progress  optional: a function (assembly, atIso) → rank | null, or an array of
//             {week_start, assembly, rank} rows. Missing → progress_rank cells are null.
//   history   optional: every labelled order; only those with T < label.T are used.
//   ctx       optional precomputed {sidx, ridx, baseline} (settingsIndex, readsIndex, makeBaseline) for speed.

import { weekStart, localDate } from '../../scripts/generate-world/lib/calendar.mjs';
import { toPacificIso } from '../../scripts/generate-world/schema.mjs';

const DAY = 86400e3;

// Bands before T, oldest first: [start days before T, end days before T).
export const BANDS = [
  { key: 'b14_30', from: 30, to: 14 },
  { key: 'b7_14', from: 14, to: 7 },
  { key: 'b3_7', from: 7, to: 3 },
  { key: 'b1_3', from: 3, to: 1 },
  { key: 'b0_1', from: 1, to: 0 },
];
export const BAND_DAYS = BANDS.map((b) => b.from - b.to); // 16, 7, 4, 2, 1

export const ROWS = [
  'messages',
  'pressure',
  'deadline_talk',
  'waiting_talk',
  'slips',
  'people',
  'manager',
  'meetings',
  'progress_rank',
  'id_share',
];
export const EXTRAS = ['requester_expedite_rate', 'extra_usd_expedite'];

const WINDOW_DAYS = 30;
const RATE_PRIOR = 3; // pseudo-orders pulling a requester's rate toward the team rate

const ms = (iso) => Date.parse(iso);

export function readsIndex(reads) {
  if (!reads) return new Map();
  if (reads instanceof Map) return reads;
  if (Array.isArray(reads)) return new Map(reads.map((r) => [r.doc_id, r]));
  return new Map(Object.entries(reads));
}

// Lookups that only depend on settings; build once and pass as `ctx` for speed.
export function settingsIndex(settings = {}) {
  const people = settings.people ?? [];
  const byEmail = new Map();
  const bySlack = new Map();
  const byName = new Map();
  for (const p of people) {
    if (p.email) byEmail.set(p.email.toLowerCase(), p);
    if (p.slack_id) bySlack.set(p.slack_id, p);
    if (p.name) byName.set(p.name.toLowerCase(), p);
  }
  const leads = new Set((settings.teams ?? []).map((t) => t.lead).filter(Boolean));
  const partByNumber = new Map();
  for (const part of settings.parts ?? []) if (part.part_number) partByNumber.set(part.part_number, part);
  return { byEmail, bySlack, byName, leads, partByNumber };
}

export function personOf(author, sidx) {
  if (!author) return null;
  return (
    (author.email && sidx.byEmail.get(author.email.toLowerCase())) ||
    (author.slack_id && sidx.bySlack.get(author.slack_id)) ||
    (author.name && sidx.byName.get(author.name.toLowerCase())) ||
    null
  );
}

const authorKey = (a) => (a?.email || a?.slack_id || a?.name || '').toLowerCase() || null;

// Pressure baseline per team (or channel when the author is unknown), from docs before T.
// Returns (doc, T) → baseline. Prefix sums over time make each lookup O(log n).
export function makeBaseline(docs, reads, sidx) {
  const ridx = readsIndex(reads);
  const groups = new Map(); // key → {times: [], cum: []}
  for (const d of docs) {
    const r = ridx.get(d.id);
    if (!r || typeof r.pressure !== 'number') continue;
    const key = groupOf(d, sidx, r);
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { times: [], cum: [0] }));
    g.times.push(ms(d.at));
    g.cum.push(g.cum[g.cum.length - 1] + r.pressure);
  }
  // docs arrive sorted by (at, id); sort defensively anyway
  for (const g of groups.values()) {
    const order = g.times.map((t, i) => i).sort((a, b) => g.times[a] - g.times[b]);
    const vals = order.map((i) => g.cum[i + 1] - g.cum[i]);
    g.times = order.map((i) => g.times[i]);
    g.cum = [0];
    for (const v of vals) g.cum.push(g.cum[g.cum.length - 1] + v);
  }
  return (doc, T) => {
    const g = groups.get(groupOf(doc, sidx, ridx.get(doc.id)));
    if (!g) return 0;
    const t = ms(T);
    let lo = 0;
    let hi = g.times.length; // count of times < t
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (g.times[mid] < t) lo = mid + 1;
      else hi = mid;
    }
    return lo ? g.cum[lo] / lo : 0;
  };
}

// The read's own team key when it carries one (D: author's team, else channel's team), else ours.
function groupOf(doc, sidx, read) {
  if (read?.team) return `team:${read.team}`;
  const p = personOf(doc.author, sidx);
  return p?.team ? `team:${p.team}` : `container:${doc.container}`;
}

function bandOf(at, T) {
  const daysBefore = (ms(T) - ms(at)) / DAY;
  if (!(daysBefore > 0) || daysBefore > WINDOW_DAYS) return -1;
  for (let i = 0; i < BANDS.length; i++) if (daysBefore > BANDS[i].to && daysBefore <= BANDS[i].from) return i;
  return -1;
}

// Which of the order's identifiers a read's refs hit: 'id' beats 'alias'/'vague'.
function matchMode(read, keys) {
  let mode = null;
  for (const ref of read?.refs ?? []) {
    const hit = keys.has(ref.id) || (ref.token && keys.has(ref.token));
    if (!hit) continue;
    if (ref.mode === 'id') return 'id';
    mode = 'alias';
  }
  return mode;
}

function sameValue(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Requester's expedite rate over earlier labelled orders, smoothed toward the team's rate
// (itself smoothed toward everyone's earlier rate).
export function requesterRate(label, history, sidx) {
  const t = ms(label.T);
  const earlier = (history ?? []).filter((h) => ms(h.T) < t && h.order_number !== label.order_number);
  if (!earlier.length) return null;
  const isX = (h) => (h.tier === 'expedite' ? 1 : 0);
  const all = earlier.reduce((s, h) => s + isX(h), 0) / earlier.length;
  const teamOf = (email) => personOf({ email }, sidx)?.team ?? null;
  const team = teamOf(label.requester_email);
  const mates = team ? earlier.filter((h) => teamOf(h.requester_email) === team) : [];
  const teamRate = (mates.reduce((s, h) => s + isX(h), 0) + RATE_PRIOR * all) / (mates.length + RATE_PRIOR);
  const own = earlier.filter((h) => (h.requester_email ?? '').toLowerCase() === (label.requester_email ?? '').toLowerCase());
  return (own.reduce((s, h) => s + isX(h), 0) + RATE_PRIOR * teamRate) / (own.length + RATE_PRIOR);
}

// log(1 + extra $ of the fastest tier over Standard), from the quote's tiers.
export function extraUsd(label) {
  const tiers = label.tiers ?? [];
  const std = tiers.find((t) => t.tier === 'standard');
  const withLead = tiers.filter((t) => typeof t.lead_days === 'number');
  const fastest = withLead.length
    ? withLead.reduce((a, b) => (b.lead_days < a.lead_days ? b : a))
    : tiers.find((t) => t.tier === 'expedite');
  if (!std || !fastest || typeof std.total !== 'number' || typeof fastest.total !== 'number') return null;
  return Math.log(1 + Math.max(0, fastest.total - std.total));
}

function progressLookup(progress) {
  if (!progress) return () => null;
  if (typeof progress === 'function') return progress;
  const rows = [...progress].sort((a, b) => (a.week_start < b.week_start ? -1 : 1));
  return (assembly, atIso) => {
    const wk = weekStart(localDate(atIso));
    let rank = null;
    for (const r of rows) if (r.assembly === assembly && r.week_start <= wk) rank = r.rank;
    return rank;
  };
}

export function heatmap({ label, docs, reads, settings, progress, history, ctx }) {
  const sidx = ctx?.sidx ?? settingsIndex(settings);
  const ridx = ctx?.ridx ?? readsIndex(reads);
  const baseline = ctx?.baseline ?? makeBaseline(docs, ridx, sidx);
  const T = label.T;
  const tMs = ms(T);

  // Identifiers of the order: part ids, part numbers, order and quote numbers.
  const keys = new Set([label.order_number, label.quote_id].filter(Boolean));
  const assemblies = new Set();
  for (const pn of label.part_numbers ?? []) {
    keys.add(pn);
    const part = sidx.partByNumber.get(pn);
    if (part) {
      keys.add(part.id);
      if (part.assembly) assemblies.add(part.assembly);
    }
  }

  // Docs in the window (T − 30 d, T).
  const inWindow = [];
  for (const d of docs) {
    const t = ms(d.at);
    if (t >= tMs) continue;
    if (tMs - t > WINDOW_DAYS * DAY) continue;
    inWindow.push(d);
  }
  const direct = new Map(); // doc_id → 'id' | 'alias'
  const threads = new Set();
  for (const d of inWindow) {
    const mode = matchMode(ridx.get(d.id), keys);
    if (!mode) continue;
    direct.set(d.id, mode);
    threads.add(`${d.container}|${d.thread}`);
  }
  const linkedDocs = inWindow.filter((d) => direct.has(d.id) || threads.has(`${d.container}|${d.thread}`));

  // Requester's manager and team leads.
  const requester = personOf({ email: label.requester_email }, sidx);
  const managerKeys = new Set();
  if (requester?.manager) {
    const m = (settings.people ?? []).find((p) => p.id === requester.manager);
    if (m?.email) managerKeys.add(m.email.toLowerCase());
  }
  for (const p of settings.people ?? []) if (sidx.leads.has(p.id) && p.email) managerKeys.add(p.email.toLowerCase());

  // Earlier ETAs by subject, from every read before T (for slips).
  const etaHistory = new Map(); // subject → [{t, value}]
  if (linkedDocs.length) {
    for (const d of docs) {
      if (ms(d.at) >= tMs) continue;
      for (const c of ridx.get(d.id)?.claims ?? []) {
        if (c.kind !== 'eta' || !c.subject) continue;
        if (!etaHistory.has(c.subject)) etaHistory.set(c.subject, []);
        etaHistory.get(c.subject).push({ t: ms(d.at), value: c.value });
      }
    }
  }

  const n = BANDS.length;
  const zero = () => new Array(n).fill(0);
  const acc = {
    messages: zero(), pSum: zero(), pN: zero(), deadline: zero(), waiting: zero(), slips: zero(),
    people: Array.from({ length: n }, () => new Set()), manager: zero(), meetings: zero(), idHits: zero(),
  };
  for (const d of linkedDocs) {
    const b = bandOf(d.at, T);
    if (b < 0) continue;
    const r = ridx.get(d.id);
    acc.messages[b]++;
    if (typeof r?.pressure === 'number') {
      acc.pSum[b] += r.pressure - baseline(d, T);
      acc.pN[b]++;
    }
    for (const c of r?.claims ?? []) {
      if (c.kind === 'needs' || c.kind === 'need_earlier') acc.deadline[b]++;
      else if (c.kind === 'blocked') acc.waiting[b]++;
      else if (c.kind === 'eta' && c.subject) {
        const t = ms(d.at);
        const prior = (etaHistory.get(c.subject) ?? []).filter((e) => e.t < t);
        if (prior.some((e) => !sameValue(e.value, c.value))) acc.slips[b]++;
      }
    }
    const ak = authorKey(d.author);
    if (ak) acc.people[b].add(ak);
    if (d.author?.email && managerKeys.has(d.author.email.toLowerCase())) acc.manager[b]++;
    else {
      const p = personOf(d.author, sidx);
      if (p?.email && managerKeys.has(p.email.toLowerCase())) acc.manager[b]++;
    }
    if (d.source === 'meeting') acc.meetings[b]++;
    if (direct.get(d.id) === 'id') acc.idHits[b]++;
  }

  const noContext = linkedDocs.length === 0;
  const perDay = (arr) => arr.map((v, i) => round(v / BAND_DAYS[i]));
  let cells;
  if (noContext) {
    cells = Object.fromEntries(ROWS.map((r) => [r, new Array(n).fill(null)]));
  } else {
    const rankAt = progressLookup(progress);
    const progressRow = BANDS.map((band) => {
      // rank as known at the band's end (strictly before T)
      const at = toPacificIso(tMs - Math.max(band.to * DAY, 1000));
      const ranks = [...assemblies].map((a) => rankAt(a, at)).filter((v) => typeof v === 'number');
      return ranks.length ? Math.min(...ranks) : null;
    });
    cells = {
      messages: perDay(acc.messages),
      pressure: acc.pSum.map((s, i) => (acc.pN[i] ? round(s / acc.pN[i]) : 0)),
      deadline_talk: perDay(acc.deadline),
      waiting_talk: perDay(acc.waiting),
      slips: perDay(acc.slips),
      people: perDay(acc.people.map((s) => s.size)),
      manager: perDay(acc.manager),
      meetings: perDay(acc.meetings),
      progress_rank: progressRow,
      id_share: acc.messages.map((m, i) => (m ? round(acc.idHits[i] / m) : null)),
    };
  }

  const rate = requesterRate(label, history, sidx);
  const usd = extraUsd(label);
  return {
    order_number: label.order_number,
    T,
    cells,
    flags: { no_context: noContext },
    extra: {
      requester_expedite_rate: rate === null ? null : round(rate),
      extra_usd_expedite: usd === null ? null : round(usd),
    },
    linked: linkedDocs.map((d) => d.id).sort(),
  };
}

function round(x) {
  return Math.round(x * 1e4) / 1e4;
}
