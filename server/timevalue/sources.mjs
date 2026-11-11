// Load the rendered Flintlock sources (fixtures/flintlock/ layout) into one normalized shape.
// Contract: docs/build/time-value-impl.md, "server/timevalue/sources.mjs".
//
//   loadSources(dir) -> { docs, xometry: {quotes, orders}, ramp: {transactions, bills},
//                         calendar: [{uid, summary, start, end, attendees, categories, ...}],
//                         demo: {partEntry, quote, policy, liveChanges}, people }
//   docsBefore(docs, T, days) -> docs with T - days <= at < T (days null/undefined: everything before T)
//
// Every missing file or directory yields empty data, never a throw.
// doc = { id, source, container, thread, author: {name, email, slack_id}, at, text, ...extras }
//   slack    slack:<channel>:<ts>          container channel id, thread thread_ts || ts
//   jira     jira:<key>:desc | :c<id> | :h<historyId>   container/thread = ticket key; :h = field changes
//   meeting  meeting:<file>:<line>         container/thread = file name without .md; <line> is 1-based.
//            Transcript lines "[mm:ss] Name: text" are at start + offset; notes bullets "- Name: text"
//            (any section but Overview, which only repeats them) are at start + duration.
//   calendar cal:<uid>                     at = LAST-MODIFIED when present, else DTSTART
// All `at` are ISO 8601 with the Pacific offset of that instant (Jira keeps its own offset), sorted by (instant, id).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// ---------- Pacific time ----------
// US rule: PDT from the 2nd Sunday of March 02:00 PST (10:00Z) to the 1st Sunday of November 02:00 PDT (09:00Z).
function nthSunday(year, month /* 0-based */, n) {
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
  return 1 + ((7 - first) % 7) + 7 * (n - 1);
}
export function pacificOffsetMinutesAt(ms) {
  const y = new Date(ms).getUTCFullYear();
  const start = Date.UTC(y, 2, nthSunday(y, 2, 2), 10);
  const end = Date.UTC(y, 10, nthSunday(y, 10, 1), 9);
  return ms >= start && ms < end ? -420 : -480;
}
// local wall-clock (Pacific) -> epoch ms. Ambiguous/missing hours resolve like the standard rule.
export function pacificLocalToMs(y, mo, d, h = 0, mi = 0, s = 0) {
  const naive = Date.UTC(y, mo - 1, d, h, mi, s);
  let ms = naive + 480 * 60e3; // assume PST
  if (pacificOffsetMinutesAt(ms) === -420) {
    const pdt = naive + 420 * 60e3;
    if (pacificOffsetMinutesAt(pdt) === -420) ms = pdt;
  }
  return ms;
}
const p2 = (n) => String(n).padStart(2, '0');
export function toPacificIso(ms) {
  const off = pacificOffsetMinutesAt(ms);
  const t = new Date(ms + off * 60e3);
  const sign = off < 0 ? '-' : '+';
  const a = Math.abs(off);
  return `${t.getUTCFullYear()}-${p2(t.getUTCMonth() + 1)}-${p2(t.getUTCDate())}T${p2(t.getUTCHours())}:${p2(t.getUTCMinutes())}:${p2(t.getUTCSeconds())}${sign}${p2(Math.floor(a / 60))}:${p2(a % 60)}`;
}

// ---------- io ----------
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}
function readText(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}
function listDir(dir) {
  try {
    return readdirSync(dir).filter((f) => !f.startsWith('.')).sort();
  } catch {
    return [];
  }
}

// ---------- people directory ----------
function buildDirectory(dir) {
  const byEmail = new Map();
  const bySlack = new Map();
  const byName = new Map();
  const add = (p) => {
    const key = p.email ? p.email.toLowerCase() : null;
    let cur = (key && byEmail.get(key)) || (p.slack_id && bySlack.get(p.slack_id)) || null;
    if (!cur) cur = { name: null, email: null, slack_id: null, jira_account_id: null };
    for (const k of Object.keys(cur)) if (cur[k] == null && p[k] != null) cur[k] = p[k];
    if (cur.email) byEmail.set(cur.email.toLowerCase(), cur);
    if (cur.slack_id) bySlack.set(cur.slack_id, cur);
    if (cur.name && !byName.has(cur.name.toLowerCase())) byName.set(cur.name.toLowerCase(), cur);
  };
  const su = readJson(join(dir, 'slack', 'users.json'));
  for (const u of su?.members || []) {
    add({ name: u.real_name || u.profile?.real_name || u.name || null, email: u.profile?.email || null, slack_id: u.id, display: u.name });
    if (u.name && !byName.has(u.name.toLowerCase())) byName.set(u.name.toLowerCase(), bySlack.get(u.id));
  }
  const ju = readJson(join(dir, 'jira', 'users.json'));
  for (const u of Array.isArray(ju) ? ju : ju?.users || []) {
    add({ name: u.displayName || null, email: u.emailAddress || null, jira_account_id: u.accountId || null });
  }
  // first names as a last resort for meeting notes ("- Zoe: ..."), only when unique
  const first = new Map();
  for (const p of new Set(byEmail.values())) {
    const f = p.name?.split(/\s+/)[0]?.toLowerCase();
    if (f) first.set(f, first.has(f) ? null : p);
  }
  const author = (p) => (p ? { name: p.name, email: p.email, slack_id: p.slack_id } : null);
  return {
    people: [...new Set(byEmail.values())].sort((a, b) => (a.email < b.email ? -1 : 1)),
    bySlack: (id) => author(bySlack.get(id)),
    byEmail: (e) => author(e ? byEmail.get(e.toLowerCase()) : null),
    byName: (n) => {
      if (!n) return null;
      const k = n.trim().toLowerCase();
      return author(byName.get(k) || first.get(k) || null);
    },
  };
}

// ---------- Slack ----------
function slackTsToMs(ts) {
  const [s, frac = '0'] = String(ts).split('.');
  return Number(s) * 1000 + Math.floor(Number(frac.padEnd(6, '0').slice(0, 6)) / 1000);
}
function loadSlack(dir, people) {
  const sdir = join(dir, 'slack');
  const docs = [];
  const chMeta = new Map();
  for (const c of readJson(join(sdir, 'channels.json'))?.channels || []) chMeta.set(c.id, c);
  for (const f of listDir(sdir)) {
    if (!/^[CDG][A-Z0-9]+\.json$/.test(f)) continue;
    const channel = f.slice(0, -5);
    const data = readJson(join(sdir, f));
    for (const m of data?.messages || []) {
      if (!m || m.ts == null) continue;
      const a = (m.user && people.bySlack(m.user)) ||
        { name: m.user_profile?.real_name || m.username || null, email: m.user_profile?.email || null, slack_id: m.user || null };
      const ms = slackTsToMs(m.ts);
      docs.push({
        id: `slack:${channel}:${m.ts}`,
        source: 'slack',
        container: channel,
        channel_name: chMeta.get(channel)?.name ?? null,
        thread: m.thread_ts || m.ts,
        author: a,
        at: toPacificIso(ms),
        text: m.text ?? '',
        ...(m.subtype ? { subtype: m.subtype } : {}),
        ...(m.bot_id ? { bot: true } : {}),
        ...(m.reactions?.length ? { reactions: m.reactions.map((r) => ({ name: r.name, count: r.count ?? r.users?.length ?? 0, users: r.users || [] })) } : {}),
        _ms: ms,
      });
    }
  }
  return docs;
}

// ---------- Jira ----------
// "2026-08-17T13:24:09.201-0700" -> "2026-08-17T13:24:09-07:00" (same instant to the second, same offset)
export function jiraTime(s) {
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})$/.exec(s);
  if (!m) return s;
  const off = m[2] === 'Z' ? '+00:00' : m[2].includes(':') ? m[2] : `${m[2].slice(0, 3)}:${m[2].slice(3)}`;
  return `${m[1]}${off}`;
}
export function adfText(node) {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(adfText).join('');
  if (node.type === 'text') return node.text || '';
  if (node.type === 'hardBreak') return '\n';
  if (node.type === 'mention') return node.attrs?.text || '';
  const inner = adfText(node.content || []);
  return ['paragraph', 'heading', 'listItem', 'codeBlock', 'blockquote'].includes(node.type) ? inner + '\n' : inner;
}
function jiraAuthor(u, people) {
  if (!u) return null;
  return people.byEmail(u.emailAddress) || { name: u.displayName || null, email: u.emailAddress || null, slack_id: null };
}
function loadJira(dir, people) {
  const jdir = join(dir, 'jira');
  const docs = [];
  const tickets = [];
  for (const f of listDir(jdir)) {
    if (!/^[A-Z][A-Z0-9]*\.json$/.test(f)) continue;
    const data = readJson(join(jdir, f));
    for (const issue of data?.issues || []) {
      const key = issue.key;
      const fl = issue.fields || {};
      const base = { source: 'jira', container: key, thread: key, project: fl.project?.key ?? f.slice(0, -5), summary: fl.summary ?? '' };
      tickets.push({
        key, project: base.project, summary: fl.summary ?? '', type: fl.issuetype?.name ?? null, status: fl.status?.name ?? null,
        priority: fl.priority?.name ?? null, labels: fl.labels || [], components: (fl.components || []).map((c) => c.name ?? c),
        created: jiraTime(fl.created), updated: jiraTime(fl.updated), duedate: fl.duedate ?? null,
        reporter: jiraAuthor(fl.reporter, people), assignee: jiraAuthor(fl.assignee, people),
        issuelinks: (fl.issuelinks || []).map((l) => ({
          type: l.type?.name ?? null,
          direction: l.outwardIssue ? 'outward' : 'inward',
          label: l.outwardIssue ? l.type?.outward ?? null : l.type?.inward ?? null,
          key: (l.outwardIssue || l.inwardIssue)?.key ?? null,
        })),
      });
      const desc = adfText(fl.description).trim();
      if (fl.created) {
        docs.push({
          ...base, id: `jira:${key}:desc`, kind: 'description', author: jiraAuthor(fl.reporter, people),
          at: jiraTime(fl.created), text: desc || fl.summary || '',
        });
      }
      for (const c of fl.comment?.comments || []) {
        docs.push({
          ...base, id: `jira:${key}:c${c.id}`, kind: 'comment', author: jiraAuthor(c.author, people),
          at: jiraTime(c.created), text: adfText(c.body).trim(),
        });
      }
      for (const h of issue.changelog?.histories || []) {
        const items = (h.items || []).map((it) => ({ field: it.field, from: it.fromString ?? it.from ?? null, to: it.toString ?? it.to ?? null }));
        if (!items.length) continue;
        docs.push({
          ...base, id: `jira:${key}:h${h.id}`, kind: 'field_change', author: jiraAuthor(h.author, people),
          at: jiraTime(h.created), text: items.map((i) => `${i.field}: ${i.from ?? '(none)'} -> ${i.to ?? '(none)'}`).join('; '),
          changes: items,
        });
      }
    }
  }
  for (const d of docs) d._ms = Date.parse(d.at);
  return { docs, tickets: tickets.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)) };
}

// ---------- meetings ----------
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
export function parseMeeting(text, file, people) {
  const name = file.replace(/\.md$/, '');
  const lines = text.split(/\r?\n/);
  let startMs = null;
  let durationMin = null;
  let title = null;
  let participants = [];
  const header = {};
  for (const line of lines) {
    if (!title && /^#\s+/.test(line)) title = line.replace(/^#\s+/, '').trim();
    const h = /^-\s+\*\*(.+?):\*\*\s*(.*)$/.exec(line);
    if (h) header[h[1].toLowerCase()] = h[2].trim();
  }
  const dm = /(\w{3})\w*\s+(\d{1,2}),\s+(\d{4})\D+?(\d{1,2}):(\d{2})\s*([AP]M)/i.exec(header.date || '');
  if (dm && MONTHS[dm[1].toLowerCase()]) {
    let hr = Number(dm[4]) % 12;
    if (dm[6].toUpperCase() === 'PM') hr += 12;
    startMs = pacificLocalToMs(Number(dm[3]), MONTHS[dm[1].toLowerCase()], Number(dm[2]), hr, Number(dm[5]));
  } else {
    const fm = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})/.exec(name);
    if (fm) startMs = pacificLocalToMs(+fm[1], +fm[2], +fm[3], +fm[4], +fm[5]);
  }
  const dur = /(\d+)\s*min/.exec(header.duration || '');
  if (dur) durationMin = Number(dur[1]);
  participants = (header.participants || '').split(',').map((s) => s.trim()).filter(Boolean);
  const meeting = {
    file: name, title, start: startMs == null ? null : toPacificIso(startMs), duration_min: durationMin,
    notes_by: header['notes by'] ?? null, participants, joined_late: (header['joined late'] || '').split(',').map((s) => s.trim()).filter(Boolean),
  };
  if (startMs == null) return { meeting, docs: [] };
  const endMs = startMs + (durationMin ?? 0) * 60e3;
  const docs = [];
  let section = null;
  let last = null;
  lines.forEach((line, i) => {
    const sec = /^##\s+(.+)$/.exec(line);
    if (sec) { section = sec[1].trim().toLowerCase(); last = null; return; }
    if (!section || section === 'overview') return;
    const tr = /^\[(?:(\d+):)?(\d+):(\d{2})\]\s*([^:]+?):\s?(.*)$/.exec(line);
    const nb = /^\s*[-*]\s+(?:\[[ xX]\]\s+)?([^:*]{1,60}?):\s+(.*)$/.exec(line);
    let off = null, who = null, body = null, kind = null;
    if (tr) {
      off = ((Number(tr[1] || 0) * 60 + Number(tr[2])) * 60 + Number(tr[3])) * 1000;
      who = tr[4]; body = tr[5]; kind = 'transcript';
    } else if (nb) {
      who = nb[1]; body = nb[2]; kind = 'notes';
    } else if (line.trim() && last && !/^[-*#[]/.test(line.trim())) {
      last.text += `\n${line.trim()}`; // continuation of the previous line
      return;
    } else {
      last = null;
      return;
    }
    const ms = off != null ? startMs + off : endMs;
    const author = people.byName(who) || { name: who.trim(), email: null, slack_id: null };
    last = {
      id: `meeting:${name}:${i + 1}`, source: 'meeting', container: name, thread: name, kind, section,
      author, at: toPacificIso(ms), text: body, _ms: ms,
    };
    docs.push(last);
  });
  return { meeting, docs };
}
function loadMeetings(dir, people) {
  const mdir = join(dir, 'meetings');
  const docs = [];
  const meetings = [];
  for (const f of listDir(mdir)) {
    if (!f.endsWith('.md')) continue;
    const text = readText(join(mdir, f));
    if (text == null) continue;
    const r = parseMeeting(text, f, people);
    meetings.push(r.meeting);
    docs.push(...r.docs);
  }
  return { docs, meetings };
}

// ---------- calendar (.ics) ----------
function icsUnescape(s) {
  return s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
}
function icsTime(value, params) {
  if (!value) return { iso: null, ms: null, allDay: false };
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (m || params.VALUE === 'DATE') {
    m = m || /^(\d{4})(\d{2})(\d{2})/.exec(value);
    const ms = pacificLocalToMs(+m[1], +m[2], +m[3]);
    return { iso: toPacificIso(ms), ms, allDay: true, date: `${m[1]}-${m[2]}-${m[3]}` };
  }
  m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value);
  if (!m) return { iso: null, ms: null, allDay: false };
  const ms = m[7] === 'Z'
    ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])
    : pacificLocalToMs(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6]); // TZID America/Los_Angeles or floating
  return { iso: toPacificIso(ms), ms, allDay: false };
}
export function parseIcs(text) {
  const unfolded = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const events = [];
  let ev = null;
  for (const line of unfolded) {
    if (line === 'BEGIN:VEVENT') { ev = { props: [] }; continue; }
    if (line === 'END:VEVENT') { if (ev) events.push(ev); ev = null; continue; }
    if (!ev) continue;
    const colon = line.search(/:(?=(?:[^"]*"[^"]*")*[^"]*$)/);
    if (colon < 0) continue;
    const [name, ...paramParts] = line.slice(0, colon).split(';');
    const params = {};
    for (const p of paramParts) {
      const eq = p.indexOf('=');
      if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
    }
    ev.props.push({ name: name.toUpperCase(), params, value: line.slice(colon + 1) });
  }
  return events.map(({ props }) => {
    const one = (n) => props.find((p) => p.name === n);
    const val = (n) => (one(n) ? icsUnescape(one(n).value) : null);
    const s = icsTime(one('DTSTART')?.value, one('DTSTART')?.params || {});
    const e = icsTime(one('DTEND')?.value, one('DTEND')?.params || {});
    const lm = icsTime(one('LAST-MODIFIED')?.value, {});
    const person = (p) => ({
      name: p.params.CN ?? null, email: p.value.replace(/^mailto:/i, '') || null,
      role: p.params.ROLE ?? null, partstat: p.params.PARTSTAT ?? null,
    });
    const org = one('ORGANIZER');
    return {
      uid: val('UID'),
      summary: val('SUMMARY') ?? '',
      start: s.iso,
      end: e.iso,
      all_day: s.allDay,
      attendees: props.filter((p) => p.name === 'ATTENDEE').map(person),
      categories: props.filter((p) => p.name === 'CATEGORIES').flatMap((p) => p.value.split(',').map((c) => c.trim()).filter(Boolean)),
      organizer: org ? person(org) : null,
      description: val('DESCRIPTION'),
      location: val('LOCATION'),
      status: val('STATUS'),
      rrule: val('RRULE'),
      sequence: one('SEQUENCE') ? Number(one('SEQUENCE').value) : null,
      last_modified: lm.iso,
      _startMs: s.ms,
      _lmMs: lm.ms,
    };
  });
}
function loadCalendar(dir, people) {
  const text = readText(join(dir, 'calendar.ics'));
  if (text == null) return { calendar: [], docs: [] };
  const events = parseIcs(text).filter((e) => e.uid);
  const docs = [];
  const seen = new Map();
  for (const e of events) {
    const ms = e._lmMs ?? e._startMs;
    if (ms == null) continue;
    const n = (seen.get(e.uid) || 0) + 1;
    seen.set(e.uid, n);
    const author = e.organizer
      ? people.byEmail(e.organizer.email) || { name: e.organizer.name, email: e.organizer.email, slack_id: null }
      : null;
    docs.push({
      id: n === 1 ? `cal:${e.uid}` : `cal:${e.uid}#${n}`, source: 'calendar', container: 'calendar', thread: e.uid,
      author, at: toPacificIso(ms), text: [e.summary, e.description].filter(Boolean).join('\n'),
      start: e.start, end: e.end, categories: e.categories, _ms: ms,
    });
  }
  const calendar = events
    .map(({ _startMs, _lmMs, ...rest }) => rest)
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.uid < b.uid ? -1 : 1));
  return { calendar, docs };
}

// ---------- everything ----------
const arr = (x, key) => (Array.isArray(x) ? x : Array.isArray(x?.[key]) ? x[key] : []);

export function loadSources(dir = 'fixtures/flintlock') {
  const people = buildDirectory(dir);
  const slack = loadSlack(dir, people);
  const jira = loadJira(dir, people);
  const meetings = loadMeetings(dir, people);
  const cal = loadCalendar(dir, people);
  const docs = [...slack, ...jira.docs, ...meetings.docs, ...cal.docs];
  docs.sort((a, b) => a._ms - b._ms || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const d of docs) Object.defineProperty(d, '_ms', { value: d._ms, enumerable: false });
  const x = (f) => readJson(join(dir, 'xometry', f));
  const r = (f) => readJson(join(dir, 'ramp', f));
  const demo = (f) => readJson(join(dir, 'demo', f));
  return {
    docs,
    xometry: { quotes: arr(x('quotes.json'), 'quotes'), orders: arr(x('orders.json'), 'orders') },
    ramp: { transactions: arr(r('transactions.json'), 'data'), bills: arr(r('bills.json'), 'data') },
    calendar: cal.calendar,
    demo: {
      partEntry: demo('part-entry.json'),
      quote: demo('quote.json'),
      policy: demo('policy.json'),
      liveChanges: demo('live-changes.json'),
    },
    // extras: the people directory (from slack/jira users), Jira ticket metadata, meeting headers
    people: people.people,
    tickets: jira.tickets,
    meetings: meetings.meetings,
  };
}

const DAY = 86400e3;
const msOf = (x) => (typeof x === 'number' ? x : x instanceof Date ? x.getTime() : Date.parse(x));
const docMs = (d) => d._ms ?? Date.parse(d.at);

// docs with at in [T - days, T); docs must be sorted by time (as loadSources returns them)
export function docsBefore(docs, T, days) {
  const end = msOf(T);
  const start = days == null ? -Infinity : end - days * DAY;
  let lo = 0, hi = docs.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (docMs(docs[mid]) < start) lo = mid + 1; else hi = mid; }
  const out = [];
  for (let i = lo; i < docs.length; i++) {
    const t = docMs(docs[i]);
    if (t >= end) break;
    out.push(docs[i]);
  }
  return out;
}

