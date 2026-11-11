// Demo controls. A recorded world may ship a `demo/` folder (part-entry.json, live-changes.json,
// policy.json: see fixtures/flintlock/demo). These routes expose that script to the UI: the part
// entry to prefill, and the live changes to inject as if the Slack message had just arrived.
// Nothing here is used outside a demo; without a demo folder every route answers 404.
import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {AppError} from '../contracts.js';
import {plainText} from '../connectors/slack.js';
import {clock} from '../clock.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const readJson = f => JSON.parse(readFileSync(f, 'utf8'));

export function loadDemo(env = process.env) {
  const world = path.resolve(ROOT, env.BURN_WORLD || 'fixtures/flintlock');
  const dir = path.join(world, 'demo');
  if (!existsSync(dir)) return null;
  const read = f => (existsSync(path.join(dir, f)) ? readJson(path.join(dir, f)) : null);
  const users = existsSync(path.join(world, 'slack/users.json')) ? readJson(path.join(world, 'slack/users.json')).members : [];
  return {world, entry: read('part-entry.json'), // burn-live-changes.json (the demo slice's single message) wins over the world's live-changes.json.
  liveChanges: (read('burn-live-changes.json') || read('live-changes.json'))?.changes || [], policy: read('policy.json'), users};
}

async function body(req) { let text = ''; for await (const c of req) { text += c; if (text.length > 65536) throw new AppError('Request too large', 413); } try { return JSON.parse(text || '{}'); } catch { throw new AppError('Invalid JSON'); } }

export function demoRoutes({ingest, orders, demo = loadDemo(), now = clock}) {
  const applied = new Set();
  return async function handle(req, res, pathname, json) {
    if (!demo) throw new AppError('No demo world is configured', 404);
    if (pathname === '/api/demo' && req.method === 'GET') {
      const e = demo.entry;
      return json({
        world: path.basename(demo.world), now: now.iso(), anchored: now.anchored,
        entry: e ? {name: e.part_name, partNumber: e.part_number, note: e.summary, engineer: e.requester?.name || null, cadFile: e.cad_file, fields: {revision: e.revision, quantity: e.quantity}} : null,
        liveChanges: demo.liveChanges.map(c => ({id: c.id || `change-${c.order}`, label: c.label, source: c.source, text: c.message?.text, by: c.message?.user_name, channel: c.message?.channel_name, applied: applied.has(c.id || `change-${c.order}`)})),
      }), true;
    }
    // Enter the scripted part as its requester. The world's CAD file name stands in for the STEP file (synthetic bytes).
    if (pathname === '/api/demo/start' && req.method === 'POST') {
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) throw new AppError('Origin not allowed', 403);
      const e = demo.entry; if (!e) throw new AppError('The demo world has no part entry', 404);
      const quote = existsSync(path.join(demo.world, 'demo/quote.json')) ? readJson(path.join(demo.world, 'demo/quote.json')).parts?.[0] : null;
      const fields = {revision: e.revision, quantity: e.quantity, ...(quote ? {material: quote.material, finish: quote.finish, tolerance: quote.tolerance} : {})};
      const order = orders.orchestrator.enter({name: e.part_name, partNumber: e.part_number, note: e.summary, engineer: e.requester?.name || 'engineer',
        cad: {fileName: e.cad_file, bytes: Buffer.from(`ISO-10303-21;\nHEADER;FILE_NAME('${e.cad_file}');ENDSEC;\n/* synthetic placeholder for the demo world */\nEND-ISO-10303-21;\n`)}, fields});
      return json({order: {id: order.id, state: order.state}}, 201), true;
    }
    if (pathname === '/api/demo/live-change' && req.method === 'POST') {
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) throw new AppError('Origin not allowed', 403);
      const b = await body(req);
      const change = demo.liveChanges.find(c => (c.id || `change-${c.order}`) === b.id);
      if (!change) throw new AppError('Unknown live change', 404);
      if (change.source !== 'slack' || !change.message) throw new AppError('Only Slack live changes are supported');
      // The message is stored exactly as the Slack connector would store it had it arrived now.
      const m = change.message; const ts = (now.ms() / 1000).toFixed(6);
      const user = demo.users.find(u => u.id === m.user);
      const doc = {id: `slack:${m.channel}:${ts}`, source: 'slack', kind: 'message', externalId: ts, channel: '#' + (m.channel_name || m.channel), author: user?.real_name || m.user_name || 'Unknown',
        at: now.iso(), end: null, text: plainText(m.text), url: null, attrs: {threadTs: null, replyCount: 0, live: true}};
      const graph = await ingest.inject([doc]);
      applied.add(b.id);
      const resolved = await orders.orchestrator.refresh();
      return json({ok: true, document: doc, graph: {version: graph.version, nodes: graph.graph.nodes.length, edges: graph.graph.edges.length}, orders: resolved.map(o => ({id: o.id, state: o.state, recommended: o.decision?.recommended?.tier || null, question: o.question?.text || null}))}), true;
    }
    return false;
  };
}
