import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createStore} from '../server/store.js';
import {applyToolEvent, buildConversation, day, needsRun} from './conversation.js';

const flow = fn => { const store = createStore(':memory:'); try { return fn(store); } finally { store.close(); } };
const texts = msgs => msgs.map(m => m.text).filter(Boolean);

test('dates read from the order date: standard is 7 days after EVT', () => flow(store => {
  let r = store.mutate('sens', 'answer', {answer: 'no', revision: 0});
  const msgs = buildConversation(r);
  assert.match(texts(msgs).at(-1), /standard lands Nov 21, 7 days after Nov 14, with 4 engineers waiting/);
  const rows = msgs.at(-1).rows;
  assert.deepEqual(rows.map(x => x.total), ['$31,100', '$9,450', '$1,200']);
  assert.deepEqual(rows.map(x => x.tag), ['', '', 'Recommended']);
  assert.ok(rows.every(x => x.action?.type === 'select'));
}));

test('Rev B yes drafts standard without contradicting dates', () => flow(store => {
  const r = store.mutate('sens', 'answer', {answer: 'yes', revision: 0});
  const last = buildConversation(r).at(-1);
  assert.match(last.text, /nothing waits on these, so standard is fine/);
  assert.equal(last.rows[0].detail, '$300 · arrives Nov 21');
}));

test('pending approval explains why and approval closes the loop', () => flow(store => {
  let r = store.mutate('sens', 'answer', {answer: 'no', revision: 0});
  r = store.mutate('sens', 'select', {tier: 0, revision: r.revision});
  let last = buildConversation(r).at(-1);
  assert.equal(last.meta, 'Differs from recommendation');
  assert.equal(last.status, 'Waiting on Priya');
  r = store.mutate('sens', 'approve', {tier: 2, revision: r.revision});
  last = buildConversation(r).at(-1);
  assert.match(last.text, /Priya approved expedited, arriving Nov 14/);
}));

test('agent events build the working list and fallback resets it', () => {
  let tools = applyToolEvent([], {type: 'tool.started', index: 0, name: 'find_part', label: 'Matching part'});
  tools = applyToolEvent(tools, {type: 'tool.completed', index: 0, name: 'find_part', label: 'Matching part', summary: 'PR-2291'});
  assert.deepEqual(tools, [{index: 0, label: 'Matching part', summary: 'PR-2291', done: true}]);
  assert.deepEqual(applyToolEvent(tools, {type: 'agent.fallback'}), []);
  const legacy = applyToolEvent([], {type: 'tool.completed', index: 1, name: 'check_hardware_calendar', result: {milestone: 'EVT build · Nov 14'}});
  assert.equal(legacy[0].summary, 'EVT build · Nov 14');
});

test('agent question, unsupported and run detection', () => {
  const base = flow(store => store.get('sens'));
  const q = {id: 'revb', text: 'Can firmware use Rev B?', choices: [{id: 'revb_yes', label: 'Yes'}, {id: 'revb_no', label: 'No'}]};
  const msgs = buildConversation({...base, question: q});
  assert.equal(msgs.at(-1).text, 'Can firmware use Rev B?');
  assert.deepEqual(msgs.at(-1).choices.map(c => c.action.body), [{answer: 'yes', choiceId: 'revb_yes'}, {answer: 'no', choiceId: 'revb_no'}]);
  assert.ok(buildConversation({...base, status: 'unsupported'}).at(-1).compose);
  assert.equal(needsRun(base), true);
  assert.equal(needsRun({...base, question: q}), false);
  assert.equal(day('2026-11-14'), 'Nov 14');
});

test('planner is labelled so an offline run is never mistaken for the model', () => {
  const base = flow(store => store.get('sens'));
  assert.equal(buildConversation({...base, analysis: {planner: 'fallback'}})[1].meta, 'Offline planner · no model call');
  assert.equal(buildConversation({...base, analysis: {planner: 'claude'}})[1].meta, 'Planned by Claude');
});

test('every seeded request renders its own state without the Rev B question', () => flow(store => {
  for (const r of store.snapshot().requests) {
    const msgs = buildConversation(r);
    if (r.id !== 'sens') assert.ok(!texts(msgs).some(t => /Rev B/.test(t)), r.id + ' shows the Rev B question');
    if (['choosing', 'pending_approval', 'ordered'].includes(r.status) && r.id !== 'sens') assert.ok(msgs.some(m => m.rows), r.id + ' has no options');
    if (r.status === 'waiting') assert.match(buildConversation(r, {requests: store.snapshot().requests}).at(-1).text, /depends on ACS37002 sensors × 40 \(PR-2291\)/);
  }
}));

test('matched request without a question goes straight to actionable options', () => flow(store => {
  const probe = {...store.get('probe'), status: 'choosing', answer: null, question: null, analysis: {planner: 'fallback'}, selectedTier: null, approvedTier: null, order: null};
  const last = buildConversation(probe).at(-1);
  assert.match(last.text, /Nobody waits on these, so standard is fine/);
  assert.ok(last.rows.every(r => r.action?.type === 'select'));
}));
