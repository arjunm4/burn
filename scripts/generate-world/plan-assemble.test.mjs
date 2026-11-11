// End-to-end tests of plan + assemble (Slack and Jira) on the example world.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, copyFileSync, readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { runPlan, HIDDEN_KEYS, ROOT } from './plan.mjs';
import { runAssemble } from './assemble.mjs';
import { ENUMS } from './schema.mjs';

const EXAMPLE = join(ROOT, 'fixtures/world/example');
const WEEKS_TO_EXAMPLE = 11; // newest week 2026-11-09 back to the example's busiest week 2026-08-31

function freshWorld() {
  const dir = mkdtempSync(join(tmpdir(), 'burn-plan-'));
  copyFileSync(join(EXAMPLE, 'world.json'), join(dir, 'world.json'));
  return dir;
}
function walk(dir) {
  const out = {};
  if (!existsSync(dir)) return out;
  const rec = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) rec(p); else out[relative(dir, p)] = readFileSync(p, 'utf8'); } };
  rec(dir);
  return out;
}
const readJ = (p) => JSON.parse(readFileSync(p, 'utf8'));
const quiet = async (fn) => { const w = console.warn; console.warn = () => {}; try { return await fn(); } finally { console.warn = w; } };
async function run(weeks, fill) {
  const dir = freshWorld();
  await quiet(() => runPlan({ worldDir: dir, weeks }));
  if (fill) fill(dir);
  const res = await quiet(() => runAssemble({ worldDir: dir, outDir: join(dir, 'out'), weeks }));
  return { dir, res, out: walk(join(dir, 'out')) };
}
const bgJob = (dir, ch, week) => readdirSync(join(dir, 'jobs/slack')).filter((f) => f.startsWith(`slack-${ch}-${week}-background`)).sort()[0].replace(/\.json$/, '');
const slackMsgs = (out, ch) => JSON.parse(out[`slack/${ch}.json`]).messages;
const world = readJ(join(EXAMPLE, 'world.json'));

// Fill a job: take text from the example filled job where it matches, and make sure must_mention strings are there.
function fillSlack(dir, jobId, textFor) {
  const p = join(dir, 'jobs/slack', `${jobId}.json`);
  const job = readJ(p);
  job.messages.forEach((m, i) => { let t = textFor(m, i); if (t == null) return; for (const s of m.must_mention) if (!t.includes(s)) t += ` ${s}`; m.text = t; });
  job.status = 'filled';
  writeFileSync(p, JSON.stringify(job, null, 2) + '\n');
  return job;
}

test('--weeks 1, nothing filled: background dropped, only code-written bot/join text remains', async () => {
  const { out, res } = await run(1);
  assert.equal(res.counts.filled, 0);
  for (const c of world.channels) for (const m of slackMsgs(out, c.slack_id)) assert.ok(m.subtype === 'bot_message' || m.subtype === 'channel_join', `unexpected ${m.text}`);
  for (const p of world.jira_projects) assert.equal(JSON.parse(out[`jira/${p.id}.json`]).issues.length, 0);
});

test('nothing filled: every crumb in the window carries its fallback text; background is dropped', async () => {
  const { dir, out } = await run(WEEKS_TO_EXAMPLE);
  const planned = readJ(join(dir, 'planned/slack.json'));
  const crumbs = planned.messages.filter((m) => m.kind === 'crumb');
  assert.ok(crumbs.length >= 4);
  for (const m of crumbs) {
    const got = slackMsgs(out, m.channel).find((x) => x.ts === m.ts);
    assert.ok(got, `crumb ${m.ts} missing`);
    assert.equal(got.text, m.fallback_text);
    for (const s of m.must_mention) assert.ok(got.text.includes(s));
  }
  const bg = planned.messages.filter((m) => m.kind === 'background');
  for (const m of bg) assert.ok(!slackMsgs(out, m.channel).some((x) => x.ts === m.ts), 'unfilled background rendered');
  const test141 = JSON.parse(out['jira/TEST.json']).issues.find((i) => i.key === 'TEST-141');
  assert.ok(test141.fields.summary.length > 0);
  assert.ok((test141.fields.summary + test141.fields.description).includes('FL-TST-2017'));
  assert.equal(test141.fields.duedate, '2026-09-14');
  assert.equal(test141.fields.status.name, 'Done');
});

const exSlack = readJ(join(EXAMPLE, 'jobs/slack-channel-week.filled.json'));
const exJira = readJ(join(EXAMPLE, 'jobs/jira-ticket-batch.filled.json'));
function fillFromExamples(dir, mutate) {
  // Slack crumbs: match example messages by their events; background: first filler gets the example's background line.
  fillSlack(dir, 'slack-ch-test-lab-2026-08-31-crumbs', (m) => exSlack.messages.find((x) => x.events.length && x.events.join() === m.events.join())?.text);
  fillSlack(dir, bgJob(dir, 'ch-test-lab', '2026-08-31'), (m, i) => (i === 0 ? exSlack.messages[3].text : null));
  const p = join(dir, 'jobs/jira/jira-TEST-2026-08-31-crumbs.json');
  const job = readJ(p);
  for (const t of job.tickets) {
    const ex = exJira.tickets.find((x) => x.key === t.key);
    t.summary = ex.summary; t.description = ex.description;
    const missing = t.must_mention.filter((s) => !(t.summary + t.description).includes(s));
    if (missing.length) t.description += ` ${missing.join(' ')}`;
    for (const c of t.comments) { const ec = ex.comments.find((x) => x.id === c.id); c.body = ec.body; for (const s of c.must_mention) if (!c.body.includes(s)) c.body += ` ${s}`; }
  }
  job.status = 'filled';
  if (mutate) mutate(job);
  writeFileSync(p, JSON.stringify(job, null, 2) + '\n');
}

test('example filled jobs: their text appears in the rendered sources', async () => {
  const { out, res } = await run(WEEKS_TO_EXAMPLE, (dir) => fillFromExamples(dir));
  assert.equal(res.counts.rejected, 0, res.problems.join('\n'));
  const lab = slackMsgs(out, 'C07FLK0TLAB').map((m) => m.text);
  for (const t of ['need 2x lift hooks for the drop test on wed 9/16', 'heads up drop test got pulled in to monday', 'who moved the foam pads off the gantry']) assert.ok(lab.some((x) => x.startsWith(t)), t);
  const issue = JSON.parse(out['jira/TEST.json']).issues.find((i) => i.key === 'TEST-141');
  assert.equal(issue.fields.summary, 'Order lift hooks x2 for drop gantry (FL-TST-2017, Xometry)');
  assert.ok(issue.fields.comment.comments[0].body.startsWith('moved due to 9/11'));
});

test('two runs are byte-identical (planned, jobs and output)', async () => {
  const a = await run(WEEKS_TO_EXAMPLE);
  const b = await run(WEEKS_TO_EXAMPLE);
  const strip = (files) => Object.fromEntries(Object.entries(files).filter(([k]) => !k.startsWith('world.json')));
  assert.deepEqual(strip(walk(a.dir)), strip(walk(b.dir)));
});

test('a job planned with --weeks 1 is byte-identical inside --weeks 13', async () => {
  const a = await run(1);
  const b = await run(13);
  const ja = walk(join(a.dir, 'jobs'));
  const jb = walk(join(b.dir, 'jobs'));
  const names = Object.keys(ja).filter((k) => k !== 'index.json');
  assert.ok(names.some((n) => n.startsWith('slack/')));
  for (const n of names) assert.equal(ja[n], jb[n], n);
  // and the same holds for weeks 11 vs 13 (crumb jobs)
  const c = await run(WEEKS_TO_EXAMPLE);
  for (const [n, v] of Object.entries(walk(join(c.dir, 'jobs')))) if (n !== 'index.json') assert.equal(v, jb[n], n);
});

test('a filled job that changes non-text fields does not change the output', async () => {
  const base = await run(WEEKS_TO_EXAMPLE, (dir) => fillFromExamples(dir));
  const mutated = await run(WEEKS_TO_EXAMPLE, (dir) => fillFromExamples(dir, (job) => {
    const t = job.tickets[0];
    t.status = 'In Progress'; t.due_date = '2027-01-01'; t.assignee = 'p-owen'; t.created = '2026-09-09T09:00:00-07:00'; t.labels = ['hacked'];
    t.comments[0].by = 'p-arjun'; t.comments[0].at = '2026-09-05T09:00:00-07:00';
  }));
  assert.deepEqual(mutated.out, base.out);
});

test('a filled job with an unplanned key is rejected whole', async () => {
  const { out, res } = await run(WEEKS_TO_EXAMPLE, (dir) => {
    const job = fillSlack(dir, 'slack-ch-test-lab-2026-08-31-crumbs', (m) => `${m.must_mention.join(' ')} sure`);
    job.messages[0].ts = '1788282862.000001';
    writeFileSync(join(dir, 'jobs/slack/slack-ch-test-lab-2026-08-31-crumbs.json'), JSON.stringify(job));
  });
  assert.equal(res.counts.rejected, 1);
  assert.ok(!slackMsgs(out, 'C07FLK0TLAB').some((m) => m.text.endsWith(' sure')));
});

test('background text breaking the rules is dropped; crumb text missing a must_mention falls back', async () => {
  const { dir, out, res } = await run(WEEKS_TO_EXAMPLE, (d) => {
    fillSlack(d, bgJob(d, 'ch-test-lab', '2026-08-31'), () => 'order XO-1234567 costs $400 on 9/12');
    const p = join(d, 'jobs/slack/slack-ch-test-lab-2026-08-31-crumbs.json');
    const job = readJ(p); for (const m of job.messages) m.text = 'something vague'; job.status = 'filled';
    writeFileSync(p, JSON.stringify(job));
  });
  assert.ok(res.problems.length > 0);
  const lab = slackMsgs(out, 'C07FLK0TLAB');
  assert.ok(!lab.some((m) => m.text.includes('XO-1234567')));
  const planned = readJ(join(dir, 'planned/slack.json')).messages.filter((m) => m.ch === 'ch-test-lab' && m.kind === 'crumb');
  for (const m of planned) if (m.must_mention.length) assert.equal(lab.find((x) => x.ts === m.ts).text, m.fallback_text);
});

test('no hidden field from spec §4 appears in any job', async () => {
  const { dir } = await run(13);
  const jobs = walk(join(dir, 'jobs'));
  const hidden = new Set(HIDDEN_KEYS);
  const reasons = ENUMS.hidden_reason || [];
  const slIds = world.storylines.map((s) => s.id);
  assert.ok(Object.keys(jobs).length > 5);
  for (const [name, text] of Object.entries(jobs)) {
    const visit = (v) => { if (Array.isArray(v)) v.forEach(visit); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { assert.ok(!hidden.has(k), `${name}: key ${k}`); visit(x); } };
    visit(JSON.parse(text));
    for (const r of reasons) assert.ok(!text.toLowerCase().includes(r), `${name}: ${r}`);
    for (const s of slIds) assert.ok(!text.includes(s), `${name}: ${s}`);
    for (const w of world.meta.budget_windows.concat(world.meta.pressure_windows)) assert.ok(!text.includes(w.cause), `${name}: window cause`);
  }
});

test('CLI: plan then assemble run end to end with --weeks 1', () => {
  const dir = freshWorld();
  const node = process.execPath;
  const p = execFileSync(node, [join(ROOT, 'scripts/generate-world/plan.mjs'), '--weeks', '1', '--world', dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  assert.match(p, /plan: 1 weeks/);
  const a = execFileSync(node, [join(ROOT, 'scripts/generate-world/assemble.mjs'), '--weeks', '1', '--world', dir, '--out', join(dir, 'out')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  assert.match(a, /assemble: \d+ files/);
  assert.ok(existsSync(join(dir, 'out/slack/channels.json')) && existsSync(join(dir, 'jobs/index.json')));
});

test('no brief or fallback text carries a hidden value (truth of a stale, wrong or contradicted claim)', async () => {
  const { hiddenValues } = await import('./render/slack.mjs');
  const { dir } = await run(13);
  const ev = new Map(world.events.map((e) => [e.id, e]));
  const check = (where, text, ids) => {
    for (const id of ids || []) {
      const e = ev.get(id);
      if (!e || e.kind !== 'crumb') continue;
      for (const h of hiddenValues(e)) assert.ok(!String(text).includes(h), `${where}: "${text}" contains hidden ${h}`);
      assert.ok(!/never corrected|changed to|\bwrong\b|\bstale\b/i.test(text), `${where}: ${text}`);
    }
  };
  const visit = (o, where) => {
    if (Array.isArray(o)) return o.forEach((x) => visit(x, where));
    if (!o || typeof o !== 'object') return;
    if (o.events && typeof o.brief === 'string') check(where, o.brief, o.events);
    if (o.events && typeof o.fallback_text === 'string') check(where, o.fallback_text, o.events);
    for (const v of Object.values(o)) visit(v, where);
  };
  for (const [name, text] of Object.entries(walk(join(dir, 'jobs')))) visit(JSON.parse(text), name);
  for (const [name, text] of Object.entries(walk(join(dir, 'planned')))) visit(JSON.parse(text), name);
  // The example's contradicted Jira comment is planned (so the check above really ran on it).
  assert.ok(Object.values(walk(join(dir, 'jobs'))).some((t) => t.includes('ev-000012')));
});

test('human timestamps follow working hours; jobs stay small', async () => {
  const { dir } = await run(13);
  const local = (sec) => { const ms = sec * 1000; const iso = new Date(ms - 8 * 3600e3).toISOString(); return iso; };
  const offset = (iso) => (/-07:00$/.test(iso) ? 7 : 8);
  const slack = readJ(join(dir, 'planned/slack.json')).messages.filter((m) => m.kind !== 'bot' && !m.events.length);
  assert.ok(slack.length > 300);
  let core = 0;
  for (const m of slack) {
    const sec = Number(m.ts.split('.')[0]);
    // Pacific wall clock: try both offsets and pick the one schema.pacificOffset would (via week of year is overkill here).
    const d = new Date(sec * 1000 - (sec < 1793523600 && sec > 1772963200 ? 7 : 8) * 3600e3);
    const min = d.getUTCHours() * 60 + d.getUTCMinutes();
    assert.ok(!(min >= 30 && min < 360), `night message ${m.ts}`);
    if (min >= 480 && min < 1110 && d.getUTCDay() !== 0 && d.getUTCDay() !== 6) core++;
  }
  assert.ok(core / slack.length >= 0.85, `core share ${core / slack.length}`);
  void local; void offset;
  for (const i of readJ(join(dir, 'planned/jira.json')).issues) {
    for (const c of i.comments) if (!c.events.length) { const min = +c.at.slice(11, 13) * 60 + +c.at.slice(14, 16); assert.ok(min >= 540 && min < 1110, c.at); }
    for (const c of i.changelog) if (c.by) assert.ok(+c.at.slice(11, 13) >= 7, c.at);
  }
  for (const j of readJ(join(dir, 'jobs/index.json'))) assert.ok(j.slots <= 130, `${j.job_id} has ${j.slots} slots`);
});

test('re-running plan keeps written text whose key and mentions still hold, and reports what it dropped', async () => {
  const { carryText, jobKeys } = await import('./plan.mjs');
  const dir = freshWorld();
  await quiet(() => runPlan({ worldDir: dir, weeks: WEEKS_TO_EXAMPLE }));
  const id = 'slack-ch-test-lab-2026-08-31-crumbs';
  const p = join(dir, 'jobs/slack', `${id}.json`);
  const job = fillSlack(dir, id, (m) => `${m.must_mention.join(' ')} written`);
  // Simulate a stale written slot: one text loses its mention, one key no longer exists.
  job.messages[0].text = 'lost the mention';
  job.messages.push({ ...job.messages[1], ts: '1.000001', text: 'orphan' });
  job.status = 'partial';
  writeFileSync(p, JSON.stringify(job));
  const res = await quiet(() => runPlan({ worldDir: dir, weeks: WEEKS_TO_EXAMPLE }));
  const after = readJ(p);
  assert.equal(res.carried, after.messages.length - 1);
  assert.deepEqual(res.dropped.sort(), [`${id} 1.000001`, `${id} ${after.messages[0].ts}`].sort());
  assert.equal(after.messages[0].text, null);
  assert.ok(after.messages.slice(1).every((m) => m.text.endsWith('written')));
  assert.equal(after.status, 'partial');
  // Same keys, same text: carryText is a no-op on a fully valid job.
  const r = carryText(after, structuredClone(after), jobKeys(after, world));
  assert.equal(r.kept, after.messages.length - 1);
});

test('equal duration bounds read "3 days", a range "2-4 days"', async () => {
  const { valuePhrase } = await import('./render/slack.mjs');
  assert.equal(valuePhrase({ kind: 'duration', value: [3, 3] }, world, null), '3 days');
  assert.equal(valuePhrase({ kind: 'duration', value: [2, 4] }, world, null), '2-4 days');
});
