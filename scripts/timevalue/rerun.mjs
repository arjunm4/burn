// One command for the code steps of the Time Value rerun (docs/build/time-value-impl.md).
//   node scripts/timevalue/rerun.mjs jobs     → settings + read jobs (then agents fill the jobs)
//   node scripts/timevalue/rerun.mjs finish   → collect reads, train, grade, demo cards
import { execFileSync } from 'node:child_process';

const run = (script, ...args) => {
  console.log(`\n▶ ${script} ${args.join(' ')}`);
  execFileSync(process.execPath, [`scripts/timevalue/${script}`, ...args], { stdio: 'inherit' });
};

const step = process.argv[2];
if (step === 'jobs') {
  run('export-settings.mjs');
  run('read-jobs.mjs');
} else if (step === 'finish') {
  run('read-jobs.mjs', '--collect');
  // run('train.mjs');  // habit model tabled (Owen, 2026-11-10)
  run('grade.mjs');
  run('demo-cards.mjs', '--sources', 'fixtures/flintlock');
} else {
  console.error('usage: node scripts/timevalue/rerun.mjs jobs|finish');
  process.exit(1);
}
