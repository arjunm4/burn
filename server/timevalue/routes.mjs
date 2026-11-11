// Time Value routes (agent F). Read-only GETs; no model call.
//   GET /api/timevalue/demo?change=0|1|2|3   → {card, heatmap, sources, engine}
//   GET /api/timevalue/habit               → the habit model's weights grid, or {weights: null}
// Returns true when it handled the request.
import { demoCard, habitWeights } from './demo.mjs';

export async function timevalueRoutes(req, res, pathname, json) {
  if (!pathname.startsWith('/api/timevalue/')) return false;
  if (req.method !== 'GET') { json({ error: 'Method not allowed' }, 405); return true; }
  const url = new URL(req.url, 'http://localhost');
  if (pathname === '/api/timevalue/demo') {
    const change = Number(url.searchParams.get('change') || 0);
    if (![0, 1, 2, 3].includes(change)) { json({ error: 'change must be 0, 1, 2 or 3' }, 400); return true; }
    json(await demoCard({ change }));
    return true;
  }
  if (pathname === '/api/timevalue/habit') {
    json((await habitWeights()) || { weights: null });
    return true;
  }
  json({ error: 'Not found' }, 404);
  return true;
}
