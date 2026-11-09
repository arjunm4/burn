# Purchasing agent

Vite + React recreation of Purchasing Agent Engineer and its linked Purchasing Agent v2 reference.

Run `npm install`, then `npm run dev`. Open http://localhost:5173/request or /approvals. `npm run build && npm start` serves production. `npm test` checks costs, dependency release and tool event ordering.

`src/decisions.js` owns the reference decision records and cost derivation. All reference queue groups, tier selection, traces, approval and engineer branches are retained. Approval status correctly displays the selected tier.

`GET /api/work` streams NDJSON tool.started/tool.completed/run.completed/run.failed events. No working-state timers are used. The included backend executes local fixture tools in `server/tools.js`; replace their execute functions with your real project, calendar, dependency and policy integrations. No live Slack, calendar, purchasing credentials or agent backend were supplied. Orders and approvals are demonstration state; this app does not place real orders. The reference Ask button and evidence links are presentation-only, as in the source HTML.
