// Dependency-graph scheduler. Pure and isomorphic: the server uses it for the agent's
// facts, the /graph page re-runs it live as shipping options change.
//
// Edge semantics: A -blocks-> B means B cannot start until A is done; A -due-> M means
// milestone M cannot happen before A is done; person -assigned-> work. Dates are ISO days.
//
// Unknowns stay unknown: work without a stated duration has an unknown finish, and anything
// that waits on an unknown finish is unknown too. Nodes on or after a dependency cycle are
// blocked, not scheduled. The engine never prices time; valuation lives elsewhere.

import {makeCalendar, toDay, toIso} from './calendar.js';
export {toDay, toIso};
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

// Kahn's algorithm. Nodes left over sit on a cycle (or wait on one) and can't be scheduled.
function order(graph, {nodes, preds, succs}) {
  const indegree = new Map([...nodes.keys()].map(id => [id, preds.get(id).length]));
  const queue = [...nodes.keys()].filter(id => !indegree.get(id));
  const sorted = [];
  while (queue.length) {
    const id = queue.shift(); sorted.push(id);
    for (const e of succs.get(id)) { indegree.set(e.to, indegree.get(e.to) - 1); if (!indegree.get(e.to)) queue.push(e.to); }
  }
  const done = new Set(sorted);
  return {sorted, cyclic: [...nodes.keys()].filter(id => !done.has(id))};
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
 * analyzeGraph(graph, {orderDate, arrivals, calendar}) -> schedule
 * arrivals: {partNodeId: ISO date} for parts whose delivery depends on a shipping choice.
 * calendar: {holidays} switches work to working days: an input ready on day R is usable from
 * the next working day, and work of D days finishes on the D-th working day after R.
 */
export function analyzeGraph(graph, {orderDate, arrivals = {}, calendar = null} = {}) {
  const ix = index(graph);
  const cal = calendar ? makeCalendar(calendar) : null;
  const {sorted, cyclic} = order(graph, ix);
  const origin = toDay(orderDate || new Date().toISOString());
  const at = {};
  const conflicts = [];
  const unknown = [];
  for (const id of sorted) {
    const n = ix.nodes.get(id);
    const incoming = ix.preds.get(id).filter(e => at[e.from]);
    // Waiting on an unknown finish makes this node's timing unknown as well.
    const unknownInput = incoming.find(e => at[e.from].finish == null);
    if (unknownInput && n.kind !== 'part') {
      at[id] = {start: null, finish: null, unknown: true, drivenBy: unknownInput.from, ...(n.kind === 'milestone' && n.attrs?.date ? {planned: toDay(n.attrs.date), slip: null} : {})};
      unknown.push(id); continue;
    }
    let latest = null;
    for (const e of incoming) if (!latest || at[e.from].finish > at[latest.from].finish) latest = e;
    const ready = latest ? at[latest.from].finish : origin;
    if (n.kind === 'part') {
      const date = arrivals[id] || n.attrs?.date;
      const day = date ? toDay(date) : origin;
      // A booking (a window with an end) is where the work happens, so under a working-day calendar the
      // work may start on its first day; a delivered input is usable from the working day after it lands.
      const booking = n.attrs?.end != null;
      at[id] = {start: day, finish: booking && cal ? day - 1 : day, end: booking ? toDay(n.attrs.end) : null, drivenBy: null};
    } else if (n.kind === 'milestone') {
      const planned = n.attrs?.date ? toDay(n.attrs.date) : ready;
      const actual = Math.max(planned, ready);
      at[id] = {start: actual, finish: actual, planned, slip: actual - planned, drivenBy: actual > planned ? latest?.from : null};
    } else if (n.kind === 'work') {
      const assignees = ix.people.get(id);
      const duration = Number.isFinite(n.attrs?.durationDays) && n.attrs.durationDays > 0 ? n.attrs.durationDays : null;
      // Working days: start the next working day after the last input is ready; calendar days: start that day.
      const {day, by} = available(cal ? cal.addWorkingDays(Math.max(origin, ready), 1) : Math.max(origin, ready), assignees);
      const finish = duration == null ? null : cal ? cal.addWorkingDays(day, duration - 1) : day + duration;
      at[id] = {start: day, finish, ...(duration == null ? {unknown: true} : {}), drivenBy: by && day > ready ? by : latest?.from || null, people: assignees.map(p => p.id)};
      if (duration == null) unknown.push(id);
      // A time-boxed booking (e.g. a test chamber) is useless if the work starts after it ends.
      for (const e of incoming) {
        const b = at[e.from];
        if (b.end != null && day >= b.end) conflicts.push({kind: 'booking_missed', node: e.from, work: id, bookingEnd: toIso(b.end), workStart: toIso(day)});
      }
    }
  }
  const day = d => (d == null ? null : toIso(d));
  const iso = Object.fromEntries(Object.entries(at).map(([id, s]) => [id, {
    ...s, start: day(s.start), finish: day(s.finish), ...(s.planned != null ? {planned: day(s.planned)} : {}), ...(s.end != null ? {end: day(s.end)} : {}),
  }]));
  // A cycle blocks every node on it or downstream of it: the result is qualified, never guessed.
  return {at: iso, days: at, critical: criticalPath(graph, ix, at), conflicts, cyclic, unknown, blocked: cyclic};
}

// Walks back from each slipped milestone (or the latest milestone if none slip) through
// whatever determined each start, so the highlighted chain is the one to shorten.
function criticalPath(graph, ix, at) {
  const milestones = graph.nodes.filter(n => n.kind === 'milestone' && at[n.id] && at[n.id].finish != null);
  const slipped = milestones.filter(m => at[m.id].slip > 0);
  // Nothing slips: follow the milestone with the least slack, the one that would slip first.
  const ready = m => Math.max(-Infinity, ...ix.preds.get(m.id).filter(e => at[e.from]?.finish != null).map(e => at[e.from].finish));
  const targets = slipped.length ? slipped : milestones.filter(m => ready(m) > -Infinity).sort((a, b) => (at[a.id].planned - ready(a)) - (at[b.id].planned - ready(b))).slice(0, 1);
  const nodes = new Set(), edges = new Set();
  for (const m of targets) {
    let id = m.id;
    if (!slipped.length) {
      // Nothing slips: show the chain with the least slack into the latest milestone.
      const pred = ix.preds.get(id).filter(e => at[e.from]?.finish != null).sort((a, b) => at[b.from].finish - at[a.from].finish)[0];
      nodes.add(id); if (!pred) continue; edges.add(pred.id); id = pred.from;
    }
    while (id && !nodes.has(id)) {
      nodes.add(id);
      const prev = at[id].drivenBy;
      if (!prev) break;
      const edge = ix.preds.get(id).find(e => e.from === prev) || graph.edges.find(e => e.kind === 'assigned' && e.from === prev && e.to === id);
      if (edge) edges.add(edge.id);
      // A person's out-of-office window can drive a start; people aren't scheduled, so stop there.
      if (!at[prev]) { nodes.add(prev); break; }
      id = prev;
    }
  }
  return {nodes: [...nodes], edges: [...edges]};
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
