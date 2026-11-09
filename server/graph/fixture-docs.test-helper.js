// Test-only: turns the seeded fixtures into shared-contract Documents without the real
// connectors, so graph tests don't depend on connector code. Not a substitute parser.
import {readFileSync} from 'node:fs';
const root = new URL('../../fixtures/', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');
export function fixtureDocuments() {
  const users = Object.fromEntries(JSON.parse(read('slack/users.json')).members.map(u => [u.id, u.real_name]));
  const channels = JSON.parse(read('slack/channels.json')).channels;
  const docs = [];
  for (const c of channels) for (const m of JSON.parse(read(`slack/${c.id}.json`)).messages)
    docs.push({id: `slack:${c.id}:${m.ts}`, source: 'slack', kind: 'message', externalId: m.ts, channel: '#' + c.name, author: users[m.user], at: new Date(Number(m.ts) * 1000).toISOString(), end: null, text: m.text, url: null, attrs: {}});
  for (const block of read('calendar.ics').split('BEGIN:VEVENT').slice(1)) {
    const get = k => block.match(new RegExp(`^${k}(?:;[^:\\r\\n]*)?:(.*)$`, 'm'))?.[1].trim();
    const day = v => v && `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
    docs.push({id: `calendar:${get('UID')}`, source: 'calendar', kind: 'event', externalId: get('UID'), channel: 'Hardware program', author: null, at: day(get('DTSTART')), end: day(get('DTEND')), text: get('SUMMARY').replace(/\\,/g, ','), url: null, attrs: {categories: (get('CATEGORIES') || '').split(',').filter(Boolean), status: get('STATUS') || null}});
  }
  return docs;
}
