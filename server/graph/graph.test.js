import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildGraph} from './extract.js';
import {analyzeGraph, blockedPeople} from '../../src/graph/engine.js';
import {arrivalDate, ORDER_DATE} from '../../src/decisions.js';
import {fixtureDocuments} from './fixture-docs.test-helper.js';

const graph = await buildGraph(fixtureDocuments(), {offline: true});
const has = (from, kind, to) => graph.edges.some(e => e.from === from && e.kind === kind && e.to === to);
// Shipping days per tier come from the request catalog: sensors 12/7/5, harness 9 (current) / 5 (second vendor).
const run = (sens, harn) => analyzeGraph(graph, {orderDate: ORDER_DATE, arrivals: {'part:sens': arrivalDate(sens), 'part:harn': arrivalDate(harn)}});

test('rules recover the Rev C dependency chain from Slack and the calendar', () => {
  assert.equal(graph.extractor, 'rules');
  for (const [f, k, t] of [
    ['part:sens', 'blocks', 'work:firmware-validation'], ['part:sens', 'due', 'milestone:evt-build'], ['part:harn', 'due', 'milestone:evt-build'],
    ['milestone:evt-build', 'blocks', 'work:firmware-validation'], ['work:firmware-validation', 'blocks', 'work:thermal-and-emc'],
    ['part:cham', 'blocks', 'work:thermal-and-emc'], ['work:thermal-and-emc', 'due', 'milestone:dvt-kickoff'],
    ['person:lee-tan', 'assigned', 'work:firmware-validation'], ['person:marco-ruiz', 'assigned', 'work:firmware-validation'],
    ['person:anya-petrov', 'assigned', 'work:thermal-and-emc'], ['person:sam-oyelaran', 'assigned', 'work:thermal-and-emc'],
    ['part:mold', 'blocks', 'work:fit-check'], ['work:fit-check', 'due', 'milestone:dvt-kickoff'], ['part:load', 'blocks', 'work:calibration-rig'],
  ]) assert.ok(has(f, k, t), `${f} ${k} ${t}`);
  assert.ok(graph.edges.every(e => e.evidence.length > 0), 'every edge cites evidence');
  assert.ok(!graph.nodes.some(n => /approval|reminder/i.test(n.label)), 'policy chatter is not work');
  assert.deepEqual(graph.nodes.find(n => n.id === 'person:marco-ruiz').attrs.ooo.map(w => [w.start, w.end]), [['2026-11-02', '2026-11-12']]);
  assert.equal(graph.nodes.find(n => n.id === 'work:firmware-validation').attrs.durationDays, 4);
});

test('fastest shipping holds EVT; DVT is unknown because fit check has no stated duration', () => {
  const best = run(5, 5);
  assert.equal(best.at['milestone:evt-build'].slip, 0);
  assert.deepEqual([best.at['work:firmware-validation'].start, best.at['work:thermal-and-emc'].finish], ['2026-11-14', '2026-11-21']);
  // Fit check feeds DVT but nobody stated how long it takes: DVT can't be dated, not "on time".
  assert.equal(best.at['work:fit-check'].finish, null);
  assert.deepEqual([best.at['milestone:dvt-kickoff'].finish, best.at['milestone:dvt-kickoff'].slip], [null, null]);
  assert.ok(best.unknown.includes('milestone:dvt-kickoff'));
  assert.deepEqual(best.conflicts.map(c => [c.node, c.work]), [['part:cham', 'work:thermal-and-emc']]);
});

test('standard sensors slip EVT a week and push the stated work by the same amount; no salary pricing', () => {
  const best = run(5, 5), standard = run(12, 5);
  assert.equal(standard.at['milestone:evt-build'].slip, 7);
  assert.equal(standard.days['work:thermal-and-emc'].finish - best.days['work:thermal-and-emc'].finish, 7);
  assert.ok(standard.critical.nodes.includes('part:sens'));
  assert.deepEqual(blockedPeople(graph, 'part:sens').sort(), ['person:anya-petrov', 'person:lee-tan', 'person:marco-ruiz', 'person:sam-oyelaran']);
});

test('with the current harness vendor, the harness becomes the critical path', () => {
  const expedited = run(5, 9);
  assert.equal(expedited.at['milestone:evt-build'].slip, 4);
  assert.ok(expedited.critical.nodes.includes('part:harn'));
  assert.ok(!expedited.critical.nodes.includes('part:sens'));
});

test('a cycle blocks its nodes and everything after it instead of scheduling them', () => {
  const w = (id, d) => ({id, kind: 'work', label: id, attrs: {durationDays: d}});
  const g = {nodes: [w('a', 2), w('b', 2), w('c', 1), w('free', 3)],
    edges: [{id: '1', from: 'a', to: 'b', kind: 'blocks', evidence: ['x']}, {id: '2', from: 'b', to: 'a', kind: 'blocks', evidence: ['x']}, {id: '3', from: 'b', to: 'c', kind: 'blocks', evidence: ['x']}]};
  const r = analyzeGraph(g, {orderDate: ORDER_DATE});
  assert.deepEqual(r.blocked.sort(), ['a', 'b', 'c']);
  assert.ok(!r.at.a && !r.at.c, 'blocked nodes get no dates');
  assert.equal(r.at.free.finish, '2026-11-12');
});

test('unknown durations stay unknown and propagate; known ones still schedule', () => {
  const g = {nodes: [{id: 'p', kind: 'part', label: 'P', attrs: {}}, {id: 'w', kind: 'work', label: 'W', attrs: {}}, {id: 'm', kind: 'milestone', label: 'M', attrs: {date: '2026-11-20'}}],
    edges: [{id: '1', from: 'p', to: 'w', kind: 'blocks', evidence: ['x']}, {id: '2', from: 'w', to: 'm', kind: 'due', evidence: ['x']}]};
  const r = analyzeGraph(g, {orderDate: ORDER_DATE, arrivals: {p: '2026-11-12'}});
  assert.deepEqual([r.at.w.start, r.at.w.finish, r.at.m.finish, r.at.m.slip], ['2026-11-12', null, null, null]);
  assert.deepEqual(r.unknown.sort(), ['m', 'w']);
  assert.deepEqual(r.critical.nodes, [], 'no critical path through unknown dates');
  g.nodes[1].attrs.durationDays = 10;
  assert.equal(analyzeGraph(g, {orderDate: ORDER_DATE, arrivals: {p: '2026-11-12'}}).at.m.slip, 2);
});

test('Claude extraction keeps only edges with real evidence and known keys', async () => {
  const docs = fixtureDocuments();
  const lee = docs.find(d => /blocked until/.test(d.text));
  const client = {messages: {create: async () => ({stop_reason: 'end_turn', content: [{type: 'text', text: JSON.stringify({
    work: [{label: 'Firmware validation', durationDays: 4, evidence: [lee.id]}],
    edges: [
      {from: 'part:sens', to: 'work:Firmware validation', kind: 'blocks', evidence: [lee.id], confidence: .9},
      {from: 'part:sens', to: 'work:Firmware validation', kind: 'due', evidence: ['made-up-id'], confidence: .9},
      {from: 'part:nope', to: 'work:Firmware validation', kind: 'blocks', evidence: [lee.id], confidence: .9},
    ]})}]})}};
  const g = await buildGraph(docs, {client});
  assert.equal(g.extractor, 'claude');
  assert.deepEqual(g.edges.map(e => [e.from, e.kind, e.to, e.via]), [['part:sens', 'blocks', 'work:firmware-validation', 'llm']]);
  assert.equal(g.nodes.find(n => n.id === 'milestone:evt-build').attrs.date, '2026-11-14');
});

test('a failing model call falls back to rules', async () => {
  const g = await buildGraph(fixtureDocuments(), {client: {messages: {create: async () => { throw new Error('boom'); }}}});
  assert.equal(g.extractor, 'rules');
  assert.equal(g.error, 'boom');
  assert.ok(g.edges.length > 10);
});

test('scenario defaults reflect requests and the approver focus keeps sibling blockers', async () => {
  const {createStore} = await import('../store.js');
  const {arrivalsFor, defaultChoices} = await import('../../src/graph/scenario.js');
  const {focusGraph, layout} = await import('../../src/graph/layout.js');
  const store = createStore(':memory:');
  try {
    const {requests} = store.snapshot();
    assert.equal(defaultChoices(requests).sens, 0, 'sensors default to the standard shipping Dana asked for');
    const a = analyzeGraph(graph, {orderDate: ORDER_DATE, arrivals: arrivalsFor(graph, requests, {sens: 2, harn: 0})});
    assert.equal(a.at['milestone:evt-build'].slip, 4);
    const sub = focusGraph(graph, 'part:sens');
    assert.ok(sub.nodes.some(n => n.id === 'part:harn'), 'harness explains the remaining EVT slip');
    assert.ok(!sub.nodes.some(n => n.id === 'part:fpga'), 'unrelated chains are left out');
    const geo = layout(sub, a, {width: 800});
    assert.ok(geo.rows.length >= 6 && geo.edges.every(e => e.path.startsWith('M ')));
  } finally { store.close(); }
});
