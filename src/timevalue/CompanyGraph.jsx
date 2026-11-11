import React from 'react';
import graph from '../../fixtures/timevalue/company-graph.json';

// The company dependency graph Burn rebuilt from Slack, Jira, meetings and the calendar.
// Parts → work and tests → milestones; click a node to light up its chain and read the messages behind each link.
const C = {bg: '#111110', panel: '#1B1A18', ink: '#F4F2F0', muted: '#8E8A82', line: '#3A3833', accent: '#E4F222', critical: '#E0524F'};
const COL = {part: 0, deliverable: 0, rig: 0, work: 1, test: 1, milestone: 2};
const KIND = {part: 'Part', deliverable: 'Deliverable', rig: 'Rig', work: 'Work', test: 'Test', milestone: 'Milestone'};
const DEMO = new Set(['pt-hip-bracket', 'dl-hip-motor-dvt', 'test-hip-spin', 'm-hip-spin-test']);
const ASSEMBLIES = [...new Set(graph.nodes.map(n => n.assembly).filter(Boolean))].sort();
const label = a => (a || '').replace(/^a-/, '').replace(/-/g, ' ');

function chain(id, edges) {
  const up = new Map(), down = new Map();
  for (const e of edges) { (down.get(e.from) || down.set(e.from, []).get(e.from)).push(e.to); (up.get(e.to) || up.set(e.to, []).get(e.to)).push(e.from); }
  const seen = new Set([id]);
  for (const m of [up, down]) { const st = [id]; while (st.length) for (const n of m.get(st.pop()) || []) if (!seen.has(n)) { seen.add(n); st.push(n); } }
  return seen;
}

export default function CompanyGraph() {
  const [asm, setAsm] = React.useState('a-hip-actuator');
  const [sel, setSel] = React.useState('test-hip-spin');
  const [q, setQ] = React.useState('');

  const {nodes, edges} = React.useMemo(() => {
    const keep = new Set(graph.nodes.filter(n => asm === 'all' || n.assembly === asm || DEMO.has(n.id)).map(n => n.id));
    const es = graph.edges.filter(e => keep.has(e.from) && keep.has(e.to));
    const linked = new Set(es.flatMap(e => [e.from, e.to]));
    return {nodes: graph.nodes.filter(n => linked.has(n.id)), edges: es};
  }, [asm]);

  const W = 1200, ROW = asm === 'all' ? 9 : 26, X = [40, 470, 900];
  const cols = [[], [], []];
  for (const n of nodes) cols[COL[n.kind] ?? 1].push(n);
  for (const c of cols) c.sort((a, b) => (DEMO.has(b.id) - DEMO.has(a.id)) || String(a.assembly).localeCompare(String(b.assembly)) || a.name.localeCompare(b.name));
  const pos = new Map();
  cols.forEach((c, i) => c.forEach((n, j) => pos.set(n.id, {x: X[i], y: 30 + j * ROW})));
  const H = 60 + Math.max(...cols.map(c => c.length)) * ROW;
  const lit = sel && pos.has(sel) ? chain(sel, edges) : null;
  const match = q.trim().toLowerCase();
  const selNode = graph.nodes.find(n => n.id === sel);
  const selEdges = edges.filter(e => e.from === sel || e.to === sel);
  const name = id => graph.nodes.find(n => n.id === id)?.name || id;

  return <div style={{background: C.bg, color: C.ink, minHeight: '100vh', fontFamily: 'Inter, system-ui, sans-serif', paddingInline: 'max(16px, env(safe-area-inset-left, 0px))'}}>
    <header style={{display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'baseline', padding: '20px 0 8px'}}>
      <h1 style={{margin: 0, fontSize: 22}}>Flintlock's dependency graph</h1>
      <span style={{color: C.muted, fontSize: 13}}>Rebuilt by Burn from Slack, Jira, meetings and the calendar · {graph.nodes.length} items · {graph.edges.length} links · 76% of true links recovered</span>
      <a href="/timevalue" style={{color: C.accent, fontSize: 13, marginLeft: 'auto'}}>← Back to the decision</a>
    </header>
    <div style={{display: 'flex', flexWrap: 'wrap', gap: 6, padding: '6px 0 12px'}}>
      {[...ASSEMBLIES, 'all'].map(a => <button key={a} onClick={() => setAsm(a)} style={{background: asm === a ? C.accent : C.panel, color: asm === a ? '#111' : C.ink, border: `1px solid ${C.line}`, borderRadius: 14, padding: '4px 12px', fontSize: 12, cursor: 'pointer', textTransform: 'capitalize'}}>{a === 'all' ? 'Whole company' : label(a)}</button>)}
      <input placeholder="Find a part or test…" value={q} onChange={e => setQ(e.target.value)} style={{marginLeft: 'auto', background: C.panel, color: C.ink, border: `1px solid ${C.line}`, borderRadius: 14, padding: '4px 12px', fontSize: 12}}/>
    </div>
    <div style={{display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 340px', gap: 16}}>
      <div style={{overflow: 'auto', maxHeight: '78vh', background: C.panel, borderRadius: 12}}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{width: '100%', minWidth: 900, display: 'block'}}>
          {['Parts & deliverables', 'Work & tests', 'Milestones'].map((t, i) => <text key={t} x={X[i]} y={16} fill={C.muted} fontSize="11" letterSpacing="1">{t.toUpperCase()}</text>)}
          {edges.map((e, i) => { const a = pos.get(e.from), b = pos.get(e.to); if (!a || !b) return null;
            const on = lit && lit.has(e.from) && lit.has(e.to); const x1 = a.x + 260, x2 = b.x - 6;
            return <path key={i} d={`M${x1},${a.y} C${(x1 + x2) / 2},${a.y} ${(x1 + x2) / 2},${b.y} ${x2},${b.y}`} fill="none"
              stroke={on ? (DEMO.has(e.from) && DEMO.has(e.to) ? C.accent : C.ink) : e.status === 'disputed' ? C.critical : C.line}
              strokeOpacity={lit && !on ? 0.12 : on ? 0.95 : 0.5} strokeWidth={on ? 2 : 1} strokeDasharray={e.status === 'proposed' ? '4 3' : e.status === 'disputed' ? '2 3' : undefined}/>; })}
          {nodes.map(n => { const p = pos.get(n.id); const on = !lit || lit.has(n.id); const hit = match && (n.name.toLowerCase().includes(match) || n.id.includes(match));
            return <g key={n.id} transform={`translate(${p.x},${p.y})`} onClick={() => setSel(n.id)} style={{cursor: 'pointer'}} opacity={on ? 1 : 0.18}>
              <circle r={n.kind === 'milestone' ? 6 : 4.5} fill={n.id === sel ? C.accent : DEMO.has(n.id) ? C.accent : hit ? C.critical : C.ink}/>
              {asm !== 'all' && <text x={12} y={4} fill={hit ? C.critical : C.ink} fontSize="12">{n.name.length > 38 ? n.name.slice(0, 37) + '…' : n.name}</text>}
            </g>; })}
        </svg>
      </div>
      <aside style={{background: C.panel, borderRadius: 12, padding: 16, maxHeight: '78vh', overflow: 'auto', fontSize: 13}}>
        {selNode ? <>
          <div style={{color: C.muted, fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase'}}>{KIND[selNode.kind] || selNode.kind} · {label(selNode.assembly) || '—'}</div>
          <h2 style={{fontSize: 17, margin: '4px 0 12px'}}>{selNode.name}</h2>
          <div style={{color: C.muted, marginBottom: 10}}>{lit ? `${lit.size - 1} items upstream and downstream` : ''}</div>
          {selEdges.length === 0 && <div style={{color: C.muted}}>No links stated in the messages.</div>}
          {selEdges.map((e, i) => <div key={i} style={{borderTop: `1px solid ${C.line}`, padding: '10px 0'}}>
            <div>{e.from === sel ? <>needed by <b>{name(e.to)}</b></> : <>needs <b>{name(e.from)}</b></>} <span style={{color: e.status === 'accepted' ? C.muted : C.critical, fontSize: 11}}>· {e.status}</span></div>
            {e.evidence.map((v, j) => <div key={j} style={{color: C.muted, marginTop: 6, fontSize: 12}}>“{v.text}” <span style={{color: C.ink}}>— {v.by || 'unknown'}, {String(v.at).slice(5, 10).replace('-', '/')}</span></div>)}
          </div>)}
        </> : <div style={{color: C.muted}}>Click a node to see its chain and the messages behind each link.</div>}
      </aside>
    </div>
  </div>;
}
