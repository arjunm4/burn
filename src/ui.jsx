import React from 'react';
import './ui.css';

export const C = {ink: '#1C1B17', paper: '#F4F2F0', muted: '#7A766F', faint: '#C9C5BE', line: '#E2DFDA', hair: '#EFECE8', accent: '#E4F222', critical: '#D03B3B', ok: '#2E7D32'};
export const money = c => (c == null ? '—' : '$' + Math.round(c / 100).toLocaleString('en-US'));
export const day = iso => (iso ? new Date(iso.length === 10 ? iso + 'T00:00:00Z' : iso).toLocaleDateString('en-US', {month: 'short', day: 'numeric', timeZone: 'UTC'}) : 'unknown');
export const clock = iso => new Date(iso).toLocaleTimeString('en-US', {hour: 'numeric', minute: '2-digit'});
// Relative times follow the server's clock (a demo may run on another day): the Header syncs it from /api/system.
let clockOffset = 0;
export const syncClock = serverIso => { if (serverIso) clockOffset = Date.parse(serverIso) - Date.now(); };
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

const NAV = [['/orders', 'Orders'], ['/ramp', 'Ramp'], ['/inbox', 'Inbox'], ['/graph', 'Graph']];
export function Header({system}) {
  React.useEffect(() => { syncClock(system?.now); }, [system?.now]);
  const here = location.pathname;
  return <header className="burn-header">
    <div className="burn-header-inner">
      <a href="/orders" className="burn-brand" aria-label="Burn home"><span className="burn-mark" aria-hidden="true">b</span>burn<span className="burn-brand-dot">.</span></a>
      <nav className="burn-nav" aria-label="Main navigation">
        {NAV.map(([href, label]) => <a key={href} href={href} aria-current={here.startsWith(href) || (here === '/' && href === '/orders') ? 'page' : undefined}>{label}</a>)}
      </nav>
      <span className="burn-workspace">{system?.company?.name || 'Workspace'}</span>
    </div>
  </header>;
}

export function Page({system, width = 1200, children, ...props}) {
  return <div className="burn-shell" style={{minHeight: '100vh', fontSize: 14, display: 'flex', flexDirection: 'column'}}>
    <Header system={system}/>
    <main {...props} className={`burn-main ${props.className || ''}`} style={{flex: 1, padding: '40px 32px 72px', maxWidth: width, width: '100%', boxSizing: 'border-box', margin: '0 auto', ...(props.style || {})}}>{children}</main>
  </div>;
}

export function Button({primary, children, ...props}) {
  return <button {...props} className={`burn-button ${primary ? 'burn-button-primary' : ''} ${props.className || ''}`} style={props.style}>{children}</button>;
}

export const input = {font: 'inherit', fontSize: 13, padding: '8px 10px', border: `1px solid ${C.line}`, borderRadius: 8, background: '#fff', color: C.ink, width: '100%', boxSizing: 'border-box'};

export function Field({label, children}) {
  return <label className="burn-field">
    <span className="burn-field-label">{label}</span>
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
