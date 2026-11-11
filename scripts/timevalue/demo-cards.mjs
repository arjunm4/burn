// Precompute the demo's four cards (change 0–3) into <out>/demo-cards.json,
// which the UI falls back to when the server route is unavailable. No model call.
//
//   node scripts/timevalue/demo-cards.mjs [--sources <dir>] [--out <dir>]
//
// --sources defaults to the small demo fixture (fixtures/timevalue/demo-sources) while the world is still
// being built. When the final render lands: node scripts/timevalue/demo-cards.mjs --sources fixtures/flintlock
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { demoCard, FIXTURE_SOURCES, DEFAULT_OUT, ROOT } from '../../server/timevalue/demo.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? path.resolve(process.argv[i + 1]) : fallback;
}

const sourcesDir = arg('--sources', FIXTURE_SOURCES);
const outDir = arg('--out', DEFAULT_OUT);
const cards = {};
for (const change of [0, 1, 2, 3, 4]) cards[change] = await demoCard({ change, sourcesDir, outDir });
const out = { sources_dir: path.relative(ROOT, sourcesDir), cards };
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, 'demo-cards.json'), JSON.stringify(out, null, 2) + '\n');
for (const change of [0, 1, 2, 3, 4]) console.log(`change ${change}: ${cards[change].card.outcome} — ${cards[change].card.headline}`);
console.log(`wrote ${path.relative(ROOT, path.join(outDir, 'demo-cards.json'))} from ${out.sources_dir}`);
