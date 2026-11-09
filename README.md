# Purchasing agent

A hackathon procurement assistant with an engineer conversation at `/request` and an approver queue at `/approvals`. The visual design follows Purchasing Agent Engineer and Purchasing Agent v2 HTML references.

## Run locally

Requires Node.js 24.2+ (built-in SQLite) and npm.

```bash
npm install
npm run dev
```

Open http://localhost:5173/request and http://localhost:5173/approvals in separate tabs. For production assets, run `npm run build` then `npm start`. The local server binds to 127.0.0.1:5173.

## Demo workflow

1. Open the engineer route. Its working steps follow completed backend tool executions over NDJSON.
2. Answer whether Rev B boards can substitute. Yes creates a standard-shipping draft purchase order. No presents the three shipping options and their delay costs.
3. Select an option. Shipping above $500 or an option that differs from the recommendation goes to Priya's queue.
4. Open approvals, select a tier and approve. The exact approved tier is saved with a draft purchase order. The engineer view refreshes to show it, and the dependent thermal chamber decision is released.
5. Reload either page or restart the server: the request state survives. Restart demo resets the sensor request and invalidates its dependent booking.

The queue also contains the six original example decisions. Both screens refresh shared state periodically and when focused. Working-step progress uses actual tool events; it has no simulated step timers.

## What's implemented

- Shared decision records and deterministic shipping + delay cost derivation in `src/decisions.js`.
- SQLite-backed requests and immutable audit entries in `server/store.js`.
- Revision checks reject stale writes and prevent duplicate approval/order creation.
- NDJSON tool execution events from the Node backend, invoking Claude’s agent module. Completed analysis is persisted with parsed identity, catalog match, question and planner mode. Reopening a completed run returns the saved result without fabricated tool progress.
- Unmatched catalog requests become `unsupported` and cannot create purchase orders. Matched parts use trusted fixture shipping prices and dependency facts, regardless of model output.
- Persisted approval tiers, draft purchase orders, dependency release/reset, validation and visible request failures.

SQLite defaults to `data/purchasing.sqlite` (ignored by Git). Set `PURCHASING_DB` to override its path. Stop the app and remove the database plus its `-wal`/`-shm` siblings to reseed all demo data.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/requests` | Shared request snapshot, approvals and resolved dependencies |
| POST | `/api/requests` | Create a Rev C demo request with `{text, requester?}` |
| GET | `/api/requests/:id` | Request details and audit events |
| POST | `/api/requests/:id/run` | NDJSON tool execution stream |
| POST | `/api/requests/:id/answer` | `{answer: "yes" or "no", revision}` |
| POST | `/api/requests/:id/select` | `{tier: integer, revision}` |
| POST | `/api/requests/:id/approve` | `{tier: integer, revision}` |
| POST | `/api/requests/sens/reset` | `{revision}` |
| GET | `/api/requests/:id/audit` | Persisted transition audit |

Every mutation except the tool stream returns `{request}`. `/run` persists analysis and increments the revision before sending `run.completed {request}`; use that revision for the next answer. It also accepts `choiceId: "revb_yes"` or `"revb_no"` as an alternative to `answer`. Errors return `{error}`; stale revisions return HTTP 409. The server remains the authority for transitions, tier validity and approval rules.

## Agent

`server/agent/index.js` exports `analyze({text, requester}, emit)`. It turns a free-text request ("ACS37002 × 40 from Digi-Key, standard") into a matched request, the context the recommendation depends on, and at most one question for the engineer.

- **With credentials** (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` or an `ant auth login` profile) it runs a Claude tool-use loop on `claude-opus-5` (override with `AGENT_MODEL`). Server-side refusal fallbacks are enabled.
- **Without credentials**, with `AGENT_OFFLINE=1`, or if the API call fails, a deterministic planner calls the same tools in the same order. The demo and tests never need a key.
- The tools in `server/agent/tools.js` are read-only and fixture-backed: `find_part`, `read_project_channel`, `check_hardware_calendar`, `map_dependencies`, `check_policy`. Replace their `run` functions with real Slack, calendar, PLM and policy integrations.
- The model never does arithmetic. Shipping and delay costs come from `src/decisions.js`. The model's ids are re-checked against the facts its tools returned; only its phrasing is trusted.
- It emits `tool.started` / `tool.completed` events with `{index, name, label, summary}`, which drive the engineer's "working" list, plus `agent.fallback` when it switches planners.

## UI

- `/request` starts a new request: a free-text composer plus your recent requests. Submitting creates the request (`POST /api/requests`) and opens `/request/:id`.
- `/request/:id` is the conversation. The working list comes from live agent events. The agent's question comes from `request.question`. Shipping options show arrival dates from `ORDER_DATE`, days late against the milestone, and an estimated total (shipping + waiting engineers × $1,100/day). Options are equal-weight buttons, with the recommendation tagged. When a choice needs approval, the conversation says why (over $500, or differs from the recommendation) and shows a "Waiting on Priya" status until it's approved.
- `/approvals` is Priya's queue. It links each decision back to the engineer's conversation and explains why it needs approval.
- The conversation logic lives in `src/conversation.js`: pure functions, unit-tested in `src/conversation.test.js`. `src/Engineer.jsx` only renders it.

## Current boundaries

The agent tool adapters in `server/agent/tools.js` execute against seeded project data. The legacy `server/tools.js` helper is retained only for its original unit test. No live Slack, calendar or vendor credentials have been supplied. Claude’s agent uses its deterministic fallback without model credentials; live model execution remains unverified in this session. The UI is a guided conversation for the sample sensor request, not arbitrary free-text purchasing. Purchase orders are local drafts; no vendor purchase is placed. Identity is the reference demo identity, not authenticated access control. Evidence links and the reference Ask button still need actual source/conversation integrations. Run locally for the demo; add authentication before shared hosting.

Request creation is available through the API with explicit Rev C demo context. The agent loop is connected on the Codex integration branch. Claude is adding the request input UI, event-derived working labels and catalog-aware conversation; next come project/vendor sources, purchasing and authenticated approvers.

## Collaboration and Git conventions

Claude and Codex coordinate via `collaboration/PROTOCOL.md`, `CLAUDE.md`, `AGENTS.md` and `scripts/collab.mjs`. The mailbox resolves to the main checkout from linked worktrees so both agents see the same messages. Publish task/file ownership before edits, and record architectural agreements in `collaboration/DECISIONS.md`.

Use one worktree per task:

```bash
git worktree add .worktrees/codex-agent-run -b codex/agent-run
git worktree add .worktrees/claude-ui -b claude/ui
```

Commit messages use Conventional Commits: `feat(server): persist request lifecycle`, `feat(ui): connect engineer and approval views`, `test(server): cover approvals and stale writes`, `docs: document demo workflow`. Keep README updates with their feature. Review and merge finished branches from the main checkout.

During this implementation session `.git` is read-only, so worktree/commit creation is blocked. Source edits are present in the main checkout; no feature commits are claimed. Claude is active through the mailbox and has agreed to SQLite, deterministic cost math, price/override approval rules and an agent with a deterministic fallback. Claude owns the agent integration and subsequent UI work in its worktree. Git integration is delegated to Claude while this session has read-only Git metadata access.

## Validation

`npm test` checks cost derivation, tool events, persistent approval overrides, duplicate prevention, invalid inputs, dependency invalidation and API handlers. Agent integration tests also cover matching, unsupported parts, question choice aliases, and revision conflicts after analysis. API handler tests run in-process because the build session cannot bind local sockets. `npm run build` verifies the React production bundle. Browser end-to-end verification remains pending in a session that can start the local server.

Catalog matching uses seeded shipping and project context. Parsed quantities appear consistently in the approval description and draft purchase order, which also saves the vendor and exact shipping quote. A new purchase can fulfill the seeded project dependency only when it matches the catalog part and project and covers at least the catalog quantity; a partial purchase leaves that dependency waiting. This is demo fulfillment logic, not a live inventory allocation system.
