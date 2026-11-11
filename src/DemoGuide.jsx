import React from 'react';

// Demo-only: a floating checklist that highlights what to click next and advances when you click it.
// Progress lives in localStorage so it survives page changes. Reset with the ↺ button.
const STEPS = [
  {page: /^\/(network)?$/, sel: '[data-demo="Hip actuator bracket"]', text: 'Hip actuator bracket', then: '/orders', say: 'Burn rebuilt Flintlock from its messages. Owen needs this bracket.'},
  {page: /^\/orders$/, text: 'Enter it as', say: 'Owen enters the bracket and attaches the CAD.'},
  {page: /^\/orders\/[\w-]+$/, text: 'Okay', exact: true, say: 'Burn shows what the bracket waits on and picks the tier. Click Okay.'},
  {page: /^\/orders\/[\w-]+$/, go: '/ramp', say: 'The request goes to the manager in Ramp.'},
  {page: /^\/ramp$/, text: 'Approve', exact: true, say: 'Ingrid approves.'},
  {page: /^\/ramp$/, go: 'back', say: 'Burn places the order with a card locked to Xometry.'},
];
const KEY = 'burn-demo-step-v3';
const CSS = `
@keyframes demo-pulse { 0% { box-shadow: 0 0 0 0 rgba(228,242,34,.9); } 70% { box-shadow: 0 0 0 14px rgba(228,242,34,0); } 100% { box-shadow: 0 0 0 0 rgba(228,242,34,0); } }
.demo-target { outline: 3px solid #E4F222 !important; outline-offset: 3px; border-radius: 8px; animation: demo-pulse 1.4s infinite; position: relative; z-index: 2; }
@media (prefers-reduced-motion: reduce) { .demo-target { animation: none; } }
`;
const read = () => { try { return Number(localStorage.getItem(KEY)) || 0; } catch { return 0; } };
const write = n => { try { localStorage.setItem(KEY, String(n)); } catch {} };
const textOf = el => (el.innerText || el.textContent || '').trim();

function findTarget(step) {
  if (!step?.text && !step?.sel) return null;
  if (step.sel) return [...document.querySelectorAll(step.sel)].find(el => el.offsetParent !== null) || null;
  const els = [...document.querySelectorAll('button, a, [role=tab]')].filter(el => el.offsetParent !== null && !el.closest('.demo-guide'));
  return els.find(el => (step.exact ? textOf(el) === step.text : textOf(el).includes(step.text))) || null;
}

export default function DemoGuide() {
  // Opening the first page of the demo always starts the guide from step 1.
  // Start at step 1 on the graph; on any other page, jump to the first step for that page.
  const [i, setI] = React.useState(() => {
    if (['/network', '/'].includes(location.pathname)) { write(0); return 0; }
    const cur = read();
    if (STEPS[cur]?.page.test(location.pathname)) return cur;
    const n = STEPS.findIndex(s => s.page.test(location.pathname));
    if (n >= 0) { write(n); return n; }
    return cur;
  });
  const [open, setOpen] = React.useState(true);
  const [list, setList] = React.useState(false);
  const step = STEPS[i];
  const go = n => { const v = Math.max(0, Math.min(STEPS.length, n)); write(v); setI(v); };

  React.useEffect(() => {
    let cur = null;
    const tick = () => {
      const t = step && step.page.test(location.pathname) ? findTarget(step) : null;
      if (t !== cur) { cur?.classList.remove('demo-target'); t?.classList.add('demo-target'); cur = t; }
    };
    tick();
    const id = setInterval(tick, 400);
    const onClick = e => { if (cur && (e.target === cur || cur.contains(e.target))) { go(i + 1); if (step?.then) setTimeout(() => { location.href = step.then; }, 1500); } };
    document.addEventListener('click', onClick, true);
    return () => { clearInterval(id); document.removeEventListener('click', onClick, true); cur?.classList.remove('demo-target'); };
  }, [i]);

  const onPage = step && step.page.test(location.pathname);
  const goTo = s => { go(i + 1); if (s.go === 'back') history.back(); else location.href = s.go; };

  return <div className="demo-guide" style={{position: 'fixed', left: 16, bottom: 16, zIndex: 1000, width: open ? 330 : 'auto', background: '#1B1A18', color: '#F4F2F0', border: '1px solid #3A3833', borderRadius: 14, padding: open ? 14 : '8px 12px', fontFamily: 'Inter, system-ui, sans-serif', fontSize: 13, boxShadow: '0 10px 30px rgba(0,0,0,.35)'}}>
    <style>{CSS}</style>
    <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
      <b style={{fontSize: 12, letterSpacing: '.1em', textTransform: 'uppercase', color: '#E4F222'}}>Demo · {Math.min(i + 1, STEPS.length)}/{STEPS.length}</b>
      <span style={{marginLeft: 'auto', display: 'flex', gap: 6}}>
        {open && <button onClick={() => go(i - 1)} title="Back" style={btn}>←</button>}
        {open && <button onClick={() => go(i + 1)} title="Skip" style={btn}>→</button>}
        {open && <button onClick={() => go(0)} title="Restart" style={btn}>↺</button>}
        <button onClick={() => setOpen(!open)} style={btn}>{open ? '–' : '+'}</button>
      </span>
    </div>
    {open && <>
      {step ? <div style={{margin: '10px 0', padding: 10, background: 'rgba(228,242,34,.08)', border: '1px solid rgba(228,242,34,.4)', borderRadius: 10}}>
        {step.go ? <button onClick={() => goTo(step)} style={{...btn, background: '#E4F222', color: '#111', padding: '6px 12px', fontWeight: 600}}>{step.go === 'back' ? '← Back to the order' : `Open ${step.go}`}</button>
          : <div><b>Click: </b><span style={{color: '#E4F222'}}>{step.text}</span>{!onPage && <span style={{color: '#8E8A82'}}> (on another page)</span>}</div>}
      </div> : <div style={{margin: '10px 0', color: '#E4F222'}}>Done. ↺ to run it again.</div>}
      {list && <ol style={{margin: 0, paddingLeft: 18, maxHeight: 180, overflow: 'auto', color: '#8E8A82', fontSize: 12, lineHeight: 1.6}}>
        {STEPS.map((s, n) => <li key={n} style={{color: n === i ? '#F4F2F0' : n < i ? '#5E5B55' : '#8E8A82', textDecoration: n < i ? 'line-through' : 'none', cursor: 'pointer'}} onClick={() => go(n)}>{s.text ? `Click "${s.text}"` : s.go === 'back' ? 'Back to the order' : `Open ${s.go}`}</li>)}
      </ol>}
      <button onClick={() => setList(!list)} style={{...btn, border: 'none', color: '#8E8A82', padding: 0}}>{list ? 'Hide steps' : 'All steps'}</button>
    </>}
  </div>;
}
const btn = {background: 'transparent', color: '#F4F2F0', border: '1px solid #3A3833', borderRadius: 8, padding: '2px 8px', cursor: 'pointer', fontSize: 12};
