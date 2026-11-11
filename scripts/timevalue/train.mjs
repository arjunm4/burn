#!/usr/bin/env node
// Train the habit model (architecture §10) from rendered sources only.
//
//   node scripts/timevalue/train.mjs [--sources fixtures/flintlock] [--out fixtures/timevalue]
//                                    [--usable-from 2026-09-10] [--split 0.7]
//
// Labels: Ramp charges linked to Xometry orders (labels.mjs). Usable = T ≥ usable-from (text start
// 2026-08-11 + 30 days, so every order has a full 30-day window) and linked. Time-ordered split:
// oldest 70% train (λ by 5-fold CV inside), newest 30% test.
// Writes <out>/habit-model.json and <out>/heatmaps.json (usable orders + the demo order).
// Rerun this one command after the final world and text are rendered (expect ~154 usable orders);
// anything produced from earlier, unfinished sources is a throwaway smoke test.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadSources } from '../../server/timevalue/sources.mjs';
import { linkRampToXometry } from '../../server/timevalue/labels.mjs';
import { makeResolver } from '../../server/timevalue/refs.mjs';
import { extractClaims } from '../../server/timevalue/claims.mjs';
import { progressRank } from '../../server/timevalue/progress.mjs';
import { makeReadContext, readDocs, loadReadCache } from '../../server/timevalue/read.mjs';
import { heatmap, settingsIndex, makeBaseline, ROWS, BANDS } from '../../server/timevalue/heatmap.mjs';
import { train, evaluate, predict, timeSplit } from '../../server/timevalue/habit.mjs';
import { weekStart, localDate, addDays } from '../generate-world/lib/calendar.mjs';

export const DEMO = { id: 'pt-hip-bracket', T: '2026-11-10T11:30:00-08:00' };
const DEFAULT_USABLE_FROM = '2026-09-10';

function parseArgs(argv) {
  const out = { sources: 'fixtures/flintlock', out: 'fixtures/timevalue', usableFrom: DEFAULT_USABLE_FROM, split: 0.7 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--sources') out.sources = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--usable-from') { out.usableFrom = argv[++i]; out.usableFromSet = true; }
    else if (a === '--split') out.split = Number(argv[++i]);
  }
  return out;
}

// Progress rank of an assembly as of the last full week before `at` (no peeking into T's week).
function makeProgress({ settings, sources, claims }) {
  const cache = new Map();
  return (assembly, atIso) => {
    const wk = addDays(weekStart(localDate(atIso)), -7);
    if (!cache.has(wk)) {
      let ranks = [];
      try {
        ranks = progressRank({ settings, sources, claims }, wk) ?? [];
      } catch {
        ranks = [];
      }
      cache.set(wk, new Map(ranks.map((r) => [r.assembly, r.rank])));
    }
    return cache.get(wk).get(assembly) ?? null;
  };
}

// The demo order's label-shaped stand-in: quote tiers, requester, T. No tier (not yet chosen).
export function demoLabel(demo, T = DEMO.T) {
  const q = demo.quote ?? {};
  const pe = demo.partEntry ?? {};
  return {
    order_number: DEMO.id,
    quote_id: q.quote_id ?? null,
    T,
    tier: null,
    requester_email: pe.requester?.email ?? q.customer_email ?? null,
    part_numbers: [...new Set([pe.part_number, ...(q.parts ?? []).map((p) => p.part_number)].filter(Boolean))],
    tiers: (q.lead_time_options ?? []).map((o) => ({
      tier: String(o.lead_time).toLowerCase(),
      total: o.total,
      lead_days: o.lead_time_business_days,
    })),
  };
}

export function run(opts = {}) {
  const o = { ...parseArgs([]), ...opts };
  const t0 = performance.now();
  const settings = JSON.parse(readFileSync(join(o.out, 'settings.json'), 'utf8'));
  if (!o.usableFromSet && settings.usable_from) o.usableFrom = settings.usable_from; // the real text start + 30 days
  const sources = loadSources(o.sources);
  const resolve = makeResolver(settings);
  const rctx = makeReadContext(settings, { resolve, extractClaims });
  const reads = loadReadCache(o.out, readDocs(sources.docs, rctx));
  const claims = [...reads.values()].flatMap((r) => r.claims ?? []);
  const progress = makeProgress({ settings, sources, claims });

  const linked = linkRampToXometry({ ramp: sources.ramp, xometry: sources.xometry });
  const labels = (Array.isArray(linked) ? linked : linked.linked ?? []).filter((l) => l.T && l.tier);
  const unlinked = Array.isArray(linked) ? linked.unlinked ?? [] : linked.unlinked ?? [];
  const from = Date.parse(`${o.usableFrom}T00:00:00-07:00`);
  const usable = labels
    .filter((l) => Date.parse(l.T) >= from)
    .sort((a, b) => Date.parse(a.T) - Date.parse(b.T) || (a.order_number < b.order_number ? -1 : 1));

  const sidx = settingsIndex(settings);
  const ctx = { sidx, ridx: reads, baseline: makeBaseline(sources.docs, reads, sidx) };
  const build = (label) =>
    heatmap({ label, docs: sources.docs, reads, settings, progress, history: labels, ctx });

  const rows = usable.map((l) => ({ heatmap: { ...build(l), tier: l.tier }, y: l.tier === 'expedite' ? 1 : 0 }));
  const { train: tr, test: te } = timeSplit(rows, o.split);
  const model = train(tr, { folds: 5 });
  const ev = evaluate(model, te);
  const evTrain = evaluate(model, tr);

  const demoHm = build(demoLabel(sources.demo, o.demoT ?? DEMO.T));
  const demoPred = predict(model, demoHm);

  const coverage = Object.fromEntries(
    ROWS.map((r) => [r, round(rows.filter((x) => (x.heatmap.cells[r] ?? []).some((v) => v)).length / Math.max(rows.length, 1))]),
  );
  const out = {
    generated_from: 'rendered sources (Ramp × Xometry labels, Slack/Jira/meetings/calendar context)',
    label: 'expedite vs not (tier of the Xometry order matched to its Ramp charge)',
    advisory: true,
    weights: model.weights,
    extra: model.extra,
    bias: model.bias,
    lambda: model.lambda,
    bands: BANDS.map((b) => b.key),
    band_days: BANDS.map((b) => b.from - b.to),
    n_train: tr.length,
    n_test: te.length,
    usable_from: o.usableFrom,
    n_labels: labels.length,
    n_unlinked_charges: unlinked.length,
    n_no_context: rows.filter((r) => r.heatmap.flags.no_context).length,
    expedite_rate_train: model.expedite_rate_train,
    split: { train_until: tr.at(-1)?.heatmap.T ?? null, test_from: te[0]?.heatmap.T ?? null },
    accuracy: ev.accuracy,
    accuracy_ci95: ev.accuracy_ci95,
    baseline_never_expedite: ev.baseline_never_expedite,
    accuracy_train: evTrain.accuracy,
    rows_used: ROWS.filter((r) => coverage[r] > 0),
    row_coverage: coverage,
    cv: model.cv,
    scaler: model.scaler,
    demo: { id: DEMO.id, T: demoHm.T, ...demoPred },
  };

  mkdirSync(o.out, { recursive: true });
  writeFileSync(join(o.out, 'habit-model.json'), JSON.stringify(out, null, 2) + '\n');
  const heatmaps = {
    usable_from: o.usableFrom,
    orders: rows.map((r) => ({ ...r.heatmap, split: tr.includes(r) ? 'train' : 'test' })),
    demo: demoHm,
  };
  writeFileSync(join(o.out, 'heatmaps.json'), JSON.stringify(heatmaps, null, 2) + '\n');
  return { model: out, heatmaps, ms: Math.round(performance.now() - t0) };
}

function round(x) {
  return Math.round(x * 1e4) / 1e4;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { model, ms } = run(parseArgs(process.argv.slice(2)));
  const ci = model.accuracy_ci95 ?? [];
  console.log(
    `habit: n_train ${model.n_train}, n_test ${model.n_test}, λ ${model.lambda}, ` +
      `accuracy ${model.accuracy} [${ci.join(', ')}] vs never-expedite ${model.baseline_never_expedite}, ` +
      `no_context ${model.n_no_context}, ${ms} ms`,
  );
  console.log(`demo ${model.demo.id}: p_expedite ${model.demo.p_expedite}`);
}
