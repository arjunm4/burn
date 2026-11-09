import React from 'react';
import {layout} from './layout.js';
import {toIso} from './engine.js';

// Kind is carried by shape (part dot, work bar, milestone diamond), never by color.
// Ink marks the critical path; the reserved critical red marks slips, always with a label.
export const G = {ink: '#1C1B17', muted: '#7A766F', faint: '#C9C5BE', line: '#E2DFDA', hair: '#EFECE8', paper: '#F4F2F0', bar: '#D9D5CF', critical: '#D03B3B', accent: '#E4F222'};
const day = d => new Date(d * 86400000).toLocaleDateString('en-US', {month: 'short', day: 'numeric', timeZone: 'UTC'});
const initials = label => label.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
const MOVE = 'transform .55s cubic-bezier(.2,.7,.2,1), width .55s cubic-bezier(.2,.7,.2,1)';

export function useWidth(ref, fallback = 960) {
  const [width, setWidth] = React.useState(fallback);
  React.useLayoutEffect(() => {
    if (!ref.current) return;
    // Measure before first paint so the first frame isn't laid out at the fallback width and animated.
    setWidth(Math.round(ref.current.getBoundingClientRect().width) || fallback);
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(ref.current); return () => ro.disconnect();
  }, [ref]);
  return width;
}

export default function GraphView({graph, analysis, today, selected, onSelect, compact = false, people = {}}) {
  const ref = React.useRef(null);
  const width = useWidth(ref, compact ? 560 : 960);
  const [hover, setHover] = React.useState(null);
  const geo = React.useMemo(() => layout(graph, analysis, compact ? {width, rowHeight: 26, labelWidth: 150, gap: 8, pad: 18} : {width}), [graph, analysis, width, compact]);
  const at = analysis.days;
  const critical = new Set(analysis.critical.nodes);
  const assignees = id => graph.edges.filter(e => e.kind === 'assigned' && e.to === id).map(e => people[e.from] || graph.nodes.find(n => n.id === e.from)?.label || e.from);
  const conflictFor = id => analysis.conflicts.find(c => c.node === id || c.work === id);
  const tip = hover && geo.rows.find(r => r.id === hover);
  const bh = compact ? 10 : 14;

  return <div ref={ref} style={{position: 'relative', width: '100%'}}>
    <svg width={geo.width} height={geo.height} role="img" aria-label="Dependency timeline" style={{display: 'block', fontFamily: 'inherit', overflow: 'visible'}}>
      {/* calendar grid */}
      {geo.ticks.map(t => <g key={t.day}>
        <line x1={t.x} x2={t.x} y1={12} y2={geo.height} stroke={t.major ? G.line : G.hair} strokeWidth={1}/>
        {t.label && (t.major || !compact) && <text x={t.x + 3} y={10} fontSize={10} fill={t.major ? G.ink : G.muted}>{t.label}</text>}
      </g>)}
      {today != null && <g>
        <line x1={geo.x(today)} x2={geo.x(today)} y1={12} y2={geo.height} stroke={G.ink} strokeWidth={1} strokeDasharray="2 3"/>
        <text x={geo.x(today) + 3} y={geo.height - 2} fontSize={10} fill={G.ink}>order date</text>
      </g>}

      {/* selection highlight sits under edges so it never hides them */}
      {selected && geo.rows.filter(r => r.id === selected).map(r => <rect key="sel" x={0} y={r.y - geo.rowHeight / 2} width={geo.width} height={geo.rowHeight} fill={G.paper}/>)}

      {/* edges under nodes */}
      {geo.edges.map(({edge, path, critical: hot}) => <path key={edge.id} d={path} fill="none"
        stroke={hot ? G.ink : G.faint} strokeWidth={hot ? 2 : 1.25} strokeDasharray={edge.kind === 'due' ? '4 3' : undefined}
        style={{d: `path("${path}")`, transition: 'd .55s cubic-bezier(.2,.7,.2,1), stroke .3s'}} opacity={selected && selected !== edge.from && selected !== edge.to ? .35 : 1}/>)}

      {geo.rows.map(({id, node, y}) => {
        const s = at[id]; const hot = critical.has(id); const sel = selected === id;
        const dim = selected && !sel ? .55 : 1;
        const conflict = conflictFor(id);
        return <g key={id} opacity={dim} style={{transition: 'opacity .2s', cursor: onSelect ? 'pointer' : 'default'}}
          onMouseEnter={() => setHover(id)} onMouseLeave={() => setHover(h => (h === id ? null : h))} onClick={() => onSelect?.(sel ? null : id)}>
          {/* hit target: the whole row */}
          <rect x={0} y={y - geo.rowHeight / 2} width={geo.width} height={geo.rowHeight} fill="transparent"/>
          <text x={8} y={y + 4} fontSize={compact ? 11 : 12} fill={hot ? G.ink : G.muted} fontWeight={hot ? 500 : 400}>
            {node.label.length > (compact ? 22 : 28) ? node.label.slice(0, compact ? 21 : 27) + '…' : node.label}
          </text>
          {node.kind === 'part' && <g style={{transform: `translateX(${geo.x(s.finish)}px)`, transition: MOVE}}>
            {s.end != null && <rect x={geo.x(s.start) - geo.x(s.finish)} y={y - bh / 2} height={bh} rx={4}
              width={Math.max(4, (s.end - s.start) * geo.pxPerDay)} fill="none" stroke={conflict ? G.critical : G.muted} strokeDasharray="3 2"/>}
            <circle cx={0} cy={y} r={compact ? 4.5 : 6} fill={hot ? G.ink : '#fff'} stroke={G.ink} strokeWidth={2}/>
            {!compact && <text x={10} y={y + 4} fontSize={11} fill={G.muted}>{s.end != null ? `booked ${day(s.start)}–${day(s.end - 1)}` : `arrives ${day(s.finish)}`}</text>}
          </g>}
          {node.kind === 'work' && <g style={{transform: `translateX(${geo.x(s.start)}px)`, transition: MOVE}}>
            <rect x={0} y={y - bh / 2} height={bh} rx={4} width={Math.max(6, (s.finish - s.start) * geo.pxPerDay - 2)}
              fill={hot ? G.ink : G.bar} style={{transition: MOVE}}/>
            {!compact && <text x={Math.max(6, (s.finish - s.start) * geo.pxPerDay) + 6} y={y + 4} fontSize={11} fill={G.muted}>
              {assignees(id).map(initials).join(' · ')}
            </text>}
          </g>}
          {node.kind === 'milestone' && <g>
            {s.slip > 0 && <line x1={geo.x(s.planned)} x2={geo.x(s.finish)} y1={y} y2={y} stroke={G.critical} strokeWidth={2} style={{transition: 'all .55s'}}/>}
            <g style={{transform: `translate(${geo.x(s.planned)}px, ${y}px)`}}>
              <rect x={-6} y={-6} width={12} height={12} transform="rotate(45)" fill="#fff" stroke={s.slip > 0 ? G.critical : G.ink} strokeWidth={2}/>
            </g>
            {s.slip > 0 && <g style={{transform: `translate(${geo.x(s.finish)}px, ${y}px)`, transition: MOVE}}>
              <rect x={-6} y={-6} width={12} height={12} transform="rotate(45)" fill={G.critical}/>
              <text x={12} y={4} fontSize={11} fill={G.critical} fontWeight={500}>slips {s.slip}d</text>
            </g>}
            {!s.slip && !compact && <text x={geo.x(s.planned) + 12} y={y + 4} fontSize={11} fill={G.muted}>{day(s.planned)} · holds</text>}
          </g>}
        </g>;
      })}
    </svg>
    {tip && <Tooltip row={tip} at={at} geo={geo} people={assignees(tip.id)} conflict={conflictFor(tip.id)}/>}
  </div>;
}

function Tooltip({row, at, geo, people, conflict}) {
  const s = at[row.id]; const n = row.node;
  const lines = n.kind === 'milestone'
    ? [`Planned ${day(s.planned)}`, s.slip ? `Now ${day(s.finish)} · slips ${s.slip} days` : 'On time']
    : n.kind === 'part'
      ? [s.end != null ? `Booked ${day(s.start)} – ${day(s.end - 1)}` : `Arrives ${day(s.finish)}`]
      : [`${day(s.start)} → ${day(s.finish)} · ${s.finish - s.start}d`, people.length ? people.join(', ') : 'Nobody assigned'];
  if (conflict) lines.push(conflict.kind === 'booking_missed' ? `Booking ends ${day(Date.parse(conflict.bookingEnd) / 86400000 - 1)}, work can't start until ${day(Date.parse(conflict.workStart) / 86400000)}` : conflict.kind);
  const left = Math.min(geo.width - 240, Math.max(0, (n.kind === 'work' ? geo.x(s.start) : geo.x(s.finish)) - 20));
  return <div role="tooltip" style={{position: 'absolute', left, top: row.y + geo.rowHeight / 2 + 2, pointerEvents: 'none', background: '#fff', border: `1px solid ${G.line}`, borderRadius: 8, padding: '8px 10px', fontSize: 12, lineHeight: 1.45, boxShadow: '0 4px 14px rgba(28,27,23,.08)', zIndex: 2, minWidth: 180}}>
    <div style={{color: G.ink, fontWeight: 500}}>{n.label}</div>
    {lines.map((l, i) => <div key={i} style={{color: /slips|Booking ends/.test(l) ? G.critical : G.muted}}>{l}</div>)}
  </div>;
}

export {toIso};
