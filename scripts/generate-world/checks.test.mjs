// Runs checks on the example world after planning and emitting the B renderers into a temp dir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChecks, dateTextViolations } from './checks.mjs';
import { buildProvenance } from './provenance.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EX = path.resolve(HERE, '../../fixtures/world/example');

async function build() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'burn-checks-'));
  const out = path.join(dir, 'out');
  fs.copyFileSync(path.join(EX, 'world.json'), path.join(dir, 'world.json'));
  fs.copyFileSync(path.join(EX, 'answers.json'), path.join(dir, 'answers.json'));
  const world = JSON.parse(fs.readFileSync(path.join(dir, 'world.json'), 'utf8'));
  const ctx = { seed: 1, weeks: 13, demoNow: world.meta.demo_now };
  const filled = JSON.parse(fs.readFileSync(path.join(EX, 'jobs/meeting.filled.json'), 'utf8'));
  const planned = {};
  for (const name of ['meetings', 'calendar', 'xometry', 'ramp']) {
    const mod = await import(`./render/${name}.mjs`);
    const { records, jobs } = mod.plan(world, ctx);
    planned[name] = { source: name, records };
    fs.mkdirSync(path.join(dir, 'planned'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'planned', `${name}.json`), JSON.stringify(planned[name], null, 2));
    const texts = {};
    for (const j of jobs) {
      fs.mkdirSync(path.join(dir, 'jobs', j.source), { recursive: true });
      const f = { ...j, status: 'filled', transcript: filled.transcript, summary: filled.summary };
      fs.writeFileSync(path.join(dir, 'jobs', j.source, `${j.job_id}.json`), JSON.stringify(f, null, 2));
      texts[j.meeting.id] = { transcript: f.transcript, summary: f.summary };
    }
    for (const f of mod.emit(records, texts, ctx).files) {
      fs.mkdirSync(path.dirname(path.join(out, f.path)), { recursive: true });
      fs.writeFileSync(path.join(out, f.path), f.content);
    }
  }
  return { dir, out, planned };
}

test('checks pass on the example world and write coverage.json', async () => {
  const { dir, out } = await build();
  const r = await runChecks({ world: dir, out, weeks: 13 });
  assert.deepEqual(r.errors, []);
  assert.ok(r.info.i16_crumbs_checked >= 1);
  const cov = JSON.parse(fs.readFileSync(path.join(dir, 'coverage.json'), 'utf8'));
  assert.equal(cov.text_start, '2026-08-17T00:00:00-07:00');
  assert.equal(cov.usable_from, '2026-09-16');
  assert.deepEqual(cov.orders.map((o) => o.order_number), ['XO-5584710']);
});

test('checks catch a Ramp amount that differs, a leak and a late delivery', async () => {
  const { dir, out } = await build();
  const tp = path.join(out, 'ramp/transactions.json');
  const tx = JSON.parse(fs.readFileSync(tp, 'utf8'));
  tx.data[0].amount += 1;
  tx.data[0].hidden_reason = 'genuine_gain';
  fs.writeFileSync(tp, JSON.stringify(tx, null, 2) + '\n');
  const op = path.join(out, 'xometry/orders.json');
  const xo = JSON.parse(fs.readFileSync(op, 'utf8'));
  xo.orders[1].delivered_at = '2026-11-12T10:00:00-08:00';
  fs.writeFileSync(op, JSON.stringify(xo, null, 2) + '\n');
  const r = await runChecks({ world: dir, out, weeks: 13, writeCoverage: false });
  const text = r.errors.join('\n');
  assert.match(text, /I18: Ramp charges for XO-5520193/);
  assert.match(text, /I20: .*hidden key "hidden_reason"/);
  assert.match(text, /I19: .*genuine_gain/);
  assert.match(text, /I13: order XO-5584710 delivered after demo_now/);
  assert.match(text, /I22: ramp\/transactions.json differs/);
});

test('checks flag a missing meeting crumb and a storyline id in a job', async () => {
  const { dir, out } = await build();
  fs.rmSync(path.join(out, 'meetings'), { recursive: true });
  fs.copyFileSync(path.join(EX, 'jobs/meeting.blank.json'), path.join(dir, 'jobs/meeting/example.json'));
  const r = await runChecks({ world: dir, out, weeks: 13, writeCoverage: false });
  const text = r.errors.join('\n');
  assert.match(text, /I16: crumb ev-000010/);
  assert.match(text, /I20: job .* storyline id "sl-hip-backlash"/);
});

test('provenance maps events and orders to records and back', async () => {
  const { planned } = await build();
  const p = buildProvenance(planned);
  assert.deepEqual(p.events['ev-000010'].map((x) => x.source).sort(), ['calendar', 'meetings']);
  assert.ok(p.records['meetings:mtg-00001'].includes('ev-000011'));
  const srcs = p.orders['ord-x-00001'].map((x) => `${x.source}:${x.record}`);
  assert.ok(srcs.includes('xometry:XO-5520193') && srcs.includes('ramp:d6da5f41-2ac4-4142-84a3-9303affce510'));
});

test('text window start equals plan.mjs makeCtx for weeks 1 and 13', async () => {
  const { makeCtx } = await import('./plan.mjs');
  const { textStartFor } = await import('./render/common-b.mjs');
  const world = JSON.parse(fs.readFileSync(path.join(EX, 'world.json'), 'utf8'));
  for (const weeks of [1, 13]) assert.equal(textStartFor(world, weeks), makeCtx(world, { seed: 1, weeks, knobs: {} }).textStart);
  assert.equal(textStartFor(world, 13), '2026-08-17T00:00:00-07:00');
  assert.equal(textStartFor(world, 1), '2026-11-09T00:00:00-08:00');
});

test('date check: weekday must match the date, relative days point forward', () => {
  const at = '2026-11-10T10:00:00-08:00'; // Tuesday
  assert.deepEqual(dateTextViolations('see you wed the 18th', at), []);
  assert.equal(dateTextViolations('see you tue the 18th', at).length, 1);
  assert.deepEqual(dateTextViolations('Mon, Nov 23 works', at), []);
  assert.equal(dateTextViolations('Fri 11/23 works', at).length, 1);
  assert.equal(dateTextViolations('tomorrow thu', at).length, 1);
  assert.deepEqual(dateTextViolations('tomorrow wed', at), []);
});
