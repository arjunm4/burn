// Dependency-graph scheduler. Pure and isomorphic: the server uses it for the agent's
// facts, the /graph page re-runs it live as shipping options change.
//
// Edge semantics: A -blocks-> B means B cannot start until A is done; A -due-> M means
// milestone M cannot happen before A is done; person -assigned-> work. Dates are ISO days.
import {COST} from '../decisions.js';

const DAY = 86400000;
export const toDay = iso => Math.round(Date.parse(iso.slice(0, 10) + 'T00:00:00Z') / DAY);
export const toIso = day => new Date(day * DAY).toISOString().slice(0, 10);
const flowKinds = new Set(['blocks', 'due']);

function index(graph) {
  const nodes = new Map(graph.nodes.map(n => [n.id, n]));
  const preds = new Map(graph.nodes.map(n => [n.id, []]));
  const succs = new Map(graph.nodes.map(n => [n.id, []]));
  const people = new Map(graph.nodes.map(n => [n.id, []]));
  for (const e of graph.edges) {
    if (!nodes.has(e.from) || !nodes.has(e.to)) continue;
    if (flowKinds.has(e.kind)) { preds.get(e.to).push(e); succs.get(e.from).push(e); }
    if (e.kind === 'assigned') people.get(e.to).push(nodes.get(e.from));
  }
  return {nodes, preds, succs, people};
}

// Kahn's algorithm; edges that would close a cycle are reported and ignored.
function order(graph, {nodes, preds, succs}) {
  const indegree = new Map([...nodes.keys()].map(id => [id, preds.get(id).length]));
  const queue = [...nodes.keys()].filter(id => !indegree.get(id));
  const sorted = [];
  while (queue.length) {
    const id = queue.shift(); sorted.push(id);
    for (const e of succs.get(id)) { indegree.set(e.to, indegree.get(e.to) - 1); if (!indegree.get(e.to)) queue.push(e.to); }
  }
  const cyclic = [...nodes.keys()].filter(id => !sorted.includes(id));
  return {sorted: [...sorted, ...cyclic], cyclic};
}

// Pushes a start day past any out-of-office window of the assigned people.
function available(start, assignees) {
  let day = start, by = null, moved = true;
  while (moved) {
    moved = false;
    for (const p of assignees) for (const w of p.attrs?.ooo || []) {
      const s = toDay(w.start), e = toDay(w.end);
      if (day >= s && day < e) { day = e; by = p.id; moved = true; }
    }
  }
  return {day, by};
}

/**
 * analyzeGraph(graph, {orderDate, arrivals}) -> schedule
 * arrivals: {partNodeId: ISO date} for parts whose delivery depends on a shipping choice.
 */
export function analyzeGraph(graph, {orderDate, arrivals = {}} = {}) {
  const ix = index(graph);
  const {sorted, cyclic} = order(graph, ix);
  const origin = toDay(orderDate || new Date().toISOString());
  const at = {};
  const conflicts = [];
  for (const id of sorted) {
    const n = ix.nodes.get(id);
    const incoming = ix.preds.get(id).filter(e => at[e.from]);
    let latest = null;
    for (const e of incoming) if (!latest || at[e.from].finish > at[latest.from].finish) latest = e;
    const ready = latest ? at[latest.from].finish : origin;
    if (n.kind === 'part') {
      const date = arrivals[id] || n.attrs?.date;
      const day = date ? toDay(date) : origin;
      at[id] = {start: day, finish: day, end: n.attrs?.end ? toDay(n.attrs.end) : null, drivenBy: null};
    } else if (n.kind === 'milestone') {
      const planned = n.attrs?.date ? toDay(n.attrs.date) : ready;
      const actual = Math.max(planned, ready);
      at[id] = {start: actual, finish: actual, planned, slip: actual - planned, drivenBy: actual > planned ? latest?.from : null};
    } else if (n.kind === 'work') {
      const assignees = ix.people.get(id);
      const {day, by} = available(Math.max(origin, ready), assignees);
      const duration = Math.max(1, n.attrs?.durationDays || 1);
      at[id] = {start: day, finish: day + duration, drivenBy: by && day > ready ? by : latest?.from || null, people: assignees.map(p => p.id)};
      // A time-boxed booking (e.g. a test chamber) is useless if the work starts after it ends.
      for (const e of incoming) {
        const b = at[e.from];
        if (b.end != null && day >= b.end) conflicts.push({kind: 'booking_missed', node: e.from, work: id, bookingEnd: toIso(b.end), workStart: toIso(day)});
      }
    }
  }
  const iso = Object.fromEntries(Object.entries(at).map(([id, s]) => [id, {
    ...s, start: toIso(s.start), finish: toIso(s.finish), ...(s.planned != null ? {planned: toIso(s.planned)} : {}), ...(s.end != null ? {end: toIso(s.end)} : {}),
  }]));
  return {at: iso, days: at, critical: criticalPath(graph, ix, at), conflicts, cyclic};
}

// Walks back from each slipped milestone (or the latest milestone if none slip) through
// whatever determined each start, so the highlighted chain is the one to shorten.
function criticalPath(graph, ix, at) {
  const milestones = graph.nodes.filter(n => n.kind === 'milestone' && at[n.id]);
  const slipped = milestones.filter(m => at[m.id].slip > 0);
  // Nothing slips: follow the milestone with the least slack, the one that would slip first.
  const ready = m => Math.max(-Infinity, ...ix.preds.get(m.id).filter(e => at[e.from]).map(e => at[e.from].finish));
  const targets = slipped.length ? slipped : milestones.filter(m => ready(m) > -Infinity).sort((a, b) => (at[a.id].planned - ready(a)) - (at[b.id].planned - ready(b))).slice(0, 1);
  const nodes = new Set(), edges = new Set();
  for (const m of targets) {
    let id = m.id;
    if (!slipped.length) {
      // Nothing slips: show the chain with the least slack into the latest milestone.
      const pred = ix.preds.get(id).filter(e => at[e.from]).sort((a, b) => at[b.from].finish - at[a.from].finish)[0];
      nodes.add(id); if (!pred) continue; edges.add(pred.id); id = pred.from;
    }
    while (id && !nodes.has(id)) {
      nodes.add(id);
      const prev = at[id].drivenBy;
      if (!prev) break;
      const edge = ix.preds.get(id).find(e => e.from === prev) || graph.edges.find(e => e.kind === 'assigned' && e.from === prev && e.to === id);
      if (edge) edges.add(edge.id);
      id = prev;
    }
  }
  return {nodes: [...nodes], edges: [...edges]};
}

/**
 * Idle engineer-days a scenario causes relative to a baseline, priced at COST per day.
 * Work that starts later than it could have leaves its assigned people waiting.
 */
export function idleCost(graph, baseline, scenario) {
  const work = graph.nodes.filter(n => n.kind === 'work');
  const items = work.map(n => {
    const delay = Math.max(0, (scenario.days[n.id]?.start ?? 0) - (baseline.days[n.id]?.start ?? 0));
    const people = scenario.days[n.id]?.people?.length || 0;
    return {work: n.id, delay, people, engineerDays: delay * people};
  }).filter(i => i.engineerDays > 0);
  const engineerDays = items.reduce((a, i) => a + i.engineerDays, 0);
  return {items, engineerDays, cost: engineerDays * COST};
}

// Nodes downstream of a node along blocks/due edges (what waits on it).
export function downstream(graph, id) {
  const ix = index(graph); const seen = new Set(); const stack = [id];
  while (stack.length) for (const e of ix.succs.get(stack.pop()) || []) if (!seen.has(e.to)) { seen.add(e.to); stack.push(e.to); }
  return [...seen];
}

// People who would sit idle because they are assigned to work downstream of a node.
export function blockedPeople(graph, id) {
  const down = new Set(downstream(graph, id));
  return [...new Set(graph.edges.filter(e => e.kind === 'assigned' && down.has(e.to)).map(e => e.from))];
}
