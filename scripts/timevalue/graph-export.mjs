// Exports Burn's company dependency graph (as known at demo now) for the /dependencies page.
//   node scripts/timevalue/graph-export.mjs   → fixtures/timevalue/company-graph.json
import { readFileSync, writeFileSync } from 'node:fs';
import { loadSources } from '../../server/timevalue/sources.mjs';
import { buildGraph, graphAt } from '../../server/timevalue/graph.mjs';

const settings = JSON.parse(readFileSync('fixtures/timevalue/settings.json', 'utf8'));
const sources = loadSources('fixtures/flintlock');
const view = graphAt(buildGraph({ settings, sources }), settings.demo_now);
const asm = new Map();
for (const p of [...settings.parts, ...settings.deliverables, ...settings.tests]) asm.set(p.id, p.assembly ?? null);
for (const m of settings.milestones) asm.set(m.id, (m.assemblies || [])[0] ?? null);
const docs = new Map(sources.docs.map((d) => [d.id, d]));
const used = new Set();
const edges = view.edges.filter((e) => e.kind !== 'ordered_as').map((e) => {
  used.add(e.from); used.add(e.to);
  return { from: e.from, to: e.to, status: e.status, evidence: (e.evidence || []).slice(0, 2).map((v) => {
    const d = docs.get(v.doc_id); return { by: d?.author?.name ?? v.by ?? null, at: v.at, text: (d?.text || '').slice(0, 140) };
  }) };
});
const people = new Map(settings.people.map((p) => [p.id, p.name]));
const owner = new Map();
for (const x of [...settings.tests, ...settings.milestones, ...settings.deliverables]) if (x.owner) owner.set(x.id, people.get(x.owner) || x.owner);
// Work items have no configured owner: use the person who said they were waiting.
for (const e of edges) if (!owner.has(e.to) && e.evidence[0]?.by) owner.set(e.to, e.evidence[0].by);
const nodes = view.nodes.filter((n) => used.has(n.id)).map((n) => ({ id: n.id, kind: n.kind, name: n.name, assembly: asm.get(n.id) ?? null, owner: owner.get(n.id) ?? null }));
writeFileSync('fixtures/timevalue/company-graph.json', JSON.stringify({ now: settings.demo_now, nodes, edges }));
console.log(`company graph: ${nodes.length} nodes, ${edges.length} links`);
