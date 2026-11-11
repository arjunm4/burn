import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSources, docsBefore, toPacificIso, pacificLocalToMs, jiraTime, parseIcs } from './sources.mjs';

const DEV = 'fixtures/flintlock';

function tmpSources() {
  const dir = mkdtempSync(join(tmpdir(), 'tv-sources-'));
  for (const d of ['slack', 'jira', 'meetings']) mkdirSync(join(dir, d));
  writeFileSync(join(dir, 'slack', 'users.json'), JSON.stringify({ ok: true, members: [
    { id: 'U07FLK0OWEN', name: 'owen', real_name: 'Owen Halloran', profile: { email: 'owen@flintlockrobotics.com' } },
    { id: 'U07FLK0ARJN', name: 'arjun', real_name: 'Arjun Venkatesan', profile: { email: 'arjun@flintlockrobotics.com' } },
  ] }));
  writeFileSync(join(dir, 'slack', 'channels.json'), JSON.stringify({ ok: true, channels: [{ id: 'C07FLK0ACTU', name: 'actuators' }] }));
  // 1793310847 = 2026-10-29T21:54:07Z (PDT); 1794000000 = 2026-11-06T21:20:00Z (PST)
  writeFileSync(join(dir, 'slack', 'C07FLK0ACTU.json'), JSON.stringify({ ok: true, messages: [
    { type: 'message', user: 'U07FLK0ARJN', text: 'reply', ts: '1794000000.000100', thread_ts: '1793310847.238764' },
    { type: 'message', user: 'U07FLK0OWEN', text: 'need 4x FL-HIP-1042 by tues the 24th', ts: '1793310847.238764' },
    { type: 'message', user: 'UNKNOWN0000', text: 'who', ts: '1793310848.000001' },
  ] }));
  writeFileSync(join(dir, 'jira', 'users.json'), JSON.stringify([{ accountId: 'aaa', displayName: 'Owen Halloran', emailAddress: 'owen@flintlockrobotics.com' }]));
  const owen = { accountId: 'aaa', displayName: 'Owen Halloran', emailAddress: 'owen@flintlockrobotics.com' };
  writeFileSync(join(dir, 'jira', 'HIP.json'), JSON.stringify({ issues: [{ key: 'HIP-1', fields: {
    summary: 'hip bracket', created: '2026-08-17T13:24:09.201-0700', reporter: owen,
    description: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'need FL-HIP-1042' }] }] },
    issuelinks: [{ type: { name: 'Blocks', outward: 'blocks', inward: 'is blocked by' }, outwardIssue: { key: 'HIP-2' } }],
    comment: { comments: [{ id: '5', author: owen, body: 'eta 11/30', created: '2026-11-02T09:00:00.000-0800' }] },
  }, changelog: { histories: [{ id: '9', author: owen, created: '2026-08-19T13:17:02.201-0700', items: [{ field: 'status', fromString: 'To Do', toString: 'In Progress' }] }] } }] }));
  writeFileSync(join(dir, 'meetings', '2026-10-31-2350-late.md'), [
    '# Late sync', '', '- **Date:** Sat, Oct 31, 2026 · 11:50 PM PDT', '- **Duration:** 30 min', '', '## Overview', '', '- Owen: summary only', '',
    '## Transcript', '', '[05:00] Owen Halloran: before midnight', '[1:15:30] Arjun Venkatesan: much later', 'continued line', '',
  ].join('\n'));
  writeFileSync(join(dir, 'meetings', '2026-11-03-0845-standup.md'), [
    '# Standup', '', '- **Date:** Tue, Nov 3, 2026 · 8:45 AM PST', '- **Duration:** 15 min', '', '## Discussion', '', '- Owen: We need the bracket by 11/20.', '',
  ].join('\n'));
  writeFileSync(join(dir, 'calendar.ics'), [
    'BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:cal-bk-1', 'DTSTART;TZID=America/Los_Angeles:20261123T090000', 'DTEND;TZID=America/Los_Angeles:20261124T170000',
    'SUMMARY:Dyno: hip spin', 'DESCRIPTION:Booked by Owen\\, for the\\n spin test', 'ORGANIZER;CN=Owen Halloran:mailto:owen@flintlockrobotics.com',
    'ATTENDEE;CN=Arjun Venkatesan;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED:mai', ' lto:arjun@flintlockrobotics.com', 'LAST-MODIFIED:20261015T170000Z',
    'CATEGORIES:BOOKING', 'END:VEVENT', 'BEGIN:VEVENT', 'UID:cal-ooo-x', 'DTSTART;VALUE=DATE:20260330', 'DTEND;VALUE=DATE:20260401', 'SUMMARY:OOO',
    'CATEGORIES:OOO', 'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n'));
  return dir;
}

test('pacific offsets follow the US DST rule', () => {
  assert.equal(toPacificIso(Date.parse('2026-03-08T09:59:59Z')), '2026-03-08T01:59:59-08:00');
  assert.equal(toPacificIso(Date.parse('2026-03-08T10:00:00Z')), '2026-03-08T03:00:00-07:00');
  assert.equal(toPacificIso(Date.parse('2026-11-01T08:59:59Z')), '2026-11-01T01:59:59-07:00');
  assert.equal(toPacificIso(Date.parse('2026-11-01T09:00:00Z')), '2026-11-01T01:00:00-08:00');
  assert.equal(toPacificIso(pacificLocalToMs(2026, 11, 10, 10, 30)), '2026-11-10T10:30:00-08:00');
  assert.equal(toPacificIso(pacificLocalToMs(2026, 9, 29, 10, 30)), '2026-09-29T10:30:00-07:00');
  assert.equal(jiraTime('2026-08-17T13:24:09.201-0700'), '2026-08-17T13:24:09-07:00');
});

test('missing directory yields empty sources', () => {
  const s = loadSources(join(tmpdir(), 'tv-does-not-exist-xyz'));
  assert.deepEqual(s.docs, []);
  assert.deepEqual(s.xometry, { quotes: [], orders: [] });
  assert.deepEqual(s.ramp, { transactions: [], bills: [] });
  assert.deepEqual(s.calendar, []);
  assert.equal(s.demo.partEntry, null);
});

test('synthetic sources normalize to the docs shape', () => {
  const s = loadSources(tmpSources());
  const byId = Object.fromEntries(s.docs.map((d) => [d.id, d]));
  const root = byId['slack:C07FLK0ACTU:1793310847.238764'];
  assert.equal(root.at, '2026-10-29T14:54:07-07:00');
  assert.deepEqual(root.author, { name: 'Owen Halloran', email: 'owen@flintlockrobotics.com', slack_id: 'U07FLK0OWEN' });
  assert.equal(root.thread, '1793310847.238764');
  assert.equal(root.container, 'C07FLK0ACTU');
  const reply = byId['slack:C07FLK0ACTU:1794000000.000100'];
  assert.equal(reply.thread, '1793310847.238764');
  assert.equal(reply.at, '2026-11-06T13:20:00-08:00');
  assert.equal(byId['slack:C07FLK0ACTU:1793310848.000001'].author.slack_id, 'UNKNOWN0000');

  assert.equal(byId['jira:HIP-1:desc'].text, 'need FL-HIP-1042');
  assert.equal(byId['jira:HIP-1:desc'].at, '2026-08-17T13:24:09-07:00');
  assert.equal(byId['jira:HIP-1:c5'].at, '2026-11-02T09:00:00-08:00');
  assert.equal(byId['jira:HIP-1:h9'].text, 'status: To Do -> In Progress');
  assert.equal(byId['jira:HIP-1:desc'].author.slack_id, 'U07FLK0OWEN');
  assert.deepEqual(s.tickets[0].issuelinks, [{ type: 'Blocks', direction: 'outward', label: 'blocks', key: 'HIP-2' }]);

  // meeting crosses midnight and the DST change (Nov 1 01:00 PDT -> PST)
  const m1 = byId['meeting:2026-10-31-2350-late:12'];
  assert.equal(m1.at, '2026-10-31T23:55:00-07:00');
  const m2 = byId['meeting:2026-10-31-2350-late:13'];
  assert.equal(m2.at, '2026-11-01T01:05:30-07:00');
  assert.equal(m2.text, 'much later\ncontinued line');
  assert.equal(m2.author.email, 'arjun@flintlockrobotics.com');
  assert.ok(!s.docs.some((d) => d.section === 'overview'));
  const notes = byId['meeting:2026-11-03-0845-standup:8'];
  assert.equal(notes.at, '2026-11-03T09:00:00-08:00'); // notes: at meeting end
  assert.equal(notes.author.email, 'owen@flintlockrobotics.com'); // first name resolved

  const cal = byId['cal:cal-bk-1'];
  assert.equal(cal.at, '2026-10-15T10:00:00-07:00'); // LAST-MODIFIED
  assert.equal(cal.text, 'Dyno: hip spin\nBooked by Owen, for the\n spin test');
  const ev = s.calendar.find((e) => e.uid === 'cal-bk-1');
  assert.equal(ev.start, '2026-11-23T09:00:00-08:00');
  assert.deepEqual(ev.attendees[0], { name: 'Arjun Venkatesan', email: 'arjun@flintlockrobotics.com', role: 'REQ-PARTICIPANT', partstat: 'ACCEPTED' });
  assert.deepEqual(ev.categories, ['BOOKING']);
  assert.equal(s.calendar.find((e) => e.uid === 'cal-ooo-x').start, '2026-03-30T00:00:00-07:00');

  for (let i = 1; i < s.docs.length; i++) assert.ok(Date.parse(s.docs[i - 1].at) <= Date.parse(s.docs[i].at));
});

test('docsBefore keeps [T - days, T)', () => {
  const docs = [1, 2, 3, 4, 5].map((d) => ({ id: `x${d}`, at: `2026-10-0${d}T12:00:00-07:00` }));
  const T = '2026-10-04T12:00:00-07:00';
  assert.deepEqual(docsBefore(docs, T, 2).map((d) => d.id), ['x2', 'x3']);
  assert.deepEqual(docsBefore(docs, T).map((d) => d.id), ['x1', 'x2', 'x3']);
  assert.deepEqual(docsBefore(docs, Date.parse(T), 0.5).map((d) => d.id), []);
  assert.throws(() => docsBefore(docs, 'not a time', 2), RangeError); // an unreadable T must not return every doc
});

// Format smoke test over whatever is rendered now (not final data; asserts shape only, never counts).
test('dev sources load (format smoke)', { skip: !existsSync(DEV) }, () => {
  const s = loadSources(DEV);
  const ids = new Set();
  for (const d of s.docs) {
    assert.ok(!ids.has(d.id), d.id);
    ids.add(d.id);
    assert.match(d.at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-0[78]:00$/, d.id);
    assert.equal(typeof d.text, 'string');
    assert.ok(d.container && d.thread, d.id);
    // the offset printed is the correct Pacific offset for that instant
    assert.equal(toPacificIso(Date.parse(d.at)), d.at, d.id);
  }
});

test('parseIcs unfolds lines and splits categories', () => {
  const [e] = parseIcs('BEGIN:VEVENT\r\nUID:a\r\nSUMMARY:x\r\n y\r\nCATEGORIES:A,B\r\nDTSTART:20261101T090000Z\r\nEND:VEVENT\r\n');
  assert.equal(e.summary, 'xy');
  assert.deepEqual(e.categories, ['A', 'B']);
  assert.equal(e.start, '2026-11-01T01:00:00-08:00');
});

test('malformed times are skipped with a reason, never given a made-up time', () => {
  const dir = tmpSources();
  writeFileSync(join(dir, 'slack', 'C07FLK0ACTU.json'), JSON.stringify({ ok: true, messages: [
    { type: 'message', user: 'U07FLK0OWEN', text: 'fine', ts: '1793310847.238764' },
    { type: 'message', user: 'U07FLK0OWEN', text: 'bad ts', ts: 'abc' },
  ] }));
  writeFileSync(join(dir, 'meetings', '2026-02-31-0900-impossible.md'), '# Bad\n\n- **Date:** Tue, Feb 31, 2026 · 9:00 AM PST\n\n## Discussion\n\n- Owen: hello\n');
  const s = loadSources(dir);
  assert.ok(s.docs.some((d) => d.id === 'slack:C07FLK0ACTU:1793310847.238764'));
  assert.deepEqual(s.skipped.map((x) => x.id), ['slack:C07FLK0ACTU:abc']);
  assert.ok(!s.docs.some((d) => d.container === '2026-02-31-0900-impossible'));
  assert.equal(s.meetings.find((m) => m.file === '2026-02-31-0900-impossible').start, null);
  assert.equal(pacificLocalToMs(2026, 2, 31), null);
  assert.equal(toPacificIso(NaN), null);
  const [e] = parseIcs('BEGIN:VEVENT\r\nUID:a\r\nDTSTART;VALUE=DATE:garbage\r\nDTEND:20261399T250000\r\nEND:VEVENT\r\n');
  assert.equal(e.start, null);
  assert.equal(e.end, null);
});
