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
export function buildContext({order, ingest, config, now, graph: given = null, evidence: givenEvidence = null}) {
  const query = [...new Set([...tokens(order.entry.name).map(t => t + '*'), ...tokens(order.entry.note), ...(order.entry.partNumber ? [order.entry.partNumber.toLowerCase()] : [])])];
  const nameTokens = new Set([...tokens(order.entry.name), ...(order.entry.partNumber ? [order.entry.partNumber.toLowerCase()] : [])]);
  const docs = ingest ? ingest.listDocuments() : [];
  // The graph is either what the agent read for this order (given) or the latest ingest-wide rules graph.
  const latest = given ? null : ingest?.latestGraph?.();
  const base = given || latest?.graph || {nodes: [], edges: []};
  const evidence = givenEvidence || latest?.evidence || {};

  // 1. Related documents: term overlap, name tokens weighted double, newest first on ties.
  const nameList = tokens(order.entry.name), head = nameList[nameList.length - 1];
  const pn = order.entry.partNumber ? order.entry.partNumber.toLowerCase() : null;
  const related = docs.map(d => {
    const dt = new Set(tokens(d.text));
    let score = 0, hits = 0;
    for (const t of nameTokens) if (dt.has(t)) { score += 2; hits++; }
    for (const t of tokens(order.entry.note)) if (dt.has(t) && !nameTokens.has(t)) score += 1;
    // "Names the part": its number, its whole name, or its head noun with another of its words ("hip bracket"); not "hip" alone.
    const names = (pn && dt.has(pn)) || nameList.every(t => dt.has(t)) || (dt.has(head) && hits >= 2);
    return {d, score, nameHits: names ? hits : 0};
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score || b.d.at.localeCompare(a.d.at)).slice(0, 12)
    .map(({d, score, nameHits}) => ({id: d.id, source: d.source, channel: d.channel, author: d.author, at: d.at, text: d.text, score, nameHits}));
  // Only documents that name the part itself can link it to work; note-only matches are context, not links.
  const linkingText = related.filter(r => r.nameHits > 0).map(r => r.text.toLowerCase()).join('\n');
  const noteText = `${order.entry.name} ${order.entry.note}`.toLowerCase();
  const noteTokens = tokens(order.entry.note);

  // 2. The graph may already know this part from the conversation (by part number or by name).
  //    Those nodes become the order's part: their edges carry over, their stale dates do not
  //    (the quote decides when the part is ready).
  const partNodeId = `part:order-${order.id}`;
  const headOf = toks => toks[toks.length - 1];
  const nameToks = tokens(order.entry.name), nameHead = headOf(nameToks);
  const partNumber = (order.entry.partNumber || '').toUpperCase() || null;
  const samePart = n => {
    if (n.kind !== 'part' || n.attrs?.booking || n.attrs?.catalogId) return false;
    if (partNumber && (n.attrs?.partNumber === partNumber || n.label.toUpperCase() === partNumber)) return true;
    const lt = tokens(n.label);
    return lt.length > 0 && headOf(lt) === nameHead && (lt.every(t => nameToks.includes(t)) || nameToks.every(t => lt.includes(t)));
  };
  const absorbed = base.nodes.filter(samePart);
  const absorbedIds = new Set(absorbed.map(n => n.id));
  const redirect = id => (absorbedIds.has(id) ? partNodeId : id);

  // 3. Which work and milestones does this part feed? Edges the conversation stated, or names in the entry
  //    or in a document that names the part.
  const mentioned = n => { const l = n.label.toLowerCase(); const lt = tokens(l); return noteText.includes(l) || linkingText.includes(l) || (lt.length > 0 && lt.every(t => noteTokens.includes(t))); };
  const fed = new Set(base.edges.filter(e => absorbedIds.has(e.from) && (e.kind === 'blocks' || e.kind === 'due')).map(e => e.to));
  const work = base.nodes.filter(n => n.kind === 'work' && (fed.has(n.id) || mentioned(n)));
  const milestonesNamed = base.nodes.filter(n => n.kind === 'milestone' && (fed.has(n.id) || mentioned(n)));

  // 4. Augmented graph: the order's part feeds that work (or the milestone directly), same rules as any part.
  const overrides = order.context?.overrides || {}; // engineer-asserted dates, by node id
  const nodes = base.nodes.filter(n => !absorbedIds.has(n.id)).map(n => (overrides[n.id] ? {...n, attrs: {...n.attrs, date: overrides[n.id].date, evidence: overrides[n.id].evidence, dateRange: undefined}} : n));
  nodes.push({id: partNodeId, kind: 'part', label: order.entry.name, attrs: {orderId: order.id, partNumber, aliases: absorbed.map(n => n.label)}});
  const edges = [];
  for (const e of base.edges) {
    if (absorbedIds.has(e.to)) continue; // nothing feeds a purchased part
    const from = redirect(e.from);
    if (from === partNodeId && edges.some(x => x.from === from && x.to === e.to && x.kind === e.kind)) continue;
    edges.push(from === e.from ? e : {...e, id: `order-${order.id}->${e.to}`, from, via: 'entry'});
  }
  for (const w of work) if (!edges.some(e => e.from === partNodeId && e.to === w.id)) edges.push({id: `order-${order.id}->${w.id}`, from: partNodeId, to: w.id, kind: 'blocks', evidence: related.map(r => r.id), via: 'entry'});
  if (!work.length) for (const m of milestonesNamed) if (!edges.some(e => e.from === partNodeId && e.to === m.id)) edges.push({id: `order-${order.id}->${m.id}`, from: partNodeId, to: m.id, kind: 'due', evidence: related.map(r => r.id), via: 'entry'});
  const graph = {nodes, edges};
  const calendar = {holidays: config.company?.holidays || []};

  // 5. The valued outcome: the earliest dated milestone downstream of the part, and its owner's policy.
  const down = downstream(graph, partNodeId).map(id => nodes.find(n => n.id === id));
  const milestones = down.filter(n => n?.kind === 'milestone' && n.attrs?.date).sort((a, b) => a.attrs.date.localeCompare(b.attrs.date));
  const milestone = milestones[0] || null;
  const policyCfg = milestone ? config.milestones[milestone.id] || config.milestones[milestone.label] || null : null;
  const policy = {valuePerDayCents: policyCfg?.valuePerDayCents ?? null, targetOn: policyCfg?.targetOn ?? milestone?.attrs?.date ?? null, hard: !!policyCfg?.hard, owner: policyCfg?.owner ?? milestone?.attrs?.owner ?? null, source: policyCfg ? 'config' : null,
    // A value someone stated in conversation is context for the card, never authority: the policy comes from config.
    hint: milestone?.attrs?.valueHintCentsPerDay ? {centsPerDay: milestone.attrs.valueHintCentsPerDay, by: milestone.attrs.valueHintBy || null, evidence: milestone.attrs.valueHintEvidence || null} : null};

  // 6. Other inputs to the same work with a stated ready date. Their plausible values are the stated
  //    range when the source gave one, else the declared slip scenarios. Booked resources are fixed windows.
  const ageOf = n => { const ev = evidence[n.attrs?.evidence] || evidence[overrides[n.id]?.evidence]; const at = ev?.at || n.attrs?.statedAt; return at ? Math.max(0, Math.floor((Date.parse(now) - Date.parse(at)) / DAY)) : null; };
  const authorOf = n => evidence[n.attrs?.evidence]?.author || n.attrs?.statedBy || overrides[n.id]?.by || null;
  const feeds = new Set(work.map(w => w.id));
  const siblings = [...new Set(graph.edges.filter(e => e.kind === 'blocks' && feeds.has(e.to) && e.from !== partNodeId).map(e => e.from))]
    .map(id => nodes.find(n => n.id === id)).filter(n => n?.kind === 'part' && n.attrs?.date);
  const inputs = siblings.filter(n => !n.attrs.booking), bookings = siblings.filter(n => n.attrs.booking);
  //    A date is uncertain when its source gave a range, when it is older than the staleness limit, or when it
  //    has slipped before; a fresh firm statement is taken as stated and the card shows its age.
  const staleAfter = config.stalenessDays?.eta ?? 7;
  const why = s => (overrides[s.id] ? null : s.attrs.dateRange ? 'range' : (ageOf(s) ?? 0) > staleAfter ? 'stale' : null);
  const uncertain = inputs.filter(s => why(s)).map(s => ({nodeId: s.id, label: `${s.label} ready`, owner: authorOf(s) || 'its owner', current: s.attrs.date, why: why(s),
    plausible: s.attrs.dateRange && !overrides[s.id] ? [...new Set([s.attrs.dateRange[0], s.attrs.dateRange[1]])] : [s.attrs.date, ...config.scenarios.slipDays.map(d => addDays(s.attrs.date, d))], ageDays: ageOf(s), range: !overrides[s.id] && s.attrs.dateRange ? s.attrs.dateRange : null}));

  // 7. Assumptions the card states, each with its age.
  const assumptions = [];
  for (const s of inputs) assumptions.push({text: `${s.attrs.dateRange && !overrides[s.id] ? `${s.label} ready between ${day(s.attrs.dateRange[0])} and ${day(s.attrs.dateRange[1])}` : `${s.label} ready ${day(s.attrs.date)}`}${authorOf(s) ? ` (${authorOf(s)})` : ''}${s.attrs.slipped && !overrides[s.id] ? ', has slipped before' : ''}`, ageDays: ageOf(s)});
  for (const bk of bookings) assumptions.push({text: `${bk.label} booked ${day(bk.attrs.date)}–${day(addDays(bk.attrs.end, -1))}${bk.attrs.tentative ? ' (tentative)' : ''}`, ageDays: null});
  for (const w of work) assumptions.push({text: w.attrs?.durationDays ? `${w.label} takes ${w.attrs.durationDays} ${w.attrs.durationUnit === 'working' || calendar.holidays.length ? 'working ' : ''}day${w.attrs.durationDays === 1 ? '' : 's'}${authorOf(w) ? ` (${authorOf(w)})` : ''}` : `${w.label}: duration not stated`, ageDays: w.attrs?.durationDays ? ageOf(w) : null});
  if (milestone) assumptions.push({text: `${milestone.label} is ${day(milestone.attrs.date)}${milestone.attrs.tentative ? ' (tentative)' : ''}`, ageDays: ageOf(milestone)});
  if (policy.hint && evidence[policy.hint.evidence]) assumptions.push({text: `${policy.hint.by || 'Someone'} said a day late is ~$${Math.round(policy.hint.centsPerDay / 100)} in ${evidence[policy.hint.evidence].channel}${policy.valuePerDayCents ? (policy.hint.centsPerDay === policy.valuePerDayCents ? ', matching the policy' : ', which differs from the policy') : ' (no policy is set)'}`, ageDays: Math.max(0, Math.floor((Date.parse(now) - Date.parse(evidence[policy.hint.evidence].at)) / DAY))});

  // 7. Spec suggestions from authorized defaults only (the engineer's own answers are applied by the orchestrator).
  const specSuggestions = Object.fromEntries(config.specFields.filter(f => f.default != null).map(f => [f.key, {value: f.default, provenance: 'default', sourceRef: 'company default'}]));

  return {query, related, graph, partNodeId, work: work.map(w => ({id: w.id, label: w.label})), milestoneId: milestone?.id || null, milestoneLabel: milestone?.label || null,
    policy, uncertain, assumptions, specSuggestions, calendar, absorbed: absorbed.map(n => n.label), gaps: milestone ? [] : ['Which test, build or milestone is this part for?']};
}
