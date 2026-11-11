// Company configuration: the things a customer sets once, never demo data.
// Loaded from BURN_CONFIG (JSON) if present, else from burn.config.json in the working
// directory, else these defaults. Everything here is visible in the UI's assumptions.
import {readFileSync, existsSync} from 'node:fs';

const DEFAULTS = {
  company: {name: 'Your company', currency: 'USD', timeZone: 'America/Los_Angeles'},
  // Spec fields every order must resolve before quoting. `default` is an authorized company default
  // (provenance 'default'); fields without one are gaps the engineer must answer.
  specFields: [
    {key: 'material', label: 'Material', default: null},
    {key: 'finish', label: 'Finish', default: 'As machined'},
    {key: 'tolerance', label: 'Tolerance', default: 'ISO 2768-m'},
    {key: 'quantity', label: 'Quantity', default: null},
    {key: 'revision', label: 'Drawing / CAD revision', default: null},
    {key: 'inspection', label: 'Inspection', default: 'Standard'},
    {key: 'shipTo', label: 'Ship to', default: null},
  ],
  // Value-of-time policy per milestone, set by its owner. Cents per day; null = break-even only.
  milestones: {},
  // Declared scenarios for uncertain sibling dates: "as stated" plus these slips, in days.
  scenarios: {slipDays: [3, 7]},
  // How old a fact can be before it counts as stale and may trigger a question.
  stalenessDays: {eta: 7, duration: 30, needBy: 14},
  ramp: {spendProgramId: process.env.RAMP_SPEND_PROGRAM_ID || 'spend_program_default', requestOwnerId: process.env.RAMP_REQUEST_OWNER_ID || null},
  vendor: {name: 'xometry', allowedVendors: ['Xometry']},
};

export function loadConfig() {
  const path = process.env.BURN_CONFIG || (existsSync('burn.config.json') ? 'burn.config.json' : null);
  if (!path) return structuredClone(DEFAULTS);
  const file = JSON.parse(readFileSync(path, 'utf8'));
  return {...structuredClone(DEFAULTS), ...file, specFields: file.specFields || DEFAULTS.specFields, milestones: {...DEFAULTS.milestones, ...(file.milestones || {})}, ramp: {...DEFAULTS.ramp, ...(file.ramp || {})}};
}
