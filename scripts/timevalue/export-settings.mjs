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
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
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

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const worldPath = arg('--world', 'fixtures/world/world.json');
  const out = arg('--out', 'fixtures/timevalue');
  const world = JSON.parse(readFileSync(worldPath, 'utf8'));
  // coverage.json (written by the world's checks) holds the real text start of the written context.
  let coverage = null;
  try { coverage = JSON.parse(readFileSync(worldPath.replace(/world\.json$/, 'coverage.json'), 'utf8')); } catch {}
  const settings = buildSettings(world, coverage);
  mkdirSync(out, { recursive: true });
  const text = JSON.stringify(settings, null, 2) + '\n';
  writeFileSync(join(out, 'settings.json'), text);
  const counts = Object.entries(settings).filter(([, v]) => Array.isArray(v)).map(([k, v]) => `${k} ${v.length}`).join(', ');
  console.log(`wrote ${join(out, 'settings.json')} (${text.length} bytes): ${counts}`);

  const sources = loadSources(arg('--sources', 'fixtures/flintlock'));
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
