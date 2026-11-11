// Jira connector: reads issues and their comments through the Cloud REST API (basic auth with
// an API token, read-only) and turns them into shared-contract Documents. Fixture mode replays
// saved `/rest/api/3/search` responses, one file per project, in the same shape.
import {readFile} from 'node:fs/promises';
import path from 'node:path';

// Live transport: GET <baseUrl>/rest/api/3/<resource>?<params>. Credentials never leave this closure.
export function jiraApi(baseUrl, email, token, {fetchImpl = fetch} = {}) {
  const auth = 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64');
  return async function call(resource, params = {}) {
    const url = new URL(`/rest/api/3/${resource}`, baseUrl);
    for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, String(v));
    const response = await fetchImpl(url, {headers: {Authorization: auth, Accept: 'application/json'}, signal: AbortSignal.timeout(20000)});
    if (!response.ok) throw new Error(`Jira ${resource}: HTTP ${response.status}`);
    return response.json();
  };
}

// Fixture transport: <dir>/<PROJECT>.json holds a search response {issues:[...]}; users.json the directory.
export function jiraFixtures(dir) {
  const read = async f => JSON.parse(await readFile(path.join(dir, f), 'utf8'));
  return async function call(resource, params = {}) {
    if (resource === 'project') return read('projects.json');
    if (resource === 'search') {
      const project = /project\s*=\s*"?([A-Z][A-Z0-9]+)/.exec(params.jql || '')?.[1];
      if (!project) throw new Error('Jira fixture: search needs project = KEY');
      const body = await read(`${project}.json`);
      const since = /updated\s*>=\s*"([^"]+)"/.exec(params.jql || '')?.[1];
      return {...body, issues: since ? body.issues.filter(i => Date.parse(i.fields.updated) > Date.parse(since)) : body.issues};
    }
    throw new Error(`Jira fixture: ${resource} not recorded`);
  };
}

const iso = s => (s ? new Date(s).toISOString() : null);
const who = u => u?.displayName || u?.emailAddress || null;

/**
 * fetchJira({call, projects, cursors}) -> {documents, cursors}
 * One document per issue (summary + description) and one per comment, so each statement keeps
 * its author and date. cursors: {projectKey: lastUpdatedIso} for incremental pulls.
 */
export async function fetchJira({call, projects, cursors = {}}) {
  const documents = []; const next = {...cursors};
  for (const key of projects) {
    const since = cursors[key];
    const jql = `project = ${key}${since ? ` AND updated >= "${since.slice(0, 16).replace('T', ' ')}"` : ''} ORDER BY updated ASC`;
    let startAt = 0, newest = since || null;
    for (;;) {
      const body = await call('search', {jql, startAt, maxResults: 100, fields: 'summary,issuetype,project,status,priority,assignee,reporter,created,updated,duedate,labels,components,issuelinks,description,comment'});
      for (const i of body.issues || []) {
        const f = i.fields;
        const links = (f.issuelinks || []).map(l => ({type: l.type?.name || null, direction: l.outwardIssue ? 'outward' : 'inward', key: (l.outwardIssue || l.inwardIssue)?.key || null}));
        documents.push({
          id: `jira:${i.key}`, source: 'jira', kind: 'issue', externalId: i.key, channel: f.project?.key || key, author: who(f.reporter),
          at: iso(f.created), end: null, text: [`${i.key}: ${f.summary || ''}`.trim(), f.description || ''].filter(Boolean).join('\n'), url: null,
          attrs: {key: i.key, type: f.issuetype?.name || null, status: f.status?.name || null, dueDate: f.duedate || null, assignee: who(f.assignee), updated: iso(f.updated),
            labels: f.labels || [], components: (f.components || []).map(c => c.name), links},
        });
        for (const c of f.comment?.comments || []) {
          documents.push({id: `jira:${i.key}:c${c.id}`, source: 'jira', kind: 'comment', externalId: `${i.key}:${c.id}`, channel: f.project?.key || key, author: who(c.author),
            at: iso(c.created), end: null, text: typeof c.body === 'string' ? c.body : plainAdf(c.body), url: null, attrs: {key: i.key, summary: f.summary || null}});
        }
        if (!newest || Date.parse(f.updated) > Date.parse(newest)) newest = iso(f.updated);
      }
      startAt += (body.issues || []).length;
      if (!body.issues?.length || startAt >= (body.total ?? startAt)) break;
    }
    if (newest) next[key] = newest;
  }
  return {documents: documents.sort((a, b) => a.at.localeCompare(b.at)), cursors: next};
}

// Cloud comments arrive as Atlassian Document Format; keep the text nodes.
function plainAdf(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (node.type === 'text') return node.text || '';
  return (node.content || []).map(plainAdf).join(node.type === 'paragraph' ? '\n' : '');
}
