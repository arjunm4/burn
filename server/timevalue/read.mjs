// Context read (agent D): one read per doc → {doc_id, refs, claims, pressure, done, via}.
//
// Two versions share one output shape:
//   - code: refs and claims from C (refs.mjs / claims.mjs), pressure from the lexicon
//     below, done ids from `done` claims and done words next to a resolved ref.
//   - llm: Claude agents fill job files (scripts/timevalue/read-jobs.mjs, instructions
//     in docs/build/read-job-instructions.md); `--collect` writes
//     fixtures/timevalue/read-cache.json. loadReadCache() lays those over code reads.
//
// The card's conversation check (rubric check 7) reads pressure relative to the team's
// baseline: teamBaseline() gives the mean pressure per team (author's team, or the
// channel when the author is unknown), shrunk toward the global mean when a team has few reads.
//
// Pure functions; no Date.now, no randomness. The resolver and claim extractor are passed
// in through ctx (makeReadContext), or loadReadContext() wires up refs.mjs and claims.mjs.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { makeResolver } from './refs.mjs';
import { extractClaims as codeClaims } from './claims.mjs';

// ---------------------------------------------------------------- pressure lexicon
//
// Each cue adds weight w. Cues combine as a noisy-OR, pressure = 1 − Π(1 − w), so
// one cue reads as its own weight, several cues approach 1, and nothing exceeds 1.
// A cue counts once per doc however often it appears. Weights are judgement, tuned
// to the hardware-team phrasing in docs/research/data-realism.md ("any update on the
// shaft?", "bumping this, line's idle thurs", "can we expedite? EVT build is thurs").
//
// Anchors (code version): "ok ty" → 0; "need 2x pelvis plate by 9/22" → 0.15;
// "any update on the shaft?" → 0.35; "bumping this, line's idle thurs" → 0.58;
// "asap!! build is tmrw and we're blocked" → 0.77.
export const PRESSURE_LEXICON = [
  { id: 'follow_up', w: 0.35, re: /\b(any (update|news|word|eta)|bump(ing)?\b|following up|follow(ing)? up on|still waiting|still no\b|ping(ing)? (again|on)|status on)/i,
    note: 'chasing someone: "any update?", "bumping this", "still waiting"' },
  { id: 'urgent', w: 0.45, re: /\b(asap|urgent(ly)?|critical|top priority|p0|hot (job|part)|fire drill|drop everything)\b|🚨|:rotating_light:/i,
    note: 'explicit urgency' },
  { id: 'expedite', w: 0.3, re: /\b(expedit(e|ed|ing)|rush(ed)?|overnight|fastest (tier|option)|pay (for|the) (faster|expedite))\b/i,
    note: 'asking to pay for speed' },
  { id: 'punct', w: 0.2, re: /\?\?|!!/,
    note: 'doubled ?? or !!' },
  { id: 'blocked', w: 0.35, re: /\b(blocked|blocking|blocker|stuck|idle|sitting idle|can'?t (start|run|proceed|test|build)|holding up|waiting (on|for))\b/i,
    note: 'someone or something waiting on the item' },
  { id: 'need_by', w: 0.15, re: /\bneed(s|ed)?\b[^.\n]{0,40}\bby\b|\bneed(ed)? (it|them|these|this)\b[^.\n]{0,20}\b(by|before)\b/i,
    note: 'a need-by date' },
  { id: 'slip', w: 0.3, re: /\b(slipped|slip(s|ping)?|push(es|ed|ing)? (out|back|to|the)|delayed|running late|behind schedule|moved (out|back)|again\b|new eta)\b/i,
    note: 'a date moved' },
  { id: 'deadline', w: 0.2, re: /\b(eod|eow|cob|today|tonight|tmrw|tomorrow|first thing|deadline|cutoff|due (today|tmrw|tomorrow|fri|mon|thurs?|this week))\b/i,
    note: 'a close deadline' },
  { id: 'frustration', w: 0.3, re: /\b(ugh|argh|wtf|seriously|come on|not again|frustrat\w*|painful)\b|😬|😤|:grimacing:|:upside_down_face:/i,
    note: 'frustration' },
  { id: 'manager', w: 0.2, re: null,
    note: 'a manager or team lead writing in a thread they did not start, or commenting on a ticket' },
];

const LEXICON_BY_ID = Object.fromEntries(PRESSURE_LEXICON.map((c) => [c.id, c]));

/** Pressure from the lexicon. `managerJoined` adds the manager cue. → {pressure, cues} */
export function scorePressure(text, { managerJoined = false } = {}) {
  const cues = [];
  const t = String(text || '');
  for (const cue of PRESSURE_LEXICON) {
    if (cue.re ? cue.re.test(t) : (cue.id === 'manager' && managerJoined)) cues.push(cue.id);
  }
  let calm = 1;
  for (const id of cues) calm *= 1 - LEXICON_BY_ID[id].w;
  return { pressure: round3(1 - calm), cues };
}

// ---------------------------------------------------------------- context

/**
 * Build the context readDoc needs.
 * @param settings  fixtures/timevalue/settings.json
 * @param fns       {resolve, extractClaims}: C's resolver (makeResolver(settings)) and extractClaims
 */
export function makeReadContext(settings, { resolve, extractClaims } = {}) {
  const people = settings?.people || [];
  const byEmail = new Map();
  const bySlack = new Map();
  const byName = new Map();
  for (const p of people) {
    if (p.email) byEmail.set(p.email.toLowerCase(), p);
    if (p.slack_id) bySlack.set(p.slack_id, p);
    if (p.name) byName.set(p.name.toLowerCase(), p);
  }
  const managers = new Set();
  for (const p of people) if (p.manager) managers.add(p.manager);
  for (const t of settings?.teams || []) if (t.lead) managers.add(t.lead);
  const channelTeam = new Map(); // slack channel id → team id (first team listing it)
  for (const t of settings?.teams || []) for (const c of t.channels || []) if (!channelTeam.has(c)) channelTeam.set(c, t.id);
  return {
    settings,
    resolve: resolve || (() => []),
    extractClaims: extractClaims || (() => []),
    personOf(author) {
      if (!author) return null;
      return (author.email && byEmail.get(String(author.email).toLowerCase()))
        || (author.slack_id && bySlack.get(author.slack_id))
        || (author.name && byName.get(String(author.name).toLowerCase()))
        || null;
    },
    isManager: (personId) => managers.has(personId),
    channelTeam,
  };
}

/**
 * The context with the code resolver (refs.mjs) and claim extractor (claims.mjs).
 * Slack channels that settings tie to one assembly scope numeric aliases to it.
 */
export async function loadReadContext(settings, { xometry, calendar } = {}) {
  const channelAssemblies = {};
  for (const c of settings?.channels || []) if (c.assembly) channelAssemblies[c.slack_id] = [c.assembly];
  const resolve = makeResolver(settings || {}, { xometry, calendar, channelAssemblies });
  return { ...makeReadContext(settings, { resolve, extractClaims: codeClaims }), c_modules: 'refs:real claims:real' };
}

// ---------------------------------------------------------------- the code read

const DONE_RE = /\b(done|finished|complete(d)?|arrived|received|delivered|landed|in hand|on hand|passed|closed|shipped to us|installed)\b/i;
const NOT_DONE_RE = /\b(not (yet )?(done|finished|complete|arrived|received|delivered|in)|isn'?t (done|here)|until .* (done|arrives?)|once .* (done|arrives?)|when .* (done|arrives?)|if .* (done|arrives?))\b|\?\s*$/i;

/** Team key for baselines: the author's team, else the channel's team, else the container. */
function teamKeyOf(doc, ctx) {
  const person = ctx.personOf(doc.author);
  if (person?.team) return person.team;
  if (ctx.channelTeam.has(doc.container)) return ctx.channelTeam.get(doc.container);
  return `container:${doc.container}`;
}

/**
 * Code read of one doc.
 * @param doc  {id, source, container, thread, author, at, text}
 * @param ctx  makeReadContext(...)
 * @returns {doc_id, refs, claims, pressure, done, via: "code", cues, team, author_id, container, thread, at}
 */
export function readDoc(doc, ctx) {
  if (!doc?.id) throw new TypeError('readDoc: expected a doc with an id');
  if (typeof ctx?.resolve !== 'function') throw new TypeError('readDoc: expected a context from makeReadContext()');
  const text = doc.text || '';
  const refs = ctx.resolve(text, doc) || [];
  const claims = ctx.extractClaims(doc, ctx.resolve) || [];
  const person = ctx.personOf(doc.author);
  const isReplyOrComment = (doc.source === 'slack' && doc.thread && !String(doc.id).endsWith(`:${doc.thread}`))
    || (doc.source === 'jira' && /:c[^:]*$/.test(doc.id));
  const managerJoined = Boolean(person && ctx.isManager(person.id) && isReplyOrComment);
  const { pressure, cues } = scorePressure(text, { managerJoined });

  const done = new Set();
  for (const c of claims) if (c.kind === 'done' && c.subject && c.subject !== 'unresolved') done.add(c.subject);
  // A Jira status change to Done marks what the ticket's summary names as done.
  const toDone = (doc.changes || []).some((c) => c.field === 'status' && /^(done|closed|resolved)$/i.test(c.to || ''));
  if (toDone && doc.summary) {
    const firm = (ctx.resolve(doc.summary, doc) || []).filter((r) => !r.ambiguous);
    if (firm.length === 1) done.add(firm[0].id);
  }
  if (!done.size && DONE_RE.test(text) && !NOT_DONE_RE.test(text)) {
    const firm = refs.filter((r) => !r.ambiguous);
    if (firm.length === 1) done.add(firm[0].id); // only when the done word has one clear subject
  }

  return {
    doc_id: doc.id,
    refs,
    claims,
    pressure,
    done: [...done].sort(),
    via: 'code',
    cues,
    team: teamKeyOf(doc, ctx),
    author_id: person?.id || null,
    container: doc.container,
    thread: doc.thread,
    at: doc.at,
  };
}

/** Code reads for many docs, in doc order. */
export function readDocs(docs, ctx) {
  return (docs || []).map((d) => readDoc(d, ctx));
}

// ---------------------------------------------------------------- cache

/** Lay LLM reads over code reads by doc_id; fields the LLM read lacks (team, at, …) come from the code read. */
export function mergeReads(codeReads = [], llmReads = []) {
  const out = new Map();
  for (const r of codeReads) out.set(r.doc_id, r);
  for (const r of llmReads) out.set(r.doc_id, { ...(out.get(r.doc_id) || {}), ...r, via: 'llm' });
  return new Map([...out.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)));
}

/**
 * Load fixtures/timevalue/read-cache.json (from read-jobs --collect) and merge it
 * over the code reads. Missing cache → code reads only.
 * @returns Map doc_id → read
 */
export function loadReadCache(dir, codeReads = []) {
  const file = join(dir, 'read-cache.json');
  let llm = [];
  if (existsSync(file)) {
    try { llm = JSON.parse(readFileSync(file, 'utf8')).reads || []; } catch (e) { throw new Error(`${file}: ${e.message}`); }
  }
  return mergeReads(codeReads, llm);
}

// ---------------------------------------------------------------- baseline

/**
 * Mean pressure per team (or channel when the author is unknown).
 * Small teams are shrunk toward the global mean: mean = (Σp + k·global) / (n + k), k = prior.
 * @param reads     iterable of reads (array or Map values) carrying `team` (code reads do)
 * @param _settings unused; kept so existing callers (demo.mjs) need not change
 * @returns {global, prior, teams: {key: {mean, n}}, of(read) → baseline, relative(read) → pressure − baseline}
 */
export function teamBaseline(reads, _settings, { prior = 5 } = {}) {
  const list = reads instanceof Map ? [...reads.values()] : [...(reads || [])];
  const sums = new Map();
  let total = 0;
  for (const r of list) {
    const key = r.team || `container:${r.container}`;
    const s = sums.get(key) || { sum: 0, n: 0 };
    s.sum += r.pressure || 0;
    s.n += 1;
    sums.set(key, s);
    total += r.pressure || 0;
  }
  const global = list.length ? total / list.length : 0;
  const teams = {};
  for (const [key, { sum, n }] of [...sums.entries()].sort()) {
    teams[key] = { mean: round3((sum + prior * global) / (n + prior)), n };
  }
  const of = (r) => teams[r.team || `container:${r.container}`]?.mean ?? round3(global);
  return {
    global: round3(global),
    prior,
    teams,
    of,
    relative: (r) => round3((r.pressure || 0) - of(r)),
  };
}

function round3(x) {
  return Math.round(x * 1000) / 1000;
}
