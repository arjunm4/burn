import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prefilter, planJobs, jobId, validateJob, demoFocus, generate, collect, parseArgs } from './read-jobs.mjs';

const SAMPLE = new URL('../../fixtures/timevalue/read-sample/', import.meta.url).pathname;

const d = (id, thread, at, refs = []) => ({ doc: { id, source: 'slack', container: 'C1', thread, at, text: id }, read: { doc_id: id, refs } });
const ref = (id) => [{ id, kind: 'part', mode: 'alias' }];

function fixture() {
  const xs = [
    d('a1', 'A', '2026-11-03T09:00:00-08:00', ref('pt-x')), d('a2', 'A', '2026-11-03T10:00:00-08:00'),
    d('b1', 'B', '2026-09-01T09:00:00-07:00', ref('pt-y')), d('b2', 'B', '2026-09-02T09:00:00-07:00'),
    d('c1', 'C', '2026-11-04T09:00:00-08:00'), // no ref anywhere in the thread
    d('e1', 'E', '2026-10-20T09:00:00-07:00', ref('pt-y')),
  ];
  return { docs: xs.map((x) => x.doc), reads: new Map(xs.map((x) => [x.read.doc_id, x.read])) };
}

test('prefilter keeps docs with a ref and the rest of their thread', () => {
  const { docs, reads } = fixture();
  const { selected, units } = prefilter(docs, reads);
  assert.deepEqual(selected.map((x) => x.id).sort(), ['a1', 'a2', 'b1', 'b2', 'e1']);
  assert.equal(units.size, 3);
});

test('planJobs: demo first, then newest week; threads kept whole; ids stable', () => {
  const { docs, reads } = fixture();
  const { units } = prefilter(docs, reads);
  const plan = planJobs({ units, readsById: reads, focus: ['pt-x'], now: '2026-11-10T10:30:00-08:00', size: 3 });
  assert.equal(plan[0].label, 'demo context');
  assert.deepEqual(plan[0].doc_ids, ['a1', 'a2']);
  assert.deepEqual(plan[1].doc_ids, ['e1', 'b1', 'b2']); // newer week before older, packed to size
  assert.equal(plan.length, 2);
  assert.equal(plan[0].job_id, jobId(['a2', 'a1']));
  const again = planJobs({ units, readsById: reads, focus: ['pt-x'], now: '2026-11-10T10:30:00-08:00', size: 3 });
  assert.deepEqual(again.map((j) => j.job_id), plan.map((j) => j.job_id));
  // a thread longer than a job is split; skipped docs are not re-queued
  const split = planJobs({ units, readsById: reads, focus: [], now: '2026-11-10T10:30:00-08:00', size: 1, skip: new Set(['b1']) });
  assert.deepEqual(split.map((j) => j.doc_ids.join()), ['a1', 'a2', 'e1', 'b2']);
});

test('demoFocus resolves the part entry and live changes', () => {
  const resolve = (t) => (/1042/.test(t) ? [{ id: 'pt-hip-bracket' }] : /motor/.test(t) ? [{ id: 'dl-m', ambiguous: true }, { id: 'dl-n', ambiguous: true }] : []);
  assert.deepEqual(demoFocus({ partEntry: { part_number: 'FL-HIP-1042' }, liveChanges: { changes: [{ message: { text: 'motor slipped' } }] } }, resolve),
    ['dl-m', 'dl-n', 'pt-hip-bracket']);
});

test('validateJob rejects invented ids, bad kinds, bad values, bad pressure', () => {
  const job = {
    job_id: 'rj-x', catalog: [{ id: 'pt-a', kind: 'part' }, { id: 'test-t', kind: 'test' }],
    docs: [{ id: 'd1', author_id: 'p-o', at: '2026-11-03T09:00:00-08:00' }, { id: 'd2', author_id: null, at: '2026-11-03T10:00:00-08:00' }, { id: 'd3', at: 'x' }],
    results: [
      { doc_id: 'd1', refs: [{ id: 'pt-a', mode: 'id', token: 'FL-1' }], claims: [{ kind: 'needs', subject: 'pt-a', value: '2026-11-17', qty: 4, for: 'test-t' }, { kind: 'duration', subject: 'test-t', value: 3 }, { kind: 'eta', subject: 'unresolved', value: { min: '2026-11-19', max: '2026-11-30' } }], pressure: 0.4, done: [], cues: ['any update'] },
      { doc_id: 'd2', refs: [{ id: 'pt-invented' }], claims: [], pressure: 0.1, done: [] },
      { doc_id: 'd3', refs: [], claims: [{ kind: 'maybe', subject: 'pt-a' }], pressure: 1.4, done: [] },
      { doc_id: 'zz', refs: [], claims: [], pressure: 0, done: [] },
    ],
  };
  const v = validateJob(job);
  assert.equal(v.reads.length, 1);
  const r = v.reads[0];
  assert.equal(r.via, 'llm');
  assert.deepEqual(r.claims[0], { kind: 'needs', subject: 'pt-a', value: '2026-11-17', qty: 4, for: 'test-t', doc_id: 'd1', by: 'p-o', at: '2026-11-03T09:00:00-08:00' });
  assert.equal(r.refs[0].kind, 'part');
  assert.deepEqual(v.missing, ['d2', 'd3']);
  assert.equal(v.errors.length, 3);
  assert.ok(v.errors.some((e) => e.includes('pt-invented')));
  assert.ok(v.errors.some((e) => e.includes('unknown doc_id zz')));
  assert.equal(validateJob({ ...job, results: [{ ...job.results[0], claims: [{ kind: 'eta', subject: 'pt-a', value: '11/30' }] }] }).reads.length, 0);
});

test('loop on the hand-made sample: generate → fill → collect → regenerate keeps the filled job', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'readjobs-'));
  cpSync(join(SAMPLE, 'settings.json'), join(dir, 'settings.json'));
  cpSync(join(SAMPLE, 'docs.json'), join(dir, 'docs.json'));
  const g1 = await generate({ sources: dir, out: dir, size: 8, now: null });
  assert.equal(g1.docs_total, 19);
  assert.ok(g1.docs_selected < g1.docs_total);
  const files = readdirSync(join(dir, 'read-jobs')).filter((f) => f.startsWith('rj-'));
  assert.equal(files.length, g1.open);
  const index = JSON.parse(readFileSync(join(dir, 'read-jobs', 'index.json'), 'utf8'));
  assert.equal(index.jobs[0].label, 'demo context');

  const f = join(dir, 'read-jobs', `${index.jobs[0].job_id}.json`);
  const job = JSON.parse(readFileSync(f, 'utf8'));
  job.results = job.docs.map((x) => ({ doc_id: x.id, refs: [], claims: [], pressure: 0.25, done: [] }));
  job.filled_by = 'test';
  writeFileSync(f, JSON.stringify(job));
  const c = collect(dir);
  assert.equal(c.reads, job.docs.length);
  assert.equal(c.errors.length, 0);
  const cache = JSON.parse(readFileSync(join(dir, 'read-cache.json'), 'utf8'));
  assert.ok(cache.reads.every((r) => r.via === 'llm' && r.pressure === 0.25));

  const g2 = await generate({ sources: dir, out: dir, size: 8, now: null });
  assert.equal(g2.written + g2.kept, g2.open);
  assert.equal(JSON.parse(readFileSync(f, 'utf8')).filled_by, 'test'); // never overwritten
  assert.equal(g2.open, g1.open - 1); // its docs are not re-queued
  const g3 = await generate({ sources: dir, out: dir, size: 8, now: null });
  assert.equal(g3.written, 0); // idempotent
});

test('hardening: bad flags, missing inputs, broken job files, empty collect keeps the cache', async () => {
  assert.throws(() => parseArgs(['--size', '0']), /positive whole number/);
  assert.throws(() => parseArgs(['--out']), /--out needs a value/);
  assert.throws(() => parseArgs(['--bogus']), /unknown argument/);
  assert.throws(() => parseArgs(['--now', 'soon']), /not a date/);
  assert.equal(parseArgs(['--collect', '--size', '8']).size, 8);

  const empty = mkdtempSync(join(tmpdir(), 'readjobs-empty-'));
  await assert.rejects(generate({ sources: empty, out: empty, size: 8, now: null }), /settings\.json.*export-settings/);
  assert.throws(() => collect(empty), /no .*read-jobs/);

  const dir = mkdtempSync(join(tmpdir(), 'readjobs-hard-'));
  cpSync(join(SAMPLE, 'settings.json'), join(dir, 'settings.json'));
  await assert.rejects(generate({ sources: join(dir, 'nope'), out: dir, size: 8, now: null }), /sources dir .* not found/);
  cpSync(join(SAMPLE, 'docs.json'), join(dir, 'docs.json'));
  const g1 = await generate({ sources: dir, out: dir, size: 8, now: null });
  const jobs = join(dir, 'read-jobs');
  const [first, second] = readdirSync(jobs).filter((f) => f.startsWith('rj-')).sort();

  // a started job (filled_by set, no results yet) is never removed, even when no longer planned
  const started = join(jobs, 'rj-0000000001.json');
  writeFileSync(started, JSON.stringify({ job_id: 'rj-0000000001', docs: [], filled_by: 'agent', results: null }));
  await generate({ sources: dir, out: dir, size: 8, now: null });
  assert.ok(readdirSync(jobs).includes('rj-0000000001.json'));

  // a half-saved job file stops the run and nothing is touched
  const before = readdirSync(jobs).sort();
  writeFileSync(join(jobs, first), '{"results": [');
  await assert.rejects(generate({ sources: dir, out: dir, size: 8, now: null }), /not valid JSON/);
  assert.deepEqual(readdirSync(jobs).sort(), before);
  assert.ok(collect(dir).errors.some((e) => e.includes(first)));

  // a cache with reads is not replaced by an empty one
  writeFileSync(join(dir, 'read-cache.json'), JSON.stringify({ n: 1, reads: [{ doc_id: 'x' }] }));
  const bad = JSON.parse(readFileSync(join(jobs, second), 'utf8'));
  bad.results = [{ doc_id: 'not-a-doc', pressure: 0 }];
  writeFileSync(join(jobs, second), JSON.stringify(bad));
  const c = collect(dir);
  assert.equal(c.written, false);
  assert.equal(JSON.parse(readFileSync(join(dir, 'read-cache.json'), 'utf8')).n, 1);
  assert.ok(g1.open >= 2);
});
