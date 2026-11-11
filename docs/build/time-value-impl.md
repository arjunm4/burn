# Implementation: Time Value

Companion to [`time-value-plan.md`](time-value-plan.md) (what and why). This file fixes **who builds what, the file layout, and the contracts between modules**, so agents can build in parallel. Design: [`../architecture.md`](../architecture.md) §6.1, §7, §8, §10.

## Ground rules for every agent

- Work only in `/Users/owen/Documents/burn-time-value` (branch `claude/time-value`). **Run no git commands.** Write only the files your section owns.
- Plain Node ES modules, **no new dependencies**. Tests use `node --test` and sit beside the code (`*.test.mjs`). `npm test` must stay green.
- **Burn never reads `fixtures/world/`.** Only `scripts/timevalue/export-settings.mjs` (company configuration) and `scripts/timevalue/grade.mjs` (grading) may. Everything else reads the rendered sources and `fixtures/timevalue/settings.json`.
- **Rendered sources:** `fixtures/flintlock/` (Slack API JSON, Jira API JSON, meeting Markdown, `calendar.ics`, `xometry/{quotes,orders}.json`, `ramp/{transactions,bills}.json`, `demo/{part-entry,quote,policy,live-changes}.json`). A dev copy is already rendered with **fallback text only** (crumbs; no background yet). Text writers will fill more later, so code must not assume today's volume. **Do not run `plan.mjs` or `assemble.mjs`**, and never write into `fixtures/world/` or `fixtures/flintlock/`.
- **Outputs** go to `fixtures/timevalue/` (ours). Every script takes `--sources <dir>` (default `fixtures/flintlock`) and `--out <dir>` (default `fixtures/timevalue`).
- Deterministic: no `Math.random`, no `Date.now()` in logic; "now" is passed in. Sort outputs by id or time.
- Working-day maths: import from `scripts/generate-world/lib/calendar.mjs` (`makeCalendar(meta)` → `addWd`, `wdBetween`, `isWd`, `nextWd`, `onOrAfter`). If it pulls in anything not browser-safe, copy only the functions needed into `src/timevalue/calendar.mjs` with a comment naming the source.
- Never invent a $/day, a date or a link. Unknown stays `null` with a reason.

## Layout and owners

| Agent | Owns | Depends on (by contract, not by waiting) |
|---|---|---|
| **A. Maths core** | `src/timevalue/{calendar,solve,compare,rubric,index}.mjs` + tests | — |
| **B. Sources and settings** | `scripts/timevalue/export-settings.mjs`, `server/timevalue/sources.mjs`, `server/timevalue/labels.mjs` + tests; writes `fixtures/timevalue/settings.json` | — |
| **C. Graph and track 1** | `server/timevalue/{refs,claims,graph,progress}.mjs` + tests | B's contracts |
| **D. Context read (LLM)** | `server/timevalue/read.mjs`, `scripts/timevalue/read-jobs.mjs`, `docs/build/read-job-instructions.md` + tests | B, C (`refs`) contracts |
| **E. Heat map and habit** | `server/timevalue/{heatmap,habit}.mjs`, `scripts/timevalue/train.mjs` + tests | B, C, D contracts |
| **F. Demo service and card** | `server/timevalue/demo.mjs`, `server/timevalue/routes.mjs`, `src/timevalue/Card.jsx`, `src/timevalue/HeatMap.jsx`; minimal wiring in `server/index.js` and `src/main.jsx` | A, B, C contracts |
| **G. Grading** | `scripts/timevalue/grade.mjs` + test | A, B, C, E contracts |

Each agent may write a small stub of a contract it depends on **inside its own test file only**, never in another agent's file.

## Contracts

### `fixtures/timevalue/settings.json` (B) — Burn's configured company knowledge

```
{ generated_from: "world.json", demo_now, time_zone: "America/Los_Angeles",
  holidays: [{date, name, observance}],                      // full | partial | worked
  people: [{id, name, email, slack_id, jira_account_id, team, title, manager}],
  teams: [{id, name, lead, members, channels, jira_project}],
  assemblies: [{id, name, jira_project, slack_channel, team}],
  parts: [{id, part_number, name, aliases, assembly, kind}],  // kind: robot_part | test_hardware
  deliverables: [{id, name, aliases, owner, assembly, kind}],  // no ETAs: those come from text
  tests: [{id, name, assembly, rig, resources, owner, milestone,
           duration_estimate_days: [min,max],
           planned_date: [{value, known_at, by}]}],             // the original plan, then only changes said somewhere
  rigs: [{id, name, slot_days, owner}],                        // test_rigs + resources
  milestones: [{id, name, owner, hardness, assemblies,
                date: [{value, known_at, by}],                // same rule as planned_date
                value_policy: [{value, known_at, by}]}] }       // policy: per_day | curve | none
```
No `edges`, ETAs, true dates, demands or answers: those are what Burn must find.

### `server/timevalue/sources.mjs` (B)

`loadSources(dir) → { docs, xometry: {quotes, orders}, ramp: {transactions, bills}, calendar: [{uid, summary, start, end, attendees, categories}], demo: {partEntry, quote, policy, liveChanges} }`

`docs` = every Slack message, Jira description/comment/field change, meeting transcript line and calendar event, as
```
{ id, source: "slack"|"jira"|"meeting"|"calendar", container, thread, author: {name, email, slack_id},
  at /* ISO with offset */, text }
```
Ids: `slack:<channel>:<ts>`, `jira:<key>:desc` / `jira:<key>:c<commentId>`, `meeting:<file>:<line>`, `cal:<uid>`. `container` = channel id, ticket key, meeting file or `calendar`; `thread` = Slack `thread_ts` or own `ts`, ticket key, meeting file. Sorted by `(at, id)`. Also `docsBefore(docs, T, days)`.

### `server/timevalue/labels.mjs` (B) — the training anchor

`linkRampToXometry({ramp, xometry}) → [{order_number, quote_id, ramp_id, T, tier, total, requester_email, placer_email, part_numbers, tiers: [{tier, total, lead_days, est_delivery}]}]`

A Ramp card transaction whose merchant is Xometry is matched to the Xometry order with the same total (±$0.01) and `user_transaction_time` within 1 day of `placed_at`. `tier` is the order's `lead_time` (lower-cased: economy | standard | expedite). `T` = `placed_at`. Unmatched charges are returned in a separate `unlinked` list (they count toward the link rate, never toward training).

### `server/timevalue/refs.mjs` (C)

`makeResolver(settings) → resolve(text) → [{id, kind: part|deliverable|test|milestone|rig, mode: "id"|"alias"|"vague", token}]`. Part numbers and quote/order numbers → `id`; aliases and names → `alias` (ambiguous aliases return every candidate with `ambiguous: true`); "the bracket"-style phrases are `vague` only inside a container whose assembly owns exactly one match.

### `server/timevalue/claims.mjs` (C) — code-only claim extraction

`extractClaims(doc, resolve) → [{kind: needs|eta|done|blocked|need_earlier|duration, subject, value, doc_id, by, at}]`. Regex over hardware phrasing ("need 4x FL-HIP-1042 by tues the 24th", "new ETA 11/30", "somewhere between 11/19 and 11/30" → value `{min, max}`, "done", "blocked on", "takes 3 days"). Relative dates resolve against `doc.at`.

### `server/timevalue/graph.mjs` (C)

`buildGraph({settings, sources, claims}) → graph` and `graphAt(graph, T) → view` (only evidence with `at ≤ T`).
```
graph = { nodes: [{id, kind, name}],
          edges: [{from, to, kind: requires_all|gates, status: accepted|proposed|disputed,
                   evidence: [{doc_id, at, by, via: structured|claim|llm}]}],
          facts: [{subject, kind: eta|planned_start|duration|done, value, at, by, doc_id, status}] }
```
Structured links first: Xometry order → part; test → milestone (settings); Jira `issuelinks`; calendar bookings → rig. Then claims: `needs` in a test's channel or ticket links part → test. Acceptance: an `eta` from the item's owner or supply chain supersedes older ones; conflicting same-time claims → `disputed`.

`demoInputs(view, partId) → {test, milestone, inputs: [{id, kind, ready: date|{min,max}|null, said_by, said_at, doc_id}], planned_start, duration, rig, policy}` — everything the maths core needs, with sources.

### `server/timevalue/progress.mjs` (C) — track 1

`progressRank({settings, sources, claims}, weekStart) → [{assembly, milestone, done_share, rank}]`: tickets Done ÷ all tickets per assembly's Jira project created before the week end, plus `done` claims not yet closed in Jira; ranked among assemblies of the same milestone (1 = furthest behind).

### `server/timevalue/read.mjs` (D)

`readDoc(doc, ctx) → {doc_id, refs, claims, pressure: 0..1, done: [ids], via: "code"|"llm"}`. Code version: `refs` + `claims` from C, pressure from a lexicon ("any update", "asap", "urgent", "??", "!!", "blocked", "need it by", "slipped", deadline words, a manager joining) scaled 0–1. `loadReadCache(dir)` merges LLM results over code results by `doc_id`.

`scripts/timevalue/read-jobs.mjs`: prefilter docs (any ref, or in a thread with a ref, or in a meeting with a ref) → job files `fixtures/timevalue/read-jobs/<job_id>.json` of ~40 docs with the relevant slice of the catalog and `docs/build/read-job-instructions.md`'s output schema; `--collect` validates filled jobs into `fixtures/timevalue/read-cache.json`. Jobs are idempotent by doc-id set; filled jobs are never overwritten.

### `server/timevalue/heatmap.mjs` (E) — the habit model's only input

`heatmap({label, docs, reads, settings, progress, history}) → {order_number, T, cells: {row: [b14_30, b7_14, b3_7, b1_3, b0_1]}, flags: {no_context}, extra: {requester_expedite_rate, extra_usd_expedite}, linked: [doc_id]}`

- **Linked context:** docs with `at` in [T − 30 d, T) whose reads reference a part of the order (by id, part number or alias), plus the rest of their thread.
- **Rows:** `messages`, `pressure` (mean of `pressure − author's team baseline`), `deadline_talk` (`needs`/`need_earlier` claims), `waiting_talk` (`blocked`), `slips` (an `eta` differing from an earlier one for the same subject), `people` (distinct authors), `manager` (requester's manager or a lead wrote), `meetings` (meeting docs), `progress_rank` (track 1 rank of the order's assembly at that band), `id_share` (share of linked docs that matched by id).
- **Per day:** counts ÷ band length (1, 2, 4, 7, 16 days).
- **Extra (from Ramp and the quote, not conversation):** requester's expedite rate over their earlier labelled orders (smoothed toward the team rate), `log(1 + extra $ of the fastest tier over Standard)`.

### `server/timevalue/habit.mjs` (E)

`train(rows, {lambda}) → model` and `predict(model, heatmap) → {p_expedite, n_train, top: [{row, band, contribution}]}`. Binary label: expedite vs not. Standardized features, L2 logistic regression, λ by 5-fold CV on the training set. **Split by time:** the oldest 70% of the **154 usable orders** train (~108), the newest 30% test (~46). Usable = T ≥ text start + 30 days and a Ramp↔Xometry link.

`scripts/timevalue/train.mjs` → `fixtures/timevalue/habit-model.json` `{weights: {row: [5 bands]}, extra: {...}, bias, lambda, n_train, n_test, accuracy, accuracy_ci95, baseline_never_expedite, rows_used}` and `fixtures/timevalue/heatmaps.json`.

### `src/timevalue/` (A) — the maths core, browser-safe

```
solve({holidays, test: {planned_start, duration_days, rig_slot_days, bookings, owner_out},
       inputs: [{id, ready /* date */}]}) → {start, finish, limiter: {kind: input|planned_start|slot|owner_out, id}}
compare({holidays, quote: [{tier, total, ready}], test, inputs /* ready: date | {min,max} */,
         milestone: {target, policy: {type, usd_per_day | curve} | null}, now})
  → {tiers: [{tier, total, finish_by_scenario, days_saved, break_even}],
     outcome: "cheapest"|"pay"|"dont_pay"|"depends"|"ask_owner"|"blocked",
     recommended, limiter, switching: {input, by_date} | null, question: {to, text} | null}
rubric(compareResult, {quoteValidUntil, now, facts: [{text, by, at, doc_id}]})
  → {checks: [{n, label, status: pass|fail|unknown|info, text, sources}], guards: [{rule, ok}], blocked}
```
Rules: working days; ready on R → usable from `nextWd(R)`; start = first working day ≥ max(planned start, usable dates) on a rig slot day with no booking and the owner in; finish = `addWd(start, duration − 1)`. Scenarios: an input with `{min,max}` yields the endpoints plus the switching date. Per-day value = $/day × days saved; curve = cost by days late against `target`; no policy → `ask_owner`. **Tests:** cases A–E with the dates in `simulation-spec.md` S14 and `fixtures/flintlock/demo/`.

### `server/timevalue/demo.mjs` + routes (F)

`demoCard({change: 0|1|2})` builds the card from sources only: part entry → resolve the part → `graphAt(now)` → `demoInputs` → `compare` → `rubric` → habit line from `habit-model.json` (`predict` on the demo's heat map) → `{card, heatmap, sources}`. Change 1 or 2 appends `demo/live-changes.json[n]` as a Slack doc, re-extracts claims and re-solves (code parser; no model call). Routes: `GET /api/timevalue/demo?change=N`, `GET /api/timevalue/habit` (weights grid). UI: a card (tiers, outcome, break-even, rubric checks with sources, habit line with n) and the weight heat map; buttons for the two live changes. Precomputed JSON fallback in `fixtures/timevalue/demo-cards.json` so the UI works without the server logic.

### `scripts/timevalue/grade.mjs` (G)

Reads `fixtures/world/{world,answers}.json` plus our outputs; writes `fixtures/timevalue/grading.json`:
1. **Engine exact:** for every Xometry order with `tier_outcomes`, feed the **true** test, inputs and ready dates into `compare` and compare finish dates and days gained. Target ≥ 95%; list mismatches.
2. **Habit:** accuracy on the test split vs never-expedite and the need-by rule (69.5%, from `answers.summary`), with a 95% interval.
3. **Wasted expedites caught:** for expedited orders with `expedite_helped: false`, whether Burn's own `graphAt(T)` + `compare` says "cheapest" (no gain); dollars caught out of the total.
4. If present: graph recall by `reveal`, link rate from `labels`.

## Order of work

1. A, B, C, D, E, F, G start together against these contracts (stubs in tests).
2. B's `settings.json` and `sources.mjs` land first; C, D, E switch from stubs to real data.
3. F wires A + C; G grades A first (needs no graph), then the rest.
4. When text writing ends (10pm): rerender (Owen's session), run `read-jobs` → agents fill jobs → `--collect` → `train` → `grade` → `demo-cards.json`.

## Done means

`npm test` green; `node scripts/timevalue/train.mjs` and `grade.mjs` run in < 30 s on the dev sources; `/api/timevalue/demo?change=0|1|2` returns cases A, B and D; the card renders without a model call.

## Rerun when the final world and context land

All seven modules are built and tested on hand-made fixtures (`npm test`: 193 pass). With the final `fixtures/world/` and `fixtures/flintlock/` in this branch:

1. `node scripts/timevalue/export-settings.mjs` → `settings.json`; prints doc counts, the Ramp↔Xometry link rate and the usable-order count (expect about 154).
2. `node scripts/timevalue/read-jobs.mjs` → job files; Claude agents fill them per `read-job-instructions.md`; `node scripts/timevalue/read-jobs.mjs --collect`.
3. `node scripts/timevalue/train.mjs` → `habit-model.json`, `heatmaps.json`.
4. `node scripts/timevalue/grade.mjs` → `grading.json`.
5. `node scripts/timevalue/demo-cards.mjs --sources fixtures/flintlock` → `demo-cards.json`; serve with `TIMEVALUE_SOURCES=fixtures/flintlock`.

**The final world must render** Arjun's Slack message (Sat 11/07) that the DVT hip motor's ETA is 11/20, and a message that the spin test takes 3 days; otherwise case A reads "ask Arjun" on the real data.
