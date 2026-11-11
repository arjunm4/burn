# Burn

**A purchasing agent for hardware teams that plugs into Ramp.**

Built for a hackathon hosted by Ramp and BBS at Berkeley, with the prompt *automate an existing financial workflow*.

## The problem

When an engineer orders a custom machined part from a site like Xometry, they have to choose how fast it is made and shipped, for example $3,000 for 10 days or $3,900 for 5 days. Whether paying for speed is worth it depends on facts scattered across Slack, meetings, Jira and calendars: what the part is for, what else that work is waiting on, and how close the deadline is. So the choice is a guess. Then the engineer fills in the vendor form by hand, sends the quote around, chases approval, finds a company card, and writes up the expense afterwards.

## What Burn does

The engineer types the part name and a short note about what it's for, and attaches the design file. Burn does the rest:

1. **Gathers context.** It reads Slack, meeting notes, Jira and the calendar for everything related to the part: which test it's needed for, what else that test is waiting on, and the deadline.
2. **Gets the quote.** Burn sends the part to Xometry (a clone in the demo, not the real site) and gets back the price and lead time of each speed option.
3. **Recommends a tier.** It works out whether paying for speed gets the work done sooner, and whether that time is worth the money: *"Expedited gets the spin test done 2 days sooner for $900 more; worth it if a day is worth more than $450."* If faster wouldn't help, it picks the cheaper option. If one missing fact would change the answer, it asks the one person who knows.
4. **Engineer clicks Okay**, or edits, or argues.
5. **Approval in Ramp.** Burn sends the request with its explanation to Ramp. The engineer's manager approves it there; small orders are approved automatically by the company's Ramp rules.
6. **Payment.** Ramp issues a card that only works at Xometry, for exactly the approved amount.
7. **Placement.** Burn alerts the engineer, then places the order automatically. It checks every detail against what was approved first, and stops instead of buying if anything changed.
8. **Bookkeeping.** When the charge clears, Burn attaches the receipt, explanation and project code in Ramp. It tracks delivery and checks with the engineer once the part is in use.

**Reading the conversation.** Alongside the maths, Burn reports what the conversation says: how much pressure is in the recent messages, whether two people disagree about a date, and whether an urgent request hides an earlier need. It can add a question or a warning; it never changes the money or the tier.

**Learning (paused).** A habit model trained on past Ramp × Xometry purchases was built and removed: on the demo data it predicted the team's choice no better than "never expedite" (56% vs 60%, 45 orders). The design stays in [`docs/architecture.md`](docs/architecture.md) §10.

| Burn does | Ramp does |
| --- | --- |
| Context, Xometry quote, tier recommendation, verified placement, tracking | Purchase request, manager approval, card, receipt and accounting |

## Documentation

| Document | What's in it |
| --- | --- |
| [`docs/hld.md`](docs/hld.md) | One-page high-level design: who does what, the flow, how the recommendation is made, the parts of the system |
| [`docs/architecture.md`](docs/architecture.md) | The design (v9): flow, decisions, cost-of-delay maths, learning, how the demo data was built |
| [`docs/open-questions.md`](docs/open-questions.md) | Everything not yet decided, and what has been |
| [`docs/research/`](docs/research/) | Research on how startups buy parts, vendor APIs, Xometry automation, the Ramp integration, and data realism |
| [`docs/research/cost-of-delay.md`](docs/research/cost-of-delay.md) | Why the decision rule is break-even against the owner's $/day (Reinertsen, critical-path crashing, merge bias, switching values) |
| [`docs/build/time-value-plan.md`](docs/build/time-value-plan.md), [`docs/build/time-value-impl.md`](docs/build/time-value-impl.md) | Time Value: the tier decision, the company dependency graph, the LLM read and grading; how to rerun them |
| [`fixtures/world/SCHEMA.md`](fixtures/world/SCHEMA.md), [`docs/build/`](docs/build/) | The Flintlock Robotics demo world: ground truth, generator spec, verification findings |

## Status

The **design** is v9 ([`docs/hld.md`](docs/hld.md), [`docs/architecture.md`](docs/architecture.md)). The **whole flow is built and runs end to end** on simulated services: part entry → context from Slack, Jira, meeting notes and the calendar → spec gate → Xometry quote through Burn's headless browser → recommendation → Okay → Ramp purchase request → manager approval → Xometry-locked card → field-by-field verified placement → charge → receipt, memo and project code. Every external service is simulated behind the interface a real one would implement (architecture §2.18): a Ramp mock with Ramp's field names, a simulated Xometry site that the real Playwright provider drives, recorded Slack/Jira/meeting/calendar exports read by the real connectors. The demo world is Owen's Flintlock Robotics data in `fixtures/flintlock/`; demo-only pieces (`demo/`, `scripts/demo.mjs`, `/api/demo`) are kept apart from the product code. The earlier Digi-Key prototype is still in the tree at `/request` and `/approvals`.

**The demo opens on the dependency graph** (`/`): the company map Burn rebuilt from messages, with the hip actuator bracket and everyone waiting on it highlighted. The order page then shows the same dependencies as a timeline, with who is blocked, right above Okay.

### The demo in one command

```bash
npm install
npm run demo         # http://localhost:5173/orders
```

This starts Burn as Flintlock Robotics at 10:30 AM PT on Nov 10, 2026 (`BURN_NOW`), with the company config generated from the world's value-of-time policies (`demo/flintlock.config.json`), the headless browser pointed at the simulated Xometry site served by the same process (`/xometry-sim`), and everything stored under `data/demo-*` (`npm run demo -- --reset` wipes it). Then:

1. `/` → **the map**: Burn's dependency graph of Flintlock, drawn from nine months of Slack, Jira, meetings and the calendar. Click *Hip actuator bracket*: it feeds the hip DVT spin test, which also waits on a motor; the sidebar lists who is blocked. "Motor slips" ripples the slip through every downstream test. *Step 2: order the bracket →*
2. `/orders` → **Enter it as Owen**: 4× hip bracket rev C for the spin test. Watch Burn read the records (its searches stream in), quote on Xometry through its browser, and recommend **Expedite**: $900 buys 2 working days, break-even $450/day against Arjun's $600/day; Rush buys no time because the motor is the bottleneck.
3. **Meanwhile, in Slack**: post Arjun's message (motor arrived, spin test pulled in to Nov 18). Burn re-reads and flips to **Rush**: the only tier that makes the date.
4. **Tell Burn**: "we can run the 11/18 spin test on the rev B brackets we already have, rev C only matters for the full DVT build later. go standard and save the $1,900". Burn answers, agrees, and says your reason will go to the approver. **Choose Standard**.
5. `/ramp` → Ingrid's inbox: $3,000, *Standard chosen, Burn recommended Rush*, Owen's reason in his own words, the 2:00 PM cutoff → **Approve**.
6. Back on the order: card issued (Xometry only, $3,000) → Burn's browser reopens the quote, reads every field back, pays, places → the charge clears → receipt, memo and project code booked in Ramp. Owen never opened Xometry or Ramp.

## Time Value: the decision, graded against the truth

The Time Value cards (precomputed in `fixtures/timevalue/demo-cards.json`, page removed for the demo) cover the demo order (4× hip actuator bracket rev C for the DVT spin test) in five scenarios. A red banner above them states the problem in Flintlock's history: **61 of 133 rush orders bought no time, $31,159 in premiums**.

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
| Past wasted rushes Burn would have flagged | 0 / 61 (see Known limits) |

**Rerun** after regenerating the world or its text:

```bash
node scripts/timevalue/rerun.mjs jobs     # settings + LLM read jobs (agents fill them; docs/build/read-job-instructions.md)
node scripts/timevalue/rerun.mjs finish   # collect reads, grade, rebuild the demo cards
```

## Known limits

- **Everything is synthetic.** Flintlock Robotics, its people, messages and orders are generated (`scripts/generate-world/`); Ramp, Xometry, Slack, Jira, meetings and calendar are simulated. Results hold "in this simulator".
- **The $/day values are invented.** No public data on what a day of schedule is worth at a hardware startup exists; Burn takes it from the milestone owner and shows the break-even when there is none.
- **Burn flags 0 of the 61 past wasted rushes.** Most of them fed work (fit checks, rig setup) rather than a test, and Burn's maths follows part → test → milestone only; a few depended on dates nobody stated, where Burn says "can't decide" instead of guessing. The $31,159 figure comes from the answer key, not from Burn. In the live demo, the same logic catches the wasted rush at 10:45.
- **Xometry prices are modelled.** Premiums of +30–166% over Standard sit at the high end of published anecdotes; real quotes need a CAD upload ([`docs/research/data-realism.md`](docs/research/data-realism.md)).
- **No live model calls in the demo.** Without an API key only the four scripted messages change the Time Value cards.

## The v9 flow

### Run it

```bash
npm install
npm run dev          # http://localhost:5173/orders
npm test             # 263 tests: decision cases, extractor and connectors, vendor verification (fake, simulated site, headless), store and Ramp mock adversarial cases, end-to-end flows, notifications
```

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

### Screens

- `/orders`: part entry (name, what it's for, CAD file, optional technical fields) and the order list with states.
- `/orders/:id`: live progress (SSE), the question panel (missing spec fields, CAD, what the part is for, or the one fact that would flip the decision), the spec with provenance chips, related context with the age of each fact, the comparison card (price, part ready, milestone date, days gained, break-even, basis; dominated tiers marked "buys no time"), Okay/Choose, a typed argue box, and the approval and purchase panel. In mock mode a dashed "Ramp (simulated)" box stands in for approving in Ramp and for its ⌘J test charge.
- `/graph`: the dependency timeline (unchanged).
- `/timevalue`: the Time Value cards for the demo order (four tabs, the wasted-rush banner, the seven checks with sources). Data: `GET /api/timevalue/demo?change=0..3`, with `fixtures/timevalue/demo-cards.json` as the offline fallback.
- `/xometry-sim`: the simulated Xometry site (also standalone on port 5175): landing → upload CAD → configurator with the four lead times, cutoff and validity → checkout read-back and payment → confirmation and `/xometry-sim/account/orders`. Labelled "Xometry (simulated)"; `?__fault=drift|drop-option|timeout|reject` on the checkout URL mirrors the fake vendor's faults.
- "Burn's browser" (on `/orders/:id`, headless mode): the step-by-step recording of what the provider did on the vendor site, with a screenshot and a note per step ("Read back material: 6061-T6 — matches"), refreshed every 3 s while the order is being worked on. Data: `GET /api/orders/:id/recording`.
- `/ramp`: the approver's side, labelled "Ramp (simulated)": Inbox (pending purchase requests with Burn's justification, the cutoff and the frozen spec; Approve / Reject; decided history), Cards (one Xometry-only virtual card per approved order: last 4, limit, spent, lock date) and Transactions (the charge with the booked memo, receipt and coding, or "awaiting booking"). Live over SSE. Mock mode only.
- `/inbox?as=<person>`: the Slack-DM-style messages one person gets from Burn (quote and recommendation, questions, approval needed with "Open in Ramp", approved, placing, placed, stopped-before-buying, charged, booked), newest at the bottom, live; a switcher between the engineer and the manager.

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

### Code map

| Path | What it is | Owner |
| --- | --- | --- |
| `server/contracts.js` | Shared shapes: OrderSpec, QuoteSnapshot, Order and its states, PlacementAttempt, OrderStore, RampClient, VendorProvider, DecisionResult | shared |
| `server/connectors/` | Read-only connectors with fixture replay: Slack (Web API), iCalendar, Jira (REST), meeting notes (exported Markdown) | Claude |
| `server/graph/extract.js`, `src/graph/engine.js`, `src/graph/calendar.js` | Statement extraction (rules or Claude structured output; entities typed by head noun and merged across mentions, dates, durations, bookings, cited evidence), the working-day scheduler and company calendar | Claude |
| `server/clock.js`, `server/config.js` | Shared clock (`BURN_NOW`) and company config | Claude |
| `server/vendors/site/`, `server/vendors/headless.js`, `server/vendors/recorded.js` | The simulated Xometry site, the Playwright provider that drives it (or xometry.com later), recorded quotes from the world | Claude |
| `server/notify/`, `server/api/ramp.js`, `server/api/notifications.js`, `src/Ramp.jsx`, `src/Inbox.jsx` | The people's side: notifications per person, the Ramp-side views | Claude |
| `server/api/demo.js`, `src/Demo.jsx`, `scripts/demo.mjs`, `demo/` | Demo-only controls and config; nothing else depends on them | Claude |
| `src/decision/core.js` | The decision core: admissibility (incl. hard deadlines), same-world outcomes per declared scenario, dominance, owner-policy economics, break-even, switching condition, the flip question; nothing preselected while that question is open | Claude |
| `server/flow/context.js` | Context retrieval anchored on the part entry; links the part only through documents that name it; declared slip scenarios; assumptions with ages | Claude |
| `server/flow/orchestrator.js` | The order flow: spec gate, quote, decide, answer/argue, Okay → Ramp, authoritative event handling (atomic `processEvent`), pre-placement revalidation, durable placement with `placement_unknown` and reconciliation, booking retried separately | Claude |
| `server/orders/store.js` | SQLite order store: transactional mutations with revisions, protected frozen fields, serialized placement attempts, interrupted placements recovered as `placement_unknown`, audit log with secrets scrubbed | Codex |
| `server/ramp/index.js` | Ramp client: persistent mock with Ramp's field names, signed/replayable events, idempotent requests and cards, card limit and merchant enforcement; sandbox as typed-unavailable | Codex |
| `server/vendors/` | VendorProvider: fake Xometry (tiers, cutoff, 30-day validity, field-by-field verification, drift/dropped-tier/timeout faults, order lookup for reconciliation) and the disabled headless stub | Claude |
| `server/api/orders.js` | HTTP API and SSE | Claude |
| `src/Orders.jsx`, `src/Order.jsx`, `src/ui.jsx` | Screens | Claude |
| `src/timevalue/`, `server/timevalue/`, `scripts/timevalue/` | Time Value: maths and rubric, sources, LLM read, company dependency graph, grading, demo cards | Owen |
| `scripts/generate-world/`, `fixtures/world/`, `fixtures/flintlock/` | The Flintlock world: seed, simulator, text jobs, rendered sources, answer key | Owen |

Not built: the learning model (built, then paused; see above), delivery tracking and first-use checks, driving the real xometry.com (the provider's selectors target the simulated site; open questions X1/X5/X6), the Ramp sandbox backend.

## Working in this repo

- One short-lived branch per topic, merged into `main` through a pull request.
- Commit messages follow Conventional Commits, e.g. `feat(xometry): read quote tiers`, `docs: update open questions`.
- When a decision is made, update `docs/architecture.md` and move the question to the Answered table in `docs/open-questions.md`.
