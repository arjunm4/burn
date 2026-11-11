import React from 'react';
import ForceGraphLib from 'force-graph';
import data from '../../fixtures/timevalue/company-graph.json';

// Demo-only: Burn's company dependency graph as a live force-directed network (force-graph, bundled).
const BG = '#0B0B0A', ACCENT = '#E4F222', RED = '#FF4D4A', INK = '#F4F2F0', MUTED = '#8E8A82';
const PALETTE = ['#5B8DEF', '#36C2B4', '#B07CF0', '#F0A04B', '#E86FA8', '#7BC96F', '#C9B458', '#6FB4E8'];
const DEMO = ['pt-hip-bracket', 'dl-hip-motor-dvt', 'test-hip-spin', 'm-hip-spin-test'];
const MOTOR = 'dl-hip-motor-dvt';
const label = a => (a || 'shared').replace(/^a-/, '').replace(/-/g, ' ');

// Bundled with the app (works offline).
function loadLib() { return Promise.resolve(ForceGraphLib); }

export default function NetworkGraph() {
  const box = React.useRef(null);
  const fg = React.useRef(null);
  const [sel, setSel] = React.useState(null);
  const [slip, setSlip] = React.useState(false);
  const state = React.useRef({focus: new Set(), slip: new Set(), sel: null});
  const [open, setOpen] = React.useState(() => new Set(['m-hip-spin-test', 'test-hip-spin']));
  const focusId = id => {
    const g = fg.current; const st = state.current; if (!g) return;
    const n = g.graphData().nodes.find(x => x.id === id); if (!n) return;
    st.sel = id; st.focus = new Set([...model.reach(id, model.up), ...model.reach(id, model.down)]);
    setSel(id); g.centerAt(n.x, n.y, 900); g.zoom(3, 900);
  };

  const model = React.useMemo(() => {
    const asm = [...new Set(data.nodes.map(n => n.assembly || 'shared'))].sort();
    const named = asm.filter(a => a !== 'shared');
    const color = {...Object.fromEntries(named.map((a, i) => [a, PALETTE[i % PALETTE.length]])), shared: '#5E5B55'};
    const deg = new Map();
    for (const e of data.edges) { deg.set(e.from, (deg.get(e.from) || 0) + 1); deg.set(e.to, (deg.get(e.to) || 0) + 1); }
    const nodes = data.nodes.map(n => ({...n, color: color[n.assembly || 'shared'], deg: deg.get(n.id) || 1}));
    const links = data.edges.map(e => ({source: e.from, target: e.to, status: e.status, evidence: e.evidence}));
    const down = new Map(), up = new Map();
    for (const e of data.edges) { (down.get(e.from) || down.set(e.from, []).get(e.from)).push(e.to); (up.get(e.to) || up.set(e.to, []).get(e.to)).push(e.from); }
    const reach = (id, m) => { const s = new Set([id]); const st = [id]; while (st.length) for (const n of m.get(st.pop()) || []) if (!s.has(n)) { s.add(n); st.push(n); } return s; };
    return {nodes, links, color, asm, reach, up, down};
  }, []);

  React.useEffect(() => {
    let alive = true;
    loadLib().then(ForceGraph => {
      if (!alive || !box.current) return;
      const st = state.current;
      const g = ForceGraph()(box.current)
        .backgroundColor(BG)
        .autoPauseRedraw(false)
        .graphData({nodes: model.nodes, links: model.links})
        .nodeId('id')
        .nodeRelSize(4)
        .nodeVal(n => (n.kind === 'milestone' ? 14 : n.kind === 'test' ? 6 : 2) + Math.min(n.deg, 12) * 0.4)
        .linkColor(l => {
          const a = l.source.id ?? l.source, b = l.target.id ?? l.target;
          if (st.slip.size && st.slip.has(a) && st.slip.has(b)) return RED;
          if (st.focus.size) return st.focus.has(a) && st.focus.has(b) ? ACCENT : 'rgba(255,255,255,0.03)';
          return l.status === 'disputed' ? 'rgba(255,77,74,0.5)' : 'rgba(255,255,255,0.16)';
        })
        .linkWidth(l => { const a = l.source.id ?? l.source, b = l.target.id ?? l.target; return (st.focus.has(a) && st.focus.has(b)) || (st.slip.has(a) && st.slip.has(b)) ? 2.2 : 0.6; })
        .linkDirectionalParticles(l => { const a = l.source.id ?? l.source, b = l.target.id ?? l.target; return (st.focus.has(a) && st.focus.has(b)) || (st.slip.has(a) && st.slip.has(b)) ? 4 : 1; })
        .linkDirectionalParticleWidth(l => { const a = l.source.id ?? l.source, b = l.target.id ?? l.target; return st.slip.has(a) && st.slip.has(b) ? 4 : st.focus.has(a) && st.focus.has(b) ? 3 : 1.2; })
        .linkDirectionalParticleColor(l => { const a = l.source.id ?? l.source, b = l.target.id ?? l.target; return st.slip.has(a) && st.slip.has(b) ? RED : st.focus.has(a) && st.focus.has(b) ? ACCENT : 'rgba(255,255,255,0.35)'; })
        .linkDirectionalParticleSpeed(0.006)
        .linkCurvature(0.15)
        .nodeCanvasObject((n, ctx, scale) => {
          const r = Math.sqrt((n.kind === 'milestone' ? 14 : n.kind === 'test' ? 6 : 2) + Math.min(n.deg, 12) * 0.4) * 4;
          const dim = (st.focus.size && !st.focus.has(n.id)) && !st.slip.has(n.id);
          const hot = st.slip.has(n.id) && n.id !== MOTOR;
          const demo = DEMO.includes(n.id);
          ctx.globalAlpha = dim ? 0.12 : 1;
          if (demo || hot || n.id === st.sel) { ctx.shadowColor = hot ? RED : ACCENT; ctx.shadowBlur = 25; }
          ctx.fillStyle = hot ? RED : demo || n.id === st.sel ? ACCENT : n.color;
          ctx.beginPath();
          if (n.kind === 'milestone') { ctx.moveTo(n.x, n.y - r); ctx.lineTo(n.x + r, n.y); ctx.lineTo(n.x, n.y + r); ctx.lineTo(n.x - r, n.y); ctx.closePath(); }
          else ctx.arc(n.x, n.y, r, 0, 2 * Math.PI);
          ctx.fill();
          ctx.shadowBlur = 0;
          const showLabel = demo || n.id === st.sel || n.kind === 'milestone' || (st.focus.has(n.id) && st.focus.size < 40) || scale > 2.2;
          if (showLabel && !dim) {
            const fs = Math.max(11 / scale, 2.5);
            ctx.font = `${demo || n.kind === 'milestone' ? 600 : 400} ${fs}px Inter, system-ui, sans-serif`;
            ctx.fillStyle = demo ? ACCENT : INK; ctx.textAlign = 'center';
            ctx.fillText(n.name.length > 36 ? n.name.slice(0, 35) + '…' : n.name, n.x, n.y + r + fs * 1.1);
          }
          ctx.globalAlpha = 1;
        })
        .nodePointerAreaPaint((n, color, ctx) => { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(n.x, n.y, 8, 0, 2 * Math.PI); ctx.fill(); })
        .onNodeClick(n => {
          st.sel = n.id; st.focus = new Set([...model.reach(n.id, model.up), ...model.reach(n.id, model.down)]);
          setSel(n.id); g.centerAt(n.x, n.y, 900); g.zoom(3, 900);
          setOpen(o => new Set([...o, ...model.reach(n.id, model.down)]));
        })
        .onBackgroundClick(() => { st.sel = null; st.focus = new Set(); setSel(null); g.zoomToFit(900, 60); })
        .cooldownTicks(220)
        .onEngineStop(() => {})
        .width(box.current.clientWidth).height(box.current.clientHeight);
      g.d3Force('charge').strength(-28);
      g.d3Force('link').distance(l => ((l.target.kind || '') === 'milestone' ? 70 : 34));
      fg.current = g;
      setTimeout(() => { if (!alive) return; const m = model.nodes.find(n => n.id === 'pt-hip-bracket');
        st.sel = 'pt-hip-bracket'; st.focus = new Set([...model.reach('pt-hip-bracket', model.up), ...model.reach('pt-hip-bracket', model.down)]);
        setSel('pt-hip-bracket'); if (m) { g.centerAt(m.x, m.y, 1600); g.zoom(2.6, 1600); } }, 3500);
      const onResize = () => g.width(box.current.clientWidth).height(box.current.clientHeight);
      window.addEventListener('resize', onResize);
    });
    return () => { alive = false; };
  }, [model]);

  const runSlip = () => {
    const st = state.current; const g = fg.current; if (!g) return;
    if (slip) { st.slip = new Set(); setSlip(false); return; }
    st.slip = model.reach(MOTOR, model.down); setSlip(true);
    const m = model.nodes.find(n => n.id === MOTOR); if (m) { g.centerAt(m.x, m.y, 900); g.zoom(2.4, 900); }
  };


  const byId = React.useMemo(() => new Map(model.nodes.map(n => [n.id, n])), [model]);
  const milestones = React.useMemo(() => model.nodes.filter(n => n.kind === 'milestone').sort((a, b) => (b.id === 'm-hip-spin-test') - (a.id === 'm-hip-spin-test') || a.name.localeCompare(b.name)), [model]);
  const Row = ({id, depth, seen}) => {
    const n = byId.get(id); if (!n) return null;
    const kids = (model.up.get(id) || []).filter(k => !seen.has(k));
    const isOpen = open.has(id);
    const lit = sel && state.current.focus.has(id);
    return <div>
      <div role="button" data-demo={n.name} style={{display: 'flex', alignItems: 'center', gap: 6, padding: '3px 6px', paddingLeft: 6 + depth * 14, borderRadius: 6, cursor: 'pointer', background: id === sel ? 'rgba(228,242,34,.16)' : 'transparent', color: lit || !sel ? INK : MUTED}}
        onClick={() => focusId(id)}>
        <span onClick={e => { e.stopPropagation(); setOpen(o => { const x = new Set(o); x.has(id) ? x.delete(id) : x.add(id); return x; }); }}
          style={{width: 12, color: MUTED, visibility: kids.length ? 'visible' : 'hidden'}}>{isOpen ? '▾' : '▸'}</span>
        <i style={{width: 8, height: 8, borderRadius: n.kind === 'milestone' ? 1 : 8, transform: n.kind === 'milestone' ? 'rotate(45deg)' : 'none', background: DEMO.includes(id) ? ACCENT : n.color, flex: 'none'}}/>
        <span style={{whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{n.name}</span>
        {kids.length > 0 && <span style={{marginLeft: 'auto', color: MUTED, fontSize: 11}}>{kids.length}</span>}
      </div>
      {isOpen && kids.slice(0, 40).map(k => <Row key={k} id={k} depth={depth + 1} seen={new Set([...seen, id])}/>)}
    </div>;
  };
  const node = sel && model.nodes.find(n => n.id === sel);
  const links = sel ? data.edges.filter(e => e.from === sel || e.to === sel) : [];
  const name = id => data.nodes.find(n => n.id === id)?.name || id;

  return <div style={{position: 'fixed', inset: 0, background: BG, color: INK, fontFamily: 'Inter, system-ui, sans-serif'}}>
    <div ref={box} style={{position: 'absolute', inset: 0}}/>
    <div style={{position: 'absolute', top: 18, left: 22, pointerEvents: 'none'}}>
      <div style={{fontSize: 12, letterSpacing: '.14em', textTransform: 'uppercase', color: MUTED}}>Burn · company dependency graph</div>
      <div style={{fontSize: 26, fontWeight: 600, marginTop: 4}}>Flintlock Robotics, rebuilt from its messages</div>
      <div style={{fontSize: 13, color: MUTED, marginTop: 4}}>{data.nodes.length} parts, tests and milestones · {data.edges.length} links read from Slack, Jira, meetings and the calendar</div>
      <div style={{display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 10, fontSize: 12}}>
        {model.asm.map(a => <span key={a} style={{display: 'inline-flex', alignItems: 'center', gap: 6, textTransform: 'capitalize'}}><i style={{width: 9, height: 9, borderRadius: 9, background: model.color[a], display: 'inline-block'}}/>{label(a)}</span>)}
        <span style={{color: ACCENT}}>◆ milestone · ● part / test</span>
      </div>
    </div>
    <div style={{position: 'absolute', top: 18, right: 22, display: 'flex', gap: 8}}>
      <button onClick={runSlip} style={{background: slip ? RED : 'transparent', color: slip ? '#fff' : INK, border: `1px solid ${slip ? RED : '#3A3833'}`, borderRadius: 18, padding: '8px 16px', fontSize: 13, cursor: 'pointer'}}>{slip ? 'Reset' : 'What if the motor slips?'}</button>
      <a href="/timevalue" style={{color: ACCENT, border: '1px solid #3A3833', borderRadius: 18, padding: '8px 16px', fontSize: 13, textDecoration: 'none'}}>The decision →</a>
    </div>
    <nav style={{position: 'absolute', left: 22, top: 150, bottom: 345, width: 300, overflow: 'auto', background: 'rgba(27,26,24,0.88)', border: '1px solid #3A3833', borderRadius: 14, padding: '10px 8px', fontSize: 12.5, backdropFilter: 'blur(6px)'}}>
      <div style={{fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: MUTED, padding: '0 6px 8px'}}>Hierarchy · milestone → what feeds it</div>
      {milestones.map(m => <Row key={m.id} id={m.id} depth={0} seen={new Set()}/>)}
    </nav>
    {node && <aside style={{position: 'absolute', right: 22, bottom: 22, width: 360, maxHeight: '55vh', overflow: 'auto', background: 'rgba(27,26,24,0.92)', border: '1px solid #3A3833', borderRadius: 14, padding: 16, fontSize: 13, backdropFilter: 'blur(6px)'}}>
      <div style={{fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: MUTED}}>{node.kind} · {label(node.assembly)}</div>
      <div style={{fontSize: 17, fontWeight: 600, margin: '4px 0 10px'}}>{node.name}</div>
      {links.slice(0, 8).map((e, i) => <div key={i} style={{borderTop: '1px solid #2A2925', padding: '8px 0'}}>
        <div>{e.from === sel ? <>needed by <b>{name(e.to)}</b></> : <>needs <b>{name(e.from)}</b></>}{e.status !== 'accepted' && <span style={{color: RED, fontSize: 11}}> · {e.status}</span>}</div>
        {e.evidence.filter(v => v.text).slice(0, 1).map((v, j) => <div key={j} style={{color: MUTED, marginTop: 4, fontSize: 12}}>“{v.text}” — {v.by || 'unknown'}</div>)}
      </div>)}
    </aside>}
    {slip && <div style={{position: 'absolute', left: 22, bottom: 22, background: 'rgba(255,77,74,0.12)', border: `1px solid ${RED}`, borderRadius: 14, padding: '10px 14px', fontSize: 13}}>
      Motor slips → <b>{state.current.slip.size - 1}</b> downstream tests and milestones move with it
    </div>}
  </div>;
}
