# Build plan: world script and generator

Owner: Owen. Spec: [`../architecture.md`](../architecture.md) §12; realism rules: [`../research/data-realism.md`](../research/data-realism.md).

**Company:** Flintlock Robotics, fictional humanoid robotics startup, ~60 people, in California (Pacific time), ordering from Xometry's US site, at a stage of its robot generation heavy in custom CNC parts. The order history covers **all** purchasing across vendors (fasteners, electronics, PCBs, motors, tools, raw stock, other custom parts) so the context is realistic; Burn acts only on custom CNC orders on Xometry, and the demo uses those.

**Principle:** the world script is the single source of truth. Code decides facts and timestamps; LLMs only write text.

**Rules for every agent (Owen's decisions):**
- **Model: Fable** for most work (schema, world, orders, stories, renderers, checks), including the text the generator writes.
- **Read the style research first:** [`../research/data-realism.md`](../research/data-realism.md) (formats, style numbers, fake-looking patterns) and, for orders, [`../research/startup-purchasing.md`](../research/startup-purchasing.md). Every agent's prompt points at the sections for its source, and its output must follow them.

**Test hardware and dependency chains** (Owen's decision): Flintlock does not have a complete humanoid. Only parts of it work (e.g. a leg, a hip actuator, a hand), and much of the work is testing those pieces on their own. So a large share of the custom CNC parts are **test infrastructure** rather than robot parts: fixture hooks and lift hooks that hold a leg in the air, test stands, jigs, dyno and spin-test adapters, mounting plates. This is where dependency chains come from: *before the leg drop test can run, the machined hook that suspends the leg must arrive*; the test also needs the leg itself, the stand and a booked bench.

## Phase 0: schema (one agent, ~15 min, first)
Writes the structure of `fixtures/world/world.json` and `fixtures/world/answers.json` with one small filled example:
- `company`; `people[]` (id, name, role, assembly, Slack id, chattiness)
- `assemblies[]` (hip, knee, ankle, hand, torso, …); `milestones[]`; `tests[]`; `resources[]` (spin chamber, CMM, …)
- `orders[]` (custom CNC part, qty, Xometry tiers and prices, tier chosen, placed-at, links to milestone and test)
- `events[]` (the crumbs): id, time, source (Slack / Jira / meeting / calendar), people, the fact carried, order id if any
- `answers.json`: per order, the hidden reason, true dates, whether expediting helped

## Phase 1: build the world (sequential, ~45 min)
| Agent | Builds | Reads |
|---|---|---|
| A. Company and program | ~60 people and roles, assemblies (only partly working: a leg, a hip actuator, a hand…), tests on those pieces and the test hardware each needs, milestones on a 9-month calendar ending on demo day, tests, resources, recurring meetings | schema |
| B. Order planner | Past orders across all vendors at realistic volume; the Xometry custom CNC orders (many are test infrastructure: fixture hooks, lift hooks, stands, jigs, adapters) follow the researched cadence (bursts before builds), catalog parts, prices and tiers in range, tier chosen and hidden reason; plus the bracket demo order | A, data-realism.md |
| C. Story planner | Per order, the crumbs (need-by, sibling slip, test moved, material switch) with time and source; background events (engineering trade-offs, off-topic) outnumber crumbs | A, B |

## Phase 2: render each source (parallel, ~1.5 h)
One agent per source; each writes a module in `scripts/generate-world/` that reads the world script and writes the source in its real format.

| Agent | Output | Format |
|---|---|---|
| Slack | `fixtures/slack/` | Slack API message JSON: threads, reactions, bots |
| Jira | `fixtures/jira/` | Jira REST JSON: changelog, slipped due dates, stale tickets |
| Meetings | `fixtures/meetings/` | Fireflies-style Markdown: supply chain, supply chain + mech eng, program reviews, design reviews, vendor calls, others |
| Calendar | `fixtures/calendar.ics` | `.ics`: milestones, bookings, out-of-office, recurring meetings |
| Xometry | `fixtures/xometry/` | JSON: quotes, tiers, order status |
| Ramp | `fixtures/ramp/` | Ramp transaction JSON with messy descriptors |

Text renderers (Slack, Jira, Meetings) call Fable for wording, following the style rules for their source in data-realism.md; the rest is plain code.

## Phase 3: checks (parallel, ~30 min)
- **Consistency:** every crumb appears in at least one source; IDs, names, dates match; nothing dated after the order it informs.
- **Realism:** lengths, tier mix, cadence and empty-field rates within researched ranges; scan for fake-looking patterns.
- **Answer key:** hidden reasons never appear verbatim in generated text; every order covered.

## Phase 4: provenance index (~20 min)
Maps each event id to the records it produced, for the "click a charge, see where it came from" trail.
