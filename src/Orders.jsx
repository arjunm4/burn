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
  const [loaded, setLoaded] = React.useState(false);

  const load = React.useCallback(async () => {
    try { const [s, o] = await Promise.all([api('/system'), api('/orders')]); setSystem(s); setOrders(o.orders); setLoaded(true); } catch (e) { setError(e.message); }
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
  return <Page system={system} data-q-main style={{display: 'grid', gridTemplateColumns: 'minmax(0, 480px) minmax(0, 1fr)', gap: '32px 48px', alignContent: 'start'}}>
    <div className="burn-orders-intro">
      <div><span className="burn-kicker">Purchasing workspace</span><h1>Every part, considered.</h1><p>Start a request. Keep the decision and the order together.</p></div>
      <span className="burn-count">{loaded ? `${orders.length} order${orders.length === 1 ? '' : 's'} in your workspace` : 'Loading workspace…'}</span>
    </div>
    <section className="burn-request-column" aria-labelledby="new-request-title">
      <div className="burn-request-card">
      <div className="burn-request-heading"><span className="burn-request-icon" aria-hidden="true">+</span><h2 id="new-request-title">What do you need?</h2></div>
      <form onSubmit={submit} className="burn-request-form">
        <Field label="Part"><input required value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="Hip actuator bracket" style={input}/></Field>
        <Field label="What it's for"><textarea rows={2} value={form.note} onChange={e => setForm({...form, note: e.target.value})} placeholder="The spin test on the hip actuator, before the Nov 24 build" style={{...input, resize: 'vertical'}}/></Field>
        <Field label="CAD file"><span className="burn-upload"><input type="file" accept=".step,.stp,.STEP,.STP,.stl" onChange={e => setCad(e.target.files[0] || null)}/><small>STEP, STP or STL · You can add this later.</small></span></Field>
        <Field label="Requested by"><input autoComplete="name" value={form.engineer} onChange={e => setForm({...form, engineer: e.target.value})} placeholder="Your name" style={input}/></Field>
        {!!specFields.length && <button type="button" className="burn-spec-toggle" aria-expanded={more} aria-controls="request-spec-fields" onClick={() => setMore(!more)}><span>Material, finish & other specifications</span><span aria-hidden="true">{more ? '−' : '+'}</span></button>}
        {more && <div id="request-spec-fields" className="burn-spec-grid">
          {specFields.map(f => <Field key={f.key} label={f.label}>
            <input value={form.fields[f.key] ?? ''} onChange={e => setForm({...form, fields: {...form.fields, [f.key]: e.target.value}})} placeholder={f.default != null ? String(f.default) : ''} style={input}/>
          </Field>)}
        </div>}
        {error && <div role="alert" style={{color: C.critical}}>{error}</div>}
        <Button primary className="burn-submit" disabled={busy || !form.name.trim()}><span>{busy ? 'Starting request…' : 'Start request'}</span><span aria-hidden="true">↗</span></Button>
      </form>
      </div>
      <div className="burn-demo"><DemoStart/></div>
    </section>
    <section aria-labelledby="recent-orders-title">
      <div className="burn-orders-heading"><h2 id="recent-orders-title">Your orders</h2><span>Updated as work progresses</span></div>
      {!orders.length && <div className="burn-empty" role="status"><span className="burn-empty-icon" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z M4 7.5l8 4.5 8-4.5 M12 12v9 M8 5.25l8 4.5"/></svg></span><h3>{loaded ? 'A place for every request' : 'Loading your orders…'}</h3><p>{loaded ? 'Your quotes, decisions and order updates will appear here once you start.' : 'Checking the latest activity in your workspace.'}</p></div>}
      {!!orders.length && <div className="burn-order-list">{orders.map(o => <a key={o.id} href={`/orders/${o.id}`} className="burn-order-row">
        <span className="burn-part-icon" aria-hidden="true">◇</span>
        <span style={{minWidth: 0}}>
          <div className="burn-order-name">{o.entry.name}</div>
          <div className="burn-order-meta">{[o.entry.engineer, relTime(o.createdAt), o.frozen ? `${o.frozen.tier} · ${money(o.frozen.priceCents)}` : null].filter(Boolean).join(' · ')}</div>
        </span>
        <StateBadge state={o.state}/>
        <span className="burn-order-arrow" aria-hidden="true">›</span>
      </a>)}</div>}
      <p className="burn-orders-footnote">Open an order to see the reasoning, sources and next step.</p>
    </section>
  </Page>;
}
