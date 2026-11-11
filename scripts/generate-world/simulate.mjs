#!/usr/bin/env node
// Plays the seeds forward into the ground truth.
//   node scripts/generate-world/simulate.mjs [--seed <int>] [--out <dir>] [--seed-dir <dir>] [--quiet]
// Reads seed/canon.json, seed/org.json, seed/program.json and knobs.json; writes world.json and answers.json
// (to fixtures/world/ or --out), then runs the validator and sim/selfcheck. Exit 1 on any error.
// The truth always covers the full window: there is no --weeks.
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson, stringify } from './lib/io.mjs';
import { buildWorld } from './sim/world.mjs';
import { validateWorld } from './validate.mjs';
import { selfcheck } from './sim/selfcheck.mjs';

const ROOT = fileURLToPath(new URL('../../fixtures/world/', import.meta.url));

export function loadSeeds(seedDir = join(ROOT, 'seed'), knobsPath = join(ROOT, 'knobs.json')) {
  const canon = readJson(join(ROOT, 'seed', 'canon.json'));
  const opt = (name) => (existsSync(join(seedDir, name)) ? readJson(join(seedDir, name)) : {});
  return { canon, org: opt('org.json'), program: opt('program.json'), knobs: readJson(knobsPath) };
}

export function simulate({ seed, seedDir, knobs } = {}) {
  const seeds = loadSeeds(seedDir);
  if (knobs) seeds.knobs = knobs;
  return buildWorld({ ...seeds, seed });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  if (args.includes('--weeks')) { console.error('simulate takes no --weeks: the truth always covers the full window'); process.exit(2); }
  const out = flag('--out') ? resolve(flag('--out')) : ROOT;
  const seedArg = flag('--seed');
  const seedDir = flag('--seed-dir') ? resolve(flag('--seed-dir')) : undefined;
  const { world, answers, state } = simulate({ seed: seedArg !== undefined ? parseInt(seedArg, 10) : undefined, seedDir });
  writeJson(join(out, 'world.json'), world);
  writeJson(join(out, 'answers.json'), answers);
  // validate what was written, not what is in memory
  const w = JSON.parse(stringify(world));
  const a = JSON.parse(stringify(answers));
  const { errors, warnings, counts } = validateWorld(w, a);
  const sc = selfcheck(state, w, a);
  if (!args.includes('--quiet')) {
    for (const x of warnings) console.log(`warning: ${x}`);
    for (const x of sc.warnings) console.log(`selfcheck warning: ${x}`);
    console.log('summary:', JSON.stringify(a.summary, null, 1));
  }
  for (const e of errors.slice(0, 60)) console.log(`error: ${e}`);
  if (errors.length > 60) console.log(`... ${errors.length - 60} more errors`);
  for (const e of sc.errors.slice(0, 60)) console.log(`selfcheck error: ${e}`);
  console.log('counts:', Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' '));
  console.log(sc.errors.length ? `SELFCHECK FAIL: ${sc.errors.length} error(s)` : `selfcheck OK (${sc.warnings.length} warning(s))`);
  console.log(errors.length ? `FAIL: ${errors.length} error(s)` : 'OK: world is valid');
  process.exit(errors.length || sc.errors.length ? 1 : 0);
}
