import React from 'react';
import {ORDER_DATE} from '../decisions.js';
import {analyzeGraph, toDay} from './engine.js';
import {arrivalsFor, defaultChoices} from './scenario.js';
import {focusGraph} from './layout.js';
import GraphView, {G} from './GraphView.jsx';

// The approver's view of one request: the part and everything downstream of it,
// scheduled with the tier currently selected in the approval panel.
export default function MiniGraph({graph, requests, catalogId, tier, tierName}) {
  const partId = `part:${catalogId}`;
  const model = React.useMemo(() => {
    if (!graph?.nodes.some(n => n.id === partId)) return null;
    const choices = {...defaultChoices(requests), [catalogId]: tier};
    const analysis = analyzeGraph(graph, {orderDate: ORDER_DATE, arrivals: arrivalsFor(graph, requests, choices)});
    return {sub: focusGraph(graph, partId), analysis};
  }, [graph, requests, catalogId, tier, partId]);
  if (!model || model.sub.nodes.length < 2) return null;
  // Name what actually drives each slip when it isn't this order.
  const label = id => graph.nodes.find(n => n.id === id)?.label;
  const others = model.sub.nodes.filter(n => n.kind === 'milestone' && model.analysis.days[n.id]?.slip > 0).map(m => {
    let id = m.id; const seen = new Set();
    while (model.analysis.days[id]?.drivenBy && !seen.has(id)) { seen.add(id); id = model.analysis.days[id].drivenBy; }
    return id !== partId ? {m, cause: id} : null;
  }).filter(Boolean);
  const people = Object.fromEntries(graph.nodes.filter(n => n.kind === 'person').map(n => [n.id, n.label]));
  return <div style={{display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 640}}>
    <div style={{display: 'flex', justifyContent: 'space-between', fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: G.muted}}>
      <span>What waits on this · if {tierName.toLowerCase()}</span>
      <a href={`/graph?focus=${encodeURIComponent(partId)}`} style={{color: G.muted, textTransform: 'none', letterSpacing: 0, fontSize: 12}}>Open graph →</a>
    </div>
    <div style={{border: `1px solid ${G.line}`, borderRadius: 10, padding: '6px 4px'}}>
      <GraphView compact graph={model.sub} analysis={model.analysis} today={toDay(ORDER_DATE)} people={people}/>
    </div>
    {others.map(({m, cause}) => <span key={m.id} style={{fontSize: 12, color: G.muted}}>
      {m.label} still slips {model.analysis.days[m.id].slip}d with this option: <span style={{color: G.ink}}>{label(cause)}</span> {graph.nodes.find(n => n.id === cause)?.kind === 'part' ? `arrives ${new Date(model.analysis.at[cause].finish + 'T00:00:00Z').toLocaleDateString('en-US', {month: 'short', day: 'numeric', timeZone: 'UTC'})}` : 'is the bottleneck'}, not this order.
    </span>)}
  </div>;
}
