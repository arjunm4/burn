import React from 'react';

export const C = {ink: '#1C1B17', paper: '#F4F2F0', muted: '#7A766F', faint: '#C9C5BE', line: '#E2DFDA', hair: '#EFECE8', accent: '#E4F222', critical: '#D03B3B', ok: '#2E7D32'};
export const money = c => (c == null ? '—' : '$' + Math.round(c / 100).toLocaleString('en-US'));
export const day = iso => (iso ? new Date(iso.length === 10 ? iso + 'T00:00:00Z' : iso).toLocaleDateString('en-US', {month: 'short', day: 'numeric', timeZone: 'UTC'}) : 'unknown');
export const relTime = iso => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };

export const STATE_LABEL = {
  entered: 'Entered', resolving: 'Working…', needs_answer: 'Needs your answer', recommended: 'Options ready', specified: 'Okayed',
  requested: 'Awaiting approval', approved: 'Approved', placing: 'Placing…', placed: 'Placed', delivered: 'Delivered', in_use: 'In use',
  rejected: 'Rejected', cancelled: 'Cancelled', unresolved: 'Needs a person', superseded: 'Superseded', invalidated: 'Needs re-approval', placement_unknown: 'Placement unknown',
};
const STATE_TONE = {needs_answer: 'accent', recommended: 'ink', placed: 'ok', delivered: 'ok', in_use: 'ok', rejected: 'critical', invalidated: 'critical', placement_unknown: 'critical', unresolved: 'critical', cancelled: 'muted', superseded: 'muted'};

export function StateBadge({state}) {
  const tone = STATE_TONE[state] || 'muted';
  const color = tone === 'critical' ? C.critical : tone === 'ok' ? C.ok : tone === 'ink' ? C.ink : C.muted;
  return <span style={{fontSize: 11, letterSpacing: '.04em', border: `1px solid ${tone === 'accent' ? C.ink : color}`, background: tone === 'accent' ? C.accent : 'transparent', color: tone === 'accent' ? C.ink : color, borderRadius: 10, padding: '2px 8px', whiteSpace: 'nowrap', alignSelf: 'center'}}>{STATE_LABEL[state] || state}</span>;
}

export function Header({crumb, system}) {
  return <header style={{display: 'flex', alignItems: 'center', gap: 18, padding: '14px 24px', borderBottom: `1px solid ${C.line}`}}>
    <a href="/orders" style={{fontSize: 16, letterSpacing: '.04em', color: C.ink, textDecoration: 'none'}}>burn</a>
    <span style={{color: C.muted}}>Purchasing</span><span style={{color: C.faint}}>/</span><span>{crumb}</span>
    <span style={{marginLeft: 'auto', display: 'flex', gap: 16, fontSize: 12, color: C.muted, alignItems: 'center'}}>
      {system && <span title="Backends in use">{system.vendor.vendor} · {system.vendor.mode} / Ramp · {system.ramp.mode}</span>}
      <a href="/orders" style={{color: C.muted}}>Orders</a>
      <a href="/graph" style={{color: C.muted}}>Dependencies</a>
    </span>
  </header>;
}

export function Button({primary, children, ...props}) {
  return <button {...props} style={{background: primary ? C.accent : '#fff', border: `1px solid ${primary ? C.accent : C.line}`, borderRadius: 6, padding: '9px 14px', fontSize: 13, cursor: props.disabled ? 'default' : 'pointer', color: C.ink, opacity: props.disabled ? .5 : 1, ...(props.style || {})}}>{children}</button>;
}

export function Field({label, hint, children}) {
  return <label style={{display: 'flex', flexDirection: 'column', gap: 4}}>
    <span style={{fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', color: C.muted}}>{label}{hint && <span style={{textTransform: 'none', letterSpacing: 0}}> · {hint}</span>}</span>
    {children}
  </label>;
}

export function Section({title, right, children}) {
  return <section style={{display: 'flex', flexDirection: 'column', gap: 10}}>
    <div style={{display: 'flex', justifyContent: 'space-between', fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: C.muted}}><span>{title}</span>{right && <span>{right}</span>}</div>
    {children}
  </section>;
}

export const Chip = ({children, tone = 'muted'}) => <span style={{fontSize: 10, letterSpacing: '.06em', textTransform: 'uppercase', color: tone === 'ink' ? C.ink : tone === 'critical' ? C.critical : C.muted, border: `1px solid ${tone === 'critical' ? C.critical : C.line}`, borderRadius: 8, padding: '1px 6px'}}>{children}</span>;
