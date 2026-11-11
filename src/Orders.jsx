import React from 'react';
import {api, readFileAsBase64} from './api.js';
import {C, Header, StateBadge, Button, Field, money, relTime} from './ui.jsx';
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
  return <div style={{minHeight: '100vh', fontSize: 13, display: 'flex', flexDirection: 'column'}}>
    <Header crumb="Orders" system={system}/>
    <main style={{flex: 1, display: 'grid', gridTemplateColumns: 'minmax(320px, 520px) minmax(0, 1fr)', gap: 40, padding: '32px 24px 60px', maxWidth: 1200, width: '100%', boxSizing: 'border-box', margin: '0 auto'}} data-q-main>
      <section>
        <div style={{fontSize: 22, letterSpacing: '-.02em', marginBottom: 6}}>What do you need?</div>
        <div style={{color: C.muted, marginBottom: 18}}>Name the part, say what it's for, attach the CAD. Burn finds the context, gets the Xometry quote and works out which tier is worth it.</div>
        <form onSubmit={submit} style={{display: 'flex', flexDirection: 'column', gap: 12}}>
          <Field label="Part"><input required value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="Hip actuator bracket" style={inputStyle}/></Field>
          <Field label="What it's for"><textarea rows={2} value={form.note} onChange={e => setForm({...form, note: e.target.value})} placeholder="For the spin test on the hip actuator; need it before the Nov 24 build." style={{...inputStyle, resize: 'vertical'}}/></Field>
          <Field label="CAD file (STEP)"><input type="file" accept=".step,.stp,.STEP,.STP,.stl" onChange={e => setCad(e.target.files[0] || null)} style={{fontSize: 13}}/></Field>
          <Field label="You"><input value={form.engineer} onChange={e => setForm({...form, engineer: e.target.value})} placeholder="Your name" style={inputStyle}/></Field>
          <button type="button" onClick={() => setMore(!more)} style={{alignSelf: 'flex-start', background: 'transparent', border: 0, color: C.muted, cursor: 'pointer', padding: 0, textDecoration: 'underline', textUnderlineOffset: 3, fontSize: 12}}>{more ? 'Hide' : 'Add'} technical details now (otherwise Burn asks for what's missing)</button>
          {more && <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10}}>
            {specFields.map(f => <Field key={f.key} label={f.label} hint={f.default != null ? `default: ${f.default}` : 'required'}>
              <input value={form.fields[f.key] ?? ''} onChange={e => setForm({...form, fields: {...form.fields, [f.key]: e.target.value}})} placeholder={f.default != null ? String(f.default) : ''} style={inputStyle}/>
            </Field>)}
          </div>}
          {error && <div role="alert" style={{color: C.critical}}>{error}</div>}
          <Button primary disabled={busy || !form.name.trim()}>{busy ? 'Starting…' : 'Start'}</Button>
        </form>
        <div style={{marginTop: 18}}><DemoStart/></div>
      </section>
      <section>
        <div style={{fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: C.muted, paddingBottom: 8}}>Orders</div>
        {!orders.length && <div style={{color: C.muted}}>No orders yet.</div>}
        {orders.map(o => <a key={o.id} href={`/orders/${o.id}`} style={{display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 12, padding: '10px 0', borderTop: `1px solid ${C.hair}`, textDecoration: 'none', color: C.ink}}>
          <span style={{minWidth: 0}}>
            <div style={{whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{o.entry.name}</div>
            <div style={{color: C.muted, fontSize: 12}}>{o.entry.engineer} · {relTime(o.createdAt)}{o.frozen ? ` · ${o.frozen.tier} ${money(o.frozen.priceCents)}` : o.decision?.recommended ? ` · recommends ${o.decision.recommended.tier}` : ''}</div>
          </span>
          <StateBadge state={o.state}/>
        </a>)}
      </section>
    </main>
  </div>;
}
const inputStyle = {font: 'inherit', fontSize: 13, padding: '8px 10px', border: `1px solid ${C.line}`, borderRadius: 8, background: '#fff', color: C.ink, width: '100%', boxSizing: 'border-box'};
