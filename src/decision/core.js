// The decision core: pure functions from a planning snapshot to a DecisionResult.
// Implements architecture §7 (and HLD "How the recommendation is made"):
//   admissible options → same-world comparison across declared scenarios →
//   dominance → owner policy → economics, else break-even only; one question if a fact flips it.
// It never invents a dollar value, never turns unknown dates into estimates, and never
// prices people's time. Runs in Node and the browser.
import {analyzeGraph, toDay, toIso} from '../graph/engine.js';
import {makeCalendar} from '../graph/calendar.js';
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
  const {options, quote = {}, graph, partNodeId, milestoneId, orderDate, now, policy = {}, uncertain = [], assumptions = [], constraints = {}, calendar = null} = input;
  const snapshotHash = createHash(JSON.stringify({options, quote, graph, partNodeId, milestoneId, orderDate, policy, uncertain, constraints, calendar}));
  // With a company calendar, days gained and days late are working days (how the team counts them).
  const cal = calendar ? makeCalendar(calendar) : null;
  const gained = (later, earlier) => (cal ? cal.workingDaysBetween(toDay(earlier), toDay(later)) : daysBetween(earlier, later));
  const lateBy = (finishIso, refDay) => Math.max(0, cal ? cal.workingDaysBetween(refDay, toDay(finishIso)) : toDay(finishIso) - refDay);

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
      const a = analyzeGraph(graph, {orderDate, arrivals: {...s.arrivals, [partNodeId]: o.readyOn}, calendar});
      const m = a.at[milestoneId];
      outcomes[o.tier][s.id] = {finishOn: m?.finish ?? null, unknowns: a.unknown, blocked: a.blocked, drivenBy: m?.drivenBy ?? null, gatedBy: gateOf(graph, a.at, milestoneId, partNodeId)};
    }
  }

  // A hard owner target makes any option that misses it in the base world inadmissible (kept as reference).
  const hardMiss = o => policy.hard && policy.targetOn && (outcomes[o.tier][scenarios[0].id].finishOn == null || outcomes[o.tier][scenarios[0].id].finishOn > policy.targetOn);
  const whyFor = o => inadmissibleWhy || (hardMiss(o) ? `misses the hard deadline ${policy.targetOn}` : null);
  const admissible = options.filter(o => !whyFor(o));
  const cheapest = admissible.length ? admissible.reduce((a, b) => (b.priceCents < a.priceCents ? b : a)) : null;
  const finish = (tier, sid) => outcomes[tier][sid].finishOn;
  const base = scenarios[0].id;
  const unknownBase = cheapest ? outcomes[cheapest.tier][base].unknowns : [];

  // 4. Per-option summary in the base scenario: days gained vs the cheapest admissible option, break-even,
  //    and the latest placement date that still makes the owner's target.
  const summary = options.map(o => {
    const why = whyFor(o); const adm = !why;
    const f = finish(o.tier, base);
    const f0 = cheapest ? finish(cheapest.tier, base) : null;
    const deltaDays = adm && f && f0 ? gained(f0, f) : null;
    const extraCents = cheapest ? o.priceCents - cheapest.priceCents : 0;
    const gatedBy = outcomes[o.tier][base].gatedBy;
    const missesTarget = !!(policy.targetOn && f && f > policy.targetOn);
    return {tier: o.tier, admissible: adm, ...(adm ? {} : {why}), readyOn: o.readyOn, finishOn: f, deltaDays, extraCents, gatedBy, ...(missesTarget ? {lateByTarget: true} : {}),
      breakEvenCentsPerDay: deltaDays && deltaDays > 0 && extraCents > 0 ? Math.round(extraCents / deltaDays) : null, ...latestOrder(o)};
  });

  // Latest placement: the last order day D >= orderDate on which the part, re-derived from the quote's
  // production and shipping days exactly as the vendor derives it (Mon–Fri shop, ordered before the cutoff
  // on D: D + mfgDays business days + shipDays calendar days), still lets the milestone make the owner's
  // target in the base scenario. Only known for options that carry mfgDays/shipDays and when a target is set.
  function latestOrder(o) {
    const none = {orderBy: null, slackDays: null};
    if (!policy.targetOn || !Number.isFinite(o.mfgDays) || !Number.isFinite(o.shipDays)) return none;
    const shop = makeCalendar({}); // the vendor's business days: weekdays, no company holidays
    const readyFrom = d => toIso(shop.addWorkingDays(d, o.mfgDays) + o.shipDays);
    const orderDay = toDay(orderDate);
    let last = null, first = true;
    for (let d = orderDay; d <= orderDay + 90; d++) {
      if (cal && !cal.isWorking(d)) continue; // an order placed on a closed day is the next working day's order
      const a = analyzeGraph(graph, {orderDate, arrivals: {...scenarios[0].arrivals, [partNodeId]: readyFrom(d)}, calendar});
      const m = a.at[milestoneId]?.finish ?? null;
      if (m == null) return none; // unknown finish: nothing can be promised
      if (m > policy.targetOn) { if (first) return {...none, missesTarget: true}; break; } // a later order never finishes earlier
      last = d; first = false;
    }
    return {orderBy: toIso(last), slackDays: cal ? cal.workingDaysBetween(orderDay, last) : last - orderDay};
  }

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
        const loss = o.priceCents + lateBy(finish(o.tier, sid), ref) * policy.valuePerDayCents;
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
      return und.reduce((best, o) => { const f = finish(o.tier, sid); if (!f) return best; const loss = o.priceCents + lateBy(f, ref) * policy.valuePerDayCents; return !best || loss < best.loss ? {o, loss, tier: o.tier} : best; }, null);
    }
    return null;
  }

  // While the flip question is open nothing is preselected: the tentative answer is kept separately.
  let tentative = null;
  if (question?.flips && recommended) { tentative = recommended; recommended = null; }

  // 8. Assumptions, with the age of each fact, plus the policy source.
  const stated = assumptions.map(a => a.ageDays == null ? a.text : `${a.text} (${a.ageDays === 0 ? 'today' : `${a.ageDays}d ago`})`);
  if (policy.valuePerDayCents) stated.push(`A day of ${milestoneId.replace(/^milestone:/, '')} is valued at $${(policy.valuePerDayCents / 100).toLocaleString('en-US')}${policy.owner ? ` (${policy.owner}'s policy)` : ''}`);
  else stated.push('No value-of-time policy set for this milestone; showing break-even only');
  if (pastCutoff) stated.push('The vendor cutoff has passed; production starts next business day');

  return {snapshotHash, options: summary, recommended, tentative, assumptions: stated, switching, question, workingDays: !!cal,
    unknowns: unknownBase, dominated: [...dominated], scenarios: scenarios.map(s => ({id: s.id, label: s.label})), outcomes};
}

// The input that sets the milestone's date for this option: walk back from the milestone through what drove
// each start to the first part that is not the one being ordered (a sibling delivery or a booked rig). Null when
// the ordered part itself sets the date.
function gateOf(graph, at, milestoneId, partNodeId) {
  let id = milestoneId;
  for (let i = 0; id && i < 30; i++) {
    const n = graph.nodes.find(x => x.id === id); if (!n) return null;
    if (n.kind === 'part') return id === partNodeId ? null : n.label;
    const prev = at[id]?.drivenBy || graph.edges.filter(e => e.to === id && at[e.from]?.finish != null).sort((a, b) => at[b.from].finish.localeCompare(at[a.from].finish))[0]?.from || null;
    id = prev;
  }
  return null;
}

/** One-paragraph card text for a DecisionResult, in the voice of the worked examples. */
export function explain(result, {milestoneLabel = 'the milestone'} = {}) {
  const rec = result.recommended && result.options.find(o => o.tier === result.recommended.tier);
  const cheapest = result.options.filter(o => o.admissible).reduce((a, b) => (!a || b.extraCents < a.extraCents ? b : a), null);
  if (!result.options.some(o => o.admissible)) return `No valid option: ${result.options[0]?.why || 'the quote cannot be used'}.`;
  if (!rec && result.question?.flips && result.tentative) {
    const t = result.options.find(o => o.tier === result.tentative.tier);
    return `Leaning ${t.tier}, but it hinges on ${result.question.text.split(':')[0].toLowerCase()}: ${result.question.owner} would know. ${result.switching ? result.switching + '.' : ''}`.trim();
  }
  if (!rec) {
    const be = result.options.filter(o => o.breakEvenCentsPerDay).map(o => `${o.tier} at $${Math.round(o.breakEvenCentsPerDay / 100)}/day`).join(', ');
    if (result.question?.flips) return `Nothing to recommend yet: it depends on ${result.question.text.split(':')[0].toLowerCase()}, and ${result.question.owner} would know.${be ? ` Break-even: ${be}.` : ''}`;
    if (result.unknowns?.length) return `Nothing to recommend yet: ${milestoneLabel}'s date is unknown because an input has no stated duration.${be ? ` Break-even: ${be}.` : ''}`;
    return `Real trade-off, and no value-of-time policy is set for ${milestoneLabel}, so pick by break-even: ${be || 'none'}.`;
  }
  // The recommended tier's placement window, when the order can wait past the day of the decision.
  const wait = rec.orderBy && rec.slackDays > 0 ? `, and it can wait until ${monthDay(rec.orderBy)} to be placed` : '';
  if (result.recommended.basis === 'dominance') {
    if (rec.tier === cheapest.tier) {
      const faster = result.options.filter(o => o.admissible && o.tier !== rec.tier && o.extraCents > 0);
      const gate = faster.map(o => o.gatedBy).find(Boolean);
      return faster.length ? `${rec.tier}: paying more buys no time for ${milestoneLabel}${wait}. ${faster.map(o => o.tier).join(' and ')} finish${faster.length === 1 ? 'es' : ''} it on the same day because ${gate ? `${gate} gates it` : 'another input gates it'}.` : `${rec.tier} is the only valid option${wait}.`;
    }
    return `${rec.tier} is better on both price and time than the alternatives${wait}.`;
  }
  const days = rec.deltaDays, be = rec.breakEvenCentsPerDay, unit = result.workingDays ? 'working day' : 'day';
  return `${rec.tier} gets ${milestoneLabel} done ${days} ${unit}${days === 1 ? '' : 's'} sooner for +$${(rec.extraCents / 100).toLocaleString('en-US')}: worth it if a day is worth more than $${Math.round(be / 100)}${wait}.${result.switching ? ` ${result.switching}.` : ''}`;
}

const monthDay = iso => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', {month: 'short', day: 'numeric', timeZone: 'UTC'});

export {toIso};
