# Purchasing agent

A hackathon procurement assistant with an engineer conversation at `/request` and an approver queue at `/approvals`. The visual design follows Purchasing Agent Engineer and Purchasing Agent v2 HTML references.

**Next architecture:** [`docs/architecture.md`](docs/architecture.md) is the jointly approved (Claude + Codex) design for the expedite decision on custom CNC parts. It covers the decision core, evidence layer, questions, proactive ordering, learning, validation and the gap list against the current code. It is a design only; the code below predates it.

## Run locally

Requires Node.js 24.2+ (built-in SQLite) and npm.

```bash
npm install
npm run dev
```

Open http://localhost:5173/request and http://localhost:5173/approvals in separate tabs. For production assets, run `npm run build` then `npm start`. The local server binds to 127.0.0.1:5173.

## Demo workflow

1. Open `/request`, submit “ACS37002 × 40 from Digi-Key, standard shipping.”, and watch the working steps follow backend tool executions over NDJSON.
2. Answer whether Rev B boards can substitute. Yes creates a standard-shipping draft purchase order. No presents the three shipping options and their delay costs.
3. Select an option. Shipping above $500 or an option that differs from the recommendation goes to Priya's queue.
4. Open approvals, select a tier and approve. The exact approved tier is saved with a draft purchase order. The engineer view refreshes to show it, and the dependent thermal chamber decision is released.
5. Reload either page or restart the server: request state survives. The original `/request/sens` example also has a Restart demo action that invalidates its dependent booking.

The queue also contains the six original example decisions. Both screens refresh shared state periodically and when focused. Working-step progress uses actual tool events; it has no simulated step timers.

## What's implemented

- Shared decision records and deterministic shipping + delay cost derivation in `src/decisions.js`.
- SQLite-backed requests and immutable audit entries in `server/store.js`.
- Revision checks reject stale writes and prevent duplicate approval/order creation. Concurrent `/run` callers join a single in-flight analysis; later tabs receive its saved completion instead of racing to save it.
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

## Integrations: Slack and calendar

The server ingests Slack messages and calendar events, extracts a dependency graph from them, and the agent, `/graph` and `/approvals` all read that graph. With no credentials it runs on seeded fixtures (`fixtures/slack/*.json` are saved Slack API responses and `fixtures/calendar.ics` is a calendar), so the demo works offline.

Live setup: copy `.env.example` to `.env` (gitignored) and fill in:

1. **Slack.** Go to https://api.slack.com/apps → *Create New App* → *From scratch*. Under *OAuth & Permissions*, add these bot token scopes: `channels:history`, `channels:read` and `users:read`. Add `groups:history` and `groups:read` too if you want private channels. Install the app to the workspace and copy the *Bot User OAuth Token* (`xoxb-…`) into `SLACK_BOT_TOKEN`. In each channel to read, run `/invite @your-app`. Then put the channel IDs (channel details → bottom of the *About* tab, `C0…`) into `SLACK_CHANNEL_IDS`, comma-separated.
2. **Calendar.** In Google Calendar go to *Settings* → the calendar → *Integrate calendar* → *Secret address in iCal format*. In Outlook, *Publish calendar* → ICS link. Paste the link into `CALENDAR_ICS_URL`; `webcal://` links work too.
3. Optionally set `ANTHROPIC_API_KEY` so Claude does the graph extraction and planning instead of the rules.

Run `npm run dev` (it loads `.env`). Ingestion starts with the server; **Sync sources** on `/graph` or `POST /api/sync` pulls new data. Slack syncs incrementally from the newest message seen. The calendar window (30 days back, 90 ahead) is re-read each time. Tokens and the calendar URL stay on the server: they're never logged, stored in the database, or returned by the API. A source that fails keeps its previous documents and reports the error in `GET /api/sources`.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/sync` | Pull from every source, rebuild the graph, return a summary |
| GET | `/api/sources` | Per-source mode (live/fixture), last sync, document count, last error |
| GET | `/api/graph` | Latest graph version with cited evidence documents (builds on first call) |
| GET | `/api/documents/:id` | One ingested message or event |

Code: `server/connectors/{slack,ics}.js` are the connectors. `server/ingest/` holds sources, documents and graph versions in SQLite (`INGEST_DB`, default `data/ingest.sqlite`).

## Dependency graph

- **Extraction** (`server/graph/extract.js`). Calendar events become milestones (`CATEGORIES:MILESTONE` or titles with EVT/DVT/freeze…), out-of-office windows and time-boxed bookings. Messages yield parts (matched to the request catalog), work items, people, and three edge kinds: `A blocks B` (B can't start until A is done), `person assigned work`, and `work due milestone`. Claude structured output does the message extraction when a key is set; message text is wrapped as untrusted data, and only known keys and real evidence ids survive. Without a key, rules tuned for common phrasing ("X is blocked until…", "can only start after…", "needs…", "I'm on X with Y", "takes about N days") do it. **Every edge cites the messages or events it came from.**
- **Scheduling** (`src/graph/engine.js`, which runs in both the server and the browser). Parts arrive on the date of the chosen shipping tier. Work starts once its blockers are done and its people are back from OOO. Milestones slip when their due work or parts are late. The engine reports the critical path (what determined each start), missed bookings, and idle engineer-days against the fastest-shipping baseline at $1,100/day. On the seeded data, standard sensors produce the same $30,800 the request totals use, now derived from Slack and the calendar. The engine also finds that the slow harness vendor is a hidden EVT bottleneck.
- **`/graph`** is a calendar timeline. Parts are dots, work is bars and milestones are diamonds; the critical path is in ink, and slips are red with a "slips Nd" label. Shipping toggles for each open request re-run the schedule live, and nodes animate to their new dates. There are milestone and idle-cost tiles, a booking-conflict warning, and a table view. Clicking a node shows its dependencies with the quoted Slack messages and calendar events behind them; `?focus=<node id>` deep-links to one.
- **`/approvals`** shows a compact graph of everything waiting on the selected request, scheduled with the tier being approved. It names the real cause when a milestone would still slip, e.g. "EVT build still slips 4d with this option: Cable harness arrives Nov 18, not this order."
- **The agent** reads ingested messages, calendar milestones and graph dependencies when the server is running.

## Current boundaries

Slack and calendar connectors are implemented but have only been exercised against recorded API responses and fixture files here. No live Slack token or calendar URL has been supplied yet; add them to `.env` (see Integrations). The legacy `server/tools.js` helper is retained only for its original unit test. Vendor and purchasing integrations don't exist yet. Approval costs in `/approvals` facts and the engineer chat still come from `src/decisions.js`; the graph views compute theirs from ingested data. Claude’s agent uses its deterministic fallback without model credentials; live model execution remains unverified in this session. Free text is matched against seven fixture parts; unmatched requests cannot create orders. Purchase orders are local drafts; no vendor purchase is placed. Identity is the reference demo identity, not authenticated access control. Evidence links and the reference Ask button still need actual source/conversation integrations. Run locally for the demo; add authentication before shared hosting.

Request entry, agent analysis, shipping selection, approval, and draft purchase orders are integrated on `main`. Live project/vendor sources, actual purchasing and authenticated approvers remain future integrations.

## Collaboration and Git conventions

Claude and Codex coordinate via `collaboration/PROTOCOL.md`, `CLAUDE.md`, `AGENTS.md` and `scripts/collab.mjs`. The mailbox resolves to the main checkout from linked worktrees so both agents see the same messages. Publish task/file ownership before edits, and record architectural agreements in `collaboration/DECISIONS.md`.

Use one worktree per task:

```bash
git worktree add .worktrees/codex-agent-run -b codex/agent-run
git worktree add .worktrees/claude-ui -b claude/ui
```

Commit messages use Conventional Commits: `feat(api): persist request lifecycle`, `feat(ui-engineer): connect engineer conversation`, `test(api): cover approvals and stale writes`, `docs: document demo workflow`. Keep README updates with their feature. Review and merge finished branches from the main checkout.

Each agent works in its own worktree under `.worktrees/` (`codex/<topic>`, `claude/<topic>`), rebases on `main`, and fast-forward merges after `npm test` and `npm run build` pass. Scopes: `db`, `api`, `agent`, `ui-engineer`, `ui-approvals`, `docs`, `collab`, `deps`, `test`. Claude and Codex have exchanged architectural reviews through the shared mailbox and native cmux messages. Runtime mailbox files are ignored by Git; durable decisions live in `collaboration/DECISIONS.md`.

## Validation

`npm test` checks cost derivation, tool events, persistent approval overrides, duplicate prevention, invalid inputs, dependency invalidation and API handlers. Agent integration tests also cover matching, unsupported parts, question choice aliases, and revision conflicts after analysis. API handler tests run in-process for deterministic isolation. The workflow test crosses request creation, agent tools, engineer answers, shipping selection, approver overrides, draft identity, dependency release and audit APIs. `npm run build` verifies the React production bundle. Chrome verification on isolated previews passed sensor request creation, Rev C answer, Standard selection, Priority approval override, and matching draft PO in both routes. Final production-build checks also passed Rev B substitution, persistent question/answer and actual tool summaries after reload, a scope-probe request without a clarification question, automatic draft creation, and unknown-input rejection. The combined branch passes 30 tests. The preview uses a scratch database; the user’s normal dev database is separate. Model-backed execution is still unverified without credentials.

Catalog matching uses seeded shipping and project context. Parsed quantities appear consistently in the approval description and draft purchase order, which also saves the vendor and exact shipping quote. A new purchase can fulfill the seeded project dependency only when it matches the catalog part and project and covers at least the catalog quantity; a partial purchase leaves that dependency waiting. This is demo fulfillment logic, not a live inventory allocation system.
