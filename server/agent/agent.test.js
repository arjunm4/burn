import {test} from 'node:test';
import assert from 'node:assert/strict';
import {analyze, parseRequest} from './index.js';

process.env.AGENT_OFFLINE = '1';

test('fallback parses the sensor request and asks the Rev B question', async () => {
  const events = [];
  const out = await analyze({text: 'ACS37002 × 40 from Digi-Key, standard shipping.'}, e => events.push(e));
  assert.deepEqual(out.parsed, {decisionId: 'sens', qty: 40, vendor: 'Digi-Key', askedTier: 0});
  assert.deepEqual(out.question.choices.map(c => c.id), ['revb_yes', 'revb_no']);
  assert.match(out.question.text, /Firmware validation and Thermal & EMC wait on these/);
  assert.deepEqual(events.filter(e => e.type === 'tool.completed').map(e => e.summary), ['PR-2291', '2 work items', 'EVT build · Nov 14', '4 engineers', '> $500 needs approval']);
});

test('requests without an open question get none', async () => {
  const out = await analyze({text: 'Scope probes x 3, priority'});
  assert.equal(out.parsed.decisionId, 'probe');
  assert.equal(out.question, null);
});

test('unknown parts are reported, not guessed', async () => {
  const out = await analyze({text: 'Unobtainium widget × 2'});
  assert.equal(out.parsed.decisionId, null);
});

test('asked tier matches tier names', () => {
  assert.equal(parseRequest('expedite it', [{name: 'Standard'}, {name: 'Expedited'}]).askedTier, 0);
  assert.equal(parseRequest('expedited please', [{name: 'Standard'}, {name: 'Expedited'}]).askedTier, 1);
});
