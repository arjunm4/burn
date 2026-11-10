// Read-only tools the agent can call. Each tool has a Claude tool definition,
// a UI label for the "working" list, and a one-line summary of its result.
// Swap `run` for real Slack / calendar / dependency / policy integrations.
import {decisions} from '../../src/decisions.js';
import {activeIngest} from '../ingest/active.js';
import {blockedPeople, downstream} from '../../src/graph/engine.js';

// Ingested graph + documents when the server is running with ingestion; null otherwise.
function live() {
  const g = activeIngest()?.latestGraph();
  return g ? {graph: g.graph, docs: activeIngest().listDocuments()} : null;
}
const nodeLabel = (graph, id) => graph.nodes.find(n => n.id === id)?.label || id;

const ALIASES = {
  sens: ['acs37002', 'current sensor'],
  harn: ['harness', 'cable'],
  fpga: ['fpga', 'dev kit'],
  cham: ['thermal chamber', 'chamber'],
  mold: ['mold', 't1 sample'],
  load: ['load cell'],
  probe: ['scope probe'],
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
    input_schema: {type: 'object', properties: {project: {type: 'string'}, decisionId: {type: 'string', description: 'decisionId from find_part, to read messages about this part'}}, required: ['project'], additionalProperties: false},
    run: input => {
      const project = need(input, 'project'); const data = live();
      // Only real ingested messages: no hardcoded channel content.
      if (!data || !input.decisionId) return {channel: null, items: [], note: 'no ingested messages for this project'};
      // Messages that mention the part or the work waiting on it, newest last.
      const terms = [...(ALIASES[input.decisionId] || []), ...downstream(data.graph, `part:${input.decisionId}`).map(id => nodeLabel(data.graph, id).toLowerCase())];
      const hits = data.docs.filter(d => d.source === 'slack' && terms.some(t => d.text.toLowerCase().includes(t)));
      const counts = {}; for (const d of hits) counts[d.channel] = (counts[d.channel] || 0) + 1;
      const channel = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
      // Messages about the part itself first, then about the work waiting on it; shown in time order.
      const direct = hits.filter(d => (ALIASES[input.decisionId] || []).some(a => d.text.toLowerCase().includes(a)));
      const picked = [...direct, ...hits.filter(d => !direct.includes(d))].slice(0, 8).sort((a, b) => a.at.localeCompare(b.at));
      return {channel, items: picked.map(d => ({from: d.author, text: d.text, at: d.at, source: d.id}))};
    },
    summarize: r => (r.items.length ? `${r.items.length} related message${r.items.length === 1 ? '' : 's'}` : 'no messages'),
  },
  {
    name: 'check_hardware_calendar', label: () => 'Checking hardware calendar',
    description: 'Look up the next hardware milestone and slack for a request.',
    input_schema: {type: 'object', properties: {decisionId: {type: 'string'}}, required: ['decisionId'], additionalProperties: false},
    run: input => {
      const id = need(input, 'decisionId'); const d = byId(id); if (!d) return {error: 'unknown decisionId'};
      const data = live();
      const milestones = data ? downstream(data.graph, `part:${id}`).map(m => data.graph.nodes.find(n => n.id === m)).filter(n => n?.kind === 'milestone' && n.attrs?.date).sort((a, b) => a.attrs.date.localeCompare(b.attrs.date)) : [];
      if (!milestones.length) return {milestone: d.milestone, slackDays: d.slack};
      const day = iso => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', {month: 'short', day: 'numeric', timeZone: 'UTC'});
      return {milestone: `${milestones[0].label.replace(/\s*\(.*\)$/, '')} · ${day(milestones[0].attrs.date)}`, milestones: milestones.map(m => ({label: m.label, date: m.attrs.date}))};
    },
    summarize: r => r.milestone || 'no milestone',
  },
  {
    name: 'map_dependencies', label: () => 'Mapping dependencies',
    description: 'Find which work and engineers wait on this part, plus any open question whose answer would change who waits.',
    input_schema: {type: 'object', properties: {decisionId: {type: 'string'}}, required: ['decisionId'], additionalProperties: false},
    run: input => {
      const d = byId(need(input, 'decisionId')); if (!d) return {error: 'unknown decisionId'};
      const data = live(); const part = `part:${d.id}`;
      if (data?.graph.nodes.some(n => n.id === part)) {
        const work = downstream(data.graph, part).filter(id => data.graph.nodes.find(n => n.id === id)?.kind === 'work');
        const people = blockedPeople(data.graph, part);
        return {waitingWork: work.map(id => nodeLabel(data.graph, id)), engineersBlocked: people.length, people: people.map(id => nodeLabel(data.graph, id)), dependsOn: d.dep || null, openQuestion: OPEN_QUESTIONS[d.id] || null, source: 'graph'};
      }
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
