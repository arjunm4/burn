import React from 'react';
import {api} from './api.js';
import {C, Header, Button, Chip, StateBadge, money, day, relTime} from './ui.jsx';

/**
 * /ramp: what the approver sees. A Ramp-style surface over the Ramp mock's records, labelled
 * simulated everywhere: there is no sandbox, so this stands in for the manager's Ramp inbox,
 * the virtual cards and the transactions with Burn's bookkeeping on them. Approve/Reject go
 * through the same simulate endpoints the order page uses.
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
      setData({requests: r.requests, cards: c.cards, transactions: t.transactions}); setError(null);
    } catch (e) { setError(e.message); }
  }, []);
  React.useEffect(() => {
    api('/system').then(setSystem).catch(() => {});
    load();
    // Live: any Ramp-side change on the order bus reloads the three lists (cheap; they are small).
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
  const tabs = [['inbox', `Inbox${pending.length ? ` · ${pending.length}` : ''}`], ['cards', `Cards · ${data.cards.length}`], ['transactions', `Transactions · ${data.transactions.length}`]];
  return <div style={{minHeight: '100vh', fontSize: 13, display: 'flex', flexDirection: 'column'}}>
    <Header crumb={<span style={{display: 'inline-flex', gap: 8, alignItems: 'center'}}>Ramp <Chip tone="ink">simulated</Chip></span>} system={system}/>
    <main style={{flex: 1, padding: '28px 24px 60px', maxWidth: 980, width: '100%', boxSizing: 'border-box', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20}}>
      <div style={{display: 'flex', gap: 14, alignItems: 'baseline', flexWrap: 'wrap'}}>
        <span style={{fontSize: 24, letterSpacing: '-.02em'}}>Approvals and spend</span>
        <span style={{color: C.muted}}>The manager's side. {system?.ramp?.mode === 'mock' ? 'A stand-in for Ramp built on Burn\'s Ramp mock: real field names, simulated approvals and charges.' : 'Available in mock mode only.'}</span>
      </div>
      <nav style={{display: 'flex', gap: 4, borderBottom: `1px solid ${C.line}`}}>
        {tabs.map(([k, label]) => <button key={k} onClick={() => pick(k)} style={{background: 'transparent', border: 0, borderBottom: `2px solid ${tab === k ? C.ink : 'transparent'}`, marginBottom: -1, padding: '8px 12px', fontSize: 13, color: tab === k ? C.ink : C.muted, cursor: 'pointer'}}>{label}</button>)}
      </nav>
      {error && <div role="alert" style={{color: C.critical}}>{error}</div>}

      {tab === 'inbox' && <>
        <Label>Needs your approval</Label>
        {!pending.length && <Empty>Nothing waiting. When an engineer okays an order, Burn's purchase request appears here with its reasoning.</Empty>}
        {pending.map(r => <RequestCard key={r.id} r={r} busy={busy === r.id} onDecide={what => decide(r, what)}/>)}
        {!!decided.length && <><Label>Decided</Label>
          <div style={{border: `1px solid ${C.line}`, borderRadius: 12, background: '#fff', overflow: 'hidden'}}>
            {decided.map(r => <Row key={r.id} href={`/orders/${r.orderId}`} cols="minmax(0,1.6fr) 1fr 1fr 1fr auto">
              <span style={{minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{r.order?.entry.name || r.name}</span>
              <span style={{color: C.muted}}>{r.requester}</span><span>{money(r.amountCents)}</span>
              <span style={{color: C.muted}}>{r.approvedAt ? `approved ${relTime(r.approvedAt)}` : r.status.toLowerCase()}</span>
              {r.order ? <StateBadge state={r.order.state}/> : <Chip>{r.status}</Chip>}
            </Row>)}
          </div></>}
      </>}

      {tab === 'cards' && <>
        <Label>Virtual cards</Label>
        {!data.cards.length && <Empty>No cards yet. Ramp issues one per approved order: Xometry only, the approved amount, locked when the quote expires.</Empty>}
        {!!data.cards.length && <div style={{border: `1px solid ${C.line}`, borderRadius: 12, background: '#fff', overflow: 'hidden'}}>
          <Row head cols="minmax(0,1.5fr) 1fr 1fr 1fr 1fr auto"><span>Order</span><span>Card</span><span>Limit · spent</span><span>Allowed vendor</span><span>Locks</span><span/></Row>
          {data.cards.map(c => <Row key={c.id} href={`/orders/${c.orderId}`} cols="minmax(0,1.5fr) 1fr 1fr 1fr 1fr auto">
            <span style={{minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{c.order?.entry.name || c.orderId}<span style={{color: C.muted}}> · {c.order?.entry.engineer}</span></span>
            <span style={{fontVariantNumeric: 'tabular-nums'}}>•••• {c.last4}</span>
            <span>{money(c.limitCents)}<span style={{color: C.muted}}> · {money(c.spentCents)}</span></span>
            <span>{c.allowedVendors.join(', ')}</span>
            <span style={{color: C.muted}}>{day(c.lockDate)}</span>
            <Chip tone={c.state === 'active' ? 'ink' : 'muted'}>{c.state}</Chip>
          </Row>)}
        </div>}
      </>}

      {tab === 'transactions' && <>
        <Label>Transactions</Label>
        {!data.transactions.length && <Empty>No charges yet. When Xometry charges the card, the transaction appears here and Burn attaches the receipt, memo and project code.</Empty>}
        {data.transactions.slice().reverse().map(t => <div key={t.id} style={{border: `1px solid ${C.line}`, borderRadius: 12, background: '#fff', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8}}>
          <div style={{display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap'}}>
            <span style={{fontSize: 16}}>{money(t.amountCents)}</span>
            <span>{t.merchant}</span>
            <span style={{color: C.muted}}>{t.at ? day(t.at) : ''} · {t.status.toLowerCase()} · card ending {data.cards.find(c => c.id === t.cardId)?.last4 || '····'}</span>
            <a href={`/orders/${t.orderId}`} style={{marginLeft: 'auto', color: C.muted}}>{t.order?.entry.name || 'order'} →</a>
          </div>
          {t.booking ? <div style={{display: 'grid', gridTemplateColumns: 'max-content minmax(0,1fr)', columnGap: 14, rowGap: 4, fontSize: 12}}>
            <span style={{color: C.muted}}>memo</span><span>{t.booking.memo}</span>
            <span style={{color: C.muted}}>receipt</span><span>{t.booking.receipt ? t.booking.receipt.fileName : <span style={{color: C.critical}}>missing</span>}</span>
            <span style={{color: C.muted}}>coding</span><span>{t.booking.coding ? Object.entries(t.booking.coding).filter(([, v]) => v != null).map(([k, v]) => `${k}: ${v}`).join(' · ') : '—'}</span>
          </div> : <span style={{color: C.muted, fontSize: 12}}>Awaiting booking from Burn.</span>}
        </div>)}
      </>}
    </main>
  </div>;
}

function RequestCard({r, busy, onDecide}) {
  const o = r.order, f = o?.frozen;
  const cutoff = r.cutoff ? new Date(r.cutoff) : null, late = cutoff && cutoff < new Date();
  return <div style={{border: `1px solid ${C.ink}`, borderRadius: 12, background: '#fff', padding: 18, display: 'flex', flexDirection: 'column', gap: 12}}>
    <div style={{display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap'}}>
      <span style={{fontSize: 18, letterSpacing: '-.01em'}}>{money(r.amountCents)}</span>
      <span>{r.requester} · {r.vendor === 'xometry' ? 'Xometry' : r.vendor}</span>
      <a href={`/orders/${r.orderId}`} style={{color: C.muted}}>{o?.entry.name || r.name} →</a>
      <span style={{marginLeft: 'auto', color: C.muted, fontSize: 12}}>requested {relTime(r.createdAt)}</span>
    </div>
    {cutoff && <div style={{fontSize: 12, color: late ? C.critical : C.ink, background: late ? 'transparent' : C.accent, border: `1px solid ${late ? C.critical : C.accent}`, borderRadius: 8, padding: '6px 10px', alignSelf: 'flex-start'}}>
      {late ? `Vendor cutoff ${cutoff.toLocaleTimeString('en-US', {hour: 'numeric', minute: '2-digit'})} passed: production starts the next business day.` : `Approve by ${cutoff.toLocaleTimeString('en-US', {hour: 'numeric', minute: '2-digit'})} today to start production today.`}
    </div>}
    <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16}}>
      <div style={{display: 'flex', flexDirection: 'column', gap: 4}}>
        <Label>Burn's justification</Label>
        <div style={{whiteSpace: 'pre-wrap', lineHeight: 1.45, fontSize: 12}}>{r.justification}</div>
      </div>
      <div style={{display: 'flex', flexDirection: 'column', gap: 4}}>
        <Label>Exactly what will be bought</Label>
        <div style={{display: 'grid', gridTemplateColumns: 'max-content minmax(0,1fr)', columnGap: 12, rowGap: 3, fontSize: 12}}>
          <span style={{color: C.muted}}>part</span><span>{o?.entry.name}{o?.entry.note ? <span style={{color: C.muted}}> · “{o.entry.note}”</span> : ''}</span>
          <span style={{color: C.muted}}>tier</span><span>{f?.tier}{r.recommendedTier && r.recommendedTier !== r.chosenTier ? <span style={{color: C.muted}}> (Burn recommended {r.recommendedTier})</span> : ''}{f?.readyOn ? ` · ready ${day(f.readyOn)}` : ''}</span>
          {f?.fields && Object.entries(f.fields).filter(([k]) => k !== '__fault').map(([k, v]) => <React.Fragment key={k}><span style={{color: C.muted}}>{k}</span><span>{String(v)}</span></React.Fragment>)}
          {o?.milestoneLabel && <><span style={{color: C.muted}}>feeds</span><span>{o.milestoneLabel}</span></>}
          <span style={{color: C.muted}}>bound to</span><span style={{color: C.muted}} title={r.specHash}>spec {r.specHash?.slice(0, 8)} · decision r{r.decisionRevision}</span>
        </div>
      </div>
    </div>
    <div style={{display: 'flex', gap: 8, alignItems: 'center'}}>
      <Button primary disabled={busy} onClick={() => onDecide('approve')}>Approve</Button>
      <Button disabled={busy} onClick={() => onDecide('reject')}>Reject</Button>
      <span style={{color: C.faint, fontSize: 11, marginLeft: 6}}>Approving issues a Xometry-only card for this amount and lets Burn place the frozen order. Simulated.</span>
    </div>
  </div>;
}

const Label = ({children}) => <div style={{fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: C.muted}}>{children}</div>;
const Empty = ({children}) => <div style={{color: C.muted, padding: '18px 0'}}>{children}</div>;
function Row({cols, head, href, children}) {
  const style = {display: 'grid', gridTemplateColumns: cols, gap: 10, alignItems: 'center', padding: head ? '8px 14px' : '10px 14px', borderTop: head ? 0 : `1px solid ${C.hair}`, textDecoration: 'none', color: C.ink, ...(head ? {fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: C.muted, borderBottom: `1px solid ${C.line}`} : {})};
  return href ? <a href={href} style={style}>{children}</a> : <div style={style}>{children}</div>;
}
