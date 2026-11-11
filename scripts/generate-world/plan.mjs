#!/usr/bin/env node
// plan: world.json -> planned/<source>.json, jobs/<source>/<job_id>.json, jobs/index.json, planned/jobs.json.
//
//   node scripts/generate-world/plan.mjs [--seed N] [--weeks N] [--world fixtures/world]
//
// Reads world.json only (never answers.json). Code owns every fact; jobs carry text slots only.
// An existing job file whose status is "filled" is never overwritten (text is never rewritten).
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRng } from './lib/rng.mjs';
import { makeCalendar, atLocal } from './lib/calendar.mjs';
import { readJson, writeJson, stringify, cmp } from './lib/io.mjs';
import { textWeeks } from './render/slack.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, '..', '..');
export const SOURCES = ['slack', 'jira', 'meetings', 'calendar', 'xometry', 'ramp'];
// Keys that must never appear in a job (spec §4 I20).
export const HIDDEN_KEYS = ['true_value', 'truth', 'demands', 'slips', 'habit', 'habit_strength', 'wtp_per_day_usd', 'checks_dependencies',
  'expressiveness', 'tier_decided_by', 'need_identified_at', 'reveal', 'link_quality', 'storyline', 'storylines_ids', 'budget_windows',
  'pressure_windows', 'hidden_reason', 'rule', 'belief', 'true_need_date', 'true_links', 'tier_outcomes', 'expedite_helped',
  'break_even_usd_per_day', 'dominating_input', 'true_pressure', 'expressed_pressure', 'never_revealed', 'split', 'true_progress', 'true_rank'];

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; out[k] = v; }
  }
  return out;
}

export function loadKnobs(worldDir) {
  for (const p of [join(worldDir, 'knobs.json'), join(ROOT, 'fixtures/world/knobs.json')]) if (existsSync(p)) return readJson(p);
  return { weeks_of_context: 13 };
}

export async function loadRenderers() {
  const out = {};
  for (const s of SOURCES) {
    const file = join(HERE, 'render', `${s}.mjs`);
    if (!existsSync(file)) { console.warn(`plan: render/${s}.mjs missing, skipped`); continue; }
    try {
      const mod = await import(file);
      if (typeof mod.plan !== 'function' || typeof mod.emit !== 'function') { console.warn(`plan: render/${s}.mjs lacks plan/emit, skipped`); continue; }
      out[s] = mod;
    } catch (e) { console.warn(`plan: render/${s}.mjs failed to load (${e.message}), skipped`); }
  }
  return out;
}

export function makeCtx(world, { seed, weeks, knobs }) {
  const ws = textWeeks(world.meta.demo_now, weeks);
  return {
    seed, weeks, knobs, demoNow: world.meta.demo_now, textStart: atLocal(ws[0], '00:00'),
    rng: makeRng(seed), cal: makeCalendar(world.meta),
  };
}

// Text keys of a job, with what assemble needs to check them (kind, must_mention, Jira keys the job lists).
export function jobKeys(job, world) {
  const evKind = new Map(world.events.map((e) => [e.id, e.kind]));
  const crumb = (evs) => (evs || []).some((id) => evKind.get(id) === 'crumb');
  const listed = [...new Set((stringify(job).match(/\b[A-Z]{2,4}-\d+\b/g) || []))].sort();
  const keys = {};
  if (job.source === 'slack') for (const m of job.messages) keys[m.ts] = { kind: crumb(m.events) ? 'crumb' : 'background', must_mention: m.must_mention || [] };
  else if (job.source === 'jira') for (const t of job.tickets) {
    keys[t.key] = { kind: crumb(t.events) ? 'crumb' : 'background', must_mention: t.must_mention || [], fields: ['summary', 'description'] };
    for (const c of t.comments || []) keys[c.id] = { kind: crumb(c.events) ? 'crumb' : 'background', must_mention: c.must_mention || [] };
  } else if (job.meeting) {
    const must = (job.crumbs || []).flatMap((c) => c.must_mention || []);
    keys[job.meeting.id] = { kind: (job.crumbs || []).length ? 'crumb' : 'background', must_mention: must, fields: ['transcript', 'summary'] };
  }
  return { source: job.source, listed_jira_keys: listed, keys };
}

export async function runPlan({ worldDir, seed, weeks }) {
  const world = readJson(join(worldDir, 'world.json'));
  const knobs = loadKnobs(worldDir);
  seed = seed ?? world.meta.seed;
  weeks = weeks ?? knobs.weeks_of_context ?? 13;
  const renderers = await loadRenderers();
  const index = [];
  const plannedJobs = {};
  for (const [source, mod] of Object.entries(renderers)) {
    const ctx = makeCtx(world, { seed, weeks, knobs });
    ctx.rng = ctx.rng.fork(source);
    let records, jobs;
    try { ({ records, jobs } = mod.plan(world, ctx)); } catch (e) { console.warn(`plan: render/${source}.mjs plan() failed (${e.message}), skipped`); continue; }
    writeJson(join(worldDir, 'planned', `${source}.json`), records);
    for (const job of (jobs || []).slice().sort((a, b) => cmp(a.job_id, b.job_id))) {
      const path = join(worldDir, 'jobs', source, `${job.job_id}.json`);
      let status = 'blank';
      if (existsSync(path)) {
        try { const old = JSON.parse(readFileSync(path, 'utf8')); if (old.status === 'filled') status = 'filled'; } catch { /* rewrite */ }
      }
      if (status !== 'filled') writeJson(path, job);
      plannedJobs[job.job_id] = jobKeys(job, world);
      index.push({ job_id: job.job_id, source, priority: job.priority, week: job.week ? job.week.start : null, status, path: `jobs/${source}/${job.job_id}.json` });
    }
  }
  // Demo context first, then newest week first, crumbs before background (encoded in priority), then id.
  index.sort((a, b) => a.priority - b.priority || cmp(a.job_id, b.job_id));
  writeJson(join(worldDir, 'jobs', 'index.json'), index);
  writeJson(join(worldDir, 'planned', 'jobs.json'), Object.fromEntries(Object.entries(plannedJobs).sort((a, b) => cmp(a[0], b[0]))));
  return { index, seed, weeks };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const a = parseArgs(process.argv.slice(2));
  const worldDir = a.world ? join(process.cwd(), a.world) : join(ROOT, 'fixtures/world');
  const { index, weeks } = await runPlan({ worldDir: a.world && a.world.startsWith('/') ? a.world : worldDir, seed: a.seed != null ? Number(a.seed) : undefined, weeks: a.weeks != null ? Number(a.weeks) : undefined });
  const by = {};
  for (const j of index) by[j.source] = (by[j.source] || 0) + 1;
  console.log(`plan: ${weeks} weeks, ${index.length} jobs`, JSON.stringify(by));
}
