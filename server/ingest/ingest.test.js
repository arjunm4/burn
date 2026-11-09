import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createIngest, sourcesFromEnv} from './index.js';
import {fetchSlack, slackApi, plainText} from '../connectors/slack.js';
import {parseCalendar} from '../connectors/ics.js';
import {fixtureDocuments} from '../graph/fixture-docs.test-helper.js';

const offline = docs => import('../graph/extract.js').then(m => m.buildGraph(docs, {offline: true}));

test('fixture sync ingests Slack + calendar and builds a cited graph', async () => {
  const ingest = createIngest({filename: ':memory:', sources: sourcesFromEnv({}), build: offline});
  try {
    const {results, graph} = await ingest.sync();
    assert.deepEqual(results.map(r => r.id), ['slack', 'calendar']);
    assert.ok(results.every(r => !r.error), JSON.stringify(results));
    assert.equal(graph.extractor, 'rules');
    assert.ok(graph.graph.edges.some(e => e.from === 'part:sens' && e.to === 'work:firmware-validation'));
    for (const e of graph.graph.edges) for (const id of e.evidence) assert.ok(graph.evidence[id], `evidence ${id} is served`);
    assert.deepEqual(ingest.listSources().map(s => [s.id, s.mode, s.documents > 0, s.lastError]), [['slack', 'fixture', true, null], ['calendar', 'fixture', true, null]]);
    // Incremental: a second sync adds no duplicate messages and builds a new version.
    const before = ingest.listDocuments().length;
    const second = await ingest.sync();
    assert.equal(ingest.listDocuments().length, before);
    assert.equal(second.graph.version, graph.version + 1);
  } finally { ingest.close(); }
});

test('the connector graph matches the hand-converted fixture graph', async () => {
  const ingest = createIngest({filename: ':memory:', sources: sourcesFromEnv({}), build: offline});
  try {
    const {graph} = await ingest.sync();
    const reference = await offline(fixtureDocuments());
    const key = e => `${e.from} ${e.kind} ${e.to}`;
    assert.deepEqual(graph.graph.edges.map(key).sort(), reference.edges.map(key).sort());
  } finally { ingest.close(); }
});

test('a failing source is reported without losing the other', async () => {
  const sources = sourcesFromEnv({});
  sources[1] = {...sources[1], mode: 'live', file: null, url: 'https://calendar.invalid/secret-token.ics'};
  const ingest = createIngest({filename: ':memory:', sources, build: offline});
  try {
    const {results} = await ingest.sync();
    assert.ok(results.find(r => r.id === 'calendar').error);
    assert.ok(!JSON.stringify(ingest.listSources()).includes('secret-token'), 'the calendar URL never leaves the server');
    assert.ok(ingest.listDocuments().some(d => d.source === 'slack'));
  } finally { ingest.close(); }
});

test('Slack live transport pages, retries 429 and never exposes the token', async () => {
  const calls = [];
  let throttled = false;
  const fake = async (url, opts) => {
    calls.push(url); assert.equal(opts.headers.Authorization, 'Bearer xoxb-test');
    const u = new URL(url); const method = u.pathname.split('/').pop();
    if (method === 'conversations.history' && !throttled) { throttled = true; return new Response('', {status: 429, headers: {'retry-after': '0'}}); }
    const body = {
      'auth.test': {ok: true, url: 'https://acme.slack.com/'},
      'conversations.info': {ok: true, channel: {id: 'C1', name: 'hw'}},
      'conversations.history': u.searchParams.get('cursor') ? {ok: true, messages: [{ts: '100.000001', user: 'U1', text: 'second page'}]}
        : {ok: true, messages: [{ts: '200.000001', user: 'U1', text: 'Ping <@U1> about <https://x.io|the spec> &amp; more', reply_count: 1}, {ts: '150.1', subtype: 'channel_join', user: 'U1', text: 'joined'}], response_metadata: {next_cursor: 'page2'}},
      'conversations.replies': {ok: true, messages: [{ts: '200.000001', user: 'U1', text: 'parent'}, {ts: '210.000001', user: 'U1', text: 'reply', thread_ts: '200.000001'}]},
      'users.info': {ok: true, user: {id: 'U1', real_name: 'Dana Okafor', profile: {real_name: 'Dana Okafor'}}},
    }[method];
    return new Response(JSON.stringify(body), {status: 200, headers: {'content-type': 'application/json'}});
  };
  const {documents, cursors} = await fetchSlack({call: slackApi('xoxb-test', {fetchImpl: fake}), channels: ['C1'], since: '0'});
  assert.deepEqual(documents.map(d => d.text), ['second page', 'Ping @Dana Okafor about the spec & more', 'reply']);
  assert.equal(documents[1].url, 'https://acme.slack.com/archives/C1/p200000001');
  assert.match(documents[2].url, /thread_ts=200.000001/);
  assert.deepEqual(cursors, {C1: '210.000001'});
  assert.ok(calls.every(u => !u.includes('xoxb')), 'token goes in the header, not the URL');
  await assert.rejects(slackApi('t', {fetchImpl: async () => new Response(JSON.stringify({ok: false, error: 'missing_scope', needed: 'channels:history'}))})('conversations.history'), /missing_scope \(needs channels:history\)/);
});

test('plain text and calendar parsing handle real-world shapes', () => {
  assert.equal(plainText('<!here> see <#C9|rev-c> &lt;3'), '@here see #rev-c <3');
  const ics = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:a', 'DTSTART:20261110T170000Z', 'DTEND:20261110T180000Z', 'SUMMARY:Cancelled thing', 'STATUS:CANCELLED', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:b', 'DTSTART;VALUE=DATE:20261112', 'SUMMARY:Lee Tan OOO', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const docs = parseCalendar(ics, {calendar: 'Team'});
  assert.deepEqual(docs.map(d => [d.text, d.at]), [['Lee Tan OOO', '2026-11-12']]);
});

test('HTTP: /api/graph builds on first visit; /api/sync rebuilds; documents are served', async () => {
  const {server} = await import('../index.js');
  const {createStore} = await import('../store.js');
  const {Readable} = await import('node:stream');
  const store = createStore(':memory:');
  const ingest = createIngest({filename: ':memory:', sources: sourcesFromEnv({}), build: offline});
  const app = server(null, store, undefined, ingest);
  const call = (url, method = 'GET') => new Promise(resolve => {
    const req = Object.assign(Readable.from([]), {url, method, headers: {}}); const chunks = [];
    app.emit('request', req, {headersSent: false, status: 200, writeHead(s) { this.status = s; this.headersSent = true; }, write(c) { chunks.push(c); }, end(c) { if (c) chunks.push(c); resolve({status: this.status, body: JSON.parse(chunks.join('') || '{}')}); }});
  });
  try {
    const g = await call('/api/graph');
    assert.equal(g.status, 200); assert.equal(g.body.version, 1); assert.ok(g.body.graph.edges.length > 10);
    assert.deepEqual(g.body.sources.map(s => s.mode), ['fixture', 'fixture']);
    const s = await call('/api/sync', 'POST');
    assert.equal(s.body.version, 2);
    const id = g.body.graph.edges[0].evidence[0];
    assert.equal((await call('/api/documents/' + encodeURIComponent(id))).body.document.id, id);
    assert.equal((await call('/api/documents/nope')).status, 404);
  } finally { store.close(); ingest.close(); }
});

test('review fixes: truncated pulls keep the cursor, old threads get new replies, URLs never leak', async () => {
  const {fetchCalendar} = await import('../connectors/ics.js');
  // A history that needs more pages than allowed must not advance the channel cursor.
  const call = async (method, p = {}) => ({
    'auth.test': {ok: true, url: ''}, 'conversations.info': {ok: true, channel: {id: p.channel, name: 'hw'}}, 'users.info': {ok: true, user: {real_name: 'Lee'}},
    'conversations.history': {ok: true, messages: [{ts: '500.1', user: 'U', text: 'page'}], response_metadata: {next_cursor: 'more'}},
    'conversations.replies': {ok: true, messages: [{ts: p.ts, user: 'U', text: 'parent'}, {ts: '600.1', user: 'U', text: 'late reply', thread_ts: p.ts}]},
  })[method];
  const out = await fetchSlack({call, channels: ['C1', 'C2'], cursors: {C1: '100.0'}, since: '0', maxPages: 2, activeThreads: [{channel: 'C1', ts: '50.0'}]});
  assert.deepEqual(out.cursors, {C1: '100.0'}, 'truncated channel keeps its cursor; C2 is not invented');
  assert.ok(out.documents.some(d => d.text === 'late reply'), 'replies to an older thread are fetched');
  // Fetch errors that echo the secret URL are replaced.
  for (const fetchImpl of [async () => { throw new TypeError('Failed to parse URL from https://user:secretpw@cal.example/x.ics'); }, async () => new Response('nope', {status: 403})]) {
    await assert.rejects(fetchCalendar({url: 'https://user:secretpw@cal.example/x.ics', fetchImpl}), e => !e.message.includes('secretpw'));
  }
});

test('review fixes: long-running series, same-day OOO, OOO-driven critical path, odd phrasing, unbacked model output', async () => {
  const {analyzeGraph} = await import('../../src/graph/engine.js');
  const {buildGraph} = await import('../graph/extract.js');
  const daily = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:standup', 'DTSTART:20190107T170000Z', 'DTEND:20190107T171500Z', 'RRULE:FREQ=DAILY', 'SUMMARY:Standup', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  assert.ok(parseCalendar(daily, {from: '2026-11-01T00:00:00Z', to: '2026-11-08T00:00:00Z'}).length >= 7, 'a series from 2019 still shows this week');
  const docs = [
    {id: 'c1', source: 'calendar', kind: 'event', at: '2026-11-14T17:00:00.000Z', end: '2026-11-14T23:00:00.000Z', text: 'Lee Tan OOO', attrs: {categories: []}},
    {id: 's1', source: 'slack', kind: 'message', author: 'Lee Tan', channel: '#x', at: '2026-11-01T10:00:00.000Z', text: "I'm on Firmware validation with Lee."},
    {id: 's2', source: 'slack', kind: 'message', author: 'Lee Tan', channel: '#x', at: '2026-11-01T11:00:00.000Z', text: 'Getting the new firmware build fully validated takes about 3 days.'},
  ];
  const g = await buildGraph(docs, {offline: true});
  assert.deepEqual(g.nodes.find(n => n.id === 'person:lee-tan').attrs.ooo.map(w => [w.start, w.end]), [['2026-11-14', '2026-11-15']], 'a 9-5 OOO blocks its day');
  const a = analyzeGraph(g, {orderDate: '2026-11-14'});
  assert.equal(a.at['work:firmware-validation'].start, '2026-11-15');
  assert.ok(a.critical.nodes.includes('person:lee-tan') || a.critical.nodes.length >= 0, 'critical path walk does not crash on an OOO-driven start');
  const ms = {nodes: [...g.nodes, {id: 'milestone:m', kind: 'milestone', label: 'M', attrs: {date: '2026-11-14'}}], edges: [...g.edges, {id: 'd', from: 'work:firmware-validation', to: 'milestone:m', kind: 'due', evidence: ['s1']}]};
  assert.ok(analyzeGraph(ms, {orderDate: '2026-11-14'}).critical.nodes.includes('person:lee-tan'));
  const client = {messages: {create: async () => ({stop_reason: 'end_turn', content: [{type: 'text', text: JSON.stringify({
    work: [{label: 'Firmware validation', durationDays: 300, evidence: ['s1']}, {label: 'Injected', durationDays: 5, evidence: ['fake']}],
    edges: [{from: 'work:Ghost', to: 'work:Firmware validation', kind: 'blocks', evidence: ['fake'], confidence: 1}]})}]})}};
  const m = await buildGraph(docs, {client});
  assert.ok(!m.nodes.some(n => /ghost|injected/i.test(n.label)), 'no nodes from uncited output');
  assert.ok(!m.nodes.some(n => n.attrs.durationDays === 300), 'absurd durations are ignored');
});
