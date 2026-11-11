# Build plan: world model and generator

Owner: Owen, with Fable agents. Deadline: 2026-11-10, 11:59pm PT. Spec: [`../architecture.md`](../architecture.md) §12. Realism rules and volumes: [`../research/data-realism.md`](../research/data-realism.md).

**Company:** Flintlock Robotics, a fictional humanoid robotics startup of ~60 people in California (Pacific time), ordering from Xometry's US site, at a stage of its robot generation heavy in custom CNC parts. The order history covers **all** purchasing across vendors (fasteners, electronics, PCBs, motors, tools, raw stock, other custom parts) so the context is realistic. Burn acts only on custom CNC orders on Xometry, and the demo uses those.

**Test hardware and dependency chains:** Flintlock does not have a complete humanoid. Only parts of it work (a leg, a hip actuator, a hand), and much of the work is testing those pieces on their own. So a large share of the custom CNC parts are **test infrastructure** rather than robot parts: fixture hooks and lift hooks that hold a leg in the air, test stands, jigs, dyno and spin-test adapters, mounting plates. This is where dependency chains come from: *before the leg drop test can run, the machined hook that suspends the leg must arrive*; the test also needs the leg itself, the stand and a booked bench.

**Demo order:** the hip-actuator bracket for the spin test, which also waits on the motor (the worked example in the architecture). Fixture hooks and the other test hardware are among the past orders.

## Rules for every agent

- **The world model is the single source of truth.** Code decides facts, IDs and timestamps. Models only write text.
- **Model: Fable** for most work, including the text.
- **Read the style research first:** [`../research/data-realism.md`](../research/data-realism.md) (formats, Flintlock volumes, style numbers, fake-looking patterns) and, for orders, [`../research/startup-purchasing.md`](../research/startup-purchasing.md). Every agent's prompt points at the sections for its source, and its output must follow them.
- **The app never reads `fixtures/world/`.** Burn sees only the rendered sources (`fixtures/slack/`, `fixtures/jira/`, …). The world model and answer key are for the generator and for grading.

## What the world model holds

`fixtures/world/world.json`, built in this order because each layer needs the one before:

| # | Layer | Contents |
|---|---|---|
| 1 | Company | 60 people in the researched org split: name, role, team, manager, Slack id, how chatty they are, whether they place orders |
| 2 | Program | The partly working robot: assemblies and their owners; the tests on each piece; the test hardware each test needs; benches and chambers; milestones with an owner and a $/day value policy (some have none); a calendar from 2026-02-10 to 2026-11-10 with the builds that cause order bursts |
| 3 | True dependency graph | Every link, part → test or work → milestone, with true dates and durations. The rendered sources reveal only part of it |
| 4 | Progress and pressure timeline | Per assembly per week: tickets open and done, true progress, true schedule pressure. The truth behind the progress ranking and the pressure read |
| 5 | Orders | All vendors (~1,900–3,100). The 400–550 Xometry CNC orders in full: part, quantity, material, every tier and price, tier chosen, placed-at, who, the test and milestone it feeds, the hidden reason. Other vendors as light records: vendor, category, amount, date, who, payment method |
| 6 | Events | The timeline everything is rendered from. **Crumbs** tied to orders (a need-by date, a sibling part slipping, a test moved, a material switch, stock found on a shelf) and **background** (engineering trade-offs, test results, off-topic), each with a time, a source and people. Background far outnumbers crumbs |

`fixtures/world/answers.json` is the grading extract: per Xometry order, the hidden reason, the true need date, the true links, the true pressure, and whether expediting helped.

**Time layout:** month 0–1 is lead-in (context only); months 1–7 are training orders; months 7–9 are held back for grading; the demo order sits on 2026-11-10 with its own last 30 days of context.

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

## How the generator works

Three steps, so code owns the facts and agents own the wording. Code lives in `scripts/generate-world/`.

1. **`plan`** (code, seeded). Reads `world.json` and writes every record with all fields, IDs and timestamps filled and the text left blank. It also writes **text jobs** to `fixtures/world/jobs/`: one file per Slack channel-week, per batch of tickets, per meeting. Each job carries the events to express, the people and their style, and the style rules for that source.
2. **`write`** (Fable agents). Each agent fills in the text of one job. Jobs are independent, so they run in parallel.
3. **`assemble`** (code). Merges the text into the final files in each source's real format, then runs the checks.

`--scale 0.1` plans a tenth of the volume, so the whole path can be run and checked in minutes before the full run.

No API credential is set up on this machine (no key in the environment, no `.env`), so step 2 is done by Claude Code agents on the plan's usage. With an API key, a script could fill the same jobs.

## Phases

| Phase | What | Agents | Time |
|---|---|---|---|
| 0. Schema | Structure of `world.json`, `answers.json` and the job files, with one tiny filled example. Merged at once so the mock services can code against it | 1 | 20 min |
| 1. World | A: company, program, true graph, progress and pressure timeline. B: orders, all vendors. C: events (crumbs and background) | 1–3, in sequence | 45–60 min |
| 2. Generator code | `plan` and `assemble`; formatters for Slack, Jira, meetings and calendar; formatters for Xometry, Ramp and other-vendor orders | 5 in parallel, one module each | 45–60 min |
| 3. Small run | `--scale 0.1` end to end; fix what breaks; hand the small world to Arjun | 1 | 30 min |
| 4. Full text fill | Fable agents over the job files, in the priority order below | Many, in the background | 1.5–2 h |
| 5. Checks and provenance | Consistency, realism and answer-key checks; the provenance index | 2–3 | 30 min |

**Checks:**
- **Consistency:** every crumb appears in at least one source; IDs, names and dates match across sources; nothing is dated after the order it informs.
- **Realism:** lengths, tier mix, cadence and empty-field rates fall in the researched ranges; scan for the fake-looking patterns.
- **Answer key:** hidden reasons never appear word for word in generated text; every Xometry order is covered.

**Provenance index:** maps each event id to the records it produced, for the "click a charge, see where it came from" trail.

## Order of text generation

So that something complete exists at every point:

1. The demo order and its 30 days of context.
2. The Xometry CNC orders and their crumbs. This is the training set.
3. Background volume up to the full targets: other-vendor orders, off-topic Slack, meetings unrelated to orders.

The text fill stops at a fixed time, whatever volume it has reached. The checks report the volume actually generated.

## Tonight

| By | Done |
|---|---|
| 6:30pm | Schema merged; mock services start against it |
| 7:30pm | World merged: people, program, graph, orders, events |
| 8:30pm | Generator code merged; small run passes end to end; small world handed to Arjun |
| 8:30–10:30pm | Full text fill in the background; cost of delay with Arjun in parallel |
| 10:30pm | Text fill stops; assemble, checks, provenance |
| 11:00pm | Final fixtures merged |
| 11:30pm | Submit |

## Hand-offs

- **Arjun (mock services):** the schema and source file formats after phase 0; the small world after phase 3; the final fixtures at 11:00pm.
- **Cost of delay (Owen and Arjun):** needs milestones with owners and $/day policies, tests, the dependency graph and the Xometry tiers. All exist after phase 1.
- **Training (unassigned):** reads the rendered sources, `fixtures/ramp/` and `fixtures/xometry/`; graded against `answers.json`.
