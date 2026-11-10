// Timeline layout for the dependency graph: x is the calendar, one row per part, work item
// or milestone. Rows are grouped by connected chain and ordered by dependency depth so
// edges flow down and to the right. Pure: graph + schedule in, geometry out.
import {downstream, toIso} from './engine.js';

const ROW_KINDS = new Set(['part', 'work', 'milestone']);

export function focusGraph(graph, focusId) {
  if (!focusId) return graph;
  const down = new Set(downstream(graph, focusId));
  const keep = new Set([focusId, ...down]);
  // Other blockers feeding the same work and milestones explain slips this part can't fix.
  for (const e of graph.edges) if (e.kind !== 'assigned' && down.has(e.to) && !down.has(e.from) && graph.nodes.find(n => n.id === e.from)?.kind === 'part') keep.add(e.from);
  for (const e of graph.edges) if (e.kind === 'assigned' && keep.has(e.to)) keep.add(e.from);
  return {...graph, nodes: graph.nodes.filter(n => keep.has(n.id)), edges: graph.edges.filter(e => keep.has(e.from) && keep.has(e.to))};
}

function chains(graph) {
  const ids = graph.nodes.filter(n => ROW_KINDS.has(n.kind)).map(n => n.id);
  const parent = Object.fromEntries(ids.map(id => [id, id]));
  const find = id => (parent[id] === id ? id : (parent[id] = find(parent[id])));
  for (const e of graph.edges) if (e.kind !== 'assigned' && parent[e.from] && parent[e.to]) parent[find(e.from)] = find(e.to);
  const groups = new Map();
  for (const id of ids) { const r = find(id); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(id); }
  return [...groups.values()];
}

function depths(graph) {
  const depth = {};
  const preds = new Map();
  for (const e of graph.edges) if (e.kind !== 'assigned') { if (!preds.has(e.to)) preds.set(e.to, []); preds.get(e.to).push(e.from); }
  const visit = (id, seen = new Set()) => {
    if (depth[id] != null) return depth[id];
    if (seen.has(id)) return 0;
    seen.add(id);
    return (depth[id] = Math.max(0, ...(preds.get(id) || []).map(p => visit(p, seen) + 1)));
  };
  for (const n of graph.nodes) visit(n.id);
  return depth;
}

/**
 * layout(graph, analysis, {width, rowHeight, labelWidth}) -> geometry for GraphView.
 * analysis is analyzeGraph() output; days are compared numerically, rendered as ISO.
 */
export function layout(graph, analysis, {width = 960, rowHeight = 34, labelWidth = 190, gap = 14, pad = 28} = {}) {
  const at = analysis.days;
  const nodes = new Map(graph.nodes.map(n => [n.id, n]));
  const depth = depths(graph);
  const groups = chains(graph).filter(g => g.some(id => at[id]));
  const known = v => (v == null ? Infinity : v);
  const firstDay = g => Math.min(...g.map(id => known(at[id]?.start)));
  // Biggest chains first: the story is in the chain with the most dependencies.
  groups.sort((a, b) => b.length - a.length || firstDay(a) - firstDay(b));

  const rows = [];
  let y = pad;
  for (const g of groups) {
    g.sort((a, b) => depth[a] - depth[b] || known(at[a]?.start) - known(at[b]?.start) || nodes.get(a).label.localeCompare(nodes.get(b).label));
    for (const id of g) { rows.push({id, node: nodes.get(id), y: y + rowHeight / 2}); y += rowHeight; }
    y += gap;
  }

  const days = Object.values(at).flatMap(s => [s.start, s.finish, s.planned, s.end].filter(v => v != null));
  const lo = Math.min(...days) - 1, hi = Math.max(...days) + 2;
  const plot = Math.max(240, width - labelWidth - pad);
  const pxPerDay = plot / Math.max(1, hi - lo);
  const x = day => labelWidth + (day - lo) * pxPerDay;
  const rowOf = Object.fromEntries(rows.map(r => [r.id, r]));

  const ticks = [];
  for (let d = Math.ceil(lo); d <= hi; d++) {
    const date = new Date(d * 86400000);
    const monday = date.getUTCDay() === 1;
    // Every day gets a gridline; labels only where they fit (daily when wide, else Mondays).
    ticks.push({x: x(d), day: d, iso: toIso(d), major: monday, label: monday || pxPerDay >= 46 ? date.toLocaleDateString('en-US', {month: 'short', day: 'numeric', timeZone: 'UTC'}) : null});
  }

  // Edges leave a node where it finishes and enter where its successor starts.
  // Unknown dates have no position: edges into or out of them are drawn from the nearest known point.
  const pos = s => s.finish ?? s.start ?? s.planned ?? lo;
  const exit = id => { const s = at[id], n = nodes.get(id); return n.kind === 'milestone' ? x(pos(s)) + 7 : x(pos(s)); };
  const entry = id => { const s = at[id], n = nodes.get(id); return n.kind === 'milestone' ? x(pos(s)) - 7 : x(s.start ?? pos(s)); };
  const critical = new Set(analysis.critical.edges);
  const edges = graph.edges.filter(e => e.kind !== 'assigned' && rowOf[e.from] && rowOf[e.to]).map(e => {
    const x1 = exit(e.from), y1 = rowOf[e.from].y, x2 = entry(e.to), y2 = rowOf[e.to].y;
    const bend = Math.max(18, Math.abs(x2 - x1) / 2);
    return {edge: e, critical: critical.has(e.id), path: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`};
  });

  return {rows, edges, ticks, x, pxPerDay, width: labelWidth + plot + pad, height: y + pad - gap, labelWidth, rowHeight};
}
