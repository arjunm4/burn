// HTTP routes for ingestion and the graph. Mounted from server/index.js; returns true when handled.
export function ingestRoutes(ingest) {
  return async function handle(req, res, pathname, json) {
    if (pathname === '/api/sync' && req.method === 'POST') {
      const {results} = await ingest.sync();
      return json({results, sources: ingest.listSources(), ...summary(ingest.latestGraph())}), true;
    }
    if (pathname === '/api/sources' && req.method === 'GET') return json({sources: ingest.listSources()}), true;
    if (pathname === '/api/graph' && req.method === 'GET') {
      // First visit builds the graph so the page never starts empty.
      const latest = ingest.latestGraph() || (await ingest.sync()).graph;
      return json({...latest, sources: ingest.listSources()}), true;
    }
    const doc = pathname.match(/^\/api\/documents\/(.+)$/);
    if (doc && req.method === 'GET') {
      const d = ingest.getDocument(decodeURIComponent(doc[1]));
      return json(d ? {document: d} : {error: 'Document not found'}, d ? 200 : 404), true;
    }
    return false;
  };
}
const summary = g => (g ? {version: g.version, builtAt: g.builtAt, extractor: g.extractor, error: g.error, nodes: g.graph.nodes.length, edges: g.graph.edges.length} : {});
