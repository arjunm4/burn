import React from 'react';
import graph from '../../fixtures/timevalue/company-graph.json';

// Who is waiting on this item: everyone downstream of it in Burn's company graph, one line per person.
const byId = new Map(graph.nodes.map(n => [n.id, n]));
const down = new Map();
for (const e of graph.edges) (down.get(e.from) || down.set(e.from, []).get(e.from)).push(e.to);
const KIND = {test: 'test', milestone: 'milestone', work: 'work'};

export function blockedBy(id) {
  const seen = new Map(); const st = [[id, 0]];
  while (st.length) { const [x, d] = st.pop(); for (const y of down.get(x) || []) if (!seen.has(y)) { seen.set(y, d + 1); st.push([y, d + 1]); } }
  const people = new Map();
  for (const [nid, depth] of seen) {
    const n = byId.get(nid); if (!n?.owner) continue;
    const p = people.get(n.owner) || {name: n.owner, items: [], depth};
    p.items.push({...n, depth}); p.depth = Math.min(p.depth, depth); people.set(n.owner, p);
  }
  const rank = n => (n.kind === 'milestone' ? 0 : n.kind === 'test' ? 1 : 2);
  return [...people.values()].map(p => ({...p, items: p.items.sort((a, b) => a.depth - b.depth || rank(b) - rank(a))})).sort((a, b) => a.depth - b.depth || b.items.length - a.items.length);
}

export default function WhoBlocked({id, C, dark = false, max = 3}) {
  const rows = React.useMemo(() => blockedBy(id), [id]);
  if (!rows.length) return null;
  const ink = dark ? '#F4F2F0' : C.ink, muted = dark ? '#8E8A82' : C.muted, line = dark ? '#2A2925' : C.hair;
  // Work items are named "<activity> for <build>: <part>"; keep the readable end.
  const short = n => { let s = n.name; if (n.kind === 'work') { const m = s.match(/(prototype fit up|tolerance stack check|build sub assembly|assemble build unit|rig setup)/i); s = m ? m[1].toLowerCase() : s; }
    s = s.replace(/^hip actuator /i, ''); return s.length > 32 ? s.slice(0, 31) + '…' : s; };
  return <div style={{display: 'flex', flexDirection: 'column', gap: 6}}>
    <div style={{fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: muted}}>Who is blocked · {rows.length} {rows.length === 1 ? 'person' : 'people'}</div>
    {rows.slice(0, max).map(p => {
      const first = p.items[0];
      return <div key={p.name} style={{display: 'flex', alignItems: 'baseline', gap: 8, padding: '6px 0', borderTop: `1px solid ${line}`}}>
        <span style={{width: 8, height: 8, borderRadius: 8, background: p.depth === 1 ? '#D03B3B' : '#E4A13B', flex: 'none', alignSelf: 'center'}}/>
        <b style={{color: ink, fontWeight: 600, whiteSpace: 'nowrap'}}>{p.name.split(' ')[0]}</b>
        <span style={{color: muted, minWidth: 0}}>{p.depth === 1 ? 'blocked: ' : 'waiting: '}{short(first)}{p.items.length > 1 ? ` · +${p.items.length - 1} more` : ''}</span>
      </div>;
    })}
    {rows.length > max && <div style={{color: muted, fontSize: 12}}>+{rows.length - max} more</div>}
  </div>;
}
