import React from 'react';
import {api, subscribe, readFileAsBase64} from './api.js';
import {C, Page, StateBadge, Button, Field, Section, Fold, Chip, Rows, Eyebrow, input, money, day, clock, relTime} from './ui.jsx';
import BrowserPanel from './BrowserPanel.jsx';
import {DemoLiveChanges} from './Demo.jsx';

// One order, told as a story in the order it happens: what Burn did (live), the decision, the
// purchase as it moves through Ramp and the vendor. The spec and sources sit to the side.

// Lines in the activity log. Live bus events accumulate while Burn works; on reload the same
// story is rebuilt from the audit trail and the agent's saved trace.
const ACTIVITY = {
  'order.entered': () => 'Order entered',
  'agent.reading': e => `Reading the team's records${e.model ? ` · ${e.model}` : ''}`,
  'agent.search': e => `Searched ${e.tool === 'calendar' ? 'the calendar' : e.source || 'Slack, Jira and notes'} for “${e.query}” · ${e.hits} hit${e.hits === 1 ? '' : 's'}${e.channels?.length ? ` in ${e.channels.slice(0, 3).join(', ')}` : ''}`,
  'agent.claims': e => e.summary, 'agent.wrote': () => 'Wrote the recommendation', 'agent.reply': e => `Burn: “${e.text}”`,
  'agent.fallback': e => `Agent unavailable (${e.stage}); using rules`,
  'quote.started': () => 'Quoting on Xometry: uploading the CAD, reading every lead time', 'quote.captured': e => `Quote captured · ${e.quote?.options?.length} lead times`,
  'recommended': () => 'Recommendation ready', 'question': e => `Needs an answer: ${e.question?.text || ''}`, 'answer.received': () => 'Answer received, re-solving',
  'exchange.added': e => (e.statement?.text ? `${e.statement.by || 'You'}: “${e.statement.text}”` : null),
  'order.frozen': () => 'Okayed: the exact order is frozen', 'ramp.requested': () => 'Sent to Ramp for approval', 'ramp.request.failed': () => 'Ramp request failed',
  'ramp.approved': () => 'Approved in Ramp', 'ramp.rejected': () => 'Rejected in Ramp', 'approval.stale': () => 'Approval was for an older version',
  'card.issued': () => 'Ramp issued a card: Xometry only, exact amount', 'card.failed': () => 'Card could not be issued', 'placement.notice': e => e.text,
  'placement.begun': () => 'Reopening the quote and verifying every field…', 'placement.succeeded': () => 'Order placed',
  'placement.blocked': e => `Stopped before buying: ${e.result?.mismatches?.map(m => m.field).join(', ')} changed`, 'placement.failed': e => `Placement failed: ${e.result?.reason}`,
  'placement.unknown': () => 'Vendor response lost; checking their records', 'placement.reconciled': () => 'Order found in vendor records', 'placement.unresolved': e => e.text, 'placement.invalidated': () => 'Needs re-approval',
  'charge.cleared': () => 'Xometry charged the card; matched in Ramp', 'booked': () => 'Receipt, memo and project code attached in Ramp', 'booking.failed': () => 'Booking failed; will retry',
};
// Audit events (reload) use the store's names; map the few that differ from the bus names.
const AUDIT_ALIAS = {'decision.made': 'recommended', 'spec.gap': 'question', 'ramp.request.created': null, 'ramp.approval.recorded': null, 'placement.started': 'placement.begun', 'order.created': null, 'resolve.started': null};
const WORKING = ['entered', 'resolving', 'placing'];
const BAD = /stopped|failed|lost|unavailable|rejected|re-approval/i;

function rebuild(events, order) {
  const lines = [];
  for (const e of events) {
    const name = e.event in AUDIT_ALIAS ? AUDIT_ALIAS[e.event] : e.event;
    if (!name || !ACTIVITY[name]) continue;
    const text = ACTIVITY[name]({...e.detail, order});
    if (text) lines.push({at: e.at, text, key: `${e.at}:${name}`});
    // After "order entered", replay what the agent read (saved with the order).
    if (name === 'order.entered' && order.context?.agent?.trace) {
      for (const [i, t] of order.context.agent.trace.entries()) lines.push({at: e.at, text: ACTIVITY['agent.search']({...t}), key: `trace:${i}`});
      if (order.context.agent.summary) lines.push({at: e.at, text: order.context.agent.summary, key: 'trace:summary', strong: true});
    }
  }
  return lines;
}

export default function Order({id}) {
  const [order, setOrder] = React.useState(null);
  const [events, setEvents] = React.useState([]);
  const [live, setLive] = React.useState([]);
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
      const f = ACTIVITY[e.type]; const text = f && f(e);
      if (text) setLive(l => [...l, {at: new Date().toISOString(), text, key: `${Date.now()}:${l.length}`, strong: e.type === 'agent.claims'}]);
      if (['placement.succeeded', 'booked', 'ramp.approved', 'placement.unknown', 'recommended', 'question', 'charge.cleared', 'order.frozen'].includes(e.type)) refresh();
    });
    return off;
  }, [id, refresh]);

  async function act(path, body) {
    if (busy) return; setBusy(true); setError(null);
    try { const r = await api(path, {body: {expectedRevision: order.revision, ...body}}); if (r.order) setOrder(r.order); await refresh(); }
    catch (e) { setError(e.message); if (e.status === 409) refresh(); }
    finally { setBusy(false); }
  }

  // The story: audit trail up to the last reload, then whatever has streamed in since.
  const story = React.useMemo(() => { if (!order) return []; const base = rebuild(events, order); const lastAt = base[base.length - 1]?.at || ''; return [...base, ...live.filter(l => l.at > lastAt)]; }, [events, live, order]);

  if (!order) return <Page system={system}><span style={{color: C.muted}}>{error || 'Loading…'}</span></Page>;
  const working = WORKING.includes(order.state);
  const ctx = order.context || {};
  const d = order.decision;

  return <Page system={system} width={1240} data-q-main style={{display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 300px', gap: 44}}>
    <div style={{display: 'flex', flexDirection: 'column', gap: 28, minWidth: 0}}>
      <header>
        <div style={{display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap'}}>
          <span style={{fontSize: 26, letterSpacing: '-.02em'}}>{order.entry.name}</span>
          <StateBadge state={order.state}/>
          <span style={{color: C.muted}}>{order.entry.engineer} · {relTime(order.createdAt)}{order.entry.partNumber ? ` · ${order.entry.partNumber}` : ''}</span>
        </div>
        {order.entry.note && <div style={{color: C.muted, marginTop: 4, fontSize: 14}}>“{order.entry.note}”</div>}
      </header>
      {error && <div role="alert" style={{color: C.critical}}>{error}</div>}

      <Activity lines={story} working={working}/>

      {order.state === 'needs_answer' && order.question && <QuestionPanel order={order} act={act} busy={busy}/>}
      {d && order.quote && <Decision order={order} act={act} busy={busy}/>}
      {order.frozen && <Purchase order={order} events={events} act={act} busy={busy} mock={system?.ramp?.mode === 'mock'} refresh={refresh}/>}
      <DemoLiveChanges order={order}/>
    </div>

    <aside style={{display: 'flex', flexDirection: 'column', gap: 24, minWidth: 0}}>
      <Section title="Spec" right={order.entry.cadFileName}>
        {order.spec?.length
          ? <Rows gap={4} rows={order.spec.map(f => [f.key, <span>{f.value ?? <span style={{color: C.critical}}>missing</span>}{f.provenance === 'default' && <span style={{color: C.faint}}> · default</span>}</span>])}/>
          : <span style={{color: C.muted}}>Not resolved yet.</span>}
      </Section>
      {ctx.related?.length > 0 && <Section title={`Sources · ${ctx.related.length}`}>
        <div style={{display: 'flex', flexDirection: 'column', gap: 8}}>
          {ctx.related.slice(0, 5).map(r => <Quote key={r.id} r={r}/>)}
          {ctx.related.length > 5 && <Fold title={`${ctx.related.length - 5} more`}><div style={{display: 'flex', flexDirection: 'column', gap: 8}}>{ctx.related.slice(5).map(r => <Quote key={r.id} r={r}/>)}</div></Fold>}
        </div>
      </Section>}
      {!!order.exchange?.length && <Section title="Discussion">
        {order.exchange.map((s, i) => <div key={i} style={{fontSize: 12, lineHeight: 1.45, ...(s.by === 'Burn' ? {paddingLeft: 10, borderLeft: `2px solid ${C.accent}`} : {})}}><span style={{color: C.muted}}>{s.by}: </span>{s.text}</div>)}
      </Section>}
    </aside>
  </Page>;
}

const Quote = ({r}) => <blockquote style={{margin: 0, padding: '4px 10px', borderLeft: `2px solid ${C.line}`, fontSize: 12, lineHeight: 1.4}}>
  {r.text.length > 140 ? r.text.slice(0, 140) + '…' : r.text}
  <div style={{color: C.muted, fontSize: 11, marginTop: 2}}>{r.author || r.source} · {r.channel} · {day(r.at)}</div>
</blockquote>;

/** What Burn did, as it happens. */
function Activity({lines, working}) {
  const ref = React.useRef(null);
  React.useEffect(() => { if (working && ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [lines.length, working]);
  if (!lines.length && !working) return null;
  const shown = working ? lines : lines.slice(-6);
  return <section>
    <Eyebrow>What Burn did</Eyebrow>
    <div ref={ref} style={{marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: working ? 320 : 'none', overflowY: 'auto', paddingRight: 4}}>
      {lines.length > 6 && !working && <span style={{color: C.faint, fontSize: 12}}>… {lines.length - 6} earlier steps</span>}
      {shown.map((l, i) => {
        const last = i === shown.length - 1, bad = BAD.test(l.text);
        return <div key={l.key} style={{display: 'grid', gridTemplateColumns: '14px 52px minmax(0,1fr)', gap: 8, alignItems: 'baseline', fontSize: l.strong ? 14 : 13, lineHeight: 1.45, color: bad ? C.critical : l.strong ? C.ink : last && working ? C.ink : C.muted}}>
          <span style={{width: 6, height: 6, borderRadius: '50%', background: bad ? C.critical : last && working ? C.ink : C.faint, animation: last && working ? 'pulse 1s infinite' : 'none', alignSelf: 'center'}}/>
          <span style={{color: C.faint, fontSize: 11, fontVariantNumeric: 'tabular-nums'}}>{clock(l.at)}</span>
          <span>{l.text}</span>
        </div>;
      })}
      {working && !lines.length && <span style={{color: C.muted}}>Starting…</span>}
    </div>
  </section>;
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
    <Eyebrow>{q.kind === 'fact' ? 'One fact decides it' : 'Burn needs an answer'}</Eyebrow>
    <div style={{fontSize: 16, color: blocking ? C.critical : C.ink, lineHeight: 1.4}}>{q.text}</div>
    {q.kind === 'fact' && q.owner && <div style={{color: C.muted, fontSize: 12}}>{q.owner} would know. Burn has asked; or answer for them:</div>}
    {q.kind === 'spec' && <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10}}>{q.fields.map(k => <Field key={k} label={k}><input required value={values[k] || ''} onChange={e => setValues({...values, [k]: e.target.value})} style={input}/></Field>)}</div>}
    {q.kind === 'cad' && <input type="file" accept=".step,.stp,.stl" required onChange={e => setCad(e.target.files[0])}/>}
    {q.kind === 'demand' && <input required value={text} onChange={e => setText(e.target.value)} placeholder="e.g. the spin test before the Nov 24 build" style={input}/>}
    {q.kind === 'fact' && <input type="date" required value={text} onChange={e => setText(e.target.value)} style={{...input, width: 'auto'}}/>}
    {!blocking && <Button primary disabled={busy} style={{alignSelf: 'flex-start'}}>Answer</Button>}
  </form>;
}

const COLS = 'minmax(0,1.3fr) 1fr 1fr 1.1fr .8fr 1fr auto';
function Decision({order, act, busy}) {
  const d = order.decision, q = order.quote, ctx = order.context || {};
  const rec = d.recommended?.tier, tent = d.tentative?.tier;
  const [argument, setArgument] = React.useState('');
  const [editing, setEditing] = React.useState(null); const [date, setDate] = React.useState('');
  const canOkay = order.state === 'recommended';
  const open = ['recommended', 'needs_answer'].includes(order.state);
  const cell = {fontVariantNumeric: 'tabular-nums'};
  const inputs = ctx.inputs || [];
  return <section style={{display: 'flex', flexDirection: 'column', gap: 14}}>
    <Eyebrow>{order.frozen ? 'The decision' : rec ? 'Burn recommends' : 'Burn cannot decide yet'}</Eyebrow>
    <div style={{fontSize: 20, lineHeight: 1.4, letterSpacing: '-.01em'}}>{d.text}</div>
    {d.switching && !rec && <div style={{color: C.muted}}>Switching condition: {d.switching}.</div>}
    <div style={{border: `1px solid ${C.line}`, borderRadius: 12, overflow: 'hidden', background: '#fff'}}>
      <div style={{display: 'grid', gridTemplateColumns: COLS, gap: 8, padding: '8px 14px', borderBottom: `1px solid ${C.line}`}}>
        {['Lead time', 'Price', 'Part ready', ctx.milestoneLabel ? `${ctx.milestoneLabel.replace(/ complete$/i, '')} done` : 'Milestone', d.workingDays ? 'Days gained' : 'Gained', 'Break-even', ''].map((h, i) => <Eyebrow key={i} style={{letterSpacing: '.08em'}}>{h}</Eyebrow>)}
      </div>
      {d.options.map(o => {
        const qo = q.options.find(x => x.tier === o.tier) || {};
        const isRec = o.tier === rec, isTent = o.tier === tent, chosen = order.frozen?.tier === o.tier, dominated = d.dominated?.includes(o.tier);
        return <div key={o.tier} style={{display: 'grid', gridTemplateColumns: COLS, gap: 8, padding: '12px 14px', alignItems: 'center', borderTop: `1px solid ${C.hair}`, background: isRec || chosen ? C.paper : '#fff', opacity: o.admissible ? 1 : .5}}>
          <span style={{display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap'}}>{o.tier}{chosen ? <Chip tone="ink">okayed</Chip> : isRec ? <Chip tone="ink">recommended</Chip> : isTent ? <Chip>leaning</Chip> : dominated ? <Chip>buys no time</Chip> : null}{!o.admissible && <Chip tone="critical">{o.why}</Chip>}</span>
          <span style={cell}>{money(qo.priceCents)}{o.extraCents > 0 && <span style={{color: C.muted}}> +{money(o.extraCents)}</span>}</span>
          <span style={cell}>{day(qo.readyOn)}</span>
          <span style={{...cell, color: o.finishOn ? C.ink : C.muted}}>{o.finishOn ? day(o.finishOn) : 'unknown'}{o.orderBy && <span style={{color: C.faint, fontSize: 11}}> · order by {day(o.orderBy)}</span>}</span>
          <span style={{...cell, color: dominated ? C.muted : C.ink}}>{o.deltaDays == null ? '—' : o.deltaDays > 0 ? `+${o.deltaDays}` : '0'}</span>
          <span style={{...cell, color: C.muted}}>{o.breakEvenCentsPerDay ? `${money(o.breakEvenCentsPerDay)}/day` : '—'}</span>
          <span>{canOkay && o.admissible && <Button primary={isRec} disabled={busy} onClick={() => act(`/orders/${order.id}/okay`, {tier: o.tier})}>{isRec ? 'Okay' : 'Choose'}</Button>}</span>
        </div>;
      })}
    </div>
    <div style={{display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 24}}>
      <div>
        <Eyebrow>Rests on</Eyebrow>
        <div style={{marginTop: 6, display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, lineHeight: 1.4}}>
          {(ctx.assumptions || []).map((a, i) => <div key={i}>{a.text}{a.ageDays > 0 && <span style={{color: C.faint}}> · {a.ageDays}d ago</span>}</div>)}
          {ctx.policy?.valuePerDayCents ? <div style={{color: C.muted}}>A day of {ctx.milestoneLabel} is worth {money(ctx.policy.valuePerDayCents)}{ctx.policy.owner ? ` (${ctx.policy.owner}'s policy)` : ''}.</div> : <div style={{color: C.muted}}>No value-of-time policy for this milestone; break-even only.</div>}
          {(q.cutoff || q.validUntil) && <div style={{color: C.muted}}>{[q.cutoff && `Vendor cutoff ${clock(q.cutoff)} today`, q.validUntil && `quote valid until ${day(q.validUntil)}`].filter(Boolean).join(' · ')}</div>}
        </div>
      </div>
      {open && inputs.length > 0 && <div>
        <Eyebrow>Know better? Correct a date</Eyebrow>
        <div style={{marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12}}>
          {inputs.map(n => <div key={n.nodeId} style={{display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap'}}>
            <span style={{minWidth: 0}}>{n.label} · <span style={{color: C.muted}}>{n.range ? `${day(n.range[0])}–${day(n.range[1])}` : day(n.date)}{n.by ? ` (${n.by})` : ''}</span></span>
            {editing === n.nodeId
              ? <><input type="date" value={date} onChange={e => setDate(e.target.value)} style={{...input, width: 'auto', padding: '4px 8px'}}/><Button disabled={busy || !date} style={{padding: '5px 10px'}} onClick={() => { act(`/orders/${order.id}/answer`, {fact: {nodeId: n.nodeId, date}}); setEditing(null); }}>Re-run</Button></>
              : <button onClick={() => { setEditing(n.nodeId); setDate(n.date || ''); }} style={{background: 'transparent', border: 0, color: C.muted, cursor: 'pointer', padding: 0, textDecoration: 'underline', textUnderlineOffset: 3, fontSize: 12}}>correct</button>}
          </div>)}
        </div>
      </div>}
    </div>
    {open && <form onSubmit={e => { e.preventDefault(); act(`/orders/${order.id}/argue`, {text: argument}); setArgument(''); }} style={{display: 'flex', gap: 8}}>
      <input value={argument} onChange={e => setArgument(e.target.value)} placeholder="Or tell Burn why you disagree" style={input}/>
      <Button disabled={busy || !argument.trim()}>Send</Button>
    </form>}
  </section>;
}

/** The purchase, step by step, as it moves through Ramp and the vendor. */
function Purchase({order, events, act, busy, mock, refresh}) {
  const r = order.ramp || {}, v = order.vendorOrder || {}, f = order.frozen;
  const at = name => events.find(e => e.event === name)?.at || null;
  const sim = async (what, body) => { await api(`/ramp/simulate/${what}`, {body}); await refresh(); };
  const rejected = order.state === 'rejected' || r.approvalStatus === 'REJECTED';
  const steps = [
    {label: 'Okayed', done: !!f, at: at('order.frozen'), detail: `${f.tier} · ${money(f.priceCents)} · every field frozen`},
    {label: rejected ? 'Rejected in Ramp' : r.approvalStatus === 'APPROVED' ? 'Approved in Ramp' : 'Awaiting approval in Ramp', done: r.approvalStatus === 'APPROVED', bad: rejected, current: r.approvalStatus === 'PENDING', at: at('ramp.approval.recorded') || at('ramp.request.created'),
      detail: r.approvalStatus === 'PENDING' ? <span>Request {r.requestId?.slice(0, 8)} is in the manager's inbox · <a href="/ramp" style={{color: C.ink}}>open Ramp →</a></span> : r.approvalStatus === 'APPROVED' ? `Request ${r.requestId?.slice(0, 8)} approved` : r.approvalStatus || 'not yet requested'},
    {label: 'Card issued', done: !!r.cardId, at: at('card.issued'), detail: r.cardId ? `•••• ${r.cardLast4 || '····'} · Xometry only · ${money(f.priceCents)}${order.paymentState === 'charged' ? ' · charged' : ''}` : 'Ramp issues a card locked to Xometry for the approved amount'},
    {label: order.state === 'placement_unknown' ? 'Placement unknown' : order.state === 'invalidated' ? 'Stopped before buying' : v.vendorOrderId ? 'Verified and placed' : 'Verify and place', done: !!v.vendorOrderId, bad: ['placement_unknown', 'invalidated'].includes(order.state), current: order.state === 'placing', at: at('placement.succeeded') || at('placement.started'),
      detail: v.vendorOrderId ? `Xometry order ${v.vendorOrderId} · ready ${day(v.promisedOn)} · every field read back and matched` : order.question && ['stale', 'ramp'].includes(order.question.kind) ? order.question.text : 'Burn reopens the quote, reads back every field against the frozen order, pays with the card'},
    {label: 'Charged', done: order.paymentState === 'charged', at: at('charge.cleared'), detail: order.paymentState === 'charged' ? `${money(f.priceCents)} cleared in Ramp, matched to this order` : 'The Xometry charge appears in Ramp and is matched'},
    {label: 'Booked', done: order.bookingState === 'coded', at: at('booked'), detail: order.bookingState === 'coded' ? 'Receipt, memo and project code attached in Ramp' : 'Receipt, memo and project code'},
  ];
  return <section style={{display: 'flex', flexDirection: 'column', gap: 12}}>
    <Eyebrow>The purchase</Eyebrow>
    <div style={{border: `1px solid ${C.line}`, borderRadius: 12, background: '#fff', padding: '6px 16px'}}>
      {steps.map((s, i) => {
        const color = s.bad ? C.critical : s.done ? C.ink : s.current ? C.ink : C.faint;
        return <div key={i} style={{display: 'grid', gridTemplateColumns: '18px minmax(0,1fr) 60px', gap: 12, padding: '10px 0', borderTop: i ? `1px solid ${C.hair}` : 0, alignItems: 'start'}}>
          <span style={{width: 10, height: 10, borderRadius: '50%', marginTop: 4, background: s.bad ? C.critical : s.done ? C.ok : 'transparent', border: `2px solid ${s.bad ? C.critical : s.done ? C.ok : s.current ? C.ink : C.faint}`, animation: s.current ? 'pulse 1s infinite' : 'none'}}/>
          <span style={{minWidth: 0}}>
            <div style={{color, fontSize: 14}}>{s.label}</div>
            <div style={{color: s.done || s.current || s.bad ? C.muted : C.faint, fontSize: 12, lineHeight: 1.4}}>{s.detail}</div>
          </span>
          <span style={{color: C.faint, fontSize: 11, textAlign: 'right', fontVariantNumeric: 'tabular-nums'}}>{s.at && (s.done || s.bad) ? clock(s.at) : ''}</span>
        </div>;
      })}
    </div>
    <BrowserPanel orderId={order.id} state={order.state}/>
    {order.state === 'placement_unknown' && <div style={{display: 'flex', gap: 10, alignItems: 'center', color: C.critical}}>The vendor's response was lost. <Button disabled={busy} onClick={() => act(`/orders/${order.id}/reconcile`, {})}>Check vendor records</Button></div>}
    {order.state === 'approved' && <div style={{display: 'flex', gap: 10, alignItems: 'center'}}><span style={{color: C.muted}}>Approved; not yet placed.</span><Button disabled={busy} onClick={() => act(`/orders/${order.id}/place`, {})}>Place now</Button></div>}
    {mock && order.state === 'placed' && order.paymentState === 'issued' && <div style={{display: 'flex', gap: 8, alignItems: 'center'}}><Chip>demo</Chip><span style={{color: C.muted, fontSize: 12}}>Ramp sees the charge when Xometry bills the card.</span><Button disabled={busy} onClick={() => sim('charge', {orderId: order.id})}>Xometry charges the card</Button></div>}
  </section>;
}
