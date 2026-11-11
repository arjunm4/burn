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
  assert.deepEqual(events.filter(e => e.type === 'tool.completed').map(e => e.summary), ['PR-2291', 'no messages', 'EVT build · Nov 14', '4 engineers', '> $500 needs approval']);
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

test('short or partial text never matches a part', async () => {
  for (const text of ['s x2', 'sens', 'acs', 'probe-ish thing', 'chamberlain']) {
    const out = await analyze({text});
    assert.equal(out.parsed.decisionId, null, text);
  }
  assert.equal((await analyze({text: 'Need a thermal chamber for a week'})).parsed.decisionId, 'cham');
});

// Minimal stand-in for the SDK client: replays scripted assistant turns.
const scripted = turns => ({beta: {messages: {create: async () => turns.shift()}}});
const use = (id, name, input) => ({type: 'tool_use', id, name, input});

test('Claude path runs same-turn tools and verifies a skipped find_part', async () => {
  const events = [];
  const out = await analyze({text: 'ACS37002 × 40 from Digi-Key, standard'}, e => events.push(e), {client: scripted([
    {stop_reason: 'tool_use', content: [use('a', 'check_policy', {}),
      use('b', 'finish_analysis', {decisionId: 'sens', qty: 40, vendor: 'Digi-Key', askedTier: 0, question: {text: 'Can firmware start on Rev B?', choiceIds: ['revb_yes', 'revb_no']}})]},
  ])});
  assert.equal(out.planner, 'claude');
  assert.equal(out.parsed.decisionId, 'sens');
  assert.equal(out.question.text, 'Can firmware start on Rev B?');
  assert.deepEqual(out.question.choices.map(c => c.id), ['revb_yes', 'revb_no']);
  assert.deepEqual(events.filter(e => e.type === 'tool.completed').map(e => e.name), ['check_policy', 'find_part']);
});

test('Claude path falls back when the model misbehaves', async () => {
  const events = [];
  const out = await analyze({text: 'Scope probes x 3'}, e => events.push(e), {client: scripted([{stop_reason: 'end_turn', content: [{type: 'text', text: 'done'}]}])});
  assert.equal(out.planner, 'fallback');
  assert.equal(out.parsed.decisionId, 'probe');
  assert.ok(events.some(e => e.type === 'agent.fallback'));
});

test('with an active ingest, tools read ingested Slack and the graph', async () => {
  const {createIngest, sourcesFromEnv} = await import('../ingest/index.js');
  const {setActiveIngest} = await import('../ingest/active.js');
  const {buildGraph} = await import('../graph/extract.js');
  const ingest = createIngest({filename: ':memory:', sources: sourcesFromEnv({BURN_WORLD: 'fixtures'}), build: docs => buildGraph(docs, {offline: true}), now: () => new Date('2026-11-09T18:00:00Z')});
  await ingest.sync(); setActiveIngest(ingest);
  try {
    const events = [];
    await analyze({text: 'ACS37002 × 40 from Digi-Key, standard shipping.'}, e => events.push(e));
    const done = Object.fromEntries(events.filter(e => e.type === 'tool.completed').map(e => [e.name, e]));
    assert.equal(done.read_project_channel.result.channel, '#rev-c-bringup');
    assert.ok(done.read_project_channel.result.items.some(i => /blocked until the ACS37002/.test(i.text)));
    assert.equal(done.check_hardware_calendar.summary, 'EVT build · Nov 14');
    assert.equal(done.map_dependencies.result.source, 'graph');
    assert.deepEqual(done.map_dependencies.result.people.sort(), ['Anya Petrov', 'Lee Tan', 'Marco Ruiz', 'Sam Oyelaran']);
    assert.equal(done.map_dependencies.summary, '4 engineers');
  } finally { setActiveIngest(null); ingest.close(); }
});
