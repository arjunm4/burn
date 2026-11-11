import React from 'react';
import {api, readFileAsBase64} from './api.js';
import {C, Page, StateBadge, Button, Field, Fold, Eyebrow, input, money, relTime, syncClock} from './ui.jsx';
import {DemoStart} from './Demo.jsx';

/**
 * /orders: the demo's start. One question, the scripted part entry front and centre, the manual
 * form folded away, and the orders so far as clean rows.
 */
export default function Orders() {
  const [system, setSystem] = React.useState(null);
  const [orders, setOrders] = React.useState([]);
  const [form, setForm] = React.useState({name: '', note: '', engineer: localStorage.getItem('burn.engineer') || '', fields: {}});
  const [cad, setCad] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);

  const load = React.useCallback(async () => {
    try { const [s, o] = await Promise.all([api('/system'), api('/orders')]); syncClock(s.now); setSystem(s); setOrders(o.orders || []); } catch (e) { setError(e.message); }
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
  const recent = orders.slice().sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
  return <Page system={system} width={760} style={{display: 'flex', flexDirection: 'column', gap: 28}}>
    <section style={{display: 'flex', flexDirection: 'column', gap: 16}}>
      <div style={{fontSize: 30, letterSpacing: '-.02em', lineHeight: 1.15}}>What do you need?</div>
      <div style={{color: C.muted, fontSize: 14, marginTop: -6}}>Name the part. Burn finds what it's for, gets the quote, and works out which lead time is worth paying for.</div>
      <div style={{border: `1px solid ${C.line}`, borderRadius: 12, background: '#fff', padding: 8, fontSize: 14}}>
        <DemoStart/>
      </div>
      <div style={{border: `1px solid ${C.line}`, borderRadius: 12, background: '#fff', padding: '14px 18px'}}>
        <Fold title="Enter a part by hand">
          <form onSubmit={submit} style={{display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 4}}>
            <Field label="Part"><input required value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="Hip actuator bracket" style={input}/></Field>
            <Field label="What it's for"><textarea rows={2} value={form.note} onChange={e => setForm({...form, note: e.target.value})} placeholder="The spin test on the hip actuator, before the Nov 24 build" style={{...input, resize: 'vertical'}}/></Field>
            <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12}}>
              <Field label="CAD"><input type="file" accept=".step,.stp,.STEP,.STP,.stl" onChange={e => setCad(e.target.files[0] || null)} style={{fontSize: 13}}/></Field>
              <Field label="You"><input value={form.engineer} onChange={e => setForm({...form, engineer: e.target.value})} placeholder="Your name" style={input}/></Field>
            </div>
            {!!specFields.length && <Fold title="Material, finish, tolerance…">
              <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10}}>
                {specFields.map(f => <Field key={f.key} label={f.label}>
                  <input value={form.fields[f.key] ?? ''} onChange={e => setForm({...form, fields: {...form.fields, [f.key]: e.target.value}})} placeholder={f.default != null ? String(f.default) : ''} style={input}/>
                </Field>)}
              </div>
            </Fold>}
            {error && <div role="alert" style={{color: C.critical}}>{error}</div>}
            <Button primary disabled={busy || !form.name.trim()} style={{alignSelf: 'flex-start'}}>{busy ? 'Starting…' : 'Start'}</Button>
          </form>
        </Fold>
      </div>
    </section>

    <section style={{display: 'flex', flexDirection: 'column', gap: 10}}>
      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'baseline'}}>
        <Eyebrow>Orders</Eyebrow>
        {!!recent.length && <span style={{fontSize: 12, color: C.muted}}>{recent.length}</span>}
      </div>
      {!recent.length && <div style={{color: C.muted}}>None yet.</div>}
      {!!recent.length && <div style={{border: `1px solid ${C.line}`, borderRadius: 12, background: '#fff', overflow: 'hidden'}}>
        {recent.map((o, i) => <a key={o.id} href={`/orders/${o.id}`} style={{display: 'grid', gridTemplateColumns: 'minmax(0,1.8fr) 1fr auto auto', gap: 14, alignItems: 'center', padding: '12px 16px', borderTop: i ? `1px solid ${C.hair}` : 0, textDecoration: 'none', color: C.ink}}>
          <span style={{minWidth: 0}}>
            <div style={{whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 14}}>{o.entry?.name}</div>
            {o.context?.milestoneLabel && <div style={{color: C.muted, fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>for {o.context.milestoneLabel}</div>}
          </span>
          <span style={{color: C.muted, fontSize: 12}}>{o.entry?.engineer}{o.createdAt ? ` · ${relTime(o.createdAt)}` : ''}</span>
          <span style={{fontSize: 13, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', color: o.frozen ? C.ink : C.muted}}>{decidedLabel(o)}</span>
          <StateBadge state={o.state}/>
        </a>)}
      </div>}
    </section>
  </Page>;
}

/** "Expedited $3,900" once the engineer has okayed a tier; the recommendation before that; nothing earlier. */
function decidedLabel(o) {
  if (o.frozen) return `${o.frozen.tier} ${money(o.frozen.priceCents)}`;
  const rec = o.decision?.recommended;
  if (rec?.tier) { const opt = o.quote?.options?.find(x => x.tier === rec.tier); return `${rec.tier}${opt?.priceCents != null ? ` ${money(opt.priceCents)}` : ''}`; }
  return '';
}
