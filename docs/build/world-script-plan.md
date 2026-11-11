# Build plan: world model and generator

Owner: Owen, with Fable agents. Deadline: 2026-11-10, 11:59pm PT. Spec: [`../architecture.md`](../architecture.md) §12. Realism rules and volumes: [`../research/data-realism.md`](../research/data-realism.md).

**Company:** Flintlock Robotics, a fictional humanoid robotics startup of ~60 people in California (Pacific time), ordering from Xometry's US site, at a stage of its robot generation heavy in custom CNC parts. The order history covers **all** purchasing across vendors (fasteners, electronics, PCBs, motors, tools, raw stock, other custom parts) so the context is realistic. Burn acts only on custom CNC orders on Xometry, and the demo uses those.

**Test hardware and dependency chains:** Flintlock does not have a complete humanoid. Only parts of it work (a leg, a hip actuator, a hand), and much of the work is testing those pieces on their own. So a large share of the custom CNC parts are **test infrastructure** rather than robot parts: fixture hooks and lift hooks that hold a leg in the air, test stands, jigs, dyno and spin-test adapters, mounting plates. This is where dependency chains come from: *before the leg drop test can run, the machined hook that suspends the leg must arrive*; the test also needs the leg itself, the stand and a booked bench.

**Demo order:** the hip-actuator bracket for the spin test, which also waits on the motor (the worked example in the architecture). Fixture hooks and the other test hardware are among the past orders.

## Rules for every agent

- **The world model is the ground truth and the single source of it.** Code decides facts, IDs and timestamps. Models write seed content and text.
- **The context is generated from the truth and is deliberately imperfect:** stale facts, wrong dates, contradictions between sources, things nobody wrote down. The truth itself is complete and consistent.
- **Model: Fable** for most work, including the text.
- **Read the style research first:** [`../research/data-realism.md`](../research/data-realism.md) (formats, Flintlock volumes, style numbers, fake-looking patterns) and, for orders, [`../research/startup-purchasing.md`](../research/startup-purchasing.md). Every agent's prompt points at the sections for its source, and its output must follow them.
- **The app never reads `fixtures/world/`.** Burn sees only the rendered sources (`fixtures/slack/`, `fixtures/jira/`, …). The world model and answer key are for the generator and for grading.
- **One file per agent.** Agents working in parallel each own distinct files and run no git commands.

## The world model: seed plus simulation

Hand-writing thousands of orders and events would be slow, costly and inconsistent. So the truth is built in two parts:

- **Seed** (`fixtures/world/seed/`): small files written by Fable agents. People, teams, assemblies, the parts catalog, test rigs, tests, milestones, deliverables, storylines, channels, meeting series, vendors, finance, the demo block.
- **Simulation** (`scripts/generate-world/simulate.mjs`): seeded code that plays the seed forward over the nine months and writes `fixtures/world/world.json` and `fixtures/world/answers.json`. It produces the schedule histories and slips, work items and tickets, every order with its decision and hidden reason, deliveries and first use, and the events.
- **Knobs** (`fixtures/world/knobs.json`): every tunable rate in one file, so the story can be re-tuned and the world regenerated in seconds without touching code.

### Layers

Each layer needs the one before.

| # | Layer | Contents | Source |
|---|---|---|---|
| 1 | Company | 60 people in the researched org split | Seed |
| 2 | Program | The partly working robot: assemblies, parts catalog, test rigs, tests, deliverables, milestones with $/day policies, storylines | Seed |
| 3 | True dependency graph | Every link, part → test or work → milestone. The rendered sources reveal only part of it | Seed + simulation |
| 4 | Schedule, progress and pressure over time | Plan dates and their slips, work-item and ticket status, true progress and true schedule pressure per assembly per week | Simulation |
| 5 | Orders | All vendors (~1,900–3,100); the 400–550 Xometry CNC orders in full | Simulation |
| 6 | Events | The timeline everything is rendered from: **crumbs** tied to orders, and far more **background** (engineering trade-offs, test results, off-topic) | Simulation |

**Time layout:** month 0–1 is lead-in (context only); months 1–7 are training orders; months 7–9 are held back for grading; the demo order sits on 2026-11-10 with its own last 30 days of context.

### Schema checklist

Phase 0 defines every field below. Every entity has a stable `id`; every reference uses ids; every time is ISO 8601 with its Pacific offset. **Every fact that changes keeps its history with two times:** what it says is true (`effective`) and when it was said (`known_at`).

| Entity | Fields beyond id and name |
|---|---|
| `meta` | Schema version, seed, time zone, window start and end, demo "now", train and test boundaries, holidays, business hours |
| `teams` | Lead, members, Slack channels, Jira project |
| `people` | Title, team, manager, email, Slack id, Jira account id, Ramp user id and card ids, start (and end) date, out-of-office periods, whether and how heavily they place orders, ordering habit (over-expedites, always Standard, …), writing style (case, punctuation, typos, emoji, length, hedging), chattiness, lurker flag, topics they are the authority on |
| `assemblies` | Owner, team, working state, revision history, Jira project, Slack channel, project code |
| `parts` | Part number, CAD file name, **the names people actually call it** (aliases), the assembly or test rig it belongs to, robot part or test hardware, material, finish, tolerance, process, typical quantity, revisions with dates and reasons |
| `test_rigs`, `resources` | Location, the parts they need, bookings (including conflicts) |
| `tests` | Assembly under test, required inputs (parts, deliverables, work items, a resource), true duration and the estimate people quote, owner, the milestone it gates, planned-date history |
| `deliverables` | Non-CNC inputs such as motors, PCBs and firmware: owner, vendor order if bought, ETA history, true arrival |
| `work_items` | Owner, assembly, true duration and estimate, blocked-by, status history |
| `milestones` | Owner, hard or soft, date history, value policy ($/day, a curve, or none) and who set it, what feeds it |
| `edges` | From, to, kind (requires-all or alternative), and whether the sources reveal it: by which events, only vaguely, or never |
| `storylines` | Team, topic, people, beats over weeks: the engineering background (trade-offs, failures, debates) that crumbs hide inside |
| `channels` | Slack id, purpose, type (public, private, DM), members, bots, base message rate, on-topic share |
| `meeting_series`, `meetings` | Type, cadence, attendees, note-taker style; per meeting: time, who showed up, length, storylines discussed, crumbs carried, calendar event |
| `tickets` | Key, project, type, assembly, linked work item or order, reporter, assignee, labels, created, status history, due-date history, links |
| `vendors` | Category, card descriptor variants, payment method, shipping behaviour |
| `orders` (Xometry CNC) | Quote id, order number, part and revision, quantity, **every tier with price and lead time**, quote time and expiry, requester, placer, approver and approval time, placed-at (T), subtotal, shipping, tax, total, promised date, status timeline, actual delivery, inspection, first use (may be unrecorded), the test and milestone it feeds, the need-by date as believed at T, **link quality** (clean id, alias only, never discussed), cancelled or remade flags, Ramp transaction ids, descriptor, whether a memo and receipt exist |
| `orders` (other vendors) | Vendor, category, short description, amount, time, who, card or bill, Ramp transactions (splits, refunds), linked deliverable or test if any |
| `events` | Time (when it became knowable), where (channel and thread, ticket, meeting, calendar), who, crumb or background, **typed claim** (needs, eta, done, blocked, owner, need-earlier, substitute, duration, stock) with its effective value, the entities it refers to and how (part number, alias, vague), **truth status** (true, stale, wrong), what it corrects or contradicts, pressure conveyed, storyline, order ids |
| `finance` | GL accounts and project codes, Ramp departments, approval rule (manager; auto-approval limit) |
| `demo` | The bracket order: quote tiers, its 30-day context, the motor's ETA and its uncertainty, the spin test, the $/day policy, and the scripted live changes (the motor slips) for cases A, B and D |
| `answers` | Per Xometry order: hidden reason, true need date, true links, true pressure in each time band, **the true outcome of every tier** (days gained), whether expediting helped, which crumbs exist and where, what was never revealed. Per assembly per week: true progress |

**Derived, never stored twice:** tickets open and done per assembly per week (from `tickets`); the progress ranking (from tickets and true progress); the calendar (from milestones, bookings, meetings and out-of-office).

**Hidden reasons (fixed list):** genuine schedule gain · test-slot cliff · no gain because another input was later · pressure from a manager or a demo date · ordered late · insurance or spare · personal habit · budget squeeze (chose slower) · cheap part, default tier.

### Knobs

All in `fixtures/world/knobs.json`, with defaults set in phase 0 and tuned by Owen:

- the mix of hidden reasons, and the share of expedites that truly gained time
- how common each personal ordering habit is
- the share of graph links that are revealed, only hinted at, or never written down
- the link-quality mix (clean id, alias only, never discussed)
- rates of stale facts, wrong dates later corrected, errors never corrected, and contradictions between sources
- off-topic and background shares per source
- the volume scale

## Volume targets

From the Flintlock numbers in `data-realism.md`.

| Source | Full target |
|---|---|
| People | 60 |
| Xometry CNC orders | 400–550 |
| Other orders | ~1,250–2,200, plus 250–400 SaaS charges |
| Slack | 30–55k messages across the 8–12 purchasing-relevant channels |
| Jira | 250–400 new tickets a month (≈2,300–3,600) |
| Recorded meetings | 450–700, plus 2–3 gate reviews |
| Calendar | Milestones, bookings, out-of-office, recurring meetings |

The truth is generated at full volume, because code produces it for free. The written context is the expensive part: at full volume it is roughly 2.5–3 million tokens of model output. It is written in priority order (below) at whatever scale the time and usage allow.

## How the context generator works

Three steps, so code owns the facts and agents own the wording. Code lives in `scripts/generate-world/`.

1. **`plan`** (code, seeded). Reads `world.json` and writes every record with all fields, IDs and timestamps filled and the text left blank. It also writes **text jobs** to `fixtures/world/jobs/`: one file per Slack channel-week, per batch of tickets, per meeting. Each job carries the events to express, the people and their style, and the style rules for that source.
2. **`write`** (Fable agents). Each agent fills in the text of one job. Jobs are independent, so they run in parallel.
3. **`assemble`** (code). Merges the text into the final files in each source's real format, then runs the checks.

`--scale 0.1` plans a tenth of the volume, so the whole path can be run and checked in minutes before the full run.

No API credential is set up on this machine (no key in the environment, no `.env`), so step 2 is done by Claude Code agents on the plan's usage. With an API key, a script could fill the same jobs.

## Phases

Phase 2 runs alongside phase 1: both code against the schema, not against the data.

| Phase | What | Agents | Effort | Time |
|---|---|---|---|---|
| 0. Schema | Field reference, canonical ids (teams, assemblies, test rigs, milestones, channels, Jira projects), a tiny valid example world, the validator, default knobs. Merged at once so the mock services can code against it | 1 | High | 25 min |
| 1a. Seed | People and org · program (assemblies, parts catalog, rigs, tests, milestones, deliverables, demo block) · storylines, channels, meeting series · vendors and finance | 4 in parallel | Medium | 40 min |
| 1b. Simulator | Schedule and slips, tickets, orders with decisions and hidden reasons, deliveries, events with their imperfections, other-vendor orders, the answer key | 1–2 | High | 60 min |
| 2. Generator code | `plan` and `assemble` · Slack · Jira · meetings and calendar · Xometry, Ramp and other-vendor orders | 5 in parallel | Medium | 60 min |
| 3. First run | Run the simulation, validate, run `--scale 0.1` end to end, fix what breaks, hand the small world to Arjun | 1 | High | 30 min |
| 4. Text fill | Fable agents over the job files, in the priority order below | Many, in the background | Low for Slack and tickets; medium for meetings | Until 10:30pm |
| 5. Checks and provenance | Consistency, realism and answer-key checks; the provenance index | 2–3 | Medium | 30 min |

**Checks:**
- **Consistency:** every crumb appears in at least one source; IDs, names and dates match across sources; nothing is dated after the order it informs.
- **Realism:** lengths, tier mix, cadence and empty-field rates fall in the researched ranges; scan for the fake-looking patterns.
- **Answer key:** hidden reasons never appear word for word in generated text; every Xometry order is covered.

**Provenance index:** maps each event id to the records it produced, for the "click a charge, see where it came from" trail.

## Order of text generation

So that something complete exists at every point:

1. The demo order and its 30 days of context.
2. The Xometry CNC orders and their crumbs. This is the training set.
3. Background volume up to the full targets: off-topic Slack, meetings unrelated to orders, tickets with no order behind them.

The text fill stops at 10:30pm, whatever volume it has reached. The checks report the volume actually generated.

## Tonight

| By | Done |
|---|---|
| 6:35pm | Schema merged; mock services start against it |
| 7:45pm | Seed, simulator and generator code done |
| 8:15pm | World generated and validated; small run passes end to end; small world handed to Arjun |
| 8:15–10:30pm | Text fill in the background; cost of delay with Arjun in parallel |
| 10:30pm | Text fill stops; assemble, checks, provenance |
| 11:00pm | Final fixtures merged |
| 11:30pm | Submit |

## Hand-offs

- **Arjun (mock services):** the schema and source file formats after phase 0; the small world after phase 3; the final fixtures at 11:00pm.
- **Cost of delay (Owen and Arjun):** needs milestones with owners and $/day policies, tests, the dependency graph and the Xometry tiers. The seed has them after phase 1a; the full world after phase 3.
- **Training (unassigned):** reads the rendered sources, `fixtures/ramp/` and `fixtures/xometry/`; graded against `answers.json`.
