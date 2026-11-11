import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  scorePressure, makeReadContext, readDoc, readDocs, mergeReads, loadReadCache, teamBaseline, PRESSURE_LEXICON,
} from './read.mjs';

// ---- stub of C's contracts (refs.mjs / claims.mjs) and B's settings: used until C lands.
const SETTINGS = {
  people: [
    { id: 'p-owen', name: 'Owen Halloran', email: 'owen@x.com', slack_id: 'U1', team: 't-act', manager: 'p-arjun' },
    { id: 'p-arjun', name: 'Arjun V', email: 'arjun@x.com', slack_id: 'U2', team: 't-act', manager: null },
    { id: 'p-gwen', name: 'Gwen A', email: 'gwen@x.com', slack_id: 'U3', team: 't-sup', manager: null },
  ],
  teams: [
    { id: 't-act', lead: 'p-arjun', channels: ['CACT'] },
    { id: 't-sup', lead: 'p-gwen', channels: ['CSUP'] },
  ],
};
const stubResolve = (text) => {
  const out = [];
  if (/FL-HIP-1042/.test(text)) out.push({ id: 'pt-hip-bracket', kind: 'part', mode: 'id', token: 'FL-HIP-1042' });
  else if (/hip bracket/i.test(text)) out.push({ id: 'pt-hip-bracket', kind: 'part', mode: 'alias', token: 'hip bracket' });
  if (/motor/i.test(text)) out.push({ id: 'dl-hip-motor-dvt', kind: 'deliverable', mode: 'alias', token: 'motor' });
  return out;
};
const stubClaims = (doc, resolve) => {
  const m = /new eta (\d+)\/(\d+)/i.exec(doc.text);
  const refs = resolve(doc.text);
  if (m && refs[0]) return [{ kind: 'eta', subject: refs[0].id, value: `2026-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`, doc_id: doc.id, by: null, at: doc.at }];
  return [];
};

let realC = null;
try {
  const { makeResolver } = await import('./refs.mjs');
  const { extractClaims } = await import('./claims.mjs');
  realC = { makeResolver, extractClaims };
} catch { /* C not landed yet: stubs only */ }

const ctx = makeReadContext(SETTINGS, { resolve: stubResolve, extractClaims: stubClaims });
const doc = (id, text, extra = {}) => ({
  id, source: 'slack', container: 'CACT', thread: id.split(':')[2], at: '2026-11-05T10:00:00-08:00',
  author: { name: 'Owen Halloran', email: 'owen@x.com', slack_id: 'U1' }, text, ...extra,
});

test('pressure lexicon: anchors and bounds', () => {
  assert.equal(scorePressure('ok ty').pressure, 0);
  assert.equal(scorePressure('need 2x pelvis plate by 9/22').pressure, 0.15);
  assert.equal(scorePressure('any update on the shaft?').pressure, 0.35);
  const bump = scorePressure("bumping this, line's idle thurs");
  assert.deepEqual(bump.cues, ['follow_up', 'blocked']);
  assert.equal(bump.pressure, 0.577);
  const hot = scorePressure("asap!! build is tmrw and we're blocked");
  assert.ok(hot.pressure > 0.75 && hot.pressure <= 1, String(hot.pressure));
  const everything = PRESSURE_LEXICON.filter((c) => c.re).map((c) => c.re.source).length;
  assert.ok(everything >= 9);
  assert.ok(scorePressure('ASAP URGENT!! any update?? blocked, slipped again, need it by EOD ugh 🚨', { managerJoined: true }).pressure <= 1);
});

test('readDoc: refs, claims, done, manager cue, team', () => {
  const r = readDoc(doc('slack:CACT:2.0', 'heads up, vendor slipped the motor again. new ETA 11/30'), ctx);
  assert.equal(r.doc_id, 'slack:CACT:2.0');
  assert.equal(r.via, 'code');
  assert.deepEqual(r.refs.map((x) => x.id), ['dl-hip-motor-dvt']);
  assert.deepEqual(r.claims[0].value, '2026-11-30');
  assert.ok(r.cues.includes('slip'));
  assert.equal(r.team, 't-act');
  assert.equal(r.author_id, 'p-owen');

  const d = readDoc(doc('slack:CACT:3.0', 'FL-HIP-1042 arrived, in hand'), ctx);
  assert.deepEqual(d.done, ['pt-hip-bracket']);
  const notDone = readDoc(doc('slack:CACT:4.0', 'FL-HIP-1042 not arrived yet'), ctx);
  assert.deepEqual(notDone.done, []);

  // the lead replying in someone else's thread adds the manager cue; starting a thread does not
  const arjun = { name: 'Arjun V', email: 'arjun@x.com', slack_id: 'U2' };
  const reply = readDoc(doc('slack:CACT:5.0', 'where are we on the hip bracket', { thread: '1.0', author: arjun }), ctx);
  assert.ok(reply.cues.includes('manager'));
  const own = readDoc(doc('slack:CACT:6.0', 'where are we on the hip bracket', { author: arjun }), ctx);
  assert.ok(!own.cues.includes('manager'));

  // unknown author → channel's team
  const bot = readDoc(doc('slack:CSUP:7.0', 'reminder', { container: 'CSUP', author: { name: 'Jira' } }), ctx);
  assert.equal(bot.team, 't-sup');
});

test('readDoc: Jira status → Done marks the ticket subject done', () => {
  const r = readDoc({
    id: 'jira:HIP-1:h1', source: 'jira', container: 'HIP-1', thread: 'HIP-1', at: '2026-11-05T10:00:00-08:00',
    author: { email: 'owen@x.com' }, text: 'status: In Progress -> Done', summary: 'order FL-HIP-1042 x4',
    changes: [{ field: 'status', from: 'In Progress', to: 'Done' }],
  }, ctx);
  assert.deepEqual(r.done, ['pt-hip-bracket']);
});

test('mergeReads / loadReadCache: LLM over code by doc_id, keeping code-only fields', () => {
  const code = readDocs([doc('slack:CACT:2.0', 'any update on the hip bracket?'), doc('slack:CACT:8.0', 'ok')], ctx);
  const dir = mkdtempSync(join(tmpdir(), 'read-'));
  assert.equal(loadReadCache(dir, code).get('slack:CACT:2.0').via, 'code');
  writeFileSync(join(dir, 'read-cache.json'), JSON.stringify({ reads: [{ doc_id: 'slack:CACT:2.0', refs: [], claims: [], pressure: 0.6, done: [], via: 'llm' }] }));
  const m = loadReadCache(dir, code);
  assert.ok(existsSync(join(dir, 'read-cache.json')));
  assert.equal(m.get('slack:CACT:2.0').pressure, 0.6);
  assert.equal(m.get('slack:CACT:2.0').via, 'llm');
  assert.equal(m.get('slack:CACT:2.0').team, 't-act');
  assert.equal(m.get('slack:CACT:8.0').via, 'code');
  assert.deepEqual([...m.keys()], ['slack:CACT:2.0', 'slack:CACT:8.0']);
  assert.equal(mergeReads([], [{ doc_id: 'x', pressure: 0 }]).get('x').via, 'llm');
});

test('teamBaseline: mean per team, shrunk toward global; relative pressure', () => {
  const reads = [
    ...Array.from({ length: 10 }, (_, i) => ({ doc_id: `a${i}`, team: 't-loud', pressure: 0.6 })),
    ...Array.from({ length: 10 }, (_, i) => ({ doc_id: `b${i}`, team: 't-calm', pressure: 0.0 })),
    { doc_id: 'c', container: 'C9', pressure: 0.3 },
  ];
  const b = teamBaseline(reads, SETTINGS);
  assert.ok(Math.abs(b.global - 6.3 / 21) < 0.001);
  assert.ok(b.teams['t-loud'].mean < 0.6 && b.teams['t-loud'].mean > 0.45);
  assert.ok(b.teams['t-calm'].mean > 0 && b.teams['t-calm'].mean < 0.15);
  assert.equal(b.teams['container:C9'].n, 1);
  // the same 0.6 message is ordinary for the loud team, hot for the calm one
  assert.ok(b.relative({ team: 't-loud', pressure: 0.6 }) < b.relative({ team: 't-calm', pressure: 0.6 }));
  assert.equal(b.of({ team: 'nobody' }), b.global);
  assert.equal(teamBaseline(new Map(), SETTINGS).global, 0);
});

test('real C modules (when landed) plug into readDoc', { skip: !realC && 'refs.mjs / claims.mjs not landed' }, async () => {
  const { readFileSync } = await import('node:fs');
  const settings = JSON.parse(readFileSync(new URL('../../fixtures/timevalue/settings.json', import.meta.url), 'utf8'));
  const real = makeReadContext(settings, { resolve: realC.makeResolver(settings), extractClaims: realC.extractClaims });
  const r = readDoc({
    id: 'slack:C07FLK0ACTU:1.0', source: 'slack', container: 'C07FLK0ACTU', thread: '1.0', at: '2026-11-10T10:20:00-08:00',
    author: { name: 'Arjun Venkatesan', email: 'arjun@flintlockrobotics.com', slack_id: 'U07FLK0ARJN' },
    text: 'heads up, vendor slipped the dvt hip frameless motor again. new ETA 11/30',
  }, real);
  assert.ok(r.refs.some((x) => x.id === 'dl-hip-motor-dvt'));
  assert.ok(r.pressure > 0);
  assert.equal(r.team, 't-mech-actuators');
});
