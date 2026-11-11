import React from 'react';
import {api} from './api.js';
import {C, Page, Chip, Eyebrow, clock} from './ui.jsx';

/**
 * /inbox?as=<person>: the Slack-DM-style messages one person gets from Burn as orders move.
 * Newest at the bottom, live over SSE.
 */
export default function Inbox() {
  const [as, setAs] = React.useState(() => new URLSearchParams(location.search).get('as') || '');
  const [people, setPeople] = React.useState([]);   // [{name, role}]
  const [items, setItems] = React.useState([]);
  const [system, setSystem] = React.useState(null);
  const [error, setError] = React.useState(null);
  const endRef = React.useRef(null);

  // Who can be looked at: engineers on recent orders and the configured manager (plus anyone who was ever notified).
  React.useEffect(() => { (async () => {
    try {
      const [s, o, n] = await Promise.all([api('/system'), api('/orders'), api('/notifications?limit=1')]);
      setSystem(s);
      const manager = s.company?.manager || 'manager';
      const engineers = [...new Set(o.orders.slice().reverse().map(x => x.entry.engineer).filter(Boolean))];
      const extra = (n.recipients || []).filter(p => p !== manager && !engineers.includes(p));
      setPeople([...engineers.map(name => ({name, role: 'engineer'})), ...extra.map(name => ({name, role: 'asked'})), {name: manager, role: 'manager'}]);
      if (!as) setAs(engineers[0] || manager);
    } catch (e) { setError(e.message); }
  })(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    if (!as) return;
    history.replaceState(null, '', `/inbox?as=${encodeURIComponent(as)}`);
    let closed = false;
    api(`/notifications?to=${encodeURIComponent(as)}&limit=200`).then(r => { if (!closed) { setItems(r.notifications); setError(null); } }).catch(e => setError(e.message));
    const es = new EventSource(`/api/notifications/stream?to=${encodeURIComponent(as)}`);
    es.addEventListener('notification', e => { try { const n = JSON.parse(e.data); setItems(list => (list.some(x => x.id === n.id) ? list : [...list, n])); } catch {} });
    return () => { closed = true; es.close(); };
  }, [as]);
  React.useEffect(() => { endRef.current?.scrollIntoView({block: 'end'}); }, [items.length]);

  return <Page system={system} width={720} style={{display: 'flex', flexDirection: 'column', gap: 18}}>
    <div style={{display: 'flex', gap: 10, alignItems: 'baseline'}}><span style={{fontSize: 24, letterSpacing: '-.02em'}}>Inbox</span><Chip>simulated</Chip></div>
    <div style={{display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap'}}>
      {people.map(p => <button key={p.name} onClick={() => setAs(p.name)} style={{background: p.name === as ? C.ink : '#fff', color: p.name === as ? C.paper : C.ink, border: `1px solid ${p.name === as ? C.ink : C.line}`, borderRadius: 16, padding: '5px 12px', fontSize: 12, cursor: 'pointer'}}>{p.name}<span style={{opacity: .6}}> · {p.role}</span></button>)}
    </div>
    {error && <div role="alert" style={{color: C.critical}}>{error}</div>}

    <div style={{display: 'flex', flexDirection: 'column', gap: 14}}>
      {!items.length && as && <div style={{color: C.muted}}>Nothing yet.</div>}
      {items.map((n, i) => {
        const prev = items[i - 1]; const newDay = !prev || prev.at.slice(0, 10) !== n.at.slice(0, 10);
        const problem = ['problem', 'rejected'].includes(n.kind);
        return <React.Fragment key={n.id}>
          {newDay && <Eyebrow style={{textAlign: 'center', margin: '6px 0'}}>{new Date(n.at).toLocaleDateString('en-US', {weekday: 'long', month: 'short', day: 'numeric'})}</Eyebrow>}
          <div style={{display: 'grid', gridTemplateColumns: '28px minmax(0,1fr)', gap: 12}}>
            <div aria-hidden style={{width: 28, height: 28, borderRadius: 8, background: C.ink, color: C.accent, display: 'grid', placeItems: 'center', fontSize: 11}}>b</div>
            <div style={{minWidth: 0, lineHeight: 1.5}}>
              <span style={{color: problem ? C.critical : C.ink}}>{n.text}</span>
              <span style={{color: C.faint, fontSize: 11, marginLeft: 8}}>{clock(n.at)}</span>
              {n.orderId && <a href={n.kind === 'approval' ? '/ramp' : `/orders/${n.orderId}`} style={{color: C.muted, fontSize: 12, marginLeft: 8}}>{n.kind === 'approval' ? 'Open in Ramp' : 'Open'}</a>}
            </div>
          </div>
        </React.Fragment>;
      })}
      <div ref={endRef}/>
    </div>
  </Page>;
}
