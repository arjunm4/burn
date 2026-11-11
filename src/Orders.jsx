import React from 'react';
import {api, readFileAsBase64} from './api.js';
import {C, Page, StateBadge, Button, Field, Eyebrow, input, money, relTime} from './ui.jsx';
import {DemoStart} from './Demo.jsx';

/** /orders: start a new order (part entry) and see recent ones. */
export default function Orders() {
  const [system, setSystem] = React.useState(null);
  const [orders, setOrders] = React.useState([]);
  const [form, setForm] = React.useState({name: '', note: '', engineer: localStorage.getItem('burn.engineer') || '', fields: {}});
  const [cad, setCad] = React.useState(null);
  const [more, setMore] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);

  const load = React.useCallback(async () => {
    try { const [s, o] = await Promise.all([api('/system'), api('/orders')]); setSystem(s); setOrders(o.orders); } catch (e) { setError(e.message); }
  }, []);
  React.useEffect(() => { load(); const t = setInterval(load, 4000); return () => clearInterval(t); }, [load]);

  async function submit(e) {
    e.preventDefault();
    if (!form.name.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      localStorage.setItem('burn.engineer', form.engineer);
      const body = {...form, cad: cad ? {fileName: cad.name, base64: await readFileAsBase64(cad)} : null};
      const {order} = await api('/orders', {body});
      location.assign(`/orders/${order.id}`);
    } catch (e) { setError(e.message); setBusy(false); }
  }

  const specFields = system?.specFields || [];
  return <Page system={system} data-q-main style={{display: 'grid', gridTemplateColumns: 'minmax(320px, 480px) minmax(0, 1fr)', gap: 56}}>
    <section>
      <div style={{fontSize: 22, letterSpacing: '-.02em', marginBottom: 18}}>What do you need?</div>
      <form onSubmit={submit} style={{display: 'flex', flexDirection: 'column', gap: 12}}>
        <Field label="Part"><input required value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="Hip actuator bracket" style={input}/></Field>
        <Field label="What it's for"><textarea rows={2} value={form.note} onChange={e => setForm({...form, note: e.target.value})} placeholder="The spin test on the hip actuator, before the Nov 24 build" style={{...input, resize: 'vertical'}}/></Field>
        <Field label="CAD"><input type="file" accept=".step,.stp,.STEP,.STP,.stl" onChange={e => setCad(e.target.files[0] || null)} style={{fontSize: 13}}/></Field>
        <Field label="You"><input value={form.engineer} onChange={e => setForm({...form, engineer: e.target.value})} placeholder="Your name" style={input}/></Field>
        {!more && !!specFields.length && <button type="button" onClick={() => setMore(true)} style={{alignSelf: 'flex-start', background: 'transparent', border: 0, color: C.muted, cursor: 'pointer', padding: 0, fontSize: 12, textDecoration: 'underline', textUnderlineOffset: 3}}>Add material, finish, tolerance…</button>}
        {more && <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10}}>
          {specFields.map(f => <Field key={f.key} label={f.label}>
            <input value={form.fields[f.key] ?? ''} onChange={e => setForm({...form, fields: {...form.fields, [f.key]: e.target.value}})} placeholder={f.default != null ? String(f.default) : ''} style={input}/>
          </Field>)}
        </div>}
        {error && <div role="alert" style={{color: C.critical}}>{error}</div>}
        <Button primary disabled={busy || !form.name.trim()}>{busy ? 'Starting…' : 'Start'}</Button>
      </form>
      <div style={{marginTop: 20}}><DemoStart/></div>
    </section>
    <section>
      <Eyebrow style={{display: 'block', paddingBottom: 8}}>Orders</Eyebrow>
      {!orders.length && <div style={{color: C.muted}}>None yet.</div>}
      {orders.map(o => <a key={o.id} href={`/orders/${o.id}`} style={{display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 12, padding: '10px 0', borderTop: `1px solid ${C.hair}`, textDecoration: 'none', color: C.ink}}>
        <span style={{minWidth: 0}}>
          <div style={{whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{o.entry.name}</div>
          <div style={{color: C.muted, fontSize: 12}}>{o.entry.engineer} · {relTime(o.createdAt)}{o.frozen ? ` · ${o.frozen.tier} ${money(o.frozen.priceCents)}` : ''}</div>
        </span>
        <StateBadge state={o.state}/>
      </a>)}
    </section>
  </Page>;
}
