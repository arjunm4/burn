import React from 'react';

export const C = {ink: '#1C1B17', paper: '#F4F2F0', muted: '#7A766F', faint: '#C9C5BE', line: '#E2DFDA', hair: '#EFECE8', accent: '#E4F222', critical: '#D03B3B', ok: '#2E7D32'};
export const money = c => (c == null ? '—' : '$' + Math.round(c / 100).toLocaleString('en-US'));
export const day = iso => (iso ? new Date(iso.length === 10 ? iso + 'T00:00:00Z' : iso).toLocaleDateString('en-US', {month: 'short', day: 'numeric', timeZone: 'UTC'}) : 'unknown');
export const clock = iso => new Date(iso).toLocaleTimeString('en-US', {hour: 'numeric', minute: '2-digit'});
// Relative times follow the server's clock (a demo may run on another day): the Header syncs it from /api/system.
let clockOffset = 0;
export const syncClock = serverIso => { if (serverIso) clockOffset = Date.parse(serverIso) - Date.now(); };
export const serverNow = () => new Date(Date.now() + clockOffset);
export const relTime = iso => { const m = Math.round((Date.now() + clockOffset - Date.parse(iso)) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };

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

const NAV = [['/orders', 'Orders'], ['/ramp', 'Ramp'], ['/inbox', 'Inbox']];
export function Header({system}) {
  React.useEffect(() => { syncClock(system?.now); }, [system?.now]);
  const here = location.pathname;
  return <header style={{display: 'flex', alignItems: 'center', gap: 20, padding: '14px 24px', borderBottom: `1px solid ${C.line}`}}>
    <a href="/orders" style={{fontSize: 16, letterSpacing: '.04em', color: C.ink, textDecoration: 'none'}}>burn</a>
    <nav style={{marginLeft: 'auto', display: 'flex', gap: 18, fontSize: 13}}>
      {NAV.map(([href, label]) => <a key={href} href={href} style={{color: here.startsWith(href) ? C.ink : C.muted, textDecoration: 'none'}}>{label}</a>)}
    </nav>
  </header>;
}

export function Page({system, width = 1200, children, ...props}) {
  return <div style={{minHeight: '100vh', fontSize: 13, display: 'flex', flexDirection: 'column'}}>
    <Header system={system}/>
    <main {...props} style={{flex: 1, padding: '28px 24px 60px', maxWidth: width, width: '100%', boxSizing: 'border-box', margin: '0 auto', ...(props.style || {})}}>{children}</main>
  </div>;
}

export function Button({primary, children, ...props}) {
  return <button {...props} style={{background: primary ? C.accent : '#fff', border: `1px solid ${primary ? C.accent : C.line}`, borderRadius: 6, padding: '9px 14px', fontSize: 13, cursor: props.disabled ? 'default' : 'pointer', color: C.ink, opacity: props.disabled ? .5 : 1, ...(props.style || {})}}>{children}</button>;
}

export const input = {font: 'inherit', fontSize: 13, padding: '8px 10px', border: `1px solid ${C.line}`, borderRadius: 8, background: '#fff', color: C.ink, width: '100%', boxSizing: 'border-box'};

export function Field({label, children}) {
  return <label style={{display: 'flex', flexDirection: 'column', gap: 4}}>
    <Eyebrow>{label}</Eyebrow>
    {children}
  </label>;
}

export const Eyebrow = ({children, style}) => <span style={{fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: C.muted, ...style}}>{children}</span>;

export function Section({title, right, children}) {
  return <section style={{display: 'flex', flexDirection: 'column', gap: 10}}>
    <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'baseline'}}><Eyebrow>{title}</Eyebrow>{right && <span style={{fontSize: 12, color: C.muted}}>{right}</span>}</div>
    {children}
  </section>;
}

/** A section folded shut by default; the eyebrow is the toggle. */
export function Fold({title, open, children}) {
  return <details open={open} style={{display: 'flex', flexDirection: 'column', gap: 10}}>
    <summary style={{cursor: 'pointer', listStyle: 'none', display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 10}}>
      <Eyebrow>{title}</Eyebrow>
    </summary>
    {children}
  </details>;
}

export const Chip = ({children, tone = 'muted'}) => <span style={{fontSize: 10, letterSpacing: '.06em', textTransform: 'uppercase', color: tone === 'ink' ? C.ink : tone === 'critical' ? C.critical : C.muted, border: `1px solid ${tone === 'critical' ? C.critical : C.line}`, borderRadius: 8, padding: '1px 6px', whiteSpace: 'nowrap'}}>{children}</span>;

/** key · value rows. */
export function Rows({rows, gap = 6}) {
  return <div style={{display: 'grid', gridTemplateColumns: 'max-content minmax(0,1fr)', columnGap: 14, rowGap: gap}}>
    {rows.filter(Boolean).map(([k, v]) => <React.Fragment key={k}><span style={{color: C.muted}}>{k}</span><span style={{minWidth: 0}}>{v}</span></React.Fragment>)}
  </div>;
}
