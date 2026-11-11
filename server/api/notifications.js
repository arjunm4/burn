// Notifications API (mounted from server/index.js): one person's feed, and an SSE stream
// so the inbox screen updates as the flow moves. Read-only.
export function notificationsRoutes({notifier}) {
  return async function handle(req, res, pathname, json) {
    if (req.method !== 'GET') return false;
    const url = new URL(req.url, 'http://localhost');
    const to = url.searchParams.get('to') || undefined;
    if (pathname === '/api/notifications') {
      const limit = Math.min(500, Math.max(1, Number.parseInt(url.searchParams.get('limit'), 10) || 50));
      return json({notifications: notifier.list({to, since: url.searchParams.get('since') || undefined, limit}), recipients: notifier.recipients()}), true;
    }
    if (pathname === '/api/notifications/stream') {
      res.writeHead(200, {'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive'});
      res.write(': open\n\n');
      const off = notifier.subscribe(n => { if (!res.destroyed && (!to || n.to === to)) res.write(`event: notification\ndata: ${JSON.stringify(n)}\n\n`); });
      const ping = setInterval(() => { if (!res.destroyed) res.write(': ping\n\n'); }, 15000);
      req.on('close', () => { clearInterval(ping); off(); });
      return true;
    }
    return false;
  };
}
