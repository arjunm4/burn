// Browser recordings for the "Burn's browser" panel: the screenshots and step notes the headless
// vendor provider writes under XOMETRY_RECORDINGS_DIR while quoting and placing an order.
//   GET /api/orders/:id/recording   -> {steps: [{n, at, label, note, url}], video?: url}
//   GET /recordings/<key>/<file>    -> the png/webm itself (path-safe, nothing else is served)
// The provider keys a recording by order id when it is given one, else by quote id or attempt
// id (it only has what the orchestrator passes), so an order's recording is the merge of
// <orderId>/, quote-<quoteId>/ and attempt-<attemptId>/ for each of its placement attempts.
import {readFile, stat} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {AppError} from '../contracts.js';

const SAFE = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/;   // no slashes, no '..'
const TYPES = {'.png': 'image/png', '.webm': 'video/webm'};

/** Which recording folders belong to an order. Exported so the mount line in server/index.js stays short. */
export function recordingKeys(store, id) {
  const order = store.get(id);
  return [id, order.quote?.quoteId && `quote-${order.quote.quoteId}`, ...(store.attempts?.(id) || []).map(a => `attempt-${a.id}`)].filter(Boolean);
}

export function recordingsRoutes({dir = process.env.XOMETRY_RECORDINGS_DIR || 'data/recordings', store = null} = {}) {
  const root = path.resolve(dir);
  const inside = p => { const r = path.resolve(p); return r.startsWith(root + path.sep) ? r : null; };
  return async function handle(req, res, pathname, json) {
    const rec = pathname.match(/^\/api\/orders\/([A-Za-z0-9_-]+)\/recording$/);
    if (rec && req.method === 'GET') {
      const keys = store ? recordingKeys(typeof store === 'function' ? store() : store, rec[1]) : [rec[1]];
      const steps = []; let video = null;
      for (const key of keys) {
        const folder = inside(path.join(root, key)); if (!folder || !existsSync(path.join(folder, 'steps.json'))) continue;
        let list = []; try { list = JSON.parse(await readFile(path.join(folder, 'steps.json'), 'utf8')).steps || []; } catch { continue; }
        for (const s of list) steps.push({at: s.at, label: s.label, note: s.note, url: s.file ? `/recordings/${key}/${s.file}` : null});
        if (existsSync(path.join(folder, 'video.webm'))) video = `/recordings/${key}/video.webm`;
      }
      steps.sort((a, b) => a.at < b.at ? -1 : a.at > b.at ? 1 : 0);
      return json({steps: steps.map((s, i) => ({n: i + 1, ...s})), video}), true;
    }
    const file = pathname.match(/^\/recordings\/([^/]+)\/([^/]+)$/);
    if (file && req.method === 'GET') {
      const [, key, name] = file; const ext = path.extname(name);
      if (!SAFE.test(key) || !SAFE.test(name) || !TYPES[ext]) throw new AppError('Not found', 404);
      const p = inside(path.join(root, key, name)); if (!p) throw new AppError('Not found', 404);
      let info; try { info = await stat(p); } catch { throw new AppError('Not found', 404); }
      res.writeHead(200, {'Content-Type': TYPES[ext], 'Content-Length': info.size, 'Cache-Control': 'private, max-age=3600'});
      res.end(await readFile(p)); return true;
    }
    return false;
  };
}
