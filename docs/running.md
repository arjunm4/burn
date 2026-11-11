# Running Burn: configuration, screens, API, code map

Reference for people working in the repo. The [README](../README.md) has the short version and the demo; [`hld.md`](hld.md) and [`architecture.md`](architecture.md) have the design.

## Run it

```bash
npm install
npm run demo         # the demo: Flintlock Robotics on Nov 10, 2026, simulated Xometry, Ramp mock → http://localhost:5173/
npm run dev          # the same server on real time, with your own config and fixtures
npm test             # 265 tests: decision cases, extractor and connectors, vendor verification (fake, simulated site, headless), store and Ramp mock adversarial cases, end-to-end flows, notifications
```

`npm run demo` anchors the clock at 10:30 AM PT on Nov 10, 2026 (`BURN_NOW`), loads the company config generated from the world's value-of-time policies (`demo/flintlock.config.json`), points the headless browser at the simulated Xometry site served by the same process (`/xometry-sim`), and stores everything under `data/demo-*`. `npm run demo -- --reset` wipes it.

With `ANTHROPIC_API_KEY` in `.env` the Claude agent reads the records, writes the card and answers the engineer. Without it Burn falls back to rule-based extraction and template text, and says so in the order's audit log.

### Environment

All optional; the defaults are the simulated backends.

Environment (all optional; defaults are the simulated backends):

| Variable | Default | Meaning |
| --- | --- | --- |
| `VENDOR_MODE` | `fake` | `fake` = in-process fake Xometry; `headless` = Playwright (`playwright-core` driving the installed Google Chrome) against a Xometry-shaped site, by default the simulated one below. Pointing it at xometry.com waits on open questions X1/X5/X6 |
| `XOMETRY_HEADLESS_ENABLED` | unset | `1` enables the headless provider; otherwise it reports itself unavailable and never clicks anything |
| `XOMETRY_BASE_URL` | `http://127.0.0.1:5175` | Where the headless provider browses: the simulated site started with `node server/vendors/site/serve.js`, or the mounted copy at `http://localhost:5173/xometry-sim` |
| `XOMETRY_SIM_PORT` / `XOMETRY_SIM_DB` | `5175` / `data/xometry-sim.sqlite` | Port and record store of the simulated Xometry site (quotes and orders survive restarts) |
| `XOMETRY_RECORDINGS_DIR` | `data/recordings` | Screenshots and `steps.json` per order/quote/attempt written by the headless provider; served at `/recordings/<key>/<file>` |
| `RAMP_MODE` | `mock` | `mock` = persistent Ramp mock with Ramp's field names, signed replayable events; `sandbox` = Ramp sandbox (typed-unavailable until credentials are verified) |
| `RAMP_WEBHOOK_SECRET` | unset | Required to accept `POST /api/ramp/webhook` (verified on the raw body; fails closed) |
| `ORDERS_DB` | `data/orders.sqlite` | Order store and Ramp mock state |
| `BURN_WORLD` | `fixtures/flintlock` | Folder of recorded exports read when no live credentials are set: `slack/` (Slack API JSON), `calendar.ics`, `jira/` (REST search responses), `meetings/` (Markdown notes); each present folder becomes a source. Live equivalents: `SLACK_BOT_TOKEN`+`SLACK_CHANNEL_IDS`, `CALENDAR_ICS_URL`, `JIRA_BASE_URL`+`JIRA_EMAIL`+`JIRA_API_TOKEN`+`JIRA_PROJECTS`, `MEETING_NOTES_DIR` |
| `BURN_NOW` | real time | Anchors the server clock at an instant (the demo day) and lets it run from there; vendor cutoffs, quote validity and "today" follow it |
| `INGEST_WINDOW_DAYS` | `45` | How far back the connectors read |
| `BURN_CONFIG` | `burn.config.json` if present | Company config: spec fields and authorized defaults, milestone value-of-time policies (`milestones`), company holidays (working-day maths), the approving manager, declared slip scenarios |


## Screens

- `/`: the dependency map Burn rebuilt from Slack, Jira, meetings and the calendar, with the hip actuator bracket and everyone waiting on it highlighted.
- `/orders`: part entry (name, what it's for, CAD file, optional technical fields) and the order list with states.
- `/orders/:id`: live progress (SSE), the question panel (missing spec fields, CAD, what the part is for, or the one fact that would flip the decision), the recommendation card (price, part ready, milestone date, days gained, break-even; dominated tiers marked "buys no time"), the dependency timeline with who is blocked, Okay/Choose, the "tell Burn" box with the exchange above it, and the approval and purchase panel. In mock mode a dashed "Ramp (simulated)" box stands in for approving in Ramp and for its test charge.
- `/graph`: the dependency timeline on its own.
- `/xometry-sim`: the simulated Xometry site (also standalone on port 5175): landing → upload CAD → configurator with the lead times, cutoff and validity → checkout read-back and payment → confirmation and `/xometry-sim/account/orders`. Labelled "Xometry (simulated)"; `?__fault=drift|drop-option|timeout|reject` on the checkout URL mirrors the fake vendor's faults.
- "Burn's browser" (on `/orders/:id`, headless mode): the step-by-step recording of what the provider did on the vendor site, with a screenshot and a note per step ("Read back material: 6061-T6 — matches"). Data: `GET /api/orders/:id/recording`.
- `/ramp`: the approver's side, labelled "Ramp (simulated)": Inbox (pending purchase requests with Burn's verdict, the engineer's reason when they overrode it, the cutoff and the frozen spec; Approve / Reject; decided history), Cards (one Xometry-only virtual card per approved order) and Transactions (the charge with the booked memo, receipt and coding, or "awaiting booking"). Live over SSE. Mock mode only.
- `/inbox?as=<person>`: the Slack-DM-style messages one person gets from Burn, newest at the bottom, live; a switcher between the engineer and the manager.

### API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/system` | Which backends are active and their capabilities; company spec fields |
| GET/POST | `/api/orders` | List orders; start one `{name, note, engineer, cad:{fileName, base64}, fields}` |
| GET | `/api/orders/:id` | Order plus sanitized audit events |
| GET | `/api/orders/:id/stream` | Server-sent events for live progress |
| POST | `/api/orders/:id/answer` | `{expectedRevision, fields | cad | demand | fact:{nodeId,date}}` |
| POST | `/api/orders/:id/argue` | `{expectedRevision, text, type, fact?}`: kept with the order; only an asserted fact changes the plan |
| POST | `/api/orders/:id/okay` | `{expectedRevision, tier}`: freezes the spec, creates the Ramp request |
| POST | `/api/orders/:id/reconcile` | From `placement_unknown`: look for the order in vendor records |
| POST | `/api/ramp/webhook` | Ramp events (signature required) |
| POST | `/api/ramp/simulate/{approve,reject,charge}` | Mock only |
| GET | `/api/ramp/{requests,cards,transactions}` | Mock only: the Ramp side (purchase requests, virtual cards, transactions with bookings), each joined to its order without credential or CAD |
| GET | `/api/ramp/stream` | Mock only: SSE `ramp.changed` whenever a Ramp-side event fires |
| GET | `/api/notifications?to=&limit=` | One person's notifications (oldest first) and the list of recipients |
| GET | `/api/notifications/stream?to=` | SSE `notification` events for one person |

Mutations take `expectedRevision` and return 409 on conflict. The API never returns the card credential or CAD bytes.


Mutations take `expectedRevision` and return 409 on conflict. The API never returns the card credential or CAD bytes. Demo-only: `GET /api/demo`, `POST /api/demo/start` (enter Owen's part), `POST /api/demo/live-change` (post a scripted Slack message into Burn's copy of Slack).

### Code map

| Path | What it is |
| --- | --- |
| `server/contracts.js` | Shared shapes: OrderSpec, QuoteSnapshot, Order and its states, PlacementAttempt, OrderStore, RampClient, VendorProvider, DecisionResult |
| `server/connectors/` | Read-only connectors with fixture replay: Slack (Web API), iCalendar, Jira (REST), meeting notes (exported Markdown) |
| `server/graph/extract.js`, `src/graph/engine.js`, `src/graph/calendar.js` | Statement extraction (rules or Claude structured output; entities typed by head noun and merged across mentions, dates, durations, bookings, cited evidence), the working-day scheduler and company calendar |
| `server/clock.js`, `server/config.js` | Shared clock (`BURN_NOW`) and company config |
| `server/vendors/site/`, `server/vendors/headless.js`, `server/vendors/recorded.js` | The simulated Xometry site, the Playwright provider that drives it (or xometry.com later), recorded quotes from the world |
| `server/notify/`, `server/api/ramp.js`, `server/api/notifications.js`, `src/Ramp.jsx`, `src/Inbox.jsx` | The people's side: notifications per person, the Ramp-side views |
| `server/api/demo.js`, `src/Demo.jsx`, `scripts/demo.mjs`, `demo/` | Demo-only controls and config; nothing else depends on them |
| `src/decision/core.js` | The decision core: admissibility (incl. hard deadlines), same-world outcomes per declared scenario, dominance, owner-policy economics, break-even, switching condition, the flip question; nothing preselected while that question is open |
| `server/flow/context.js` | Context retrieval anchored on the part entry; links the part only through documents that name it; declared slip scenarios; assumptions with ages |
| `server/flow/orchestrator.js` | The order flow: spec gate, quote, decide, answer/argue, Okay → Ramp, authoritative event handling (atomic `processEvent`), pre-placement revalidation, durable placement with `placement_unknown` and reconciliation, booking retried separately |
| `server/orders/store.js` | SQLite order store: transactional mutations with revisions, protected frozen fields, serialized placement attempts, interrupted placements recovered as `placement_unknown`, audit log with secrets scrubbed |
| `server/ramp/index.js` | Ramp client: persistent mock with Ramp's field names, signed/replayable events, idempotent requests and cards, card limit and merchant enforcement; sandbox as typed-unavailable |
| `server/vendors/` | VendorProvider: fake Xometry (tiers, cutoff, 30-day validity, field-by-field verification, drift/dropped-tier/timeout faults, order lookup for reconciliation) and the disabled headless stub |
| `server/api/orders.js` | HTTP API and SSE |
| `src/Orders.jsx`, `src/Order.jsx`, `src/ui.jsx` | Screens |
| `src/timevalue/`, `server/timevalue/`, `scripts/timevalue/` | Time Value: maths and rubric, sources, LLM read, company dependency graph, grading, demo cards |
| `scripts/generate-world/`, `fixtures/world/`, `fixtures/flintlock/` | The Flintlock world: seed, simulator, text jobs, rendered sources, answer key |

Not built: the learning model (built, then paused; see above), delivery tracking and first-use checks, driving the real xometry.com (the provider's selectors target the simulated site; open questions X1/X5/X6), the Ramp sandbox backend.


Not built: the learning model (built, then paused; see `architecture.md` §10), delivery tracking and first-use checks, driving the real xometry.com (the provider's selectors target the simulated site; open questions X1/X5/X6), the Ramp sandbox backend.

## Time Value: the decision, graded against the truth

The Time Value cards (precomputed in `fixtures/timevalue/demo-cards.json`; the standalone page was removed, the same graph now draws the map at `/` and the timeline on the order page) cover the demo order (4× hip actuator bracket rev C for the DVT spin test) in five scenarios. A red banner above them states the problem in Flintlock's history: **61 of 133 rush orders bought no time, $31,159 in premiums**.

| Tab | What happened | Card |
| --- | --- | --- |
| 10:30 · motor on time | Arjun: motor ready Fri 11/20 | **Expedite**: 2 working days sooner for +$900; worth it above $450/day; policy is $600/day |
| 10:45 · motor slips | Arjun: new ETA 11/30 | **Standard**: the motor sets the start, Expedite buys no time, save $900 |
| 11:00 · motor unsure | "somewhere between 11/19 and 11/30" | **Depends**: Expedite pays only if the motor is ready by Fri 11/20, so ask Arjun |
| 11:15 · sources disagree | Samir: motor 11/27, not 11/20 | **Ask**: both outcomes shown, nothing preselected |

On every card a Rush tier ($6,900, 2 days) is flagged: it finishes no sooner than Expedite, so it is +$3,000 for nothing. Each card shows seven checks, each with its source; check 7 is the LLM read ("what the conversation says").

**How it works**

1. **Sources** (`server/timevalue/sources.mjs`): Slack, Jira, meeting notes, calendar, Xometry and Ramp exports, normalised to one list of dated messages.
2. **LLM read** (`scripts/timevalue/read-jobs.mjs`): messages that mention a known part, test or deliverable are read by Claude agents into job files (parts named, claims such as "needs 4 by Tue" or "new ETA 11/30", pressure 0–1). No API key is needed at run time; the reads are cached in `fixtures/timevalue/read-cache.json`. A rule-based reader is the fallback.
3. **Company dependency graph** (`server/timevalue/graph.mjs`): part → work or test → milestone, every link with its evidence, readable as known at any date. Newer statements from the right person win; disagreements stay open.
4. **Maths** (`src/timevalue/`): working days, rig slot days, "a test starts when all its inputs are ready", days saved, break-even, the owner's $/day or curve, switching dates. It never invents a $/day.
5. **Grading** (`scripts/timevalue/grade.mjs`): Burn's answers against the world's answer key.

**Results on the Flintlock world** (`fixtures/timevalue/grading.json`)

| Measure | Result |
| --- | --- |
| Maths vs the simulator's true outcomes | 400 / 400 orders exact |
| Dependency links Burn rebuilt from the messages | 75.8% of all true links (83% of the links someone stated) |
| Ramp charges matched to Xometry orders | 482 / 482 |
| Past wasted rushes Burn would have flagged | 0 / 61 (see Known limits in the [README](../README.md)) |

**Rerun** after regenerating the world or its text:

```bash
node scripts/timevalue/rerun.mjs jobs     # settings + LLM read jobs (agents fill them; docs/build/read-job-instructions.md)
node scripts/timevalue/rerun.mjs finish   # collect reads, grade, rebuild the demo cards
```

