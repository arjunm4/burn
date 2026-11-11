# Burn

**A purchasing agent for hardware teams that plugs into Ramp.**

Built for a hackathon with the prompt *automate an existing financial workflow*.

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
| [`docs/architecture.md`](docs/architecture.md) | The design: flow, decisions, cost-of-delay maths, learning |
| [`docs/open-questions.md`](docs/open-questions.md) | Everything not yet decided, and what has been |
| [`docs/research/`](docs/research/) | Research on how startups buy parts, vendor APIs, and the Ramp integration |

## Status

The design is complete as a draft. **The code in this repo is an earlier prototype** with a different example (buying Digi-Key sensors, with a local approval queue and draft purchase orders). None of the Burn flow above is built yet: part entry, the Xometry extension, the Ramp integration and the cost-of-delay comparison as designed. [`docs/architecture.md` §14](docs/architecture.md) maps which prototype parts carry over.

| Prototype piece | Path | Carries over? |
| --- | --- | --- |
| Engineer chat, approval queue, dependency timeline | `src/Engineer.jsx`, `src/Approvals.jsx`, `src/Graph.jsx` | Chat becomes part entry; approvals move to Ramp |
| Schedule engine | `src/graph/engine.js` | Yes, for the schedule maths |
| Claude agent with read-only tools and an offline fallback | `server/agent/` | Yes, as the extractor and explainer |
| Slack and calendar connectors, dependency extraction | `server/connectors/`, `server/ingest/`, `server/graph/` | Yes, for gathering context |
| Request storage and audit log (SQLite) | `server/store.js` | Yes, with new order states |
| Hard-coded example orders and delay cost | `src/decisions.js`, `fixtures/` | No; replaced |

## Running the prototype

Requires **Node.js 24.2+** (it uses built-in SQLite) and npm.

```bash
npm install
npm run dev      # http://localhost:5173/request, /approvals, /graph
npm test
npm run build
```

It runs offline on sample data in `fixtures/`. To read a real Slack workspace and calendar, copy `.env.example` to `.env` and fill it in; `ANTHROPIC_API_KEY` is optional and turns on the Claude planner. The local database lives in `data/` (ignored by Git); delete it to reset the demo data.

## Working in this repo

- One short-lived branch per topic, merged into `main` through a pull request.
- Commit messages follow Conventional Commits, e.g. `feat(extension): read Xometry tiers`, `docs: update open questions`.
- When a decision is made, update `docs/architecture.md` and move the question to the Answered table in `docs/open-questions.md`.
