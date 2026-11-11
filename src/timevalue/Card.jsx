import React from 'react';
import precomputed from '../../fixtures/timevalue/demo-cards.json';

// Time Value: the recommendation card for the demo order.
// Reads /api/timevalue/demo?change=N; falls back to fixtures/timevalue/demo-cards.json. No model call.
const C = {ink: '#1C1B17', paper: '#F4F2F0', muted: '#7A766F', line: '#E2DFDA', hair: '#EFECE8', faint: '#C9C5BE', accent: '#E4F222', critical: '#D03B3B'};
const eyebrow = {fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: C.muted};
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const day = d => { if (!d) return '—'; const x = new Date(String(d).slice(0, 10) + 'T00:00:00Z'); return `${WD[x.getUTCDay()]} ${x.getUTCMonth() + 1}/${x.getUTCDate()}`; };
const range = r => (!r ? '—' : typeof r === 'object' ? (r.min === r.max ? day(r.min) : `${day(r.min)} – ${day(r.max)}`) : day(r));
const money = n => (n == null ? '—' : '$' + Math.round(n).toLocaleString('en-US'));
const STATUS = {pass: {mark: '✓', color: C.ink}, fail: {mark: '✕', color: C.critical}, unknown: {mark: '?', color: C.muted}, info: {mark: '·', color: C.muted}};
const CHANGES = [
  {n: 0, label: '10:30 · motor on time'},
  {n: 1, label: '10:45 · motor slips'},
  {n: 2, label: '11:00 · motor unsure'},
  {n: 3, label: '11:15 · sources disagree'},
];
const WASTED = {count: 61, expedited: 133, premium_usd: 31159};

// The brief "changed" highlight (respects prefers-reduced-motion).
const CHANGED_CSS = `
@keyframes tv-flash { from { background-color: ${C.accent}; } to { background-color: transparent; } }
.tv-changed { animation: tv-flash 1.6s ease-out; border-radius: 4px; }
.tv-tag { margin-left: 8px; font-size: 10px; letter-spacing: .06em; text-transform: uppercase; padding: 1px 6px; border-radius: 8px; background: ${C.accent}; color: ${C.ink}; vertical-align: middle; }
@media (prefers-reduced-motion: reduce) { .tv-changed { animation: none; outline: 2px solid ${C.accent}; } }
`;
const motorReady = card => card?.inputs?.[0]?.ready_text ?? null;
const recTier = card => card?.recommended ?? null;
function Changed({on}) { return on ? <span className="tv-tag">changed</span> : null; }

function sourceLabel(id) {
  const s = String(id);
  if (s.startsWith('slack:')) return 'Slack #actuators';
  if (s.startsWith('cal:')) return 'Calendar';
  if (s.startsWith('jira:')) return `Jira ${s.split(':')[1]}`;
  if (s.startsWith('meeting:')) return 'Meeting notes';
  if (s.includes('quote')) return 'Xometry quote';
  if (s.includes('policy')) return 'Milestone policy';
  if (s.includes('part-entry')) return 'Part entry';
  return s;
}

export default function TimeValue() {
  const [change, setChange] = React.useState(() => Number(new URLSearchParams(location.search).get('change')) || 0);
  const [data, setData] = React.useState(null);
  const [offline, setOffline] = React.useState(false);
  const prevRef = React.useRef(null);
  const [prev, setPrev] = React.useState(null);

  React.useEffect(() => {
    let live = true;
    const show = (d, isOffline) => { if (!live) return; setPrev(prevRef.current); prevRef.current = d?.card || null; setData(d); setOffline(isOffline); };
    fetch(`/api/timevalue/demo?change=${change}`).then(r => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
      .then(d => (d?.card ? show(d, false) : Promise.reject(new Error('no card'))))
      .catch(() => show(precomputed.cards?.[change] || null, true));
    const url = new URL(location.href); if (change) url.searchParams.set('change', change); else url.searchParams.delete('change');
    history.replaceState(null, '', url);
    return () => { live = false; };
  }, [change]);

  const card = data?.card;
  const wasted = card?.wasted || precomputed.cards?.[0]?.card?.wasted || WASTED;
  const changed = prev && card ? {motor: motorReady(prev) !== motorReady(card), tier: recTier(prev) !== recTier(card)} : {motor: false, tier: false};
  return <div style={{minHeight: '100vh', fontSize: 13, display: 'flex', flexDirection: 'column'}}>
    <header style={{display: 'flex', alignItems: 'center', gap: 18, padding: '14px 24px', borderBottom: `1px solid ${C.line}`}}>
      <span style={{fontSize: 16, letterSpacing: '.04em'}}>ramp</span>
      <span style={{color: C.muted}}>Procurement</span><span style={{color: C.faint}}>/</span><span>Time Value</span>
      <a href="/request" style={{marginLeft: 'auto', color: C.muted, fontSize: 12}}>Requests →</a>
    </header>
    <style>{CHANGED_CSS}</style>
    <main style={{flex: 1, padding: '28px 24px 60px', display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 1180, width: '100%', boxSizing: 'border-box', margin: '0 auto'}}>
      <div role="note" style={{padding: '10px 14px', border: `1px solid ${C.critical}`, borderLeft: `4px solid ${C.critical}`, borderRadius: 6, background: '#fff', lineHeight: 1.45}}>
        <span style={{...eyebrow, color: C.critical, marginRight: 8}}>Wasted</span>
        Last 3 months at Flintlock: <b style={{fontWeight: 500}}>{wasted.count} of {wasted.expedited}</b> rush orders bought no time — <b style={{fontWeight: 500}}>{money(wasted.premium_usd)}</b> in premiums.
      </div>
      <div style={{display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap'}}>
        <div style={{display: 'flex', flexDirection: 'column', gap: 4}}>
          <div style={{fontSize: 22, letterSpacing: '-.02em'}}>Which tier is worth it?</div>
          <div style={{color: C.muted}}>Schedule maths over the dependency graph · no model call{offline ? ' · precomputed (server unavailable)' : ''}</div>
        </div>
        <div role="tablist" aria-label="Live changes" style={{marginLeft: 'auto', display: 'flex', border: `1px solid ${C.line}`, borderRadius: 6, overflow: 'hidden', background: '#fff'}}>
          {CHANGES.map((c, i) => <button key={c.n} role="tab" aria-selected={change === c.n} onClick={() => setChange(c.n)}
            style={{border: 0, borderLeft: i ? `1px solid ${C.line}` : 0, padding: '7px 12px', fontSize: 12, cursor: 'pointer', background: change === c.n ? C.ink : '#fff', color: change === c.n ? C.paper : C.ink}}>{c.label}</button>)}
        </div>
      </div>

      {!card && <span style={{color: C.muted}}>{offline ? 'No card available: the server is down and there is no precomputed card for this change.' : 'Loading card…'}</span>}
      {card && <Recommendation key={card.change?.n ?? 0} card={card} changed={changed}/>}
    </main>
  </div>;
}

function Recommendation({card, changed = {}}) {
  const ask = card.outcome === 'depends' || card.outcome === 'ask_owner' || (card.outcome === 'blocked' && card.outcome_tag === 'Ask first');
  return <article style={{background: '#fff', border: `1px solid ${C.line}`, borderRadius: 12, overflow: 'hidden', display: 'flex', flexDirection: 'column'}}>
    {card.change && <div role="status" style={{padding: '10px 16px', background: C.paper, borderBottom: `1px solid ${C.line}`, display: 'flex', flexDirection: 'column', gap: 3}}>
      <span style={eyebrow}>New in Slack · {String(card.change.at || '').slice(11, 16)}</span>
      <span style={{lineHeight: 1.45}}><b style={{fontWeight: 500}}>{card.change.by}</b> in #actuators: “{card.change.text}”</span>
    </div>}

    <div style={{padding: 16, display: 'flex', flexDirection: 'column', gap: 4, borderBottom: `1px solid ${C.hair}`}}>
      <span style={eyebrow}>Part entry · {card.part.requester || 'unknown requester'}</span>
      <span style={{fontSize: 17}}>{card.part.quantity}× {card.part.name} <span style={{color: C.muted}}>{card.part.number} rev {card.part.revision}</span></span>
      <span style={{color: C.muted, lineHeight: 1.45}}>“{card.part.summary}” · {[card.part.material, card.part.process, card.part.finish].filter(Boolean).join(' · ')} · {card.part.cad_file}</span>
      {card.test?.name && <span style={{color: C.muted}}>For the {card.test.name} ({card.test.duration_days ?? '?'} working days, owner {card.test.owner || 'unknown'}) → {card.milestone?.name}{card.milestone?.target ? `, target ${day(card.milestone.target)}` : ''}</span>}
    </div>

    <div style={{padding: 16, display: 'flex', flexDirection: 'column', gap: 8, borderBottom: `1px solid ${C.hair}`}}>
      <span style={{alignSelf: 'flex-start', display: 'flex', alignItems: 'center'}}><span style={{fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', padding: '2px 8px', borderRadius: 10, background: ask ? '#fff' : C.accent, border: `1px solid ${ask ? C.ink : C.accent}`}} className={changed.tier ? 'tv-changed' : undefined}>{card.outcome_tag}</span>{changed.tier && <Changed on/>}</span>
      <div style={{fontSize: 18, letterSpacing: '-.01em', lineHeight: 1.35, textWrap: 'pretty'}}>{card.headline}</div>
      {(card.detail || []).map((d, i) => <div key={i} style={{lineHeight: 1.5, color: d.startsWith('Ask ') ? C.ink : C.muted, ...(d.startsWith('Ask ') ? {padding: '8px 10px', borderLeft: `2px solid ${C.ink}`, background: C.paper, borderRadius: 4} : {})}}>{d}</div>)}
    </div>

    {card.dominated?.length > 0 && <div role="alert" style={{margin: '12px 16px 0', padding: '8px 10px', borderLeft: `3px solid ${C.critical}`, background: '#FBEDED', color: C.critical, borderRadius: 4, lineHeight: 1.45}}>
      {card.dominated.map((d, i) => <div key={i}>{d}</div>)}
    </div>}
    <table style={{width: '100%', borderCollapse: 'collapse', fontSize: 13}}>
      <thead><tr style={eyebrow}>{['Tier', 'Price', 'Part ready', 'Test done', 'Days saved', 'Break-even'].map(h => <th key={h} style={{fontWeight: 400, textAlign: 'left', padding: '10px 16px 6px'}}>{h}</th>)}</tr></thead>
      <tbody>{(card.tiers || []).map(t => <tr key={t.tier} style={{background: t.recommended ? C.paper : '#fff'}}>
        <td style={{padding: '9px 16px', borderTop: `1px solid ${C.hair}`}}>{t.label}{t.recommended && <span className={changed.tier ? 'tv-changed' : undefined} style={{marginLeft: 8, fontSize: 10, letterSpacing: '.06em', textTransform: 'uppercase', color: C.muted}}>preselected</span>}
          {t.no_faster_than && <span style={{marginLeft: 8, fontSize: 10, letterSpacing: '.06em', textTransform: 'uppercase', color: C.critical}}>no faster than {t.no_faster_than}</span>}</td>
        <td style={{padding: '9px 16px', borderTop: `1px solid ${C.hair}`, fontVariantNumeric: 'tabular-nums'}}>{money(t.total)}</td>
        <td style={{padding: '9px 16px', borderTop: `1px solid ${C.hair}`}}>{day(t.ready)}</td>
        <td style={{padding: '9px 16px', borderTop: `1px solid ${C.hair}`}}>{range(t.finish)}</td>
        <td style={{padding: '9px 16px', borderTop: `1px solid ${C.hair}`, color: C.muted}}>{t.days_saved == null ? '—' : t.days_saved}</td>
        <td style={{padding: '9px 16px', borderTop: `1px solid ${C.hair}`, color: C.muted}}>{t.break_even == null ? '—' : `${money(t.break_even)}/day`}</td>
      </tr>)}</tbody>
    </table>

    {card.inputs?.length > 0 && <div style={{padding: 16, display: 'flex', flexDirection: 'column', gap: 6, borderTop: `1px solid ${C.hair}`}}>
      <span style={eyebrow}>The test also waits on</span>
      {card.inputs.map(i => <div key={i.id} style={{display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline'}}>
        <span>{i.name}</span><span className={changed.motor ? 'tv-changed' : undefined} style={{color: C.muted, padding: '0 2px'}}>ready {i.ready_text}</span>{changed.motor && <Changed on/>}
        {i.said_by && <span style={{color: C.muted, fontSize: 12}}>· {i.said_by}, {i.said_ago}{i.doc_id ? ` · ${sourceLabel(i.doc_id)}` : ''}</span>}
      </div>)}
    </div>}

    <div style={{padding: 16, display: 'flex', flexDirection: 'column', gap: 8, borderTop: `1px solid ${C.hair}`}}>
      <span style={eyebrow}>Checks</span>
      {(card.checks || []).map(k => { const s = STATUS[k.status] || STATUS.info; return <div key={k.n} style={{display: 'grid', gridTemplateColumns: '18px minmax(0,1fr)', gap: 8}}>
        <span aria-label={k.status} style={{color: s.color, textAlign: 'center'}}>{s.mark}</span>
        <span style={{display: 'flex', flexDirection: 'column', gap: 1}}>
          {k.items ? <>
            <span style={{fontWeight: 500}}>{k.label}</span>
            {k.items.map((i, j) => <span key={j} style={{display: 'flex', flexDirection: 'column', gap: 1, paddingLeft: 8, borderLeft: `2px solid ${i.status === 'fail' ? C.critical : C.hair}`}}>
              <span style={{color: i.status === 'fail' ? C.critical : C.muted}}>{(STATUS[i.status] || STATUS.info).mark} {i.text}</span>
              {i.question && <span>Ask {i.question.to_name || 'the owner'}: "{i.question.text}"</span>}
              <span style={{fontSize: 11, color: C.muted}}>{[...new Set((i.sources || []).map(sourceLabel))].join(' · ')}</span>
            </span>)}
          </> : <>
          <span><span style={{fontWeight: 500}}>{k.label}.</span> <span style={{color: C.muted}}>{k.text}</span></span>
          {k.sources?.length > 0 && <span style={{fontSize: 11, color: C.muted}}>{[...new Set(k.sources.map(sourceLabel))].join(' · ')}</span>}
          </>}
        </span>
      </div>; })}
      {card.guards?.filter(g => !g.ok).map(g => <div key={g.rule} role="alert" style={{fontSize: 12, color: C.critical}}>Guard failed: {g.rule}</div>)}
    </div>

  </article>;
}
