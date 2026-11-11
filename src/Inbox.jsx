import React from 'react';
import {api} from './api.js';
import {C, Header, Chip} from './ui.jsx';

/**
 * /inbox?as=<person>: the Slack-DM-style messages one person gets from Burn as orders move.
 * Newest at the bottom, live over SSE. The engineer sees quotes, questions, placement and the
 * charge; the manager sees "approval needed" with a way into Ramp, and the booked result.
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
      const list = [...engineers.map(name => ({name, role: 'engineer'})), ...extra.map(name => ({name, role: 'asked'})), {name: manager, role: 'manager'}];
      setPeople(list);
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

  const me = people.find(p => p.name === as);
  return <div style={{minHeight: '100vh', fontSize: 13, display: 'flex', flexDirection: 'column'}}>
    <Header crumb={<span style={{display: 'inline-flex', gap: 8, alignItems: 'center'}}>Inbox <Chip tone="ink">simulated</Chip></span>} system={system}/>
    <main style={{flex: 1, padding: '28px 24px 60px', maxWidth: 760, width: '100%', boxSizing: 'border-box', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18}}>
      <div style={{display: 'flex', gap: 14, alignItems: 'baseline', flexWrap: 'wrap'}}>
        <span style={{fontSize: 24, letterSpacing: '-.02em'}}>Messages from Burn</span>
        <span style={{color: C.muted}}>What each person would get as a DM. Stored by Burn; no Slack is connected in the demo.</span>
      </div>
      <div style={{display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap'}}>
        <span style={{fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: C.muted, marginRight: 6}}>Viewing as</span>
        {people.map(p => <button key={p.name} onClick={() => setAs(p.name)} style={{background: p.name === as ? C.ink : '#fff', color: p.name === as ? C.paper : C.ink, border: `1px solid ${p.name === as ? C.ink : C.line}`, borderRadius: 16, padding: '5px 12px', fontSize: 12, cursor: 'pointer'}}>{p.name}<span style={{opacity: .6}}> · {p.role}</span></button>)}
        {!people.length && <span style={{color: C.muted}}>Loading…</span>}
      </div>
      {error && <div role="alert" style={{color: C.critical}}>{error}</div>}

      <div style={{display: 'flex', flexDirection: 'column', gap: 10}}>
        {!items.length && as && <div style={{color: C.muted, padding: '18px 0'}}>Nothing yet for {as}. {me?.role === 'manager' ? 'When an engineer okays an order, the approval request lands here.' : 'Start an order on /orders; the quote and recommendation arrive here.'}</div>}
        {items.map((n, i) => {
          const prev = items[i - 1]; const newDay = !prev || prev.at.slice(0, 10) !== n.at.slice(0, 10);
          const problem = ['problem', 'rejected'].includes(n.kind);
          return <React.Fragment key={n.id}>
            {newDay && <div style={{textAlign: 'center', fontSize: 11, color: C.faint, margin: '6px 0'}}>{new Date(n.at).toLocaleDateString('en-US', {weekday: 'long', month: 'short', day: 'numeric'})}</div>}
            <div style={{display: 'grid', gridTemplateColumns: '32px minmax(0,1fr)', gap: 12}}>
              <div aria-hidden style={{width: 32, height: 32, borderRadius: 8, background: C.ink, color: C.accent, display: 'grid', placeItems: 'center', fontSize: 11, letterSpacing: '.04em'}}>b</div>
              <div style={{minWidth: 0}}>
                <div style={{display: 'flex', gap: 8, alignItems: 'baseline'}}><span style={{fontWeight: 600}}>Burn</span><span style={{color: C.faint, fontSize: 11}}>{new Date(n.at).toLocaleTimeString('en-US', {hour: 'numeric', minute: '2-digit'})}</span><Chip tone={problem ? 'critical' : 'muted'}>{n.kind}</Chip></div>
                <div style={{lineHeight: 1.5, marginTop: 2, color: problem ? C.critical : C.ink}}>{n.text}</div>
                <div style={{display: 'flex', gap: 14, fontSize: 12, marginTop: 4}}>
                  {n.orderId && <a href={`/orders/${n.orderId}`} style={{color: C.muted}}>Open order →</a>}
                  {n.kind === 'approval' && <a href="/ramp" style={{color: C.ink, background: C.accent, border: `1px solid ${C.accent}`, borderRadius: 6, padding: '2px 8px', textDecoration: 'none'}}>Open in Ramp</a>}
                </div>
              </div>
            </div>
          </React.Fragment>;
        })}
        <div ref={endRef}/>
      </div>
    </main>
  </div>;
}
