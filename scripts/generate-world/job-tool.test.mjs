// Tests for the writer helper (view, fill, batches) on the example world.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, copyFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runPlan, ROOT } from './plan.mjs';
import { runAssemble } from './assemble.mjs';
import { viewJob, fillJob, makeBatches, resolveJob } from './job-tool.mjs';

async function world() {
  const dir = mkdtempSync(join(tmpdir(), 'burn-jobtool-'));
  copyFileSync(join(ROOT, 'fixtures/world/example/world.json'), join(dir, 'world.json'));
  const w = console.warn; console.warn = () => {};
  try { await runPlan({ worldDir: dir, weeks: 13 }); } finally { console.warn = w; }
  return dir;
}
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));

test('view is compact, shows slot keys and must_mention, and no hidden or internal ids', async () => {
  const dir = await world();
  const path = resolveJob(dir, 'slack-ch-test-lab-2026-08-31-crumbs');
  const job = read(path);
  const v = viewJob(job);
  for (const m of job.messages) { assert.ok(v.includes(m.ts)); for (const s of m.must_mention) assert.ok(v.includes(JSON.stringify(s))); }
  assert.ok(!/ev-\d|true_value|truth/.test(v));
  const jira = viewJob(read(resolveJob(dir, 'jira-TEST-2026-08-31-crumbs')));
  assert.ok(jira.includes('TEST-141-c1') && jira.includes('TEST-141 {summary, description}'));
});

test('fill merges valid text, reports bad slots, and assemble then uses the text', async () => {
  const dir = await world();
  const id = 'slack-ch-test-lab-2026-08-31-crumbs';
  const job = read(resolveJob(dir, id));
  const texts = Object.fromEntries(job.messages.map((m) => [m.ts, `${m.must_mention.join(' ')} ok then`]));
  const [first, second] = job.messages.filter((m) => m.must_mention.length);
  texts[second.ts] = 'nothing required here';
  texts['123.456'] = 'unknown';
  const r1 = fillJob(dir, id, texts);
  assert.ok(r1.problems.some((p) => p.startsWith('123.456')));
  assert.ok(r1.problems.some((p) => p.includes(second.ts)));
  assert.equal(r1.status, 'partial');
  let after = read(resolveJob(dir, id));
  assert.equal(after.messages.find((m) => m.ts === first.ts).text, texts[first.ts]);
  assert.equal(after.messages.find((m) => m.ts === second.ts).text, null);
  delete texts['123.456'];
  texts[second.ts] = `${second.must_mention.join(' ')} fixed`;
  const r2 = fillJob(dir, id, texts);
  assert.deepEqual(r2.problems, []);
  assert.equal(r2.status, 'filled');
  const res = await runAssemble({ worldDir: dir, outDir: join(dir, 'out'), weeks: 13 });
  assert.equal(res.counts.rejected, 0);
  assert.ok(readFileSync(join(dir, 'out/slack/C07FLK0TLAB.json'), 'utf8').includes('fixed'));
});

test('fill applies the background rules and Jira shapes', async () => {
  const dir = await world();
  const id = 'jira-TEST-2026-08-31-crumbs';
  const job = read(resolveJob(dir, id));
  const t = job.tickets[0];
  const texts = { [t.key]: { summary: `Order hooks ${t.must_mention.join(' ')}`, description: 'need before drop test' } };
  for (const c of t.comments) texts[c.id] = c.must_mention.length ? `moved ${c.must_mention.join(' ')}` : 'waiting on vendor';
  const r = fillJob(dir, id, texts);
  assert.deepEqual(r.problems, []);
  const bg = read(join(dir, 'jobs/index.json')).find((j) => j.source === 'slack' && j.kind === 'background');
  const bj = read(join(dir, bg.path));
  const r2 = fillJob(dir, bg.job_id, Object.fromEntries(bj.messages.map((m) => [m.ts, 'costs $400 on 9/12'])));
  assert.ok(r2.problems.length >= bj.messages.length);
});

test('batches follow priority, group by source and kind, and are stable', async () => {
  const dir = await world();
  const index = read(join(dir, 'jobs/index.json'));
  const a = makeBatches(index, { weeks: 13 });
  const b = makeBatches(index, { weeks: 13 });
  assert.deepEqual(a, b);
  for (const x of a) {
    if (x.source === 'slack' && x.kind === 'crumbs') assert.ok(x.jobs.length <= 6);
    if (x.source !== 'slack') assert.ok(x.jobs.length <= 8);
    if (x.source === 'slack' && x.kind === 'background') assert.ok(x.size_bytes <= 70 * 1024 || x.jobs.length === 1);
  }
  assert.equal(a.reduce((s, x) => s + x.jobs.length, 0), index.length);
  assert.equal(makeBatches(index, { weeks: 13, status: 'filled' }).length, 0);
});
