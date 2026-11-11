import React from 'react';
import {api, subscribe, readFileAsBase64} from './api.js';
import {C, Page, StateBadge, Button, Field, Section, Fold, Chip, Rows, Eyebrow, input, money, day, clock, relTime} from './ui.jsx';
import BrowserPanel from './BrowserPanel.jsx';
import {DemoLiveChanges} from './Demo.jsx';

// What the live feed says for each event while Burn works. Events without a line are not shown.
const FEED = {
  'agent.reading': 'Reading the team\'s records…',
  'agent.search': e => `Searching for “${e.query}”`,
  'agent.claims': e => e.summary, 'agent.wrote': 'Writing the recommendation…', 'agent.reply': e => e.text,
  'agent.fallback': 'Agent unavailable; using rules',
  'resolve.started': 'Reading the request…', 'context.built': e => (e.context?.milestoneLabel ? `Feeds ${e.context.milestoneLabel}` : 'Found the related context'),
  'quote.started': 'Quoting on Xometry…', 'quote.captured': 'Quote captured', 'answer.received': 'Re-solving…',
  'ramp.requested': 'Sent to Ramp', 'ramp.approved': 'Approved', 'card.issued': 'Card issued', 'placement.notice': e => e.text,
  'placement.begun': 'Verifying every field on Xometry…', 'placement.succeeded': 'Order placed',
  'placement.blocked': e => `Not placed: ${e.result?.mismatches?.map(m => m.field).join(', ')} changed`, 'placement.failed': e => `Placement failed: ${e.result?.reason}`,
  'placement.unknown': 'Vendor response lost; checking their records', 'placement.unresolved': e => e.text,
};
const HISTORY = {
  'order.created': 'Entered', 'decision.made': 'Recommended', 'spec.gap': 'Asked for details', 'order.frozen': 'Okayed', 'ramp.request.created': 'Sent to Ramp', 'ramp.requested': 'Requested in Ramp',
  'ramp.approval.recorded': 'Approved', 'ramp.approved': 'Approved', 'ramp.rejected': 'Rejected', 'card.issued': 'Card issued', 'placement.started': 'Placing', 'placement.succeeded': 'Placed',
  'charge.cleared': 'Charged', 'booked': 'Booked', 'placement.interrupted': 'Placement interrupted', 'placement.cancelled': 'Placement cancelled', 'approval.stale': 'Approval stale', 'placement.invalidated': 'Needs re-approval',
};
const WORKING = ['entered', 'resolving', 'placing'];
const PURCHASE_STATES = ['specified', 'requested', 'approved', 'placing', 'placed', 'placement_unknown', 'invalidated', 'rejected', 'delivered', 'in_use', 'unresolved'];

export default function Order({id}) {
  const [order, setOrder] = React.useState(null);
  const [events, setEvents] = React.useState([]);
  const [live, setLive] = React.useState(null);
  const [system, setSystem] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);

  const refresh = React.useCallback(async () => {
    try { const r = await api(`/orders/${id}`); setOrder(r.order); setEvents(r.events); setError(null); } catch (e) { setError(e.message); }
  }, [id]);
  React.useEffect(() => {
    api('/system').then(setSystem).catch(() => {});
    refresh();
    const off = subscribe(id, e => {
      if (e.order) setOrder(e.order);
      const line = FEED[e.type]; if (line) setLive(typeof line === 'function' ? line(e) : line);
      if (['placement.succeeded', 'booked', 'ramp.approved', 'placement.unknown', 'recommended'].includes(e.type)) refresh();
    });
    return off;
  }, [id, refresh]);

  async function act(path, body) {
    if (busy) return; setBusy(true); setError(null);
    try { const r = await api(path, {body: {expectedRevision: order.revision, ...body}}); if (r.order) setOrder(r.order); await refresh(); }
    catch (e) { setError(e.message); if (e.status === 409) refresh(); }
    finally { setBusy(false); }
  }

  if (!order) return <Page system={system}><span style={{color: C.muted}}>{error || 'Loading…'}</span></Page>;
  const working = WORKING.includes(order.state);
  const ctx = order.context || {};
  const d = order.decision;
  const problem = live && /blocked|failed|lost|unavailable/i.test(live);

  return <Page system={system} width={1240} data-q-main style={{display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 40}}>
    <div style={{display: 'flex', flexDirection: 'column', gap: 24, minWidth: 0}}>
      <div>
        <div style={{display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap'}}>
          <span style={{fontSize: 24, letterSpacing: '-.02em'}}>{order.entry.name}</span>
          <StateBadge state={order.state}/>
          <span style={{color: C.muted}}>{order.entry.engineer} · {relTime(order.createdAt)}</span>
        </div>
        {order.entry.note && <div style={{color: C.muted, marginTop: 4}}>{order.entry.note}</div>}
      </div>
      {error && <div role="alert" style={{color: C.critical}}>{error}</div>}

      {(working || problem) && <div aria-live="polite" style={{display: 'flex', gap: 10, alignItems: 'center', color: problem ? C.critical : C.muted}}>
        <span style={{width: 6, height: 6, borderRadius: '50%', background: problem ? C.critical : C.ink, animation: working ? 'pulse 1s infinite' : 'none'}}/>
        <span>{live || 'Working…'}</span>
      </div>}

      {order.state === 'needs_answer' && order.question && <QuestionPanel order={order} act={act} busy={busy}/>}
      {d && order.quote && <Comparison order={order} act={act} busy={busy}/>}
      {PURCHASE_STATES.includes(order.state) && <Purchase order={order} act={act} busy={busy} mock={system?.ramp?.mode === 'mock'} refresh={refresh}/>}
      <BrowserPanel orderId={order.id} state={order.state}/>
      <DemoLiveChanges order={order}/>
    </div>

    <aside style={{display: 'flex', flexDirection: 'column', gap: 24, minWidth: 0}}>
      <Section title="Context" right={ctx.milestoneLabel}>
        {ctx.agent?.summary && <div style={{fontSize: 12, lineHeight: 1.45, paddingLeft: 10, borderLeft: `2px solid ${C.accent}`}}>{ctx.agent.summary}</div>}
        {ctx.assumptions?.length
          ? <ul style={{margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 5, lineHeight: 1.4}}>{ctx.assumptions.map((a, i) => <li key={i}>{a.text}{a.ageDays > 0 && <span style={{color: C.faint}}> · {a.ageDays}d ago</span>}</li>)}</ul>
          : <span style={{color: C.muted}}>{working ? 'Reading…' : 'Nothing related found.'}</span>}
        {ctx.related?.length > 0 && <Fold title={`${ctx.related.length} source${ctx.related.length === 1 ? '' : 's'}`}>
          <div style={{display: 'flex', flexDirection: 'column', gap: 8}}>
            {ctx.related.map(r => <blockquote key={r.id} style={{margin: 0, padding: '4px 10px', borderLeft: `2px solid ${C.line}`, fontSize: 12, lineHeight: 1.4}}>
              {r.text.length > 160 ? r.text.slice(0, 160) + '…' : r.text}
              <div style={{color: C.muted, fontSize: 11, marginTop: 2}}>{r.author || r.source} · {r.channel} · {day(r.at)}</div>
            </blockquote>)}
          </div>
        </Fold>}
      </Section>

      <Section title="Spec" right={order.entry.cadFileName}>
        {order.spec?.length
          ? <Rows gap={4} rows={order.spec.map(f => [f.key, f.value ?? <span style={{color: C.critical}}>missing</span>])}/>
          : <span style={{color: C.muted}}>Not resolved yet.</span>}
      </Section>

      {!!order.exchange?.length && <Section title="Discussion">
        {order.exchange.map((s, i) => <div key={i} style={{fontSize: 12, lineHeight: 1.45, ...(s.by === 'Burn' ? {paddingLeft: 10, borderLeft: `2px solid ${C.accent}`} : {})}}><span style={{color: C.muted}}>{s.by}: </span>{s.text}</div>)}
      </Section>}

      <Fold title="History">
        <div style={{display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12, color: C.muted}}>
          {events.filter(e => HISTORY[e.event]).map((e, i) => <div key={i}><span style={{color: C.faint}}>{clock(e.at)}</span> · {HISTORY[e.event]}</div>)}
        </div>
      </Fold>
    </aside>
  </Page>;
}

function QuestionPanel({order, act, busy}) {
  const q = order.question;
  const [values, setValues] = React.useState({});
  const [cad, setCad] = React.useState(null);
  const [text, setText] = React.useState('');
  const submit = async e => {
    e.preventDefault();
    if (q.kind === 'spec') return act(`/orders/${order.id}/answer`, {fields: values});
    if (q.kind === 'cad') return act(`/orders/${order.id}/answer`, {cad: cad ? {fileName: cad.name, base64: await readFileAsBase64(cad)} : null});
    if (q.kind === 'demand') return act(`/orders/${order.id}/answer`, {demand: text});
    if (q.kind === 'fact') return act(`/orders/${order.id}/answer`, {fact: {nodeId: q.nodeId, date: text}});
  };
  const blocking = ['ramp', 'stale'].includes(q.kind);
  return <form onSubmit={submit} style={{border: `1px solid ${blocking ? C.critical : C.ink}`, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 10, background: '#fff'}}>
    <div style={{fontSize: 15, color: blocking ? C.critical : C.ink}}>{q.text}</div>
    {q.kind === 'fact' && q.owner && <div style={{color: C.muted, fontSize: 12}}>{q.owner} would know.</div>}
    {q.kind === 'spec' && <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10}}>{q.fields.map(k => <Field key={k} label={k}><input required value={values[k] || ''} onChange={e => setValues({...values, [k]: e.target.value})} style={input}/></Field>)}</div>}
    {q.kind === 'cad' && <input type="file" accept=".step,.stp,.stl" required onChange={e => setCad(e.target.files[0])}/>}
    {q.kind === 'demand' && <input required value={text} onChange={e => setText(e.target.value)} placeholder="e.g. the spin test before the Nov 24 build" style={input}/>}
    {q.kind === 'fact' && <input type="date" required value={text} onChange={e => setText(e.target.value)} style={{...input, width: 'auto'}}/>}
    {!blocking && <Button primary disabled={busy} style={{alignSelf: 'flex-start'}}>Answer</Button>}
  </form>;
}

const COLS = 'minmax(0,1.4fr) 1fr 1fr 1fr .8fr 1fr auto';
function Comparison({order, act, busy}) {
  const d = order.decision, q = order.quote;
  const rec = d.recommended?.tier;
  const [argument, setArgument] = React.useState('');
  const canOkay = ['recommended', 'needs_answer'].includes(order.state);
  const cell = {fontVariantNumeric: 'tabular-nums'};
  return <div style={{display: 'flex', flexDirection: 'column', gap: 14}}>
    <div style={{fontSize: 17, lineHeight: 1.4, letterSpacing: '-.01em'}}>{d.text}</div>
    <div style={{border: `1px solid ${C.line}`, borderRadius: 12, overflow: 'hidden', background: '#fff'}}>
      <div style={{display: 'grid', gridTemplateColumns: COLS, gap: 8, padding: '8px 14px', borderBottom: `1px solid ${C.line}`}}>
        {['Tier', 'Price', 'Part ready', order.context?.milestoneLabel || 'Milestone', 'Gained', 'Break-even', ''].map((h, i) => <Eyebrow key={i} style={{letterSpacing: '.08em'}}>{h}</Eyebrow>)}
      </div>
      {d.options.map(o => {
        const qo = q.options.find(x => x.tier === o.tier) || {};
        const isRec = o.tier === rec, chosen = order.frozen?.tier === o.tier, dominated = d.dominated?.includes(o.tier) && !isRec;
        return <div key={o.tier} style={{display: 'grid', gridTemplateColumns: COLS, gap: 8, padding: '12px 14px', alignItems: 'center', borderTop: `1px solid ${C.hair}`, background: isRec || chosen ? C.paper : '#fff', opacity: o.admissible ? 1 : .5}}>
          <span style={{display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap'}}>{o.tier}{chosen ? <Chip tone="ink">okayed</Chip> : isRec ? <Chip tone="ink">recommended</Chip> : null}{!o.admissible && <Chip tone="critical">{o.why}</Chip>}</span>
          <span style={cell}>{money(qo.priceCents)}{o.extraCents > 0 && <span style={{color: C.muted}}> +{money(o.extraCents)}</span>}</span>
          <span style={cell}>{day(qo.readyOn)}</span>
          <span style={{...cell, color: o.finishOn ? C.ink : C.muted}}>{o.finishOn ? day(o.finishOn) : 'unknown'}</span>
          <span style={{...cell, color: dominated ? C.muted : C.ink}}>{o.deltaDays == null ? '—' : o.deltaDays > 0 ? `+${o.deltaDays}d` : '0'}</span>
          <span style={{...cell, color: C.muted}}>{o.breakEvenCentsPerDay ? `${money(o.breakEvenCentsPerDay)}/day` : '—'}</span>
          <span>{canOkay && o.admissible && <Button primary={isRec} disabled={busy} onClick={() => act(`/orders/${order.id}/okay`, {tier: o.tier})}>{isRec ? 'Okay' : 'Choose'}</Button>}</span>
        </div>;
      })}
    </div>
    {(q.cutoff || q.validUntil) && <div style={{color: C.muted, fontSize: 12, marginTop: -6}}>{[q.cutoff && `Vendor cutoff ${clock(q.cutoff)} today`, q.validUntil && `quote valid until ${day(q.validUntil)}`].filter(Boolean).join(' · ')}</div>}
    {canOkay && <form onSubmit={e => { e.preventDefault(); act(`/orders/${order.id}/argue`, {text: argument}); setArgument(''); }} style={{display: 'flex', gap: 8}}>
      <input value={argument} onChange={e => setArgument(e.target.value)} placeholder="Disagree? Tell Burn why, e.g. the motor actually lands on the 21st" style={input}/>
      <Button disabled={busy || !argument.trim()}>Send</Button>
    </form>}
  </div>;
}

function Purchase({order, act, busy, mock, refresh}) {
  const r = order.ramp || {}, v = order.vendorOrder, f = order.frozen;
  const sim = async (what, body) => { await api(`/ramp/simulate/${what}`, {body}); await refresh(); };
  const simAction = order.state === 'requested' ? 'approve' : order.state === 'placed' && order.paymentState === 'issued' ? 'charge' : null;
  return <Section title="Purchase">
    <div style={{border: `1px solid ${C.line}`, borderRadius: 12, padding: 14, background: '#fff', display: 'flex', flexDirection: 'column', gap: 12}}>
      <Rows rows={[
        ['Okayed', `${f?.tier} · ${money(f?.priceCents)}`],
        ['Ramp', r.requestId ? r.approvalStatus.toLowerCase() : 'not requested'],
        r.cardId && ['Card', `•••• ${r.cardLast4 || ''} · ${order.paymentState}`],
        v?.vendorOrderId && ['Xometry', `${v.vendorOrderId} · ready ${day(v.promisedOn)}`],
        order.bookingState !== 'none' && ['Booking', order.bookingState],
      ]}/>
      {order.question && ['stale', 'ramp'].includes(order.question.kind) && <div style={{color: C.critical}}>{order.question.text}</div>}
      {order.state === 'placement_unknown' && <div style={{display: 'flex', gap: 10, alignItems: 'center', color: C.critical}}>The vendor's response was lost. <Button disabled={busy} onClick={() => act(`/orders/${order.id}/reconcile`, {})}>Check vendor records</Button></div>}
      {order.state === 'approved' && <div style={{display: 'flex', gap: 10, alignItems: 'center'}}><span style={{color: C.muted}}>Approved; not yet placed.</span><Button disabled={busy} onClick={() => act(`/orders/${order.id}/place`, {})}>Place now</Button></div>}
      {mock && simAction && <div style={{display: 'flex', gap: 8, alignItems: 'center', borderTop: `1px solid ${C.hair}`, paddingTop: 12}}>
        <Chip>demo</Chip>
        {simAction === 'approve' && <><Button disabled={busy} onClick={() => sim('approve', {requestId: r.requestId, orderId: order.id})}>Manager approves</Button><Button disabled={busy} onClick={() => sim('reject', {requestId: r.requestId, orderId: order.id})}>Rejects</Button></>}
        {simAction === 'charge' && <Button disabled={busy} onClick={() => sim('charge', {orderId: order.id})}>Xometry charges the card</Button>}
      </div>}
    </div>
  </Section>;
}
