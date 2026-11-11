import React from 'react';
import {api} from './api.js';
import {C, Button, Chip} from './ui.jsx';

// Demo controls (shown only when the server has a demo world, GET /api/demo): start the scripted
// part entry, and inject the scripted live changes as if the Slack message had just arrived.
// Everything they do goes through the ordinary API; they just save typing on stage.
const box = {border: `1px dashed ${C.line}`, borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12};

export function useDemo() {
  const [demo, setDemo] = React.useState(null);
  const load = React.useCallback(() => api('/demo').then(setDemo).catch(() => setDemo(null)), []);
  React.useEffect(() => { load(); }, [load]);
  return [demo, load];
}

/** On /orders: one click enters the world's scripted part (its CAD file stands in for a real STEP). */
export function DemoStart() {
  const [demo] = useDemo();
  const [busy, setBusy] = React.useState(false); const [error, setError] = React.useState(null);
  if (!demo?.entry) return null;
  async function start() {
    setBusy(true); setError(null);
    try { const {order} = await api('/demo/start', {body: {}}); location.assign(`/orders/${order.id}`); } catch (e) { setError(e.message); setBusy(false); }
  }
  return <div style={box}>
    <div style={{display: 'flex', alignItems: 'center', gap: 8}}><Chip>demo</Chip><span style={{color: C.muted}}>{demo.world} · clock {new Date(demo.now).toLocaleString('en-US', {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles'})} PT{demo.anchored ? '' : ' (real time)'}</span></div>
    <div><strong>{demo.entry.engineer}</strong> enters <strong>{demo.entry.name}</strong> ({demo.entry.partNumber} rev {demo.entry.fields.revision}, ×{demo.entry.fields.quantity}): “{demo.entry.note}”</div>
    {error && <div role="alert" style={{color: C.critical}}>{error}</div>}
    <div><Button primary onClick={start} disabled={busy}>{busy ? 'Starting…' : 'Enter it as Owen'}</Button></div>
  </div>;
}

/** On /orders/:id: the scripted live changes; each posts a Slack message into the ingest and re-solves open orders. */
export function DemoLiveChanges({order}) {
  const [demo, reload] = useDemo();
  const [busy, setBusy] = React.useState(null); const [error, setError] = React.useState(null);
  if (!demo?.liveChanges?.length || !['recommended', 'needs_answer', 'resolving'].includes(order.state)) return null;
  async function inject(id) {
    setBusy(id); setError(null);
    try { await api('/demo/live-change', {body: {id}}); await reload(); } catch (e) { setError(e.message); } finally { setBusy(null); }
  }
  return <div style={box}>
    <div style={{display: 'flex', alignItems: 'center', gap: 8}}><Chip>demo</Chip><span style={{color: C.muted}}>Live changes: a message lands in Slack and Burn re-reads the world.</span></div>
    {demo.liveChanges.map(c => <div key={c.id} style={{display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 10, alignItems: 'center'}}>
      <div><span style={{color: C.muted}}>#{c.channel} · {c.by}:</span> {c.text}</div>
      <Button onClick={() => inject(c.id)} disabled={!!busy}>{busy === c.id ? 'Posting…' : c.applied ? 'Post again' : 'Post'}</Button>
    </div>)}
    {error && <div role="alert" style={{color: C.critical}}>{error}</div>}
  </div>;
}
