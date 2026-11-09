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
- NDJSON tool execution events from the Node backend.
- Persisted approval tiers, draft purchase orders, dependency release/reset, validation and visible request failures.

SQLite defaults to `data/purchasing.sqlite` (ignored by Git). Set `PURCHASING_DB` to override its path. Stop the app and remove the database plus its `-wal`/`-shm` siblings to reseed all demo data.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/requests` | Shared request snapshot, approvals and resolved dependencies |
| POST | `/api/requests/:id/run` | NDJSON tool execution stream |
| POST | `/api/requests/:id/answer` | `{answer: "yes" or "no", revision}` |
| POST | `/api/requests/:id/select` | `{tier: integer, revision}` |
| POST | `/api/requests/:id/approve` | `{tier: integer, revision}` |
| POST | `/api/requests/sens/reset` | `{revision}` |
| GET | `/api/requests/:id/audit` | Persisted transition audit |

Every mutation returns `{request}`. Errors return `{error}`; stale revisions return HTTP 409. The server remains the authority for transitions, tier validity and approval rules.

## Current boundaries

The tool adapters in `server/tools.js` execute against seeded project data. No Slack, calendar, vendor, or LLM credentials have been supplied. The UI is a guided conversation for the sample sensor request, not arbitrary free-text purchasing. Purchase orders are local drafts; no vendor purchase is placed. Identity is the reference demo identity, not authenticated access control. Evidence links and the reference Ask button still need actual source/conversation integrations. Run locally for the demo; add authentication before shared hosting.

Next milestones: agree live integration choices with Claude, add request creation, connect project/vendor sources and an agent reasoning loop, then integrate purchasing and authenticated approvers.

## Collaboration and Git conventions

Claude and Codex coordinate via `collaboration/PROTOCOL.md`, `CLAUDE.md`, `AGENTS.md` and `scripts/collab.mjs`. The mailbox resolves to the main checkout from linked worktrees so both agents see the same messages. Publish task/file ownership before edits, and record architectural agreements in `collaboration/DECISIONS.md`.

Use one worktree per task:

```bash
git worktree add .worktrees/backend -b feat/request-lifecycle
git worktree add .worktrees/frontend -b feat/shared-request-ui
```

Commit messages use Conventional Commits: `feat(server): persist request lifecycle`, `feat(ui): connect engineer and approval views`, `test(server): cover approvals and stale writes`, `docs: document demo workflow`. Keep README updates with their feature. Review and merge finished branches from the main checkout.

During this implementation session `.git` is read-only, so worktree/commit creation is blocked. Source edits are present in the main checkout; no feature commits are claimed. Claude acknowledged the mailbox, but the local CLI is not authenticated, so joint architecture review is pending.

## Validation

`npm test` checks cost derivation, tool events, persistent approval overrides, duplicate prevention, invalid inputs, dependency invalidation and API handlers. API handler tests run in-process because the build session cannot bind local sockets. `npm run build` verifies the React production bundle. Browser end-to-end verification remains pending in a session that can start the local server.
