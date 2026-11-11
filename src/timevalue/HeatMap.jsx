import React from 'react';

// Habit model weights: rows × 5 time bands before the order. Diverging color around zero:
// warm = pushes toward Expedite, cool = toward Standard/Economy. Each cell also prints its value.
const H = {ink: '#1C1B17', muted: '#7A766F', line: '#E2DFDA', hair: '#EFECE8', warm: [181, 83, 43], cool: [62, 106, 138]};
const BANDS = ['14–30 d', '7–14 d', '3–7 d', '1–3 d', '0–1 d'];
const LABEL = {
  messages: 'Messages', pressure: 'Pressure (vs team)', deadline_talk: 'Deadline talk', waiting_talk: 'Waiting talk', slips: 'Slips',
  people: 'People', manager: 'Manager joined', meetings: 'Meetings', progress_rank: 'Behind on progress', id_share: 'Named by id',
  requester_expedite_rate: "Requester's expedite rate", extra_usd_expedite: 'Extra $ for Expedite (log)',
};

function fill(w, max) {
  if (w == null || !max) return '#fff';
  const [r, g, b] = w >= 0 ? H.warm : H.cool;
  const a = Math.min(1, Math.abs(w) / max) * 0.85;
  return `rgba(${r},${g},${b},${a.toFixed(3)})`;
}
const fmt = w => (w == null ? '—' : (w > 0 ? '+' : '') + w.toFixed(2));

export default function HeatMap({habit, top = []}) {
  if (!habit?.weights) {
    return <div style={{color: H.muted, fontSize: 12, lineHeight: 1.5}}>The habit model hasn’t been trained yet (no <code>habit-model.json</code>). The card’s decision doesn’t depend on it.</div>;
  }
  const rows = Object.keys(habit.weights);
  const extras = Object.entries(habit.extra || {}).filter(([, v]) => typeof v === 'number');
  const all = [...rows.flatMap(r => habit.weights[r] || []), ...extras.map(([, v]) => v)].filter(v => typeof v === 'number');
  const max = Math.max(1e-9, ...all.map(Math.abs));
  const hot = new Set(top.map(t => `${t.row}|${t.band}`));
  const cell = {padding: 0, borderTop: `1px solid ${H.hair}`};
  return <div style={{display: 'flex', flexDirection: 'column', gap: 10}}>
    <table style={{borderCollapse: 'collapse', fontSize: 11, width: '100%', tableLayout: 'fixed'}}>
      <thead><tr>
        <th style={{width: '38%'}}/>
        {BANDS.map(b => <th key={b} style={{fontWeight: 400, color: H.muted, padding: '0 0 6px', textAlign: 'center'}}>{b}</th>)}
      </tr></thead>
      <tbody>
        {rows.map(r => <tr key={r}>
          <td style={{...cell, padding: '0 8px 0 0', color: H.ink, height: 26, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{LABEL[r] || r}</td>
          {BANDS.map((b, i) => {
            const w = habit.weights[r]?.[i];
            const strong = w != null && Math.abs(w) / max > 0.55;
            const k = `${r}|${i}`;
            return <td key={b} style={cell} title={`${LABEL[r] || r}, ${b} before the order: ${fmt(w)}`}>
              <div style={{margin: 1, height: 24, borderRadius: 3, background: fill(w, max), display: 'grid', placeItems: 'center', color: strong ? '#fff' : H.ink, fontVariantNumeric: 'tabular-nums', outline: hot.has(k) ? `1.5px solid ${H.ink}` : 'none', outlineOffset: -1}}>{fmt(w)}</div>
            </td>;
          })}
        </tr>)}
        {extras.map(([k, w]) => <tr key={k}>
          <td style={{...cell, padding: '0 8px 0 0', height: 26}}>{LABEL[k] || k}</td>
          <td colSpan={5} style={cell}><div style={{margin: 1, height: 24, borderRadius: 3, background: fill(w, max), display: 'grid', placeItems: 'center', color: Math.abs(w) / max > 0.55 ? '#fff' : H.ink}}>{fmt(w)}</div></td>
        </tr>)}
      </tbody>
    </table>
    <div style={{display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', fontSize: 11, color: H.muted}}>
      <span style={{display: 'inline-flex', gap: 6, alignItems: 'center'}}><span style={{width: 14, height: 10, borderRadius: 2, background: fill(max, max)}}/>toward Expedite</span>
      <span style={{display: 'inline-flex', gap: 6, alignItems: 'center'}}><span style={{width: 14, height: 10, borderRadius: 2, background: fill(-max, max)}}/>toward Standard</span>
      {top.length > 0 && <span style={{display: 'inline-flex', gap: 6, alignItems: 'center'}}><span style={{width: 12, height: 10, borderRadius: 2, outline: `1.5px solid ${H.ink}`, outlineOffset: -1}}/>drove this order’s score</span>}
      <span>Standardized logistic weights{habit.n_train ? ` · trained on ${habit.n_train} orders` : ''}{habit.accuracy != null ? ` · held-out accuracy ${Math.round(habit.accuracy * 100)}%${habit.accuracy_ci95 ? ` (${habit.accuracy_ci95.map(x => Math.round(x * 100)).join('–')}%)` : ''}` : ''}</span>
    </div>
  </div>;
}
