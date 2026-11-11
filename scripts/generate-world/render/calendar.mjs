// Calendar renderer (no writer). Milestones (as believed at demo "now", with their moves), rig and
// resource bookings including conflicts, recurring meetings with moved or cancelled instances,
// one-off meetings and out-of-office. Always the full window. Emits calendar.ics.
import { toMs, byId, resolveCtx, beliefAt, dateOf, addDays, md, firstName, cmpTimeId } from './common-b.mjs';
import { checkTime } from '../schema.mjs';

const TZ = 'America/Los_Angeles';
const VTIMEZONE = [
  'BEGIN:VTIMEZONE', `TZID:${TZ}`,
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:-0800', 'TZOFFSETTO:-0700', 'TZNAME:PDT', 'DTSTART:19700308T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:-0700', 'TZOFFSETTO:-0800', 'TZNAME:PST', 'DTSTART:19701101T020000', 'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU', 'END:STANDARD',
  'END:VTIMEZONE',
];
const PARTSTAT = { accepted: 'ACCEPTED', tentative: 'TENTATIVE', declined: 'DECLINED', needs_action: 'NEEDS-ACTION' };
const BYDAY = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

// "2026-10-22T10:30:00-07:00" -> "20261022T103000" (Pacific local, used with TZID)
const local = (iso) => iso.slice(0, 19).replace(/[-:]/g, '');
const dateVal = (d) => d.replace(/-/g, '');
const utcStamp = (iso) => new Date(toMs(iso)).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

function fold(line) {
  if (line.length <= 74) return line;
  const out = [line.slice(0, 74)];
  for (let i = 74; i < line.length; i += 73) out.push(' ' + line.slice(i, i + 73));
  return out.join('\r\n');
}

// Shift an ISO local time to a new date, keeping the clock time and fixing the Pacific offset.
function onDate(iso, date) {
  const t = `${date}T${iso.slice(11, 19)}`;
  for (const o of ['-07:00', '-08:00']) if (checkTime(`${t}${o}`) === null) return `${t}${o}`;
  return `${t}-08:00`;
}
const endClockOf = (iso, minutes) => {
  const t = +iso.slice(11, 13) * 60 + +iso.slice(14, 16) + minutes;
  return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}${String(t % 60).padStart(2, '0')}00`;
};

function attendeeLines(ids, people, rsvp, optional = []) {
  return ids.filter((id) => people.has(id)).map((id) => {
    const p = people.get(id);
    const ps = PARTSTAT[rsvp?.[id]] || 'NEEDS-ACTION';
    const role = optional.includes(id) ? 'OPT-PARTICIPANT' : 'REQ-PARTICIPANT';
    return `ATTENDEE;CN=${esc(p.name)};ROLE=${role};PARTSTAT=${ps}:mailto:${p.email}`;
  });
}

export function plan(world, ctx0 = {}) {
  const ctx = resolveCtx(world, ctx0);
  const nowMs = toMs(ctx.demoNow);
  const people = byId(world.people);
  const tests = byId(world.tests);
  const records = [];

  // Milestones: all-day, at the date believed at demo "now"; moves listed in the description.
  for (const m of (world.milestones || []).slice().sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const known = (m.date || []).filter((h) => toMs(h.known_at) <= nowMs);
    if (!known.length || !known[known.length - 1].value) continue;
    const cur = known[known.length - 1];
    const moves = [];
    for (let i = 1; i < known.length; i++) if (known[i].value !== known[i - 1].value) moves.push(`Moved ${md(known[i - 1].value)} -> ${md(known[i].value)} on ${md(dateOf(known[i].known_at))}`);
    const owner = people.get(m.owner);
    records.push({
      record_id: `cal-${m.id}`, source: 'calendar', kind: 'milestone', events: known.map((h) => h.where).filter(Boolean),
      sort: `${cur.value}T00:00:00`,
      lines: [
        `UID:cal-${m.id}`, `DTSTART;VALUE=DATE:${dateVal(cur.value)}`, `DTEND;VALUE=DATE:${dateVal(addDays(cur.value, 1))}`,
        `SUMMARY:${esc(m.name)}`,
        `DESCRIPTION:${esc([`Milestone (${m.kind}). Owner: ${owner?.name || ''}.`, ...moves].join('\n'))}`,
        `SEQUENCE:${moves.length}`, `LAST-MODIFIED:${utcStamp(cur.known_at)}`,
        ...(m.hardness === 'soft' && moves.length ? ['STATUS:TENTATIVE'] : ['STATUS:CONFIRMED']),
        'TRANSP:TRANSPARENT', 'CATEGORIES:MILESTONE',
      ],
    });
  }

  // Bookings. A future booking for a test sits at the test's planned date as believed at "now",
  // so the calendar never shows a schedule nobody has announced yet.
  for (const coll of ['test_rigs', 'resources']) {
    for (const rig of world[coll] || []) {
      for (const b of rig.bookings || []) {
        let { start, end } = b;
        const t = b.test ? tests.get(b.test) : null;
        // When the booking became known: the planned-date entry that put the test on this date,
        // else the earliest entry; ad hoc bookings are known when they start. Never after "now".
        const hist = (t?.planned_date || []).filter((h) => h.known_at);
        const origStart = dateOf(start);
        const made = hist.find((h) => h.value === origStart) || hist[0];
        const knownMs = Math.min(toMs(made ? made.known_at : start), toMs(start), nowMs);
        const knownStamp = new Date(knownMs).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
        if (t && toMs(start) > nowMs) {
          const bel = beliefAt(t.planned_date, nowMs);
          if (bel?.value && bel.value !== dateOf(start)) {
            const span = Math.round((toMs(dateOf(end)) - toMs(dateOf(start))) / 86400e3);
            start = onDate(start, bel.value);
            end = onDate(end, addDays(bel.value, span));
          }
        }
        const by = people.get(b.by);
        const conflicts = (b.conflict_with || []).map((id) => {
          for (const c of world.test_rigs.concat(world.resources || [])) for (const x of c.bookings || []) if (x.id === id) return firstName(people.get(x.by));
          return null;
        }).filter(Boolean);
        const what = t ? t.name : 'ad hoc use';
        const desc = [`${rig.name} booked by ${by?.name || ''} for ${what}.`];
        if (conflicts.length) desc.push(`Overlaps a booking by ${conflicts.join(', ')}.`);
        records.push({
          record_id: `cal-${b.id}`, source: 'calendar', kind: 'booking', events: [], sort: start,
          lines: [
            `UID:cal-${b.id}`, `DTSTART;TZID=${TZ}:${local(start)}`, `DTEND;TZID=${TZ}:${local(end)}`,
            `SUMMARY:${esc(`${rig.name}: ${what} (${firstName(by)})${b.status === 'tentative' ? ' - tentative' : ''}`)}`,
            `DESCRIPTION:${esc(desc.join('\n'))}`, `LOCATION:${esc(rig.location)}`,
            `STATUS:${b.status === 'cancelled' ? 'CANCELLED' : b.status === 'tentative' ? 'TENTATIVE' : 'CONFIRMED'}`,
            `ORGANIZER;CN=${esc(by?.name || '')}:mailto:${by?.email || ''}`,
            `CREATED:${knownStamp}`, `LAST-MODIFIED:${knownStamp}`, 'CATEGORIES:BOOKING',
          ],
        });
      }
    }
  }

  // Recurring meeting series with moved or cancelled instances as overrides.
  const meetingsBySeries = new Map();
  for (const m of world.meetings || []) {
    const k = m.series || null;
    if (!meetingsBySeries.has(k)) meetingsBySeries.set(k, []);
    meetingsBySeries.get(k).push(m);
  }
  const windowStart = dateOf(world.meta.window.start);
  for (const s of (world.meeting_series || []).slice().sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const inst = (meetingsBySeries.get(s.id) || []).slice().sort((a, b) => cmpTimeId(a.moved_from || a.start, a.id, b.moved_from || b.start, b.id));
    let first;
    if (inst.length) first = inst[0].moved_from || inst[0].start;
    else {
      const days = (/BYDAY=([A-Z,]+)/.exec(s.rrule)?.[1] || 'MO').split(',').map((d) => BYDAY[d.slice(-2)]);
      let d = windowStart;
      while (!days.includes(new Date(Date.parse(`${d}T12:00:00Z`)).getUTCDay())) d = addDays(d, 1);
      first = onDate(`${d}T${s.start_local}:00-08:00`, d);
    }
    const startIso = onDate(first, dateOf(first));
    const endClock = endClockOf(startIso, s.duration_min);
    const org = people.get(s.organizer);
    const head = (extra) => [
      `SUMMARY:${esc(s.name)}`, `ORGANIZER;CN=${esc(org?.name || '')}:mailto:${org?.email || ''}`,
      ...(s.conference ? [`LOCATION:${esc(s.conference)}`, `URL:${s.conference}`] : []),
      ...extra, 'CATEGORIES:MEETING',
    ];
    records.push({
      record_id: `cal-${s.id}`, source: 'calendar', kind: 'series', events: [], sort: startIso,
      lines: [
        `UID:cal-${s.id}`, `DTSTART;TZID=${TZ}:${local(startIso)}`, `DTEND;TZID=${TZ}:${local(startIso).slice(0, 9)}${endClock}`,
        `RRULE:${s.rrule}`,
        ...head(attendeeLines([...s.attendees, ...(s.optional_attendees || [])], people, {}, s.optional_attendees || [])),
      ],
    });
    for (const m of inst) {
      if (!m.moved_from && !m.cancelled) continue;
      const endClock2 = endClockOf(m.start, m.scheduled_min);
      records.push({
        record_id: `cal-${m.id}`, source: 'calendar', kind: 'instance', meeting: m.id, events: [], sort: m.start,
        lines: [
          `UID:cal-${s.id}`, `RECURRENCE-ID;TZID=${TZ}:${local(m.moved_from || m.start)}`,
          `DTSTART;TZID=${TZ}:${local(m.start)}`, `DTEND;TZID=${TZ}:${local(m.start).slice(0, 9)}${endClock2}`,
          ...(m.cancelled ? ['STATUS:CANCELLED'] : []),
          ...head(attendeeLines(m.invited, people, m.rsvp, s.optional_attendees || [])),
        ],
      });
    }
  }

  // One-off meetings.
  for (const m of (meetingsBySeries.get(null) || []).slice().sort((a, b) => cmpTimeId(a.start, a.id, b.start, b.id))) {
    const endClock = endClockOf(m.start, m.scheduled_min);
    const org = people.get(m.invited[0]);
    records.push({
      record_id: `cal-${m.id}`, source: 'calendar', kind: 'meeting', meeting: m.id, events: [], sort: m.start,
      lines: [
        `UID:cal-${m.id}`, `DTSTART;TZID=${TZ}:${local(m.start)}`, `DTEND;TZID=${TZ}:${local(m.start).slice(0, 9)}${endClock}`,
        `SUMMARY:${esc(m.name)}`, `ORGANIZER;CN=${esc(org?.name || '')}:mailto:${org?.email || ''}`,
        ...(m.cancelled ? ['STATUS:CANCELLED'] : []),
        ...attendeeLines(m.invited, people, m.rsvp),
        ...(m.external || []).map((e) => `ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED:mailto:${e}`),
        'CATEGORIES:MEETING',
      ],
    });
  }

  // Out of office.
  for (const p of (world.people || []).slice().sort((a, b) => (a.id < b.id ? -1 : 1))) {
    for (const o of p.ooo || []) {
      records.push({
        record_id: `cal-ooo-${p.id.replace(/^p-/, '')}-${o.start}`, source: 'calendar', kind: 'ooo', events: [], sort: `${o.start}T00:00:00`,
        lines: [
          `UID:cal-ooo-${p.id.replace(/^p-/, '')}-${o.start}`, `DTSTART;VALUE=DATE:${dateVal(o.start)}`, `DTEND;VALUE=DATE:${dateVal(addDays(o.end, 1))}`,
          `SUMMARY:${esc(`${p.name} OOO${o.reason ? ` (${o.reason})` : ''}`)}`, 'TRANSP:TRANSPARENT', 'CATEGORIES:OOO',
        ],
      });
    }
  }
  return { records, jobs: [], stamp: ctx.demoNow };
}

export function emit(records, _texts = {}, ctx = {}) {
  const stamp = utcStamp(ctx.demoNow || '2026-11-10T10:30:00-08:00');
  const sorted = records.slice().sort((a, b) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : a.record_id < b.record_id ? -1 : 1));
  const out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Flintlock Robotics//Calendar export//EN', 'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:Flintlock Robotics', `X-WR-TIMEZONE:${TZ}`, ...VTIMEZONE];
  for (const r of sorted) out.push('BEGIN:VEVENT', r.lines[0], `DTSTAMP:${stamp}`, ...r.lines.slice(1), 'END:VEVENT');
  out.push('END:VCALENDAR');
  return { files: [{ path: 'calendar.ics', content: out.map(fold).join('\r\n') + '\r\n' }] };
}
