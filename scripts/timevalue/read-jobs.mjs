#!/usr/bin/env node
// Context read jobs (agent D).
//
//   node scripts/timevalue/read-jobs.mjs [--sources fixtures/flintlock] [--out fixtures/timevalue] [--size 40]
//     → prefilters docs, writes <out>/read-jobs/<job_id>.json and <out>/read-jobs/index.json
//   node scripts/timevalue/read-jobs.mjs --collect [--out fixtures/timevalue]
//   (sample loop: --sources fixtures/timevalue/read-sample --out fixtures/timevalue/read-sample --size 8)
//     → validates filled jobs into <out>/read-cache.json
//
// Prefilter: a doc is read when it has a ref (C's resolver), or shares a thread with
// one (Slack thread, Jira ticket, meeting file). Priority: demo context first (threads
// with a doc in the 30 days before now that touches the demo part, its test or the
// slipping motor, found by resolving demo/part-entry.json and demo/live-changes.json),
// then the rest by week, newest first. Threads stay together unless longer than a job.
//
// Idempotent: a job's id is a hash of its doc ids. Existing jobs with the same id are
// left alone; filled jobs are never overwritten and their docs are not re-queued;
// unfilled jobs no longer in the plan are removed.
// Agents fill jobs by following docs/build/read-job-instructions.md.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readDocs } from '../../server/timevalue/read.mjs';

export const CLAIM_KINDS = ['needs', 'eta', 'done', 'blocked', 'need_earlier', 'duration'];
export const REF_MODES = ['id', 'alias', 'vague'];
export const INSTRUCTIONS = 'docs/build/read-job-instructions.md';
const DAY = 86400000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------- planning (pure)

export function threadKey(doc) {
  return `${doc.source}|${doc.container}|${doc.thread ?? doc.id}`;
}

/** Docs with a ref plus the rest of their thread. → {selected: [doc], units: Map key → [doc]} */
export function prefilter(docs, readsById) {
  const byThread = new Map();
  for (const d of docs) {
    const k = threadKey(d);
    if (!byThread.has(k)) byThread.set(k, []);
    byThread.get(k).push(d);
  }
  const units = new Map();
  for (const [k, list] of byThread) {
    if (list.some((d) => (readsById.get(d.id)?.refs || []).length)) units.set(k, list);
  }
  const selected = [...units.values()].flat().sort(byAtId);
  return { selected, units };
}

/** Ids the demo is about: resolve the part entry and the live changes. */
export function demoFocus({ partEntry, liveChanges }, resolve) {
  const texts = [];
  if (partEntry) texts.push([partEntry.part_name, partEntry.part_number, partEntry.summary].filter(Boolean).join(' '));
  for (const c of liveChanges?.changes || []) if (c.message?.text) texts.push(c.message.text);
  const ids = new Set();
  for (const t of texts) {
    const refs = resolve(t) || [];
    const firm = refs.filter((r) => !r.ambiguous);
    for (const r of firm.length ? firm : refs) ids.add(r.id);
  }
  return [...ids].sort();
}

/**
 * Order thread units and pack them into jobs of about `size` docs.
 * @returns [{job_id, priority, label, doc_ids}] in priority order
 */
export function planJobs({ units, readsById, focus, now, size = 40, skip = new Set() }) {
  const nowMs = Date.parse(now);
  const focusSet = new Set(focus);
  const ordered = [];
  for (const [key, list] of units) {
    const docs = list.filter((d) => !skip.has(d.id)).sort(byAtId);
    if (!docs.length) continue;
    const latest = Math.max(...docs.map((d) => Date.parse(d.at)));
    const demo = list.some((d) => {
      const t = Date.parse(d.at);
      return t >= nowMs - 30 * DAY && t <= nowMs
        && (readsById.get(d.id)?.refs || []).some((r) => focusSet.has(r.id));
    });
    ordered.push({ key, docs, latest, demo, week: weekStart(latest) });
  }
  ordered.sort((a, b) => (b.demo - a.demo) || (b.week - a.week) || (b.latest - a.latest) || (a.key < b.key ? -1 : 1));

  const jobs = [];
  let cur = null;
  const flush = () => { if (cur && cur.docs.length) jobs.push(cur); cur = null; };
  for (const u of ordered) {
    for (let i = 0; i < u.docs.length; i += size) {
      const piece = u.docs.slice(i, i + size);
      if (cur && (cur.demo !== u.demo || cur.docs.length + piece.length > size)) flush();
      if (!cur) cur = { demo: u.demo, docs: [], weeks: new Set() };
      cur.docs.push(...piece);
      cur.weeks.add(u.week);
    }
  }
  flush();
  return jobs.map((j, i) => {
    const doc_ids = j.docs.map((d) => d.id).sort();
    const weeks = [...j.weeks].sort((a, b) => b - a).map((w) => new Date(w).toISOString().slice(0, 10));
    return {
      job_id: jobId(doc_ids),
      priority: i + 1,
      label: j.demo ? 'demo context' : `weeks of ${weeks[weeks.length - 1]}..${weeks[0]}`,
      demo: j.demo,
      doc_ids: j.docs.map((d) => d.id),
    };
  });
}

export function jobId(docIds) {
  return 'rj-' + createHash('sha1').update([...docIds].sort().join('\n')).digest('hex').slice(0, 10);
}

/** Catalog entries for a job: everything its docs resolve to, plus the assemblies they touch. */
export function catalogSlice(settings, docs, readsById) {
  const all = catalogOf(settings);
  const byId = new Map(all.map((e) => [e.id, e]));
  const ids = new Set();
  const assemblies = new Set();
  const channelAsm = new Map((settings.channels || []).map((c) => [c.slack_id, c.assembly]));
  const projectAsm = new Map();
  for (const a of settings.assemblies || []) if (a.jira_project) {
    if (!projectAsm.has(a.jira_project)) projectAsm.set(a.jira_project, []);
    projectAsm.get(a.jira_project).push(a.id);
  }
  for (const d of docs) {
    for (const r of readsById.get(d.id)?.refs || []) ids.add(r.id);
    if (channelAsm.get(d.container)) assemblies.add(channelAsm.get(d.container));
    if (d.source === 'jira') for (const a of projectAsm.get(String(d.container).split('-')[0]) || []) assemblies.add(a);
  }
  for (const id of ids) if (byId.get(id)?.assembly) assemblies.add(byId.get(id).assembly);
  for (const e of all) {
    if (e.assembly && assemblies.has(e.assembly)) ids.add(e.id);
    if (e.kind === 'milestone' && (e.assemblies || []).some((a) => assemblies.has(a))) ids.add(e.id);
  }
  for (const t of settings.tests || []) if (ids.has(t.id)) {
    if (t.rig) ids.add(t.rig);
    if (t.milestone) ids.add(t.milestone);
  }
  return [...ids].filter((id) => byId.has(id)).sort().map((id) => byId.get(id));
}

export function catalogOf(settings) {
  const out = [];
  for (const p of settings.parts || []) out.push({ id: p.id, kind: 'part', name: p.name, part_number: p.part_number, aliases: p.aliases || [], assembly: p.assembly });
  for (const d of settings.deliverables || []) out.push({ id: d.id, kind: 'deliverable', name: d.name, aliases: d.aliases || [], assembly: d.assembly });
  for (const t of settings.tests || []) out.push({ id: t.id, kind: 'test', name: t.name, assembly: t.assembly, rig: t.rig, milestone: t.milestone });
  for (const m of settings.milestones || []) out.push({ id: m.id, kind: 'milestone', name: m.name, assemblies: m.assemblies || [] });
  for (const r of settings.rigs || []) out.push({ id: r.id, kind: 'rig', name: r.name });
  return out;
}

/** The job file a Claude agent fills. */
export function buildJobFile(job, { docsById, settings, readsById, now, personOf }) {
  const docs = job.doc_ids.map((id) => docsById.get(id));
  const chName = new Map((settings.channels || []).map((c) => [c.slack_id, c.name]));
  return {
    job_id: job.job_id,
    priority: job.priority,
    label: job.label,
    now,
    instructions: INSTRUCTIONS,
    output: 'Fill "results" with one entry per doc (see instructions), set "filled_by", then save this file.',
    catalog: catalogSlice(settings, docs, readsById),
    docs: docs.map((d) => ({
      id: d.id,
      source: d.source,
      where: d.source === 'slack' ? `#${chName.get(d.container) || d.container}` : d.container,
      thread: d.thread ?? null,
      author: d.author?.name || null,
      author_id: personOf(d.author)?.id || null,
      at: d.at,
      text: d.text,
    })),
    filled_by: null,
    results: null,
  };
}

// ---------------------------------------------------------------- validation (pure)

function isDateOrRange(v) {
  if (v == null) return true;
  if (typeof v === 'string') return DATE_RE.test(v);
  return typeof v === 'object' && DATE_RE.test(v.min) && DATE_RE.test(v.max) && v.min <= v.max;
}
function isDuration(v) {
  if (typeof v === 'number') return v > 0 && v < 400;
  return v && typeof v === 'object' && typeof v.min === 'number' && typeof v.max === 'number' && v.min > 0 && v.min <= v.max;
}

/** Validate a filled job. → {reads, errors, missing} (reads in the read.mjs shape, via "llm") */
export function validateJob(job) {
  const errors = [];
  const catalog = new Map((job.catalog || []).map((e) => [e.id, e]));
  const docs = new Map((job.docs || []).map((d) => [d.id, d]));
  const okId = (id) => id === 'unresolved' || catalog.has(id);
  const seen = new Set();
  const reads = [];
  for (const r of Array.isArray(job.results) ? job.results : []) {
    const errs = [];
    const doc = docs.get(r?.doc_id);
    if (!doc) { errors.push(`${job.job_id}: unknown doc_id ${r?.doc_id}`); continue; }
    if (seen.has(r.doc_id)) { errors.push(`${job.job_id}: duplicate ${r.doc_id}`); continue; }
    if (typeof r.pressure !== 'number' || !(r.pressure >= 0 && r.pressure <= 1)) errs.push('pressure not in 0..1');
    for (const ref of r.refs || []) {
      if (!okId(ref?.id)) errs.push(`ref id ${ref?.id} not in catalog`);
      if (ref?.mode != null && !REF_MODES.includes(ref.mode)) errs.push(`ref mode ${ref.mode}`);
    }
    for (const id of r.done || []) if (!catalog.has(id)) errs.push(`done id ${id} not in catalog`);
    for (const c of r.claims || []) {
      if (!CLAIM_KINDS.includes(c?.kind)) { errs.push(`claim kind ${c?.kind}`); continue; }
      if (!okId(c.subject)) errs.push(`claim subject ${c.subject} not in catalog`);
      if (c.kind === 'duration' ? !isDuration(c.value) : c.kind === 'blocked' ? !(c.value == null || okId(c.value)) : !isDateOrRange(c.value)) {
        errs.push(`claim ${c.kind} value ${JSON.stringify(c.value)}`);
      }
      if (c.qty != null && !(Number.isInteger(c.qty) && c.qty > 0)) errs.push(`claim qty ${c.qty}`);
      if (c.for != null && !okId(c.for)) errs.push(`claim for ${c.for} not in catalog`);
    }
    if (errs.length) { errors.push(`${job.job_id} ${r.doc_id}: ${errs.join('; ')}`); continue; }
    seen.add(r.doc_id);
    reads.push({
      doc_id: r.doc_id,
      refs: (r.refs || []).map((x) => ({ id: x.id, kind: catalog.get(x.id)?.kind || null, mode: REF_MODES.includes(x.mode) ? x.mode : 'alias', token: x.token ?? null })),
      claims: (r.claims || []).map((c) => ({
        kind: c.kind, subject: c.subject, value: c.value ?? null,
        ...(c.qty != null ? { qty: c.qty } : {}),
        ...(c.for != null ? { for: c.for } : {}),
        doc_id: r.doc_id, by: doc.author_id, at: doc.at,
      })),
      pressure: Math.round(r.pressure * 1000) / 1000,
      done: [...new Set(r.done || [])].sort(),
      cues: (r.cues || []).map(String),
      via: 'llm',
      job_id: job.job_id,
    });
  }
  const missing = [...docs.keys()].filter((id) => !seen.has(id));
  return { reads, errors, missing };
}

export function isFilled(job) {
  return Array.isArray(job?.results) && job.results.length > 0;
}

// ---------------------------------------------------------------- IO

function byAtId(a, b) {
  return a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
function weekStart(ms) {
  // Monday 00:00 UTC of the week containing ms − 8h (≈ Pacific); good enough for grouping.
  const d = new Date(ms - 8 * 3600000);
  const dow = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow);
}
function parseArgs(argv) {
  const a = { sources: 'fixtures/flintlock', out: 'fixtures/timevalue', size: 40, collect: false, now: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--collect') a.collect = true;
    else if (argv[i] === '--sources') a.sources = argv[++i];
    else if (argv[i] === '--out') a.out = argv[++i];
    else if (argv[i] === '--size') a.size = Number(argv[++i]);
    else if (argv[i] === '--now') a.now = argv[++i];
  }
  return a;
}
function readJobs(jobsDir) {
  if (!existsSync(jobsDir)) return [];
  return readdirSync(jobsDir).filter((f) => /^rj-[0-9a-f]+\.json$/.test(f)).sort()
    .map((f) => ({ file: join(jobsDir, f), job: JSON.parse(readFileSync(join(jobsDir, f), 'utf8')) }));
}
const writeJson = (file, obj) => writeFileSync(file, JSON.stringify(obj, null, 2) + '\n');

export function collect(outDir) {
  const jobsDir = join(outDir, 'read-jobs');
  const all = readJobs(jobsDir);
  const reads = new Map();
  const errors = [];
  let filled = 0, missing = 0;
  for (const { job } of all) {
    if (!isFilled(job)) continue;
    filled++;
    const v = validateJob(job);
    errors.push(...v.errors);
    missing += v.missing.length;
    for (const r of v.reads) reads.set(r.doc_id, r);
  }
  const sorted = [...reads.values()].sort((a, b) => (a.doc_id < b.doc_id ? -1 : 1));
  writeJson(join(outDir, 'read-cache.json'), {
    generated_by: 'scripts/timevalue/read-jobs.mjs --collect',
    jobs_total: all.length, jobs_filled: filled, n: sorted.length, errors, reads: sorted,
  });
  return { jobs_total: all.length, jobs_filled: filled, reads: sorted.length, missing, errors };
}

/** B's loadSources, or a hand-made sample: a dir holding docs.json = {docs, demo} (used to test the loop). */
export async function loadSourcesOrSample(dir) {
  const sample = join(dir, 'docs.json');
  if (existsSync(sample)) return JSON.parse(readFileSync(sample, 'utf8'));
  const { loadSources } = await import('../../server/timevalue/sources.mjs');
  return loadSources(dir);
}

export async function generate({ sources, out, size, now }) {
  const { loadReadContext } = await import('../../server/timevalue/read.mjs');
  const settings = JSON.parse(readFileSync(join(out, 'settings.json'), 'utf8'));
  now = now || settings.demo_now;
  const src = await loadSourcesOrSample(sources);
  const docs = src.docs.filter((d) => Date.parse(d.at) <= Date.parse(now));
  const ctx = await loadReadContext(settings, { xometry: src.xometry, calendar: src.calendar });
  const reads = readDocs(docs, ctx);
  const readsById = new Map(reads.map((r) => [r.doc_id, r]));
  const docsById = new Map(docs.map((d) => [d.id, d]));

  const jobsDir = join(out, 'read-jobs');
  mkdirSync(jobsDir, { recursive: true });
  const existing = readJobs(jobsDir);
  const skip = new Set();
  for (const { job } of existing) if (isFilled(job)) for (const d of job.docs) skip.add(d.id);

  const { selected, units } = prefilter(docs, readsById);
  const focus = demoFocus(src.demo || {}, ctx.resolve);
  const plan = planJobs({ units, readsById, focus, now, size, skip });
  const planned = new Set(plan.map((j) => j.job_id));

  let written = 0, kept = 0, removed = 0;
  for (const { file, job } of existing) {
    if (!isFilled(job) && !planned.has(job.job_id)) { unlinkSync(file); removed++; }
  }
  for (const j of plan) {
    const file = join(jobsDir, `${j.job_id}.json`);
    if (existsSync(file)) { kept++; continue; }
    writeJson(file, buildJobFile(j, { docsById, settings, readsById, now, personOf: ctx.personOf }));
    written++;
  }
  const filledJobs = existing.filter(({ job }) => isFilled(job));
  const index = {
    instructions: INSTRUCTIONS, now, focus, c_modules: ctx.c_modules,
    docs_total: docs.length, docs_selected: selected.length,
    prefilter_ratio: docs.length ? Math.round((selected.length / docs.length) * 1000) / 1000 : 0,
    docs_with_ref: reads.filter((r) => r.refs.length).length,
    jobs: [
      ...filledJobs.map(({ job }) => ({ job_id: job.job_id, label: job.label, n: job.docs.length, status: 'filled' })),
      ...plan.map((j) => ({ job_id: j.job_id, priority: j.priority, label: j.label, n: j.doc_ids.length, status: 'open' })),
    ],
  };
  writeJson(join(jobsDir, 'index.json'), index);
  return { ...index, jobs: index.jobs.length, open: plan.length, written, kept, removed };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const out = resolvePath(args.out);
  if (args.collect) {
    const r = collect(out);
    console.log(`collected ${r.reads} reads from ${r.jobs_filled}/${r.jobs_total} filled jobs; ${r.missing} docs without a result; ${r.errors.length} errors`);
    for (const e of r.errors.slice(0, 20)) console.log('  ' + e);
    return;
  }
  const r = await generate({ sources: resolvePath(args.sources), out, size: args.size, now: args.now });
  console.log(`docs ${r.docs_total}; with a ref ${r.docs_with_ref}; selected (with threads) ${r.docs_selected} → prefilter ratio ${r.prefilter_ratio}`);
  console.log(`focus: ${r.focus.join(', ')}; resolver: ${r.c_modules}`);
  console.log(`jobs: ${r.open} open (${r.written} new, ${r.kept} kept, ${r.removed} stale removed), ${r.jobs - r.open} filled`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
