# Simulation spec: the Flintlock world model

Companion to [`world-script-plan.md`](world-script-plan.md) (what and when) and `fixtures/world/SCHEMA.md` (field names). This file decides **how the truth is simulated, what every module must do, and what the checks enforce**. Where a field name differs from `SCHEMA.md`, the schema wins on naming and this spec wins on meaning; §6 lists what must exist. Numbers marked (R) come from [`../research/data-realism.md`](../research/data-realism.md); the rest are defaults chosen here and exposed as knobs (`knobs.json`, written `k.<name>`).

## 0. Conventions

1. **Window.** Week `w` is Monday-based; `w0` starts Mon 2026-02-09; demo "now" is Tue 2026-11-10 09:00 PT (39 full weeks plus two days). All from `meta`.
2. **Working day (wd).** Mon–Fri minus closed holidays. All lead times, lags and slips are in wd unless they say hours. `addWd`, `wdBetween` live in `lib/calendar.mjs` and nowhere else.
3. **Horizon.** The simulation runs to `now + 45 wd` so every order has a true outcome. Any fact with `known_at > now` is truth only: it is written to `world.json` with `future: true`, used by `answers`, and never rendered.
4. **Truth versus announcement.** Every dated thing has (a) one true value (what actually happened or will happen) and (b) an **announcement history** `[{value, known_at, by, event_id}]` (what people said). Belief at time `t` = last announcement with `known_at ≤ t`. People decide on beliefs; outcomes are computed on truth.
5. **Pinned.** Any seed record or history entry with `pinned: true` (the whole `demo` block, its motor, its spin test, its quote) is copied verbatim. The simulator never draws over it and never generates an order for the demo part in the last 6 weeks.
6. **Origin.** Every simulated entity carries `origin: "seed" | "sim"`.

## 1. Simulation design

Stages S1, S3, S4a are pre-computed. S2 and S6–S10 run inside **one forward day loop** (`sim/loop.mjs`): for each wd `d` from window start to horizon, in this fixed order: (1) apply truth changes scheduled for `d`; (2) owners announce what they have discovered; (3) fire demands whose trigger ≤ `d` → quote → decide → approve → place; (4) deliveries and inspections due on `d`; (5) start tests and work items whose inputs are all ready, finish those due, achieve milestones. Causality holds by construction: a decision on day `d` can only read announcements with `known_at ≤ d`. S5, S9, S11–S13 run after the loop.

### S1. Working calendar — `lib/calendar.mjs`
- **In:** `meta`. **Out:** pure functions; `meta.weeks[]` = `{w, start, activity, kind: normal|burst|quiet}`.
- **Time zone:** offset is `-08:00` before 2026-03-08 02:00 and from 2026-11-01 02:00, else `-07:00`. Hard-coded from `meta.dst`; never `Intl` or the host time zone.
- **Holidays (R):** closed: Memorial Day 25 May, Fri 3 Jul, Labor Day 7 Sep. Half activity: Presidents' Day 16 Feb, Juneteenth 19 Jun. Thu/Fri before a closed day: order rate ×1.4.
- **Week activity:** quiet (×0.4): the 3 Jul week and the week after each build milestone. Burst: the 3 weeks before each build milestone's believed date. Else ×1.0.
- **Hour shape (human activity, share of a day):** before 08:00 2% · 08–09 5% · 09–12 34% · 12–13 7% · 13–17 36% · 17–18:30 10% · 18:30–20 3% · 20–23 3% (6% in burst weeks) · none 00:30–06:00. Weekend 2% of a week's volume. Seconds are random; no two human timestamps in one channel share a second.
- **Order weekdays:** Mon 19, Tue 21, Wed 20, Thu 22, Fri 17, weekend 1 (%).

### S2. Program plan and slips — `sim/program.mjs`
- **In:** seed tests, milestones, edges, resources. **Out:** true start/end per test, true achieved date per milestone, announcement histories, `slips[]`.
- **Seed requirement:** ≥2 build milestones; one with its initial date in w13–w15 (EVT) and one in w35–w37 (DVT actuator build), so one burst falls in the last 13 weeks.
- **True schedule (the solver, `sim/solve.mjs`):** test start = first free slot of its resource ≥ max(the test's `earliest_start`; true ready of every `requires-all` input; earliest of an `alternative` group), on a wd when the owner is not out. `earliest_start` = the seed planned date (earlier only if pulled in; for a re-run, when the fix is done), so an early part never starts a test early on its own; test end = start + true duration; milestone achieved = max(end of everything that feeds it). `hard` milestones keep their date (scope is cut instead); `soft` ones move. A resource has a slot grid (e.g. spin chamber Tue/Fri), capacity 1.
- **Slip record:** `{entity, cause, delta_wd, occurs_at, discovered_at, announced_at|null, by, venue}`. `occurs_at` is when truth changed (an input's truth moved, a test failed, a booking was lost). `cause ∈ input_late | overrun | test_failed | resource_conflict | pulled_in | scope`.
- **Discovery lag:** vendor-driven 0–2 wd; internal 0–3 wd; 10% only when the date arrives.
- **Announcement lag after discovery:** 0 wd 35% · 1 wd 30% · 2–3 wd 20% · 4–7 wd 10% · never (lapses silently, `announced_at: null`) 5%.
- **Who / where:** test owner 70%, TPM 20%, manager 10%. Venue: subsystem Slack channel 45% · program review 25% · Jira due-date edit only 10% · calendar move only 8% · nowhere 12%. Soft-milestone moves are announced only by the TPM at the next program review.
- **Optimism:** the announced new date = true forecast − `U(0, 0.4)·delta` (rounded to a wd), so 35% of slips need a second announcement ("moved twice").
- **Test outcomes:** pass 70%, fail 22% (adds a re-run after a fix work item of 2–8 wd, and with 60% a part revision → new demand), inconclusive 8% (re-run, no fix).
- **Targets:** 45% of tests slip ≥ once, median 4 wd; 10% are pulled in (emits a `need_earlier` truth change); each soft milestone has 1–3 history entries.
- **Knobs:** `k.slip.announce_lag`, `k.slip.venue_mix`, `k.slip.optimism_max`, `k.test.fail_rate`, `k.test.pull_in_rate`.

### S3. Deliverables — `sim/deliverables.mjs`
- **In:** seed deliverables. **Out:** true arrival, ETA announcement history, slips, one linked other-vendor order when bought.

| Kind | Lead (R) | P(slip) | Slip size (wd), count | Early |
|---|---|---|---|---|
| Motors, gearing, sensors | 2–12 wk | 0.45 | lognormal median 6, cap 25; 1–3 slips | 5% |
| PCB / PCBA | 1–3 wk | 0.35 | median 3, cap 12; 1–2 | 8% |
| Firmware and other internal | estimate | 0.50 | estimate × lognormal(median 1.25, σ 0.45) | 10% |

- ETA changes are announced by the buyer (bought) or the owner (internal): `#supply-chain` 45%, supply-chain sync 25%, supply chain + mech 15%, Jira 15%; lag as S2. **Knobs:** `k.deliverable.*`.

### S4. Work items and tickets — `sim/work.mjs`
- **In:** seed work items (those tests require), assemblies, people, milestones. **Out:** `work_items[]`, `tickets[]`.
- **4a Work items.** The simulator adds filler work items per assembly per milestone phase until each assembly has 12–30 per phase. True duration = estimate × lognormal(median 1.25, σ 0.45). One person works their graph-critical items **serially** on their own calendar minus out-of-office (no duplicated person-days). 6% carry `blocked_by` another item or a deliverable; chains of depth 2–3 exist in every phase.
- **4b Tickets.** Volume 300/month (R: 250–400) over 6–8 projects. Mix by cause: work-item tasks 45% · bugs from test results and storylines 15% · procurement (35% of Xometry orders get one, plus major other-vendor buys) 12% · chores and background 28% · one Epic per milestone. Types (R): Task 55%, Bug 15%, Story 20%, Sub-task 10%.
- **Lifecycle (R unless noted):** ticket status follows the work item with lag: start 0–3 wd; close 0 wd 50% · 1–3 wd 25% · 4–10 wd 13% · never closed (stale) 12%. Median 6 days to close. ~10% of open tickets Blocked. Due date on 30%; 30% of those edited (+5–10 wd, as a changelog entry with a real `known_at`); 8% past due and open. Links: blocks 15%, relates 10%. Comments: 0 on 45%, 1–3 on 40%, 4+ on 15%. Description: empty 35%, short 40%, medium 15%, long 10%. Labels 40%, components 12%, assignee 85% of non-backlog. 15% of open tickets untouched 30+ days.
- **Derived, not stored:** tickets done per assembly per week = tickets of that assembly with status Done at the week's end, from `status_history`.
- **Knobs:** `k.ticket.per_month`, `k.ticket.close_lag`, `k.ticket.stale_rate`, `k.ticket.due_edit_rate`.

### S5. True progress and pressure — `sim/progress.mjs` (after the loop)
- **Progress** per assembly `a`, milestone `m`, week `w`: true effort completed ÷ total true effort of `a`'s work items toward `m`, at Friday 18:30. `true_rank` = position among assemblies feeding `m` (1 = furthest behind). It differs from the ticket share because tickets close late (S4) and 60% of completions are said in conversation (`done` crumb) before the ticket closes.
- **True pressure** per assembly per wd, in [0,1]: start from true slack to its next milestone (announced milestone date − true forecast finish): ≥10 wd → 0.10 · 5–9 → 0.30 · 0–4 → 0.55 · negative → 0.80; +0.15 if the milestone is ≤15 wd away; +0.20 inside a `pressure_window` (seed or sim: 3–5 exec pushes of 1–2 weeks: investor visit, board demo); clamp. Levels: <0.35 low, <0.65 elevated, else high.
- **Expressed pressure** = true + team `expressiveness` (seed, −0.25…+0.25; one loud team, one stoic team) + N(0, 0.12). This is what crumbs convey; the gap from truth is deliberate (§2).
- **Knobs:** `k.pressure.window_boost`, `k.pressure.noise_sd`.

### S6. Demand — `sim/demand.mjs`
- **Out:** `demands[]`: `{id, kind, part, revision, qty, assembly, requester, feeds (test|work_item|milestone|null), believed_need_by, trigger_at, hidden_earlier_need}`; each becomes exactly one order line. An order groups 1–6 demands of one requester and one `feeds` (lines: 1 38% · 2 30% · 3 15% · 4 9% · 5 5% · 6 3%; median 2 (R)).

| Kind | Share of orders | Feeds | Need-by |
|---|---|---|---|
| `test_hardware` (hooks, stands, jigs, adapters) | 30% | part → test | believed test start − 2 wd |
| `build_part` (robot parts for a build) | 25% | part → build milestone | believed build start − 5 wd |
| `iteration` (fit checks, design exploration) | 27% | part → work item | work item's believed start |
| `spare` (insurance, top-up, replacement) | 6% | same as the original, or null | none or soft |
| `rig_misc` | 12% | null | none |

1. **Structural demands** come from the graph: every CNC part a test or build requires gets a demand; a failed test or a rejected inspection adds a `revision` or `remake` demand.
2. **Filler demands** bring each week to its target so volume never depends on the seed's size: target `λ(w) = k.orders.per_week (11) × activity(w) × (k.orders.burst_mult (2.3) in burst weeks)`; filler count = `max(0, Poisson(λ) − structural(w))`. Filler picks an assembly (weighted by headcount and phase) and a part of that assembly; a part already ordered gets a new revision with p = 0.55, tuned to **revision share 30–40%** (R).
3. **Trigger:** `trigger_at = believed_need_by − std lead − offset`, offset by requester: early (5–15 wd spare) 40% · on time (0–4 wd) 52% · late (−1 to −6 wd, stored as `late_by_choice`) 8%, ×1.8 in burst weeks, ×2.5 for a `procrastinator`. Never before the revision's `released_at` + 0–2 wd: a late design release, a failed test or a pulled-in date makes an order urgent without it being the requester's fault (rule 6, not rule 4). Buyer-placed orders add the buyer's queue delay (0–2 wd; the batching buyer places Tue/Thu).
4. **Hidden earlier need:** 3% of demands have a true need earlier than anything written down (`hidden_earlier_need`); the context shows slack and the requester still expedites (acceptance scenario 12).
- **Targets (R):** 400–550 orders; baseline weeks 8–14; burst weeks 20–30; quiet weeks 3–5; 16–22 distinct requesters; the two buyers place ~40%; 3–4 engineers request 30%.
- **Knobs:** `k.orders.per_week`, `k.orders.burst_mult`, `k.orders.quiet_mult`, `k.orders.kind_mix`, `k.orders.new_rev_rate`, `k.orders.late_rate`, `k.orders.hidden_need_rate`.

### S7. Quotes — `sim/quotes.mjs`
1. Each part revision has a fixed `unit_price_q1` (log-uniform in its category's Standard range (R), ÷ typical qty^0.78); unit price at qty `q` = `unit_price_q1 × q^−0.22` × re-quote noise ±3%. Cents are never `.00`.
2. **Tiers are order-level** (R). Standard = sum of lines. Economy = Standard × (1 − U(0.10, 0.20)). Expedite = Standard × (1 + premium), premium from the category range (R, +30–100%), ×1.3 when the lot is under $300.
3. **Lead (wd, max over lines, R):** Expedite 3–5 · Standard 7–10 · Economy 10–15, from the category row; never the same triple on two consecutive orders of different parts.
4. **Shipping:** free ground on Standard and Economy; Expedite $18–95. **Tax:** `k.quote.tax_rate` = 9.375% on parts, shipping untaxed. Transit 1–5 wd ground, 1–2 wd Expedite; orders after 12:00 PT start the next wd.
5. `quoted_at` = decision time − U(10 min, 3 wd); `valid_until` = `quoted_at` + 30 days. Quote ids and order numbers increase with time with random gaps.
- **Targets (R):** median order $600–900; top 1% $8–15k; total $400–700k. Tune with `k.quote.price_scale`.

### S8. The decision — `sim/decide.mjs`
- **Who:** `requester` (needs the part), `placer` (buyer on ~40% of orders, else the requester), `approver`. `tier_decided_by` = requester, except 20% of buyer-placed orders where the buyer picks.
- **Belief snapshot at `requested_at`** (stored): believed need-by; believed ready date of every other input of `feeds`; believed gain per tier = the solver run on beliefs. Two distortions: with p = `k.belief.stale_rate` (0.15) the decider missed any announcement younger than 2 wd; with p = 1 − person `checks_dependencies` (seed, 0.3–0.95) the decider ignores other inputs entirely.
- **Rules, first that fires wins; it sets the tier and the hidden reason:**

| # | Fires when | Tier (Exp/Std/Econ %) | Hidden reason |
|---|---|---|---|
| 1 | demand kind is `spare` | 5 / 45 / 50 | insurance or spare |
| 2 | decider has a habit, p = `habit_strength` (0.30) | over-expediter → Exp; always-Standard → Std; frugal → Econ | personal habit |
| 3 | inside a `budget_window` (month-end and two freezes) or frugal approver, p = `k.budget.fire` (0.3) | 0 / 35 / 65 | budget squeeze (chose slower) |
| 4 | Standard cannot reach the believed need-by and the demand is `late_by_choice` | 80 / 20 / 0 | ordered late |
| 5 | p = `k.decide.pressure_factor` (0.5) × true pressure when level is high or in a `pressure_window` | 90 / 10 / 0 | pressure from a manager or a demo date |
| 6 | believed gain(Exp vs Std) ≥ 1 wd and extra cost ÷ believed gain ≤ willingness × lognormal(1, 0.5) | Exp | by truth: true gain ≥ slot gap on a slotted resource → test-slot cliff; true gain > 0 → genuine schedule gain; true gain = 0 → no gain because another input was later |
| 6b | believed slack < Economy lead, Standard fits | Std | genuine schedule gain if true, else cheap part, default tier |
| 7 | otherwise | 2 / 82 / 16 (Economy 30% when believed slack > 15 wd) | cheap part, default tier |

- Willingness ($/day): the milestone's policy if the decider `checks_dependencies` and a policy exists, else the person's `wtp_per_day` (lognormal, median $350, σ 0.6).
- With p = `k.decide.noise` (0.05) rule 6 is skipped.
- **Targets:** Exp/Std/Econ 26/55/19 (R: 20–30/50–60/15–20); Expedite 40–50% in burst weeks; reasons about: default 45–50%, genuine gain 9–13%, habit 10–13%, budget 6–8%, no gain 4–6%, late 4–6%, spare 5–7%, pressure 3–5%, cliff 2–3%. Of all expedites, 45–60% truly gained time.

### S9. Counterfactual outcomes — `sim/solve.mjs` (after the loop)
1. At quote time, pre-draw the fulfilment of **all three tiers** from one shared uniform (common random numbers): `ready(o, k)` = placed ⊕ lead_k ⊕ transit_k ⊕ lateness_k ⊕ inspection lag.
2. `S(o, k)`, `M(o, k)` = test start and milestone date from the solver on the **true graph with every other input at its realized truth** and this order's parts ready at `ready(o, k)`. Only the affected test and what is downstream of it are re-solved; other tests keep their realized slots.
3. `days_gained[k] = wd(M(o, k), M(o, Economy))` ≥ 0 (and the same on `S`). `expedite_helped = M(o, Exp) < M(o, Std)`. `break_even_per_day = (total_Exp − total_Std) ÷ gain`, null when gain is 0. `dominating_input` = the latest other input when gain is 0.
4. `true_need_date(o)` = `S` with this order's parts ready at −∞. `true_slack[k] = wd(ready(o, k), true_need_date)`.
5. `feeds: null` → all gains 0. A rejected lot is rejected in every tier; its `ready` adds the same remake delay to every tier.
6. **Self-check:** the solver with no overrides reproduces every realized test and milestone date exactly.

### S10. Approval, delivery, inspection, first use — `sim/fulfil.mjs`
- **Approval:** auto under `finance.auto_approval_limit` ($500); else the manager: lognormal, median 2.5 business hours; 10% next wd; 3% 2+ wd (approver out → delegate). `placed_at` (T) = approval + 2–40 min. Ramp `user_transaction_time` = T + 0–3 min; settlement +1–3 days.
- **Status timeline:** placed → DFM review (6% "action required", +1–3 wd) → in production → quality inspection → shipped → delivered. 2% cancelled before production (refund).
- **Lateness vs promise:** 1–2 wd early 15% · on time 63% · 1–2 wd late 13% · 3–6 wd late 6% · 7–15 wd late 2%; Expedite late rates ×1.2.
- **Inspection:** recorded on 60%; pass 94% · use-as-is 2% · reject 4% (→ `remake` demand next wd; the new order carries `remake_of`). `ready_at` = inspection time, or delivery + 0–1 wd when unrecorded.
- **First use** = when the consumer starts, ≥ `ready_at`; `recorded_at` set on 55%, else null.

### S11. Other-vendor orders — `sim/other-orders.mjs`
- Per category per week: Poisson(mid-range rate (R) × activity); amount lognormal on the category median, capped at its tail; who orders, payment method and descriptor variant from the research tables. 10–15% of orders are bills, not card transactions.
- Mess (R): Amazon splits into 1–3 charges that sum to the order; refunds 3% Amazon, 1% elsewhere; same-day duplicates 1.5% (McMaster, Digi-Key); backorder second charges on 5% of Digi-Key; missing memo 15–30% (Amazon, Home Depot 35%), missing receipt 10–20%. SaaS: 30 subscriptions on a fixed day each month.
- Each bought deliverable has one order here, placed its lead time before its first ETA. **Totals:** 1,250–2,200 plus 250–400 SaaS charges.

### S12. Events — `sim/events.mjs`
An event is one thing said or recorded at `known_at`. **Crumbs** state a typed claim about the truth; **background** events are storyline beats.

**From truth change to crumbs** (delay is after `discovered_at`, or after the order event):

| Truth change | P(crumb) | Where (weights) | Delay | Claim |
|---|---|---|---|---|
| Need for a part identified | by link quality | subsystem Slack 50, Jira 25, meeting 15, DM 10 | spread from `need_identified_at` to T | needs |
| Quote obtained | 45% (clean), 20% (alias) | `#procurement` / `#hw-purchasing` 60, Jira comment 40 | 5 min–1 wd | needs (price, lead, quote id) |
| Order placed | 35% | Slack 50, Jira 50 | after T | eta |
| Promise changed or late | 60% | `#supply-chain` 50, supply-chain sync 30, Jira 20 | 0–2 wd | eta |
| Delivered / inspected / rejected | 50% / 30% / 90% | Slack 70, Jira 30 (reject always opens a Bug) | 0–1 wd | stock, done, blocked |
| First use | 55% | Slack 50, Jira 30, meeting 20 | 0–2 wd | done |
| Deliverable ETA, test date, milestone date | S2, S3 | S2, S3 | S2 | eta, need_earlier |
| Work item done / blocked | 60% / 70% | standup or Slack 60, Jira 40 | −2 to +1 wd around the ticket change | done, blocked |
| Revision released, material switch | 80% | `#mech` or subsystem 60, design review 40 | 0–2 wd | substitute, needs |
| Booking made, moved, double-booked | 50% + calendar always | Slack 40, calendar 100 | 0–1 wd | duration, blocked |
| Owner changed | 40% | Slack, Jira assignee | 0–3 wd | owner |

1. **Link quality per order** (`k.link_quality`): clean id 45% (≥1 pre-T crumb carries the quote id, order number or part number) · alias only 33% · never discussed 22% (zero pre-T crumbs; at most a Ramp memo). Pre-T crumbs: clean 2–9 (median 4), alias 1–6 (median 3). `need_identified_at` = T − lognormal(median 4 wd, cap 30 days); crumb density rises towards T for urgent orders and is flat otherwise.
2. **Reference style per crumb:** part number or id 25% · alias 50% · vague ("the bracket") 25%; alias-only orders never get an id. 4% of alias crumbs use an alias shared with a sibling part (`ambiguous_with`).
3. **Truth status** (`k.crumb.*`): true 82% · stale 8% (someone repeats the previous value after the change) · wrong 7% (date off by 1–3 wd or a misheard number; 5% corrected within 5 min–2 wd by an event with `corrects`, 2% never) · contradiction 3% (a second source states a conflicting value within 3 wd, linked by `contradicts`). Each crumb stores the **stated value** and the **true value at `known_at`** separately.
4. **Dependency links** (`k.edge.reveal`): revealed 55% (≥1 `needs` or `blocked` crumb names both ends resolvably) · vague 25% (crumbs exist, one end by vague reference only) · never 20% (no event). 80% of revealed links are revealed before the first order that feeds them.
5. **Pressure conveyed** (0–3) on each crumb = expressed pressure (S5) of the order's assembly on that day, mixed 60/40 with the order's own urgency; "any update?" follow-up crumbs are added at rate 0.4 × level per day in the last 3 wd.
6. **`order_refs`:** an event is attached to every order that feeds the entity it is about (or whose sibling it is) when `T − 30 d ≤ known_at ≤ T + 60 d`, with `relation: before_T | after_T` computed from the times.
7. **Asking is not deciding.** A pre-T crumb may *ask* about expediting (`asks_expedite`: p = 0.35 when Expedite was chosen, 0.08 otherwise) but never states the chosen tier.
8. **Background.** Each storyline emits 1–3 beats a week while active (trade-off, test result, failure, debate, decision) in its team's channel or meetings. `plan` then adds filler (acks, off-topic, bot posts) to reach channel volume. World events: about 35% crumb, 65% background; among Slack messages, crumb-bearing ≤ 12%.

**Default volumes** (seed `channels` and `meeting_series` override):

| Slack channel | Msgs/wd | On topic | | Meeting series | Per week | Recorded | Minutes | Crumbs each |
|---|---|---|---|---|---|---|---|---|
| `#mech` | 70 | 85% | | Supply-chain sync | 1 | 100% | 22–41 | 2–5 |
| 4 subsystem channels | 18 each | 85% | | Supply chain + mech | 1–2 (daily in bursts) | 90% | 14–33 | 1–4 |
| `#supply-chain` | 25 | 90% | | Program review | 1 | 100% | 38–58 | 1–3 |
| `#procurement`, `#hw-purchasing` | 15 | 90% | | Design reviews | 2–4 | 80% | 31–67 | 0–1 |
| `#build-evt` | 10; 60 in burst weeks; 110 in build week | 85% | | Vendor calls | 2–4 | 70% | 17–36 | 0–2 |
| `#test-lab` | 15 | 80% | | Leadership | 1 | 50% | 40–55 | 0–1 |
| `#general`, `#random` | 8, 6 | 40%, 0% | | All-hands | every 2 weeks | 100% | 26–44 | 0–1 |
| `#eng-bots` (bots only) | 12 | n/a | | Standups | 25–35 | 15% | 7–16 | 0–1 |
| DMs (5–8 pairs) | 10 | 70% | | Gate reviews | 2–3 in total | 100% | 70–110 | 3–6 |

Totals: ~245 Slack messages per wd (≈47k over the window; R: 30–55k); 12–18 recorded meetings a week, 55% of them with zero crumbs. Slack shape (R): threads on 30% of top-level posts, 2–6 replies, 2% with 15+; length classes ack (1–2 words) 12% · short (3–15) 58% · medium (15–40) 22% · long 8%; no reaction on 80%; edited 4%; top 20% of people write 60%; lurkers write < 1 message a week.

### S13. Answers extract — `sim/answers.mjs`
Writes `answers.json` from the final state, nothing new drawn. Per Xometry order: hidden reason, rule number, belief snapshot, `true_need_date`, true links (edge ids) and which were revealed before T, per-tier `ready`, `S`, `M`, `days_gained`, `true_slack`, `expedite_helped`, `break_even_per_day`, `dominating_input`, true and expressed pressure per band (0–1, 1–3, 3–7, 7–14, 14–30 days before T: mean over the band), crumb event ids split before and after T, link quality, what was never revealed, `split`. Per assembly per week: true progress, true rank, true pressure and level. Top level: realized mixes and the learnability probe (§2).
**Split:** `split_full` uses `meta` boundaries (lead-in to 2026-03-09, train to 2026-09-07, test after). Because text covers only the last N weeks, `checks` also writes `fixtures/world/coverage.json`: usable orders = T ≥ text start + 14 days (`context_truncated` if < 30); the newest 30% of usable orders by T are the test set.

## 2. Learnability

The label must be predictable from context only in part.

| Noise source | Mechanism | Knob (default) |
|---|---|---|
| Habits | Rule 2 overrides the situation | `k.habit.strength` (0.30; the default for a person's `habit_strength`), habit prevalence (over-expediter 10%, always-Standard 20%, frugal 10%, procrastinator 15% of orderers) |
| Similar situations, different choices | Per-person willingness, per-decision jitter, rule-6 skip | `k.decide.wtp_median` ($350), `k.decide.wtp_sigma` (0.6), `k.decide.noise` (0.05) |
| Beliefs differ from what was written | Stale belief, ignored siblings, hidden earlier need | `k.belief.stale_rate` (0.15), `k.orders.hidden_need_rate` (0.03) |
| Undiscussed orders | No pre-T crumbs | `k.link_quality.never` (0.22) |
| Misleading pressure | Team expressiveness, noise, ambiguous aliases, hot threads about a sibling | `k.pressure.noise_sd` (0.12), ambiguous alias rate (0.04) |
| Invisible causes | Budget windows and approver frugality are never written down | `k.budget.fire` (0.3) |

**Probe (in `checks`, on truth-side proxies of the visible attributes):** a lookup table over cells = visible days-to-need bin (unknown; < Std lead; Std–Econ lead; up to +10 wd; more) × max expressed pressure level in the last 7 days × requester's training-set expedite tercile × burst-week flag; predict the training majority of the cell, backing off to coarser cells when n < 5; score on the held-out orders.

| Measure | Target band |
|---|---|
| Always-Standard baseline | 50–60% |
| Days-to-need rule alone (Expedite iff need-by < Std lead) | ≤ 70% |
| **Probe on visible proxies, all held-out orders** | **66–78%** (clean-id orders 74–85%; never-discussed 52–62%) |
| Expedite recall of the probe | 50–70% |
| Probe with the hidden reason added (sanity) | ≥ 90% |

**Tuning:** probe too high → raise `k.habit.strength`, `k.link_quality.never`, `k.belief.stale_rate` or `k.pressure.noise_sd`. Too low → lower those, or lower `k.decide.noise`. Too many expedites → lower `k.orders.late_rate` or `k.decide.pressure_factor`. Burst expedite share low → raise the burst late multiplier or release build-part revisions closer to the build. Too few true gains among expedites → raise people's `checks_dependencies`. Change one knob at a time; a run takes seconds.

## 3. Module contracts

All under `scripts/generate-world/`, ES modules, no dependencies beyond Node.

| File | Reads | Writes | Flags | Must never |
|---|---|---|---|---|
| `lib/rng.mjs` | — | — | — | Use `Math.random`. Exports `makeRng(seed)` with `.fork(label)`, `.float()`, `.int(a,b)`, `.pick`, `.weighted`, `.lognormal`, `.poisson`, `.shuffle` |
| `lib/calendar.mjs` | `meta` | — | — | Use `Intl`, `toLocale*`, or the host time zone |
| `lib/io.mjs` | — | — | — | Write unsorted output. `writeJson` rounds money to cents and scores to 3 dp, 2-space indent, final newline |
| `validate.mjs` | a world directory | exit code, report | `--world <dir>` | Mutate anything |
| `simulate.mjs` | `seed/`, `knobs.json` | `world.json`, `answers.json` | `--seed <int>` (default `meta.seed`), `--out <dir>` | Take `--weeks` (truth is always the full window); read rendered sources; call a model |
| `sim/*.mjs` (one per stage above, plus `loop.mjs`) | state object, forked rng | return new records | — | Read files, touch another stage's records, read the clock |
| `plan.mjs` | `world.json` only | `planned/<source>.json`, `jobs/<source>/<job>.json` | `--seed`, `--weeks N` (default `k.context.weeks` = 13) | Read `answers.json`; put a hidden field (§4 I20) in a job; invent a fact |
| `render/slack.mjs`, `jira.mjs`, `meetings.mjs`, `calendar.mjs`, `xometry.mjs`, `ramp.mjs` | world slices via `plan(world, ctx)`; planned records plus text via `emit(records, texts)` | return values only | — | Draw facts, ids or times in `emit`; read `answers.json` |
| `assemble.mjs` | `planned/`, `text/` | `fixtures/slack/`, `jira/`, `meetings/`, `calendar.ics`, `xometry/`, `ramp/` | `--weeks N` | Alter any non-text field; accept a slot id it did not plan |
| `checks.mjs` (+ `checks.test.mjs` for `npm test`) | everything | report, `coverage.json`, exit code | `--weeks N`, `--world <dir>` | Fix data |
| `provenance.mjs` | `planned/`, assembled files | `fixtures/world/provenance.json` (event id → `[{source, record id}]`, and the reverse) | `--weeks N` | Be read by the app's Burn-facing code paths other than the provenance view |

**Text contract.**
1. `plan` creates every record with all ids, authors, timestamps, thread structure and structured fields. Text positions are **slots**: `{slot_id, kind: crumb|background|filler, author, length_class, style, fact_tokens[], mention_tokens[], fallback_text}`.
2. A writer returns `text/<source>/<job>.json` = `{slot_id: string}` and nothing else. Meetings: per segment, `[{speaker_id, text}]` with speakers from the attendee list; code assigns sentence times.
3. **Crumb slots** carry `fact_tokens` (the reference exactly as it must appear — part number, alias or vague phrase — and the value phrase, e.g. `thurs the 19th`, `$412.37`, `8 BD`); the text must contain each verbatim. `fallback_text` is a terse code-written sentence, so **a missing or rejected crumb text falls back and the crumb still exists**. Missing background text is dropped (a thread without its parent is dropped whole).
4. **Background and filler slots** must contain no part number, quote id, order number, Jira key not listed in the slot, dollar amount ≥ $50, or explicit date (month-day, `d/m`, weekday + ordinal). Relative time ("last week") is fine. A violating slot is dropped and reported.
5. **Structured sources need no writer.** Xometry, Ramp (memos from code templates) and calendar are rendered for all 39 weeks on every run. `--weeks N` limits only Slack, Jira and meetings: Slack by thread-parent time, meetings by start, Jira by creation week.
6. **Jobs nest.** Job ids are `<source>/<channel|project|series>/<week>/<crumbs|background>`; a job's content depends only on the seed and its week, so `--weeks 1` jobs are byte-identical inside `--weeks 13` and text is never rewritten. Each job has `priority` (demo context 0; then newest week first; crumbs before background).
7. Rendered Xometry quotes show **all three tiers** (price, lead); the order shows the chosen tier. Open orders show status as of `now`.

**Determinism.** (1) One seed; every stage and every entity draws from `rng.fork("<stage>:<id>")`, so adding a draw in one place does not shift another. (2) No `Date.now()`, `new Date()` without an argument, `Math.random`, `process.hrtime`, env or host lookups. (3) Iterate arrays sorted by `(time, id)`; never rely on object key or `Set` insertion order from unsorted input; write arrays sorted by id or by `(time, id)`. (4) Same seed and knobs → byte-identical `world.json`, `answers.json`, `planned/`, `jobs/`. (5) **Runtime:** `simulate` < 5 s; `plan --weeks 13` < 10 s; `assemble` + `checks` < 30 s.

## 4. Invariants and acceptance tests

Invariant *n* is cited as I*n*. `V` = `validate.mjs` (world only), `C` = `checks.mjs` (world, plan, rendered). Statistical checks run on the full window unless stated; with fewer than 8 text weeks, text-shape checks warn instead of failing.

**Integrity**
1. (V) Every id is unique in its collection; every reference resolves; no reference to a `future` record from a non-future one.
2. (V) Every time is ISO 8601 with offset `-08:00` or `-07:00`, and the offset is the correct one for that instant.
3. (V) Every history is sorted by `known_at`, has ≥ 1 entry, and its first `known_at` ≥ the entity's creation.
4. (V) Order sums: line totals = subtotal; tax = round(rate × parts subtotal); total = subtotal + shipping + tax; Ramp transactions of an order sum to its total (refunds net out).
5. (V) Order times: `quoted_at ≤ requested_at ≤ approved_at ≤ placed_at < promised`; status timeline strictly increasing; `delivered ≤ ready_at ≤ first_use`; `placed_at < valid_until`.
6. (V) Economy price < Standard < Expedite and Expedite lead < Standard < Economy on every quote.
7. (V) The true graph is acyclic; every `requires-all` input of a started test was ready at its start; no resource holds two tests in one slot except flagged conflicts; no person has two serial work items on one day.
8. (V) Pinned seed records appear unchanged in `world.json`; no order for the demo part after `now − 30 wd`.

**Causality**
9. (V) Every event's `known_at` ≥ the `occurs_at` (or `discovered_at` where defined) of the truth change it reports. No event states a value that was not yet true or announced by then, unless `truth_status: wrong`.
10. (V) `stale` events state a value that was the belief earlier; `corrects` and `contradicts` targets exist, and a correction is later than its target.
11. (V) For each `order_ref`: `before_T` ⇔ `known_at < placed_at`. Every field of the belief snapshot equals the announcement history as of `requested_at` (or the documented stale variant).
12. (V) No pre-T crumb of an order mentions its order number, promised date or delivery, or states the chosen tier; tier words appear before T only in `asks_expedite` crumbs.
13. (C) No rendered record is dated after `now`; no rendered record reflects a `future` fact; no rendered text record precedes the text window start.

**Coverage**
14. (V) Every `revealed` edge has ≥ 1 event referencing both ends; every `never` edge has none; every `vague` edge has ≥ 1 event and none with both ends resolvable.
15. (V) Link quality matches crumbs: clean id ⇒ ≥ 1 pre-T crumb with an id reference; alias only ⇒ ≥ 1 pre-T crumb and none with an id; never ⇒ 0.
16. (C) Every crumb event inside the text window appears in ≥ 1 rendered record containing its `fact_tokens` (via provenance); every rendered record maps back to ≥ 1 event or is filler.
17. (V) Every Xometry order has an answers entry with all three tiers; the solver self-check (S9.6) passes; `days_gained ≥ 0`; hidden reason is in the fixed list and consistent with its rule (e.g. "no gain" ⇒ Expedite chosen and true gain 0; "genuine gain" ⇒ true gain > 0).
18. (C) Names, ids, amounts and dates agree across sources: Ramp amount = Xometry total; Jira procurement ticket's quote id = the order's; a person has one Slack id, one Jira account, one email everywhere.

**Secrecy**
19. (C) No rendered file and no job file contains a hidden-reason label (enum or the plan's long form, case-insensitive), a world-internal id prefix, or a key in the hidden list.
20. Hidden list (never in jobs, `planned/` or rendered sources): hidden reason, rule number, belief snapshot, true values of wrong crumbs, `truth_status`, `days_gained`, per-tier `ready` of unchosen tiers, true need date, true progress and pressure, habits, `wtp_per_day`, `checks_dependencies`, `expressiveness`, edge reveal class, link quality, storyline ids, `origin`, `future` facts, budget and pressure windows. Jobs carry only the stated value and the pressure level to convey.
21. (C) The app's source never imports or reads `fixtures/world/` except the provenance view (grep).

**Text**
22. (C) `assemble` output equals `planned/` on every non-text field (deep compare with text blanked).
23. (C) Every returned slot id was planned; crumb texts contain their `fact_tokens`; background texts pass the rule in §3.4; text ≤ 4,000 characters, no control characters.
24. (C) Determinism: `simulate` and `plan` run twice give identical SHA-256; the `--weeks 1` jobs equal the same-named `--weeks 13` jobs.

**Statistics** (fail outside the range)

| # | Measure | Range |
|---|---|---|
| 25 | Xometry orders; distinct requesters; share placed by the two buyers | 400–550; 16–22; 33–47% |
| 26 | Orders per week: median baseline week; every burst week; quiet weeks | 8–14; 18–32; 2–6 |
| 27 | Tier mix Exp / Std / Econ; Expedite in burst weeks | 20–30 / 50–60 / 15–20%; 36–52% |
| 28 | Revision share; lines per order median, max | 30–40%; 2, ≤ 6 |
| 29 | Order total median; 99th percentile; sum | $600–900; $8–15k; $400–700k |
| 30 | Hidden reasons | each within its S8 band ±2 points; expedites that truly gained 45–60% |
| 31 | Link quality clean / alias / never | each within ±4 points of `k.link_quality` |
| 32 | Edge reveal revealed / vague / never; crumb status true / stale / wrong / contradiction | each within ±5 points; ±2 points of the knobs |
| 33 | Lateness: delivered on time or early; ≥ 3 wd late | 72–84%; 5–11% |
| 34 | Other-vendor orders; SaaS charges; missing memo; missing receipt | 1,250–2,200; 250–400; 15–30%; 10–20% |
| 35 | Tickets per month; description empty; due date set; due dates edited; open and stale 30+ days; open and Blocked | 250–400; 30–40%; 25–35%; 25–35%; 10–20%; 6–14% |
| 36 | Slack messages per wd (generated channels); crumb-bearing share | 150–300; ≤ 12% |
| 37 | Slack length ack+short / medium / long (after text); threads on top-level posts | 60–72% / 17–27% / 5–10%; 25–35% |
| 38 | Human activity Mon–Fri 08:00–18:30; weekend; 00:30–06:00 | ≥ 85%; ≤ 4%; 0 |
| 39 | Recorded meetings per week; meeting length a multiple of 30 minutes | 12–18; ≤ 5% |
| 40 | Round numbers: order totals ending `.00`; lead times equal across consecutive orders | ≤ 3%; ≤ 15% |
| 41 | Learnability probe (§2) | in every band |
| 42 | Tests slipped ≥ once; slips never announced; soft milestones with ≥ 1 move | 35–55%; 3–8%; all |

## 5. Robustness and fallbacks

**Checkpoints.** At each, a complete dataset passes `validate` and `checks` and is committed before work continues.

| # | Dataset | Contains | Passes |
|---|---|---|---|
| 1 | `fixtures/world/example/` | Hand-sized world: 3 orders, 1 test, 1 milestone, ~10 events | I1–I24 (no statistics) |
| 2 | Full truth + `--weeks 1` | `world.json`, `answers.json`; Xometry, Ramp, calendar for 39 weeks; one week of Slack, Jira, meetings with **fallback text only** (no writer has run) | I1–I34, I41–I42; text-shape checks warn |
| 3 | `--weeks 1` with written text | Same, writers run on the week's jobs | + I16, I23 |
| 4 | `--weeks 13` | Demo context, then newest week first; committed after each batch of jobs | All; I35–I40 on the weeks written |

Checkpoint 2 is the safety net: it needs no model call and already gives Burn real-format sources and the cost-of-delay engine a graded answer key.

**If a stage is late, cut in this order** (each cut keeps every invariant):
1. S11 mess (splits, refunds, duplicates) → plain single charges.
2. The learnability probe (I41) → report the baseline and the days-to-need rule only.
3. Contradictions and `ambiguous_with` → true, stale and wrong crumbs only.
4. Filler work items and background tickets → tickets only for seed work items, orders and test failures (I35 volume warns).
5. Test failures and re-runs → slips only from inputs and overruns.
6. Feedback from late CNC parts into announced plan dates → announcements driven by deliverables and work items only; late parts still move the true dates and the answers.
7. Meetings beyond the three purchasing series and gate reviews.

**Simplest acceptable version of each stage**

| Stage | Minimum |
|---|---|
| S1 | Mon–Fri, three closed holidays, correct offsets |
| S2 | Solver + one slip per late input, announced after a fixed lag mix in Slack or the program review |
| S3 | One slip draw per deliverable, one announcement |
| S4 | One ticket per work item with the close-lag and stale rates |
| S5 | Progress from true effort; pressure from slack bands and milestone distance |
| S6 | Structural demands plus Poisson filler to `λ(w)`; one line per order allowed if grouping is late |
| S7 | Category range draw, three tiers, tax; no price-break curve |
| S8 | Rules 1–7 exactly as written (do not simplify: this is the training signal) |
| S9 | Exactly as written (do not simplify: this is the answer key) |
| S10 | Lateness draw, delivered, `ready_at`; no DFM holds, no cancellations |
| S11 | Poisson counts and lognormal amounts per category |
| S12 | Emission table with true and stale only; link quality and edge reveal enforced |
| S13 | Exactly as written |

## 6. Requirements on the schema

Fields this design needs. ★ = not obviously implied by the plan's checklist.

- **meta:** seed; `now`; window start; ★ `sim_horizon`; ★ `dst` transitions; holidays with `closed | half`; business hours; ★ `weeks[]` (`w`, start, activity, kind); train and test boundaries; ★ `knobs_hash`.
- **people:** ordering weight; habit; ★ `habit_strength`; ★ `wtp_per_day`; ★ `checks_dependencies`; ★ buyer queue delay and batching days; writing style; chattiness; lurker; out-of-office periods; ★ approval delegate.
- **teams:** ★ `expressiveness` (loud or stoic).
- **parts:** aliases, ★ each with an `ambiguous_with` list; category (keys the price and lead ranges); revisions with ★ `released_at` and reason; ★ `unit_price_q1` per revision; typical qty; robot part or test hardware.
- **resources:** ★ slot grid (weekdays, hours, capacity); bookings with test id and ★ `conflict_with`.
- **tests:** inputs by edge; ★ `earliest_start`; true duration and quoted estimate; ★ true start and end; ★ outcome (pass, fail, inconclusive) and `rerun_of`; planned-date announcement history; `pinned`.
- **deliverables:** kind; ★ true arrival; ETA announcement history; linked other-vendor order.
- **milestones:** hard or soft; ★ kind (`build | gate | test | demo`); ★ true achieved date; date announcement history; value policy and who set it.
- **★ slips:** entity, cause, `delta_wd`, `occurs_at`, `discovered_at`, `announced_at | null`, by, venue, announcing event id.
- **history entries (all):** `value`, `known_at`, `by`, ★ `event_id | null`, ★ `slip_id | null`.
- **work_items:** `origin`; estimate and true duration; ★ true start and done; `blocked_by`; status history; ★ `milestone` and `effort` (for progress).
- **tickets:** as the plan, with status history and due-date history carrying `known_at` and author; ★ comment slots with event ids; ★ `stale` is derived, not stored.
- **edges:** from, to, kind; ★ alternative-group id; reveal class; ★ revealing event ids; `origin`.
- **★ demands:** id, kind, part, revision, qty, assembly, requester, `feeds`, `believed_need_by`, `trigger_at`, `late_by_choice`, `hidden_earlier_need`, `order_id`, `caused_by` (test failure, rejection, revision).
- **★ windows:** `pressure_windows[]` and `budget_windows[]` (start, end, teams or assemblies, cause).
- **orders (Xometry):** ★ `lines[]` (part, revision, qty, unit price, demand id); quote id, `quoted_at`, `valid_until`; ★ `tiers[]` each with price, shipping, tax, total, lead wd, promised date; chosen tier; requester, placer, approver; ★ `tier_decided_by`; ★ `requested_at`; `approved_at`, ★ `auto_approved`; `placed_at`; status timeline; delivered; inspection (recorded?, result); ★ `ready_at`; first use with ★ `recorded_at | null`; `feeds`; believed need-by at T; link quality; ★ `is_revision`; ★ `remake_of`; cancelled; Ramp transaction ids; descriptor; memo and receipt flags; ★ `need_identified_at`; ★ `demo`.
- **orders (other):** as the plan, plus ★ `payment: card | bill`, ★ `duplicate_of`, `refund_of`, linked deliverable.
- **events:** `known_at`; venue (channel + thread, ticket, meeting, calendar); author; `kind`; claim kind; ★ **stated value** and ★ **true value at `known_at`** as separate fields; references `[{entity, style: id | alias | vague, token}]`; truth status; `corrects`, `contradicts`; pressure conveyed 0–3; ★ `asks_expedite`; storyline; ★ `order_refs[{order_id, relation}]`; ★ `truth_change` (slip id, order status, work-item change) it reports; ★ `future`.
- **storylines:** beats with week, type and participants; active weeks.
- **channels, meeting_series, meetings:** as the plan; ★ recorded flag and note-taker format per meeting; ★ per-meeting segments (crumb event ids, storyline beats) in order.
- **answers:** per order: hidden reason; ★ rule number; ★ belief snapshot (believed need-by, believed input dates, believed gain per tier, `stale`, `ignored_siblings`); ★ `true_need_date`; per tier ★ `ready`, ★ `S`, ★ `M`, `days_gained`, ★ `true_slack`; `expedite_helped`; ★ `break_even_per_day`; ★ `dominating_input`; ★ true **and expressed** pressure per band; crumbs before and after T; revealed and unrevealed links; ★ `split_full`. Per assembly per week: true progress, ★ true rank, ★ pressure value and level. ★ Top level: realized mixes, probe results.
- **knobs:** every `k.*` named in §1–§2, with these defaults.
- **Ids:** ★ world-internal ids use prefixes that cannot collide with native ids (Slack `U…`/`C…`, Jira keys, Xometry `Q-…`), so I19 can scan for them.
