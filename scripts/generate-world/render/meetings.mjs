// Meetings renderer: one text job per recorded meeting inside the text window;
// emits one Fireflies-like Markdown file per meeting under meetings/.
import { toMs, dateOf, md, byId, firstName, resolveCtx, mondayOf, cmpTimeId } from './common-b.mjs';

const STYLE_RULES = [
  'docs/research/data-realism.md#meeting-notes-and-transcripts',
  'docs/research/data-realism.md#fake-looking-patterns-to-avoid-all-sources',
];
const FORBIDDEN = [
  'hidden reasons',
  'dates or facts not in crumbs or the storyline beat',
  'attendees who were not present',
];
const NOTE_TAKER_LABEL = {
  fireflies: 'Fireflies.ai', granola: 'Granola', zoom_ai: 'Zoom AI Companion', manual_doc: 'Shared notes doc', none: 'None',
};

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
}

// The value phrase a writer must say verbatim, from the stated claim value.
export function valuePhrase(claim, world) {
  if (!claim) return null;
  const v = claim.value;
  const isDate = (x) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}/.test(x);
  switch (claim.kind) {
    case 'eta': case 'done': return isDate(v) ? md(v) : null;
    case 'needs': return v && isDate(v.by) ? md(v.by) : null;
    case 'need_earlier': return v && isDate(v.date) ? md(v.date) : null;
    case 'duration': return Array.isArray(v) ? (v[0] === v[1] ? `${v[0]} days` : `${v[0]}-${v[1]} days`) : null;
    case 'stock': return Number.isFinite(v) ? String(v) : null;
    case 'owner': { const p = world.people.find((x) => x.id === v); return p ? firstName(p) : null; }
    case 'substitute': return typeof v === 'string' && !/^[a-z]+-/.test(v) ? v : null;
    default: return null;
  }
}

export function mustMention(ev, world) {
  const out = [];
  for (const r of ev.refs || []) if (r.token && !out.includes(r.token)) out.push(r.token);
  const vp = valuePhrase(ev.claim, world);
  if (vp && !out.includes(vp)) out.push(vp);
  return out;
}

function entityName(world, id) {
  for (const k of ['parts', 'deliverables', 'tests', 'milestones', 'test_rigs', 'resources', 'assemblies', 'work_items']) {
    const e = (world[k] || []).find((x) => x.id === id);
    if (e) return e.name;
  }
  return 'it';
}

function fallbackText(ev, world, mm) {
  const ref = (ev.refs || []).find((r) => r.token)?.token || entityName(world, ev.claim?.subject);
  const vp = valuePhrase(ev.claim, world);
  const verbs = {
    eta: `${ref} is now expected ${vp}`, done: `${ref} done ${vp}`, needs: `we need ${ref} by ${vp}`,
    need_earlier: `${ref} is needed earlier, by ${vp}`, duration: `${ref} should take ${vp}`,
    stock: `we have ${vp} of ${ref} on hand`, owner: `${vp} owns ${ref} now`, substitute: `switching ${ref} to ${vp}`,
    blocked: `${ref} is blocked`,
  };
  let t = verbs[ev.claim?.kind] || `update on ${ref}`;
  if (!vp) t = t.replace(/ (by |now expected |done |earlier, by |should take |of |owns |to )?null/, '');
  for (const s of mm) if (!t.includes(s)) t += ` (${s})`;
  return t.charAt(0).toUpperCase() + t.slice(1) + '.';
}

// What the writer is told about a crumb. A stale or wrong statement's world brief may describe the
// truth ("still quoting rev C (it changed to rev D)"), so for those the brief is rebuilt from the stated
// value only. Any brief also loses parenthetical asides that reveal a change.
const REVEALS = /\([^)]*\b(?:changed|actually|really|in fact|true|truth|stale|wrong|was moved|is now|not yet announced|unannounced)\b[^)]*\)/gi;
function safeBrief(ev, fallback, people) {
  if (ev.truth && ev.truth !== 'true') return `${firstName(people.get(ev.by)) || 'Someone'} says: ${fallback}`;
  return String(ev.brief || '').replace(REVEALS, '').replace(/\s{2,}/g, ' ').trim();
}

function personForJob(p) {
  return { id: p.id, name: p.name, display_name: p.display_name, slack_id: p.slack_id, title: p.title, style: p.style };
}

const DEMO_KEYS = (world) => {
  const d = world.demo || {};
  return new Set([d.part, d.test, d.milestone, d.motor?.deliverable, ...(d.inputs || [])].filter(Boolean));
};

export function plan(world, ctx0 = {}) {
  const ctx = resolveCtx(world, ctx0);
  const nowMs = toMs(ctx.demoNow);
  const startMs = toMs(ctx.textStart);
  const people = byId(world.people);
  const storylines = byId(world.storylines);
  const demoKeys = DEMO_KEYS(world);
  const demoWin = world.demo?.context_window;
  const demoWeek = mondayOf(dateOf(ctx.demoNow));
  const evByMeeting = new Map();
  for (const ev of world.events || []) {
    const m = ev.source === 'meeting' && ev.where?.meeting;
    if (!m) continue;
    if (!evByMeeting.has(m)) evByMeeting.set(m, []);
    evByMeeting.get(m).push(ev);
  }
  const meetings = (world.meetings || [])
    // Recorded meetings, plus unrecorded ones that carry a crumb: someone typed notes (manual_doc),
    // so the crumb is never lost (spec I16). Those notes have no transcript.
    .filter((m) => !m.cancelled && ((m.recorded && m.note_taker !== 'none')
      || (evByMeeting.get(m.id) || []).some((e) => e.kind === 'crumb')))
    .filter((m) => toMs(m.start) >= startMs && toMs(m.start) <= nowMs)
    .sort((a, b) => cmpTimeId(a.start, a.id, b.start, b.id));

  const records = [];
  const jobs = [];
  for (const m of meetings) {
    const start = toMs(m.start);
    const evs = (evByMeeting.get(m.id) || []).slice().sort((a, b) => cmpTimeId(a.known_at, a.id, b.known_at, b.id));
    const crumbs = [];
    const background = [];
    for (const ev of evs) {
      if (ev.kind === 'crumb') {
        const min = Math.max(0, Math.floor((toMs(ev.known_at) - start) / 60000));
        const at = [Math.max(0, min - 3), Math.min(m.actual_min, Math.max(min + 3, Math.max(0, min - 3) + 1))];
        const mm = mustMention(ev, world);
        const fb = fallbackText(ev, world, mm);
        crumbs.push({
          event: ev.id, speaker: ev.by, at_min: at, brief: safeBrief(ev, fb, people),
          claim: { kind: ev.claim.kind, subject: ev.claim.subject, value: ev.claim.value },
          must_mention: mm, fallback_text: fb,
        });
      } else {
        background.push({ event: ev.id, speaker: ev.by, brief: safeBrief(ev, "", people) });
      }
    }
    const week = mondayOf(dateOf(m.start));
    const sls = (m.storylines || []).map((id) => storylines.get(id)).filter(Boolean).map((s) => {
      const beats = (s.beats || []).filter((b) => b.week <= week).sort((a, b) => (a.week < b.week ? -1 : 1));
      return { topic: s.topic, beat: beats.length ? beats[beats.length - 1].summary : null };
    });
    const isDemo = demoWin && toMs(m.start) >= toMs(demoWin.start)
      && evs.some((e) => e.kind === 'crumb' && ((e.refs || []).some((r) => demoKeys.has(r.id)) || demoKeys.has(e.claim?.subject)));
    const weeksBack = Math.round((toMs(demoWeek) - toMs(week)) / (7 * 86400e3));
    const priority = isDemo ? 0 : 1 + 2 * weeksBack + (crumbs.length ? 0 : 1);
    const present = m.present.filter((id) => people.has(id));
    const meeting = {
      id: m.id, title: m.name, type: m.type, note_taker: m.recorded && m.note_taker !== 'none' ? m.note_taker : 'manual_doc',
      start: m.start, actual_min: m.actual_min,
      present, late_joiners: m.late_joiners || [],
    };
    const file = `meetings/${dateOf(m.start)}-${m.start.slice(11, 16).replace(':', '')}-${slug(m.name)}.md`;
    records.push({
      record_id: m.id, source: 'meeting', file, week, priority, meeting,
      external: m.external || [], storylines: sls,
      names: Object.fromEntries(present.map((id) => [id, people.get(id).name])),
      events: evs.map((e) => e.id),
      crumbs: crumbs.map(({ event, speaker, at_min, must_mention, fallback_text }) => ({ event, speaker, at_min, must_mention, fallback_text })),
      background: background.map((b) => b.event),
    });
    jobs.push({
      job_id: `meeting-${m.id}`, source: 'meeting', status: 'blank', priority, style_rules: STYLE_RULES,
      meeting,
      people: present.map((id) => personForJob(people.get(id))),
      storylines: sls,
      crumbs: crumbs.map(({ fallback_text, ...c }) => c),
      background,
      forbidden: FORBIDDEN,
      transcript: null,
      summary: null,
    });
  }
  return { records, jobs };
}

const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function whenLine(iso) {
  const d = dateOf(iso);
  const [y, mo, da] = d.split('-').map(Number);
  const dow = DOW[new Date(Date.UTC(y, mo - 1, da)).getUTCDay()];
  let h = +iso.slice(11, 13);
  const mi = iso.slice(14, 16);
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const tz = iso.endsWith('-07:00') ? 'PDT' : 'PST';
  return `${dow}, ${MON[mo - 1]} ${da}, ${y} · ${h}:${mi} ${ap} ${tz}`;
}

const clean = (s) => String(s ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim();

export function emit(records, texts = {}, ctx = {}) {
  const files = [];
  const people = new Map();
  for (const r of records) for (const p of r.people || []) people.set(p.id, p);
  for (const r of records) {
    const names = ctx.peopleNames || r.names || {};
    const name = (id) => names[id] || people.get(id)?.name || id;
    const t = texts[r.record_id] || null;
    let transcript = Array.isArray(t?.transcript)
      ? t.transcript.filter((x) => x && r.meeting.present.includes(x.speaker) && x.start_s >= 0 && x.start_s < r.meeting.actual_min * 60 && clean(x.text))
      : [];
    const summary = t?.summary || null;
    const textBlob = [JSON.stringify(summary || {}), ...transcript.map((x) => x.text)].join('\n');
    // A crumb whose must_mention strings are missing falls back to its code-written line.
    const fallbacks = r.crumbs.filter((c) => !c.must_mention.every((s) => textBlob.includes(s)));
    if (!transcript.length && !r.crumbs.length) continue; // background-only meeting with no text: dropped
    transcript = transcript.concat(fallbacks.map((c) => ({ start_s: c.at_min[0] * 60 + 7, speaker: c.speaker, text: c.fallback_text })))
      .sort((a, b) => a.start_s - b.start_s || (a.speaker < b.speaker ? -1 : 1));
    const m = r.meeting;
    const L = [];
    L.push(`# ${m.title}`, '');
    L.push(`- **Date:** ${whenLine(m.start)}`);
    L.push(`- **Duration:** ${m.actual_min} min`);
    L.push(`- **Notes by:** ${NOTE_TAKER_LABEL[m.note_taker] || m.note_taker}`);
    L.push(`- **Participants:** ${m.present.map(name).join(', ')}${(r.external || []).length ? ', ' + r.external.join(', ') : ''}`);
    if (m.late_joiners?.length) L.push(`- **Joined late:** ${m.late_joiners.map(name).join(', ')}`);
    L.push('');
    const overview = clean(summary?.overview) || (fallbacks.length ? fallbacks.map((c) => c.fallback_text).join(' ') : '');
    if (overview) L.push('## Overview', '', overview, '');
    const bullets = (summary?.shorthand_bullet || []).map(clean).filter(Boolean);
    if (bullets.length) {
      L.push(m.note_taker === 'granola' ? '## Notes' : '## Chapters', '');
      bullets.forEach((b, i) => {
        const at = transcript.length ? transcript[Math.floor((i * transcript.length) / bullets.length)].start_s : 0;
        L.push(m.note_taker === 'granola' ? `- ${b}` : `- [${mmss(at)}] ${b}`);
      });
      L.push('');
    }
    const actions = clean(summary?.action_items);
    if (actions) L.push(m.note_taker === 'zoom_ai' ? '## Next steps' : '## Action items', '', actions, '');
    const kw = (summary?.keywords || []).map(clean).filter(Boolean);
    if (kw.length) L.push(`**Keywords:** ${kw.join(', ')}`, '');
    if (m.note_taker === 'manual_doc') {
      // Typed notes: no recording, so speaker lines become a notes list without timestamps.
      L.push('## Discussion', '');
      for (const x of transcript) L.push(`- ${firstName({ name: name(x.speaker) })}: ${clean(x.text)}`);
    } else {
      L.push('## Transcript', '');
      for (const x of transcript) L.push(`[${mmss(x.start_s)}] ${name(x.speaker)}: ${clean(x.text)}`);
    }
    L.push('');
    files.push({ path: r.file, content: L.join('\n') });
  }
  files.sort((a, b) => (a.path < b.path ? -1 : 1));
  return { files };
}
