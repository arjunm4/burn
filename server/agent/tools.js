// Read-only fixture tools the agent can call. Each tool has a Claude tool definition,
// a UI label for the "working" list, and a one-line summary of its result.
// Swap `run` for real Slack / calendar / dependency / policy integrations.
import {decisions} from '../../src/decisions.js';

const ALIASES = {
  sens: ['acs37002', 'current sensor'],
  harn: ['harness', 'cable'],
  fpga: ['fpga', 'dev kit'],
  cham: ['thermal chamber', 'chamber'],
  mold: ['mold', 't1 sample'],
  load: ['load cell'],
  probe: ['scope probe'],
};
const CHANNELS = {
  'Rev C power board': {channel: '#rev-c-bringup', items: [
    {from: 'Lee Tan', text: 'Firmware validation is blocked until the Rev C current sensors land.'},
    {from: 'Anya Petrov', text: 'Thermal & EMC runs on the same Rev C boards, so we start after firmware.'},
  ]},
  'Motor-control firmware': {channel: '#motor-fw', items: [{from: 'Marco Ruiz', text: 'OOO until Nov 12.'}]},
  'Enclosure tooling': {channel: '#enclosure', items: [{from: 'Sam Oyelaran', text: 'Fit check needs T1 samples before DVT.'}]},
  'Calibration rig': {channel: '#cal-rig', items: [{from: 'Ines Okafor', text: 'Rig waits on two EVT units.'}]},
};
// The one fact per request that changes the recommendation, if it is unknown.
const OPEN_QUESTIONS = {
  sens: {id: 'revb', ask: 'Can firmware start on your Rev B boards?', fact: 'Whether firmware validation can start on existing Rev B boards. If yes, nothing waits on these parts.',
    choices: [{id: 'revb_yes', label: 'Yes'}, {id: 'revb_no', label: 'No, needs Rev C'}]},
};

const byId = id => decisions.find(d => d.id === id);
const need = (input, key) => { if (typeof input?.[key] !== 'string' || !input[key]) throw Error(`${key} is required`); return input[key]; };

export const tools = [
  {
    name: 'find_part', label: () => 'Matching part to open requests',
    description: 'Find the purchase request and shipping options matching a part name or number from the requester. Call this first.',
    input_schema: {type: 'object', properties: {query: {type: 'string', description: 'Part name or number, e.g. "ACS37002"'}}, required: ['query'], additionalProperties: false},
    run: input => {
      const q = need(input, 'query').toLowerCase();
      // Whole-word alias matches only: a fragment like "s" must never match a part.
      const hit = decisions.find(d => ALIASES[d.id].some(a => new RegExp(`(^|[^a-z0-9])${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?($|[^a-z0-9])`).test(q)));
      if (!hit) return {found: false};
      return {found: true, decisionId: hit.id, pr: hit.pr, part: hit.part, project: hit.project, tiers: hit.tiers.map((t, i) => ({index: i, ...t}))};
    },
    summarize: r => r.found ? r.pr : 'no match',
  },
  {
    name: 'read_project_channel', label: (input, r) => `Reading ${r?.channel || 'project channel'}`,
    description: 'Read recent work items from the project Slack channel.',
    input_schema: {type: 'object', properties: {project: {type: 'string'}}, required: ['project'], additionalProperties: false},
    run: input => CHANNELS[need(input, 'project')] || {channel: null, items: []},
    summarize: r => `${r.items.length} work item${r.items.length === 1 ? '' : 's'}`,
  },
  {
    name: 'check_hardware_calendar', label: () => 'Checking hardware calendar',
    description: 'Look up the next hardware milestone and slack for a request.',
    input_schema: {type: 'object', properties: {decisionId: {type: 'string'}}, required: ['decisionId'], additionalProperties: false},
    run: input => { const d = byId(need(input, 'decisionId')); return d ? {milestone: d.milestone, slackDays: d.slack} : {error: 'unknown decisionId'}; },
    summarize: r => r.milestone || 'no milestone',
  },
  {
    name: 'map_dependencies', label: () => 'Mapping dependencies',
    description: 'Find which work and engineers wait on this part, plus any open question whose answer would change who waits.',
    input_schema: {type: 'object', properties: {decisionId: {type: 'string'}}, required: ['decisionId'], additionalProperties: false},
    run: input => {
      const d = byId(need(input, 'decisionId')); if (!d) return {error: 'unknown decisionId'};
      return {waitingWork: d.chain, engineersBlocked: d.blocked, dependsOn: d.dep || null, openQuestion: OPEN_QUESTIONS[d.id] || null};
    },
    summarize: r => r.engineersBlocked ? `${r.engineersBlocked} engineers` : 'nobody waiting',
  },
  {
    name: 'check_policy', label: () => 'Checking policy',
    description: 'Get the purchasing approval policy.',
    input_schema: {type: 'object', properties: {}, additionalProperties: false},
    run: () => ({approvalLimit: 500, rules: ['Orders over $500 need approval', 'Choosing a tier other than the recommendation needs approval']}),
    summarize: r => `> $${r.approvalLimit} needs approval`,
  },
];

export const toolByName = Object.fromEntries(tools.map(t => [t.name, t]));
export const openQuestionFor = id => OPEN_QUESTIONS[id] || null;
