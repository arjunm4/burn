// Slack connector: reads channel history through the Web API with a bot token and turns
// messages (and thread replies) into shared-contract Documents. Read-only scopes only:
// channels:history, channels:read, users:read (groups:* for private channels).
// The token is never logged or returned; fixture mode replays saved API responses.
import {readFile} from 'node:fs/promises';
import path from 'node:path';

const SKIP_SUBTYPES = new Set(['channel_join', 'channel_leave', 'channel_topic', 'channel_purpose', 'channel_name', 'bot_add', 'bot_remove', 'pinned_item', 'tombstone']);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Live transport: GET https://slack.com/api/<method>, honouring 429 Retry-After.
export function slackApi(token, {fetchImpl = fetch, maxRetries = 3} = {}) {
  return async function call(method, params = {}) {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)]));
    for (let attempt = 0; ; attempt++) {
      const response = await fetchImpl(`https://slack.com/api/${method}?${qs}`, {headers: {Authorization: `Bearer ${token}`}, signal: AbortSignal.timeout(20000)});
      if (response.status === 429 && attempt < maxRetries) { await sleep(1000 * Number(response.headers.get('retry-after') || 1)); continue; }
      if (!response.ok) throw new Error(`Slack ${method}: HTTP ${response.status}`);
      const body = await response.json();
      if (!body.ok) throw new Error(`Slack ${method}: ${body.error}${body.needed ? ` (needs ${body.needed})` : ''}`);
      return body;
    }
  };
}

// Fixture transport: same method names, answered from saved API responses on disk.
export function slackFixtures(dir) {
  const read = async f => JSON.parse(await readFile(path.join(dir, f), 'utf8'));
  return async function call(method, params = {}) {
    if (method === 'auth.test') return {ok: true, url: '', team: 'Fixture workspace'}; // no permalinks for seeded data
    if (method === 'users.info') { const {members} = await read('users.json'); const user = members.find(u => u.id === params.user); if (!user) throw new Error('Slack users.info: user_not_found'); return {ok: true, user}; }
    if (method === 'conversations.list') return read('channels.json');
    if (method === 'conversations.info') { const {channels} = await read('channels.json'); return {ok: true, channel: channels.find(c => c.id === params.channel)}; }
    if (method === 'conversations.history') {
      const body = await read(`${params.channel}.json`);
      const oldest = Number(params.oldest || 0);
      return {...body, messages: body.messages.filter(m => Number(m.ts) > oldest)};
    }
    if (method === 'conversations.replies') return {ok: true, messages: []};
    throw new Error(`Slack fixture: ${method} not recorded`);
  };
}

// <@U123> -> @Name, <#C123|name> -> #name, <https://x|label> -> label, entities unescaped.
export function plainText(text, names = {}) {
  return String(text || '')
    .replace(/<@([A-Z0-9]+)(?:\|[^>]+)?>/g, (_, id) => '@' + (names[id] || id))
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, '#$1')
    .replace(/<!(here|channel|everyone)>/g, '@$1')
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, '$2').replace(/<(https?:[^>]+)>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/**
 * fetchSlack({call, channels, cursors, since, threads, activeThreads}) -> {documents, cursors}
 * cursors: {channelId: newest ts already stored}; channels without one start at `since`.
 * activeThreads: [{channel, ts}] parents whose replies are re-read even if the parent is old.
 * A channel whose history was cut off by maxPages keeps its old cursor, so nothing is skipped.
 */
export async function fetchSlack({call, channels, cursors = {}, since = '0', oldest, threads = true, activeThreads = [], maxPages = 20}) {
  const auth = await call('auth.test');
  const base = (auth.url || '').replace(/\/$/, '');
  const names = {};
  const nameOf = async id => {
    if (!id) return null;
    if (!(id in names)) {
      try { const {user} = await call('users.info', {user: id}); names[id] = user.profile?.real_name || user.real_name || user.name; }
      catch { names[id] = null; }
    }
    return names[id];
  };
  const documents = []; const nextCursors = {...cursors};
  for (const channel of channels) {
    const from = cursors[channel] || oldest || since;
    const info = (await call('conversations.info', {channel})).channel || {id: channel, name: channel};
    const messages = []; let page = 0, next, truncated = false;
    do {
      const body = await call('conversations.history', {channel, oldest: from, limit: 200, cursor: next});
      messages.push(...body.messages);
      next = body.response_metadata?.next_cursor;
      if (next && page + 1 >= maxPages) truncated = true;
    } while (next && ++page < maxPages);
    // Parents in this page plus older parents still collecting replies.
    const parents = new Map(messages.filter(m => threads && m.reply_count > 0).map(m => [m.ts, m]));
    for (const t of activeThreads) if (t.channel === channel && !parents.has(t.ts)) parents.set(t.ts, null);
    const replies = [];
    for (const ts of parents.keys()) {
      const {messages: thread} = await call('conversations.replies', {channel, ts, oldest: from});
      replies.push(...thread.filter(r => r.ts !== ts));
    }
    let newest = from;
    for (const msg of [...messages, ...replies]) {
      {
        if (msg.subtype && SKIP_SUBTYPES.has(msg.subtype)) continue;
        for (const id of msg.text?.match(/<@([A-Z0-9]+)/g)?.map(s => s.slice(2)) || []) await nameOf(id);
        documents.push({
          id: `slack:${channel}:${msg.ts}`, source: 'slack', kind: 'message', externalId: msg.ts,
          channel: '#' + (info.name || channel), author: (await nameOf(msg.user)) || msg.username || msg.bot_profile?.name || 'Unknown',
          at: new Date(Number(msg.ts) * 1000).toISOString(), end: null, text: plainText(msg.text, names),
          url: base ? `${base}/archives/${channel}/p${msg.ts.replace('.', '')}${msg.thread_ts && msg.thread_ts !== msg.ts ? `?thread_ts=${msg.thread_ts}&cid=${channel}` : ''}` : null,
          attrs: {threadTs: msg.thread_ts || null, replyCount: msg.reply_count || 0},
        });
        if (Number(msg.ts) > Number(newest)) newest = msg.ts;
      }
    }
    if (!truncated) nextCursors[channel] = newest;
  }
  return {documents: documents.sort((a, b) => a.at.localeCompare(b.at)), cursors: nextCursors};
}
