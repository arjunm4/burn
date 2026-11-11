import React from 'react';
import {api} from './api.js';
import {C, Page, Button, Chip, StateBadge, Eyebrow, money, day, clock, relTime, serverNow, syncClock} from './ui.jsx';

/**
 * /ramp: what the approver sees. A Ramp-style surface over the Ramp mock's records: the manager's
 * approval inbox (each request as a decision card), the virtual cards, and the transactions with
 * Burn's bookkeeping on them. Live over /api/ramp/stream.
 */
export default function Ramp() {
  const [tab, setTab] = React.useState(() => new URLSearchParams(location.search).get('tab') || 'inbox');
  const [data, setData] = React.useState({requests: [], cards: [], transactions: []});
  const [system, setSystem] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [busy, setBusy] = React.useState(null);

  const load = React.useCallback(async () => {
    try {
      const [r, c, t] = await Promise.all([api('/ramp/requests'), api('/ramp/cards'), api('/ramp/transactions')]);
      setData({requests: r.requests || [], cards: c.cards || [], transactions: t.transactions || []}); setError(null);
    } catch (e) { setError(e.message); }
  }, []);
  React.useEffect(() => {
    api('/system').then(s => { syncClock(s.now); setSystem(s); }).catch(() => {});
    load();
    const es = new EventSource('/api/ramp/stream'); let t;
    es.addEventListener('ramp.changed', () => { clearTimeout(t); t = setTimeout(load, 120); });
    return () => { es.close(); clearTimeout(t); };
  }, [load]);
  const pick = name => { setTab(name); history.replaceState(null, '', `/ramp?tab=${name}`); };

  async function decide(req, what) {
    if (busy) return; setBusy(req.id); setError(null);
    try { await api(`/ramp/simulate/${what}`, {body: {requestId: req.id, orderId: req.orderId}}); await load(); }
    catch (e) { setError(e.message); }
    finally { setBusy(null); }
  }

  const pending = data.requests.filter(r => r.status === 'PENDING'), decided = data.requests.filter(r => r.status !== 'PENDING').reverse();
  const tabs = [['inbox', `Approvals${pending.length ? ` · ${pending.length}` : ''}`], ['cards', `Cards${data.cards.length ? ` · ${data.cards.length}` : ''}`], ['transactions', `Transactions${data.transactions.length ? ` · ${data.transactions.length}` : ''}`]];
  return <Page system={system} width={880} style={{display: 'flex', flexDirection: 'column', gap: 24}}>
    <div style={{display: 'flex', gap: 12, alignItems: 'baseline'}}>
      <span style={{fontSize: 26, letterSpacing: '-.02em'}}>Ramp</span>
      <Chip>simulated</Chip>
      {system?.company?.manager && <span style={{marginLeft: 'auto', color: C.muted, fontSize: 12}}>Signed in as {system.company.manager}</span>}
    </div>
    <nav style={{display: 'flex', gap: 4, borderBottom: `1px solid ${C.line}`}}>
      {tabs.map(([k, label]) => <button key={k} onClick={() => pick(k)} style={{background: 'transparent', border: 0, borderBottom: `2px solid ${tab === k ? C.ink : 'transparent'}`, marginBottom: -1, padding: '8px 12px', fontSize: 13, color: tab === k ? C.ink : C.muted, cursor: 'pointer'}}>{label}</button>)}
    </nav>
    {error && <div role="alert" style={{color: C.critical}}>{error}</div>}

    {tab === 'inbox' && <>
      {!pending.length && <Empty>Nothing waiting for your approval.</Empty>}
      {pending.map(r => <RequestCard key={r.id} r={r} busy={busy === r.id} onDecide={what => decide(r, what)}/>)}
      {!!decided.length && <section style={{display: 'flex', flexDirection: 'column', gap: 10}}>
        <Eyebrow>Decided</Eyebrow>
        <Card>
          {decided.map(r => <Row key={r.id} href={`/orders/${r.orderId}`} cols="minmax(0,1.6fr) 1fr auto auto">
            <span style={{minWidth: 0}}>
              <div style={ellipsis}>{r.order?.entry?.name || r.name}</div>
              <div style={{color: C.muted, fontSize: 12}}>{r.requester}{r.order?.frozen?.tier ? ` · ${r.order.frozen.tier}` : ''}</div>
            </span>
            <span style={{color: C.muted, fontSize: 12}}>{r.status === 'APPROVED' ? `Approved ${r.approvedAt ? relTime(r.approvedAt) : ''}` : r.status === 'REJECTED' ? 'Rejected' : r.status.toLowerCase()}</span>
            <span style={{fontVariantNumeric: 'tabular-nums'}}>{money(r.amountCents)}</span>
            {r.order ? <StateBadge state={r.order.state}/> : <Chip tone={r.status === 'REJECTED' ? 'critical' : 'muted'}>{r.status}</Chip>}
          </Row>)}
        </Card>
      </section>}
    </>}

    {tab === 'cards' && <>
      {!data.cards.length && <Empty>No cards yet. Ramp issues one per approved order, usable only at the vendor.</Empty>}
      {!!data.cards.length && <Card>
        <Row head cols="minmax(0,1.6fr) 1fr 1fr 1fr 1fr auto"><span>Order</span><span>Card</span><span>Merchant</span><span>Limit · spent</span><span>Locks</span><span/></Row>
        {data.cards.map(c => <Row key={c.id} href={`/orders/${c.orderId}`} cols="minmax(0,1.6fr) 1fr 1fr 1fr 1fr auto">
          <span style={{minWidth: 0}}>
            <div style={ellipsis}>{c.order?.entry?.name || c.orderId}</div>
            <div style={{color: C.muted, fontSize: 12}}>{c.order?.entry?.engineer}</div>
          </span>
          <span style={{fontVariantNumeric: 'tabular-nums'}}>•••• {c.last4}</span>
          <span>{vendorName(c.allowedVendors)} only</span>
          <span style={{fontVariantNumeric: 'tabular-nums'}}>{money(c.limitCents)}<span style={{color: C.muted}}> · {money(c.spentCents)}</span></span>
          <span style={{color: C.muted}}>{c.state === 'locked' ? 'locked' : `until ${day(c.lockDate)}`}</span>
          <Chip tone={c.state === 'active' ? 'ink' : 'muted'}>{c.state}</Chip>
        </Row>)}
      </Card>}
    </>}

    {tab === 'transactions' && <>
      {!data.transactions.length && <Empty>No charges yet.</Empty>}
      {!!data.transactions.length && <Card>
        <Row head cols="1fr 1fr 1fr minmax(0,2.2fr)"><span>Merchant</span><span>Amount</span><span>Date</span><span>Booking</span></Row>
        {data.transactions.slice().reverse().map(t => {
          const card = data.cards.find(c => c.id === t.cardId);
          return <Row key={t.id} href={`/orders/${t.orderId}`} cols="1fr 1fr 1fr minmax(0,2.2fr)">
            <span style={{minWidth: 0}}>
              <div>{vendorName([t.merchant])}</div>
              <div style={{color: C.muted, fontSize: 12}}>•••• {card?.last4 || '····'}</div>
            </span>
            <span style={{fontVariantNumeric: 'tabular-nums'}}>{money(t.amountCents)}</span>
            <span style={{color: C.muted}}>{t.at ? day(t.at) : '—'}<div style={{fontSize: 12}}>{(t.status || '').toLowerCase()}</div></span>
            {t.booking ? <span style={{minWidth: 0, fontSize: 12, lineHeight: 1.5}}>
              <div style={ellipsis}>{(t.booking.memo || '').split(/[.:]\s/)[0] || 'memo'}</div>
              <div style={{color: C.muted, ...ellipsis}}>
                {t.booking.receipt ? t.booking.receipt.fileName : <span style={{color: C.critical}}>receipt missing</span>}
                {t.booking.coding?.project ? ` · ${t.booking.coding.project}` : ''}
              </div>
            </span> : <span style={{color: C.muted, fontSize: 12}}>Awaiting booking</span>}
          </Row>;
        })}
      </Card>}
    </>}
  </Page>;
}

/* ---------- the decision card ---------- */

const VERDICT = {
  worth_it: {label: 'Worth it', tone: 'accent'},
  dominated: {label: 'No premium', tone: 'ink'},
  overridden: {label: 'Overridden', tone: 'ink'},
  open_question: {label: 'Open question', tone: 'critical'},
};

function RequestCard({r, busy, onDecide}) {
  const o = r.order, f = o?.frozen, v = r.verdict || null;
  const cutoff = r.cutoff || v?.cutoff ? new Date(r.cutoff || v.cutoff) : null, late = cutoff && cutoff < serverNow();
  const lines = linesFor(r, v);
  const base = lines.find(l => l.kind === 'base'), premium = lines.find(l => l.kind === 'premium');
  const ms = milestoneOf(v, o);
  const qty = f?.fields?.quantity ?? f?.fields?.qty ?? null;
  const assumptions = v?.assumptions?.length ? v.assumptions : fallbackAssumptions(r.justification);
  const requester = r.requester || o?.entry?.engineer || 'engineer';

  return <article style={{border: `1px solid ${C.line}`, borderRadius: 12, background: '#fff', boxShadow: '0 1px 2px rgba(28,27,23,.04)', overflow: 'hidden'}}>
    {/* who → where → how much */}
    <div style={{padding: '20px 22px 16px', display: 'flex', flexDirection: 'column', gap: 6}}>
      <div style={{display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap'}}>
        <span style={{fontSize: 22, letterSpacing: '-.01em', display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap'}}>
          <span>{requester}</span><Arrow/><span>{vendorName([r.vendor])}</span><Arrow/><span style={{fontVariantNumeric: 'tabular-nums'}}>{money(r.amountCents)}</span>
        </span>
        <span style={{marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center'}}>
          <span style={{color: C.muted, fontSize: 12}}>{relTime(r.createdAt)}</span>
          {o ? <StateBadge state={o.state}/> : <Chip tone="ink">Pending</Chip>}
        </span>
      </div>
      <div style={{color: C.muted, fontSize: 13}}>{o?.entry?.name || r.name}{qty != null ? ` × ${qty}` : ''}{(ms.label) ? ` · for ${ms.label}${ms.date ? `, ${day(ms.date)}` : ''}` : ''}{f?.readyOn ? ` · ready ${day(f.readyOn)}` : ''}</div>
    </div>

    {/* the two lines */}
    <Block>
      <div style={{display: 'flex', flexDirection: 'column', gap: 10}}>
        {base && <Line label={base.description} sub={base.sub} amount={base.amountCents}/>}
        {premium && <Line label={premium.description} sub={premium.sub} amount={premium.amountCents} chip={<VerdictChip v={v} r={r}/>}/>}
        {!premium && v && <div style={{display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap'}}>
          <span style={{color: C.muted, fontSize: 13}}>No expedite premium</span><VerdictChip v={v} r={r}/>
        </div>}
        {!premium && !v && !base && <Line label={r.name} amount={r.amountCents}/>}
      </div>
      {v?.riskNote && <div style={{marginTop: 12, padding: '10px 12px', background: C.paper, borderRadius: 8, fontSize: 13, lineHeight: 1.5}}><span style={{color: C.muted}}>{requester} chose {v.chosenTier} over Burn's {v.recommendedTier}: </span>“{v.riskNote}”</div>}
      {v && !v.riskNote && v.verdict !== 'worth_it' && <div style={{marginTop: 10, fontSize: 13, lineHeight: 1.5, color: C.muted}}>{verdictLine(v, ms, r)}</div>}
      {!v && r.justification && <div style={{marginTop: 10, fontSize: 13, lineHeight: 1.5}}>{r.justification.split(/\n\n(?=Assumptions:)/)[0]}</div>}
    </Block>

    {/* rests on (folded) */}
    {!!assumptions.length && <details style={{padding: '10px 22px', borderTop: `1px solid ${C.hair}`}}>
      <summary style={{cursor: 'pointer', color: C.muted, fontSize: 12}}>What this rests on · {assumptions.length}</summary>
      <ul style={{margin: '8px 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4, color: C.muted, fontSize: 12, lineHeight: 1.5}}>
        {assumptions.map((a, i) => <li key={i} style={{display: 'grid', gridTemplateColumns: '10px minmax(0,1fr)', gap: 6}}><span style={{color: C.faint}}>·</span><span>{a}</span></li>)}
      </ul>
      <div style={{marginTop: 8, color: C.faint, fontSize: 11}}>Verified on purchase · spec {shortHash(r.specHash || v?.specHash)}{r.decisionRevision != null ? ` · decision rev ${r.decisionRevision}` : ''}{v?.policy?.hash ? ` · policy ${shortHash(v.policy.hash)}` : ''}</div>
    </details>}

    {/* cutoff + actions */}
    <div style={{padding: '14px 22px 18px', display: 'flex', flexDirection: 'column', gap: 14}}>
      {cutoff && <div style={{display: 'flex', gap: 8, alignItems: 'center', borderRadius: 8, padding: '8px 12px', fontSize: 13, ...(late ? {border: `1px solid ${C.critical}`, color: C.critical} : {background: C.accent, color: C.ink})}}>
        <span aria-hidden style={{width: 6, height: 6, borderRadius: 3, background: late ? C.critical : C.ink}}/>
        {late ? `Vendor cutoff ${clock(cutoff)} PT passed · production starts the next working day` : `Approve by ${clock(cutoff)} PT to start production today`}
      </div>}
      <div style={{display: 'flex', gap: 8, alignItems: 'center'}}>
        <Button primary disabled={busy} onClick={() => onDecide('approve')} style={{padding: '10px 18px', fontSize: 14}}>{busy ? 'Working…' : 'Approve'}</Button>
        <Button disabled={busy} onClick={() => onDecide('reject')} style={{padding: '10px 16px', fontSize: 14}}>Reject</Button>
      </div>
    </div>
  </article>;
}

function Line({label, sub, amount, chip}) {
  return <div style={{display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 14, alignItems: 'start'}}>
    <span style={{minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4}}>
      <span style={{fontSize: 15}}>{label}{sub && <span style={{color: C.muted, fontSize: 13}}> · {sub}</span>}</span>
      {chip}
    </span>
    <span style={{fontSize: 15, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap'}}>{money(amount)}</span>
  </div>;
}

function VerdictChip({v, r}) {
  if (!v?.verdict) return null;
  const k = VERDICT[v.verdict] || {label: v.verdict.replace(/_/g, ' '), tone: 'muted'};
  const parts = [k.label];
  const be = v.breakEvenCentsPerDay, pol = v.policy;
  if (v.verdict === 'worth_it') { if (be) parts.push(`break-even ${money(be)}/day${pol?.valuePerDayCents ? ` vs policy ${money(pol.valuePerDayCents)}/day` : ''}`); if (pol?.owner) parts.push(`${possessive(pol.owner)} policy${pol.version != null ? ` v${pol.version}` : ''}`); }
  else if (v.verdict === 'dominated') parts.push(v.dominatingInput ? `${v.dominatingInput} gates it` : 'cheapest finishes just as soon');
  else if (v.verdict === 'overridden') parts.push(`${v.chosenTier || r.chosenTier} chosen · Burn recommended ${v.recommendedTier || r.recommendedTier || v.cheapestTier}`);
  else if (v.verdict === 'open_question') parts.push('nothing preselected');
  const bg = k.tone === 'accent' ? C.accent : 'transparent', border = k.tone === 'critical' ? C.critical : C.ink, color = k.tone === 'critical' ? C.critical : C.ink;
  return <span style={{alignSelf: 'flex-start', fontSize: 11, letterSpacing: '.04em', border: `1px solid ${border}`, background: bg, color, borderRadius: 10, padding: '2px 9px', lineHeight: 1.6}}>
    <span style={{textTransform: 'uppercase', letterSpacing: '.08em'}}>{parts[0]}</span>{parts.length > 1 && <span> · {parts.slice(1).join(' · ')}</span>}
  </span>;
}

/** One sentence under the lines: what the verdict means for this milestone. */
function verdictLine(v, ms, r) {
  const m = ms.label || 'the milestone', d = v.daysGained, days = d != null ? `${d} working day${d === 1 ? '' : 's'}` : null;
  switch (v.verdict) {
    case 'worth_it': return <>{v.chosenTier || r.chosenTier} gets {m} done {days ? `${days} sooner` : 'sooner'}{v.breakEvenCentsPerDay ? `; the premium pays for itself if a day of ${m} is worth more than ${money(v.breakEvenCentsPerDay)}` : ''}{v.policy?.valuePerDayCents ? `, and ${possessive(v.policy.owner || 'the owner')} policy values it at ${money(v.policy.valuePerDayCents)}` : ''}.</>;
    case 'dominated': return <>Paying more buys no time for {m}{v.dominatingInput ? <>: <span style={{color: C.ink}}>{v.dominatingInput}</span> arrives later anyway</> : ''}. {v.cheapestTier || r.chosenTier} finishes it on the same day.</>;
    case 'overridden': return <>{r.requester || 'The engineer'} chose {v.chosenTier || r.chosenTier} over Burn's {v.recommendedTier || r.recommendedTier || v.cheapestTier}{days ? `; it buys ${days}` : ''}{v.breakEvenCentsPerDay ? ` at ${money(v.breakEvenCentsPerDay)}/day` : ''}.</>;
    case 'open_question': return <>One answer would flip this: <span style={{color: C.ink}}>{questionOf(v) || `when ${v.dominatingInput || 'the gating input'} arrives`}</span>. Nothing is preselected until it is known.</>;
    default: return v.summary || v.text || null;
  }
}

/* ---------- shaping the request into lines ---------- */

/** The two line items: cheapest admissible tier, then the expedite premium. Falls back to one line when the server sends only a total. */
function linesFor(r, v) {
  if (Array.isArray(r.lineItems) && r.lineItems.length) {
    return r.lineItems.map(l => {
      // The server's descriptions already say "cheapest valid lead time" / "N working days sooner"; captions are only for bare lines.
      if (l.kind === 'premium') return {...l, description: l.description || 'Expedite premium', sub: !l.description && v?.daysGained != null ? `${v.daysGained} working day${v.daysGained === 1 ? '' : 's'} sooner` : null};
      return {...l, kind: 'base', description: l.description || v?.cheapestTier || r.order?.frozen?.tier || 'Part', sub: !l.description && v?.cheapestTier ? 'cheapest valid lead time' : null};
    });
  }
  const tier = r.order?.frozen?.tier || r.chosenTier;
  if (!tier && r.amountCents == null) return [];
  return [{kind: 'base', description: tier || r.name, amountCents: r.amountCents, sub: v?.cheapestTier && v.cheapestTier === tier ? 'cheapest valid lead time' : null}];
}

function milestoneOf(v, o) {
  const m = v?.milestone;
  if (m && typeof m === 'object') return {label: m.label || m.name || m.id || o?.milestoneLabel || null, date: m.date || m.on || m.targetOn || m.due || null};
  return {label: typeof m === 'string' ? m : o?.milestoneLabel || null, date: v?.milestoneOn || v?.targetOn || null};
}
const questionOf = v => (typeof v.question === 'string' ? v.question : v.question?.text) || v.openQuestion || null;

/** Before the server sends structured assumptions, read them off the justification's "Assumptions:" block. */
function fallbackAssumptions(justification) {
  const block = (justification || '').split(/\n\n(?=Assumptions:)/)[1];
  if (!block) return [];
  return block.split('\n').slice(1).map(l => l.replace(/^-\s*/, '').trim()).filter(l => l && !/^Vendor cutoff:/.test(l));
}

/* ---------- small pieces ---------- */

const ellipsis = {minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'};
const possessive = n => (n ? (n.endsWith('s') ? `${n}'` : `${n}'s`) : '');
const shortHash = h => (h ? String(h).slice(0, 8) : '—');
const vendorName = list => { const v = (list || [])[0] || 'xometry'; return v.toLowerCase() === 'xometry' ? 'Xometry' : v; };
const Arrow = () => <span aria-hidden style={{color: C.faint, fontSize: 16}}>→</span>;
const Empty = ({children}) => <div style={{color: C.muted, padding: '12px 0'}}>{children}</div>;
const Card = ({children}) => <div style={{border: `1px solid ${C.line}`, borderRadius: 12, background: '#fff', overflow: 'hidden'}}>{children}</div>;

function Block({title, children}) {
  return <div style={{padding: '14px 22px', borderTop: `1px solid ${C.hair}`}}>
    {title && <Eyebrow style={{display: 'block', marginBottom: 8}}>{title}</Eyebrow>}
    {children}
  </div>;
}

function Row({cols, head, href, children}) {
  const style = {display: 'grid', gridTemplateColumns: cols, gap: 12, alignItems: 'center', padding: head ? '8px 16px' : '12px 16px', borderTop: head ? 0 : `1px solid ${C.hair}`, textDecoration: 'none', color: C.ink, ...(head ? {fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: C.muted, borderBottom: `1px solid ${C.line}`} : {})};
  return href ? <a href={href} style={style}>{children}</a> : <div style={style}>{children}</div>;
}
