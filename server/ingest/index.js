// Ingestion: pulls documents from configured connectors into SQLite, then rebuilds and
// versions the dependency graph. Live when credentials are in .env, else seeded fixtures.
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {existsSync, readFileSync} from 'node:fs';
import {fetchSlack, slackApi, slackFixtures} from '../connectors/slack.js';
import {fetchCalendar, windowAround} from '../connectors/ics.js';
import {fetchJira, jiraApi, jiraFixtures} from '../connectors/jira.js';
import {fetchMeetings} from '../connectors/meetings.js';
import {buildGraph} from '../graph/extract.js';
import {clock} from '../clock.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

// Which connectors run, and how. Secrets stay here; only labels and modes leave the server.
// Without credentials a source replays a recorded world: BURN_WORLD names the folder (slack/,
// calendar.ics, jira/, meetings/), default fixtures/flintlock. Each folder present becomes a source.
export function sourcesFromEnv(env = process.env) {
  const world = path.resolve(ROOT, env.BURN_WORLD || 'fixtures/flintlock');
  const slackLive = !!env.SLACK_BOT_TOKEN, icsLive = !!env.CALENDAR_ICS_URL, jiraLive = !!(env.JIRA_BASE_URL && env.JIRA_EMAIL && env.JIRA_API_TOKEN);
  const json = f => JSON.parse(readFileSync(f, 'utf8'));
  const sources = [];
  if (slackLive || existsSync(path.join(world, 'slack/channels.json'))) sources.push({id: 'slack', kind: 'slack', label: 'Slack', mode: slackLive ? 'live' : 'fixture',
    channels: slackLive ? (env.SLACK_CHANNEL_IDS || '').split(',').map(s => s.trim()).filter(Boolean) : json(path.join(world, 'slack/channels.json')).channels.map(c => c.id),
    call: slackLive ? slackApi(env.SLACK_BOT_TOKEN) : slackFixtures(path.join(world, 'slack'))});
  if (icsLive || existsSync(path.join(world, 'calendar.ics'))) sources.push({id: 'calendar', kind: 'calendar', label: 'Calendar', mode: icsLive ? 'live' : 'fixture',
    url: env.CALENDAR_ICS_URL || null, file: icsLive ? null : path.join(world, 'calendar.ics')});
  if (jiraLive || existsSync(path.join(world, 'jira/projects.json'))) sources.push({id: 'jira', kind: 'jira', label: 'Jira', mode: jiraLive ? 'live' : 'fixture',
    projects: jiraLive ? (env.JIRA_PROJECTS || '').split(',').map(s => s.trim()).filter(Boolean) : json(path.join(world, 'jira/projects.json')).map(p => p.key),
    call: jiraLive ? jiraApi(env.JIRA_BASE_URL, env.JIRA_EMAIL, env.JIRA_API_TOKEN) : jiraFixtures(path.join(world, 'jira'))});
  const notes = env.MEETING_NOTES_DIR || (existsSync(path.join(world, 'meetings')) ? path.join(world, 'meetings') : null);
  if (notes) sources.push({id: 'meetings', kind: 'meetings', label: 'Meeting notes', mode: env.MEETING_NOTES_DIR ? 'live' : 'fixture', dir: notes});
  return sources;
}

export function createIngest({filename = process.env.INGEST_DB || 'data/ingest.sqlite', sources = sourcesFromEnv(), now = () => clock.date(), build = buildGraph, windowDays = Number(process.env.INGEST_WINDOW_DAYS) || 45} = {}) {
  if (filename !== ':memory:') mkdirSync(path.dirname(filename), {recursive: true});
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY, kind TEXT, label TEXT, mode TEXT, cursor TEXT, last_synced_at TEXT, last_error TEXT, documents INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, source TEXT NOT NULL, kind TEXT, external_id TEXT, channel TEXT, author TEXT, at TEXT, ends TEXT, text TEXT, url TEXT, attrs TEXT);
    CREATE TABLE IF NOT EXISTS graphs (version INTEGER PRIMARY KEY AUTOINCREMENT, built_at TEXT, extractor TEXT, error TEXT, documents INTEGER, body TEXT)`);
  const upsert = db.prepare('INSERT OR REPLACE INTO documents VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  const row = d => ({id: d.id, source: d.source, kind: d.kind, externalId: d.external_id, channel: d.channel, author: d.author, at: d.at, end: d.ends, text: d.text, url: d.url, attrs: JSON.parse(d.attrs || '{}')});
  const sourceRow = id => db.prepare('SELECT * FROM sources WHERE id=?').get(id);
  let inFlight = null;

  async function pull(source) {
    const prev = sourceRow(source.id);
    // Switching between fixture and live data starts that source over.
    const restart = prev && prev.mode !== source.mode;
    let cursors = {};
    try { cursors = !restart && prev?.cursor ? JSON.parse(prev.cursor) : {}; } catch { cursors = {}; }
    if (typeof cursors !== 'object' || !cursors) cursors = {};
    const reference = now().getTime();
    let documents, next = cursors, replace = restart;
    if (source.kind === 'slack') {
      if (!source.channels.length) throw new Error('Set SLACK_CHANNEL_IDS to the channels the bot was added to');
      // Threads started in the last 14 days keep getting their new replies.
      const activeThreads = restart ? [] : db.prepare("SELECT external_id ts, attrs FROM documents WHERE source='slack' AND at >= ?").all(new Date(reference - 14 * 86400000).toISOString())
        .filter(r => JSON.parse(r.attrs || '{}').replyCount > 0).map(r => ({ts: r.ts, channel: null}));
      const channelOf = db.prepare("SELECT id FROM documents WHERE source='slack' AND external_id=?");
      for (const t of activeThreads) t.channel = channelOf.get(t.ts)?.id.split(':')[1];
      ({documents, cursors: next} = await fetchSlack({call: source.call, channels: source.channels, cursors, since: String((reference - windowDays * 86400000) / 1000), activeThreads}));
    } else if (source.kind === 'jira') {
      if (!source.projects.length) throw new Error('Set JIRA_PROJECTS to the project keys to read');
      ({documents, cursors: next} = await fetchJira({call: source.call, projects: source.projects, cursors}));
      documents = documents.filter(d => Date.parse(d.at) >= reference - windowDays * 86400000);
    } else if (source.kind === 'meetings') {
      documents = (await fetchMeetings({dir: source.dir})).filter(d => Date.parse(d.at) >= reference - windowDays * 86400000);
      replace = true;
    } else {
      // Calendars are small: re-read the whole window each sync and replace.
      documents = await fetchCalendar({url: source.url, file: source.file, ...windowAround(new Date(reference).toISOString())});
      replace = true;
    }
    db.exec('BEGIN');
    try {
      if (replace) db.prepare('DELETE FROM documents WHERE source=?').run(source.kind);
      for (const d of documents) upsert.run(d.id, d.source, d.kind, d.externalId, d.channel, d.author, d.at, d.end, d.text, d.url, JSON.stringify(d.attrs || {}));
      const count = db.prepare('SELECT COUNT(*) n FROM documents WHERE source=?').get(source.kind).n;
      db.prepare('INSERT OR REPLACE INTO sources VALUES (?,?,?,?,?,?,?,?)').run(source.id, source.kind, source.label, source.mode, JSON.stringify(next || {}), now().toISOString(), null, count);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return documents.length;
  }

  async function syncOnce() {
    const results = [];
    for (const source of sources) {
      try { results.push({id: source.id, added: await pull(source)}); }
      catch (error) {
        // A failing source keeps its previous documents; the error is shown, never the secret.
        const prev = sourceRow(source.id);
        // Keep the previous mode with its cursor so a failed switch doesn't pair one mode's cursor with another's data.
        db.prepare('INSERT OR REPLACE INTO sources VALUES (?,?,?,?,?,?,?,?)').run(source.id, source.kind, source.label, prev?.mode || source.mode, prev?.cursor || null, prev?.last_synced_at || null, error.message, prev?.documents || 0);
        results.push({id: source.id, error: error.message});
      }
    }
    const documents = listDocuments();
    const graph = await build(documents);
    db.prepare('INSERT INTO graphs (built_at, extractor, error, documents, body) VALUES (?,?,?,?,?)').run(now().toISOString(), graph.extractor, graph.error || null, documents.length, JSON.stringify({nodes: graph.nodes, edges: graph.edges}));
    return {results, graph: latestGraph()};
  }

  // Concurrent syncs share one run.
  const sync = () => (inFlight ||= syncOnce().finally(() => { inFlight = null; }));
  // Documents arriving between syncs (an Events API message, a demo's live change) are stored and the graph rebuilt.
  async function inject(documents) {
    db.exec('BEGIN');
    try { for (const d of documents) upsert.run(d.id, d.source, d.kind, d.externalId, d.channel, d.author, d.at, d.end, d.text, d.url, JSON.stringify(d.attrs || {})); db.exec('COMMIT'); }
    catch (error) { db.exec('ROLLBACK'); throw error; }
    const all = listDocuments();
    const graph = await build(all);
    db.prepare('INSERT INTO graphs (built_at, extractor, error, documents, body) VALUES (?,?,?,?,?)').run(now().toISOString(), graph.extractor, graph.error || null, all.length, JSON.stringify({nodes: graph.nodes, edges: graph.edges}));
    return latestGraph();
  }
  const listDocuments = () => db.prepare('SELECT * FROM documents ORDER BY at').all().map(row);
  const getDocument = id => { const d = db.prepare('SELECT * FROM documents WHERE id=?').get(id); return d ? row(d) : null; };
  const listSources = () => sources.map(s => { const r = sourceRow(s.id); return {id: s.id, kind: s.kind, label: s.label, mode: s.mode, lastSyncedAt: r?.last_synced_at || null, lastError: r?.last_error || null, documents: r?.documents || 0}; });
  function latestGraph() {
    const g = db.prepare('SELECT * FROM graphs ORDER BY version DESC LIMIT 1').get();
    if (!g) return null;
    const body = JSON.parse(g.body);
    const cited = new Set(body.edges.flatMap(e => e.evidence).concat(body.nodes.map(n => n.attrs?.evidence).filter(Boolean), body.nodes.flatMap(n => (n.attrs?.ooo || []).map(w => w.evidence))));
    const evidence = Object.fromEntries([...cited].map(id => [id, getDocument(id)]).filter(([, d]) => d));
    return {version: g.version, builtAt: g.built_at, extractor: g.extractor, error: g.error, documents: g.documents, graph: body, evidence};
  }
  return {sync, inject, listDocuments, getDocument, listSources, latestGraph, close: () => db.close()};
}
