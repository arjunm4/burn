// Code-only claim extraction (regex over hardware phrasing). No model call.
//
//   extractClaims(doc, resolve, opts?) -> [{kind, subject, value, doc_id, by, at, for_use?, qty?, token, mode}]
//
// kind: needs | eta | done | blocked | need_earlier | duration
//   needs         subject = part/deliverable, value = date | {min,max} | null (the need-by), for_use = test/work id, qty
//   eta           subject = deliverable/part/test/milestone, value = date | {min,max}
//   done          subject = work/test/part, value = date (default: the doc's day)
//   blocked       subject = the thing waiting, value = the id it waits on
//   need_earlier  subject = part/deliverable, value = date | null
//   duration      subject = test/work, value = days | {min,max}
// `by` = settings person id when the author is known (email / slack id / name), else the author's name.
// Relative dates ("tues the 24th", "thurs", "EOW", "next week", "11/30", "the twentieth") resolve against doc.at
// in Pacific time.

import { addDays, dow, ymd, isDate } from '../../src/timevalue/calendar.mjs';
import { localDay } from './sources.mjs';

const WD = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 };
const MON = { jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12 };
const ORD_UNITS = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9 };
const ORD_WORDS = { ...ORD_UNITS, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20, thirtieth: 30 };
const NUM_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, a: 1, couple: 2, few: 3 };

const WDRE = '(?:mon(?:day)?|tue(?:s(?:day)?)?|wed(?:s|nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)';
const MONRE = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const ORDRE = `(?:(?:twenty|thirty)[- ]?(?:${Object.keys(ORD_UNITS).join('|')})|${Object.keys(ORD_WORDS).join('|')})`;
// One date expression. Order matters: most specific first.
const DATE_SRC = [
  '\\d{4}-\\d{2}-\\d{2}',
  `(?:${WDRE}\\.?,?\\s+)?\\d{1,2}\\/\\d{1,2}(?:\\/\\d{2,4})?`,
  `(?:${WDRE}\\.?,?\\s+)?${MONRE}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?`,
  `(?:${WDRE}\\.?,?\\s+)?(?:the\\s+)?\\d{1,2}(?:st|nd|rd|th)`,
  `(?:${WDRE}\\.?,?\\s+)?the\\s+${ORDRE}`,
  '(?:the\\s+)?week\\s+of\\s+(?:the\\s+)?(?:\\d{1,2}\\/\\d{1,2}|\\d{1,2}(?:st|nd|rd|th)|' + ORDRE + ')',
  '(?:end\\s+of\\s+(?:the\\s+)?(?:next\\s+)?week|eow|eod|eom|end\\s+of\\s+(?:the\\s+)?month|end\\s+of\\s+day|tomorrow|today|tonight|next\\s+week|this\\s+week|early\\s+next\\s+week|late\\s+next\\s+week|mid\\s*-?\\s*next\\s+week)',
  `(?:next\\s+|this\\s+|on\\s+)?${WDRE}\\b`,
].join('|');
const DATE_RE = new RegExp(`(?<![\\w/])(?:${DATE_SRC})(?![\\w/])`, 'i');
const DATE_RE_G = new RegExp(DATE_RE.source, 'gi');

const absDays = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 864e5;

/**
 * Parse one date expression against a reference day ("YYYY-MM-DD").
 * dir: "future" (need-by, ETA) prefers the next occurrence; "past" (done) the last one.
 * Returns "YYYY-MM-DD" | {min, max} | null.
 */
export function parseDate(expr, refDay, dir = 'future') {
  if (!isDate(refDay) || expr == null) return null;
  let s = String(expr).toLowerCase().replace(/\s+/g, ' ').trim();
  const y0 = +refDay.slice(0, 4), m0 = +refDay.slice(5, 7);
  let m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) return s;
  let wd = null;
  if ((m = s.match(new RegExp(`^(${WDRE})\\.?,?\\s+(.*)$`)))) { const w = m[1].replace(/s$/, (x) => (WD[m[1]] != null ? x : '')); wd = WD[m[1]] ?? WD[w]; s = m[2]; }
  // m/d(/yy)
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/))) {
    const mo = +m[1], d = +m[2];
    if (m[3]) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; return ymd(y, mo, d); }
    const cands = [y0 - 1, y0, y0 + 1].map((y) => ymd(y, mo, d)).filter(Boolean);
    return closest(cands, refDay, dir, 120);
  }
  if ((m = s.match(new RegExp(`^(${MONRE})\\.? (\\d{1,2})(?:st|nd|rd|th)?$`)))) {
    const mo = MON[m[1]] || MON[m[1].slice(0, 3)], d = +m[2];
    return closest([y0 - 1, y0, y0 + 1].map((y) => ymd(y, mo, d)).filter(Boolean), refDay, dir, 120);
  }
  const dayOfMonth = (str) => {
    let q;
    if ((q = str.match(/^(?:the )?(\d{1,2})(?:st|nd|rd|th)$/))) return +q[1];
    if ((q = str.match(new RegExp(`^the (${ORDRE})$`)))) return ordinal(q[1]);
    return null;
  };
  const dm = dayOfMonth(s);
  if (dm) {
    const cands = [];
    for (let k = -1; k <= 1; k++) { let y = y0, mo = m0 + k; if (mo < 1) { mo = 12; y--; } if (mo > 12) { mo = 1; y++; } const c = ymd(y, mo, dm); if (c) cands.push(c); }
    const withWd = wd == null ? cands : cands.filter((c) => dow(c) === wd);
    return closest(withWd.length ? withWd : cands, refDay, dir, 45, 1);
  }
  if ((m = s.match(/^(?:the )?week of (?:the )?(.+)$/))) {
    const start = parseDate(m[1], refDay, 'future') || parseDate('the ' + m[1], refDay, 'future');
    return typeof start === 'string' ? { min: start, max: addDays(start, 4) } : null;
  }
  const mondayOf = (d) => addDays(d, -((dow(d) + 6) % 7));
  const thisMon = mondayOf(refDay), nextMon = addDays(thisMon, 7);
  switch (s) {
    case 'today': case 'tonight': case 'eod': case 'end of day': return refDay;
    case 'tomorrow': return addDays(refDay, 1);
    case 'eow': case 'end of week': case 'end of the week': case 'this week': return dow(refDay) === 6 || dow(refDay) === 0 ? addDays(nextMon, 4) : addDays(thisMon, 4);
    case 'end of next week': case 'end of the next week': case 'late next week': return addDays(nextMon, 4);
    case 'next week': return { min: nextMon, max: addDays(nextMon, 4) };
    case 'early next week': return { min: nextMon, max: addDays(nextMon, 1) };
    case 'mid next week': case 'mid-next week': case 'mid - next week': return addDays(nextMon, 2);
    case 'eom': case 'end of month': case 'end of the month': { const y = y0, mo = m0; return ymd(y, mo, new Date(Date.UTC(y, mo, 0)).getUTCDate()); }
  }
  if ((m = s.match(new RegExp(`^(next |this |on )?(${WDRE})$`)))) {
    const w = WD[m[2]]; if (w == null) return null;
    if (m[1] === 'next ') return addDays(nextMon, (w + 6) % 7);
    if (dir === 'past') { let d = refDay; for (let i = 0; i < 7; i++, d = addDays(d, -1)) if (dow(d) === w) return d; }
    let d = refDay; for (let i = 0; i < 7; i++, d = addDays(d, 1)) if (dow(d) === w) return d;
  }
  return null;
}
function ordinal(w) {
  w = w.replace(/[- ]/g, ' ');
  if (ORD_WORDS[w]) return ORD_WORDS[w];
  const q = w.match(/^(twenty|thirty) (\w+)$/); if (q) return (q[1] === 'twenty' ? 20 : 30) + (ORD_UNITS[q[2]] || 0);
  return null;
}
function closest(cands, refDay, dir, horizon, slackDays = 7) {
  if (!cands.length) return null;
  // Prefer dates on the expected side within a short slack (people write a date a few days stale), else nearest.
  const pref = cands.filter((c) => (dir === 'past' ? Date.parse(c) <= Date.parse(refDay) + 3 * 864e5 : Date.parse(c) >= Date.parse(refDay) - slackDays * 864e5) && absDays(c, refDay) <= horizon * 2);
  const pool = pref.length ? pref : cands;
  return pool.reduce((a, b) => (absDays(b, refDay) < absDays(a, refDay) ? b : a));
}

/** Every date expression in a string with its span. */
function findDates(text, refDay, dir) {
  const out = [];
  for (const m of text.matchAll(DATE_RE_G)) {
    // "on mon" etc. alone are weak; a bare weekday word like "may" (month) is excluded by the regex.
    const v = parseDate(m[0].replace(/^on /i, ''), refDay, dir);
    if (v) out.push({ value: v, start: m.index, end: m.index + m[0].length, text: m[0] });
  }
  return out;
}

// Parts, deliverables and rigs feed work items, work items feed tests, tests feed milestones.
const RANK = { part: 0, deliverable: 0, rig: 0, work: 1, test: 2, milestone: 3 };

/** Resolve the doc's author to a settings person id (or the author's name). */
export function authorId(author, people) {
  if (!author) return null;
  const p = (people || []).find((x) => (author.email && x.email === author.email) || (author.slack_id && x.slack_id === author.slack_id) || (author.name && x.name === author.name));
  return p ? p.id : author.name || author.email || author.slack_id || null;
}

function splitClauses(text) {
  const out = []; let pos = 0;
  for (const m of (text + '\n').matchAll(/(?:\n+|(?<=[a-z0-9)])[.;!?](?:\s+|$)(?=\S|$))/gi)) { out.push({ s: text.slice(pos, m.index), off: pos }); pos = m.index + m[0].length; }
  if (pos < text.length) out.push({ s: text.slice(pos), off: pos });
  return out.filter((c) => c.s.trim());
}

export function extractClaims(doc, resolve, opts = {}) { // opts: {people, recent: [ids named shortly before in the thread/channel]}
  if (typeof resolve !== 'function') throw new TypeError('extractClaims: resolve must be a resolver from makeResolver()');
  const text = doc?.text || '';
  if (!text.trim()) return [];
  const refDay = localDay(doc.at);
  if (!refDay) return []; // no reference day: relative dates cannot be resolved, so nothing is claimed
  const by = authorId(doc.author, opts.people || resolve.people);
  const refsAll = resolve(text, { container: doc.container, at: doc.at, recent: opts.recent }).filter((r) => !r.ambiguous || opts.keepAmbiguous);
  const out = [];
  const base = { doc_id: doc.id, by, at: doc.at };
  let carry = null; // the last thing talked about, for "Realistic date is the twentieth." after "On the motor, ..."
  // Keyword and date matching run on text with the resolved names masked ("...spin test complete" is a name, not "done").
  let masked = text;
  for (const r of refsAll) masked = masked.slice(0, r.start) + masked.slice(r.start, r.end).replace(/[^\s]/g, '_') + masked.slice(r.end);
  for (const { s: raw, off } of splitClauses(text)) {
    const s = masked.slice(off, off + raw.length);
    let refs = refsAll.filter((r) => r.start >= off && r.end <= off + s.length).map((r) => ({ ...r, start: r.start - off, end: r.end - off }));
    if (!refs.length && carry && !/\b(?:test|build|review|gate|milestone|rig|stand)\b/i.test(s)) refs = [{ ...carry, start: -1, end: -1, carried: true }];
    if (!refs.length) continue;
    carry = refs.find((r) => r.kind === 'deliverable' || r.kind === 'part') || refs[0];
    const low = s.toLowerCase();
    const items = refs.filter((r) => r.kind === 'part' || r.kind === 'deliverable');
    const uses = refs.filter((r) => r.kind === 'work' || r.kind === 'test');
    const firstOf = (list, after = -1) => list.find((r) => r.start > after) || list[0];
    const push = (c, r) => out.push({ ...c, ...base, token: r?.token ?? null, mode: r?.mode ?? null });

    // need earlier
    let m;
    if ((m = low.match(/\b(?:needed|need (?:it|them|these|those)?\s*)?(?:earlier|sooner|pull(?:ed)? in)\b/)) && /earlier|sooner|pull/.test(low) && items.length) {
      const d = findDates(s.slice(m.index), refDay, 'future')[0];
      push({ kind: 'need_earlier', subject: items[0].id, value: d ? d.value : null, for_use: uses[0]?.id ?? null }, items[0]);
      continue;
    }
    // needs: "need 4x FL-HIP-1042 by tues the 24th (Rig setup: ...)"
    let needM = low.match(/\b(?:we |i |they |still )?(?:need|needs|needed|gonna need|going to need|waiting for|want)\b\s*(?:(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:x|pcs|units|of)?\s+)?/);
    // No need verb, but a part or a quantity "for <work item>": "FL-BAT-1679 x10 for Install and torque: Pack latch block",
    // "5 pcs for Fit check: Pelvis side plate, right".
    const forWork = uses.find((u) => u.kind === 'work' && /\bfor\s+(?:the\s+)?$/i.test(s.slice(0, Math.max(0, u.start))));
    if (!needM && forWork && (items.some((r) => r.start < forWork.start) || /\b\d+\s*(?:x|pcs|pieces|units|of)\b|\bx\s?\d+\b/i.test(s.slice(0, forWork.start)))) needM = Object.assign([''], { index: 0 });
    // A need "for <work item>" that names no part we can resolve ("need 6 distal link by 10/27 for Build sub-assembly:
    // Finger distal link"): the part is the one the work item is named after.
    if (needM && !items.length) {
      const w = forWork && forWork.object && ['part', 'deliverable'].includes(resolve.items?.get(forWork.object)?.kind) ? forWork : null;
      const pos = needM.index + needM[0].length;
      if (w) items.push({ id: w.object, kind: resolve.items.get(w.object).kind, mode: 'object', token: null, start: pos, end: pos });
    }
    if (needM && items.length && !(uses.length === 0 && refs.some((r) => r.kind === 'milestone'))) {
      const after = needM.index + needM[0].length - 1;
      const subj = firstOf(items, after - 1);
      const dates = findDates(s.slice(subj.end), refDay, 'future').filter((d) => /\bby\b|\bfor\b|\bbefore\b|\bon\b/.test(s.slice(subj.end, subj.end + d.start + 1).slice(-12)) || /^\s*by\b/i.test(s.slice(subj.end)));
      const byM = s.slice(subj.end).match(/\b(?:by|before|for)\s+/i);
      let need = dates[0];
      if (!need && byM) need = findDates(s.slice(subj.end + byM.index), refDay, 'future')[0];
      const q = needM[1] ? (NUM_WORDS[needM[1]] ?? +needM[1]) : null;
      const use = uses.find((u) => u.id !== subj.id);
      // Every other part in the clause is for the same use ("..., plus FL-TST-2480", "goes with 1091 and the cyclo carrier").
      for (const it of items.filter((r) => r === subj || (r.kind === 'part' && r.id !== subj.id))) {
        push({ kind: 'needs', subject: it.id, value: need ? need.value : null, qty: it === subj ? q : null, for_use: use?.id ?? null, ...(it.order ? { order: it.order } : {}) }, it);
      }
      continue;
    }
    // blocked / waiting on / gating: "X waits on Y", "Y is gating X", "X can't start til Y is done", "Also blocking X: Y",
    // "X also needs Y", "Y is next on the X list". Direction comes from the kinds (parts, deliverables and rigs feed
    // work items, which feed tests, which feed milestones); two things of the same kind give no link.
    const blk = low.match(/\b(?:blocked|blocking|blocker|waits?|waiting|held up|holding(?: up)?|holds? up|stuck|gated|gating|gates|can'?t (?:start|finish|close|run|go|begin|do it|move)|cant (?:start|finish|close|run|go|begin|do it|move)|depends on|dependent on|needs?|needed|requires?|required|before|until|till?|without|w\/o|open on|on the [\w ]*list|next in line|is next|last thing|last one|pile|stack(?:ed|ing)|long pole|holding)\b/);
    if (blk && refs.length >= 2) {
      const ranks = refs.map((r) => RANK[r.kind]);
      const top = Math.max(...ranks);
      let n = 0;
      // Each lower-ranked ref feeds the nearest ref of the next rank up the clause names (part -> work item, not -> milestone).
      for (const r of refs) {
        if (RANK[r.kind] === top) continue;
        const next = Math.min(...ranks.filter((k) => k > RANK[r.kind]));
        const t = refs.filter((x) => RANK[x.kind] === next).reduce((a, b) => (Math.abs(b.start - r.start) < Math.abs(a.start - r.start) ? b : a));
        if (t.id !== r.id) { push({ kind: 'blocked', subject: t.id, value: r.id }, t); n++; }
      }
      if (n) continue;
    }
    // ETA / slip: "new ETA 11/30", "is now expected 9/14", "realistic date is the twentieth", "somewhere between 11/19 and 11/30"
    const etaM = low.match(/\b(?:new eta|eta|on track for|on track|now expected|expected|now|realistic date|arriv\w*|ship(?:s|ping)?|land(?:s|ing)?|slipp?(?:ed|ing)?|pushed|moved|moves|delivery|deliver\w*|promised|commit\w*|between|due|should be (?:here|in)|starting|starts?|start(?:s|ing)? on|scheduled(?: for)?|kicks? off|booked)\b/);
    if (etaM) {
      const subj = refs.find((r) => r.kind === 'deliverable') || refs.find((r) => r.kind === 'part') || refs.find((r) => r.kind === 'test' || r.kind === 'milestone' || r.kind === 'work');
      if (!subj) continue; // only rigs or unknown kinds named: no ETA subject
      const value = etaValue(s.slice(Math.max(0, Math.min(etaM.index, subj.end))), refDay);
      if (value) {
        // A later clause "spin test moves to the week of the 23rd" with a test subject is a planned start.
        push({ kind: 'eta', subject: subj.id, value }, subj);
        if (!/\b(?:takes?|will take|should take)\b/.test(low)) continue;
      }
    }
    // duration: "takes 3 days", "should take 2-3 days"
    const durM = low.match(/\b(?:takes?|take|taking|will take|should take|runs?|lasts?|is)\s+(?:about |around |~)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten|a couple of|a few)(?:\s*(?:-|to)\s*(\d+))?\s*(?:working |business |work )?days?\b/);
    if (durM) {
      const subj = uses[0] || refs[0];
      const a = NUM_WORDS[durM[1].replace(/^a (couple of|few)$/, '$1')] ?? +durM[1];
      push({ kind: 'duration', subject: subj.id, value: durM[2] ? { min: a, max: +durM[2] } : a }, subj);
      continue;
    }
    // done: "2138 done 11/9 (the build)", "bore is done", "spin test passed"
    const doneM = low.match(/\b(?:done|finished|complete(?:d)?|wrapped(?: up)?|passed|closed out|in use|signed off)\b/);
    if (doneM && !/\bnot (?:yet )?(?:done|finished|complete)/.test(low)) {
      const subj = uses[0] || refs.find((r) => r.kind === 'milestone') || refs[0];
      const d = findDates(s.slice(doneM.index), refDay, 'past')[0];
      push({ kind: 'done', subject: subj.id, value: d && typeof d.value === 'string' ? d.value : refDay }, subj);
    }
  }
  addCoListed(out, refsAll, base);
  return out;
}

// ETA value in the text after the ETA word: a range ("between 11/19 and 11/30", "11/19-11/30") as {min, max}, else
// the new date of a move ("moved from X to Y", "11/18 -> 11/24": the last date), else the first date; null if none.
const RANGE_RE = new RegExp(`(?:between|from)\\s+(${DATE_SRC})\\s+(?:and|to|-|–)\\s+(${DATE_SRC})|(${DATE_SRC})\\s*(?:-|–|to)\\s*(${DATE_SRC})`, 'i');
function etaValue(tail, refDay) {
  const rng = tail.match(RANGE_RE);
  if (rng) {
    const a = parseDate((rng[1] || rng[3]).trim(), refDay, 'future'), b = parseDate((rng[2] || rng[4]).trim(), refDay, 'future');
    if (typeof a === 'string' && typeof b === 'string') return a <= b ? { min: a, max: b } : { min: b, max: a };
  }
  const ds = findDates(tail, refDay, 'future');
  if (!ds.length) return null;
  const arrow = tail.search(/->|→|\bto\s+(?=\S*\d)/);
  const afterArrow = arrow >= 0 ? ds.find((d) => d.start > arrow) : null;
  return (afterArrow || (/\bfrom\b/.test(tail) ? ds[ds.length - 1] : ds[0])).value;
}

// Parts listed with a need elsewhere in the doc ("Same kit touches FL-ANK-1268 and FL-ANK-1253", "FL-KNE-1176 goes with
// it") are for the same use, when the doc's needs name exactly one use.
function addCoListed(out, refsAll, base) {
  const needs = out.filter((c) => c.kind === 'needs' && c.for_use);
  if (new Set(needs.map((c) => c.for_use)).size !== 1) return;
  const have = new Set(out.filter((c) => c.kind === 'needs').map((c) => c.subject));
  for (const r of refsAll) {
    if (r.kind !== 'part' || r.ambiguous || have.has(r.id)) continue;
    have.add(r.id);
    out.push({ kind: 'needs', subject: r.id, value: needs[0].value, qty: null, for_use: needs[0].for_use, ...base, token: r.token, mode: r.mode, co_listed: true });
  }
}
