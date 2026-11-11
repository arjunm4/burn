import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, copyFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('../../', import.meta.url).pathname;
const need = ['labels', 'refs', 'claims', 'progress', 'read', 'sources'].map((m) => join(root, `server/timevalue/${m}.mjs`));
const ready = need.every(existsSync) && existsSync(join(root, 'fixtures/timevalue/settings.json'));

test('demoLabel builds the demo order from the part entry and quote', { skip: !ready && 'sibling modules not built yet' }, async () => {
  const { demoLabel, DEMO } = await import('./train.mjs');
  const demo = JSON.parse(readFileSync(join(root, 'fixtures/flintlock/demo/quote.json'), 'utf8'));
  const pe = JSON.parse(readFileSync(join(root, 'fixtures/flintlock/demo/part-entry.json'), 'utf8'));
  const l = demoLabel({ quote: demo, partEntry: pe });
  assert.equal(l.T, DEMO.T);
  assert.deepEqual(l.part_numbers, ['FL-HIP-1042']);
  assert.equal(l.requester_email, 'owen@flintlockrobotics.com');
  assert.ok(l.tiers.some((t) => t.tier === 'standard') && l.tiers.some((t) => t.tier === 'expedite'));
});

// Format and runtime smoke test only: the current sources are not final, so no accuracy is asserted
// or reported from them (outputs go to a temp dir, never fixtures/timevalue).
test('train.mjs runs end to end on the dev sources in < 30 s', { skip: !ready && 'sibling modules not built yet', timeout: 60e3 }, async () => {
  const { run } = await import('./train.mjs');
  const out = mkdtempSync(join(tmpdir(), 'tv-train-'));
  copyFileSync(join(root, 'fixtures/timevalue/settings.json'), join(out, 'settings.json'));
  const { model, heatmaps, ms } = run({ sources: join(root, 'fixtures/flintlock'), out });
  assert.ok(ms < 30e3, `${ms} ms`);
  assert.ok(model.n_train > 50 && model.n_test > 20, `${model.n_train}/${model.n_test}`);
  assert.equal(Math.round((model.n_train + model.n_test) * 0.7), model.n_train);
  assert.ok(model.accuracy >= 0 && model.accuracy <= 1);
  assert.ok(model.accuracy_ci95[0] <= model.accuracy && model.accuracy <= model.accuracy_ci95[1]);
  assert.equal(model.weights.messages.length, 5);
  // time-ordered: every train order is placed no later than every test order
  const tr = heatmaps.orders.filter((h) => h.split === 'train').map((h) => Date.parse(h.T));
  const te = heatmaps.orders.filter((h) => h.split === 'test').map((h) => Date.parse(h.T));
  assert.ok(Math.max(...tr) <= Math.min(...te));
  assert.equal(heatmaps.demo.order_number, 'pt-hip-bracket');
  assert.ok(model.demo.p_expedite >= 0 && model.demo.p_expedite <= 1);
  assert.ok(Array.isArray(model.demo.top));
});
