import React from 'react';
import {api} from './api.js';
import {C, Section, Chip} from './ui.jsx';

// "Burn's browser": the headless provider's recording of what it did on the vendor site (one
// screenshot and a note per step), so the engineer can watch the quote and the verified placement
// rather than take the log line's word for it. Polls while the order is being worked on; otherwise
// loads once. Renders nothing when there is no recording (the in-process fake leaves none).
const LIVE = ['entered', 'resolving', 'placing'];
const STEP_LABEL = {landing: 'Landing', upload: 'Upload CAD', configurator: 'Configure part', tiers: 'Read lead times', 'reopen-quote': 'Reopen quote', 'select-tier': 'Select tier', 'read-back': 'Read back every field', payment: 'Enter card', confirmation: 'Confirmation', abort: 'Stopped', timeout: 'No response', declined: 'Declined', 'account-orders': 'Check vendor records'};
const TONE = {abort: 'critical', timeout: 'critical', declined: 'critical', confirmation: 'ink', 'read-back': 'ink'};

export default function BrowserPanel({orderId, state}) {
  const [rec, setRec] = React.useState(null);
  const [selected, setSelected] = React.useState(null);   // step n; null = follow the latest
  const live = LIVE.includes(state);
  React.useEffect(() => {
    let stop = false;
    const load = () => api(`/orders/${orderId}/recording`).then(r => { if (!stop) setRec(r); }).catch(() => {});
    load();
    if (!live) return () => { stop = true; };
    const t = setInterval(load, 3000);
    return () => { stop = true; clearInterval(t); };
  }, [orderId, live]);
  const steps = rec?.steps || [];
  if (!steps.length) return null;
  const current = steps.find(s => s.n === selected) || steps[steps.length - 1];
  const time = iso => new Date(iso).toLocaleTimeString('en-US', {hour: 'numeric', minute: '2-digit', second: '2-digit'});
  return <Section title="Burn's browser" right={<span>{steps.length} step{steps.length === 1 ? '' : 's'}{live ? ' · recording' : ''}{rec?.video ? <> · <a href={rec.video} style={{color: C.muted}}>video</a></> : null}</span>}>
    <div style={{display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 230px', gap: 14, border: `1px solid ${C.line}`, borderRadius: 12, overflow: 'hidden', background: '#fff'}}>
      <div style={{display: 'flex', flexDirection: 'column', minWidth: 0}}>
        <div style={{display: 'flex', gap: 10, alignItems: 'baseline', padding: '10px 14px', borderBottom: `1px solid ${C.hair}`, fontSize: 12}}>
          <span style={{color: C.muted}}>{current.n}.</span><span>{STEP_LABEL[current.label] || current.label}</span><Chip tone={TONE[current.label] || 'muted'}>{current.label}</Chip><span style={{marginLeft: 'auto', color: C.faint, fontSize: 11}}>{time(current.at)}</span>
        </div>
        {current.url ? <a href={current.url} target="_blank" rel="noreferrer" style={{display: 'block', background: C.paper, lineHeight: 0}}><img src={current.url} alt={current.note} style={{width: '100%', maxHeight: 520, objectFit: 'contain', objectPosition: 'top', display: 'block'}}/></a> : <div style={{padding: 40, color: C.muted, textAlign: 'center'}}>No screenshot for this step.</div>}
        <div style={{padding: '10px 14px', fontSize: 12, color: /abort|timeout|declined/.test(current.label) ? C.critical : C.muted, lineHeight: 1.5, borderTop: `1px solid ${C.hair}`}}>{current.note}</div>
      </div>
      <div style={{display: 'flex', flexDirection: 'column', borderLeft: `1px solid ${C.hair}`, maxHeight: 640, overflowY: 'auto'}}>
        {steps.map(s => {
          const active = s.n === current.n;
          return <button key={s.n} onClick={() => setSelected(s.n === steps[steps.length - 1].n ? null : s.n)} title={s.note} style={{display: 'grid', gridTemplateColumns: '64px minmax(0,1fr)', gap: 8, alignItems: 'center', padding: '8px 10px', border: 0, borderBottom: `1px solid ${C.hair}`, background: active ? C.paper : '#fff', textAlign: 'left', cursor: 'pointer', font: 'inherit', color: C.ink}}>
            {s.url ? <img src={s.url} alt="" style={{width: 64, height: 40, objectFit: 'cover', objectPosition: 'top', borderRadius: 3, border: `1px solid ${C.line}`, background: C.paper}}/> : <span style={{width: 64, height: 40, borderRadius: 3, border: `1px dashed ${C.line}`}}/>}
            <span style={{minWidth: 0}}>
              <span style={{display: 'block', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: /abort|timeout|declined/.test(s.label) ? C.critical : C.ink}}>{s.n}. {STEP_LABEL[s.label] || s.label}</span>
              <span style={{display: 'block', fontSize: 11, color: C.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{s.note}</span>
            </span>
          </button>;
        })}
      </div>
    </div>
  </Section>;
}
