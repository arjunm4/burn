import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildGraph} from './extract.js';
import {analyzeGraph, idleCost, blockedPeople} from '../../src/graph/engine.js';
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

test('fastest shipping holds EVT and DVT; the stale chamber booking is flagged', () => {
  const best = run(5, 5);
  assert.equal(best.at['milestone:evt-build'].slip, 0);
  assert.deepEqual([best.at['work:firmware-validation'].start, best.at['work:thermal-and-emc'].finish], ['2026-11-14', '2026-11-21']);
  assert.equal(best.at['milestone:dvt-kickoff'].slip, 0);
  assert.deepEqual(best.conflicts.map(c => [c.node, c.work]), [['part:cham', 'work:thermal-and-emc']]);
});

test('standard sensors slip EVT a week and idle four engineers ($30,800, matching the request totals)', () => {
  const best = run(5, 5), standard = run(12, 5);
  assert.equal(standard.at['milestone:evt-build'].slip, 7);
  assert.equal(standard.at['milestone:dvt-kickoff'].slip, 4);
  assert.ok(standard.critical.nodes.includes('part:sens'));
  assert.deepEqual(idleCost(graph, best, standard), {items: [
    {work: 'work:firmware-validation', delay: 7, people: 2, engineerDays: 14}, {work: 'work:thermal-and-emc', delay: 7, people: 2, engineerDays: 14},
    {work: 'work:calibration-rig', delay: 7, people: 0, engineerDays: 0},
  ].filter(i => i.engineerDays), engineerDays: 28, cost: 30800});
  assert.deepEqual(blockedPeople(graph, 'part:sens').sort(), ['person:anya-petrov', 'person:lee-tan', 'person:marco-ruiz', 'person:sam-oyelaran']);
});

test('with the current harness vendor, the harness becomes the critical path', () => {
  const expedited = run(5, 9);
  assert.equal(expedited.at['milestone:evt-build'].slip, 4);
  assert.ok(expedited.critical.nodes.includes('part:harn'));
  assert.ok(!expedited.critical.nodes.includes('part:sens'));
});

test('cycles are reported instead of hanging', () => {
  const g = {nodes: [{id: 'a', kind: 'work', label: 'A', attrs: {}}, {id: 'b', kind: 'work', label: 'B', attrs: {}}],
    edges: [{id: '1', from: 'a', to: 'b', kind: 'blocks', evidence: ['x']}, {id: '2', from: 'b', to: 'a', kind: 'blocks', evidence: ['x']}]};
  assert.deepEqual(analyzeGraph(g, {orderDate: ORDER_DATE}).cyclic.sort(), ['a', 'b']);
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
