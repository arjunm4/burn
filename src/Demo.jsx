import React from 'react';
import {api} from './api.js';
import {C, Button, Chip} from './ui.jsx';

// Demo controls (shown only when the server has a demo world, GET /api/demo): start the scripted
// part entry, and inject the scripted live changes as if the Slack message had just arrived.
// Everything they do goes through the ordinary API; they just save typing on stage.
const box = {border: `1px dashed ${C.line}`, borderRadius: 12, padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12};

export function useDemo() {
  const [demo, setDemo] = React.useState(null);
  const load = React.useCallback(() => api('/demo').then(setDemo).catch(() => setDemo(null)), []);
  React.useEffect(() => { load(); }, [load]);
  return [demo, load];
}

/** On /orders: one click enters the world's scripted part. */
export function DemoStart() {
  const [demo] = useDemo();
  const [busy, setBusy] = React.useState(false); const [error, setError] = React.useState(null);
  if (!demo?.entry) return null;
  async function start() {
    setBusy(true); setError(null);
    try { const {order} = await api('/demo/start', {body: {}}); location.assign(`/orders/${order.id}`); } catch (e) { setError(e.message); setBusy(false); }
  }
  const first = demo.entry.engineer.split(' ')[0];
  return <div style={{...box, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap'}}>
    <Chip>demo</Chip>
    <span style={{color: C.muted, flex: 1}}>{demo.entry.name} ×{demo.entry.fields.quantity} for {first}</span>
    {error && <span role="alert" style={{color: C.critical}}>{error}</span>}
    <Button onClick={start} disabled={busy}>{busy ? 'Starting…' : `Enter it as ${first}`}</Button>
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
    <div style={{display: 'flex', alignItems: 'center', gap: 8}}><Chip>demo</Chip><span style={{color: C.muted}}>Post a Slack message</span></div>
    {demo.liveChanges.map(c => <div key={c.id} style={{display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 10, alignItems: 'center'}}>
      <span style={{whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}><span style={{color: C.muted}}>{c.by}: </span>{c.text}</span>
      <Button onClick={() => inject(c.id)} disabled={!!busy} style={{padding: '5px 10px', fontSize: 12}}>{busy === c.id ? 'Posting…' : c.applied ? 'Again' : 'Post'}</Button>
    </div>)}
    {error && <div role="alert" style={{color: C.critical}}>{error}</div>}
  </div>;
}
