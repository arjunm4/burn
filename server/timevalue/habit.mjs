// Habit model (architecture §10): what does this team usually do, given the context heat map?
// Advisory only. Binary L2 logistic regression (expedite vs not) on standardized heat-map features.
//
//   train(rows, {lambda, lambdas, folds}) → model
//   predict(model, heatmap) → {p_expedite, n_train, top: [{row, band, contribution}]}
//
// rows = [{heatmap, y}] with y = 1 for expedite. With no `lambda`, λ is chosen by k-fold CV
// (mean log-loss) on the rows given, which must be the training split only.

import { ROWS, EXTRAS, BANDS } from './heatmap.mjs';

export const LAMBDAS = [0.01, 0.03, 0.1, 0.3, 1, 3, 10, 30, 100, 300];
export const FLAGS = ['no_context'];

// Feature names in a fixed order: row × band, then extras, then flags.
export function featureNames() {
  const names = [];
  for (const r of ROWS) for (const b of BANDS) names.push(`${r}.${b.key}`);
  for (const e of EXTRAS) names.push(e);
  for (const f of FLAGS) names.push(f);
  return names;
}

// Raw vector; null = unknown (imputed to the training mean, i.e. 0 after standardizing).
export function rawFeatures(hm) {
  const v = [];
  for (const r of ROWS) for (let i = 0; i < BANDS.length; i++) v.push(hm.cells?.[r]?.[i] ?? null);
  for (const e of EXTRAS) v.push(hm.extra?.[e] ?? null);
  v.push(hm.flags?.no_context ? 1 : 0);
  return v.map((x) => (typeof x === 'number' && Number.isFinite(x) ? x : null));
}

function fitScaler(X) {
  const d = X[0]?.length ?? 0;
  const mean = new Array(d).fill(0);
  const sd = new Array(d).fill(1);
  for (let j = 0; j < d; j++) {
    const vals = X.map((x) => x[j]).filter((v) => v !== null);
    if (!vals.length) continue;
    const m = vals.reduce((a, b) => a + b, 0) / vals.length;
    const s = Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / vals.length);
    mean[j] = m;
    sd[j] = s > 1e-12 ? s : 1;
  }
  return { mean, sd };
}

const standardize = (x, { mean, sd }) => x.map((v, j) => (v === null ? 0 : (v - mean[j]) / sd[j]));
const sigmoid = (z) => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)));

// Newton / IRLS for L2 logistic regression; the bias is not penalized.
// Loss = Σ logloss + λ/2 ‖w‖². Z already standardized. Returns {w, b}.
export function fitLogistic(Z, y, lambda, iters = 50) {
  const n = Z.length;
  const d = Z[0]?.length ?? 0;
  const p = d + 1; // last = bias
  let beta = new Array(p).fill(0);
  const ybar = y.reduce((a, b) => a + b, 0) / Math.max(n, 1);
  beta[d] = Math.log((ybar + 1e-3) / (1 - ybar + 1e-3));
  for (let it = 0; it < iters; it++) {
    const g = new Array(p).fill(0);
    const H = Array.from({ length: p }, () => new Array(p).fill(0));
    for (let i = 0; i < n; i++) {
      const zi = Z[i];
      let eta = beta[d];
      for (let j = 0; j < d; j++) eta += beta[j] * zi[j];
      const mu = sigmoid(eta);
      const r = mu - y[i];
      const wgt = Math.max(mu * (1 - mu), 1e-10);
      for (let j = 0; j < d; j++) g[j] += r * zi[j];
      g[d] += r;
      for (let j = 0; j < p; j++) {
        const zj = j === d ? 1 : zi[j];
        if (zj === 0) continue;
        for (let k = j; k < p; k++) {
          const zk = k === d ? 1 : zi[k];
          H[j][k] += wgt * zj * zk;
        }
      }
    }
    for (let j = 0; j < d; j++) {
      g[j] += lambda * beta[j];
      H[j][j] += lambda;
    }
    H[d][d] += 1e-8;
    for (let j = 0; j < p; j++) for (let k = 0; k < j; k++) H[j][k] = H[k][j];
    const step = solve(H, g);
    let maxStep = 0;
    beta = beta.map((b, j) => {
      maxStep = Math.max(maxStep, Math.abs(step[j]));
      return b - step[j];
    });
    if (maxStep < 1e-9) break;
  }
  return { w: beta.slice(0, d), b: beta[d] };
}

// Gaussian elimination with partial pivoting (A is copied).
function solve(A0, b0) {
  const n = b0.length;
  const A = A0.map((r) => r.slice());
  const b = b0.slice();
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]];
    [b[c], b[piv]] = [b[piv], b[c]];
    const d = A[c][c] || 1e-12;
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c] / d;
      if (!f) continue;
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k];
    x[r] = s / (A[r][r] || 1e-12);
  }
  return x;
}

function logloss(p, y) {
  const q = Math.min(Math.max(p, 1e-12), 1 - 1e-12);
  return -(y * Math.log(q) + (1 - y) * Math.log(1 - q));
}

// k-fold CV over λ (folds interleaved over the rows' order, deterministic). Returns {lambda, cv}.
export function chooseLambda(rows, { lambdas = LAMBDAS, folds = 5 } = {}) {
  const X = rows.map((r) => rawFeatures(r.heatmap));
  const y = rows.map((r) => (r.y ? 1 : 0));
  const cv = [];
  for (const lambda of lambdas) {
    let loss = 0;
    let correct = 0;
    let count = 0;
    for (let f = 0; f < folds; f++) {
      const tr = [];
      const te = [];
      X.forEach((_, i) => (i % folds === f ? te : tr).push(i));
      if (!tr.length || !te.length) continue;
      const scaler = fitScaler(tr.map((i) => X[i]));
      const fit = fitLogistic(tr.map((i) => standardize(X[i], scaler)), tr.map((i) => y[i]), lambda);
      for (const i of te) {
        const z = standardize(X[i], scaler);
        const p = sigmoid(fit.b + fit.w.reduce((s, w, j) => s + w * z[j], 0));
        loss += logloss(p, y[i]);
        correct += (p >= 0.5 ? 1 : 0) === y[i] ? 1 : 0;
        count++;
      }
    }
    cv.push({ lambda, logloss: count ? round(loss / count) : null, accuracy: count ? round(correct / count) : null });
  }
  const best = cv.filter((c) => c.logloss !== null).reduce((a, b) => (b.logloss < a.logloss ? b : a), cv[0]);
  return { lambda: best?.lambda ?? 1, cv };
}

export function train(rows, opts = {}) {
  let lambda = opts.lambda;
  let cv = null;
  if (typeof lambda !== 'number') ({ lambda, cv } = chooseLambda(rows, opts));
  const names = featureNames();
  const X = rows.map((r) => rawFeatures(r.heatmap));
  const y = rows.map((r) => (r.y ? 1 : 0));
  const scaler = fitScaler(X);
  const fit = fitLogistic(X.map((x) => standardize(x, scaler)), y, lambda);

  const weights = {};
  let j = 0;
  for (const r of ROWS) weights[r] = BANDS.map(() => round(fit.w[j++]));
  const extra = {};
  for (const e of EXTRAS) extra[e] = round(fit.w[j++]);
  for (const f of FLAGS) extra[f] = round(fit.w[j++]);

  return {
    weights,
    extra,
    bias: round(fit.b),
    lambda,
    n_train: rows.length,
    expedite_rate_train: rows.length ? round(y.reduce((a, b) => a + b, 0) / rows.length) : null,
    bands: BANDS.map((b) => b.key),
    scaler: { features: names, mean: scaler.mean.map(round), sd: scaler.sd.map(round) },
    cv,
  };
}

function flatWeights(model) {
  const w = [];
  for (const r of ROWS) for (let i = 0; i < BANDS.length; i++) w.push(model.weights?.[r]?.[i] ?? 0);
  for (const e of EXTRAS) w.push(model.extra?.[e] ?? 0);
  for (const f of FLAGS) w.push(model.extra?.[f] ?? 0);
  return w;
}

function labelOf(j) {
  const nb = ROWS.length * BANDS.length;
  if (j < nb) return { row: ROWS[Math.floor(j / BANDS.length)], band: BANDS[j % BANDS.length].key };
  const k = j - nb;
  return { row: k < EXTRAS.length ? EXTRAS[k] : FLAGS[k - EXTRAS.length], band: null };
}

export function predict(model, hm, { top = 5 } = {}) {
  const w = flatWeights(model);
  const z = standardize(rawFeatures(hm), model.scaler);
  const contribs = w.map((wj, j) => ({ ...labelOf(j), contribution: wj * z[j] }));
  const eta = model.bias + contribs.reduce((s, c) => s + c.contribution, 0);
  return {
    p_expedite: round(sigmoid(eta)),
    n_train: model.n_train,
    top: contribs
      .filter((c) => Math.abs(c.contribution) > 1e-9)
      .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution) || (a.row < b.row ? -1 : 1))
      .slice(0, top)
      .map((c) => ({ ...c, contribution: round(c.contribution) })),
  };
}

// Accuracy of a 0.5 threshold, its Wilson 95% interval, and the never-expedite baseline.
export function evaluate(model, rows) {
  const n = rows.length;
  let correct = 0;
  let neg = 0;
  for (const r of rows) {
    const p = predict(model, r.heatmap, { top: 0 }).p_expedite;
    if ((p >= 0.5 ? 1 : 0) === (r.y ? 1 : 0)) correct++;
    if (!r.y) neg++;
  }
  return {
    n,
    accuracy: n ? round(correct / n) : null,
    accuracy_ci95: n ? wilson(correct, n).map(round) : null,
    baseline_never_expedite: n ? round(neg / n) : null,
  };
}

export function wilson(k, n, z = 1.96) {
  const p = k / n;
  const den = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / den;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

// Time-ordered split: oldest `share` train, newest rest test.
export function timeSplit(rows, share = 0.7) {
  const t = (r) => Date.parse(r.heatmap.T);
  const sorted = [...rows].sort(
    (a, b) => t(a) - t(b) || (a.heatmap.order_number < b.heatmap.order_number ? -1 : 1),
  );
  const cut = Math.round(sorted.length * share);
  return { train: sorted.slice(0, cut), test: sorted.slice(cut) };
}

function round(x) {
  return Math.round(x * 1e4) / 1e4;
}
