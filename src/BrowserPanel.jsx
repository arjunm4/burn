import React from 'react';
import {api} from './api.js';
import {C, Fold, clock} from './ui.jsx';

// "Burn's browser": the headless provider's recording of what it did on the vendor site (one
// screenshot and a note per step). Open while the order is being worked on; folded shut after.
// Renders nothing when there is no recording (the in-process fake leaves none).
const LIVE = ['entered', 'resolving', 'placing'];
const STEP_LABEL = {landing: 'Landing', upload: 'Upload CAD', configurator: 'Configure part', tiers: 'Read lead times', 'reopen-quote': 'Reopen quote', 'select-tier': 'Select tier', 'read-back': 'Read back every field', payment: 'Enter card', confirmation: 'Confirmation', abort: 'Stopped', timeout: 'No response', declined: 'Declined', 'account-orders': 'Check vendor records'};
const BAD = /abort|timeout|declined/;

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
  const last = steps[steps.length - 1];
  return <Fold title={`Burn's browser · ${steps.length} step${steps.length === 1 ? '' : 's'}`} open={live || BAD.test(last.label)}>
    <div style={{display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 200px', border: `1px solid ${C.line}`, borderRadius: 12, overflow: 'hidden', background: '#fff'}}>
      <div style={{display: 'flex', flexDirection: 'column', minWidth: 0}}>
        {current.url ? <a href={current.url} target="_blank" rel="noreferrer" style={{display: 'block', background: C.paper, lineHeight: 0}}><img src={current.url} alt="" style={{width: '100%', maxHeight: 440, objectFit: 'contain', objectPosition: 'top', display: 'block'}}/></a> : <div style={{padding: 40, color: C.muted, textAlign: 'center'}}>No screenshot.</div>}
        <div style={{padding: '10px 14px', fontSize: 12, color: BAD.test(current.label) ? C.critical : C.muted, lineHeight: 1.5, borderTop: `1px solid ${C.hair}`}}>{current.note}</div>
      </div>
      <div style={{display: 'flex', flexDirection: 'column', borderLeft: `1px solid ${C.hair}`, maxHeight: 500, overflowY: 'auto'}}>
        {steps.map(s => {
          const active = s.n === current.n;
          return <button key={s.n} onClick={() => setSelected(s.n === last.n ? null : s.n)} title={s.note} style={{display: 'flex', justifyContent: 'space-between', gap: 8, padding: '9px 12px', border: 0, borderBottom: `1px solid ${C.hair}`, background: active ? C.paper : '#fff', textAlign: 'left', cursor: 'pointer', font: 'inherit', fontSize: 12, color: BAD.test(s.label) ? C.critical : C.ink}}>
            <span>{s.n}. {STEP_LABEL[s.label] || s.label}</span><span style={{color: C.faint, fontSize: 11}}>{clock(s.at)}</span>
          </button>;
        })}
      </div>
    </div>
  </Fold>;
}
