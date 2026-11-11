#!/usr/bin/env node
// assemble: planned/ + filled jobs -> rendered sources (default fixtures/flintlock/).
//
//   node scripts/generate-world/assemble.mjs [--weeks N] [--world fixtures/world] [--out fixtures/flintlock]
//
// Takes ONLY text fields from filled jobs (messages[].text; ticket summary/description, comments[].body; meeting
// transcript/summary), matched by ts, ticket key, comment id or meeting id; everything else comes from planned/.
// A job whose keys differ from the planned keys is rejected whole. Crumb text missing a must_mention string is
// rejected (the renderer falls back); background text breaking spec §3.4 is dropped. Reports what it rejected.
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson } from './lib/io.mjs';
import { ROOT, loadKnobs, loadRenderers, makeCtx, parseArgs } from './plan.mjs';

const MONTH_DAY = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(st|nd|rd|th)?\b/i;
const SLASH_DATE = /\b\d{1,2}\/\d{1,2}\b/;
const WD_ORD = /\b(mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun)[a-z]*\.?\s+(the\s+)?\d{1,2}(st|nd|rd|th)\b/i;
const PART_NO = /\bFL-[A-Z]{3}-\d{4}\b/;
const QUOTE_ID = /\bQ-\d{7}-\d+\b/;
const ORDER_NO = /\bXO-\d{7}\b/;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export function backgroundViolation(text, projectKeys, listed) {
  if (PART_NO.test(text)) return 'part number';
  if (QUOTE_ID.test(text)) return 'quote id';
  if (ORDER_NO.test(text)) return 'order number';
  if (MONTH_DAY.test(text) || SLASH_DATE.test(text) || WD_ORD.test(text)) return 'explicit date';
  for (const m of text.matchAll(/\$\s?(\d[\d,]*(?:\.\d+)?)\s*(k)?/gi)) if (Number(m[1].replace(/,/g, '')) * (m[2] ? 1000 : 1) >= 50) return 'dollar amount >= $50';
  const re = new RegExp(`\\b(${projectKeys.join('|') || 'NONE'})-\\d+\\b`, 'g');
  for (const m of text.matchAll(re)) if (!listed.includes(m[0])) return `Jira key ${m[0]} not in job`;
  return null;
}
function basicViolation(text) {
  if (text.length > 4000) return 'longer than 4000 characters';
  if (CONTROL.test(text)) return 'control character';
  return null;
}

// Extract accepted text from one filled job; returns {texts, problems}.
export function extractJob(job, planned, projectKeys) {
  const problems = [];
  const texts = {};
  const keys = planned.keys;
  const found = [];
  if (job.source === 'slack') for (const m of job.messages || []) found.push([m.ts, m.text]);
  else if (job.source === 'jira') for (const t of job.tickets || []) {
    found.push([t.key, { summary: t.summary, description: t.description }]);
    for (const c of t.comments || []) found.push([c.id, c.body]);
  } else if (job.meeting) found.push([job.meeting.id, { transcript: job.transcript, summary: job.summary }]);
  const want = Object.keys(keys).sort();
  const got = found.map((f) => String(f[0])).sort();
  if (want.length !== got.length || want.some((k, i) => k !== got[i])) {
    problems.push(`${job.job_id}: keys differ from the plan, job rejected`);
    return { texts: {}, problems };
  }
  for (const [key, value] of found) {
    const spec = keys[key];
    const strings = value && typeof value === 'object' ? flatten(value) : typeof value === 'string' ? [value] : [];
    if (!strings.length || (typeof value === 'object' && value && spec.fields && value[spec.fields[0]] == null)) continue; // not written
    const all = strings.join('\n');
    const bad = strings.map(basicViolation).find(Boolean)
      || (spec.kind === 'crumb' ? (spec.must_mention.find((m) => !all.includes(m)) ? `missing must_mention "${spec.must_mention.find((m) => !all.includes(m))}"` : null)
        : backgroundViolation(all, projectKeys, planned.listed_jira_keys));
    if (bad) { problems.push(`${job.job_id} ${key}: ${bad}, ${spec.kind === 'crumb' ? 'fallback used' : 'dropped'}`); continue; }
    texts[key] = value;
  }
  return { texts, problems };
}
function flatten(v) {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.flatMap(flatten);
  if (v && typeof v === 'object') return Object.values(v).flatMap(flatten);
  return [];
}

export async function runAssemble({ worldDir, outDir, weeks }) {
  const forbidden = [resolve(ROOT, 'fixtures/slack'), resolve(ROOT, 'fixtures/calendar.ics'), resolve(ROOT, 'fixtures')];
  if (forbidden.includes(resolve(outDir))) throw new Error(`assemble: refusing to write into ${outDir}`);
  const world = readJson(join(worldDir, 'world.json'));
  const knobs = loadKnobs(worldDir);
  weeks = weeks ?? knobs.weeks_of_context ?? 13;
  const plannedJobs = existsSync(join(worldDir, 'planned', 'jobs.json')) ? readJson(join(worldDir, 'planned', 'jobs.json')) : {};
  const projectKeys = world.jira_projects.map((p) => p.id).sort();
  const texts = {};
  const problems = [];
  const counts = { filled: 0, blank: 0, rejected: 0 };
  const index = existsSync(join(worldDir, 'jobs', 'index.json')) ? readJson(join(worldDir, 'jobs', 'index.json')) : [];
  for (const entry of index) {
    const path = join(worldDir, entry.path);
    if (!existsSync(path)) continue;
    let job;
    try { job = JSON.parse(readFileSync(path, 'utf8')); } catch { problems.push(`${entry.job_id}: unreadable, rejected`); counts.rejected++; continue; }
    if (job.status !== 'filled') { counts.blank++; continue; }
    const planned = plannedJobs[job.job_id];
    if (!planned || job.job_id !== entry.job_id || job.source !== planned.source) { problems.push(`${entry.job_id}: not a planned job, rejected`); counts.rejected++; continue; }
    const { texts: t, problems: p } = extractJob(job, planned, projectKeys);
    if (p.some((x) => x.includes('job rejected'))) counts.rejected++; else counts.filled++;
    problems.push(...p);
    (texts[planned.source] ||= {});
    Object.assign(texts[planned.source], t);
  }
  const renderers = await loadRenderers();
  const files = [];
  for (const [source, mod] of Object.entries(renderers)) {
    const pp = join(worldDir, 'planned', `${source}.json`);
    if (!existsSync(pp)) { console.warn(`assemble: planned/${source}.json missing, skipped (run plan)`); continue; }
    const ctx = makeCtx(world, { seed: world.meta.seed, weeks, knobs });
    ctx.rng = ctx.rng.fork(`${source}:emit`);
    try { files.push(...mod.emit(readJson(pp), texts[source] || {}, ctx).files); }
    catch (e) { console.warn(`assemble: render/${source}.mjs emit() failed (${e.message}), skipped`); problems.push(`${source}: emit failed: ${e.message}`); }
  }
  for (const f of files.sort((a, b) => (a.path < b.path ? -1 : 1))) {
    const p = join(outDir, f.path);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, f.content);
  }
  return { files: files.map((f) => f.path), problems, counts };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const a = parseArgs(process.argv.slice(2));
  const abs = (p, d) => (p ? resolve(process.cwd(), p) : join(ROOT, d));
  const res = await runAssemble({ worldDir: abs(a.world, 'fixtures/world'), outDir: abs(a.out, 'fixtures/flintlock'), weeks: a.weeks != null ? Number(a.weeks) : undefined });
  for (const p of res.problems) console.log('  ' + p);
  console.log(`assemble: ${res.files.length} files; jobs filled ${res.counts.filled}, blank ${res.counts.blank}, rejected ${res.counts.rejected}; ${res.problems.length} problems`);
}
