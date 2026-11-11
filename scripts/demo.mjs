#!/usr/bin/env node
// Runs Burn against a recorded world with every external service simulated: the Flintlock Robotics
// data, the demo clock at 10:30 AM PT on 2026-11-10, the company config from the world's policy
// file, and the headless browser driving the simulated Xometry site served by the same process.
//   npm run demo            # http://localhost:5173/orders → "Enter it as Owen"
//   npm run demo -- --reset # wipe data/demo-* first
// Everything stays under data/ (gitignored). Set any of the variables below yourself to override.
import {spawn} from 'node:child_process';
import {rmSync, mkdirSync} from 'node:fs';

const reset = process.argv.includes('--reset');
mkdirSync('data', {recursive: true});
if (reset) for (const f of ['data/demo-orders.sqlite', 'data/demo-ingest.sqlite', 'data/demo-app.sqlite', 'data/demo-xometry.sqlite', 'data/demo-recordings']) rmSync(f, {recursive: true, force: true});
const port = process.env.PORT || '5173';
const env = {
  BURN_WORLD: 'fixtures/flintlock', BURN_NOW: '2026-11-10T18:30:00Z', BURN_CONFIG: 'demo/flintlock.config.json', AGENT_OFFLINE: process.env.ANTHROPIC_API_KEY ? '0' : '1',
  VENDOR_MODE: 'headless', XOMETRY_HEADLESS_ENABLED: '1', XOMETRY_BASE_URL: `http://127.0.0.1:${port}/xometry-sim`, RAMP_MODE: 'mock',
  ORDERS_DB: 'data/demo-orders.sqlite', INGEST_DB: 'data/demo-ingest.sqlite', PURCHASING_DB: 'data/demo-app.sqlite', XOMETRY_SIM_DB: 'data/demo-xometry.sqlite', XOMETRY_RECORDINGS_DIR: 'data/demo-recordings',
  ...process.env, PORT: port,
};
const child = spawn(process.execPath, ['--env-file-if-exists=.env', 'server/dev.js'], {stdio: 'inherit', env});
child.on('exit', code => process.exit(code ?? 0));
