import test from 'node:test';
import assert from 'node:assert/strict';
import { train, predict, evaluate, timeSplit, wilson, fitLogistic, featureNames } from './habit.mjs';
import { ROWS } from './heatmap.mjs';

// Synthetic heat maps: expedite when the last band is hot (deterministic, no Math.random).
function hm(i, hot) {
  const cells = Object.fromEntries(ROWS.map((r) => [r, [0, 0, 0, 0, 0]]));
  cells.messages = [((i * 7) % 5) / 10, ((i * 3) % 4) / 10, 0.1, hot ? 1.5 : 0.2, hot ? 2 + (i % 3) : (i % 2) * 0.5];
  cells.pressure[4] = hot ? 0.3 : -0.1;
  return {
    order_number: `XO-${String(i).padStart(3, '0')}`,
    T: new Date(Date.UTC(2026, 8, 10) + i * 3600e3 * 7).toISOString(),
    cells,
    flags: { no_context: false },
    extra: { requester_expedite_rate: 0.3, extra_usd_expedite: 6 + (i % 4) / 4 },
    linked: [],
  };
}
const rows = Array.from({ length: 80 }, (_, i) => {
  const hot = (i * 37) % 10 < 4;
  return { heatmap: hm(i, hot), y: hot ? 1 : 0 };
});

test('fitLogistic recovers a separating direction', () => {
  const Z = [[-2], [-1], [-0.5], [0.5], [1], [2]];
  const y = [0, 0, 1, 0, 1, 1];
  const { w } = fitLogistic(Z, y, 0.1);
  assert.ok(w[0] > 0.5);
});

test('train chooses λ by CV, lays weights out as row × 5 bands, and predicts', () => {
  const { train: tr, test: te } = timeSplit(rows, 0.7);
  assert.equal(tr.length, 56);
  assert.equal(te.length, 24);
  assert.ok(tr.at(-1).heatmap.T <= te[0].heatmap.T);
  const model = train(tr);
  assert.ok(model.cv.length > 3);
  assert.equal(typeof model.lambda, 'number');
  for (const r of ROWS) assert.equal(model.weights[r].length, 5);
  assert.ok('requester_expedite_rate' in model.extra && 'no_context' in model.extra);
  assert.equal(model.scaler.features.length, featureNames().length);
  assert.ok(model.weights.messages[4] > 0);
  const ev = evaluate(model, te);
  assert.ok(ev.accuracy >= 0.9, `accuracy ${ev.accuracy}`);
  assert.ok(ev.accuracy_ci95[0] <= ev.accuracy && ev.accuracy <= ev.accuracy_ci95[1]);
  const p = predict(model, te[0].heatmap);
  assert.ok(p.p_expedite >= 0 && p.p_expedite <= 1);
  assert.equal(p.n_train, 56);
  assert.ok(p.top.length > 0 && p.top.length <= 5);
  assert.ok('row' in p.top[0] && 'band' in p.top[0] && 'contribution' in p.top[0]);
});

test('predict handles a no-context heat map (null cells imputed)', () => {
  const model = train(rows.slice(0, 50), { lambda: 1 });
  const cells = Object.fromEntries(ROWS.map((r) => [r, [null, null, null, null, null]]));
  const p = predict(model, { cells, flags: { no_context: true }, extra: {} });
  assert.ok(Number.isFinite(p.p_expedite));
});

test('wilson interval', () => {
  const [lo, hi] = wilson(35, 46);
  assert.ok(lo > 0.6 && lo < 0.65 && hi > 0.85 && hi < 0.88);
});

// End to end on a hand-made world: docs → heatmap → train. Only deadline talk 1–3 days before T
// drives expedite; everything else is noise. The model must put its largest weight on that cell.
test('recovers a known driving cell through heatmap()', async () => {
  const { heatmap } = await import('./heatmap.mjs');
  const settings = {
    people: [{ id: 'p-a', name: 'A', email: 'a@x.com', slack_id: 'UA', team: 't1', manager: null }],
    teams: [{ id: 't1', lead: null }],
    parts: Array.from({ length: 120 }, (_, i) => ({ id: `pt-${i}`, part_number: `FL-P-${1000 + i}`, assembly: 'a1' })),
  };
  const author = { email: 'a@x.com', slack_id: 'UA', name: 'A' };
  const docs = [];
  const reads = [];
  const labels = [];
  const DAY = 86400e3;
  for (let i = 0; i < 120; i++) {
    const tMs = Date.UTC(2026, 8, 10, 18) + i * 12 * 3600e3;
    const hot = (i * 37) % 10 < 4; // deterministic ~40% expedite
    const pn = `FL-P-${1000 + i}`;
    const add = (daysBefore, claims, k) => {
      const id = `slack:C1:${i}.${k}`;
      docs.push({ id, source: 'slack', container: 'C1', thread: id, author, at: new Date(tMs - daysBefore * DAY).toISOString(), text: pn });
      reads.push({ doc_id: id, refs: [{ id: `pt-${i}`, mode: 'id' }], claims, pressure: ((i * 13) % 7) / 10 });
    };
    add(20 - (i % 5), [], 0); // background chatter in the early band for everyone
    add(5 + (i % 2), [], 1);
    if (hot) add(2, [{ kind: 'needs', subject: `pt-${i}` }], 2);
    else if (i % 3 === 0) add(2, [], 2); // same volume, no deadline talk
    labels.push({ order_number: `XO-${i}`, quote_id: `Q-${i}`, T: new Date(tMs).toISOString(), tier: hot ? 'expedite' : 'standard',
      requester_email: 'a@x.com', part_numbers: [pn], tiers: [{ tier: 'standard', total: 100, lead_days: 10 }, { tier: 'expedite', total: 180 + (i % 9), lead_days: 4 }] });
  }
  docs.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const rows = labels.map((label) => ({ heatmap: heatmap({ label, docs, reads, settings, history: labels }), y: label.tier === 'expedite' ? 1 : 0 }));
  const { train: tr, test: te } = timeSplit(rows);
  const model = train(tr);
  let best = null;
  for (const [row, ws] of Object.entries(model.weights)) ws.forEach((w, b) => { if (!best || Math.abs(w) > Math.abs(best.w)) best = { row, b, w }; });
  assert.equal(best.row, 'deadline_talk');
  assert.equal(best.b, 3); // b1_3
  assert.ok(best.w > 0);
  assert.ok(evaluate(model, te).accuracy >= 0.9);
  const hot = te.find((r) => r.y === 1);
  const p = predict(model, hot.heatmap);
  assert.ok(p.p_expedite > 0.5);
  assert.deepEqual([p.top[0].row, p.top[0].band], ['deadline_talk', 'b1_3']);
});
