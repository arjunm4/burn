// Tests for refs, claims, graph and progress (agent C), on the small hand-made fixture in fixture.test-data.mjs.
// The last block reruns the pinned demo path on the real rendered demo sources + settings.json when they exist:
//   node --test server/timevalue/graph.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeResolver } from './refs.mjs';
import { extractClaims, parseDate } from './claims.mjs';
import { buildGraph, graphAt, demoInputs, liveChangeDoc, appendDocs, extractAllClaims } from './graph.mjs';
import { progressRank } from './progress.mjs';
import { loadSources } from './sources.mjs';
import { settings, sources, NOW } from './fixture.test-data.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const resolve = makeResolver(settings, { xometry: sources.xometry, calendar: sources.calendar });
const doc = (text, extra = {}) => ({ id: 'slack:C07FLK0ACTU:1.0', source: 'slack', container: 'C07FLK0ACTU', thread: '1.0',
  author: { name: 'Arjun Venkatesan', email: 'arjun@flintlockrobotics.com', slack_id: 'U07FLK0ARJN' }, at: '2026-11-03T09:00:00-08:00', text, ...extra });
const claimsOf = (text, extra) => extractClaims(doc(text, extra), resolve, { people: settings.people });

test('dates: relative phrasing resolves against the doc day', () => {
  const ref = '2026-11-03'; // a Tuesday
  assert.equal(parseDate('tues the 24th', ref), '2026-11-24');
  assert.equal(parseDate('11/30', ref), '2026-11-30');
  assert.equal(parseDate('thurs', ref), '2026-11-05');
  assert.equal(parseDate('EOW', ref), '2026-11-06');
  assert.deepEqual(parseDate('next week', ref), { min: '2026-11-09', max: '2026-11-13' });
  assert.equal(parseDate('the twentieth', '2026-10-22'), '2026-11-20');
  assert.equal(parseDate('fri the 13th', '2026-10-14'), '2026-11-13');
  assert.equal(parseDate('mon 11/9', ref, 'past'), '2026-11-09');
  assert.equal(parseDate('1/5', '2026-12-20'), '2027-01-05');
  assert.deepEqual(parseDate('the week of the 23rd', '2026-11-10'), { min: '2026-11-23', max: '2026-11-27' });
});

test('refs: ids, aliases, shortened test names, vague phrases, numeric aliases', () => {
  const r = resolve('need 4x FL-HIP-1042 for the spin test, Q note re XO-5545802', { container: 'C07FLK0ACTU', at: NOW });
  assert.deepEqual(r.map((x) => [x.id, x.mode]), [['pt-hip-bracket', 'id'], ['test-hip-spin', 'alias'], ['pt-spin-coupling', 'id']]);
  assert.equal(r[2].order, 'XO-5545802');
  // "the bracket" is vague: resolved only where one assembly owns exactly one bracket
  assert.deepEqual(resolve('the bracket is late', { container: 'C07FLK0ACTU' }).map((x) => [x.id, x.mode]), [['pt-hip-bracket', 'vague']]);
  assert.deepEqual(resolve('the bracket is late', { container: 'C07FLK0LEGS' }), []);
  // numeric aliases only in a container of the part's assembly
  assert.deepEqual(resolve('need 64x 1290 by 11/20', { container: 'C07FLK0LEGS' }).map((x) => x.id), ['pt-ankle-bushing']);
  assert.deepEqual(resolve('need 64x 1290 by 11/20', { container: 'C07FLK0ACTU' }), []);
  // "the test" next to a hip item, after the hip dyno's booking ended -> the spin test
  assert.deepEqual(resolve('DVT hip frameless motor blocked (the test)', { container: 'C07FLK0ACTU', at: '2026-10-20T09:00:00-07:00' }).map((x) => [x.id, x.mode]),
    [['dl-hip-motor-dvt', 'alias'], ['test-hip-spin', 'vague']]);
  // work items written "<Activity>: <part name>"
  assert.deepEqual(resolve('(Fit check: Knee to thigh flange)').map((x) => [x.id, x.kind]), [['wk:fit-check-knee-to-thigh-flange', 'work']]);
});

test('claims: hardware phrasing', () => {
  const n = claimsOf('need 25x FL-KNE-1120 by tues the 24th (Fit check: Knee to thigh flange)');
  assert.deepEqual(n.map((c) => [c.kind, c.subject, c.value, c.qty, c.for_use, c.by]), [['needs', 'pt-knee-flange', '2026-11-24', 25, 'wk:fit-check-knee-to-thigh-flange', 'p-arjun']]);
  assert.deepEqual(claimsOf('heads up, vendor slipped the dvt hip frameless motor again. new ETA 11/30').map((c) => [c.kind, c.subject, c.value]), [['eta', 'dl-hip-motor-dvt', '2026-11-30']]);
  assert.deepEqual(claimsOf("dvt hip frameless motor: vendor won't commit to a date. somewhere between 11/19 and 11/30").map((c) => [c.kind, c.value]), [['eta', { min: '2026-11-19', max: '2026-11-30' }]]);
  assert.deepEqual(claimsOf('Actuator firmware v2 is now expected 9/14.', { at: '2026-09-02T10:00:00-07:00' }).map((c) => [c.kind, c.subject, c.value]), [['eta', 'dl-fw-actuator-v2', '2026-09-14']]);
  assert.deepEqual(claimsOf('the spin test is blocked on the dvt motor').map((c) => [c.kind, c.subject, c.value]), [['blocked', 'test-hip-spin', 'dl-hip-motor-dvt']]);
  assert.deepEqual(claimsOf('Hip actuator bracket blocked (Hip actuator DVT spin test)').map((c) => [c.kind, c.subject, c.value]), [['blocked', 'test-hip-spin', 'pt-hip-bracket']]);
  assert.deepEqual(claimsOf('the spin test takes 2-3 days').map((c) => [c.kind, c.subject, c.value]), [['duration', 'test-hip-spin', { min: 2, max: 3 }]]);
  assert.deepEqual(claimsOf('spin test done mon 11/2').map((c) => [c.kind, c.subject, c.value]), [['done', 'test-hip-spin', '2026-11-02']]);
  // a name containing "complete" is not a done claim; "11/18 -> 11/24" takes the new date
  assert.deepEqual(claimsOf('Hip actuator DVT spin test complete\nMoved 11/18 -> 11/24 on 10/22', { at: '2026-10-22T10:45:00-07:00' }).map((c) => [c.kind, c.subject, c.value]),
    [['eta', 'm-hip-spin-test', '2026-11-24']]);
  assert.deepEqual(claimsOf('lunch at noon?'), []);
});

test('graph recall phrasing: work items mid-sentence, dependency wording, co-listed parts, short deliverable names', () => {
  // a work item named anywhere in a sentence, with the use in its name
  const w = resolve('Actuator DVT build also waits on Fit check for Actuator DVT build: Knee to thigh flange.', { container: 'C07FLK0ACTU' });
  assert.deepEqual(w.map((x) => [x.id, x.kind]), [['m-actuator-dvt-build', 'milestone'], ['wk:fit-check-for-actuator-dvt-build-knee-to-thigh-flange', 'work']]);
  // dependency wording: direction from the kinds (work item -> milestone, deliverable -> work item, work item -> test)
  const blk = (t) => claimsOf(t).filter((c) => c.kind === 'blocked').map((c) => [c.value, c.subject]);
  assert.deepEqual(blk('Fit check: Knee to thigh flange also gating Actuator DVT build'), [['wk:fit-check-knee-to-thigh-flange', 'm-actuator-dvt-build']]);
  assert.deepEqual(blk("Fit check: Knee to thigh flange can't finish until Actuator firmware v2 is in"), [['dl-fw-actuator-v2', 'wk:fit-check-knee-to-thigh-flange']]);
  assert.deepEqual(blk('Hip actuator dyno torque test cant start til Fit check: Knee to thigh flange is done'), [['wk:fit-check-knee-to-thigh-flange', 'test-hip-dyno']]);
  assert.deepEqual(blk('the bracket and the coupling are both waiting'), []); // two parts: no link
  // a part listed with a need, in the same or a later sentence, is for the same use; "<part> xN for <work item>" is a need
  const co = claimsOf('FL-KNE-1120 need 4 by 11/20 for Fit check: Knee to thigh flange. Same kit touches FL-HIP-1042.').filter((c) => c.kind === 'needs');
  assert.deepEqual(co.map((c) => [c.subject, c.for_use]), [['pt-knee-flange', 'wk:fit-check-knee-to-thigh-flange'], ['pt-hip-bracket', 'wk:fit-check-knee-to-thigh-flange']]);
  assert.deepEqual(claimsOf('FL-ANK-1290 x10 for Fit check: Knee to thigh flange, by 11/28').map((c) => [c.kind, c.subject, c.value]), [['needs', 'pt-ankle-bushing', '2026-11-28']]);
  // short deliverable names; between build phases the one still being worked toward wins
  const s2 = { ...settings,
    deliverables: [...settings.deliverables.map((d) => ({ ...d, aliases: [] })), { id: 'dl-hip-motor-evt', name: 'EVT hip frameless motor (qty 3)', aliases: [], owner: 'p-arjun', assembly: 'a-hip-actuator', kind: 'motor' }],
    milestones: [...settings.milestones, { id: 'm-actuator-evt-build', name: 'Actuator EVT build', assemblies: ['a-hip-actuator'], date: [{ value: '2026-03-24', known_at: '2026-02-10T09:00:00-08:00' }] }] };
  const r2 = makeResolver(s2);
  assert.deepEqual(r2('vendor says hip motor fri the 20th now', { container: 'C07FLK0ACTU', at: '2026-11-09T09:40:00-08:00' }).map((x) => [x.id, !!x.ambiguous]), [['dl-hip-motor-dvt', false]]);
  assert.deepEqual(r2('hip motor eta 3/12', { container: 'C07FLK0ACTU', at: '2026-02-20T09:00:00-08:00' }).map((x) => x.id), ['dl-hip-motor-evt']);
  const eta = extractClaims(doc('hip motor ETA slipped again, now fri 11/20', { at: '2026-10-22T10:41:00-07:00' }), r2, { people: settings.people });
  assert.deepEqual(eta.map((c) => [c.kind, c.subject, c.value]), [['eta', 'dl-hip-motor-dvt', '2026-11-20']]);
});

test('graph: structure, evidence, acceptance, history', () => {
  const g = buildGraph({ settings, sources });
  const e = (f, t) => g.edges.find((x) => x.from === f && x.to === t);
  assert.equal(e('pt-hip-bracket', 'test-hip-spin').status, 'accepted');
  assert.equal(e('dl-hip-motor-dvt', 'test-hip-spin').status, 'proposed'); // only stated with "the test"
  assert.equal(e('rig-spin-test-stand', 'test-hip-spin').evidence[0].via, 'structured');
  assert.equal(e('test-hip-spin', 'm-hip-spin-test').kind, 'gates');
  assert.ok(e('pt-spin-coupling', 'order:XO-5545802'));
  assert.ok(e('pt-knee-flange', 'wk:fit-check-knee-to-thigh-flange'));
  // ETA acceptance: latest from an authority wins, older superseded
  const motor = g.facts.filter((f) => f.subject === 'dl-hip-motor-dvt' && f.kind === 'eta');
  assert.deepEqual(motor.map((f) => [f.value, f.status]), [['2026-10-26', 'superseded'], ['2026-11-13', 'superseded'], ['2026-11-20', 'superseded'], ['2026-11-20', 'accepted']]);
  // as known on 10/15: Samir's 11/13 is the accepted ETA and the bracket link does not exist yet
  const v = graphAt(g, '2026-10-15T12:00:00-07:00');
  assert.equal(v.facts.filter((f) => f.subject === 'dl-hip-motor-dvt' && f.status === 'accepted').at(-1).value, '2026-11-13');
  assert.ok(!v.edges.some((x) => x.from === 'pt-hip-bracket' && x.to === 'test-hip-spin' && x.evidence.some((ev) => ev.via !== 'structured' && Date.parse(ev.at) > Date.parse('2026-10-15T12:00:00-07:00'))));
  assert.ok(!v.edges.some((x) => x.from === 'pt-hip-bracket' && x.to === 'test-hip-spin'));
  // disputed: two authorities, same time, different values
  const docs2 = [...sources.docs, doc('dvt motor eta 11/21', { id: 'slack:C07FLK0ACTU:9.1', at: '2026-11-08T09:00:00-08:00' }),
    doc('dvt motor eta 11/25', { id: 'slack:C07FLK0SUPC:9.2', container: 'C07FLK0SUPC', at: '2026-11-08T09:00:00-08:00', author: { name: 'Samir Khoury', email: 'samir@flintlockrobotics.com', slack_id: 'U07FLK0SAMI' } })];
  const g2 = graphAt(buildGraph({ settings, sources: { ...sources, docs: docs2 } }), NOW);
  assert.deepEqual(g2.facts.filter((f) => f.subject === 'dl-hip-motor-dvt' && f.status === 'disputed').map((f) => f.value).sort(), ['2026-11-21', '2026-11-25']);
});

function demoCheck(settingsX, sourcesX) {
  const g = buildGraph({ settings: settingsX, sources: sourcesX });
  const r = demoInputs(graphAt(g, NOW), 'pt-hip-bracket');
  assert.equal(r.test.id, 'test-hip-spin');
  assert.equal(r.milestone.id, 'm-hip-spin-test');
  assert.equal(r.milestone.target, '2026-11-24');
  const m = r.inputs.find((i) => i.id === 'dl-hip-motor-dvt');
  assert.equal(m.ready, '2026-11-20');
  assert.equal(m.said_by, 'p-arjun');
  assert.match(m.doc_id, /^slack:/);
  assert.equal(r.inputs[0].id, 'pt-hip-bracket');
  assert.equal(r.planned_start.value, '2026-11-23');
  assert.ok(r.duration.min >= 2 && r.duration.max === 3);
  assert.equal(r.rig.id, 'rig-spin-test-stand');
  assert.deepEqual([r.policy.type, r.policy.usd_per_day, r.policy.set_by], ['per_day', 600, 'p-arjun']);
  // live changes appended as Slack docs
  let src = sourcesX, prev = NOW;
  const want = ['2026-11-30', { min: '2026-11-19', max: '2026-11-30' }, '2026-11-27'];
  const by = ['p-arjun', 'p-arjun', 'p-samir'];
  sourcesX.demo.liveChanges.changes.forEach((ch, i) => {
    const d = liveChangeDoc(ch, prev, settingsX.people); prev = d.at; src = appendDocs(src, [d]);
    const rr = demoInputs(graphAt(buildGraph({ settings: settingsX, sources: src }), d.at), 'pt-hip-bracket');
    const mm = rr.inputs.find((x) => x.id === 'dl-hip-motor-dvt');
    assert.deepEqual(mm.ready, want[i]); if (i < 2) assert.equal(mm.said_by, by[i]); assert.equal(mm.doc_id, d.id);
  });
  return r;
}

test('bad input: unknown ids, empty settings and malformed times give gaps, nulls or clear errors', () => {
  const view = graphAt(buildGraph({ settings, sources }), NOW);
  assert.deepEqual(demoInputs(view, 'pt-no-such-part').gaps, [{ kind: 'structural', text: 'no known test for pt-no-such-part' }]);
  const empty = graphAt(buildGraph({ settings: {}, sources: {} }), NOW);
  assert.equal(demoInputs(empty, 'pt-hip-bracket').test, null);
  assert.throws(() => buildGraph({ sources }), TypeError);
  assert.throws(() => graphAt(empty, 'yesterday'), RangeError);
  assert.throws(() => demoInputs(null, 'pt-hip-bracket'), TypeError);
  assert.deepEqual(claimsOf('need 4x FL-HIP-1042 by 11/20', { at: 'not a time' }), []); // no reference day, no relative dates
  assert.equal(parseDate('2/30', '2026-02-10'), null);
  assert.equal(parseDate('11/20', 'garbage'), null);
  assert.deepEqual(progressRank({ settings: {}, sources: {} }, '2026-10-05'), []);
  assert.throws(() => progressRank({ settings, sources }, 'someday'), RangeError);
  assert.deepEqual(makeResolver(null)(null), []);
});

test('demo path on the hand-made fixture', () => { demoCheck(settings, sources); });

test('progress: done share per assembly, ranked within each milestone', () => {
  const rows = progressRank({ settings, sources }, '2026-10-19');
  const row = (a, m) => rows.find((r) => r.assembly === a && r.milestone === m);
  // HIP-402 (spin coupling, hip) Done 10/20; HIP-403 (knee flange) open; HIP-401 created 10/28 is after the week
  assert.equal(row('a-hip-actuator', 'm-actuator-dvt-build').done_share, 1);
  assert.equal(row('a-knee-actuator', 'm-actuator-dvt-build').done_share, 0);
  assert.equal(row('a-knee-actuator', 'm-actuator-dvt-build').rank, 1);
  assert.equal(row('a-hip-actuator', 'm-actuator-dvt-build').rank, 2);
  // a later week sees HIP-401 (open) and the extra done claim
  const later = progressRank({ settings, sources: { ...sources, docs: [...sources.docs, doc('spin test done mon 11/2', { at: '2026-11-03T09:00:00-08:00' })] } }, '2026-11-02');
  const h = later.find((r) => r.assembly === 'a-hip-actuator' && r.milestone === 'm-hip-spin-test');
  assert.deepEqual([h.done, h.total, h.claim_done, h.rank], [2, 3, 1, 1]);
});

// Rerun on the rendered data when it exists.
const demoDir = path.join(ROOT, 'fixtures/timevalue/demo-sources');
const settingsPath = path.join(ROOT, 'fixtures/timevalue/settings.json');
test('demo path on the rendered demo sources + settings.json', { skip: !(fs.existsSync(demoDir) && fs.existsSync(settingsPath)) }, async () => {
  const realSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  demoCheck(realSettings, loadSources(demoDir));
});

test('full rendered sources: graph builds fast and the demo test is found', { skip: !(fs.existsSync(settingsPath)) }, async () => {
  const realSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  const src = loadSources(path.join(ROOT, 'fixtures/flintlock'));
  const t0 = Date.now();
  const claims = extractAllClaims({ settings: realSettings, sources: src });
  const g = buildGraph({ settings: realSettings, sources: src, claims });
  assert.ok(Date.now() - t0 < 20000);
  assert.ok(g.edges.length > 0);
  assert.equal(demoInputs(graphAt(g, NOW), 'pt-hip-bracket').test?.id, 'test-hip-spin');
});
