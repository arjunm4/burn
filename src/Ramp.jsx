import React from 'react';
import {api} from './api.js';
import {C, Page, Button, Chip, StateBadge, Eyebrow, Fold, Rows, money, day, clock, relTime} from './ui.jsx';

/**
 * /ramp: what the approver sees. A Ramp-style surface over the Ramp mock's records: the manager's
 * inbox, the virtual cards and the transactions with Burn's bookkeeping on them.
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
  const tabs = [['inbox', `Approvals${pending.length ? ` · ${pending.length}` : ''}`], ['cards', `Cards · ${data.cards.length}`], ['transactions', `Transactions · ${data.transactions.length}`]];
  return <Page system={system} width={960} style={{display: 'flex', flexDirection: 'column', gap: 20}}>
    <div style={{display: 'flex', gap: 10, alignItems: 'baseline'}}><span style={{fontSize: 24, letterSpacing: '-.02em'}}>Ramp</span><Chip>simulated</Chip></div>
    <nav style={{display: 'flex', gap: 4, borderBottom: `1px solid ${C.line}`}}>
      {tabs.map(([k, label]) => <button key={k} onClick={() => pick(k)} style={{background: 'transparent', border: 0, borderBottom: `2px solid ${tab === k ? C.ink : 'transparent'}`, marginBottom: -1, padding: '8px 12px', fontSize: 13, color: tab === k ? C.ink : C.muted, cursor: 'pointer'}}>{label}</button>)}
    </nav>
    {error && <div role="alert" style={{color: C.critical}}>{error}</div>}

    {tab === 'inbox' && <>
      {!pending.length && <Empty>Nothing waiting.</Empty>}
      {pending.map(r => <RequestCard key={r.id} r={r} busy={busy === r.id} onDecide={what => decide(r, what)}/>)}
      {!!decided.length && <>
        <Eyebrow>Decided</Eyebrow>
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
      {!data.cards.length && <Empty>No cards yet.</Empty>}
      {!!data.cards.length && <div style={{border: `1px solid ${C.line}`, borderRadius: 12, background: '#fff', overflow: 'hidden'}}>
        <Row head cols="minmax(0,1.5fr) 1fr 1fr 1fr 1fr auto"><span>Order</span><span>Card</span><span>Limit · spent</span><span>Vendor</span><span>Locks</span><span/></Row>
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
      {!data.transactions.length && <Empty>No charges yet.</Empty>}
      {data.transactions.slice().reverse().map(t => <div key={t.id} style={{border: `1px solid ${C.line}`, borderRadius: 12, background: '#fff', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8}}>
        <div style={{display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap'}}>
          <span style={{fontSize: 16}}>{money(t.amountCents)}</span>
          <span>{t.merchant}</span>
          <span style={{color: C.muted}}>{t.at ? day(t.at) : ''} · {t.status.toLowerCase()} · •••• {data.cards.find(c => c.id === t.cardId)?.last4 || '····'}</span>
          <a href={`/orders/${t.orderId}`} style={{marginLeft: 'auto', color: C.muted}}>{t.order?.entry.name || 'order'} →</a>
        </div>
        {t.booking ? <div style={{fontSize: 12}}><Rows gap={3} rows={[
          ['memo', t.booking.memo.split(/[.:]\s/)[0]],
          ['receipt', t.booking.receipt ? t.booking.receipt.fileName : <span style={{color: C.critical}}>missing</span>],
          t.booking.coding?.project && ['project', t.booking.coding.project],
        ]}/></div> : <span style={{color: C.muted, fontSize: 12}}>Awaiting booking.</span>}
      </div>)}
    </>}
  </Page>;
}

function RequestCard({r, busy, onDecide}) {
  const o = r.order, f = o?.frozen;
  const cutoff = r.cutoff ? new Date(r.cutoff) : null, late = cutoff && cutoff < new Date();
  // The justification Burn sent is prose, then "Assumptions:" and the cutoff. Lead with the prose.
  const [lead, ...rest] = (r.justification || '').split(/\n\n(?=Assumptions:)/);
  const spec = f?.fields ? Object.entries(f.fields).filter(([k]) => k !== '__fault') : [];
  return <div style={{border: `1px solid ${C.ink}`, borderRadius: 12, background: '#fff', padding: 18, display: 'flex', flexDirection: 'column', gap: 14}}>
    <div style={{display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap'}}>
      <span style={{fontSize: 20, letterSpacing: '-.01em'}}>{money(r.amountCents)}</span>
      <a href={`/orders/${r.orderId}`} style={{color: C.ink}}>{o?.entry.name || r.name}</a>
      <span style={{color: C.muted}}>{r.requester} · {r.vendor === 'xometry' ? 'Xometry' : r.vendor} · {f?.tier}{f?.readyOn ? `, ready ${day(f.readyOn)}` : ''}</span>
      <span style={{marginLeft: 'auto', color: C.muted, fontSize: 12}}>{relTime(r.createdAt)}</span>
    </div>
    <div style={{lineHeight: 1.5, fontSize: 14}}>{lead}</div>
    {cutoff && <div style={{fontSize: 12, color: late ? C.critical : C.muted}}>{late ? `Vendor cutoff ${clock(cutoff)} passed; production starts the next business day.` : `Approve by ${clock(cutoff)} to start production today.`}</div>}
    <div style={{display: 'flex', gap: 8, alignItems: 'center'}}>
      <Button primary disabled={busy} onClick={() => onDecide('approve')}>Approve</Button>
      <Button disabled={busy} onClick={() => onDecide('reject')}>Reject</Button>
      {r.recommendedTier && r.recommendedTier !== r.chosenTier && <span style={{color: C.muted, fontSize: 12, marginLeft: 6}}>Burn recommended {r.recommendedTier}.</span>}
    </div>
    <Fold title="Details">
      <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, fontSize: 12}}>
        <div style={{whiteSpace: 'pre-wrap', lineHeight: 1.45, color: C.muted}}>{rest.join('\n\n').replace(/approve by \S+ to/, m => m.replace(/\S+ to$/, `${clock(cutoff)} to`))}</div>
        <Rows gap={3} rows={[...spec.map(([k, v]) => [k, String(v)]), o?.milestoneLabel && ['feeds', o.milestoneLabel]]}/>
      </div>
    </Fold>
  </div>;
}

const Empty = ({children}) => <div style={{color: C.muted, padding: '12px 0'}}>{children}</div>;
function Row({cols, head, href, children}) {
  const style = {display: 'grid', gridTemplateColumns: cols, gap: 10, alignItems: 'center', padding: head ? '8px 14px' : '10px 14px', borderTop: head ? 0 : `1px solid ${C.hair}`, textDecoration: 'none', color: C.ink, ...(head ? {fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: C.muted, borderBottom: `1px solid ${C.line}`} : {})};
  return href ? <a href={href} style={style}>{children}</a> : <div style={style}>{children}</div>;
}
