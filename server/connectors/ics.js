// iCalendar connector: fetches a calendar's secret iCal address (Google, Outlook, Fastmail...)
// and turns each event occurrence in a window into a shared-contract Document.
// Read-only. Recurring events are expanded; all-day events keep their dates.
import ICAL from 'ical.js';
import {readFile} from 'node:fs/promises';

const DAY = 86400000;

export function parseCalendar(text, {from, to, calendar} = {}) {
  const root = new ICAL.Component(ICAL.parse(text));
  const name = calendar || root.getFirstPropertyValue('x-wr-calname') || 'Calendar';
  // Register embedded VTIMEZONEs so TZID times convert correctly.
  for (const tz of root.getAllSubcomponents('vtimezone')) ICAL.TimezoneService.register(tz);
  const start = from ? ICAL.Time.fromJSDate(new Date(from), true) : null;
  const end = to ? ICAL.Time.fromJSDate(new Date(to), true) : null;
  const docs = [];
  const masters = root.getAllSubcomponents('vevent').filter(v => !v.hasProperty('recurrence-id'));
  const overrides = root.getAllSubcomponents('vevent').filter(v => v.hasProperty('recurrence-id'));
  for (const vevent of masters) {
    const event = new ICAL.Event(vevent);
    for (const o of overrides) if (o.getFirstPropertyValue('uid') === event.uid) event.relateException(o);
    const emit = (startTime, endTime, details = event) => {
      if (details.component?.getFirstPropertyValue('status') === 'CANCELLED') return;
      if (end && startTime.compare(end) > 0) return;
      if (start && endTime.compare(start) < 0) return;
      docs.push(toDocument(details, startTime, endTime, name));
    };
    if (event.isRecurring()) {
      const it = event.iterator();
      // Old series (a daily standup since 2019) need many steps to reach the window,
      // so bound the walk generously and cap what is emitted instead.
      for (let next = it.next(), steps = 0, emitted = docs.length; next && steps < 20000 && docs.length - emitted < 500; next = it.next(), steps++) {
        if (end && next.compare(end) > 0) break;
        const occ = event.getOccurrenceDetails(next);
        emit(occ.startDate, occ.endDate, occ.item);
      }
    } else emit(event.startDate, event.endDate || event.startDate);
  }
  return docs.sort((a, b) => a.at.localeCompare(b.at));
}

function toDocument(event, startTime, endTime, calendar) {
  const allDay = startTime.isDate;
  const iso = t => (allDay ? t.toString().slice(0, 10) : t.toJSDate().toISOString());
  const c = event.component;
  const categories = c.getAllProperties('categories').flatMap(p => p.getValues()).map(String);
  const status = c.getFirstPropertyValue('status') || null;
  const description = event.description || '';
  const attendees = c.getAllProperties('attendee').map(p => p.getParameter('cn') || String(p.getFirstValue()).replace(/^mailto:/i, ''));
  const startKey = allDay ? startTime.toString().slice(0, 10) : startTime.toJSDate().toISOString();
  return {
    id: `calendar:${event.uid}:${startKey}`, source: 'calendar', kind: 'event', externalId: `${event.uid}:${startKey}`,
    channel: calendar, author: event.organizer ? String(event.organizer).replace(/^mailto:/i, '') : null,
    at: iso(startTime), end: endTime ? iso(endTime) : null,
    // Summary first: the extractor reads the first line as the event title.
    text: [event.summary || '(untitled)', description].filter(Boolean).join('\n'),
    url: c.getFirstPropertyValue('url') || null,
    attrs: {categories, status, allDay, location: event.location || null, attendees, transparent: c.getFirstPropertyValue('transp') === 'TRANSPARENT'},
  };
}

/**
 * fetchCalendar({url | file, from, to}) -> Document[]
 * url accepts webcal:// (rewritten to https://). Never logs the URL: it is a secret.
 */
export async function fetchCalendar({url, file, from, to, calendar, fetchImpl = fetch} = {}) {
  let text;
  if (file) text = await readFile(file, 'utf8');
  else {
    // Errors from fetch can echo the URL, which is a secret: never pass them through.
    let response;
    try { response = await fetchImpl(String(url).replace(/^webcal:/i, 'https:'), {headers: {Accept: 'text/calendar'}, redirect: 'follow', signal: AbortSignal.timeout(20000)}); }
    catch (error) { throw new Error(error?.name === 'TimeoutError' ? 'Calendar fetch timed out' : 'Calendar fetch failed: check CALENDAR_ICS_URL'); }
    if (!response.ok) throw new Error(`Calendar fetch failed: HTTP ${response.status}`);
    text = await response.text();
    if (!/BEGIN:VCALENDAR/.test(text)) throw new Error('Calendar URL did not return iCalendar data');
  }
  return parseCalendar(text, {from, to, calendar});
}

export const windowAround = (iso, before = 30, after = 90) => {
  const t = Date.parse(iso.length === 10 ? iso + 'T00:00:00Z' : iso);
  return {from: new Date(t - before * DAY).toISOString(), to: new Date(t + after * DAY).toISOString()};
};
