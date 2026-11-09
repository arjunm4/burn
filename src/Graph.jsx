import React from 'react';
import {api} from './api.js';
import {ORDER_DATE, COST} from './decisions.js';
import {analyzeGraph, idleCost, toDay} from './graph/engine.js';
import {arrivalsFor, defaultChoices, requestsByPart} from './graph/scenario.js';
import GraphView, {G} from './graph/GraphView.jsx';

const money = n => '$' + Math.round(n).toLocaleString('en-US');
const day = iso => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', {month: 'short', day: 'numeric', timeZone: 'UTC'});
// Windows end exclusively; show the last day actually covered.
const lastDay = iso => new Date(Date.parse(iso + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
const eyebrow = {fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: G.muted};
const EXTRACTOR = {claude: 'Extracted by Claude', rules: 'Rule-based extraction · no model call'};

export default function Graph() {
  const [data, setData] = React.useState(null);
  const [requests, setRequests] = React.useState([]);
  const [choices, setChoices] = React.useState(null);
  const [selected, setSelected] = React.useState(() => new URLSearchParams(location.search).get('focus'));
  const [view, setView] = React.useState('timeline');
  const [syncing, setSyncing] = React.useState(false);
  const [error, setError] = React.useState(null);

  const load = React.useCallback(async () => {
    try {
      const [g, r] = await Promise.all([api('/graph'), api('/requests')]);
      setData(g); setRequests(r.requests); setChoices(c => c || defaultChoices(r.requests)); setError(null);
    } catch (e) { setError(e.status === 404 ? 'No graph yet. Sync your sources to build one.' : e.message); }
  }, []);
  React.useEffect(() => { load(); }, [load]);

  async function sync() {
    setSyncing(true); setError(null);
    try { await api('/sync', {body: {}}); await load(); } catch (e) { setError(e.message); } finally { setSyncing(false); }
  }

  const graph = data?.graph;
  // A deep link or a re-sync can leave the selection pointing at a node that no longer exists.
  React.useEffect(() => { if (graph && selected && !graph.nodes.some(n => n.id === selected)) setSelected(null); }, [graph, selected]);
  const model = React.useMemo(() => {
    if (!graph || !choices) return null;
    const baseline = analyzeGraph(graph, {orderDate: ORDER_DATE, arrivals: arrivalsFor(graph, requests, {}, {fastest: true})});
    const analysis = analyzeGraph(graph, {orderDate: ORDER_DATE, arrivals: arrivalsFor(graph, requests, choices)});
    return {analysis, idle: idleCost(graph, baseline, analysis)};
  }, [graph, requests, choices]);

  const people = graph ? Object.fromEntries(graph.nodes.filter(n => n.kind === 'person').map(n => [n.id, n.label])) : {};
  const byPart = requestsByPart(requests);
  const parts = graph ? graph.nodes.filter(n => n.kind === 'part' && byPart[n.attrs?.catalogId]?.tiers?.length > 1 && !n.attrs?.end) : [];

  return <div style={{minHeight: '100vh', fontSize: 13, display: 'flex', flexDirection: 'column'}}>
    <header style={{display: 'flex', alignItems: 'center', gap: 18, padding: '14px 24px', borderBottom: `1px solid ${G.line}`}}>
      <span style={{fontSize: 16, letterSpacing: '.04em'}}>ramp</span>
      <span style={{color: G.muted}}>Procurement</span><span style={{color: G.faint}}>/</span><span>Dependencies</span>
      <a href="/request" style={{marginLeft: 'auto', color: G.muted, fontSize: 12}}>Engineer</a>
      <a href="/approvals" style={{color: G.muted, fontSize: 12}}>Approvals</a>
    </header>
    <main style={{flex: 1, padding: '24px 24px 60px', display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 1280, width: '100%', boxSizing: 'border-box', margin: '0 auto'}}>
      <div style={{display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap'}}>
        <div style={{display: 'flex', flexDirection: 'column', gap: 4}}>
          <div style={{fontSize: 22, letterSpacing: '-.02em'}}>What waits on what</div>
          <div style={{color: G.muted}}>{data ? `${EXTRACTOR[data.extractor] || data.extractor} from ${sourceLine(data)}${data.builtAt ? ` · built ${new Date(data.builtAt).toLocaleString('en-US', {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'})}` : ''}` : 'Built from Slack and the hardware calendar'}</div>
        </div>
        <div style={{marginLeft: 'auto', display: 'flex', gap: 8}}>
          {graph && <div role="tablist" style={{display: 'flex', border: `1px solid ${G.line}`, borderRadius: 6, overflow: 'hidden'}}>
            {['timeline', 'table'].map(v => <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)} style={{border: 0, padding: '7px 12px', fontSize: 12, cursor: 'pointer', background: view === v ? G.ink : '#fff', color: view === v ? G.paper : G.ink}}>{v === 'timeline' ? 'Timeline' : 'Table'}</button>)}
          </div>}
          <button onClick={sync} disabled={syncing} style={{background: G.accent, border: `1px solid ${G.accent}`, borderRadius: 6, padding: '7px 14px', fontSize: 13, cursor: 'pointer', color: G.ink}}>{syncing ? 'Syncing…' : 'Sync sources'}</button>
        </div>
      </div>
      {data?.error && <div role="status" style={{color: G.muted}}>Model extraction failed ({data.error}); showing rule-based extraction.</div>}
      {error && <div role="alert" style={{color: G.ink}}>{error}</div>}
      {!graph && !error && <span style={{color: G.muted}}>Loading graph…</span>}

      {model && <>
        <Summary graph={graph} analysis={model.analysis} idle={model.idle}/>
        {parts.length > 0 && <div style={{display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start'}}>
          {parts.map(p => {
            const r = byPart[p.attrs.catalogId];
            return <div key={p.id} style={{display: 'flex', flexDirection: 'column', gap: 6}}>
              <span style={eyebrow}>{p.label} · {r.pr}</span>
              <div role="radiogroup" aria-label={`Shipping for ${p.label}`} style={{display: 'flex', border: `1px solid ${G.line}`, borderRadius: 6, overflow: 'hidden', background: '#fff'}}>
                {r.tiers.map((t, i) => {
                  const on = choices[p.attrs.catalogId] === i;
                  return <button key={t.name} role="radio" aria-checked={on} onClick={() => setChoices(c => ({...c, [p.attrs.catalogId]: i}))}
                    style={{border: 0, borderLeft: i ? `1px solid ${G.line}` : 0, padding: '6px 10px', cursor: 'pointer', textAlign: 'left', background: on ? G.ink : '#fff', color: on ? G.paper : G.ink, display: 'flex', flexDirection: 'column', fontSize: 12, lineHeight: 1.3}}>
                    <span>{t.name}</span><span style={{opacity: .7}}>{day(t.arrivesOn)} · {money(t.price)}</span>
                  </button>;
                })}
              </div>
            </div>;
          })}
        </div>}
        <div style={{display: 'grid', gridTemplateColumns: selected ? 'minmax(0,1fr) 340px' : 'minmax(0,1fr)', gap: 20, alignItems: 'start'}} data-graph-grid>
          <section style={{background: '#fff', border: `1px solid ${G.line}`, borderRadius: 12, padding: '12px 8px 8px', minWidth: 0, overflowX: 'auto'}}>
            {view === 'timeline'
              ? <GraphView graph={graph} analysis={model.analysis} today={toDay(ORDER_DATE)} selected={selected} onSelect={setSelected} people={people}/>
              : <ScheduleTable graph={graph} analysis={model.analysis} people={people} onSelect={setSelected}/>}
            <Legend/>
          </section>
          {selected && <Evidence graph={graph} analysis={model.analysis} id={selected} evidence={data.evidence || {}} people={people} onClose={() => setSelected(null)}/>}
        </div>
      </>}
    </main>
  </div>;
}

function sourceLine(data) {
  const s = data.sources || [];
  if (!s.length) return 'seeded Slack and calendar';
  return s.map(x => `${x.label || x.kind}${x.mode === 'fixture' ? ' (seeded)' : ''}`).join(' + ');
}

function Summary({graph, analysis, idle}) {
  const milestones = graph.nodes.filter(n => n.kind === 'milestone' && analysis.at[n.id]).sort((a, b) => analysis.at[a.id].planned.localeCompare(analysis.at[b.id].planned));
  const tile = (k, v, sub, hot) => <div key={k} style={{background: '#fff', border: `1px solid ${G.line}`, borderRadius: 10, padding: '12px 14px', minWidth: 160, display: 'flex', flexDirection: 'column', gap: 2}}>
    <span style={eyebrow}>{k}</span>
    <span style={{fontSize: 20, letterSpacing: '-.02em', color: hot ? G.critical : G.ink}}>{v}</span>
    <span style={{color: G.muted, fontSize: 12}}>{sub}</span>
  </div>;
  return <div style={{display: 'flex', gap: 12, flexWrap: 'wrap'}}>
    {milestones.map(m => { const s = analysis.at[m.id]; return tile(m.label, s.slip ? `▲ slips ${s.slip}d` : 'On time', s.slip ? `${day(s.planned)} → ${day(s.finish)}` : day(s.planned), s.slip > 0); })}
    {tile('Idle engineering', `${idle.engineerDays} eng-days`, idle.cost ? `≈ ${money(idle.cost)} at ${money(COST)}/day vs fastest shipping` : 'Nobody waits longer than necessary', idle.cost > 0)}
    {analysis.conflicts.map((c, i) => tile('Conflict', 'Rebook', `${graph.nodes.find(n => n.id === c.node)?.label} ends ${day(lastDay(c.bookingEnd))}; ${graph.nodes.find(n => n.id === c.work)?.label} starts ${day(c.workStart)}`, true))}
  </div>;
}

function Legend() {
  const item = (svg, label) => <span style={{display: 'inline-flex', gap: 6, alignItems: 'center'}}><svg width={22} height={14} aria-hidden>{svg}</svg>{label}</span>;
  return <div style={{display: 'flex', gap: 16, flexWrap: 'wrap', padding: '10px 10px 2px', fontSize: 11, color: G.muted, borderTop: `1px solid ${G.hair}`, marginTop: 6}}>
    {item(<circle cx={11} cy={7} r={5} fill="#fff" stroke={G.ink} strokeWidth={2}/>, 'Part arrives')}
    {item(<rect x={2} y={3} width={18} height={8} rx={3} fill={G.bar}/>, 'Work')}
    {item(<rect x={7} y={3} width={8} height={8} transform="rotate(45 11 7)" fill="#fff" stroke={G.ink} strokeWidth={2}/>, 'Milestone')}
    {item(<path d="M2 7 H20" stroke={G.ink} strokeWidth={2}/>, 'Critical path')}
    {item(<path d="M2 7 H20" stroke={G.faint} strokeWidth={1.5} strokeDasharray="4 3"/>, 'Due by')}
    {item(<rect x={7} y={3} width={8} height={8} transform="rotate(45 11 7)" fill={G.critical}/>, 'Slipped milestone')}
  </div>;
}

function ScheduleTable({graph, analysis, people, onSelect}) {
  const rows = graph.nodes.filter(n => analysis.at[n.id]).sort((a, b) => analysis.at[a.id].start.localeCompare(analysis.at[b.id].start));
  const critical = new Set(analysis.critical.nodes);
  const cell = {padding: '7px 10px', borderTop: `1px solid ${G.hair}`, textAlign: 'left'};
  return <table style={{width: '100%', borderCollapse: 'collapse', fontSize: 12}}>
    <thead><tr style={{...eyebrow}}>{['Item', 'Kind', 'Start', 'Finish', 'Slip', 'People'].map(h => <th key={h} style={{...cell, borderTop: 0, fontWeight: 400}}>{h}</th>)}</tr></thead>
    <tbody>{rows.map(n => { const s = analysis.at[n.id]; return <tr key={n.id} onClick={() => onSelect(n.id)} style={{cursor: 'pointer'}}>
      <td style={{...cell, fontWeight: critical.has(n.id) ? 500 : 400}}>{n.label}{critical.has(n.id) ? ' · critical' : ''}</td>
      <td style={{...cell, color: G.muted}}>{n.kind}</td><td style={cell}>{day(s.start)}</td><td style={cell}>{day(s.finish)}</td>
      <td style={{...cell, color: s.slip ? G.critical : G.muted}}>{s.slip ? `+${s.slip}d` : '—'}</td>
      <td style={{...cell, color: G.muted}}>{graph.edges.filter(e => e.kind === 'assigned' && e.to === n.id).map(e => people[e.from]).join(', ')}</td>
    </tr>; })}</tbody>
  </table>;
}

function Evidence({graph, analysis, id, evidence, people, onClose}) {
  const n = graph.nodes.find(x => x.id === id); const s = analysis.at[id];
  if (!n) return null;
  const label = x => graph.nodes.find(y => y.id === x)?.label || x;
  const VERB = {blocks: 'blocks', due: 'is due before', assigned: 'works on'};
  const touching = graph.edges.filter(e => e.from === id || e.to === id);
  const docIds = [...new Set([...touching.flatMap(e => e.evidence), n.attrs?.evidence].filter(Boolean))];
  return <aside style={{background: '#fff', border: `1px solid ${G.line}`, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 14, position: 'sticky', top: 16}}>
    <div style={{display: 'flex', alignItems: 'flex-start', gap: 8}}>
      <div style={{display: 'flex', flexDirection: 'column', gap: 2}}><span style={eyebrow}>{n.kind}</span><span style={{fontSize: 17}}>{n.label}</span></div>
      <button onClick={onClose} aria-label="Close" style={{marginLeft: 'auto', border: 0, background: 'transparent', cursor: 'pointer', color: G.muted, fontSize: 16}}>×</button>
    </div>
    {s && <div style={{color: G.muted}}>{n.kind === 'milestone' ? (s.slip ? `Planned ${day(s.planned)}, now ${day(s.finish)} (+${s.slip}d)` : `${day(s.planned)}, on time`) : n.kind === 'work' ? `${day(s.start)} → ${day(s.finish)}` : n.kind === 'part' ? `Arrives ${day(s.finish)}` : ''}</div>}
    {n.attrs?.ooo?.length > 0 && <div style={{color: G.muted}}>Out {n.attrs.ooo.map(w => `${day(w.start)}–${day(lastDay(w.end))}`).join(', ')}</div>}
    {touching.length > 0 && <div style={{display: 'flex', flexDirection: 'column', gap: 4}}>
      <span style={eyebrow}>Dependencies</span>
      {touching.map(e => <div key={e.id} style={{display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap'}}>
        <span>{e.kind === 'assigned' ? people[e.from] || label(e.from) : label(e.from)}</span><span style={{color: G.muted}}>{VERB[e.kind]}</span><span>{label(e.to)}</span>
        <span style={{color: G.muted, fontSize: 11}}>{e.via === 'llm' ? 'Claude' : 'rule'} · {Math.round(e.confidence * 100)}%</span>
      </div>)}
    </div>}
    <div style={{display: 'flex', flexDirection: 'column', gap: 8}}>
      <span style={eyebrow}>Evidence</span>
      {docIds.length === 0 && <span style={{color: G.muted}}>No cited sources.</span>}
      {docIds.map(d => { const doc = evidence[d]; if (!doc) return <span key={d} style={{color: G.muted, fontSize: 12}}>{d}</span>;
        return <blockquote key={d} style={{margin: 0, padding: '8px 10px', borderLeft: `2px solid ${G.ink}`, background: G.paper, borderRadius: 4, display: 'flex', flexDirection: 'column', gap: 4}}>
          <span style={{lineHeight: 1.45}}>{doc.text}</span>
          <span style={{color: G.muted, fontSize: 11}}>{doc.source === 'slack' ? `${doc.author || 'Unknown'} · ${doc.channel}` : `Calendar · ${doc.channel || 'event'}`} · {new Date(doc.at).toLocaleDateString('en-US', {month: 'short', day: 'numeric'})}
            {doc.url && <> · <a href={doc.url} target="_blank" rel="noreferrer" style={{color: G.muted}}>open</a></>}</span>
        </blockquote>; })}
    </div>
  </aside>;
}
