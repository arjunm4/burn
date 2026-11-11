# Burn

**A purchasing agent for hardware teams that plugs into Ramp.**

Built for a hackathon hosted by Ramp and BBS at Berkeley, with the prompt *automate an existing financial workflow*.

## The problem

When an engineer orders a custom machined part from a site like Xometry, they have to choose how fast it is made and shipped, for example $3,000 for 10 days or $3,900 for 5 days. Whether paying for speed is worth it depends on facts scattered across Slack, meetings, Jira and calendars: what the part is for, what else that work is waiting on, and how close the deadline is. So the choice is a guess. Then the engineer fills in the vendor form by hand, sends the quote around, chases approval, finds a company card, and writes up the expense afterwards.

## What Burn does

The engineer types the part name and a short note about what it's for, and attaches the design file. Burn does the rest:

1. **Gathers context.** It reads Slack, meeting notes, Jira and the calendar for everything related to the part: which test it's needed for, what else that test is waiting on, and the deadline.
2. **Gets the quote.** A browser extension fills in the order on Xometry and reads back the price of each speed option.
3. **Recommends a tier.** It works out whether paying for speed gets the work done sooner, and whether that time is worth the money: *"Expedited gets the spin test done 2 days sooner for $900 more; worth it if a day is worth more than $450."* If faster wouldn't help, it picks the cheaper option. If one missing fact would change the answer, it asks the one person who knows.
4. **Engineer clicks Okay**, or edits, or argues.
5. **Approval in Ramp.** Burn sends the request with its explanation to Ramp. The engineer's manager approves it there; small orders are approved automatically by the company's Ramp rules.
6. **Payment.** Ramp issues a card that only works at Xometry, for exactly the approved amount.
7. **Placement.** Burn alerts the engineer, then places the order automatically. It checks every detail against what was approved first, and stops instead of buying if anything changed.
8. **Bookkeeping.** When the charge clears, Burn attaches the receipt, explanation and project code in Ramp. It tracks delivery and checks with the engineer once the part is in use.

**Learning.** Burn learns how the team makes these choices from past Xometry purchases in Ramp and the conversations and deadlines leading up to each one, and shows that as context next to its recommendation.

| Burn does | Ramp does |
| --- | --- |
| Context, Xometry quote, tier recommendation, verified placement, tracking, learning | Purchase request, manager approval, card, receipt and accounting |

## Documentation

| Document | What's in it |
| --- | --- |
| [`docs/hld.md`](docs/hld.md) | One-page high-level design: who does what, the flow, how the recommendation is made, the parts of the system |
| [`docs/architecture.md`](docs/architecture.md) | The design (v9): flow, decisions, cost-of-delay maths, learning, how the demo data was built |
| [`docs/open-questions.md`](docs/open-questions.md) | Everything not yet decided, and what has been |
| [`docs/research/`](docs/research/) | Research on how startups buy parts, vendor APIs, Xometry automation, the Ramp integration, and data realism |
| [`fixtures/world/SCHEMA.md`](fixtures/world/SCHEMA.md), [`docs/build/`](docs/build/) | The Flintlock Robotics demo world: ground truth, generator spec, verification findings |

## Status

The **design** is v9 ([`docs/hld.md`](docs/hld.md), [`docs/architecture.md`](docs/architecture.md)). The **v9 flow is built as scaffolding** on this branch: part entry → context → spec gate → Xometry quote → decision → Okay → Ramp request → approval → card → verified placement → charge → booking, against a fake Xometry and a Ramp mock. It runs the same orchestration and decision core a real deployment would; only the adapters are simulated. Every external service is mocked for the demo (architecture §2.18); the mocks sit behind the same interfaces a real deployment would use. The demo data is the Flintlock Robotics world in `fixtures/flintlock/` (rendered Slack, Jira, meetings, calendar, Xometry and Ramp records generated from `fixtures/world/`). The earlier Digi-Key prototype is still in the tree at `/request` and `/approvals` until the new flow replaces it.

## The v9 flow

### Run it

```bash
npm install
npm run dev          # http://localhost:5173/orders
npm test             # 84 tests: decision cases A–E, vendor verification, store and Ramp mock adversarial cases, end-to-end flow
```

Environment (all optional; defaults are the simulated backends):

| Variable | Default | Meaning |
| --- | --- | --- |
| `VENDOR_MODE` | `fake` | `fake` = in-process fake Xometry; `headless` = Playwright on xometry.com (disabled until open questions X1/X5/X6 are resolved; reports itself unavailable) |
| `RAMP_MODE` | `mock` | `mock` = persistent Ramp mock with Ramp's field names, signed replayable events; `sandbox` = Ramp sandbox (typed-unavailable until credentials are verified) |
| `RAMP_WEBHOOK_SECRET` | unset | Required to accept `POST /api/ramp/webhook` (verified on the raw body; fails closed) |
| `ORDERS_DB` | `data/orders.sqlite` | Order store and Ramp mock state |
| `BURN_CONFIG` | `burn.config.json` if present | Company config: spec fields and authorized defaults, milestone value-of-time policies, declared slip scenarios |

### Screens

- `/orders`: part entry (name, what it's for, CAD file, optional technical fields) and the order list with states.
- `/orders/:id`: live progress (SSE), the question panel (missing spec fields, CAD, what the part is for, or the one fact that would flip the decision), the spec with provenance chips, related context with the age of each fact, the comparison card (price, part ready, milestone date, days gained, break-even, basis; dominated tiers marked "buys no time"), Okay/Choose, a typed argue box, and the approval and purchase panel. In mock mode a dashed "Ramp (simulated)" box stands in for approving in Ramp and for its ⌘J test charge.
- `/graph`: the dependency timeline (unchanged).

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

Mutations take `expectedRevision` and return 409 on conflict. The API never returns the card credential or CAD bytes.

### Code map

| Path | What it is | Owner |
| --- | --- | --- |
| `server/contracts.js` | Shared shapes: OrderSpec, QuoteSnapshot, Order and its states, PlacementAttempt, OrderStore, RampClient, VendorProvider, DecisionResult | shared |
| `src/decision/core.js` | The decision core: admissibility (incl. hard deadlines), same-world outcomes per declared scenario, dominance, owner-policy economics, break-even, switching condition, the flip question; nothing preselected while that question is open | Claude |
| `server/flow/context.js` | Context retrieval anchored on the part entry; links the part only through documents that name it; declared slip scenarios; assumptions with ages | Claude |
| `server/flow/orchestrator.js` | The order flow: spec gate, quote, decide, answer/argue, Okay → Ramp, authoritative event handling (atomic `processEvent`), pre-placement revalidation, durable placement with `placement_unknown` and reconciliation, booking retried separately | Claude |
| `server/orders/store.js` | SQLite order store: transactional mutations with revisions, protected frozen fields, serialized placement attempts, interrupted placements recovered as `placement_unknown`, audit log with secrets scrubbed | Codex |
| `server/ramp/index.js` | Ramp client: persistent mock with Ramp's field names, signed/replayable events, idempotent requests and cards, card limit and merchant enforcement; sandbox as typed-unavailable | Codex |
| `server/vendors/` | VendorProvider: fake Xometry (tiers, cutoff, 30-day validity, field-by-field verification, drift/dropped-tier/timeout faults, order lookup for reconciliation) and the disabled headless stub | Claude |
| `server/api/orders.js` | HTTP API and SSE | Claude |
| `src/Orders.jsx`, `src/Order.jsx`, `src/ui.jsx` | Screens | Claude |

Not built: the learning model (a labelled slide), delivery tracking and first-use checks, the real headless Xometry provider, the Ramp sandbox backend.

## Working in this repo

- One short-lived branch per topic, merged into `main` through a pull request.
- Commit messages follow Conventional Commits, e.g. `feat(extension): read Xometry tiers`, `docs: update open questions`.
- When a decision is made, update `docs/architecture.md` and move the question to the Answered table in `docs/open-questions.md`.
