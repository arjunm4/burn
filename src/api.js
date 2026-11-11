export async function api(path, {body, ...options} = {}) {
  const response = await fetch('/api' + path, {
    ...options,
    ...(body !== undefined ? {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)} : {}),
  });
  let data;
  try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) {
    const error = new Error(data.error || 'The request could not be completed.');
    error.status = response.status;
    throw error;
  }
  return data;
}

/** Subscribe to an order's live events (SSE). Returns an unsubscribe function. */
export function subscribe(orderId, onEvent) {
  const es = new EventSource(`/api/orders/${encodeURIComponent(orderId)}/stream`);
  const handler = e => { try { onEvent({type: e.type, ...JSON.parse(e.data)}); } catch {} };
  for (const t of ['snapshot', 'order.entered', 'resolve.started', 'context.built', 'question', 'quote.started', 'quote.captured', 'recommended', 'answer.received', 'exchange.added', 'order.frozen', 'ramp.requested', 'ramp.request.failed', 'ramp.approved', 'ramp.rejected', 'approval.stale', 'card.issued', 'card.failed', 'placement.notice', 'placement.begun', 'placement.succeeded', 'placement.blocked', 'placement.failed', 'placement.unknown', 'placement.reconciled', 'placement.unresolved', 'placement.invalidated', 'booked', 'booking.failed', 'order.updated']) es.addEventListener(t, handler);
  return () => es.close();
}

export const readFileAsBase64 = file => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1]);
  r.onerror = reject;
  r.readAsDataURL(file);
});

/** Pre-v9 prototype helper (used by /request). Streams NDJSON tool events from POST /api/requests/:id/run. */
export async function streamRun(id, signal, onEvent) {
  const response = await fetch(`/api/requests/${encodeURIComponent(id)}/run`, {method: 'POST', signal});
  if (!response.ok) { let data = {}; try { data = await response.json(); } catch {} throw new Error(data.error || 'Agent backend unavailable'); }
  const reader = response.body.getReader(); const decoder = new TextDecoder();
  let buffer = '', completed = false;
  const dispatch = line => { if (!line.trim()) return; const event = JSON.parse(line); if (event.type === 'run.failed') throw new Error(event.error || 'Agent tools failed'); if (event.type === 'run.completed') completed = true; onEvent(event); };
  try {
    while (true) { const {value, done} = await reader.read(); if (done) break; buffer += decoder.decode(value, {stream: true}); let i; while ((i = buffer.indexOf('\n')) >= 0) { dispatch(buffer.slice(0, i)); buffer = buffer.slice(i + 1); } }
    buffer += decoder.decode(); dispatch(buffer);
    if (!completed) throw new Error('Agent connection ended before the tools completed. Retry to continue.');
  } finally { reader.releaseLock(); }
}
