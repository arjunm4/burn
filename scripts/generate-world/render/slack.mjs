// Slack renderer: channel-week jobs, then the Slack export (channels.json, users.json, <channel id>.json).
//
//   plan(world, ctx) -> {records, jobs}     records = {channels, users, messages}; every non-text field fixed here
//   emit(records, texts, ctx) -> {files}    texts = {<ts>: text}; crumbs without text use fallback_text,
//                                           background without text is dropped (a thread without its parent too)
//
// A job's id and content depend only on the seed, the channel and the week (spec §3 text contract 6): every draw
// comes from rng.fork(`<channel>:<week>`) and nothing reads --weeks except the choice of which weeks to plan.
import { addDays, weekStart, atLocalMinutes, dow } from '../lib/calendar.mjs';
import { cmp } from '../lib/io.mjs';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const WD = ['sun', 'mon', 'tues', 'wed', 'thurs', 'fri', 'sat'];
export const STYLE_RULES = {
  slack: ['docs/research/data-realism.md#slack', 'docs/research/data-realism.md#fake-looking-patterns-to-avoid-all-sources'],
  jira: ['docs/research/data-realism.md#tickets-jira', 'docs/research/data-realism.md#fake-looking-patterns-to-avoid-all-sources'],
};
const HOUR_SHAPE = [[420, 480, 2], [480, 540, 5], [540, 720, 34], [720, 780, 7], [780, 1020, 36], [1020, 1110, 10], [1110, 1200, 3], [1200, 1380, 3]];
const DAILY_CAP = 300;
const MAX_JOB = 120;
const OPENERS = ['asks about', 'quick update on', 'question on', 'thinking out loud about', 'heads up about', 'complains mildly about', 'asks for a second opinion on', 'shares a photo related to', 'jokes about', 'notes progress on', 'flags a small issue with', 'asks who knows about'];
const REPLY_STANCES = ['ack', 'agrees', 'pushes back', 'asks a follow-up', 'answers', 'adds a detail', 'will check later', 'jokes', 'thanks', 'tags someone else', 'disagrees politely', 'shares a related experience'];
const ACTIONS = ['tolerance question on', 'bench notes on', 'fit-up of', 'cad change to', 'inspection of', 'drawing review of', 'assembly of', 'cleanup of', 'measurement of', 'setup for'];
function actionFor(id) { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0; return ACTIONS[h % ACTIONS.length]; }
const OFF_TOPIC = ['the new espresso grinder', 'a podcast episode', 'a hiking trail', 'the fire alarm test', 'a 3d-printed desk toy', 'the parking garage gate', 'a recipe someone tried', 'board game night', 'a bike commute mishap', 'fantasy football', 'a lost badge', 'the office plant', 'a conference talk video', 'mechanical keyboards', 'a pet photo', 'cake in the kitchen', 'the wifi in the high bay', 'a rental car story', 'a kid\'s science fair project', 'a teardown video', 'a local taco place', 'noise from the shop next door', 'a meme about CAD software', 'running club', 'a book recommendation', 'standing desks', 'traffic on 101', 'a broken microwave', 'the team lunch order', 'a movie from the weekend', 'a hackathon idea', 'the vending machine', 'a cat on a keyboard', 'the ergonomics survey', 'a sourdough starter', 'the holiday party', 'a robotics competition video', 'a 3am shipping notification', 'office music', 'the new hire welcome lunch', 'lunch plans', 'the coffee machine', 'weekend plans', 'parking lot', 'someone\'s dog visiting the office', 'office temperature', 'a funny link', 'snacks restock', 'a sports game last night'];
const ON_TOPIC = ['quick question about a drawing or tolerance', 'status update on bench work', 'asks who has a tool or fixture', 'shares a photo of a part on the bench', 'notes something odd seen during bring-up', 'asks for a review of a CAD change', 'mentions a vendor email came in', 'heads up about lab or bench availability'];
const REPLY_BRIEFS = ['ack', 'short answer', 'follow-up question', 'agrees and adds a detail', 'says they will look after lunch'];
const REACTIONS = ['eyes', 'white_check_mark', '+1', 'pray', 'grimacing'];
const BOT_TEXT = {
  'Google Calendar': 'Reminder: you have an event starting in 10 minutes',
  'Jira Cloud': 'An issue was transitioned in Jira',
  GitHub: 'New commits pushed to main',
};

// ---- shared helpers (also used by jira.mjs) ----

export function epochOf(iso) { return Math.floor(Date.parse(iso) / 1000); }
export function personOf(world) { const m = new Map(world.people.map((p) => [p.id, p])); return (id) => m.get(id); }
export function jobPerson(p) {
  return { id: p.id, name: p.name, display_name: p.display_name, slack_id: p.slack_id, title: p.title, style: p.style };
}
// Text window: the N Monday-based weeks ending with the week of demo_now.
export function textWeeks(demoNow, n) {
  const last = weekStart(demoNow.slice(0, 10));
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(addDays(last, -7 * i));
  return out;
}
export function weekOf(iso) { return weekStart(iso.slice(0, 10)); }
// Priority: 0 demo context; then 1 + 2 × weeks before the demo week, +1 for background (nest-stable).
export function priorityOf(week, demoNow, background) {
  const back = Math.round((Date.parse(weekStart(demoNow.slice(0, 10))) - Date.parse(week)) / (7 * 864e5));
  return 1 + 2 * back + (background ? 1 : 0);
}

export function datePhrase(date, rng) {
  const m = +date.slice(5, 7), d = +date.slice(8, 10);
  const wd = WD[dow(date)];
  const ord = d + (d % 10 === 1 && d !== 11 ? 'st' : d % 10 === 2 && d !== 12 ? 'nd' : d % 10 === 3 && d !== 13 ? 'rd' : 'th');
  return rng.pick([`${m}/${d}`, `${m}/${d}`, `${wd} ${m}/${d}`, `${wd} the ${ord}`]);
}
function tokenOf(ref) { return ref && ref.token ? ref.token : null; }

// The value phrase a crumb must carry, from the stated value only (never true_value).
export function valuePhrase(claim, world, rng) {
  if (!claim) return null;
  const v = claim.value;
  const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  switch (claim.kind) {
    case 'eta': case 'done': return isDate(v) ? datePhrase(v, rng) : null;
    case 'needs': return v && isDate(v.by) ? datePhrase(v.by, rng) : null;
    case 'need_earlier': return v && isDate(v.date) ? datePhrase(v.date, rng) : null;
    case 'duration': return Array.isArray(v) ? (v[0] === v[1] ? `${v[0]} days` : `${v[0]}-${v[1]} days`) : null;
    case 'stock': return v == null ? null : String(v);
    case 'owner': { const p = world.people.find((x) => x.id === v); return p ? p.display_name : null; }
    default: return null;
  }
}

// Everything a writer needs about one crumb event, without hidden fields.
export function crumbSpec(ev, world, rng) {
  const tokens = [...new Set((ev.refs || []).map(tokenOf).filter(Boolean))];
  const phrase = ev.kind === 'crumb' ? valuePhrase(ev.claim, world, rng) : null;
  const must = ev.kind === 'crumb' ? [...tokens, ...(phrase ? [phrase] : [])] : [];
  const out = { must_mention: must };
  if (ev.kind === 'crumb') {
    out.claim = { kind: ev.claim.kind, value: ev.claim.value };
    out.fallback_text = fallbackText(ev, tokens.length ? tokens : derivedTokens(ev, world), phrase, world);
  }
  return out;
}

// A name for fallback text when the event's refs carry no token (never added to must_mention).
function derivedTokens(ev, world) {
  for (const ref of ev.refs || []) {
    for (const coll of ['parts', 'deliverables', 'tests', 'test_rigs', 'milestones', 'assemblies']) {
      const x = (world[coll] || []).find((y) => y.id === ref.id);
      if (x) return [coll === 'parts' && x.aliases && x.aliases[0] ? x.aliases[0] : String(x.name).toLowerCase()];
    }
  }
  return [];
}

export function fallbackText(ev, tokens, phrase, world) {
  const tok = tokens[0] || 'it';
  const v = ev.claim.value;
  let t;
  switch (ev.claim.kind) {
    case 'needs': t = `need ${v && v.qty ? v.qty + 'x ' : ''}${tok}${phrase ? ' by ' + phrase : ''}`; break;
    case 'eta': t = `${tok} eta ${phrase || 'tbd'}`; break;
    case 'need_earlier': t = `${tok} needed earlier, by ${phrase || 'asap'}`; break;
    case 'done': t = `${tok} done${phrase ? ' ' + phrase : ''}`; break;
    case 'blocked': t = `${tok} blocked`; break;
    case 'owner': t = `${tok} now with ${phrase || 'someone else'}`; break;
    case 'substitute': t = `${tok}: switching${typeof v === 'string' && !v.includes('-') ? ' to ' + v : ''}`; break;
    case 'duration': t = `${tok} will take ${phrase || 'a few days'}`; break;
    case 'stock': t = `${tok}: ${phrase} on hand`; break;
    default: t = tok;
  }
  for (const m of [...tokens, ...(phrase ? [phrase] : [])]) if (!t.includes(m)) t += ` (${m})`;
  return t;
}

// A human time at least `sec` seconds after `iso`, moved to the next working morning if it lands outside 08:00-20:00.
function humanAfter(iso, sec, rng, burst) {
  const t = isoLocal(new Date(Date.parse(iso) + sec * 1000).toISOString());
  const min = +t.slice(11, 13) * 60 + +t.slice(14, 16);
  const d = dow(t.slice(0, 10));
  if (min >= 480 && min < (burst ? 1380 : 1200) && d !== 0 && d !== 6) return t;
  let day = min >= 480 ? addDays(t.slice(0, 10), 1) : t.slice(0, 10);
  while (dow(day) === 0 || dow(day) === 6) day = addDays(day, 1);
  return atLocalMinutes(day, rng.int(500, 690), rng.int(0, 59));
}

// Leaves of a value as strings (for leak checks).
export function leaves(v) {
  if (v == null) return [];
  if (typeof v === 'object') return Object.values(v).flatMap(leaves);
  return [String(v)];
}
// Strings of the truth that the stated value does not contain: these must never reach a writer.
export function hiddenValues(ev) {
  if (!ev.claim || ev.claim.true_value === undefined) return [];
  const stated = new Set(leaves(ev.claim.value));
  const out = [];
  for (const x of leaves(ev.claim.true_value)) {
    if (stated.has(x) || x.length < 3) continue;
    out.push(x);
    if (/^\d{4}-\d{2}-\d{2}$/.test(x)) out.push(`${+x.slice(5, 7)}/${+x.slice(8, 10)}`);
  }
  return out;
}
// A brief that gives only what the speaker believed and said: parentheticals are dropped from imperfect crumbs,
// and a brief that still names a hidden value (or the error) is rebuilt from the stated claim.
export function safeBrief(ev, world) {
  let b = String(ev.brief || '');
  if (ev.kind !== 'crumb') return b;
  if (ev.truth !== 'true' || ev.contradicts) b = b.replace(/\s*\([^)]*\)/g, '').trim();
  const hidden = hiddenValues(ev);
  if (!hidden.some((h) => b.includes(h)) && !/changed to|actually|wrong|stale|never corrected|contradict|misheard/i.test(b)) return b;
  const who = world.people.find((p) => p.id === ev.by);
  const tok = (ev.refs || []).map((r) => r.token).find(Boolean) || derivedTokens(ev, world)[0] || 'it';
  const v = ev.claim.value;
  const val = typeof v === 'object' && v ? Object.entries(v).filter(([k, x]) => x != null && k !== 'reason').map(([k, x]) => `${k} ${x}`).join(', ') : String(v);
  return `${who ? who.display_name : 'Someone'} says ${tok}: ${ev.claim.kind.replace('_', ' ')} ${val}`;
}

function uuid(r) {
  const h = () => r.int(0, 15).toString(16);
  const s = Array.from({ length: 32 }, h);
  s[12] = '4'; s[16] = '89ab'[r.int(0, 3)];
  const j = s.join('');
  return `${j.slice(0, 8)}-${j.slice(8, 12)}-${j.slice(12, 16)}-${j.slice(16, 20)}-${j.slice(20)}`;
}
function micro(r) { return String(r.int(0, 999999)).padStart(6, '0'); }

// A human time on `date` drawn from the hour shape (seconds random).
function humanTime(date, r, burst) {
  const shape = HOUR_SHAPE.map(([a, b, w], i) => [[a, b], i === HOUR_SHAPE.length - 1 && burst ? 6 : w]);
  const [a, b] = r.weighted(shape);
  return atLocalMinutes(date, r.int(a, b - 1), r.int(0, 59));
}

// ---- plan ----

export function plan(world, ctx) {
  const person = personOf(world);
  const demoNow = ctx.demoNow;
  const weeks = textWeeks(demoNow, ctx.weeks);
  const evById = new Map(world.events.map((e) => [e.id, e]));
  const weekRec = new Map((world.meta.weeks || []).map((w) => [w.week_start, w]));
  const channels = world.channels.slice().sort((a, b) => cmp(a.id, b.id));
  const users = world.people.slice().sort((a, b) => cmp(a.id, b.id)).map((p) => ({
    id: p.slack_id, name: p.display_name, real_name: p.name, email: p.email, title: p.title, deleted: !!p.end_date,
  }));
  const messages = [];
  const jobs = [];
  const demo = world.demo || {};
  const demoEntities = new Set([demo.part, demo.test, demo.milestone, demo.motor && demo.motor.deliverable].filter(Boolean));
  const demoStart = demo.context_window ? Date.parse(demo.context_window.start) : Infinity;

  // Seconds used by any slack event per channel (world-wide, so filler never collides whatever --weeks is).
  const usedSec = new Map();
  for (const e of world.events) if (e.source === 'slack') {
    const s = usedSec.get(e.where.channel) || new Set(); s.add(epochOf(e.known_at)); usedSec.set(e.where.channel, s);
  }

  // Weekly message targets per channel: seeded rate × activity (Slack bursts capped at ×1.3), then the whole
  // workspace capped at DAILY_CAP a working day, trimming channels that are not purchasing-relevant first.
  const targets = new Map();
  for (const week of weeks) {
    const wk = weekRec.get(week) || { activity: 1 };
    const act = Math.min(wk.activity ?? 1, 1.3);
    // Days after demo_now do not count; the demo day counts for the share of activity before demo_now (~0.25).
    const demoDay = demoNow.slice(0, 10);
    const wdUnits = Array.from({ length: 7 }, (_, i) => addDays(week, i)).filter((d) => d <= demoDay)
      .reduce((s, d) => s + ctx.cal.dayActivity(d) * (d === demoDay ? 0.25 : 1), 0);
    const t = new Map(channels.map((c) => [c.id, (c.base_rate_per_day || 0) * act * wdUnits]));
    const cap = DAILY_CAP * wdUnits;
    const sum = (f) => channels.filter(f).reduce((s, c) => s + t.get(c.id), 0);
    let total = sum(() => true);
    if (total > cap) {
      const other = sum((c) => !c.purchasing_relevant);
      const k = Math.max(0, (other - (total - cap)) / (other || 1));
      for (const c of channels) if (!c.purchasing_relevant) t.set(c.id, t.get(c.id) * k);
      total = sum(() => true);
      if (total > cap) for (const c of channels) t.set(c.id, t.get(c.id) * cap / total);
    }
    targets.set(week, t);
  }
  const storylinesFor = (ch, week) => (world.storylines || []).filter((s) => week >= weekStart(s.start) && week <= s.end
    && ((world.teams.find((t) => t.id === s.team)?.channels || []).includes(ch.id) || (s.people || []).some((p) => ch.members.includes(p))));
  // On-topic subjects for a channel-week: storyline beats and topics, plus the channel's own parts (by alias), rigs and tests.
  const topicPool = (ch, week, sls) => {
    const out = [];
    for (const s of sls) { out.push(`the ongoing ${s.topic.toLowerCase()}`); for (const b of s.beats || []) if (b.week <= week) out.push(`this: ${b.summary}`); }
    const asm = new Set([ch.assembly, ...world.assemblies.filter((a) => (world.teams.find((t) => t.id === a.team)?.channels || []).includes(ch.id)).map((a) => a.id)].filter(Boolean));
    for (const p of world.parts || []) if (asm.has(p.belongs_to) && p.aliases && p.aliases[0]) out.push(`${actionFor(p.id)} the ${p.aliases[0]}`);
    for (const t of world.tests || []) if (asm.has(t.assembly)) out.push(`${actionFor(t.id)} the ${String(t.name).toLowerCase()}`);
    for (const x of world.test_rigs || []) if (ch.id === 'ch-test-lab' || asm.has(x.belongs_to)) out.push(`${actionFor(x.id)} the ${String(x.name).toLowerCase()}`);
    if (!out.length) for (const a of ON_TOPIC) out.push(`${a} (#${ch.name}: ${ch.purpose})`);
    return out;
  };

  for (const ch of channels) {
    const chEvents = world.events.filter((e) => e.source === 'slack' && e.where.channel === ch.id && Date.parse(e.known_at) <= Date.parse(demoNow));
    const members = ch.members.map(person).filter(Boolean);
    const weightOf = (p) => (p.chattiness || 1) * (p.lurker ? 0.1 : 1);
    for (const week of weeks) {
      const r = ctx.rng.fork(`${ch.id}:${week}`);
      const wk = weekRec.get(week) || { activity: 1, kind: 'normal' };
      const burst = wk.kind === 'burst';
      const used = new Set(usedSec.get(ch.id) || []);
      // Root of an event's thread (an event whose thread_of is not a slack event in this channel is top level).
      const rootOf = (e) => { let x = e; const seen = new Set(); while (x.where.thread_of && !seen.has(x.id)) { seen.add(x.id); const p = evById.get(x.where.thread_of); if (!p || p.source !== 'slack' || p.where.channel !== ch.id) break; x = p; } return x; };
      const roots = chEvents.filter((e) => rootOf(e) === e && weekOf(e.known_at) === week).sort((a, b) => cmp(a.known_at, b.known_at) || cmp(a.id, b.id));
      const threads = roots.map((root) => ({ root, evs: chEvents.filter((e) => rootOf(e) === root).sort((a, b) => cmp(a.known_at, b.known_at) || cmp(a.id, b.id)) }));
      const msgs = { crumbs: [], background: [] };
      const human = (rr, at, user, extra, reserved = false) => {
        let sec = epochOf(at);
        if (!reserved) { while (used.has(sec)) sec += 1; used.add(sec); }
        return { ts: `${sec}.${micro(rr)}`, channel: ch.slack_id, ch: ch.id, week, user: user.slack_id, person: user.id, ...extra };
      };
      const decorate = (rr, m) => {
        m.client_msg_id = uuid(rr);
        if (rr.chance(0.2)) {
          const names = rr.sample(REACTIONS, rr.int(1, 2));
          m.reactions = names.map((name) => { const us = rr.sample(members, Math.min(members.length, rr.int(1, 3))); return { name, users: us.map((u) => u.slack_id).sort(), count: us.length }; });
        }
        if (rr.chance(0.04)) { const ets = Number(m.ts.split('.')[0]) + rr.int(20, 900); if (ets * 1000 <= Date.parse(demoNow)) m.edited = { user: m.user, ts: `${ets}.000000` }; }
        return m;
      };
      const fillerReplies = (rr, parent, n, group, baseAt, about) => {
        let at = baseAt;
        let added = 0;
        for (let i = 0; i < n; i++) {
          at = humanAfter(at, rr.int(60, 5400), rr, burst);
          if (!at || Date.parse(at) > Date.parse(demoNow) || weekOf(at) !== week) break;
          const u = rr.weighted(members.map((p) => [p, weightOf(p)]));
          const m = human(rr, at, u, { thread_ts: parent.ts, kind: 'background', events: [], brief: `reply (${rr.pick(REPLY_STANCES)}) in the thread about: ${about}`, must_mention: [], length: rr.weighted([['one_word', 35], ['short', 50], ['medium', 15]]) });
          if (rr.chance(0.1)) m.subtype = 'thread_broadcast';
          group.push(decorate(rr, m));
          added++;
        }
        return added;
      };
      // Event threads.
      for (const t of threads) {
        const rr = r.fork(t.root.id);
        const isCrumb = t.evs.some((e) => e.kind === 'crumb');
        const group = isCrumb ? msgs.crumbs : msgs.background;
        let parent = null;
        for (const e of t.evs) {
          const er = rr.fork(e.id);
          const spec = crumbSpec(e, world, er);
          const u = person(e.by);
          const m = human(er, e.known_at, u, {
            thread_ts: parent ? parent.ts : null, kind: e.kind, events: [e.id], brief: e.kind === 'background' ? `background: ${e.brief}` : safeBrief(e, world),
            ...(spec.claim ? { claim: spec.claim } : {}), must_mention: spec.must_mention,
            ...(e.kind === 'crumb' && e.pressure ? { pressure: e.pressure } : {}),
            ...(e.asks_expedite ? { asks_expedite: true } : {}),
            length: e.kind === 'crumb' ? er.weighted([['short', 70], ['medium', 30]]) : er.weighted([['short', 60], ['medium', 30], ['long', 10]]),
            ...(spec.fallback_text ? { fallback_text: spec.fallback_text } : {}),
            demo: (e.refs || []).some((x) => demoEntities.has(x.id)) || !!(e.claim && demoEntities.has(e.claim.subject)),
          }, true);
          group.push(decorate(er, m));
          if (!parent) parent = m;
        }
        if (rr.chance(0.4)) fillerReplies(rr, parent, rr.int(1, 3), group, t.evs[t.evs.length - 1].known_at, t.root.kind === 'background' ? t.root.brief : 'the message above');
      }
      // Filler up to the channel's (capped) weekly volume; the count includes event messages and replies.
      const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
      const wdDays = days.filter((d) => ctx.cal.isWd(d));
      const target = Math.round((targets.get(week).get(ch.id) || 0) * r.uniform(0.9, 1.1));
      let count = msgs.crumbs.length + msgs.background.length;
      const fr = r.fork('filler');
      const storylines = storylinesFor(ch, week);
      const topics = topicPool(ch, week, storylines);
      for (let i = 0; count < target && members.length && i < target * 3; i++) {
        const rr = fr.fork(String(i));
        const day = rr.chance(0.02) ? rr.pick(days.filter((d) => !ctx.cal.isWd(d))) : rr.weighted(wdDays.length ? wdDays.map((d) => [d, ctx.cal.dayActivity(d)]) : days.map((d) => [d, 1]));
        const at = humanTime(day, rr, burst);
        if (Date.parse(at) > Date.parse(demoNow) || Date.parse(at) < Date.parse(world.meta.window.start)) continue;
        const u = rr.weighted(members.map((p) => [p, weightOf(p)]));
        const topic = rr.chance(ch.on_topic_share ?? 0.8) && topics.length ? rr.pick(topics) : `off-topic: ${rr.pick(OFF_TOPIC)}`;
        const brief = `background: ${rr.pick(OPENERS)} ${topic}`;
        const m = decorate(rr, human(rr, at, u, { thread_ts: null, kind: 'background', events: [], brief, must_mention: [], length: rr.weighted([['one_word', 12], ['short', 58], ['medium', 22], ['long', 8]]) }));
        msgs.background.push(m);
        count++;
        if (rr.chance(0.3)) count += fillerReplies(rr, m, Math.min(target - count, rr.chance(0.07) ? rr.int(15, 18) : rr.int(2, 6)), msgs.background, at, topic);
      }
      // Bots and joins: code-written text, no writer.
      const br = r.fork('bots');
      const system = [];
      for (const bot of (ch.bots || []).slice().sort()) {
        const n = br.int(1, 4);
        for (let i = 0; i < n && wdDays.length; i++) {
          const at = humanTime(br.pick(wdDays), br, false);
          if (Date.parse(at) > Date.parse(demoNow)) continue;
          let sec = epochOf(at); while (used.has(sec)) sec += 1; used.add(sec);
          system.push({ ts: `${sec}.${micro(br)}`, channel: ch.slack_id, ch: ch.id, week, kind: 'bot', subtype: 'bot_message', bot_id: 'B' + botId(bot), username: bot, thread_ts: null, events: [], fixed_text: BOT_TEXT[bot] || `${bot} notification` });
        }
      }
      if (members.length && br.chance(0.06) && wdDays.length) {
        const u = br.pick(members);
        const at = humanTime(br.pick(wdDays), br, false);
        if (Date.parse(at) <= Date.parse(demoNow)) {
          let sec = epochOf(at); while (used.has(sec)) sec += 1; used.add(sec);
          system.push({ ts: `${sec}.${micro(br)}`, channel: ch.slack_id, ch: ch.id, week, kind: 'join', subtype: 'channel_join', user: u.slack_id, person: u.id, thread_ts: null, events: [], fixed_text: `<@${u.slack_id}> has joined the channel` });
        }
      }
      messages.push(...system);
      // Crumb threads: one job per channel-week. Background: one job per day (half-days when a day is large),
      // a thread going with its parent's slot. Ids depend only on channel and date, so jobs nest under --weeks.
      const groups = [];
      if (msgs.crumbs.length) groups.push(['crumbs', msgs.crumbs]);
      const tsTime = (m) => isoLocal(new Date(Number(m.ts.split('.')[0]) * 1000).toISOString());
      const parentOf = new Map(msgs.background.filter((m) => !m.thread_ts).map((m) => [m.ts, m]));
      const slotDay = new Map();
      for (const m of msgs.background) {
        const root = m.thread_ts && parentOf.get(m.thread_ts) ? parentOf.get(m.thread_ts) : m;
        const t = tsTime(root);
        const d = t.slice(0, 10);
        (slotDay.get(d) || slotDay.set(d, []).get(d)).push({ m, pm: +t.slice(11, 13) >= 13 });
      }
      for (const d of [...slotDay.keys()].sort()) {
        const list = slotDay.get(d);
        if (list.length <= MAX_JOB) { groups.push([`background-${d}`, list.map((x) => x.m)]); continue; }
        // Large day: split into parts of whole threads, in time order of their parents.
        const byRoot = new Map();
        for (const x of list) { const k = x.m.thread_ts && parentOf.has(x.m.thread_ts) ? x.m.thread_ts : x.m.ts; (byRoot.get(k) || byRoot.set(k, []).get(k)).push(x.m); }
        const roots = [...byRoot.keys()].sort();
        const parts = Math.ceil(list.length / MAX_JOB);
        const size = Math.ceil(list.length / parts);
        let cur = [], n = 1;
        for (const k of roots) {
          if (cur.length && cur.length + byRoot.get(k).length > size && n < parts) { groups.push([`background-${d}-p${n}`, cur]); cur = []; n++; }
          cur.push(...byRoot.get(k));
        }
        if (cur.length) groups.push([`background-${d}-p${n}`, cur]);
      }
      for (const [part, raw] of groups) {
        const list = raw.sort((a, b) => cmp(a.ts, b.ts));
        const background = part !== 'crumbs';
        const jobId = `slack-${ch.id}-${week}-${part}`;
        for (const m of list) m.job_id = jobId;
        messages.push(...list);
        const ppl = [...new Set(list.map((m) => m.person))].sort().map((id) => jobPerson(person(id)));
        const isDemo = !background && list.some((m) => m.demo && Number(m.ts) * 1000 >= demoStart);
        const context = [];
        if (ch.assembly) { const a = world.assemblies.find((x) => x.id === ch.assembly); if (a) context.push(`Channel for ${a.name}.`); }
        for (const s of storylines) { const beat = (s.beats || []).find((b) => b.week === week); context.push(`Ongoing: ${s.topic}${beat ? '. This week: ' + beat.summary : ''}`); }
        jobs.push({
          job_id: jobId, source: 'slack', status: 'blank', priority: isDemo ? 0 : priorityOf(week, demoNow, background),
          style_rules: STYLE_RULES.slack,
          channel: { id: ch.id, name: ch.name, slack_id: ch.slack_id, purpose: ch.purpose },
          week: { start: week, end: addDays(week, 6) },
          people: ppl, context,
          forbidden: !background
            ? ['hidden reasons', 'any fact not in a message brief or the context', 'dates other than those in the claim', 'stating which shipping tier was chosen']
            : ['hidden reasons', 'part numbers, quote ids, order numbers or Jira keys', 'dollar amounts of $50 or more', 'explicit dates (relative time like "last week" is fine)'],
          messages: list.map((m) => ({
            ts: m.ts, user: m.person, thread_ts: m.thread_ts, events: m.events, brief: m.brief,
            ...(m.claim ? { claim: m.claim } : {}), must_mention: m.must_mention,
            ...(m.pressure ? { pressure: m.pressure } : {}), ...(m.asks_expedite ? { asks_expedite: true } : {}),
            length: m.length, text: null,
          })),
        });
      }
    }
  }
  messages.sort((a, b) => cmp(a.channel, b.channel) || cmp(a.ts, b.ts));
  for (const m of messages) delete m.demo;
  return {
    records: {
      channels: channels.map((c) => ({ id: c.slack_id, world_id: c.id, name: c.name, type: c.type, purpose: c.purpose, members: c.members.map((p) => person(p)?.slack_id).filter(Boolean).sort() })),
      users, messages,
    },
    jobs: jobs.sort((a, b) => cmp(a.job_id, b.job_id)),
  };
}

function botId(name) { let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h.toString(36).toUpperCase().padStart(10, '0').slice(-10); }
function isoLocal(utcIso) {
  // Convert a Z time to Pacific local ISO (via schema offsets) without the host time zone.
  const ms = Date.parse(utcIso);
  const winter = new Date(ms - 8 * 3600e3).toISOString().slice(0, 19);
  const off = pacific(ms);
  return off === '-08:00' ? winter + off : new Date(ms - 7 * 3600e3).toISOString().slice(0, 19) + off;
}
function pacific(ms) {
  const y = new Date(ms).getUTCFullYear();
  const sun = (m, n) => { const d = new Date(Date.UTC(y, m, 1)).getUTCDay(); return 1 + ((7 - d) % 7) + 7 * (n - 1); };
  return ms >= Date.UTC(y, 2, sun(2, 2), 10) && ms < Date.UTC(y, 10, sun(10, 1), 9) ? '-07:00' : '-08:00';
}

// ---- emit ----

export function emit(records, texts, ctx) {
  const start = Date.parse(ctx.textStart);
  const now = Date.parse(ctx.demoNow);
  const byChannel = new Map(records.channels.map((c) => [c.id, []]));
  // Pick the text of each message; drop background without text, then threads whose parent is gone.
  const kept = [];
  for (const m of records.messages) {
    if (Number(m.ts) * 1000 < start - 0 && !m.thread_ts) continue;
    if (Number(m.ts) * 1000 > now) continue;
    let text;
    if (m.fixed_text != null) text = m.fixed_text;
    else if (typeof texts[m.ts] === 'string') text = texts[m.ts];
    else if (m.kind === 'crumb') text = m.fallback_text;
    else continue;
    kept.push({ m, text });
  }
  const parents = new Set(kept.filter((k) => !k.m.thread_ts).map((k) => k.m.channel + '|' + k.m.ts));
  const live = kept.filter((k) => !k.m.thread_ts || parents.has(k.m.channel + '|' + k.m.thread_ts));
  // Thread parents whose own week is outside --weeks are already excluded (their replies follow them).
  const parentStart = new Map(live.filter((k) => !k.m.thread_ts).map((k) => [k.m.channel + '|' + k.m.ts, k]));
  const final = live.filter((k) => {
    const p = k.m.thread_ts ? parentStart.get(k.m.channel + '|' + k.m.thread_ts) : k;
    return Number(p.m.ts) * 1000 >= start;
  });
  const replies = new Map();
  for (const k of final) if (k.m.thread_ts) { const key = k.m.channel + '|' + k.m.thread_ts; (replies.get(key) || replies.set(key, []).get(key)).push(k.m); }
  for (const { m, text } of final) {
    const out = { type: 'message' };
    if (m.subtype) out.subtype = m.subtype;
    if (m.kind === 'bot') { out.bot_id = m.bot_id; out.username = m.username; } else out.user = m.user;
    out.text = text;
    out.ts = m.ts;
    if (m.client_msg_id) out.client_msg_id = m.client_msg_id;
    if (m.thread_ts) {
      out.thread_ts = m.thread_ts;
      const parent = parentStart.get(m.channel + '|' + m.thread_ts);
      out.parent_user_id = parent.m.user;
    } else {
      const rs = (replies.get(m.channel + '|' + m.ts) || []).slice().sort((a, b) => cmp(a.ts, b.ts));
      if (rs.length) {
        out.thread_ts = m.ts;
        out.reply_count = rs.length;
        out.reply_users = [...new Set(rs.map((r) => r.user))];
        out.reply_users_count = out.reply_users.length;
        out.latest_reply = rs[rs.length - 1].ts;
      }
    }
    if (m.edited) out.edited = m.edited;
    if (m.reactions) out.reactions = m.reactions;
    (byChannel.get(m.channel) || byChannel.set(m.channel, []).get(m.channel)).push(out);
  }
  const files = [];
  files.push({ path: 'slack/channels.json', content: json({ ok: true, channels: records.channels.map((c) => ({
    id: c.id, name: c.name, is_channel: c.type === 'public' || c.type === 'private', is_private: c.type !== 'public',
    is_im: c.type === 'dm', is_mpim: c.type === 'mpim', is_member: true, purpose: { value: c.purpose || '' }, num_members: c.members.length,
  })) }) });
  files.push({ path: 'slack/users.json', content: json({ ok: true, members: records.users.map((u) => ({
    id: u.id, name: u.name, real_name: u.real_name, deleted: u.deleted, is_bot: false,
    profile: { real_name: u.real_name, display_name: u.name, title: u.title, email: u.email },
  })) }) });
  for (const c of records.channels) {
    // Newest first like conversations.history. Replies are included in the same file so the prototype's
    // fixture connector (whose conversations.replies returns nothing) still sees them.
    const msgs = (byChannel.get(c.id) || []).sort((a, b) => cmp(b.ts, a.ts));
    files.push({ path: `slack/${c.id}.json`, content: json({ ok: true, messages: msgs, has_more: false, response_metadata: { next_cursor: '' } }) });
  }
  return { files };
}

function json(v) { return JSON.stringify(v, null, 2) + '\n'; }
