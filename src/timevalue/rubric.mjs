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

export function rubric(c, { quoteValidUntil = null, now, facts = [], conversation = null } = {}) {
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

  const convo = conversation ? conversationCheck(c, conversation, { facts, decision }) : null;
  if (convo) checks.push({ n: checks.length + 1, ...convo });

  const digits = (s) => String(s).replace(/,/g, '');
  const guards = [
    { rule: 'no invented $/day', ok: c.value?.usd_per_day == null || facts.some((f) => f.about === 'value' && new RegExp(`(^|\\D)${c.value.usd_per_day}(\\D|$)`).test(digits(f.text))) },
    { rule: 'no fact after now', ok: facts.every((f) => f.at && now && Date.parse(f.at) <= Date.parse(now)) },
    { rule: 'every fact has a source', ok: facts.every((f) => f.doc_id && f.by) },
    // Check 7 is advisory: only a decision-critical conflict (sub-item with blocks) counts as an open gap.
    { rule: 'no confident card with an open gap', ok: !(CONFIDENT.has(c.outcome) && checks.some((k) => (k.advisory ? k.items.some((i) => i.blocks) : k.status === 'unknown' || k.status === 'fail'))) },
  ];
  const blocked = c.outcome === 'blocked' || expired === true || guards.some((g) => !g.ok);
  return { checks, guards, blocked };
}

// ---------------------------------------------------------------- check 7: what the conversation says
//
// Advisory (Owen, 2026-11-10): it can add a question or a warning, never change days saved, $/day or the tier.
// Every sub-item must cite doc_ids or it is dropped. The server computes the inputs from the LLM reads + graph:
//   conversation = {
//     target, test_owner,                                    // milestone target date; who to ask about (a)
//     earlier_need: [{doc_id, by, at, pressure, relative, need_earlier}],  // linked reads, last 3 days, flagged
//     conflicts: [{subject, name, owner, kind, values: [{value, by, at, doc_id, status}]}],  // accepted/disputed, window
//     pressure: {level: low|elevated|high, n, snippets: [{doc_id, text}]},  // last 7 days of linked context
//   }
const RANK = { fail: 3, unknown: 2, pass: 1, info: 0 };
const valueText = (v) => (v && typeof v === 'object' ? `${v.min}–${v.max}` : String(v));

export function conversationCheck(c, conv, { facts = [], decision = '' } = {}) {
  const items = [];
  const cited = (it) => it.sources.length > 0 && items.push(it);

  // a. Hidden earlier need: urgent talk while the cheapest tier still meets the target.
  const cheapest = c.tiers?.[0];
  const cheapFinish = cheapest ? Object.values(cheapest.finish_by_scenario || {}).filter(Boolean).sort().at(-1) : null;
  const slack = conv.target && cheapFinish && cheapFinish <= conv.target;
  if (slack && conv.earlier_need?.length) {
    cited({ key: 'earlier_need', status: 'unknown', text: `Urgent talk in the last 3 days, but ${cheapest.tier} already finishes by the target.`,
      question: { to: conv.test_owner ?? null, text: 'Is there an earlier need, e.g. a test slot?' }, sources: conv.earlier_need.map((r) => r.doc_id) });
  }

  // b. Conflicts: different values for the same input from different people or sources.
  const critical = new Set([c.limiter?.kind === 'input' ? c.limiter.id : null, c.switching?.input].filter(Boolean));
  for (const k of conv.conflicts || []) {
    const blocks = critical.has(k.subject);
    cited({ key: 'conflict', status: 'fail', blocks,
      text: `Sources disagree on ${k.name || k.subject}: ${k.values.map((v) => `${valueText(v.value)} (${v.by ?? 'unknown'})`).join(' vs ')}.${blocks ? ' It sets the decision, so the card is not confident.' : ''}`,
      question: { to: k.owner ?? null, text: `Which date is right for ${k.name || k.subject}: ${k.values.map((v) => valueText(v.value)).join(' or ')}?` },
      sources: k.values.map((v) => v.doc_id).filter(Boolean) });
  }

  // c. Pressure read over the last 7 days.
  const p = conv.pressure;
  if (p) cited({ key: 'pressure', status: 'info', text: `Pressure ${p.level} over the last 7 days (${p.n} linked message${p.n === 1 ? '' : 's'})${p.snippets.length ? `: ${p.snippets.map((x) => `"${x.text}"`).join('; ')}` : ''}.`,
    sources: p.snippets.map((x) => x.doc_id) });

  // e. Plain-English reason from cited facts already on the card (no new numbers).
  const lim = facts.filter((f) => f.about === 'limiter' && f.doc_id);
  if (lim.length && decision) {
    const f = lim.at(-1);
    cited({ key: 'reason', status: 'info', text: `${f.text}, so ${decision.charAt(0).toLowerCase()}${decision.slice(1)}`, sources: [f.doc_id] });
  }

  if (!items.length) return null;
  const status = items.reduce((s, i) => (RANK[i.status] > RANK[s] ? i.status : s), 'info');
  return { label: 'What the conversation says · from the LLM read', status, advisory: true, items,
    text: items.map((i) => i.text).join(' '), sources: [...new Set(items.flatMap((i) => i.sources))] };
}
