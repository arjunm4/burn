// Time Value routes. Read-only GETs; no model call.
//   GET /api/timevalue/demo?change=0|1|2|3   → {card, sources, engine}
// Returns true when it handled the request.
import { demoCard } from './demo.mjs';

const CHANGES = new Set(['0', '1', '2', '3', '4']);

export async function timevalueRoutes(req, res, pathname, json) {
  if (!pathname.startsWith('/api/timevalue/')) return false;
  if (req.method !== 'GET') { json({ error: 'Method not allowed' }, 405); return true; }
  if (pathname !== '/api/timevalue/demo') { json({ error: 'Not found' }, 404); return true; }
  const change = new URL(req.url, 'http://localhost').searchParams.get('change') || '0';
  if (!CHANGES.has(change)) { json({ error: 'change must be 0, 1, 2 or 3' }, 400); return true; }
  try {
    json(await demoCard({ change: Number(change) }));
  } catch (e) {
    json({ error: `Time Value card failed: ${e.message}` }, 500);
  }
  return true;
}
