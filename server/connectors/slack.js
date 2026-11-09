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
 * fetchSlack({call, channels, oldest, threads}) -> {documents, cursor}
 * oldest: Slack ts to resume from (exclusive). cursor: newest ts seen, for the next sync.
 */
export async function fetchSlack({call, channels, oldest, threads = true, maxPages = 20}) {
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
  const documents = []; let cursor = oldest || '0';
  for (const channel of channels) {
    const info = (await call('conversations.info', {channel})).channel || {id: channel, name: channel};
    const messages = []; let page = 0, next;
    do {
      const body = await call('conversations.history', {channel, oldest, limit: 200, cursor: next});
      messages.push(...body.messages);
      next = body.response_metadata?.next_cursor;
    } while (next && ++page < maxPages);
    for (const m of messages) {
      if (m.subtype && SKIP_SUBTYPES.has(m.subtype)) continue;
      const group = [m];
      if (threads && m.reply_count > 0) {
        const {messages: replies} = await call('conversations.replies', {channel, ts: m.ts, oldest});
        group.push(...replies.filter(r => r.ts !== m.ts));
      }
      for (const msg of group) {
        if (msg.subtype && SKIP_SUBTYPES.has(msg.subtype)) continue;
        for (const id of msg.text?.match(/<@([A-Z0-9]+)/g)?.map(s => s.slice(2)) || []) await nameOf(id);
        documents.push({
          id: `slack:${channel}:${msg.ts}`, source: 'slack', kind: 'message', externalId: msg.ts,
          channel: '#' + (info.name || channel), author: (await nameOf(msg.user)) || msg.username || msg.bot_profile?.name || 'Unknown',
          at: new Date(Number(msg.ts) * 1000).toISOString(), end: null, text: plainText(msg.text, names),
          url: base ? `${base}/archives/${channel}/p${msg.ts.replace('.', '')}${msg.thread_ts && msg.thread_ts !== msg.ts ? `?thread_ts=${msg.thread_ts}&cid=${channel}` : ''}` : null,
          attrs: {threadTs: msg.thread_ts || null, replyCount: msg.reply_count || 0},
        });
        if (Number(msg.ts) > Number(cursor)) cursor = msg.ts;
      }
    }
  }
  return {documents: documents.sort((a, b) => a.at.localeCompare(b.at)), cursor};
}
