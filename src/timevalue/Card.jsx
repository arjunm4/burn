import React from 'react';
import HeatMap from './HeatMap.jsx';

// The habit model is tabled (Owen, 2026-11-10): the card shows the schedule decision only.
const SHOW_HABIT = false;
import precomputed from '../../fixtures/timevalue/demo-cards.json';

// Time Value: the recommendation card for the demo order, plus the habit model's weights.
// Reads /api/timevalue/demo?change=N; falls back to fixtures/timevalue/demo-cards.json. No model call.
const C = {ink: '#1C1B17', paper: '#F4F2F0', muted: '#7A766F', line: '#E2DFDA', hair: '#EFECE8', faint: '#C9C5BE', accent: '#E4F222', critical: '#D03B3B'};
const eyebrow = {fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: C.muted};
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const day = d => { if (!d) return '—'; const x = new Date(String(d).slice(0, 10) + 'T00:00:00Z'); return `${WD[x.getUTCDay()]} ${x.getUTCMonth() + 1}/${x.getUTCDate()}`; };
const range = r => (!r ? '—' : typeof r === 'object' ? (r.min === r.max ? day(r.min) : `${day(r.min)} – ${day(r.max)}`) : day(r));
const money = n => (n == null ? '—' : '$' + Math.round(n).toLocaleString('en-US'));
const STATUS = {pass: {mark: '✓', color: C.ink}, fail: {mark: '✕', color: C.critical}, unknown: {mark: '?', color: C.muted}, info: {mark: '·', color: C.muted}};
const CHANGES = [
  {n: 0, label: 'As of 10:30'},
  {n: 1, label: 'Change 1: motor slips'},
  {n: 2, label: 'Change 2: motor uncertain'},
];

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
  const [habit, setHabit] = React.useState(null);
  const [offline, setOffline] = React.useState(false);

  React.useEffect(() => {
    let live = true;
    fetch(`/api/timevalue/demo?change=${change}`).then(r => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
      .then(d => { if (live) { setData(d); setOffline(false); } })
      .catch(() => { if (live) { setData(precomputed.cards?.[change] || null); setOffline(true); } });
    const url = new URL(location.href); if (change) url.searchParams.set('change', change); else url.searchParams.delete('change');
    history.replaceState(null, '', url);
    return () => { live = false; };
  }, [change]);
  React.useEffect(() => {
    fetch('/api/timevalue/habit').then(r => (r.ok ? r.json() : Promise.reject())).then(h => setHabit(h?.weights ? h : precomputed.habit)).catch(() => setHabit(precomputed.habit));
  }, []);

  const card = data?.card;
  return <div style={{minHeight: '100vh', fontSize: 13, display: 'flex', flexDirection: 'column'}}>
    <header style={{display: 'flex', alignItems: 'center', gap: 18, padding: '14px 24px', borderBottom: `1px solid ${C.line}`}}>
      <span style={{fontSize: 16, letterSpacing: '.04em'}}>ramp</span>
      <span style={{color: C.muted}}>Procurement</span><span style={{color: C.faint}}>/</span><span>Time Value</span>
      <a href="/request" style={{marginLeft: 'auto', color: C.muted, fontSize: 12}}>Requests →</a>
    </header>
    <main style={{flex: 1, padding: '28px 24px 60px', display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 1180, width: '100%', boxSizing: 'border-box', margin: '0 auto'}}>
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

      {!card && <span style={{color: C.muted}}>Loading card…</span>}
      {card && <div style={{display: 'grid', gridTemplateColumns: SHOW_HABIT ? 'minmax(0, 1.25fr) minmax(0, 1fr)' : 'minmax(0, 1fr)', gap: 20, alignItems: 'start'}} data-graph-grid>
        <Recommendation card={card}/>
        {SHOW_HABIT && <section style={{background: '#fff', border: `1px solid ${C.line}`, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 12}}>
          <div style={{display: 'flex', flexDirection: 'column', gap: 2}}>
            <span style={eyebrow}>Habit model · advisory</span>
            <span style={{color: C.muted, lineHeight: 1.45}}>What in the 30 days of conversation before an order made this team expedite. It never sets the tier.</span>
          </div>
          <HeatMap habit={habit} top={card.habit?.top || []}/>
        </section>}
      </div>}
    </main>
  </div>;
}

function Recommendation({card}) {
  const ask = card.outcome === 'depends' || card.outcome === 'ask_owner' || (card.outcome === 'blocked' && card.outcome_tag === 'Ask first');
  return <article style={{background: '#fff', border: `1px solid ${C.line}`, borderRadius: 12, overflow: 'hidden', display: 'flex', flexDirection: 'column'}}>
    {card.change && <div role="status" style={{padding: '10px 16px', background: C.paper, borderBottom: `1px solid ${C.line}`, display: 'flex', flexDirection: 'column', gap: 3}}>
      <span style={eyebrow}>New in Slack · {card.change.label}</span>
      <span style={{lineHeight: 1.45}}><b style={{fontWeight: 500}}>{card.change.by}</b> in #actuators: “{card.change.text}”</span>
    </div>}

    <div style={{padding: 16, display: 'flex', flexDirection: 'column', gap: 4, borderBottom: `1px solid ${C.hair}`}}>
      <span style={eyebrow}>Part entry · {card.part.requester}</span>
      <span style={{fontSize: 17}}>{card.part.quantity}× {card.part.name} <span style={{color: C.muted}}>{card.part.number} rev {card.part.revision}</span></span>
      <span style={{color: C.muted, lineHeight: 1.45}}>“{card.part.summary}” · {[card.part.material, card.part.process, card.part.finish].filter(Boolean).join(' · ')} · {card.part.cad_file}</span>
      {card.test?.name && <span style={{color: C.muted}}>For the {card.test.name} ({card.test.duration_days ?? '?'} working days, owner {card.test.owner || 'unknown'}) → {card.milestone?.name}{card.milestone?.target ? `, target ${day(card.milestone.target)}` : ''}</span>}
    </div>

    <div style={{padding: 16, display: 'flex', flexDirection: 'column', gap: 8, borderBottom: `1px solid ${C.hair}`}}>
      <span style={{alignSelf: 'flex-start', fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', padding: '2px 8px', borderRadius: 10, background: ask ? '#fff' : C.accent, border: `1px solid ${ask ? C.ink : C.accent}`}}>{card.outcome_tag}</span>
      <div style={{fontSize: 18, letterSpacing: '-.01em', lineHeight: 1.35, textWrap: 'pretty'}}>{card.headline}</div>
      {card.detail.map((d, i) => <div key={i} style={{lineHeight: 1.5, color: d.startsWith('Ask ') ? C.ink : C.muted, ...(d.startsWith('Ask ') ? {padding: '8px 10px', borderLeft: `2px solid ${C.ink}`, background: C.paper, borderRadius: 4} : {})}}>{d}</div>)}
    </div>

    <table style={{width: '100%', borderCollapse: 'collapse', fontSize: 13}}>
      <thead><tr style={eyebrow}>{['Tier', 'Price', 'Part ready', 'Test done', 'Days saved', 'Break-even'].map(h => <th key={h} style={{fontWeight: 400, textAlign: 'left', padding: '10px 16px 6px'}}>{h}</th>)}</tr></thead>
      <tbody>{card.tiers.map(t => <tr key={t.tier} style={{background: t.recommended ? C.paper : '#fff'}}>
        <td style={{padding: '9px 16px', borderTop: `1px solid ${C.hair}`}}>{t.label}{t.recommended && <span style={{marginLeft: 8, fontSize: 10, letterSpacing: '.06em', textTransform: 'uppercase', color: C.muted}}>preselected</span>}</td>
        <td style={{padding: '9px 16px', borderTop: `1px solid ${C.hair}`, fontVariantNumeric: 'tabular-nums'}}>{money(t.total)}</td>
        <td style={{padding: '9px 16px', borderTop: `1px solid ${C.hair}`}}>{day(t.ready)}</td>
        <td style={{padding: '9px 16px', borderTop: `1px solid ${C.hair}`}}>{range(t.finish)}</td>
        <td style={{padding: '9px 16px', borderTop: `1px solid ${C.hair}`, color: C.muted}}>{t.days_saved == null ? '—' : t.days_saved}</td>
        <td style={{padding: '9px 16px', borderTop: `1px solid ${C.hair}`, color: C.muted}}>{t.break_even == null ? '—' : `${money(t.break_even)}/day`}</td>
      </tr>)}</tbody>
    </table>

    {card.inputs.length > 0 && <div style={{padding: 16, display: 'flex', flexDirection: 'column', gap: 6, borderTop: `1px solid ${C.hair}`}}>
      <span style={eyebrow}>The test also waits on</span>
      {card.inputs.map(i => <div key={i.id} style={{display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline'}}>
        <span>{i.name}</span><span style={{color: C.muted}}>ready {i.ready_text}</span>
        {i.said_by && <span style={{color: C.muted, fontSize: 12}}>· {i.said_by}, {i.said_ago}{i.doc_id ? ` · ${sourceLabel(i.doc_id)}` : ''}</span>}
      </div>)}
    </div>}

    <div style={{padding: 16, display: 'flex', flexDirection: 'column', gap: 8, borderTop: `1px solid ${C.hair}`}}>
      <span style={eyebrow}>Checks</span>
      {card.checks.map(k => { const s = STATUS[k.status] || STATUS.info; return <div key={k.n} style={{display: 'grid', gridTemplateColumns: '18px minmax(0,1fr)', gap: 8}}>
        <span aria-label={k.status} style={{color: s.color, textAlign: 'center'}}>{s.mark}</span>
        <span style={{display: 'flex', flexDirection: 'column', gap: 1}}>
          <span><span style={{fontWeight: 500}}>{k.label}.</span> <span style={{color: C.muted}}>{k.text}</span></span>
          {k.sources.length > 0 && <span style={{fontSize: 11, color: C.muted}}>{[...new Set(k.sources.map(sourceLabel))].join(' · ')}</span>}
        </span>
      </div>; })}
      {card.guards?.filter(g => !g.ok).map(g => <div key={g.rule} role="alert" style={{fontSize: 12, color: C.critical}}>Guard failed: {g.rule}</div>)}
    </div>

    {SHOW_HABIT && <div style={{padding: '12px 16px', borderTop: `1px solid ${C.hair}`, background: C.paper, color: C.muted, fontSize: 12, lineHeight: 1.5}}>
      <span style={{...eyebrow, marginRight: 8}}>Habit · advisory</span>
      {card.habit?.text || (card.habit?.n_train ? `Habit model trained on ${card.habit.n_train} orders; no score for this order yet.` : 'No habit model yet. The recommendation above comes from the schedule alone.')}
    </div>}
  </article>;
}
