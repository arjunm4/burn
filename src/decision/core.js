// The decision core: pure functions from a planning snapshot to a DecisionResult.
// Implements architecture §7 (and HLD "How the recommendation is made"):
//   admissible options → same-world comparison across declared scenarios →
//   dominance → owner policy → economics, else break-even only; one question if a fact flips it.
// It never invents a dollar value, never turns unknown dates into estimates, and never
// prices people's time. Runs in Node and the browser.
import {analyzeGraph, toDay, toIso} from '../graph/engine.js';
import {createHash} from '../hash.js';

const DAY = 86400000;
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

/**
 * @param {object} input
 * @param {import('../../server/contracts.js').QuoteOption[]} input.options
 * @param {{validUntil?: string|null, cutoff?: string|null}} input.quote
 * @param {object} input.graph           engine graph; the part is input.partNodeId
 * @param {string} input.partNodeId
 * @param {string} input.milestoneId     the valued outcome
 * @param {string} input.orderDate       ISO
 * @param {string} input.now             ISO
 * @param {{valuePerDayCents: number|null, targetOn: string|null, hard: boolean, owner: string|null, source?: string}} input.policy
 * @param {Array<{nodeId: string, label: string, owner: string, plausible: string[], current: string|null}>} [input.uncertain]
 *   Facts whose plausible values define the scenarios. One fact varies at a time.
 * @param {Array<{text: string, ageDays: number|null}>} [input.assumptions]
 * @param {{revisionOk?: boolean, quantityOk?: boolean, authority?: boolean}} [input.constraints]
 */
export function decide(input) {
  const {options, quote = {}, graph, partNodeId, milestoneId, orderDate, now, policy = {}, uncertain = [], assumptions = [], constraints = {}} = input;
  const snapshotHash = createHash(JSON.stringify({options, quote, graph, partNodeId, milestoneId, orderDate, policy, uncertain, constraints}));

  // 1. Admissibility: a valid quote, right revision and quantity, authority, not past the cutoff.
  const quoteExpired = quote.validUntil && Date.parse(quote.validUntil) < Date.parse(now);
  const pastCutoff = quote.cutoff && Date.parse(quote.cutoff) < Date.parse(now);
  const inadmissibleWhy = quoteExpired ? 'quote expired' : constraints.revisionOk === false ? 'wrong revision' : constraints.quantityOk === false ? 'wrong quantity' : constraints.authority === false ? 'no authority for this purchase' : null;

  // 2. Scenarios: the baseline world plus one variation per plausible value of each uncertain fact.
  const scenarios = [{id: 'base', label: 'as known', arrivals: {}, varied: null}];
  for (const u of uncertain) for (const v of u.plausible) {
    if (v === u.current) continue;
    scenarios.push({id: `${u.nodeId}=${v}`, label: `${u.label} ${v}`, arrivals: {[u.nodeId]: v}, varied: u});
  }

  // 3. Same-world outcomes: every option is scheduled in every scenario with identical assumptions.
  const outcomes = {}; // tier -> scenarioId -> {finishOn, unknowns}
  for (const o of options) {
    outcomes[o.tier] = {};
    for (const s of scenarios) {
      // A later arrival from the part never improves a sibling: scenario arrivals override only their own node.
      const a = analyzeGraph(graph, {orderDate, arrivals: {...s.arrivals, [partNodeId]: o.readyOn}});
      const m = a.at[milestoneId];
      outcomes[o.tier][s.id] = {finishOn: m?.finish ?? null, unknowns: a.unknown, blocked: a.blocked, drivenBy: m?.drivenBy ?? null};
    }
  }

  const admissible = options.filter(() => !inadmissibleWhy);
  const cheapest = admissible.length ? admissible.reduce((a, b) => (b.priceCents < a.priceCents ? b : a)) : null;
  const finish = (tier, sid) => outcomes[tier][sid].finishOn;
  const base = scenarios[0].id;
  const unknownBase = cheapest ? outcomes[cheapest.tier][base].unknowns : [];

  // 4. Per-option summary in the base scenario: days gained vs the cheapest admissible option, break-even.
  const summary = options.map(o => {
    const adm = !inadmissibleWhy;
    const f = finish(o.tier, base);
    const f0 = cheapest ? finish(cheapest.tier, base) : null;
    const deltaDays = adm && f && f0 ? daysBetween(f, f0) : null;
    const extraCents = cheapest ? o.priceCents - cheapest.priceCents : 0;
    return {tier: o.tier, admissible: adm, ...(adm ? {} : {why: inadmissibleWhy}), readyOn: o.readyOn, finishOn: f, deltaDays, extraCents,
      breakEvenCentsPerDay: deltaDays && deltaDays > 0 && extraCents > 0 ? Math.round(extraCents / deltaDays) : null};
  });

  // 5. Dominance across every declared scenario: A dominates B if A is no dearer and finishes no later
  //    in every scenario, and is strictly better on price or time somewhere. Unknown finishes never dominate.
  const dominated = new Set();
  for (const a of admissible) for (const b of admissible) {
    if (a === b || dominated.has(b.tier)) continue;
    let noWorse = a.priceCents <= b.priceCents, strict = a.priceCents < b.priceCents;
    for (const s of scenarios) {
      const fa = finish(a.tier, s.id), fb = finish(b.tier, s.id);
      if (fa == null || fb == null) { noWorse = false; break; }
      if (fa > fb) { noWorse = false; break; }
      if (fa < fb) strict = true;
    }
    if (noWorse && strict) dominated.add(b.tier);
  }
  const undominated = admissible.filter(o => !dominated.has(o.tier));

  // 6. Choice basis.
  let recommended = null, switching = null;
  const unknownOutcome = cheapest && finish(cheapest.tier, base) == null;
  if (!unknownOutcome && undominated.length === 1) {
    recommended = {tier: undominated[0].tier, basis: 'dominance'};
  } else if (!unknownOutcome && undominated.length > 1 && policy.valuePerDayCents) {
    // Economics: loss = spend + value × days late against the owner's target (or against the
    // earliest achievable finish when no target is set). Decided in the base scenario; other
    // scenarios give the switching condition.
    const winner = sid => {
      const ref = policy.targetOn ? toDay(policy.targetOn) : Math.min(...undominated.map(o => toDay(finish(o.tier, sid))));
      return undominated.reduce((best, o) => {
        const late = Math.max(0, toDay(finish(o.tier, sid)) - ref);
        const loss = o.priceCents + late * policy.valuePerDayCents;
        return !best || loss < best.loss ? {o, loss} : best;
      }, null).o;
    };
    const w = winner(base);
    recommended = {tier: w.tier, basis: 'economics'};
    const flip = scenarios.slice(1).find(s => winner(s.id).tier !== w.tier);
    if (flip) switching = `${winner(flip.id).tier} wins if ${flip.label}`;
  }
  // No preselection when nothing can be justified: options, break-even and the gap are shown instead.

  // 7. The question: the uncertain fact whose plausible values change the action or its basis.
  let question = null;
  for (const u of uncertain) {
    const results = u.plausible.map(v => {
      const sid = v === u.current ? base : `${u.nodeId}=${v}`;
      const sub = decideWithin(sid);
      return sub;
    });
    const flips = new Set(results.map(r => r && r.tier)).size > 1;
    if (flips || unknownOutcome) {
      question = {owner: u.owner, text: `${u.label}: which is it? (${u.plausible.join(' / ')})`, flips, nodeId: u.nodeId};
      break;
    }
  }
  function decideWithin(sid) {
    if (!cheapest) return null;
    const und = admissible.filter(a => !admissible.some(b => b !== a && b.priceCents <= a.priceCents && finish(b.tier, sid) != null && finish(a.tier, sid) != null && finish(b.tier, sid) <= finish(a.tier, sid) && (b.priceCents < a.priceCents || finish(b.tier, sid) < finish(a.tier, sid))));
    if (und.length === 1) return {tier: und[0].tier};
    if (und.length > 1 && policy.valuePerDayCents) {
      const ref = policy.targetOn ? toDay(policy.targetOn) : Math.min(...und.map(o => toDay(finish(o.tier, sid) || orderDate)));
      return und.reduce((best, o) => { const f = finish(o.tier, sid); if (!f) return best; const loss = o.priceCents + Math.max(0, toDay(f) - ref) * policy.valuePerDayCents; return !best || loss < best.loss ? {o, loss, tier: o.tier} : best; }, null);
    }
    return null;
  }

  // 8. Assumptions, with the age of each fact, plus the policy source.
  const stated = assumptions.map(a => a.ageDays == null ? a.text : `${a.text} (${a.ageDays === 0 ? 'today' : `${a.ageDays}d ago`})`);
  if (policy.valuePerDayCents) stated.push(`A day of ${milestoneId.replace(/^milestone:/, '')} is valued at $${(policy.valuePerDayCents / 100).toLocaleString('en-US')}${policy.owner ? ` (${policy.owner}'s policy)` : ''}`);
  else stated.push('No value-of-time policy set for this milestone; showing break-even only');
  if (pastCutoff) stated.push('The vendor cutoff has passed; production starts next business day');

  return {snapshotHash, options: summary, recommended, assumptions: stated, switching, question,
    unknowns: unknownBase, dominated: [...dominated], scenarios: scenarios.map(s => ({id: s.id, label: s.label})), outcomes};
}

/** One-paragraph card text for a DecisionResult, in the voice of the worked examples. */
export function explain(result, {milestoneLabel = 'the milestone'} = {}) {
  const rec = result.recommended && result.options.find(o => o.tier === result.recommended.tier);
  const cheapest = result.options.filter(o => o.admissible).reduce((a, b) => (!a || b.extraCents < a.extraCents ? b : a), null);
  if (!result.options.some(o => o.admissible)) return `No valid option: ${result.options[0]?.why || 'the quote cannot be used'}.`;
  if (!rec) {
    const gap = result.question ? ` It depends on ${result.question.text.split(':')[0].toLowerCase()}; ${result.question.owner} would know.` : '';
    const be = result.options.filter(o => o.breakEvenCentsPerDay).map(o => `${o.tier} at $${Math.round(o.breakEvenCentsPerDay / 100)}/day`).join(', ');
    return `Nothing to recommend yet.${gap}${be ? ` Break-even: ${be}.` : ''}`;
  }
  if (result.recommended.basis === 'dominance') {
    if (rec.tier === cheapest.tier) {
      const faster = result.options.filter(o => o.admissible && o.tier !== rec.tier && o.extraCents > 0);
      return faster.length ? `${rec.tier}: paying more buys no time for ${milestoneLabel}. ${faster.map(o => o.tier).join(' and ')} finish${faster.length === 1 ? 'es' : ''} it on the same day because another input gates it.` : `${rec.tier} is the only valid option.`;
    }
    return `${rec.tier} is better on both price and time than the alternatives.`;
  }
  const days = rec.deltaDays, be = rec.breakEvenCentsPerDay;
  return `${rec.tier} gets ${milestoneLabel} done ${days} day${days === 1 ? '' : 's'} sooner for +$${(rec.extraCents / 100).toLocaleString('en-US')}: worth it if a day is worth more than $${Math.round(be / 100)}.${result.switching ? ` ${result.switching}.` : ''}`;
}

export {toIso};
