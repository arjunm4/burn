// Company dependency graph (code-only build) and the demo's inputs.
//
//   extractAllClaims({settings, sources}) -> claims (every doc, sorted by at, doc_id)
//   buildGraph({settings, sources, claims?}) -> graph   (code claims always extracted; passed claims added if new)
//   graphAt(graph, T) -> view                           only evidence and facts with at <= T; statuses as known at T
//   demoInputs(view, partId) -> {test, milestone, inputs, planned_start, planned_start_doc, duration: {value,min,max,..}, rig, policy, gaps}
//   appendDocs(sources, newDocs) -> sources             for live changes (re-run extract + build after)
//   liveChangeDoc(change, prevAt) -> doc                a demo/live-changes.json entry as a Slack doc
//
// graph = { nodes: [{id, kind, name}],
//           edges: [{from, to, kind: requires_all|gates|ordered_as, status, evidence: [{doc_id, at, by, via}]}],
//           facts: [{subject, kind: eta|planned_start|duration|done|target, value, at, by, doc_id, via, status}],
//           policies: [{milestone, type, usd_per_day, curve, set_by, set_at, doc_id}], bookings: [...], meta }
// Evidence with at == null is configured company knowledge (settings) and is visible at every T.
// A link nobody stated is not in the graph (unknown, never inferred).

import { makeResolver, parseBooking } from './refs.mjs';
import { extractClaims, authorId, localDay } from './claims.mjs';

const ms = (iso) => (iso == null ? -Infinity : Date.parse(iso.length === 10 ? iso + 'T00:00:00-08:00' : iso));
const byAt = (a, b) => ms(a.at) - ms(b.at) || String(a.doc_id).localeCompare(String(b.doc_id));

export function makeGraphResolver(settings, sources) {
  return makeResolver(settings, { xometry: sources.xometry, calendar: sources.calendar });
}

export function extractAllClaims({ settings, sources }, resolve = makeGraphResolver(settings, sources)) {
  const out = [];
  const recent = new Map(); // container -> [{id, at}] named in the last 3 days
  for (const d of sources.docs || []) {
    const t = ms(d.at);
    const r = (recent.get(d.container) || []).filter((x) => t - x.t <= 3 * 864e5);
    for (const c of extractClaims(d, resolve, { people: settings.people, recent: r.map((x) => x.id) })) out.push({ ...c, container: d.container, thread: d.thread, source: d.source });
    for (const x of resolve(d.text || '', { container: d.container, at: d.at })) if (!x.ambiguous && x.mode !== 'vague') r.push({ id: x.id, t });
    recent.set(d.container, r.slice(-20));
  }
  return out.sort(byAt);
}

export function buildGraph({ settings, sources, claims }) {
  const resolve = makeGraphResolver(settings, sources);
  // Code claims are always extracted from the sources (they need thread context); claims passed in (e.g. LLM reads)
  // are added when they say something the code did not (same doc, kind and subject = duplicate).
  const code = extractAllClaims({ settings, sources }, resolve);
  const key = (c) => `${c.doc_id}|${c.kind}|${c.subject}`;
  const have = new Set(code.map(key));
  const docById = new Map((sources.docs || []).map((d) => [d.id, d]));
  const extra = (claims || []).filter((c) => c && c.subject && !have.has(key(c))).map((c) => {
    const d = docById.get(c.doc_id);
    const by = (settings.people || []).some((p) => p.id === c.by) ? c.by : d ? authorId(d.author, settings.people) : c.by;
    return { ...c, by, container: c.container ?? d?.container, thread: c.thread ?? d?.thread, source: c.source ?? d?.source };
  });
  claims = [...code, ...extra].sort(byAt);
  const nodes = new Map();
  const node = (id, kind, name) => { if (!nodes.has(id)) nodes.set(id, { id, kind, name: name ?? id }); return id; };
  for (const a of settings.assemblies || []) node(a.id, 'assembly', a.name);
  for (const p of settings.parts || []) node(p.id, 'part', p.name);
  for (const d of settings.deliverables || []) node(d.id, 'deliverable', d.name);
  for (const t of settings.tests || []) node(t.id, 'test', t.name);
  for (const m of settings.milestones || []) node(m.id, 'milestone', m.name);
  for (const r of settings.rigs || []) node(r.id, 'rig', r.name);
  const kindOf = (id) => nodes.get(id)?.kind || (String(id).startsWith('wk:') ? 'work' : null);

  const edges = new Map();
  const addEdge = (from, to, kind, ev, status = null) => {
    if (!from || !to || from === to) return;
    const k = `${from}>${to}`;
    const e = edges.get(k) || { from, to, kind, evidence: [], claimed_status: null };
    if (!e.evidence.some((x) => x.doc_id === ev.doc_id)) e.evidence.push(ev);
    if (status) e.claimed_status = status;
    edges.set(k, e);
  };
  const facts = [];

  // --- Structured links (configured knowledge) ---
  for (const t of settings.tests || []) {
    if (t.milestone) addEdge(t.id, t.milestone, 'gates', { doc_id: 'settings:tests', at: null, by: null, via: 'structured' });
    for (const r of [t.rig, ...(t.resources || [])].filter(Boolean)) addEdge(r, t.id, 'requires_all', { doc_id: 'settings:tests', at: null, by: null, via: 'structured' });
    if (t.duration_estimate_days) facts.push({ subject: t.id, kind: 'duration', value: { min: t.duration_estimate_days[0], max: t.duration_estimate_days[1] }, at: null, by: t.owner, doc_id: 'settings:tests', via: 'structured' });
    for (const p of t.planned_date || []) facts.push({ subject: t.id, kind: 'planned_start', value: p.value, at: p.known_at, by: p.by, doc_id: 'settings:tests', via: 'structured' });
  }
  for (const m of settings.milestones || []) for (const d of m.date || []) facts.push({ subject: m.id, kind: 'target', value: d.value, at: d.known_at, by: d.by, doc_id: 'settings:milestones', via: 'structured' });
  // Xometry orders -> parts, and their promised dates as ETAs
  const pnToPart = new Map((settings.parts || []).map((p) => [p.part_number, p.id]));
  for (const o of sources.xometry?.orders || []) {
    const oid = node(`order:${o.order_number}`, 'order', o.order_number);
    for (const li of o.line_items || []) {
      const pid = pnToPart.get(li.part_number); if (!pid) continue;
      addEdge(pid, oid, 'ordered_as', { doc_id: `xometry:${o.order_number}`, at: o.placed_at, by: null, via: 'structured' });
      if (o.promised_delivery_date && o.status !== 'Delivered') facts.push({ subject: pid, kind: 'eta', value: o.promised_delivery_date, at: o.placed_at, by: 'xometry', doc_id: `xometry:${o.order_number}`, via: 'structured', order: o.order_number });
      if (o.delivered_at) facts.push({ subject: pid, kind: 'done', value: localDay(o.delivered_at), at: o.delivered_at, by: 'xometry', doc_id: `xometry:${o.order_number}`, via: 'structured', order: o.order_number });
    }
  }
  // Jira issue links, when the loader carries them on docs as doc.links = [{type, key}]
  for (const d of sources.docs || []) for (const l of d.links || []) addEdge(`jira:${l.key}`, `jira:${d.container}`, 'requires_all', { doc_id: d.id, at: d.at, by: authorId(d.author, settings.people), via: 'structured' });
  // Calendar bookings -> rig and planned start; milestone events -> target
  const items = resolve.items;
  const findByName = (name, kind) => [...items.values()].find((x) => x.kind === kind && x.name && x.name.toLowerCase() === String(name).toLowerCase());
  const bookings = [];
  for (const ev of sources.calendar || []) {
    const cats = (ev.categories || []).map((c) => String(c).toUpperCase());
    const docId = `cal:${ev.uid}`;
    const calDoc = (sources.docs || []).find((d) => d.id === docId);
    const at = calDoc?.at ?? null;
    const by = calDoc ? authorId(calDoc.author, settings.people) : null;
    const b = parseBooking(ev.summary);
    if (b && (cats.includes('BOOKING') || cats.length === 0 || cats[0] === '')) {
      const rig = findByName(b.rig, 'rig'), test = findByName(b.test, 'test');
      if (rig && test && b.status !== 'cancelled') {
        addEdge(rig.id, test.id, 'requires_all', { doc_id: docId, at, by, via: 'structured' });
        bookings.push({ rig: rig.id, test: test.id, start: ev.start, end: ev.end, status: b.status, doc_id: docId, at, by });
        facts.push({ subject: test.id, kind: 'planned_start', value: String(ev.start).slice(0, 10), at, by, doc_id: docId, via: 'structured' });
        continue;
      }
    }
    if (cats.includes('MILESTONE')) {
      const m = findByName(ev.summary, 'milestone');
      if (m) facts.push({ subject: m.id, kind: 'target', value: String(ev.start).slice(0, 10), at, by, doc_id: docId, via: 'structured' });
    }
  }

  // --- Claims ---
  // Threads that name exactly one test or work item: a bare "need" in them is for that use.
  const threadUse = new Map();
  for (const c of claims) {
    const uses = [c.for_use, c.kind === 'blocked' ? c.subject : null].filter((x) => x && ['test', 'work'].includes(kindOf(x)));
    for (const u of uses) { const s = threadUse.get(c.thread) || new Set(); s.add(u); threadUse.set(c.thread, s); }
  }
  for (const c of claims) {
    const ev = { doc_id: c.doc_id, at: c.at, by: c.by, via: c.via || 'claim', mode: c.mode };
    for (const id of [c.subject, typeof c.value === 'string' && kindOf(c.value) ? c.value : null, c.for_use]) if (id && String(id).startsWith('wk:')) node(id, 'work', id.slice(3).replace(/-/g, ' '));
    if (c.kind === 'blocked') addEdge(c.value, c.subject, kindOf(c.subject) === 'milestone' ? 'gates' : 'requires_all', ev);
    else if (c.kind === 'needs' || c.kind === 'need_earlier') {
      let use = c.for_use;
      if (!use) { const s = threadUse.get(c.thread); if (s && s.size === 1) { use = [...s][0]; ev.mode = 'thread'; } }
      if (use) addEdge(c.subject, use, 'requires_all', ev);
      if (c.value) facts.push({ subject: c.subject, kind: 'need_by', value: c.value, at: c.at, by: c.by, doc_id: c.doc_id, via: 'claim', for_use: use || null });
    } else if (c.kind === 'eta') {
      const k = kindOf(c.subject);
      facts.push({ subject: c.subject, kind: k === 'test' || k === 'work' ? 'planned_start' : k === 'milestone' ? 'target' : 'eta', value: c.value, at: c.at, by: c.by, doc_id: c.doc_id, via: 'claim' });
    } else if (c.kind === 'duration') facts.push({ subject: c.subject, kind: 'duration', value: c.value, at: c.at, by: c.by, doc_id: c.doc_id, via: 'claim' });
    else if (c.kind === 'done') facts.push({ subject: c.subject, kind: 'done', value: c.value, at: c.at, by: c.by, doc_id: c.doc_id, via: 'claim' });
  }

  // Value policies: the owner's demo/policy.json (source) first, settings value_policy as well.
  const policies = [];
  for (const p of sources.demo?.policy?.policies || []) {
    const m = findByName(p.milestone, 'milestone');
    policies.push({ milestone: m?.id ?? null, milestone_name: p.milestone, type: p.type, usd_per_day: p.usd_per_day ?? null, curve: p.curve ?? null,
      set_by: authorId(p.set_by, settings.people), set_at: p.set_at, doc_id: `policy:${p.milestone}` });
  }
  for (const m of settings.milestones || []) for (const v of m.value_policy || []) {
    const val = v.value || {};
    policies.push({ milestone: m.id, milestone_name: m.name, type: val.type, usd_per_day: val.usd_per_day ?? null, curve: val.curve ?? null, set_by: v.by, set_at: v.known_at, doc_id: 'settings:milestones' });
  }

  const graph = {
    nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...edges.values()].map((e) => ({ ...e, evidence: e.evidence.sort(byAt) })).sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to)),
    facts: facts.sort((a, b) => byAt(a, b) || a.subject.localeCompare(b.subject)),
    policies: policies.sort((a, b) => ms(a.set_at) - ms(b.set_at)),
    bookings: bookings.sort((a, b) => ms(a.start) - ms(b.start)),
    meta: { settings: { assemblies: settings.assemblies, people: settings.people, teams: settings.teams, deliverables: settings.deliverables, parts: settings.parts, tests: settings.tests, rigs: settings.rigs, milestones: settings.milestones, holidays: settings.holidays } },
    T: null,
  };
  return withStatuses(graph);
}

// Authority: the item's owner, its assembly's team, or supply chain may set an ETA; others only propose.
function authorityOf(settings, subject, by) {
  if (!by || by === 'xometry') return by === 'xometry';
  const p = (settings.people || []).find((x) => x.id === by); if (!p) return false;
  const item = [...(settings.deliverables || []), ...(settings.parts || []), ...(settings.tests || []), ...(settings.milestones || [])].find((x) => x.id === subject);
  if (item && item.owner === by) return true;
  const team = (settings.teams || []).find((t) => t.id === p.team);
  if (team && /supply|procure|purchas/i.test(team.name)) return true;
  if (/supply|buyer|procure|purchas/i.test(p.title || '')) return true;
  const asm = item && (settings.assemblies || []).find((a) => a.id === item.assembly);
  if (asm && asm.team === p.team) return true;
  const owner = item && (settings.people || []).find((x) => x.id === item.owner);
  if (owner && owner.team === p.team) return true;
  return !item && true; // work items have no configured owner: any known person may state them
}

function withStatuses(g) {
  const s = g.meta.settings;
  // Facts: per (subject, kind) the latest authoritative one is accepted; older ones superseded;
  // differing values at the same time -> disputed; later non-authoritative -> proposed.
  const groups = new Map();
  for (const f of g.facts) { const k = `${f.subject}|${f.kind}`; groups.set(k, [...(groups.get(k) || []), f]); }
  const facts = [];
  for (const list of groups.values()) {
    const sorted = list.slice().sort(byAt);
    const auth = sorted.filter((f) => f.via === 'structured' || authorityOf(s, f.subject, f.by));
    const last = auth[auth.length - 1];
    const sameTime = last ? auth.filter((f) => f !== last && ms(f.at) === ms(last.at) && JSON.stringify(f.value) !== JSON.stringify(last.value)) : [];
    for (const f of sorted) {
      let status;
      if (f.kind === 'need_by' || f.kind === 'done') status = 'accepted';
      else if (!last) status = 'proposed';
      else if (f === last || sameTime.includes(f)) status = sameTime.length ? 'disputed' : 'accepted';
      else if (ms(f.at) > ms(last.at)) status = 'proposed';
      else status = 'superseded';
      facts.push({ ...f, status });
    }
  }
  const edges = g.edges.map((e) => {
    const hasStructured = e.evidence.some((x) => x.via === 'structured');
    const strong = e.evidence.some((x) => x.mode === 'id' || x.mode === 'alias');
    return { ...e, status: e.claimed_status === 'disputed' ? 'disputed' : hasStructured || strong ? 'accepted' : 'proposed' };
  });
  return { ...g, edges, facts: facts.sort((a, b) => byAt(a, b) || a.subject.localeCompare(b.subject)) };
}

export function graphAt(graph, T) {
  const t = ms(T);
  const seen = (x) => x.at == null || ms(x.at) <= t;
  const edges = graph.edges.map((e) => ({ ...e, evidence: e.evidence.filter(seen) })).filter((e) => e.evidence.length);
  const facts = graph.facts.filter(seen);
  const policies = graph.policies.filter((p) => p.set_at == null || ms(p.set_at) <= t);
  const bookings = graph.bookings.filter(seen);
  const used = new Set(edges.flatMap((e) => [e.from, e.to]));
  const nodes = graph.nodes.filter((n) => !['work', 'order'].includes(n.kind) || used.has(n.id));
  return withStatuses({ ...graph, nodes, edges, facts, policies, bookings, T });
}

const accepted = (view, subject, kind) => {
  const l = view.facts.filter((f) => f.subject === subject && f.kind === kind && (f.status === 'accepted' || f.status === 'disputed'));
  return l.length ? l[l.length - 1] : null;
};

export function demoInputs(view, partId) {
  const kindOf = (id) => view.nodes.find((n) => n.id === id)?.kind;
  const gaps = [];
  // Tests this part feeds (directly, or through a work item that feeds a test).
  let tests = view.edges.filter((e) => e.from === partId && kindOf(e.to) === 'test');
  if (!tests.length) tests = view.edges.filter((e) => e.from === partId && kindOf(e.to) === 'work').flatMap((w) => view.edges.filter((e) => e.from === w.to && kindOf(e.to) === 'test'));
  if (!tests.length) return { test: null, milestone: null, inputs: [], planned_start: null, duration: null, rig: null, policy: null, gaps: [{ kind: 'structural', text: `no known test for ${partId}` }] };
  // Prefer accepted links, then the test with the latest evidence.
  tests.sort((a, b) => (a.status === 'accepted' ? 0 : 1) - (b.status === 'accepted' ? 0 : 1) || ms(b.evidence.at(-1).at) - ms(a.evidence.at(-1).at));
  const testId = tests[0].to;
  const testCfg = view.meta.settings.tests.find((t) => t.id === testId) || { id: testId };
  const gate = view.edges.find((e) => e.from === testId && kindOf(e.to) === 'milestone');
  const milestone = gate ? gate.to : null;
  const ev0 = (e) => e.evidence[e.evidence.length - 1];

  const inputs = [];
  let rig = null;
  for (const e of view.edges.filter((x) => x.to === testId && x.kind !== 'gates')) {
    const k = kindOf(e.from);
    if (k === 'rig') {
      const r = view.meta.settings.rigs.find((x) => x.id === e.from) || {};
      rig = { id: e.from, name: r.name ?? null, slot_days: r.slot_days ?? null, owner: r.owner ?? null,
        bookings: view.bookings.filter((b) => b.rig === e.from).map(({ test, start, end, status, doc_id }) => ({ test, start, end, status, doc_id })), doc_id: ev0(e).doc_id };
      continue;
    }
    if (e.from === partId) { inputs.push({ id: e.from, kind: k, ready: null, from: 'quote', said_by: null, said_at: null, doc_id: ev0(e).doc_id, link_status: e.status }); continue; }
    const f = accepted(view, e.from, k === 'test' || k === 'work' ? 'done' : 'eta');
    const done = view.facts.filter((x) => x.subject === e.from && x.kind === 'done').at(-1);
    if (!f && !done) gaps.push({ kind: 'structural', subject: e.from, text: `no ETA for ${e.from}` });
    const src = f || done;
    inputs.push({ id: e.from, kind: k, ready: src ? src.value : null, said_by: src?.by ?? null, said_at: src?.at ?? null, doc_id: src?.doc_id ?? null,
      status: src?.status ?? null, link_status: e.status, link_doc_id: ev0(e).doc_id });
  }
  inputs.sort((a, b) => (a.id === partId ? -1 : b.id === partId ? 1 : a.id.localeCompare(b.id)));

  const ps = accepted(view, testId, 'planned_start');
  const du = accepted(view, testId, 'duration');
  const durVal = du ? (typeof du.value === 'number' ? { min: du.value, max: du.value } : du.value) : null;
  const tgt = milestone ? accepted(view, milestone, 'target') : null;
  const pols = view.policies.filter((p) => p.milestone === milestone);
  const pol = pols.length ? pols[pols.length - 1] : null;
  if (!pol) gaps.push({ kind: 'structural', subject: milestone, text: 'no value policy for the milestone' });
  return {
    test: { id: testId, name: view.nodes.find((n) => n.id === testId)?.name ?? testId, owner: testCfg.owner ?? null, link_status: tests[0].status, doc_id: ev0(tests[0]).doc_id },
    milestone: milestone ? { id: milestone, name: view.nodes.find((n) => n.id === milestone)?.name ?? milestone, target: tgt ? tgt.value : null, target_doc_id: tgt?.doc_id ?? null, target_by: tgt?.by ?? null } : null,
    inputs,
    planned_start: ps ? { value: ps.value, by: ps.by, at: ps.at, doc_id: ps.doc_id } : null,
    planned_start_doc: ps?.doc_id ?? null,
    // value = the longer end of the estimate (a range is never averaged)
    duration: durVal ? { value: durVal.max, min: durVal.min, max: durVal.max, by: du.by, at: du.at, doc_id: du.doc_id } : null,
    rig,
    policy: pol ? { type: pol.type, usd_per_day: pol.usd_per_day, curve: pol.curve, set_by: pol.set_by, set_at: pol.set_at, by: pol.set_by, at: pol.set_at, doc_id: pol.doc_id } : null,
    gaps,
  };
}

/** A demo/live-changes.json entry as a Slack doc, `offset_minutes` after `prevAt`. */
export function liveChangeDoc(change, prevAt, people = []) {
  const m = change.message;
  const at = new Date(Date.parse(prevAt) + (change.offset_minutes || 0) * 60e3);
  const p = people.find((x) => x.slack_id === m.user);
  const off = prevAt.slice(-6);
  const local = new Date(at.getTime() + (off[0] === '-' ? -1 : 1) * (+off.slice(1, 3) * 60 + +off.slice(4, 6)) * 60e3).toISOString().slice(0, 19) + off;
  const ts = `${Math.floor(at.getTime() / 1000)}.${String(change.order).padStart(6, '0')}`;
  return { id: `slack:${m.channel}:${ts}`, source: 'slack', container: m.channel, thread: ts,
    author: { name: p?.name ?? m.user_name ?? null, email: p?.email ?? null, slack_id: m.user }, at: local, text: m.text };
}

export function appendDocs(sources, newDocs) {
  const docs = [...(sources.docs || []), ...newDocs].sort((a, b) => ms(a.at) - ms(b.at) || a.id.localeCompare(b.id));
  return { ...sources, docs };
}
