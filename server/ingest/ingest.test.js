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
  const {documents, cursor} = await fetchSlack({call: slackApi('xoxb-test', {fetchImpl: fake}), channels: ['C1'], oldest: '0'});
  assert.deepEqual(documents.map(d => d.text), ['second page', 'Ping @Dana Okafor about the spec & more', 'reply']);
  assert.equal(documents[1].url, 'https://acme.slack.com/archives/C1/p200000001');
  assert.match(documents[2].url, /thread_ts=200.000001/);
  assert.equal(cursor, '210.000001');
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
