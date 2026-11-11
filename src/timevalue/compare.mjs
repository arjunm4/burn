// Compare quote tiers by when the test finishes (architecture §7 "Comparison").
//
// Each tier's ready date replaces the quoted part's ready date; the other inputs keep theirs. An input whose
// ready is {min, max} is uncertain: we solve its endpoints and every wd between, and report the switching
// date (the last ready date at which the answer at `min` still holds).
//
//   days_saved[tier] = wd between the tier's finish and the cheapest tier's finish (ΔT, >= 0)
//   break_even       = extra $ over the cheapest / days_saved (null when nothing is saved)
//   per_day policy   : value = $/day x days saved
//   curve policy     : value = cost(days late of cheapest) - cost(days late of tier), days late vs target;
//                      cost(d) = usd of the largest curve point with days_late <= d (no interpolation: we
//                      never invent a $ figure between the owner's points)
//   no policy        : "ask_owner" with the break-even, unless no tier saves time ("cheapest")
import { makeCalendar, toDate } from './calendar.mjs';
import { solve } from './solve.mjs';

const CONFIDENT = new Set(['cheapest', 'pay', 'dont_pay']);
const usd = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const fmtDay = (date) => {
  const d = new Date(`${date}T00:00:00Z`);
  return `${DOW[d.getUTCDay()]} ${MONTH[d.getUTCMonth()]} ${d.getUTCDate()}`;
};

function curveCost(curve, daysLate) {
  let cost = 0;
  for (const p of [...curve].sort((a, b) => a.days_late - b.days_late)) if (p.days_late <= daysLate) cost = p.usd;
  return cost;
}

const hasPolicy = (p) => p && ((p.type === 'per_day' && p.usd_per_day > 0) || (p.type === 'curve' && p.curve?.length));

// One scenario: fixed ready dates for every input.
function evaluate(cal, { quote, test, inputs, part, milestone }) {
  const target = toDate(milestone?.target);
  const policy = hasPolicy(milestone?.policy) ? milestone.policy : null;
  const rows = quote.map((q) => {
    const s = solve({ cal, test, inputs: [...inputs, { id: part, ready: q.ready }] });
    return { tier: q.tier, total: q.total, ...s, days_late: target && s.finish ? Math.max(0, cal.wdBetween(target, s.finish)) : null };
  });
  const cheap = rows[0];
  if (rows.some((r) => !r.finish)) {
    const bad = rows.find((r) => !r.finish);
    return { rows, outcome: 'blocked', best: null, reason: `cannot schedule: ${bad.limiter.kind} ${bad.limiter.id ?? ''} unknown`.trim() };
  }
  for (const r of rows) {
    r.extra = r.total - cheap.total;
    r.days_saved = Math.max(0, cal.wdBetween(r.finish, cheap.finish));
    r.break_even = r !== cheap && r.days_saved > 0 ? r.extra / r.days_saved : null;
    r.value = null;
    if (policy?.type === 'per_day') r.value = policy.usd_per_day * r.days_saved;
    if (policy?.type === 'curve' && target) r.value = curveCost(policy.curve, cheap.days_late) - curveCost(policy.curve, r.days_late);
    r.net = r.value == null ? null : r.value - r.extra;
  }
  const gainers = rows.filter((r) => r !== cheap && r.days_saved > 0);
  if (!gainers.length) return { rows, outcome: 'cheapest', best: cheap };
  if (!policy || (policy.type === 'curve' && !target)) {
    return { rows, outcome: 'ask_owner', best: gainers.sort((a, b) => a.break_even - b.break_even)[0] };
  }
  let best = cheap;
  for (const r of gainers) if (r.net > (best.net ?? 0)) best = r; // ties keep the cheaper tier
  return { rows, outcome: best === cheap ? 'dont_pay' : 'pay', best };
}

export function compare({ holidays = [], quote, test, inputs = [], milestone = null, now, part = 'quoted_part', quoteValidUntil = null }) {
  const cal = makeCalendar(holidays);
  const tiers = [...quote].sort((a, b) => a.total - b.total);
  const policy = hasPolicy(milestone?.policy) ? milestone.policy : null;
  const value = policy ? { type: policy.type, usd_per_day: policy.usd_per_day ?? null, curve: policy.curve ?? null, by: policy.by ?? null } : null;
  const nowDate = toDate(now);

  const ranged = inputs.filter((i) => i.ready && typeof i.ready === 'object');
  const fixed = inputs.filter((i) => !ranged.includes(i));
  const run = (pick) => evaluate(cal, { quote: tiers, test, part, milestone, inputs: [...fixed, ...ranged.map((i) => ({ id: i.id, ready: pick[i.id] }))] });

  // Scenarios: one ('base'), or the endpoints of every ranged input (+ the switching date when exactly one).
  let scenarios;
  let switching = null;
  if (!ranged.length) scenarios = [{ label: 'base', pick: {}, res: run({}) }];
  else if (ranged.length === 1) {
    const inp = ranged[0];
    const lo = toDate(inp.ready.min);
    const hi = toDate(inp.ready.max);
    const at = (d) => ({ label: d, pick: { [inp.id]: d }, res: run({ [inp.id]: d }) });
    const first = { ...at(lo), label: 'min' };
    const last = { ...at(hi), label: 'max' };
    scenarios = [first];
    if (first.res.outcome !== last.res.outcome) {
      let by = lo;
      for (let d = cal.nextWd(lo); d < hi; d = cal.nextWd(d)) {
        if (run({ [inp.id]: d }).outcome !== first.res.outcome) break;
        by = d;
      }
      switching = { input: inp.id, by_date: by };
      if (by !== lo) scenarios.push({ ...at(by), label: 'switch' });
    }
    scenarios.push(last);
  } else {
    scenarios = [{}];
    for (const i of ranged) scenarios = scenarios.flatMap((p) => [{ ...p, [i.id]: toDate(i.ready.min) }, { ...p, [i.id]: toDate(i.ready.max) }]);
    scenarios = scenarios.map((pick) => ({ label: ranged.map((i) => `${i.id}=${pick[i.id]}`).join(','), pick, res: run(pick) }));
  }

  const single = scenarios.length === 1;
  const outTiers = tiers.map((q, k) => {
    const by = Object.fromEntries(scenarios.map((s) => {
      const r = s.res.rows[k];
      return [s.label, { finish: r.finish, start: r.start, days_saved: r.days_saved ?? null, days_late: r.days_late, break_even: r.break_even ?? null, value: r.value ?? null, net: r.net ?? null, limiter: r.limiter }];
    }));
    const base = by[scenarios[0].label];
    return {
      tier: q.tier, total: q.total, ready: q.ready,
      finish_by_scenario: Object.fromEntries(Object.entries(by).map(([l, v]) => [l, v.finish])),
      days_saved: single ? base.days_saved : null,
      break_even: single ? base.break_even : null,
      by_scenario: by,
    };
  });

  const outcomes = new Set(scenarios.map((s) => s.res.outcome));
  let outcome = outcomes.size === 1 ? scenarios[0].res.outcome : 'depends';
  if (outcomes.has('blocked')) outcome = 'blocked';
  let reason = scenarios.find((s) => s.res.reason)?.res.reason ?? null;
  if (quoteValidUntil && nowDate && nowDate > toDate(quoteValidUntil)) { outcome = 'blocked'; reason = `quote expired ${quoteValidUntil}`; }

  const best = outcome === 'blocked' || outcome === 'depends' ? null : scenarios[0].res.best;
  const recommended = CONFIDENT.has(outcome) ? best.tier : null;
  let limiter = best?.limiter ?? scenarios[0].res.rows[0].limiter;
  if (outcome === 'depends') limiter = { kind: 'input', id: switching?.input ?? ranged[0].id };

  let question = null;
  if (outcome === 'depends' && switching) {
    const inp = ranged.find((i) => i.id === switching.input);
    const win = scenarios[0].res.best;
    question = {
      to: inp.owner ?? inp.said_by ?? null,
      text: `Will ${inp.name ?? inp.id} be ready by ${fmtDay(switching.by_date)}? If yes, ${win.tier} is worth it; if later, ${tiers[0].tier} is as good.`,
    };
  } else if (outcome === 'ask_owner') {
    question = {
      to: milestone?.owner ?? null,
      text: `Is a day on ${milestone?.name ?? 'this milestone'} worth more than ${usd(best.break_even)}? ${best.tier} saves ${best.days_saved} working day${best.days_saved === 1 ? '' : 's'} for ${usd(best.extra)} more.`,
    };
  }

  return { tiers: outTiers, outcome, recommended, limiter, switching, question, value, reason, scenarios: scenarios.map((s) => ({ label: s.label, ready: s.pick, outcome: s.res.outcome })) };
}
