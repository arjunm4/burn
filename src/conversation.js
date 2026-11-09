// Builds the engineer conversation from a persisted request plus live agent events.
// Pure data in, plain message objects out; actions are descriptors the view dispatches.
import {COST, deriveDecisions} from './decisions.js';

export const DEFAULT_TEXT = 'ACS37002 × 40 from Digi-Key, standard shipping.';
const LEGACY_QUESTION = {text: 'Firmware validation and Thermal & EMC wait on these. Can firmware start on your Rev B boards?',
  choices: [{id: 'revb_yes', label: 'Yes'}, {id: 'revb_no', label: 'No, needs Rev C'}]};
// Labels for the original fixture tool events, which carry no label or summary.
const LEGACY_TOOLS = {
  read_project_work: ['Reading #rev-c-bringup', r => `${r.items?.length ?? 0} work items`],
  check_hardware_calendar: ['Checking hardware calendar', r => r.milestone],
  map_dependencies: ['Mapping dependencies', r => `${r.engineers} engineers`],
  check_policy: ['Checking policy', r => `> $${r.approvalLimit} needs approval`],
};
const REASONS = {over_limit: 'Over $500 policy', off_recommendation: 'Differs from recommendation'};

export const money = n => '$' + Math.round(n).toLocaleString('en-US');
export const day = iso => iso ? new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', {month: 'short', day: 'numeric', timeZone: 'UTC'}) : '';
const answerOf = choiceId => /yes$/.test(choiceId) ? 'yes' : 'no';

// Folds one NDJSON agent event into the working list.
export function applyToolEvent(tools, event) {
  if (event.type === 'agent.fallback') return [];
  if (event.type !== 'tool.started' && event.type !== 'tool.completed') return tools;
  const legacy = LEGACY_TOOLS[event.name];
  const label = event.label || legacy?.[0] || event.name;
  const summary = event.type === 'tool.completed' ? (event.summary ?? (legacy && event.result ? legacy[1](event.result) : '')) : '';
  const next = tools.filter(t => t.index !== event.index);
  next.push({index: event.index, label, summary, done: event.type === 'tool.completed'});
  return next.sort((a, b) => a.index - b.index);
}

export function needsRun(request) {
  return request.status === 'analyzing' || (request.status === 'needs_answer' && !request.question && !request.analysis);
}

export function buildConversation(request, {tools = [], running = false, requests = []} = {}) {
  const me = text => ({from: 'me', text});
  const ai = (text, extra = {}) => ({from: 'ai', text, ...extra});
  const [d] = deriveDecisions([request]);
  const persisted = request.analysis?.tools?.map((t, index) => ({index, done: true, ...t}));
  const work = running || tools.length ? tools : persisted || Object.values(LEGACY_TOOLS).map(([label], index) => ({index, label, summary: '', done: true}));
  const planner = request.analysis?.planner;
  const plannerNote = planner === 'fallback' ? 'Offline planner · no model call' : planner === 'claude' ? 'Planned by Claude' : null;
  const msgs = [me(request.text || DEFAULT_TEXT), ai(null, {work: running && !work.length ? [{index: 0, label: 'Reading the request', summary: '', done: false}] : work, ...(plannerNote && !running ? {meta: plannerNote} : {})})];
  if (running || request.status === 'analyzing') return msgs;

  if (request.status === 'unsupported') {
    msgs.push(ai('I couldn’t match that to an open request or a known part. Try the part number and quantity, e.g. “ACS37002 × 40”.', {compose: true}));
    return msgs;
  }

  // Only the original sensor demo, before any analysis is stored, falls back to the scripted question.
  const question = request.question || (!request.analysis && (request.catalogId || request.id) === 'sens' ? LEGACY_QUESTION : null);
  const answered = !!request.answer;
  if (question) {
    msgs.push(ai(question.text, answered || request.status !== 'needs_answer' ? {} : {
      choices: question.choices.map(c => ({label: c.label, action: {type: 'answer', body: {answer: answerOf(c.id), choiceId: c.id}}})),
    }));
    if (!answered) return msgs;
    msgs.push(me(request.answer === 'yes' ? 'Yes, Rev B works.' : 'No, needs Rev C.'));
  }

  const pickedIndex = request.approvedTier ?? request.selectedTier;
  if (request.answer === 'yes') {
    const t = d.tiers[pickedIndex ?? 0];
    msgs.push(ai(`Then nothing waits on these, so ${t.name.toLowerCase()} is fine. I drafted the purchase order.`, {
      rows: [{name: t.name, detail: `${money(t.price)} · arrives ${day(t.arrivesOn)}`, tag: 'draft PO'}],
      meta: `No approval needed · ${request.order?.id || 'draft order'}`,
    }));
    return msgs;
  }
  if (request.status === 'waiting') {
    const dep = requests.find(r => r.id === request.dep);
    msgs.push(ai(`This depends on ${dep ? `${dep.part} (${dep.pr})` : 'another decision'}. I’ll recommend an option once that’s decided.`, {status: 'Waiting'}));
    return msgs;
  }

  const cheapest = d.cheapest;
  const choosing = request.status === 'choosing';
  msgs.push(ai(cheapest.late
    ? `${question ? 'Then ' : ''}${question ? cheapest.name.toLowerCase() : cheapest.name} lands ${day(cheapest.arrivesOn)}, ${cheapest.late} days after ${request.neededBy ? day(request.neededBy) : 'the milestone'}, with ${request.blocked} engineers waiting.`
    : `${request.blocked ? 'Every option lands in time' : 'Nobody waits on these'}${request.milestone && request.milestone !== 'None' ? ` for ${request.milestone}` : ''}, so ${d.rec.name.toLowerCase()} is fine.`, {
    rows: d.tiers.map(t => ({
      name: t.name,
      detail: `${money(t.price)} · ${day(t.arrivesOn)}${t.late ? ` · ${t.late}d late` : ' · on time'}`,
      total: money(t.total),
      tag: t.i === d.rec.i ? 'Recommended' : '',
      selected: t.i === pickedIndex && !choosing,
      action: choosing ? {type: 'select', body: {tier: t.i}} : null,
    })),
    meta: `Total = shipping + est. delay: ${request.blocked} waiting engineers × ${money(COST)}/day`,
  }));

  if (request.status === 'pending_approval') {
    const t = d.tiers[request.selectedTier];
    const reasons = (request.approvalReasons || []).map(r => REASONS[r] || r);
    msgs.push(ai(t.late ? `Sent to Priya with the ${t.late}-day slip flagged. I’ll draft the order when she approves.` : 'Sent to Priya. I’ll draft the order when she approves.', {
      meta: reasons.join(' · ') || 'Needs approval', status: 'Waiting on Priya',
    }));
  }
  if (request.status === 'ordered') {
    const t = d.tiers[pickedIndex];
    const approved = request.approvalReasons?.length;
    msgs.push(ai(`${approved ? 'Priya approved' : 'No approval needed for'} ${t.name.toLowerCase()}, arriving ${day(t.arrivesOn)}. Draft purchase order created.`, {meta: request.order?.id || 'Draft order', status: 'Draft PO'}));
  }
  return msgs;
}
