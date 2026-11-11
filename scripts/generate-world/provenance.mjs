#!/usr/bin/env node
// provenance: maps each event id to the rendered records it produced and back, plus each order to
// its Xometry and Ramp records (the "click a charge, see where it came from" trail).
//
//   node scripts/generate-world/provenance.mjs [--weeks N] [--world fixtures/world] [--out fixtures/flintlock]
// Reads <world>/planned/*.json; writes <world>/provenance.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

function walk(v, fn) {
  if (Array.isArray(v)) v.forEach((x) => walk(x, fn));
  else if (v && typeof v === 'object') { fn(v); for (const x of Object.values(v)) walk(x, fn); }
}

const recordId = (o) => o.record_id ?? o.id ?? o.key ?? o.ts ?? o.uid ?? null;

export function buildProvenance(planned) {
  const events = {};
  const records = {};
  const orders = {};
  const add = (map, k, v) => { (map[k] ||= []); if (!map[k].some((x) => JSON.stringify(x) === JSON.stringify(v))) map[k].push(v); };
  for (const source of Object.keys(planned).sort()) {
    const data = planned[source];
    if (source === 'jobs') continue; // planned/jobs.json is plan's text-key index, not records
    // Records: an array, {records: [...]}, or an object of arrays such as {channels, users, messages}.
    const top = Array.isArray(data) ? data : Array.isArray(data?.records) ? data.records
      : Object.values(data || {}).filter(Array.isArray).flat();
    for (const rec of top) {
      // Each top-level record, with every event mentioned anywhere inside it (messages, crumbs, comments).
      const rid = recordId(rec);
      if (rid == null) continue;
      const ref = { source, record: String(rid), ...(rec.file ? { file: rec.file } : {}) };
      const evs = new Set();
      walk(rec, (o) => {
        if (Array.isArray(o.events)) for (const e of o.events) if (typeof e === 'string') evs.add(e);
        if (typeof o.event === 'string') evs.add(o.event);
        // Nested records (Slack messages, Jira comments) get their own entry too.
        if (o !== rec && Array.isArray(o.events) && recordId(o) != null) {
          const sub = { source, record: String(recordId(o)), parent: String(rid) };
          for (const e of o.events) if (typeof e === 'string') { add(events, e, sub); add(records, `${source}:${sub.record}`, e); }
        }
      });
      for (const e of [...evs].sort()) { add(events, e, ref); add(records, `${source}:${ref.record}`, e); }
      if (typeof rec.order === 'string') add(orders, rec.order, ref);
    }
  }
  const sortObj = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
  return { events: sortObj(events), records: sortObj(records), orders: sortObj(orders) };
}

function main() {
  const argv = process.argv.slice(2);
  let world = path.join(ROOT, 'fixtures/world');
  for (let i = 0; i < argv.length; i++) if (argv[i] === '--world') world = path.resolve(argv[++i]); else if (argv[i] === '--weeks' || argv[i] === '--out') i++;
  const dir = path.join(world, 'planned');
  if (!fs.existsSync(dir)) { console.error(`provenance: ${dir} not found (run plan first)`); process.exit(1); }
  const planned = {};
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) planned[f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const prov = buildProvenance(planned);
  fs.writeFileSync(path.join(world, 'provenance.json'), JSON.stringify(prov, null, 2) + '\n');
  console.log(`provenance: ${Object.keys(prov.events).length} events, ${Object.keys(prov.records).length} records, ${Object.keys(prov.orders).length} orders -> ${path.relative(ROOT, path.join(world, 'provenance.json'))}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
