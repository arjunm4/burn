# Build plan: Time Value (cost of delay)

Owner: Owen and Arjun, with Claude agents. Deadline: 2026-11-10, 11:59pm PT. Design: [`../architecture.md`](../architecture.md) §2.6, §2.10, §6.1, §7, §8, §10. Evidence: [`../research/cost-of-delay.md`](../research/cost-of-delay.md). World data: `fixtures/world/SCHEMA.md` and [`simulation-spec.md`](simulation-spec.md).

"Time Value" is a working name for the part of Burn that decides a tier.

## Shape

```
 Slack · Jira · meetings · calendar          Xometry quote        Ramp receipts
   ├─ LLM: dependencies ─► dependency graph ─► MATHS CORE ─► picks the tier ─┐
   ├─ LLM: vibe ─────────┐                                                    ├─► RUBRIC CARD
   └─ LLM: progress ─────┴─► context heat map ─► HABIT MODEL ─► advises ─────┘
                                     ▲                  ▲
                    requester's expedite rate,     label: tier from
                    extra $ of fastest tier        the Ramp receipt
```

The two sides never share inputs. The graph answers "will paying more help?"; the heat map answers "what does this team usually do?".

## 1. Maths core (`src/timevalue/`)

Same scheduling rules as the simulator (`simulation-spec.md` S2, S9), so every number can be graded against `answers.json`.

- **Unit:** working days, Mon–Fri minus `full` holidays (Veterans Day worked; Thanksgiving Thu–Fri closed).
- **Ready:** the tier's promised delivery date.
- **Test start:** first day the rig allows (`slot_days`, no other booking, owner not out) that is ≥ the test's planned start and ≥ the working day after the last input is ready.
- **Finish:** start + duration − 1; milestone = latest finish of what feeds it.
- **Days saved:** finish with the cheapest tier − finish with this tier. **Break-even:** extra total (with shipping and tax) ÷ days saved.

| Outcome | When |
|---|---|
| Cheapest | Days saved = 0 in every scenario; the card names the limiter (another input, planned start, rig slot, owner out) |
| Pay / don't pay | Owner's $/day vs break-even |
| Depends | An uncertain input flips it: the switching date and one question |
| Ask owner | The milestone has no $/day (4 of the 10 seeded milestones) |
| Blocked | Quote expired or a critical fact missing |

**Tests:** demo cases A–E with the dates in `simulation-spec.md` S14 (A: Standard done 12/01, Expedite 11/25, break-even $450 vs $600; B: motor 11/30, both 12/03; C: target 11/24; D: Expedite wins only if the motor is ready by Fri 11/20; E: a Monday-only rig).

## 2. Rubric card and guards

1. Quote valid? 2. Does it speed anything up? 3. Rig slot between the tier dates? 4. Worth it? 5. Facts fresh, from the right person? 6. Anything critical unknown (ask one person)? 7. What does the team usually do (habit and sample size)?

Guards that block a card: a $/day nobody set; a fact dated after now; an assumption with no source; an open critical gap.

## 3. Dependency graph (`server/context/`)

Links from structured data first (Jira links, calendar bookings, Xometry orders), then the LLM dependency pass over free text, given the list of known parts, tests and deliverables per channel; it returns an id or "unresolved". Acceptance by authority (§6). Read as known at any time T.

## 4. Context heat map and habit model (`server/habit/`)

One grid per Xometry order in Ramp at time T: rows are attributes, columns the bands 14–30, 7–14, 3–7, 1–3, 0–1 days before T. Rules in architecture §10:

- each cell per day, not per band
- a `no_context` flag for orders with nothing linked
- vibe scored against the team's own baseline
- link confidence (share matched by id vs nickname)
- two rows from Ramp and the quote: the requester's past expedite rate and the extra $ of the fastest tier

**Model:** one weight per cell (regularized logistic regression); the weight grid is the heat-map visual. About 145 usable orders (~100 train, ~45 test), so the score carries a ± range. Reported against "always Standard" (50–60%) and the need-by rule (≤ 70%); the spec's target band is 66–78%.

## 5. Grading (`scripts/timevalue/grade.mjs`)

| Piece | Against | Target |
|---|---|---|
| Maths engine (true graph in) | `tier_outcomes` | ≥ 95% exact |
| Dependency graph | `edges` by reveal | ≥ 80% of revealed links; ≥ 90% precision |
| Vibe | `expressed_pressure` per band | ≥ 65% same level |
| Track 1 | `assembly_weeks.true_rank` | finds the furthest-behind assembly |
| Habit | tier chosen, held-out orders | beats both baselines |
| End to end | `expedite_helped` | wasted-expedite dollars Burn would have caught |

## Tonight

| By | What | Who |
|---|---|---|
| 7:45 | Maths core and rubric, cases A–E as tests | Claude |
| 8:25 | Graph from structured data; grading script; LLM passes (prompt, cache, batch runner) | Agents 1–3 |
| 9:15 | Run on the 1-week world; demo cases A, B, D end to end | All |
| 10:00 | Card on screen; heat map and habit training code | Claude + agent 4 |
| 10:45 | Final passes on 13 weeks; graph, heat maps, habit, grading report | Agents |
| 11:15 | Run-through, fixes, merge (Owen's OK) | Owen + Claude |

**If late, cut in this order:** (1) heat map rows from code only, without the LLM vibe; (2) track 1 from tickets only; (3) LLM passes on the demo's 30 days plus the newest 4 weeks; (4) end-to-end grading on a sample.

**Dependencies:** no Anthropic API key on this machine (the live "motor slipped" message falls back to the rule-based extractor; agents fill the cache). Burn reads owners' $/day, holidays and known tests and milestones from an exported settings file, never from `fixtures/world/`.

## Open (Owen)

1. Name: Time Value?
2. $/day: every working day gained (assumed), or only days past the target?
3. When the maths can't decide: ask with nothing preselected (as written), or may habit or track 1 preselect?
4. Track 1: also on the card as urgency context, or only a heat-map row?
5. An API key for the demo?
