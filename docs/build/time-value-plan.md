# Build plan: Time Value (cost of delay)

Owner: Owen and Arjun, with Claude agents. Deadline: 2026-11-10, 11:59pm PT. Design: [`../architecture.md`](../architecture.md) §2.6, §2.10, §6.1, §7, §8, §10. Evidence: [`../research/cost-of-delay.md`](../research/cost-of-delay.md). World data: `fixtures/world/SCHEMA.md`, [`simulation-spec.md`](simulation-spec.md).

"Time Value" is a working name for the part of Burn that decides a tier.

## Principles (for a robust, fast demo)

1. **Everything is precomputed and committed.** Graph, heat maps, habit weights and the demo's cards are JSON files built offline. The demo makes **no live model call** and needs no API key; with a key, the live path is a bonus.
2. **Code first, LLM on top.** Every step has a code-only version that always works; the LLM output replaces it where its cache is filled.
3. **One small module per step, each testable alone**, plain Node, no new dependencies.
4. **Reuse what's tested:** working-day maths from `scripts/generate-world/lib/calendar.mjs` (pure functions, already tested). Burn reads no world data, only rendered sources and an exported settings file.

## Shape

```
 Slack · Jira · meetings · calendar          Xometry quote        Ramp receipts
   ├─ LLM: dependencies ─► dependency graph ─► MATHS CORE ─► picks the tier ─┐
   ├─ LLM: vibe ─────────┐                                                    ├─► RUBRIC CARD
   └─ LLM: progress ─────┴─► context heat map ─► HABIT MODEL ─► advises ─────┘
```

The three LLM passes run as **one read per chunk** (thread, ticket or meeting) returning three outputs. Only chunks that mention a known part, test, deliverable or alias are read (the code prefilter), which cuts the volume about tenfold.

## What the world gives us (run of 2026-11-10, seed world)

- 490 Xometry orders (139 Expedite, 276 Standard, 75 Economy); 2,160 other-vendor orders; 1,239 true links.
- **64 of 139 expedites bought no time: $45,659 of premiums.** This is the headline Burn should catch.
- **Usable for training: 154 orders** (Owen's number: 13 weeks of text, 30 days of context before T). Split by time: ~108 train, ~46 test.
- Baselines already in `answers.json`: always Standard 44.9%; "expedite if need-by is inside Standard's lead" 69.5%.
- Link quality: 216 clean id, 163 nickname only, 111 never discussed.

Implementation contracts and owners: [`time-value-impl.md`](time-value-impl.md).

## Steps

| # | Module | Code-only version | LLM version | Done when |
|---|---|---|---|---|
| 1 | `src/timevalue/` maths core and rubric | Complete; no LLM | — | Cases A–E pass with the dates in `simulation-spec.md` S14 |
| 2 | `scripts/timevalue/export-settings.mjs` | Owners' $/day, holidays, known parts, aliases, tests, rigs, milestones → `fixtures/flintlock/settings.json` | — | Burn runs without `fixtures/world/` |
| 3 | `server/context/graph.mjs` | Links from Jira links, calendar bookings, Xometry orders, and part numbers in text | Dependency claims from the read | Graph JSON as known at any T |
| 4 | `server/context/read.mjs` | Keyword lexicon for pressure ("any update", "asap", "??", "blocked", deadline words); `done` from ticket status | One read per prefiltered chunk → `{refs, claim, pressure, done}`; cached by chunk hash | Cache JSON; reruns skip cached chunks |
| 5 | `server/habit/heatmap.mjs` | Grid per order from 3 and 4: rows × 5 bands, per day, `no_context` flag, team baseline, link confidence, requester's expedite rate, extra $ of Expedite | Same rows, LLM pressure in place of the lexicon | One grid per usable order |
| 6 | `server/habit/model.mjs` | **Expedite vs not**, logistic regression with strong shrinkage, ~60 lines of JS | — | Weights JSON plus held-out accuracy with a ± range |
| 7 | Card on `src/Engineer.jsx` | Rubric card, the habit line, the heat-map weights picture | — | Demo cases A, B, D on screen; the motor-slip message flips A to B |
| 8 | `scripts/timevalue/grade.mjs` | Three numbers (below) | — | Report written to `fixtures/flintlock/grading.json` |

**The demo's live change** (motor slips) is one of two scripted messages: the code parser reads it, updates the cached graph, and the maths core re-solves. No model call.

**Habit is Expedite vs not** (not three tiers): about 108 training orders is too few for three classes; the card says "teams like yours expedite this X% of the time (n = …)".

## Grading: three headline numbers

| Number | Against | Target |
|---|---|---|
| Maths engine exact | `tier_outcomes` (true graph in) | ≥ 95% of orders |
| Habit accuracy | Tier chosen, held-out orders | Beats always Standard (44.9%); reported beside the need-by rule (69.5%), which uses need-by dates the heat map deliberately excludes |
| Wasted expedites caught | `expedite_helped` = false | Share of the $45,659 Burn's own graph flags as buying no time |

Graph recall by reveal type, vibe agreement and track 1 rank are reported if time allows.

## Tonight

| By | What | Who |
|---|---|---|
| 8:00 | 1 maths core and rubric; 2 settings export | Claude |
| 8:30 | 3 graph (code version); 8 grading on the maths core | Agents 1, 2 |
| 8:30 | 4 read: prompt, prefilter, cache, batch runner, tested on 1 week | Agent 3 |
| 9:30 | 5 heat map and 6 habit (code versions) end to end on the 13 weeks written so far; 7 card | Claude + agent 4 |
| 10:30 | LLM read over the final text; rebuild graph, heat maps, habit; grading report | Agents |
| 11:15 | Run-through, fixes, merge (Owen's OK) | Owen + Claude |

**Always shippable:** after 9:30 the code-only versions are complete and committed; everything later only improves the numbers.

**If late, cut in this order:** (1) the LLM read (keep the code versions); (2) graph recall and vibe grading; (3) the heat-map picture on the card (keep the habit line).

## Open (Owen)

1. Name: Time Value?
2. $/day: every working day gained (assumed), or only days past the target?
3. When the maths can't decide: ask with nothing preselected (as written), or may habit or track 1 preselect?
4. Track 1: also on the card as urgency context, or only a heat-map row?
