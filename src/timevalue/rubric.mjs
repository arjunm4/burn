// The card's rubric: numbered checks with their sources, plus guards that block a card which would invent
// a number, cite the future, cite nothing, or sound confident with an open gap.
//
// facts: [{text, by, at, doc_id, about?}]; `about` (quote | schedule | limiter | value | decision) attaches a
// fact to that check as a source.
import { toDate } from './calendar.mjs';
import { fmtDay } from './compare.mjs';

const CONFIDENT = new Set(['cheapest', 'pay', 'dont_pay']);
const usd = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function limiterText(l) {
  if (!l) return 'unknown';
  if (l.kind === 'input') return `waiting on ${l.id}`;
  if (l.kind === 'planned_start') return 'the planned start date';
  if (l.kind === 'slot') return l.id === 'slot_days' ? "the rig's slot days" : `a rig booking (${l.id})`;
  if (l.kind === 'owner_out') return 'the test owner being out';
  return l.kind;
}

export function rubric(c, { quoteValidUntil = null, now, facts = [] } = {}) {
  const src = (about) => facts.filter((f) => f.about === about).map((f) => f.doc_id);
  const nowDate = toDate(now);
  const checks = [];
  const add = (label, status, text, about) => checks.push({ n: checks.length + 1, label, status, text, sources: src(about) });

  const expired = quoteValidUntil && nowDate ? nowDate > toDate(quoteValidUntil) : null;
  add('Quote is open', expired == null ? 'unknown' : expired ? 'fail' : 'pass',
    expired == null ? 'No expiry date on the quote.' : expired ? `Quote expired ${quoteValidUntil}.` : `Valid until ${quoteValidUntil}.`, 'quote');

  const finishes = c.tiers.flatMap((t) => Object.values(t.finish_by_scenario));
  add('Schedule solved', finishes.every(Boolean) ? 'pass' : 'unknown',
    finishes.every(Boolean)
      ? c.tiers.map((t) => `${t.tier} done ${Object.values(t.finish_by_scenario).map(fmtDay).join(' / ')}`).join('; ')
      : `Cannot schedule: ${c.reason ?? 'a date or duration is unknown'}.`, 'schedule');

  add('What sets the date', 'info', `The test is ${limiterText(c.limiter)}.`, 'limiter');

  const gain = c.tiers.slice(1).find((t) => t.days_saved > 0);
  let valueStatus = 'pass';
  let valueText;
  if (c.value?.type === 'per_day') valueText = `${usd(c.value.usd_per_day)}/day${c.value.by ? ` (set by ${c.value.by})` : ''}.`;
  else if (c.value?.type === 'curve') valueText = `Owner's lateness curve${c.value.by ? ` (set by ${c.value.by})` : ''}.`;
  else if (c.outcome === 'cheapest') { valueStatus = 'info'; valueText = 'Not needed: no tier saves time.'; }
  else { valueStatus = 'unknown'; valueText = gain ? `No $/day set. Break-even ${usd(gain.break_even)}/day.` : 'No $/day set.'; }
  add('Value of a day', valueStatus, valueText, 'value');

  let decision;
  const rec = c.tiers.find((t) => t.tier === c.recommended);
  if (c.outcome === 'blocked') decision = `Blocked: ${c.reason ?? 'missing input'}.`;
  else if (c.outcome === 'cheapest') decision = `${c.recommended}: no faster tier finishes the test sooner.`;
  else if (c.outcome === 'pay') decision = `${c.recommended}: saves ${plural(rec.days_saved, 'working day')}, worth it above ${usd(rec.break_even)}/day.`;
  else if (c.outcome === 'dont_pay') decision = `${c.recommended}: the time saved is worth less than the extra cost.`;
  else if (c.outcome === 'depends') decision = `Depends on ${c.switching.input} being ready by ${fmtDay(c.switching.by_date)}.`;
  else decision = c.question?.text ?? 'Ask the owner.';
  add('Decision', 'info', decision, 'decision');

  const digits = (s) => String(s).replace(/,/g, '');
  const guards = [
    { rule: 'no invented $/day', ok: c.value?.usd_per_day == null || facts.some((f) => f.about === 'value' && new RegExp(`(^|\\D)${c.value.usd_per_day}(\\D|$)`).test(digits(f.text))) },
    { rule: 'no fact after now', ok: facts.every((f) => f.at && now && Date.parse(f.at) <= Date.parse(now)) },
    { rule: 'every fact has a source', ok: facts.every((f) => f.doc_id && f.by) },
    { rule: 'no confident card with an open gap', ok: !(CONFIDENT.has(c.outcome) && checks.some((k) => k.status === 'unknown' || k.status === 'fail')) },
  ];
  const blocked = c.outcome === 'blocked' || expired === true || guards.some((g) => !g.ok);
  return { checks, guards, blocked };
}
