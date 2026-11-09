// Purchasing agent: turns a free-text request into a matched request, the context the
// recommendation depends on, and at most one question for the requester.
// With ANTHROPIC_API_KEY (or an `ant auth login` profile) it runs a Claude tool-use loop;
// otherwise, or if the API call fails, a deterministic planner runs the same tools.
// Cost math never happens here: src/decisions.js derives totals from the facts gathered.
import Anthropic from '@anthropic-ai/sdk';
import {tools, toolByName, openQuestionFor} from './tools.js';

export const MODEL = process.env.AGENT_MODEL || 'claude-opus-5';
const MAX_TURNS = 8;

const SYSTEM = `You are a purchasing agent for a hardware team. An engineer has written a purchase request in free text.
Use the tools to match it to an open request, read the project channel, check the hardware calendar, map who waits on the part, and check policy.
Do not compute costs; the system does that from the facts you gather.
If map_dependencies returns an openQuestion, ask the engineer exactly that question in one short, plain sentence that first names the work waiting on the part, and use its choice ids unchanged.
Ask nothing else. When you are done, call finish_analysis once.`;

const FINISH = {
  name: 'finish_analysis',
  description: 'Report the parsed request and the single question for the requester (or none). Call once, last.',
  strict: true,
  input_schema: {
    type: 'object', additionalProperties: false,
    required: ['decisionId', 'qty', 'vendor', 'askedTier', 'question'],
    properties: {
      decisionId: {type: ['string', 'null'], description: 'decisionId from find_part, or null if nothing matched'},
      qty: {type: ['integer', 'null']},
      vendor: {type: ['string', 'null']},
      askedTier: {type: 'integer', description: 'Index of the shipping tier the requester asked for; 0 if unstated'},
      question: {
        anyOf: [{type: 'null'}, {type: 'object', additionalProperties: false, required: ['text', 'choiceIds'],
          properties: {text: {type: 'string'}, choiceIds: {type: 'array', items: {type: 'string'}}}}],
      },
    },
  },
};

function hasCredentials() { return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE); }

// Shared executor so both planners emit identical working events.
function makeRunner(emit) {
  let index = 0; const facts = {};
  return {facts, async call(name, input) {
    const tool = toolByName[name]; const i = index++;
    emit({type: 'tool.started', index: i, name, label: tool.label(input)});
    let result;
    try { result = await tool.run(input); } catch (error) { result = {error: error.message}; }
    facts[name] = result;
    emit({type: 'tool.completed', index: i, name, label: tool.label(input, result), summary: result.error ? 'failed' : tool.summarize(result), result});
    return result;
  }};
}

// Free-text parsing shared by the fallback and as validation of the model's output.
export function parseRequest(text, tiers = []) {
  const qty = text.match(/(?:^|\s)[×x*]\s*(\d+)\b/i) || text.match(/\b(\d+)\s*(?:pcs|units|pieces)\b/i);
  const vendor = text.match(/from\s+([A-Z][\w-]*(?:\s[A-Z][\w-]*)?)/);
  const asked = tiers.findIndex(t => new RegExp(`\\b${t.name.split(' ')[0]}`, 'i').test(text));
  return {qty: qty ? Number(qty[1]) : null, vendor: vendor ? vendor[1] : null, askedTier: Math.max(0, asked)};
}

function questionFrom(decisionId, text) {
  const open = openQuestionFor(decisionId); if (!open) return null;
  return {id: open.id, text, choices: open.choices};
}

async function fallback(request, emit) {
  const run = makeRunner(emit);
  const query = request.text.split(/\s+(?:[×x]\s*\d|from\b|,)/i)[0];
  const part = await run.call('find_part', {query});
  if (!part.found) { await run.call('check_policy', {}); return {parsed: {decisionId: null, ...parseRequest(request.text)}, question: null, planner: 'fallback'}; }
  await run.call('read_project_channel', {project: part.project, decisionId: part.decisionId});
  await run.call('check_hardware_calendar', {decisionId: part.decisionId});
  const deps = await run.call('map_dependencies', {decisionId: part.decisionId});
  await run.call('check_policy', {});
  const waiting = new Intl.ListFormat('en', {type: 'conjunction'}).format(deps.waitingWork || []);
  const question = deps.openQuestion ? questionFrom(part.decisionId, `${waiting} wait${deps.waitingWork.length === 1 ? 's' : ''} on these. ${deps.openQuestion.ask}`) : null;
  return {parsed: {decisionId: part.decisionId, ...parseRequest(request.text, part.tiers)}, question, planner: 'fallback'};
}

async function withClaude(request, emit, client = new Anthropic()) {
  const run = makeRunner(emit);
  const toolDefs = [...tools.map(({name, description, input_schema}) => ({name, description, input_schema})), FINISH];
  const messages = [{role: 'user', content: `Requester: ${request.requester || 'unknown'}\nRequest: ${request.text}`}];
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await client.beta.messages.create({
      model: MODEL, max_tokens: 16000, system: SYSTEM, tools: toolDefs, messages,
      thinking: {type: 'adaptive'}, output_config: {effort: 'low'},
      betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
    });
    if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') throw Error(`model stopped: ${response.stop_reason}`);
    const calls = response.content.filter(b => b.type === 'tool_use');
    if (!calls.length) throw Error('model ended without finish_analysis');
    messages.push({role: 'assistant', content: response.content});
    const finish = calls.find(c => c.name === 'finish_analysis');
    const results = [];
    for (const c of calls) {
      if (c === finish) continue;
      const result = toolByName[c.name] ? await run.call(c.name, c.input) : {error: `unknown tool ${c.name}`};
      results.push({type: 'tool_result', tool_use_id: c.id, content: JSON.stringify(result), ...(result.error ? {is_error: true} : {})});
    }
    if (finish) {
      // A skipped find_part would discard a valid match, so verify the model's pick ourselves.
      if (!run.facts.find_part) await run.call('find_part', {query: request.text});
      return finalize(finish.input, run.facts, request);
    }
    messages.push({role: 'user', content: results});
  }
  throw Error('agent exceeded turn limit');
}

// Trust the model's phrasing, but not its ids: re-check against the facts it gathered.
function finalize(out, facts, request) {
  const part = facts.find_part;
  const decisionId = part?.found ? part.decisionId : null;
  const parsed = parseRequest(request.text, part?.tiers);
  const tierCount = part?.tiers?.length || 1;
  const askedTier = Number.isInteger(out.askedTier) && out.askedTier >= 0 && out.askedTier < tierCount ? out.askedTier : parsed.askedTier;
  const open = decisionId && openQuestionFor(decisionId);
  const question = open && out.question?.text ? questionFrom(decisionId, out.question.text) : null;
  return {parsed: {decisionId, qty: out.qty ?? parsed.qty, vendor: out.vendor ?? parsed.vendor, askedTier}, question, planner: 'claude'};
}

/**
 * analyze({text, requester}, emit) -> {parsed:{decisionId, qty, vendor, askedTier}, question|null, planner}
 * emit receives tool.started / tool.completed / agent.fallback events.
 */
export async function analyze(request, emit = () => {}, {client} = {}) {
  if (!client && (!hasCredentials() || process.env.AGENT_OFFLINE === '1')) return fallback(request, emit);
  try { return await withClaude(request, emit, client); }
  catch (error) {
    emit({type: 'agent.fallback', error: error instanceof Anthropic.APIError ? `API ${error.status}` : error.message});
    return fallback(request, emit);
  }
}
