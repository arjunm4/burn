// Context retrieval for one order (architecture §0.1, §6): the part entry is the query.
// Finds the ingested documents related to the part, attaches the part to the work and
// milestone they name, and assembles the planning snapshot the decision core needs:
// graph, milestone, owner policy, declared scenarios for uncertain sibling dates, and
// assumptions with their age. Facts come only from the graph (accepted claims) and the
// engineer's own answers; nothing is inferred from chatter beyond "this document is related".
import {downstream} from '../../src/graph/engine.js';

const DAY = 86400000;
const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'need', 'needs', 'part', 'parts', 'please', 'asap', 'soon', 'our', 'its', 'are', 'was', 'have', 'has', 'into', 'onto', 'about', 'custom', 'machined']);
export const tokens = s => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 3 && !STOP.has(t));
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
const day = iso => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', {month: 'short', day: 'numeric', timeZone: 'UTC'});

/**
 * @param {object} p
 * @param {object} p.order          Order (uses entry.name, entry.note, id, context.overrides)
 * @param {object|null} p.ingest    the running ingest (listDocuments, latestGraph) or null
 * @param {object} p.config         loadConfig() result
 * @param {string} p.now            ISO
 */
export function buildContext({order, ingest, config, now}) {
  const query = [...new Set([...tokens(order.entry.name).map(t => t + '*'), ...tokens(order.entry.note)])];
  const nameTokens = new Set(tokens(order.entry.name));
  const docs = ingest ? ingest.listDocuments() : [];
  const latest = ingest?.latestGraph?.();
  const base = latest?.graph || {nodes: [], edges: []};
  const evidence = latest?.evidence || {};

  // 1. Related documents: term overlap, name tokens weighted double, newest first on ties.
  const related = docs.map(d => {
    const dt = new Set(tokens(d.text));
    let score = 0, nameHits = 0;
    for (const t of nameTokens) if (dt.has(t)) { score += 2; nameHits++; }
    for (const t of tokens(order.entry.note)) if (dt.has(t) && !nameTokens.has(t)) score += 1;
    return {d, score, nameHits};
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score || b.d.at.localeCompare(a.d.at)).slice(0, 12)
    .map(({d, score, nameHits}) => ({id: d.id, source: d.source, channel: d.channel, author: d.author, at: d.at, text: d.text, score, nameHits}));
  // Only documents that name the part itself can link it to work; note-only matches are context, not links.
  const linkingText = related.filter(r => r.nameHits > 0).map(r => r.text.toLowerCase()).join('\n');
  const noteText = `${order.entry.name} ${order.entry.note}`.toLowerCase();
  const noteTokens = tokens(order.entry.note);

  // 2. Which work and milestones does this part feed? Named in the entry, or in a document that names the part.
  const mentioned = n => { const l = n.label.toLowerCase(); const lt = tokens(l); return noteText.includes(l) || linkingText.includes(l) || (lt.length > 0 && lt.every(t => noteTokens.includes(t))); };
  const work = base.nodes.filter(n => n.kind === 'work' && mentioned(n));
  const milestonesNamed = base.nodes.filter(n => n.kind === 'milestone' && mentioned(n));

  // 3. Augmented graph: the order's part feeds that work (or the milestone directly), same rules as any part.
  const partNodeId = `part:order-${order.id}`;
  const overrides = order.context?.overrides || {}; // engineer-asserted dates, by node id
  const nodes = base.nodes.map(n => (overrides[n.id] ? {...n, attrs: {...n.attrs, date: overrides[n.id].date, evidence: overrides[n.id].evidence}} : n));
  nodes.push({id: partNodeId, kind: 'part', label: order.entry.name, attrs: {orderId: order.id}});
  const edges = [...base.edges];
  for (const w of work) edges.push({id: `order-${order.id}->${w.id}`, from: partNodeId, to: w.id, kind: 'blocks', evidence: related.map(r => r.id), via: 'entry'});
  if (!work.length) for (const m of milestonesNamed) edges.push({id: `order-${order.id}->${m.id}`, from: partNodeId, to: m.id, kind: 'due', evidence: related.map(r => r.id), via: 'entry'});
  const graph = {nodes, edges};

  // 4. The valued outcome: the earliest dated milestone downstream of the part.
  const down = downstream(graph, partNodeId).map(id => nodes.find(n => n.id === id));
  const milestones = down.filter(n => n?.kind === 'milestone' && n.attrs?.date).sort((a, b) => a.attrs.date.localeCompare(b.attrs.date));
  const milestone = milestones[0] || null;
  const policyCfg = milestone ? config.milestones[milestone.id] || config.milestones[milestone.label] || null : null;
  const policy = {valuePerDayCents: policyCfg?.valuePerDayCents ?? null, targetOn: policyCfg?.targetOn ?? milestone?.attrs?.date ?? null, hard: !!policyCfg?.hard, owner: policyCfg?.owner ?? null, source: policyCfg ? 'config' : null};

  // 5. Uncertain sibling dates → declared scenarios ("as stated", then the configured slips).
  const ageOf = n => { const ev = evidence[n.attrs?.evidence] || evidence[overrides[n.id]?.evidence]; return ev?.at ? Math.max(0, Math.floor((Date.parse(now) - Date.parse(ev.at)) / DAY)) : null; };
  const authorOf = n => evidence[n.attrs?.evidence]?.author || null;
  const siblings = [...new Set(graph.edges.filter(e => e.kind === 'blocks' && work.some(w => w.id === e.to) && e.from !== partNodeId).map(e => e.from))]
    .map(id => nodes.find(n => n.id === id)).filter(n => n?.kind === 'part' && n.attrs?.date);
  const uncertain = siblings.map(s => ({nodeId: s.id, label: `${s.label} ready`, owner: authorOf(s) || 'its owner', current: s.attrs.date,
    plausible: [s.attrs.date, ...config.scenarios.slipDays.map(d => addDays(s.attrs.date, d))], ageDays: ageOf(s)}));

  // 6. Assumptions the card states, each with its age.
  const assumptions = [];
  for (const s of siblings) assumptions.push({text: `${s.label} ready ${day(s.attrs.date)}${authorOf(s) ? ` (${authorOf(s)})` : ''}`, ageDays: ageOf(s)});
  for (const w of work) assumptions.push({text: w.attrs?.durationDays ? `${w.label} takes ${w.attrs.durationDays} day${w.attrs.durationDays === 1 ? '' : 's'}` : `${w.label}: duration not stated`, ageDays: w.attrs?.durationDays ? ageOf(w) : null});
  if (milestone) assumptions.push({text: `${milestone.label} is ${day(milestone.attrs.date)}`, ageDays: ageOf(milestone)});

  // 7. Spec suggestions from authorized defaults only (the engineer's own answers are applied by the orchestrator).
  const specSuggestions = Object.fromEntries(config.specFields.filter(f => f.default != null).map(f => [f.key, {value: f.default, provenance: 'default', sourceRef: 'company default'}]));

  return {query, related, graph, partNodeId, work: work.map(w => ({id: w.id, label: w.label})), milestoneId: milestone?.id || null, milestoneLabel: milestone?.label || null,
    policy, uncertain, assumptions, specSuggestions, gaps: milestone ? [] : ['Which test, build or milestone is this part for?']};
}
