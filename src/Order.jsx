import React from 'react';
import {api, subscribe, readFileAsBase64} from './api.js';
import {C, Header, StateBadge, Button, Field, Section, Chip, money, day, relTime, STATE_LABEL} from './ui.jsx';
import BrowserPanel from './BrowserPanel.jsx';
import {DemoLiveChanges} from './Demo.jsx';

const FEED = {
  'agent.reading': e => `Burn is reading the team's records${e.model ? ` (${e.model})` : ''}…`,
  'agent.search': e => `Searched ${e.tool === 'calendar' ? 'the calendar' : e.source ? e.source : 'Slack, Jira and notes'} for “${e.query}” · ${e.hits} hit${e.hits === 1 ? '' : 's'}${e.channels?.length ? ` in ${e.channels.join(', ')}` : ''}`,
  'agent.claims': e => `Understood: ${e.summary}`, 'agent.wrote': 'Wrote the recommendation', 'agent.reply': e => `Burn: “${e.text}”`,
  'agent.fallback': e => `Agent unavailable at ${e.stage} (${e.reason}); using rules`,
  'order.entered': 'Order entered', 'resolve.started': 'Reading the request', 'context.built': e => `Found ${e.context?.related?.length ?? 0} related message${e.context?.related?.length === 1 ? '' : 's'}${e.context?.milestoneLabel ? ` · feeds ${e.context.milestoneLabel}` : ''}`,
  'question': e => `Needs an answer: ${e.question?.text || ''}`, 'quote.started': 'Quoting on Xometry', 'quote.captured': e => `Quote captured · ${e.quote?.options?.length} tiers`,
  'recommended': 'Recommendation ready', 'answer.received': 'Answer received, re-solving', 'exchange.added': e => `You: “${e.statement?.text}”`, 'order.frozen': 'Order frozen',
  'ramp.requested': 'Sent to Ramp for approval', 'ramp.request.failed': 'Ramp request failed', 'ramp.approved': 'Approved in Ramp', 'ramp.rejected': 'Rejected in Ramp', 'approval.stale': 'Approval was for an older version',
  'card.issued': 'Ramp card issued (Xometry only, exact amount)', 'card.failed': 'Card could not be issued', 'placement.notice': e => e.text, 'placement.begun': 'Verifying every field on Xometry…',
  'placement.succeeded': 'Order placed', 'placement.blocked': e => `Not placed: ${e.result?.mismatches?.map(m => m.field).join(', ')} changed`, 'placement.failed': e => `Placement failed: ${e.result?.reason}`,
  'placement.unknown': 'Vendor response lost; checking their records', 'placement.reconciled': 'Order found in vendor records', 'placement.unresolved': e => e.text, 'placement.invalidated': 'Needs re-approval',
  'booked': 'Receipt, memo and project code attached in Ramp', 'booking.failed': 'Booking failed; will retry',
  // Store audit event names (history view).
  'order.created': 'Order created', 'decision.made': 'Decision made', 'spec.gap': 'Missing details asked for', 'ramp.request.created': 'Ramp request created', 'ramp.approval.recorded': 'Approval recorded',
  'placement.started': 'Placement started', 'charge.cleared': 'Charge cleared in Ramp', 'placement.interrupted': 'Placement interrupted by a restart; reconcile before any retry', 'placement.cancelled': 'Placement cancelled',
};

export default function Order({id}) {
  const [order, setOrder] = React.useState(null);
  const [events, setEvents] = React.useState([]);
  const [feed, setFeed] = React.useState([]);
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
      const label = FEED[e.type]; if (label) setFeed(f => [...f, {at: new Date().toISOString(), text: typeof label === 'function' ? label(e) : label, type: e.type}]);
      if (['placement.succeeded', 'booked', 'ramp.approved', 'placement.unknown'].includes(e.type)) refresh();
    });
    return off;
  }, [id, refresh]);

  async function act(path, body) {
    if (busy) return; setBusy(true); setError(null);
    try { const r = await api(path, {body: {expectedRevision: order.revision, ...body}}); if (r.order) setOrder(r.order); await refresh(); }
    catch (e) { setError(e.message); if (e.status === 409) refresh(); }
    finally { setBusy(false); }
  }

  if (!order) return <div style={{minHeight: '100vh', fontSize: 13}}><Header crumb="Order" system={system}/><main style={{padding: 40, color: C.muted}}>{error || 'Loading…'}</main></div>;
  const working = ['entered', 'resolving', 'placing'].includes(order.state);
  const ctx = order.context || {};
  const d = order.decision;
  const mock = system?.ramp?.mode === 'mock';

  return <div style={{minHeight: '100vh', fontSize: 13, display: 'flex', flexDirection: 'column'}}>
    <Header crumb={order.entry.name} system={system}/>
    <main style={{flex: 1, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 340px', gap: 32, padding: '28px 24px 60px', maxWidth: 1240, width: '100%', boxSizing: 'border-box', margin: '0 auto'}} data-q-main>
      <div style={{display: 'flex', flexDirection: 'column', gap: 28, minWidth: 0}}>
        <div style={{display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap'}}>
          <span style={{fontSize: 24, letterSpacing: '-.02em'}}>{order.entry.name}</span>
          <StateBadge state={order.state}/>
          <span style={{color: C.muted}}>{order.entry.engineer} · {relTime(order.createdAt)}{order.entry.cadFileName ? ` · ${order.entry.cadFileName}` : ' · no CAD yet'}</span>
        </div>
        {order.entry.note && <div style={{color: C.muted, marginTop: -18}}>“{order.entry.note}”</div>}
        {error && <div role="alert" style={{color: C.critical}}>{error}</div>}

        {/* Live progress */}
        <div aria-live="polite" style={{display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, color: C.muted}}>
          {(feed.length ? feed : events.map(e => ({at: e.at, text: FEED[e.event] ? (typeof FEED[e.event] === 'function' ? FEED[e.event](e.detail || {}) : FEED[e.event]) : e.event, type: e.event}))).slice(-12).map((f, i, arr) => <div key={i} style={{display: 'flex', gap: 10, alignItems: 'center'}}>
            <span style={{width: 6, height: 6, borderRadius: '50%', background: C.ink, opacity: i === arr.length - 1 && working ? .4 : 1, animation: i === arr.length - 1 && working ? 'pulse 1s infinite' : 'none'}}/>
            <span style={{color: /blocked|failed|unknown|stale|invalidated|rejected/.test(f.type) ? C.critical : C.muted}}>{f.text}</span>
          </div>)}
        </div>

        {order.state === 'needs_answer' && order.question && <QuestionPanel order={order} act={act} busy={busy}/>}
        {d && order.quote && <Comparison order={order} act={act} busy={busy}/>}
        <DemoLiveChanges order={order}/>
        <BrowserPanel orderId={order.id} state={order.state}/>
        {['specified', 'requested', 'approved', 'placing', 'placed', 'placement_unknown', 'invalidated', 'rejected', 'delivered', 'in_use', 'unresolved'].includes(order.state) && <RampPanel order={order} act={act} busy={busy} mock={mock} refresh={refresh}/>}
      </div>

      <aside style={{display: 'flex', flexDirection: 'column', gap: 24, minWidth: 0}}>
        <Section title="Spec" right={order.specHash ? <span title={order.specHash}>frozen {order.specHash.slice(0, 8)}</span> : null}>
          <div style={{display: 'grid', gridTemplateColumns: 'max-content minmax(0,1fr)', columnGap: 14, rowGap: 6}}>
            {(order.spec || []).map(f => <React.Fragment key={f.key}>
              <span style={{color: C.muted}}>{f.key}</span>
              <span style={{display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap'}}>{f.value ?? <span style={{color: C.critical}}>missing</span>} <Chip tone={f.provenance ? 'muted' : 'critical'}>{f.provenance || 'gap'}</Chip></span>
            </React.Fragment>)}
            {!order.spec?.length && <span style={{color: C.muted, gridColumn: '1 / -1'}}>Not resolved yet.</span>}
          </div>
        </Section>
        <Section title="Context" right={ctx.milestoneLabel || null}>
          {ctx.assumptions?.length ? <ul style={{margin: 0, paddingLeft: 16, color: C.muted, display: 'flex', flexDirection: 'column', gap: 4}}>{ctx.assumptions.map((a, i) => <li key={i}>{a.text}{a.ageDays != null && <span style={{color: C.faint}}> · {a.ageDays === 0 ? 'today' : `${a.ageDays}d ago`}</span>}</li>)}</ul> : <span style={{color: C.muted}}>No related context found yet.</span>}
          {ctx.related?.slice(0, 6).map(r => <blockquote key={r.id} style={{margin: 0, padding: '6px 10px', borderLeft: `2px solid ${C.ink}`, background: C.paper, borderRadius: 4, fontSize: 12}}>
            <div style={{lineHeight: 1.4}}>{r.text.length > 220 ? r.text.slice(0, 220) + '…' : r.text}</div>
            <div style={{color: C.muted, fontSize: 11, marginTop: 3}}>{r.author || r.source} · {r.channel} · {day(r.at)}{r.nameHits > 0 && ' · names the part'}</div>
          </blockquote>)}
          {ctx.related?.length > 6 && <span style={{color: C.faint, fontSize: 11}}>+{ctx.related.length - 6} more related messages</span>}
        </Section>
        {!!order.exchange?.length && <Section title="Discussion">
          {order.exchange.map((s, i) => <div key={i} style={{fontSize: 12, ...(s.by === 'Burn' ? {paddingLeft: 10, borderLeft: `2px solid ${C.accent}`} : {})}}><span style={{color: C.muted}}>{s.by}{s.type && s.type !== 'reply' ? ` · ${s.type}` : ''}:</span> {s.text}</div>)}
        </Section>}
        <Section title="History">
          <div style={{display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: C.muted}}>{events.slice(-15).map((e, i) => <div key={i}><span style={{color: C.faint}}>{new Date(e.at).toLocaleTimeString('en-US', {hour: 'numeric', minute: '2-digit'})}</span> · {e.event} · r{e.revision}</div>)}</div>
        </Section>
      </aside>
    </main>
  </div>;
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
  return <form onSubmit={submit} style={{border: `1px solid ${C.ink}`, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 10, background: '#fff'}}>
    <div style={{fontSize: 15}}>{q.text}</div>
    {q.kind === 'fact' && <div style={{color: C.muted, fontSize: 12}}>This answer changes the recommendation. {q.owner} would know; enter the date if you do.</div>}
    {q.kind === 'spec' && <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10}}>{q.fields.map(k => <Field key={k} label={k}><input required value={values[k] || ''} onChange={e => setValues({...values, [k]: e.target.value})} style={inp}/></Field>)}</div>}
    {q.kind === 'cad' && <input type="file" accept=".step,.stp,.stl" required onChange={e => setCad(e.target.files[0])}/>}
    {q.kind === 'demand' && <input required value={text} onChange={e => setText(e.target.value)} placeholder="e.g. the spin test before the Nov 24 build" style={inp}/>}
    {q.kind === 'fact' && <input type="date" required value={text} onChange={e => setText(e.target.value)} style={inp}/>}
    {['ramp', 'stale'].includes(q.kind) && <div style={{color: C.critical}}>{q.text}</div>}
    {!['ramp', 'stale'].includes(q.kind) && <Button primary disabled={busy} style={{alignSelf: 'flex-start'}}>Answer</Button>}
  </form>;
}

function Comparison({order, act, busy}) {
  const d = order.decision, q = order.quote;
  const rec = d.recommended?.tier;
  const [argument, setArgument] = React.useState('');
  const canOkay = ['recommended', 'needs_answer'].includes(order.state);
  const uncertain = order.context?.uncertain || [];
  return <div style={{display: 'flex', flexDirection: 'column', gap: 12}}>
    <div style={{fontSize: 15, lineHeight: 1.45}}>{d.text}</div>
    {d.switching && <div style={{color: C.muted}}>Switching condition: {d.switching}.</div>}
    <div style={{border: `1px solid ${C.line}`, borderRadius: 12, overflow: 'hidden', background: '#fff'}}>
      <div style={{display: 'grid', gridTemplateColumns: 'minmax(0,1.3fr) 1fr 1fr 1fr 1fr 1fr auto', gap: 8, padding: '8px 14px', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: C.muted, borderBottom: `1px solid ${C.line}`}}>
        <span>Tier</span><span>Price</span><span>Part ready</span><span>{order.context?.milestoneLabel || 'Milestone'}</span><span>{d.workingDays ? 'Working days gained' : 'Days gained'}</span><span>Break-even</span><span/>
      </div>
      {d.options.map(o => {
        const qo = q.options.find(x => x.tier === o.tier) || {};
        const isRec = o.tier === rec, chosen = order.frozen?.tier === o.tier;
        return <div key={o.tier} style={{display: 'grid', gridTemplateColumns: 'minmax(0,1.3fr) 1fr 1fr 1fr 1fr 1fr auto', gap: 8, padding: '10px 14px', alignItems: 'center', borderTop: `1px solid ${C.hair}`, background: isRec || chosen ? C.paper : '#fff', opacity: o.admissible ? 1 : .5}}>
          <span style={{display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap'}}>{o.tier}{isRec && <Chip tone="ink">recommended · {d.recommended.basis}</Chip>}{chosen && <Chip tone="ink">okayed</Chip>}{!o.admissible && <Chip tone="critical">{o.why}</Chip>}{d.dominated?.includes(o.tier) && !isRec && <Chip>buys no time</Chip>}</span>
          <span>{money(qo.priceCents)}{o.extraCents > 0 && <span style={{color: C.muted}}> (+{money(o.extraCents)})</span>}</span>
          <span>{day(qo.readyOn)}</span>
          <span style={{color: o.finishOn ? C.ink : C.muted}}>{o.finishOn ? day(o.finishOn) : 'unknown'}</span>
          <span>{o.deltaDays == null ? '—' : o.deltaDays === 0 ? '0' : `+${o.deltaDays}`}</span>
          <span style={{color: C.muted}}>{o.breakEvenCentsPerDay ? `${money(o.breakEvenCentsPerDay)}/day` : '—'}</span>
          <span>{canOkay && o.admissible && <Button primary={isRec} disabled={busy} onClick={() => act(`/orders/${order.id}/okay`, {tier: o.tier})}>{isRec ? 'Okay' : 'Choose'}</Button>}</span>
        </div>;
      })}
    </div>
    <div style={{color: C.muted, fontSize: 12}}>Assumptions: {d.assumptions.join(' · ')}{q.cutoff ? ` · Vendor cutoff ${new Date(q.cutoff).toLocaleTimeString('en-US', {hour: 'numeric', minute: '2-digit'})} today` : ''}{q.validUntil ? ` · quote valid until ${day(q.validUntil)}` : ''}</div>
    {canOkay && <form onSubmit={e => { e.preventDefault(); act(`/orders/${order.id}/argue`, {text: argument}); setArgument(''); }} style={{display: 'flex', flexDirection: 'column', gap: 8, borderTop: `1px solid ${C.hair}`, paddingTop: 12}}>
      <div style={{fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: C.muted}}>Disagree? Say why</div>
      <div style={{display: 'flex', gap: 8, flexWrap: 'wrap'}}>
        <input value={argument} onChange={e => setArgument(e.target.value)} placeholder="e.g. the motor actually lands on the 21st" style={{...inp, flex: 1, minWidth: 220}}/>
        <Button disabled={busy || !argument.trim()}>Send</Button>
      </div>
      <div style={{color: C.faint, fontSize: 11}}>Burn reads what you say. A date you assert re-runs the comparison; a preference or policy disagreement is kept with the order for the approver.</div>
    </form>}
  </div>;
}

function RampPanel({order, act, busy, mock, refresh}) {
  const r = order.ramp, v = order.vendorOrder;
  const row = (k, val) => <React.Fragment key={k}><span style={{color: C.muted}}>{k}</span><span>{val}</span></React.Fragment>;
  const sim = async (what, body) => { await api(`/ramp/simulate/${what}`, {body}); await refresh(); };
  return <Section title="Approval and purchase" right={STATE_LABEL[order.state]}>
    <div style={{display: 'grid', gridTemplateColumns: 'max-content minmax(0,1fr)', columnGap: 16, rowGap: 6, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14, background: '#fff'}}>
      {row('Okayed', `${order.frozen?.tier} · ${money(order.frozen?.priceCents)}`)}
      {row('Ramp request', r.requestId ? `${r.requestId} · ${r.approvalStatus}` : '—')}
      {row('Card', r.cardId ? `•••• ${r.cardLast4 || ''} · Xometry only · ${money(order.frozen?.priceCents)} · ${order.paymentState}` : order.paymentState)}
      {row('Vendor order', v?.vendorOrderId ? `${v.vendorOrderId} · promised ${day(v.promisedOn)}` : '—')}
      {row('Booking', `${order.bookingState}${r.transactionIds?.length ? ` · ${r.transactionIds.length} transaction${r.transactionIds.length === 1 ? '' : 's'}` : ''}`)}
    </div>
    {order.question && ['stale', 'ramp'].includes(order.question.kind) && <div style={{color: C.critical}}>{order.question.text}</div>}
    {order.state === 'placement_unknown' && <div style={{display: 'flex', gap: 10, alignItems: 'center', color: C.critical}}>The vendor's response was lost. Nothing will be retried automatically. <Button disabled={busy} onClick={() => act(`/orders/${order.id}/reconcile`, {})}>Check vendor records again</Button></div>}
    {order.state === 'approved' && <div style={{display: 'flex', gap: 10, alignItems: 'center'}}><span style={{color: C.muted}}>Approved; placement did not complete.</span><Button disabled={busy} onClick={() => act(`/orders/${order.id}/place`, {})}>Place now</Button></div>}
    {mock && <div style={{display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '10px 12px', border: `1px dashed ${C.line}`, borderRadius: 10, fontSize: 12}}>
      <Chip>Ramp (simulated)</Chip>
      {order.state === 'requested' && <><Button disabled={busy} onClick={() => sim('approve', {requestId: r.requestId, orderId: order.id})}>Manager approves</Button><Button disabled={busy} onClick={() => sim('reject', {requestId: r.requestId, orderId: order.id})}>Reject</Button></>}
      {order.state === 'placed' && order.paymentState === 'issued' && <Button disabled={busy} onClick={() => sim('charge', {orderId: order.id})}>Xometry charges the card</Button>}
      {order.bookingState === 'coded' && <span style={{color: C.muted}}>Receipt, memo and project code are on the Ramp transaction.</span>}
      {!['requested', 'placed'].includes(order.state) && order.bookingState !== 'coded' && <span style={{color: C.muted}}>Stand-in for approving in Ramp and for its ⌘J test transaction.</span>}
    </div>}
  </Section>;
}
const inp = {font: 'inherit', fontSize: 13, padding: '8px 10px', border: `1px solid ${C.line}`, borderRadius: 8, background: '#fff', color: C.ink};
