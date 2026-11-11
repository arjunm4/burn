// Jira renderer: project-week ticket batches, then issues in the Jira REST shape (plain-text descriptions, v2 style).
//
//   plan(world, ctx) -> {records, jobs}     records = {projects, users, issues}; status, due date, changelog,
//                                           links and comment times fixed here (as of demo_now)
//   emit(records, texts, ctx) -> {files}    texts = {<key>: {summary, description}, <comment id>: body}
//
// Tickets are rendered only when created inside the text window (spec §3.5); a crumb-bearing ticket without a
// summary falls back to code text, a background ticket without one is dropped (and links to it removed).
import { addDays } from '../lib/calendar.mjs';
import { cmp } from '../lib/io.mjs';
import { STYLE_RULES, crumbSpec, datePhrase, jobPerson, personOf, priorityOf, textWeeks, weekOf } from './slack.mjs';

const FILLER_COMMENTS = ['status fragment, e.g. waiting on vendor or on a review', 'any update?', 'short progress note', 'question to the assignee', 'notes photos or a file are in slack', 'pushes it a bit, no new date given'];
const CATEGORY = { 'To Do': ['new', 'To Do'], 'In Progress': ['indeterminate', 'In Progress'], Blocked: ['indeterminate', 'In Progress'], 'In Review': ['indeterminate', 'In Progress'], Done: ['done', 'Done'] };
const LINK = { blocks: ['Blocks', 'outward'], is_blocked_by: ['Blocks', 'inward'], relates_to: ['Relates', 'outward'] };

export function jiraTime(iso, msPart) {
  return `${iso.slice(0, 19)}.${String(msPart).padStart(3, '0')}${iso.slice(19, 22)}${iso.slice(23, 25)}`;
}
const asOf = (hist, t) => { let v = null; for (const h of hist || []) if (Date.parse(h.known_at) <= t) v = h; return v; };

export function plan(world, ctx) {
  const person = personOf(world);
  const now = Date.parse(ctx.demoNow);
  const weeks = new Set(textWeeks(ctx.demoNow, ctx.weeks));
  const evById = new Map(world.events.map((e) => [e.id, e]));
  const projects = world.jira_projects.slice().sort((a, b) => cmp(a.id, b.id));
  const projIndex = new Map(projects.map((p, i) => [p.id, i + 1]));
  const demo = world.demo || {};
  const demoEntities = new Set([demo.part, demo.test, demo.milestone, demo.motor && demo.motor.deliverable].filter(Boolean));
  const demoStart = demo.context_window ? Date.parse(demo.context_window.start) : Infinity;
  const issues = [];
  const batches = new Map();

  // A ticket created before the text window is carried in when a crumb comment on it falls inside the
  // window, so that crumb is never lost (spec I16). Its job stays keyed by its creation week.
  const start = Date.parse(ctx.textStart);
  const carried = new Set(world.events.filter((e) => e.source === 'jira' && e.kind === 'crumb' && e.where.ticket_field === 'comment'
    && Date.parse(e.known_at) >= start && Date.parse(e.known_at) <= now).map((e) => e.where.ticket));
  const tickets = world.tickets.filter((t) => Date.parse(t.created) <= now && (weeks.has(weekOf(t.created)) || carried.has(t.id)))
    .sort((a, b) => cmp(a.created, b.created) || cmp(a.id, b.id));
  for (const t of tickets) {
    const r = ctx.rng.fork(t.id);
    const num = +t.id.split('-')[1];
    const evs = world.events.filter((e) => e.source === 'jira' && e.where.ticket === t.id && Date.parse(e.known_at) <= now)
      .sort((a, b) => cmp(a.known_at, b.known_at) || cmp(a.id, b.id));
    const own = evs.filter((e) => e.where.ticket_field === 'created' || e.where.ticket_field === 'description');
    const ownSpecs = own.map((e) => crumbSpec(e, world, r.fork(e.id)));
    const ownCrumb = own.filter((e) => e.kind === 'crumb');
    const must = [...new Set(ownSpecs.flatMap((s) => s.must_mention))];
    // Comments: comment events, due-date edits by people (the example's pattern), then filler.
    const comments = [];
    for (const e of evs.filter((x) => x.where.ticket_field === 'comment')) {
      const s = crumbSpec(e, world, r.fork(e.id));
      comments.push({ at: e.known_at, by: e.by, events: [e.id], kind: e.kind, brief: e.kind === 'background' ? `background: ${e.brief}` : e.brief, must_mention: s.must_mention, ...(s.claim ? { claim: s.claim } : {}), ...(s.fallback_text ? { fallback_text: s.fallback_text } : {}) });
    }
    const dues = (t.due_date || []).filter((h) => Date.parse(h.known_at) <= now);
    for (let i = 1; i < dues.length; i++) {
      const h = dues[i];
      if (!h.by) continue;
      const cr = r.fork(`due:${i}`);
      const ev = h.where ? evById.get(h.where) : null;
      if (!ev && !cr.chance(0.5)) continue;
      const phrase = h.value ? datePhrase(h.value, cr) : null;
      const crumb = !!ev && ev.kind === 'crumb';
      comments.push({
        at: h.known_at, by: h.by, events: ev ? [ev.id] : [], kind: crumb ? 'crumb' : 'background',
        brief: crumb ? `${person(h.by).display_name} changes the due date to ${h.value || 'none'}: ${ev.brief}` : 'background: short note on why the due date moved (no date)',
        must_mention: crumb && phrase ? [phrase] : [],
        ...(crumb ? { fallback_text: phrase ? `due date moved to ${phrase}` : 'cleared due date' } : {}),
      });
    }
    const target = r.weighted([[0, 45], [r.int(1, 3), 40], [r.int(4, 6), 15]]);
    const doneAt = (t.status || []).find((h) => h.value === 'Done');
    const until = Math.min(now, doneAt ? Date.parse(doneAt.known_at) + 3 * 864e5 : Date.parse(t.created) + 30 * 864e5);
    const team = (world.teams.find((x) => x.id === projects.find((p) => p.id === t.project)?.team)?.members || []);
    const authors = [...new Set([t.assignee, t.reporter, ...team].filter(Boolean))];
    for (let i = comments.length; i < target; i++) {
      const cr = r.fork(`c:${i}`);
      const span = until - Date.parse(t.created);
      if (span < 3600e3) break;
      const at = toLocal(Date.parse(t.created) + cr.int(1800, Math.floor(span / 1000)) * 1000);
      comments.push({ at, by: cr.chance(0.6) ? (t.assignee || t.reporter) : cr.pick(authors), events: [], kind: 'background', brief: `background: ${cr.pick(FILLER_COMMENTS)}`, must_mention: [] });
    }
    comments.sort((a, b) => cmp(a.at, b.at) || cmp(a.events.join(), b.events.join()));
    comments.forEach((c, i) => { c.id = `${t.id}-c${i + 1}`; c.num = String(10000 * (projIndex.get(t.project) || 0) + num * 20 + i + 1); });
    const crumbTicket = ownCrumb.length > 0 || comments.some((c) => c.kind === 'crumb');
    const descLen = ownCrumb.length ? r.weighted([['one_line', 60], ['short', 25], ['medium', 15]]) : r.weighted([['empty', 35], ['one_line', 40], ['medium', 15], ['long', 10]]);
    // Changelog: status and due-date changes after creation, as of demo_now.
    const changelog = [];
    const st = (t.status || []).filter((h) => Date.parse(h.known_at) <= now);
    for (let i = 1; i < st.length; i++) changelog.push({ at: st[i].known_at, by: st[i].by, field: 'status', from: st[i - 1].value, to: st[i].value });
    for (let i = 1; i < dues.length; i++) changelog.push({ at: dues[i].known_at, by: dues[i].by, field: 'duedate', from: dues[i - 1].value, to: dues[i].value });
    changelog.sort((a, b) => cmp(a.at, b.at) || cmp(a.field, b.field));
    changelog.forEach((c, i) => { c.id = String(100000 * (projIndex.get(t.project) || 0) + num * 20 + i + 1); });
    const status = asOf(t.status, now);
    const due = asOf(t.due_date, now);
    const times = [t.created, ...changelog.map((c) => c.at), ...comments.map((c) => c.at)].sort();
    const week = weekOf(t.created);
    // A carried ticket gets its own job so --weeks 1 jobs stay byte-identical inside --weeks 13.
    const part = weeks.has(week) ? (crumbTicket ? "crumbs" : "background") : `carried-${t.id}`;
    const jobId = `jira-${t.project}-${week}-${part}`;
    const tok = must[0] || (t.order ? 'order' : t.type.toLowerCase());
    const ownFallback = ownSpecs.map((s) => s.fallback_text).filter(Boolean).join('. ');
    const issue = {
      key: t.id, id: String(10000 * (projIndex.get(t.project) || 0) + num), project: t.project, week, job_id: jobId,
      kind: crumbTicket ? 'crumb' : 'background', events: own.map((e) => e.id), ...(weeks.has(week) ? {} : { carried: true }),
      type: t.type, status: status ? status.value : 'To Do', priority: t.priority,
      reporter: t.reporter, assignee: t.assignee || null, labels: (t.labels || []).slice(), components: (t.components || []).slice(),
      parent: t.parent || null, created: jiraTime(t.created, r.int(0, 999)), updated: jiraTime(times[times.length - 1], r.int(0, 999)),
      created_iso: t.created, duedate: due ? due.value : null,
      links: (t.links || []).map((l) => ({ type: l.type, key: l.key })),
      changelog, comments, must_mention: must, description_length: descLen,
      fallback: crumbTicket ? { summary: ownCrumb.length ? ownFallback.split(' ').slice(0, 8).join(' ') : `${t.type} ${t.id.split('-')[0].toLowerCase()} ${tok}`, description: ownFallback } : null,
      brief: [t.brief, ...own.map((e) => e.brief)].filter(Boolean).join(' / '),
      demo: own.concat(evs).some((e) => (e.refs || []).some((x) => demoEntities.has(x.id)) || (e.claim && demoEntities.has(e.claim.subject))) && Date.parse(t.created) >= demoStart - 0,
    };
    if (issue.fallback && issue.fallback.summary && must.length && !must.every((m) => (issue.fallback.summary + ' ' + issue.fallback.description).includes(m))) issue.fallback.description += ` (${must.join(', ')})`;
    issues.push(issue);
    (batches.get(jobId) || batches.set(jobId, []).get(jobId)).push(issue);
  }

  const jobs = [];
  for (const [jobId, list] of [...batches.entries()].sort((a, b) => cmp(a[0], b[0]))) {
    const p = projects.find((x) => x.id === list[0].project);
    const background = list[0].kind === 'background';
    const ids = new Set();
    for (const i of list) { ids.add(i.reporter); if (i.assignee) ids.add(i.assignee); for (const c of i.comments) ids.add(c.by); }
    jobs.push({
      job_id: jobId, source: 'jira', status: 'blank',
      priority: !background && list.some((i) => i.demo) ? 0 : priorityOf(list[0].week, ctx.demoNow, background),
      style_rules: STYLE_RULES.jira,
      project: { id: p.id, name: p.name },
      week: { start: list[0].week, end: addDays(list[0].week, 6) },
      people: [...ids].filter(Boolean).sort().map((id) => jobPerson(person(id))),
      forbidden: background
        ? ['hidden reasons', 'facts not in the briefs', 'changing status or due dates (code owns them)', 'part numbers, quote ids, order numbers, Jira keys other than those in this job', 'dollar amounts of $50 or more', 'explicit dates']
        : ['hidden reasons', 'facts not in the briefs', 'changing status or due dates (code owns them)', 'stating which shipping tier was chosen'],
      tickets: list.map((i) => ({
        key: i.key, type: i.type, status: i.status, reporter: i.reporter, assignee: i.assignee, labels: i.labels, priority: i.priority,
        created: i.created_iso, due_date: i.duedate, events: i.events, brief: i.brief, must_mention: i.must_mention,
        description_length: i.description_length, summary: null, description: null,
        comments: i.comments.map((c) => ({ id: c.id, by: c.by, at: c.at, events: c.events, brief: c.brief, ...(c.claim ? { claim: c.claim } : {}), must_mention: c.must_mention, body: null })),
      })),
    });
  }
  for (const i of issues) delete i.demo;
  const users = world.people.slice().sort((a, b) => cmp(a.id, b.id)).map((p) => ({ id: p.id, accountId: p.jira_account_id, displayName: p.name, emailAddress: p.email, active: !p.end_date }));
  return {
    records: { projects: projects.map((p) => ({ key: p.id, id: String(10000 + projIndex.get(p.id)), name: p.name, lead: p.lead })), users, issues: issues.sort((a, b) => cmp(a.project, b.project) || (+a.key.split('-')[1]) - (+b.key.split('-')[1])) },
    jobs,
  };
}

function toLocal(ms) {
  const y = new Date(ms).getUTCFullYear();
  const sun = (m, n) => { const d = new Date(Date.UTC(y, m, 1)).getUTCDay(); return 1 + ((7 - d) % 7) + 7 * (n - 1); };
  const pdt = ms >= Date.UTC(y, 2, sun(2, 2), 10) && ms < Date.UTC(y, 10, sun(10, 1), 9);
  return new Date(ms - (pdt ? 7 : 8) * 3600e3).toISOString().slice(0, 19) + (pdt ? '-07:00' : '-08:00');
}

export function emit(records, texts, ctx) {
  const start = Date.parse(ctx.textStart);
  const users = new Map(records.users.map((u) => [u.id, u]));
  const userObj = (id) => { const u = users.get(id); return u ? { accountId: u.accountId, displayName: u.displayName, emailAddress: u.emailAddress, active: u.active } : null; };
  const automation = { accountId: '557058:automation', displayName: 'Automation for Jira', active: true };
  const kept = [];
  for (const i of records.issues) {
    if (Date.parse(i.created_iso) < start && !i.carried) continue;
    const t = texts[i.key];
    let summary, description;
    if (t && typeof t.summary === 'string' && t.summary.trim()) { summary = t.summary; description = typeof t.description === 'string' ? t.description : ''; }
    else if (i.fallback) { summary = i.fallback.summary; description = i.fallback.description; }
    else continue;
    kept.push({ i, summary, description });
  }
  const live = new Set(kept.map((k) => k.i.key));
  const byProject = new Map(records.projects.map((p) => [p.key, []]));
  for (const { i, summary, description } of kept) {
    const comments = [];
    for (const c of i.comments) {
      const body = typeof texts[c.id] === 'string' ? texts[c.id] : c.kind === 'crumb' ? c.fallback_text : null;
      if (body == null) continue;
      const t = jiraTime(c.at, Number(c.num) % 1000);
      comments.push({ id: c.num, author: userObj(c.by), body, created: t, updated: t });
    }
    const p = records.projects.find((x) => x.key === i.project);
    const [cat, catName] = CATEGORY[i.status] || CATEGORY['To Do'];
    const issue = {
      id: i.id, key: i.key,
      fields: {
        summary, issuetype: { name: i.type, subtask: i.type === 'Sub-task' }, project: { id: p.id, key: p.key, name: p.name },
        status: { name: i.status, statusCategory: { key: cat, name: catName } }, priority: { name: i.priority },
        assignee: i.assignee ? userObj(i.assignee) : null, reporter: userObj(i.reporter),
        created: i.created, updated: i.updated, duedate: i.duedate, labels: i.labels, components: i.components.map((name) => ({ name })),
        ...(i.parent && live.has(i.parent) ? { parent: { key: i.parent } } : {}),
        issuelinks: i.links.filter((l) => live.has(l.key)).map((l, n) => {
          const [name, dir] = LINK[l.type] || LINK.relates_to;
          const type = name === 'Blocks' ? { name, inward: 'is blocked by', outward: 'blocks' } : { name, inward: 'relates to', outward: 'relates to' };
          return { id: `${i.id}${n + 1}`, type, [dir === 'outward' ? 'outwardIssue' : 'inwardIssue']: { key: l.key } };
        }),
        description: description === '' ? null : description,
        comment: { comments, maxResults: comments.length, total: comments.length, startAt: 0 },
      },
      changelog: { startAt: 0, maxResults: i.changelog.length, total: i.changelog.length, histories: i.changelog.map((c) => ({
        id: c.id, author: c.by ? userObj(c.by) : automation, created: jiraTime(c.at, Number(c.id) % 1000),
        items: [{ field: c.field, fieldtype: 'jira', fromString: c.from, toString: c.to }],
      })) },
    };
    byProject.get(i.project).push(issue);
  }
  const files = [];
  files.push({ path: 'jira/projects.json', content: json(records.projects.map((p) => ({ id: p.id, key: p.key, name: p.name, lead: userObj(p.lead) }))) });
  files.push({ path: 'jira/users.json', content: json(records.users.map((u) => ({ accountId: u.accountId, displayName: u.displayName, emailAddress: u.emailAddress, active: u.active }))) });
  for (const [key, list] of byProject) files.push({ path: `jira/${key}.json`, content: json({ startAt: 0, maxResults: list.length, total: list.length, issues: list }) });
  return { files };
}

function json(v) { return JSON.stringify(v, null, 2) + '\n'; }
