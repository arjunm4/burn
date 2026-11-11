// Export Burn's configured company knowledge from the world model.
//
//   node scripts/timevalue/export-settings.mjs [--world fixtures/world/world.json] [--out fixtures/timevalue]
//                                             [--sources fixtures/flintlock]
//
// Writes <out>/settings.json per docs/build/time-value-impl.md ("settings.json" contract), then prints a
// smoke summary of the rendered sources (doc counts, Ramp<->Xometry link rate, usable orders). Rerun it
// whenever the world or the rendered sources change; it is the one command for agent B's outputs.
// This is one of only two places allowed to read fixtures/world/. It copies what a company would
// configure (calendar, org, catalogue, tests, rigs, milestones and their value policies) and nothing
// Burn has to discover: no edges, ETAs, true dates, demands or answers. Planned test dates and
// milestone dates keep only the history entries that were said somewhere (`where` non-null).
// The settings are checked (unique ids, every reference resolves) before anything is written.
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSources, pacificLocalToMs, toPacificIso } from '../../server/timevalue/sources.mjs';
import { linkRampToXometry, usableLinks } from '../../server/timevalue/labels.mjs';

const addDays = (date, n) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const hist = (list, { saidOnly }) =>
  (list || [])
    // The original plan (first entry) is configured company knowledge; later changes count only if said somewhere.
    .filter((e, i) => !saidOnly || i === 0 || e.where != null)
    .map((e) => ({ value: e.value, known_at: e.known_at, by: e.by ?? null }));

export function buildSettings(world, coverage = null) {
  const channelSlack = new Map(world.channels.map((c) => [c.id, c.slack_id]));
  const assemblyIds = new Set(world.assemblies.map((a) => a.id));
  const rigs = [
    ...world.test_rigs.map((r) => ({ id: r.id, name: r.name, slot_days: r.slot_days ?? null, owner: r.owner, kind: 'rig' })),
    ...world.resources.map((r) => ({ id: r.id, name: r.name, slot_days: r.slot_days ?? null, owner: r.owner, kind: r.kind })),
  ].sort(byId);

  return {
    generated_from: 'world.json',
    demo_now: world.meta.demo_now,
    time_zone: world.meta.time_zone || 'America/Los_Angeles',
    // extras (not in the contract): first day of written text, and the first T usable for training (+30 days)
    text_start: coverage?.text_start?.slice(0, 10) ?? world.meta.context_first_pass?.start ?? null,
    usable_from: coverage?.usable_from ?? (world.meta.context_first_pass?.start ? addDays(world.meta.context_first_pass.start, 30) : null),
    holidays: world.meta.holidays
      .map((h) => ({ date: h.date, name: h.name, observance: h.observance }))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
    people: world.people
      .map((p) => ({
        id: p.id, name: p.name, email: p.email, slack_id: p.slack_id, jira_account_id: p.jira_account_id,
        team: p.team, title: p.title, manager: p.manager ?? null,
      }))
      .sort(byId),
    // channels are Slack channel ids (C…/D…), matching docs[].container
    teams: world.teams
      .map((t) => ({
        id: t.id, name: t.name, lead: t.lead, members: [...t.members],
        channels: (t.channels || []).map((c) => channelSlack.get(c)).filter(Boolean),
        jira_project: t.jira_project ?? null,
      }))
      .sort(byId),
    // slack_channel is the Slack channel id
    assemblies: world.assemblies
      .map((a) => ({
        id: a.id, name: a.name, jira_project: a.jira_project ?? null,
        slack_channel: channelSlack.get(a.channel) ?? null, team: a.team,
      }))
      .sort(byId),
    // assembly: the owning assembly, or null for test hardware that belongs to a rig/resource (see belongs_to)
    parts: world.parts
      .map((p) => ({
        id: p.id, part_number: p.part_number, name: p.name, aliases: [...(p.aliases || [])],
        assembly: assemblyIds.has(p.belongs_to) ? p.belongs_to : null, belongs_to: p.belongs_to, kind: p.kind,
      }))
      .sort(byId),
    deliverables: world.deliverables
      .map((d) => ({
        id: d.id, name: d.name, aliases: [...(d.aliases || [])], owner: d.owner, assembly: d.assembly ?? null, kind: d.kind,
      }))
      .sort(byId),
    tests: world.tests
      .map((t) => ({
        id: t.id, name: t.name, assembly: t.assembly, rig: t.rig ?? null, resources: [...(t.resources || [])],
        owner: t.owner, milestone: t.milestone ?? null,
        duration_estimate_days: t.duration_estimate_days ?? null,
        planned_date: hist(t.planned_date, { saidOnly: true }),
      }))
      .sort(byId),
    rigs,
    milestones: world.milestones
      .map((m) => ({
        id: m.id, name: m.name, owner: m.owner, hardness: m.hardness, assemblies: [...m.assemblies],
        date: hist(m.date, { saidOnly: true }),
        value_policy: hist(m.value_policy, { saidOnly: false }),
      }))
      .sort(byId),
    // extra (not in the contract, harmless): Slack channel lookup
    channels: world.channels
      .map((c) => ({ id: c.id, slack_id: c.slack_id, name: c.name, type: c.type, assembly: c.assembly ?? null }))
      .sort(byId),
  };
}

// Problems that would make Burn misread the settings. → [string] (empty = fine)
export function validateSettings(s) {
  const errs = [];
  if (!s.demo_now || Number.isNaN(Date.parse(s.demo_now))) errs.push(`demo_now is not a date: ${s.demo_now}`);
  const ids = {};
  for (const k of ['people', 'teams', 'assemblies', 'parts', 'deliverables', 'tests', 'rigs', 'milestones', 'channels']) {
    if (!Array.isArray(s[k])) { errs.push(`${k} is not a list`); continue; }
    ids[k] = new Set();
    for (const x of s[k]) {
      if (!x?.id) errs.push(`${k}: entry without an id`);
      else if (ids[k].has(x.id)) errs.push(`${k}: duplicate id ${x.id}`);
      else ids[k].add(x.id);
    }
  }
  if (errs.length) return errs;
  const ref = (where, kind, id) => { if (id != null && !ids[kind].has(id)) errs.push(`${where} names unknown ${kind} ${id}`); };
  for (const h of s.holidays) if (!/^\d{4}-\d{2}-\d{2}$/.test(h.date)) errs.push(`holiday ${h.name}: bad date ${h.date}`);
  for (const p of s.people) { ref(`person ${p.id}`, 'teams', p.team); ref(`person ${p.id}`, 'people', p.manager); }
  for (const t of s.teams) { ref(`team ${t.id}`, 'people', t.lead); for (const m of t.members) ref(`team ${t.id}`, 'people', m); }
  for (const a of s.assemblies) ref(`assembly ${a.id}`, 'teams', a.team);
  for (const p of s.parts) ref(`part ${p.id}`, 'assemblies', p.assembly);
  for (const d of s.deliverables) ref(`deliverable ${d.id}`, 'assemblies', d.assembly);
  for (const t of s.tests) {
    ref(`test ${t.id}`, 'assemblies', t.assembly); ref(`test ${t.id}`, 'rigs', t.rig); ref(`test ${t.id}`, 'milestones', t.milestone);
    for (const r of t.resources) ref(`test ${t.id}`, 'rigs', r);
    if (!t.planned_date.length) errs.push(`test ${t.id} has no planned date`);
  }
  for (const m of s.milestones) for (const a of m.assemblies) ref(`milestone ${m.id}`, 'assemblies', a);
  return errs;
}

export function parseArgs(argv) {
  const a = { world: 'fixtures/world/world.json', out: 'fixtures/timevalue', sources: 'fixtures/flintlock' };
  for (let i = 0; i < argv.length; i++) {
    const m = /^--(world|out|sources)$/.exec(argv[i]);
    if (!m) throw new Error(`unknown argument ${argv[i]} (use --world, --out, --sources)`);
    if (argv[i + 1] == null || argv[i + 1].startsWith('--')) throw new Error(`${argv[i]} needs a path`);
    a[m[1]] = argv[++i];
  }
  return a;
}

function readJson(file, what) {
  if (!existsSync(file)) throw new Error(`missing ${what} ${file}`);
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch (e) { throw new Error(`${what} ${file} is not valid JSON: ${e.message}`); }
}

// Build, validate, then write <out>/settings.json (atomically). → { file, settings, bytes }
export function exportSettings({ world: worldPath, out }) {
  const world = readJson(worldPath, 'world');
  // coverage.json (written by the world's checks) holds the real text start of the written context; optional.
  const coveragePath = join(dirname(worldPath), 'coverage.json');
  const coverage = existsSync(coveragePath) ? readJson(coveragePath, 'coverage') : null;
  let settings;
  try { settings = buildSettings(world, coverage); } catch (e) { throw new Error(`${worldPath} is missing fields settings need: ${e.message}`); }
  const errs = validateSettings(settings);
  if (errs.length) throw new Error(`settings not written, ${errs.length} problem(s):\n  ${errs.slice(0, 20).join('\n  ')}`);
  mkdirSync(out, { recursive: true });
  const file = join(out, 'settings.json');
  const text = JSON.stringify(settings, null, 2) + '\n';
  writeFileSync(`${file}.tmp-${process.pid}`, text);
  renameSync(`${file}.tmp-${process.pid}`, file);
  return { file, settings, bytes: text.length };
}

// Smoke summary of the rendered sources: doc counts, Ramp<->Xometry link rate, usable orders.
function smoke(settings, sourcesDir) {
  if (!existsSync(sourcesDir)) throw new Error(`sources dir ${sourcesDir} not found (pass --sources <dir>)`);
  const sources = loadSources(sourcesDir);
  const bySource = {};
  for (const d of sources.docs) bySource[d.source] = (bySource[d.source] || 0) + 1;
  console.log(`sources: ${sources.docs.length} docs ${JSON.stringify(bySource)}; xometry ${sources.xometry.orders.length} orders / ${sources.xometry.quotes.length} quotes; ramp ${sources.ramp.transactions.length} transactions`);
  const links = linkRampToXometry(sources);
  console.log(`labels: ${JSON.stringify(links.summary)}`);
  if (settings.usable_from) {
    const [y, m, d] = settings.usable_from.split('-').map(Number);
    const from = toPacificIso(pacificLocalToMs(y, m, d));
    console.log(`usable orders (linked, T >= ${from}): ${usableLinks(links, from).length}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const { file, settings, bytes } = exportSettings(args);
    const counts = Object.entries(settings).filter(([, v]) => Array.isArray(v)).map(([k, v]) => `${k} ${v.length}`).join(', ');
    console.log(`wrote ${file} (${bytes} bytes): ${counts}`);
    smoke(settings, args.sources);
  } catch (e) {
    console.error(`export-settings: ${e.message}`);
    process.exit(1);
  }
}
