// Track 1: progress ranking of the assemblies working toward the same milestone.
//
//   progressRank({settings, sources, claims}, weekStart) -> [{assembly, milestone, done_share, rank, done, total, claim_done}]
//
// done_share = (Jira tickets Done by the week's end + `done` claims about the assembly's items not tied to a Done ticket)
//            / (tickets created before the week's end + those extra claims), per assembly.
// Tickets of a Jira project shared by several assemblies go to the assembly whose items they name (else to all of them).
// Ranked among the assemblies of each milestone: 1 = furthest behind (lowest share). Ties share the order by id.
// Uses only docs with at < week end, so a week's ranking never sees later evidence.

import { makeResolver } from './refs.mjs';
import { extractClaims } from './claims.mjs';
import { instantMs as ms } from './sources.mjs';

const DONE = /^(done|closed|resolved|complete[d]?)$/i;

function statusChange(doc) {
  if (doc.field === 'status' && doc.to != null) return String(doc.to).trim();
  const ch = (doc.changes || []).filter((c) => c.field === 'status' && c.to != null).pop();
  if (ch) return String(ch.to).trim();
  const m = String(doc.text || '').match(/^\s*status\s*:?\s*(?:changed\s+)?(?:from\s+)?"?([^"\n]*?)"?\s*(?:->|→|\bto\b)\s*"?([^"\n]+?)"?\s*$/i);
  return m ? m[2].trim() : null;
}

export function progressRank({ settings, sources, claims }, weekStart) {
  if (!settings) throw new TypeError('progressRank: settings is required');
  const start = ms(weekStart);
  if (!Number.isFinite(start)) throw new RangeError(`progressRank: weekStart ${JSON.stringify(weekStart)} is not a date`);
  const end = start + 7 * 864e5;
  sources = sources || {};
  const docs = (sources.docs || []).filter((d) => ms(d.at) < end);
  const resolve = makeResolver(settings, { xometry: sources.xometry, calendar: sources.calendar });
  const asmById = new Map((settings.assemblies || []).map((a) => [a.id, a]));
  const asmOfItem = resolve.assembliesOf;

  // Tickets: created (desc doc) and last status before the week end.
  const tickets = new Map();
  for (const d of docs) {
    if (d.source !== 'jira') continue;
    const key = d.container;
    const t = tickets.get(key) || { key, created: null, status: null, refs: new Set() };
    if (/:desc$/.test(d.id)) t.created = d.at;
    const st = statusChange(d); if (st) t.status = st;
    if (!st) for (const r of resolve(d.text || '', { container: key, at: d.at })) if (!r.ambiguous) for (const a of (r.assembly ? [r.assembly] : asmOfItem(r.id))) t.refs.add(a);
    tickets.set(key, t);
  }
  const stats = new Map((settings.assemblies || []).map((a) => [a.id, { done: 0, total: 0, claim_done: 0, tickets: new Set() }]));
  for (const t of tickets.values()) {
    if (!t.created) continue;
    const proj = t.key.split('-')[0];
    const owners = (settings.assemblies || []).filter((a) => a.jira_project === proj).map((a) => a.id);
    if (!owners.length) continue;
    const named = owners.filter((a) => t.refs.has(a));
    for (const a of named.length ? named : owners) {
      const s = stats.get(a); s.total++; s.tickets.add(t.key);
      if (t.status && DONE.test(t.status)) s.done++;
    }
  }
  // Done claims (Slack, meetings, Jira comments) about an assembly's items, not already a Done ticket.
  const doneTickets = new Set([...tickets.values()].filter((t) => t.status && DONE.test(t.status)).map((t) => t.key));
  const cl = (claims || docs.flatMap((d) => extractClaims(d, resolve, { people: settings.people }).map((c) => ({ ...c, container: d.container }))))
    .filter((c) => c.kind === 'done' && ms(c.at) < end);
  const seen = new Set();
  for (const c of cl) {
    if (c.container && doneTickets.has(c.container)) continue;
    const asms = c.subject && String(c.subject).startsWith('wk:') ? [] : asmOfItem(c.subject);
    for (const a of asms) {
      const k = `${a}|${c.subject}`; if (seen.has(k) || !stats.has(a)) continue; seen.add(k);
      const s = stats.get(a); s.claim_done++;
    }
  }
  const out = [];
  for (const m of settings.milestones || []) {
    const rows = (m.assemblies || []).filter((a) => asmById.has(a)).map((a) => {
      const s = stats.get(a);
      const total = s.total + s.claim_done;
      return { assembly: a, milestone: m.id, done: s.done + s.claim_done, total, claim_done: s.claim_done, done_share: total ? (s.done + s.claim_done) / total : null };
    });
    const ranked = rows.filter((r) => r.done_share != null).sort((a, b) => a.done_share - b.done_share || a.assembly.localeCompare(b.assembly));
    ranked.forEach((r, i) => { r.rank = i + 1; });
    for (const r of rows) { if (r.done_share == null) r.rank = null; out.push(r); }
  }
  return out.sort((a, b) => a.milestone.localeCompare(b.milestone) || (a.rank ?? 99) - (b.rank ?? 99) || a.assembly.localeCompare(b.assembly));
}
