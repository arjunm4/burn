#!/usr/bin/env node
// Writer helper for text jobs.
//
//   node scripts/generate-world/job-tool.mjs view <job_id|path> [...]            compact plain-text view for a writer
//   node scripts/generate-world/job-tool.mjs fill <job_id|path> <texts.json>      merge texts, validate like assemble
//   node scripts/generate-world/job-tool.mjs batches [--weeks 13] [--max-kb 70] [--kinds crumbs|background|all]
//                                            [--sources slack,jira,meetings] [--status blank]
//   (every command takes --world <dir>, default fixtures/world)
//
// texts.json for fill:
//   Slack   {"<ts>": "text", ...}
//   Jira    {"<KEY>": {"summary": "...", "description": "..."}, "<KEY>-c1": "comment body", ...}
//   Meeting {"transcript": [{"start_s": 0, "speaker": "<display name or id>", "text": "..."}, ...],
//            "summary": {"overview": "...", "shorthand_bullet": ["..."], "action_items": ["..."], "keywords": ["..."]}}
// Valid slots are merged even when others fail; the job is "filled" when every slot is valid, else "partial"
// (assemble reads both). Exit code 1 when any slot is missing or invalid.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, parseArgs } from './plan.mjs';
import { extractJob } from './assemble.mjs';
import { stringify } from './lib/io.mjs';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function resolveJob(worldDir, ref) {
  if (existsSync(ref) && ref.endsWith('.json')) return resolve(ref);
  const index = JSON.parse(readFileSync(join(worldDir, 'jobs', 'index.json'), 'utf8'));
  const e = index.find((j) => j.job_id === ref);
  if (!e) throw new Error(`unknown job ${ref}`);
  return join(worldDir, e.path);
}

function styleNote(s = {}) {
  const bits = [s.case && `${s.case} case`, s.punctuation && `${s.punctuation} punct`, s.typos && s.typos !== 'none' && `typos ${s.typos}`,
    s.emoji && s.emoji !== 'none' && `emoji ${s.emoji}`, s.length, s.hedging && `hedging ${s.hedging}`, ...(s.quirks || [])].filter(Boolean);
  return bits.join(', ');
}
const when = (iso) => `${DAYS[new Date(iso.slice(0, 10) + 'T12:00:00Z').getUTCDay()]} ${iso.slice(5, 10)} ${iso.slice(11, 16)}`;
const tsWhen = (ts, people) => {
  const sec = Number(ts.split('.')[0]);
  const pdt = sec >= 1772963200 && sec < 1793523600; // 2026-03-08 .. 2026-11-01 (the window's DST span)
  const d = new Date(sec * 1000 - (pdt ? 7 : 8) * 3600e3).toISOString();
  return when(d);
};
const shortBrief = (b) => String(b).replace(/^background: /, '').replace(/^reply \((.*?)\) in the thread about: the message above$/, 'reply: $1').replace(/^reply \((.*?)\) in the thread about: /, 'reply ($1) re: ');
const mm = (list) => (list && list.length ? list.map((s) => JSON.stringify(s)).join(' ') : '-');
function claimNote(c) {
  if (!c || /^[a-z]+-[a-z0-9-]+$/.test(String(c.value))) return null; /* ids add nothing for a writer */ const v = typeof c.value === 'object' && c.value ? Object.entries(c.value).filter(([, x]) => x != null).map(([k, x]) => `${k}=${x}`).join(' ') : c.value; return `${c.kind} ${v}`; }

export function viewJob(job) {
  const P = new Map((job.people || []).map((p) => [p.id, p]));
  const who = (id) => (P.get(id) ? P.get(id).display_name : id);
  const out = [];
  const head = job.channel ? `#${job.channel.name} (${job.channel.purpose})` : job.project ? `${job.project.id} ${job.project.name}` : job.meeting ? `${job.meeting.title}` : '';
  out.push(`JOB ${job.job_id} | ${job.source} | ${head}${job.week ? ` | week ${job.week.start}` : ''}`);
  for (const p of job.people || []) out.push(`  @${p.display_name}: ${p.name}, ${p.title}; ${styleNote(p.style)}`);
  for (const c of job.context || []) out.push(`  context: ${c}`);
  if (job.forbidden) out.push(`  never: ${job.forbidden.join('; ')}`);
  out.push('SLOTS (crumb = must contain every "must" string verbatim; bg = no part numbers, ids, $50+, or explicit dates)');
  if (job.messages) {
    const tops = new Map(); let n = 0;
    for (const m of job.messages) if (!m.thread_ts) tops.set(m.ts, ++n);
    const replyNo = new Map();
    for (const m of job.messages) {
      const crumb = (m.must_mention || []).length || m.claim ? 'crumb' : 'bg';
      let pos = 'top';
      if (m.thread_ts) { const k = (replyNo.get(m.thread_ts) || 0) + 1; replyNo.set(m.thread_ts, k); pos = `reply ${k} to ${tops.has(m.thread_ts) ? '#' + tops.get(m.thread_ts) : m.thread_ts}`; }
      else pos = `#${tops.get(m.ts)} top`;
      out.push(`${m.ts} @${who(m.user)} ${tsWhen(m.ts).replace(/ \d\d-\d\d /, ' ')} ${pos} ${crumb} ${m.length.replace('one_word', 'ack')}`);
      const cn = claimNote(m.claim);
      const extra = [cn && !(typeof m.claim.value === 'object' && m.claim.value ? Object.values(m.claim.value) : [m.claim.value]).filter((x) => typeof x === 'string').every((x) => m.brief.includes(x)) ? cn : null, m.pressure && m.pressure !== 'low' && `${m.pressure} pressure`, m.asks_expedite && 'asks about expediting'].filter(Boolean);
      out.push(`  ${shortBrief(m.brief)}${extra.length ? ' [' + extra.join('; ') + ']' : ''}`);
      if (crumb === 'crumb') out.push(`  must: ${mm(m.must_mention)}`);
    }
  } else if (job.tickets) {
    for (const t of job.tickets) {
      const crumb = (t.must_mention || []).length ? 'crumb' : 'bg';
      out.push(`${t.key} {summary, description} ${t.type} ${t.status} ${t.priority} by @${who(t.reporter)}${t.assignee ? ' for @' + who(t.assignee) : ''} ${when(t.created)}${t.due_date ? ' due ' + t.due_date : ''} ${crumb} desc:${t.description_length}${t.labels.length ? ' labels:' + t.labels.join(',') : ''}`);
      out.push(`  ${t.brief}`);
      if (crumb === 'crumb') out.push(`  must (summary or description): ${mm(t.must_mention)}`);
      for (const c of t.comments || []) {
        const cc = (c.must_mention || []).length ? 'crumb' : 'bg';
        out.push(`${c.id} comment @${who(c.by)} ${when(c.at)} ${cc}`);
        out.push(`  ${c.brief}`);
        if (cc === 'crumb') out.push(`  must: ${mm(c.must_mention)}`);
      }
    }
  } else if (job.meeting) {
    const m = job.meeting;
    out.push(`meeting: ${m.type}, notes by ${m.note_taker}, ${when(m.start)}, ran ${m.actual_min} min; present ${m.present.map(who).join(', ')}${(m.late_joiners || []).length ? '; late ' + m.late_joiners.map(who).join(', ') : ''}`);
    for (const s of job.storylines || []) out.push(`  storyline: ${typeof s === 'string' ? s : [s.topic, s.beat || s.summary].filter(Boolean).join(' - ')}`);
    for (const c of job.crumbs || []) {
      out.push(`crumb @${who(c.speaker)} at min ${Array.isArray(c.at_min) ? c.at_min.join('-') : c.at_min}: ${c.brief}`);
      out.push(`  must (transcript or summary): ${mm(c.must_mention)}${c.claim ? ' | claim ' + claimNote(c.claim) : ''}`);
    }
    for (const b of job.background || []) out.push(`bg @${who(b.speaker)}${b.at_min ? ' at min ' + b.at_min : ''}: ${b.brief}`);
    out.push(`FILL SHAPE: {"transcript":[{"start_s":0,"speaker":"<display name>","text":"..."}], "summary":{"overview":"...","shorthand_bullet":["..."],"action_items":["..."],"keywords":["..."]}}  start_s < ${m.actual_min * 60}`);
  }
  if (job.messages) out.push('FILL SHAPE: {"<ts>": "text", ...} for every slot');
  if (job.tickets) out.push('FILL SHAPE: {"<KEY>": {"summary": "...", "description": "..." (may be "" when desc:empty)}, "<KEY>-cN": "body", ...}');
  return out.join('\n') + '\n';
}

export function fillJob(worldDir, ref, texts) {
  const path = resolveJob(worldDir, ref);
  const job = JSON.parse(readFileSync(path, 'utf8'));
  const plannedAll = JSON.parse(readFileSync(join(worldDir, 'planned', 'jobs.json'), 'utf8'));
  const planned = plannedAll[job.job_id];
  if (!planned) throw new Error(`${job.job_id} is not in planned/jobs.json`);
  const world = JSON.parse(readFileSync(join(worldDir, 'world.json'), 'utf8'));
  const projectKeys = world.jira_projects.map((p) => p.id).sort();
  const problems = [];
  const people = new Map((job.people || []).map((p) => [p.display_name, p.id]));
  // Merge into a candidate copy; unknown keys are problems.
  const cand = JSON.parse(JSON.stringify(job));
  const known = new Set(Object.keys(planned.keys));
  if (job.meeting) {
    const t = texts[job.meeting.id] || texts;
    for (const k of Object.keys(t)) if (k !== 'transcript' && k !== 'summary') problems.push(`${k}: unknown key`);
    if (t.transcript !== undefined) {
      if (!Array.isArray(t.transcript)) problems.push(`${job.meeting.id}: transcript must be an array`);
      else {
        const present = new Set(job.meeting.present);
        cand.transcript = t.transcript.map((x) => ({ start_s: Number(x.start_s), speaker: people.get(x.speaker) || x.speaker, text: String(x.text ?? '') }));
        for (const x of cand.transcript) {
          if (!present.has(x.speaker)) problems.push(`${job.meeting.id}: transcript speaker ${x.speaker} was not present`);
          if (!(x.start_s >= 0 && x.start_s < job.meeting.actual_min * 60)) problems.push(`${job.meeting.id}: start_s ${x.start_s} outside the meeting`);
        }
      }
    }
    if (t.summary !== undefined) cand.summary = t.summary;
  } else {
    for (const [k, v] of Object.entries(texts)) {
      if (!known.has(k)) { problems.push(`${k}: unknown key`); continue; }
      if (job.messages) { const m = cand.messages.find((x) => x.ts === k); m.text = String(v); continue; }
      const tk = cand.tickets.find((x) => x.key === k);
      if (tk) {
        if (typeof v === 'string') tk.summary = v; else { if (v.summary !== undefined) tk.summary = v.summary; if (v.description !== undefined) tk.description = v.description; }
        if (tk.description == null && tk.description_length === 'empty') tk.description = '';
        continue;
      }
      for (const x of cand.tickets) for (const c of x.comments || []) if (c.id === k) c.body = String(v);
    }
  }
  // Validate with assemble's own rules; drop invalid slots from the merge.
  const res = extractJob(cand, planned, projectKeys);
  const bad = new Set();
  for (const p of res.problems) { problems.push(p.replace(`${job.job_id} `, '')); const k = p.split(' ')[1]?.replace(/:$/, ''); if (k) bad.add(k); }
  if (job.meeting && problems.some((p) => p.startsWith(job.meeting.id + ':'))) bad.add(job.meeting.id);
  const accepted = new Set(Object.keys(res.texts).filter((k) => !bad.has(k)));
  for (const k of known) if (!accepted.has(k) && !bad.has(k)) problems.push(`${k}: missing`);
  // Write back only accepted text fields onto the original job (nothing else changes).
  if (job.messages) for (const m of job.messages) { if (accepted.has(m.ts)) m.text = cand.messages.find((x) => x.ts === m.ts).text; }
  else if (job.tickets) for (const t of job.tickets) {
    const c = cand.tickets.find((x) => x.key === t.key);
    if (accepted.has(t.key)) { t.summary = c.summary; t.description = c.description ?? ''; }
    for (const cm of t.comments || []) if (accepted.has(cm.id)) cm.body = c.comments.find((x) => x.id === cm.id).body;
  } else if (job.meeting && accepted.has(job.meeting.id)) { job.transcript = cand.transcript; job.summary = cand.summary; }
  const status = problems.length ? (accepted.size ? 'partial' : job.status) : 'filled';
  job.status = status;
  writeFileSync(path, stringify(job));
  // Keep the index's status in step.
  const ip = join(worldDir, 'jobs', 'index.json');
  if (existsSync(ip)) { const idx = JSON.parse(readFileSync(ip, 'utf8')); const e = idx.find((x) => x.job_id === job.job_id); if (e && e.status !== status) { e.status = status; writeFileSync(ip, stringify(idx)); } }
  return { problems, status, accepted: accepted.size, slots: known.size };
}

export function makeBatches(index, { weeks = Infinity, maxKb = 70, kinds = 'all', sources = ['slack', 'jira', 'meetings'], status = null } = {}) {
  const src = (j) => (j.source === 'meeting' ? 'meetings' : j.source);
  const inWeeks = (j) => j.priority === 0 || Math.floor((j.priority - 1) / 2) < weeks;
  const jobs = index.filter((j) => sources.includes(src(j)) && (kinds === 'all' || j.kind === kinds) && inWeeks(j));
  const open = new Map();
  const batches = [];
  const counter = {};
  for (const j of jobs) {
    const key = `${src(j)}-${j.kind}`;
    let b = open.get(key);
    const full = (x) => (key === 'slack-background' ? x.size_bytes + j.size_bytes > maxKb * 1024 && x.jobs.length > 0 : x.jobs.length >= (key === 'slack-crumbs' ? 6 : 8));
    if (!b || full(b)) {
      counter[key] = (counter[key] || 0) + 1;
      b = { batch_id: `${key}-${String(counter[key]).padStart(3, '0')}`, source: src(j), kind: j.kind, jobs: [], slots: 0, size_bytes: 0, statuses: {} };
      open.set(key, b);
      batches.push(b);
    }
    b.jobs.push(j.job_id); b.slots += j.slots || 0; b.size_bytes += j.size_bytes || 0; b.statuses[j.status] = (b.statuses[j.status] || 0) + 1;
  }
  return status ? batches.filter((b) => b.statuses[status]) : batches;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const flags = parseArgs(argv);
  const pos = [];
  for (let i = 1; i < argv.length; i++) { if (argv[i].startsWith('--')) { if (argv[i + 1] && !argv[i + 1].startsWith('--')) i++; continue; } pos.push(argv[i]); }
  const worldDir = flags.world ? (isAbsolute(flags.world) ? flags.world : resolve(process.cwd(), flags.world)) : join(ROOT, 'fixtures/world');
  if (cmd === 'view') {
    for (const ref of pos) process.stdout.write(viewJob(JSON.parse(readFileSync(resolveJob(worldDir, ref), 'utf8'))) + '\n');
  } else if (cmd === 'fill') {
    const [ref, textsPath] = pos;
    const { problems, status, accepted, slots } = fillJob(worldDir, ref, JSON.parse(readFileSync(textsPath, 'utf8')));
    for (const p of problems) console.log(p);
    console.log(`${status}: ${accepted}/${slots} slots valid`);
    process.exit(problems.length ? 1 : 0);
  } else if (cmd === 'batches') {
    const index = JSON.parse(readFileSync(join(worldDir, 'jobs', 'index.json'), 'utf8'));
    const b = makeBatches(index, {
      weeks: flags.weeks ? Number(flags.weeks) : Infinity, maxKb: flags['max-kb'] ? Number(flags['max-kb']) : 70,
      kinds: flags.kinds || 'all', sources: (flags.sources || 'slack,jira,meetings').split(','), status: flags.status || null,
    });
    process.stdout.write(JSON.stringify(b, null, 2) + '\n');
  } else {
    console.error('usage: job-tool.mjs view|fill|batches ... [--world dir]');
    process.exit(2);
  }
}
