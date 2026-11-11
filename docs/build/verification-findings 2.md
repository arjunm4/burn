# Independent verification of the Flintlock world (snapshot, 2026-11-10, about 7:15pm)

Written by a Fable agent that built none of the pipeline, auditing a read-only snapshot of the world as committed in `e8c0f96`, **before** the fixes that followed. Each finding names its owner. See the status note at the end for what was fixed afterwards.

Snapshot: `/private/tmp/claude-502/-Users-owen-Documents-burn/2e7691db-bdfe-4993-aeb8-5a169a2ead09/scratchpad/verify/` (called `<snap>` below). Nothing under the repository was modified and git was not run.

## How this was checked

- **Items 1-4** (truth, test chains, learnability, imperfections): the verifier, scripts in `<snap>/work-14/`.
- **Items 5-6** (leaks, demo): a fork, scripts in `<snap>/work-56/`.
- **Items 7-9** (jobs, training, realism): a fork, scripts in `<snap>/work-789/`.
- Findings marked **(fork)** were computed by a fork and not re-derived by the verifier unless they say "re-checked".
- `checks.mjs` was run against a copy of the world, `<snap>/work-14/world-copy/`, because it writes `coverage.json`. It reports 10 violations: I26, I27, I29, I39 and six I41 lines.

Scripts in `work-14/` (run with `node <file>`; all import `load.mjs`):

| Script | What it computes |
|---|---|
| `load.mjs` | Loads `world.json` and `answers.json`; own working-day functions (Mon-Fri minus `full` holidays) |
| `truth.mjs` | Recomputes every tier outcome for all 490 Xometry orders and compares with `answers.json` |
| `chain.mjs` | For each of the 16 tests: input edges, the orders behind each part, ready dates, slips |
| `events.mjs` | Crumb imperfections: stated against true values, corrections, contradictions, stale values |
| `learn.mjs` | Splits, rule and reason mixes, probe bins, single-feature accuracies, signal visibility |
| `dom2.mjs` | Whether each named `dominating_input` was the binding constraint (`dom.mjs` is an earlier version that crashes) |
| `anchor.mjs` | Need-by against Standard delivery, crumbs dated before the quote, milestones, demo block |
| `demo.mjs` | Every event about the demo entities since 2026-10-11 |

Scripts in `work-56/`: `leak.mjs`, `future.mjs`, `pret.mjs`, `brief.mjs`, `xr.mjs`, `demo.mjs`, `demo2.mjs`, `demo3.mjs`, `shape.mjs`.
Scripts in `work-789/`: `jobs.mjs`, `mm.mjs`, `mm2.mjs`, `real.mjs`, `train.mjs`.

---

## 1. Simulator and events

### S1. Critical: the demo's case A cannot be reproduced from context
Method: `work-14/demo.mjs` lists every event since 2026-10-11 whose claim subject, `for_use` or refs touch `dl-hip-motor-dvt`, `pt-hip-bracket`, `test-hip-spin`, `m-hip-spin-test` or `rig-spin-test-stand`.

Only five crumbs exist:

| Event | Time | Claim | Brief |
|---|---|---|---|
| `ev-002533` | 10-20 09:41 | blocked | spin test waits on DVT hip frameless motor |
| `ev-002535` | 10-22 14:56 | blocked | spin test complete waits on spin test |
| `ev-002534` | 10-26 11:39 | blocked | spin test waits on spin-test stand |
| `ev-002532` | 11-02 10:01 | blocked | spin test waits on hip actuator bracket |
| `ev-003240` | 11-02 11:39 | substitute, stale | hip bracket: still quoting rev B (it changed to rev C) |

What is missing:
- **Motor ready date.** `dl-hip-motor-dvt.eta` has four entries (10-26 known 10-01; 11-13 known 10-14 by `p-samir`; 11-20 known 10-22; 11-20 known 11-07 10:12 by `p-arjun`). All have `where: null`, so no event carries them. `slips` has no record for the motor. 2026-11-07 is a Saturday.
- **Spin-test duration.** The world has no `duration` claim at all. Claim kinds over 3,288 crumbs: needs 1,774, substitute 402, eta 345, blocked 265, stock 261, done 241. There are no `owner` or `need_earlier` claims either. Only calendar booking `cal-bk-00001` (11-23 09:00 to 11-25 17:00) implies 3 days (fork).
- **The $600/day policy.** It is in `out/demo/policy.json` (Arjun, set 2026-10-05). In Slack it is a background beat on 16 messages in week 11-09; background text with an amount of $50 or more is dropped by text rule §3.4. The beat says Arjun sets it that week, against 10-05 (fork).

Fix: emit `eta` crumbs for the pinned history (11/13 on 10-14, 11/20 on 10-22, and a weekday restatement), one `duration` crumb (3 working days), and a policy crumb with its owner; set each history entry's `where`.

Sound (fork, `work-56/demo*.mjs`): given a motor date, the calendar gives A = Standard done 12-01, Expedite 11-25, break-even $450/day, +$300; B = both 12-03, Standard; D = Expedite iff the motor is ready by Fri 11-20. Quote dates 11-17 and 11-24 are right. The live-change texts carry 11/30 and 11/19-11/30.

### S2. Critical (shared with checks): pressure does not predict the tier
Method: `work-14/learn.mjs`, cross-tab of pressure level against chosen tier on the 154 usable orders.

| Measure | High | Elevated | Low |
|---|---|---|---|
| Expressed pressure, 0-1 day band (Standard / Expedite) | 18 / 21 | 18 / 22 | 30 / 29 |
| True pressure, 0-1 day band | 18 / 22 | 10 / 9 | 38 / 41 |
| Highest level on the order's own pre-T crumbs | 14 / 17 | 21 / 27 | 16 / 11 |

Cause:
- Rule 5 fired on 21 of 490 orders.
- Crumb pressure is `0.6 × assembly expressed + 0.4 × urgency` (`sim/context.mjs` line 89, `pressureAt`). Urgency is 0.8 when the crumb is under 8 wd from the need-by, else 0.5 or 0.2; it never looks at whether Standard misses the need-by, and its swing (0.24) rarely crosses a level boundary.
- Requester is uninformative as well: requester alone scores 0.449 on the answers split and 0.370 on the coverage split, because habits fire at 0.30 × 0.6 = 18%.

Fix: set urgency from "Standard `est_delivery` > need-by", raise its weight, and add follow-up crumbs for late orders.

### S3. High: `dominating_input` names an input that was not binding
Method: `work-14/dom2.mjs`. For each answer with a `dominating_input`, compare `addWd(input ready, 1)` with the free start (`true_need_date` + 1 wd).

- 164 orders name a dominating input; in 93 the input was ready before the free start. 11 name a part rather than a deliverable and were not classified.
- Examples: `ord-x-00001` names `dl-gen-0001`, ready 02-24, free start 03-10; `ord-x-00009` names `dl-motor-driver-pcba-evt`, ready 03-05, free start 03-19; `ord-x-00027` names `dl-gen-0003`, ready 03-18, free start 03-27.
- In 7 orders the named input was ready before even the Expedite ready date (`ord-x-00033`, `-00111`, `-00129`, `-00312` among them; from `truth.mjs`).
- Among the 17 `no_gain_other_input_later` orders: 12 right, 4 not binding (e.g. `ord-x-00048`: `dl-gen-0006` ready 04-09, free start 04-13; `ord-x-00250`: `dl-gen-0060` ready 08-17, free start 08-24), and `ord-x-00304` correctly names sibling part `pt-tilt-foot-clamp`.
- The as-built note says these should be null. `sim/answers.mjs` returns `free.dominating`, the latest other input, whether or not it binds.

Fix: name it only when `addWd(ready, 1) ≥` free start, else null.

### S4. Medium: few orders feed a real test, and work-item need-bys come from the quote
Method: `work-14/chain.mjs` (demand kind against consumer type), `work-14/anchor.mjs`.

- Orders by first-line demand kind and consumer: test_hardware → test 28; test_hardware → work item 147; iteration → work item 124; build_part → work item 114; rig_misc → none 53; spare → none 24.
- So 28 of 490 orders (5.7%) feed one of the 16 tests; 385 feed a private generated work item, and none of those has `feeds_milestone`.
- For those 385 the need-by is Standard `est_delivery` plus an offset. The measured offset runs from −6 to +19 wd with nothing outside it.
- 1,249 of 1,391 need-by crumbs on these orders are dated before the quote existed, on 302 orders. Nothing visible contradicts itself, but the need date has no source in the program schedule.

Verifier's proposed fix: none tonight; say so in the as-built notes so the training owner knows "days to test" exists for 28 orders.

### S5. Medium: a CNC part that delays a test leaves no slip record
Method: `work-14/chain.mjs`, tests whose actual start differs from the last announced plan.

- `test-torso-static-load`: `ord-x-00351` (Standard, promised 10-05, ready 10-06, need-by 10-02) moved the start from 10-06 to 10-08 (rig slots Tue and Thu). The plan history still says 10-06; `slips` has no entry for the test.
- `test-hip-evt-dyno`: `ord-x-00052` was ready 04-07; the test ran 04-08 against a plan of 04-07; no slip.
- These are the only two cases where an order moved a test. This is cut 6 in the as-built notes.
- Slip records by cause: deliverable vendor 56, deliverable overrun 29, test input_late 4, test resource_conflict 4, milestone input_late 4; 18 of 97 unannounced.

### S6. Medium: the flagship dependency is never written down
Method: `work-14/chain.mjs`, `test-leg-drop`.

- `e-00425` (`pt-leg-lift-hook`) and `e-00426` (`pt-leg-gantry-adapter`): reveal `never`, 0 events.
- `e-00370` (`pt-drop-fixture-hook`) and `e-00371` (`pt-drop-pelvis-dummy`): `hinted`.
- The truth is sound: `ord-x-00195` (Expedite, placed 05-29, ready 06-09) and `ord-x-00168` (Standard, ready 06-08) both precede the test on 06-16.

Fix: pin these edges to `revealed`.

### S7. Medium: imperfection patterns
Method: `work-14/events.mjs`.

- Truth status: true 2,696, wrong 329, stale 263.
- **Stale:** 207 of 263 are one revision template ("still quoting rev X"); 56 are stale ETAs. 33 of those 56 state a date already past when said, e.g. `ev-003031` (fork).
- **Contradictions:** in all 99 the later statement is wrong and the earlier is right (e.g. `ev-002927` against `ev-002086`; `ev-002928` against `ev-000522`), so "trust the first" grades perfectly. 5 are more than 5 days apart against the spec's 3 wd (`ev-002929`, `ev-002963`, `ev-002995` among them).
- **Demo revision (fork):** `ev-003240` says rev B on 11-02; rev C was released 10-28 and has no crumb. 73 of 148 messages carrying the "Owen releases bracket rev C" beat predate the release.

### S8. Medium: quantities and unit prices
- Line quantities: median 8, 90th percentile 68, maximum 768; 73 of 1,045 lines are 100 or more (`learn.mjs`). Example crumb `ev-000140`: "need 364" of a hip cycloid disc spacer.
- 98 of 1,045 CNC lines are under $3 a unit, e.g. 303 spacers at $0.45 (fork, `work-789/real.mjs`).

### S9. Medium: usable-order count
`answers.summary.usable_orders` says 167 from text start 2026-08-11 (`meta.context_first_pass.start`). `coverage.json` says 154 from 2026-08-17, usable from 09-16. One of the two text starts is wrong; see C3.

### S10. Low
- `checks` failures owned here: quiet-week mean 6 (band 3-5), burst Expedite share 0.396 (0.40-0.50), order total 99th percentile $4,976 ($8-15k).
- Rule 6b labels a Standard choice `genuine_gain` (27 orders), by spec; it is what caps the hidden-reason probe (C2).

---

## 2. Plan, Slack and Jira

### P1. High: stale crumbs hand the writer the true value
Method: grep for "it changed to rev" over `world/planned`, `world/jobs` and `out`; one planned record read in full.

- 84 occurrences in `planned/slack.json`; 168 across `planned/` and `jobs/`; none in `out/`. The fork counts 117 stale briefs across 50 job files (`work-56/brief.mjs`).
- Example, `ev-003200` in `slack-ch-actuators-2026-08-17-crumbs`: brief "pelvis plate: still quoting rev C (it changed to rev D)", claim `{kind: substitute, value: "rev C"}`, must_mention `["pelvis plate"]`, fallback "pelvis plate: switching to rev C".
- Other examples: `ev-003235` and `ev-003192` (feedthrough), `ev-003050` (shank hook), `ev-003250` (knee spin adapter); job files `slack-ch-mech-2026-08-31-crumbs`, `-09-21-`, `-09-28-`, `slack-ch-legs-2026-10-19-crumbs`.
- The claim carries only the stated value, so the leak is the brief. It breaks I20 and invites the writer to state the correction.
- The fallback changes the meaning: it announces a switch to the old revision.

Fix: drop the parenthesis; make the fallback "still on rev C". Do this before any crumbs job is filled.

### P2. High: Slack volume, hours and filler (fork, `work-789/real.mjs`, `jobs.mjs`)
- 32,772 planned messages over 61 working days = 537 a day against I36's 150-300. Every channel runs about twice its seed rate (`#mech` 129 against 70).
- 1,044 human messages fall between 00:30 and 06:00; 1,020 are filler thread replies. Core-hours share 75% against ≥ 85%.
- 19,020 replies share five briefs, about 3,800 each (e.g. "says they will look after lunch"). Lengths are random ("ack" marked medium). Authors reply to themselves. One storyline beat is the brief of 143 messages.
- 270 of 4,211 threads have 15 or more replies (6.4% against 2%).

Fix: count replies inside the channel rate, clamp reply times to working hours, widen the filler set.

### P3. High: Jira timestamps (fork)
364 of 1,653 changelog entries and 408 of 1,685 comments fall between 00:00 and 06:00; 387 changelog entries are on weekends.

### P4. High: six background jobs are too large (fork, `work-789/jobs.mjs`)
`slack-ch-mech-*-background` jobs hold 840-1,110 messages (245-318 KB). Split by day, about 200 messages each.

### P5. Medium: required mentions (fork, `work-789/mm.mjs`, `mm2.mjs`)
- 459 `must_mention` strings are full entity names, e.g. "Driver PCBA respin for leg (left, hip to foot) (lift hook)".
- Some tokens are absent from the brief ("camera arm"; `FL-KNE-1190` in HIP-526).

### P6. Medium: training attributes lacking data (fork, `work-789/train.mjs`)
- **Dependencies:** rendered pre-T claims are 567 `needs`, 19 `blocked`, 3 `eta`. Of 96 orders with a sibling input, 7 have a rendered pre-T ETA for it.
- **Progress rank:** planned issues carry no assembly; HIP, LEG and STR each cover two assemblies.
- **Pressure:** reply speed and 524 filler Jira comments ("any update?") are random; see also S2.
- **Change:** no `need_earlier`, `owner` or `duration` claims exist (verifier).
- **Supported:** timing (100 of 154 usable orders have a pre-T crumb stating the order's need-by), people, freshness, meetings (22% have a mention), the entry (rebuildable from the Xometry line and file name). 34 usable orders have no pre-T record, all never-discussed.

### P7. Low
- Only three jobs have priority 0 (actuators crumbs 10-19, 10-26, 11-02); the demo context's week of 10-12 is priority 9 (fork).
- Jobs carry internal ids (`claim.value: "dl-hip-motor-dvt"`, `p-`, `ev-`) against I19 (fork).
- `blocked` fallback reads reversed: `ev-002532` "Hip actuator bracket blocked (Hip actuator DVT spin test)"; `ev-002533` names only "the test" (fork).

---

## 3. Meetings, Ramp and other renderers

- **Medium, Ramp (fork):** MCC is null on all 2,650 transactions. Placeholder descriptors repeat: `AMZN Mktp US*A1B2C3D4E` ×117, `FEDEX 781234567` ×43, `UPS*1Z8F44E20393` ×49.
- **Low, meetings:** `checks` gives 10.275 recorded meetings a week against 12-18 (I39); the fork counts 119 in the window. The 42 files in `out/meetings/` and the 68-byte `BLD.json`, `ELEC.json` and `TEST.json` are blank background text being dropped, not missing data (fork).
- **Low, demo quote (fork):** `Q-2617750-1` is numbered below the previous day's `Q-2644496-1`, and has $3,000.00 with zero tax, unlike the 490 historical quotes.

---

## 4. Checks and the probe

### C1. Critical: the probe's days-to-need bin measures the wrong thing
Method: `work-14/learn.mjs`. It rebuilds the probe's bin from `checks.mjs` lines 403-407 and cross-tabs it against `stdMiss` = Standard `est_delivery` > `need_by_believed`.

- The decision (`sim/orders.mjs` lines 334-337) compares Standard `est_delivery` with the need-by. `est_delivery` is lead plus 1-4 wd of transit (measured: 125, 121, 116 and 128 orders at 1, 2, 3 and 4 wd).
- The probe compares working days to need-by with the Standard lead alone.

| Probe bin | Standard misses need-by | Standard makes it |
|---|---|---|
| `lt_std` | 58 | 0 |
| `std_econ` | 86 | 73 |
| `econ_10` | 3 | 156 |
| `more` | 0 | 37 |

- In the test split the `std_econ` bin is 42 Expedite, 22 Standard, 2 Economy, and the table predicts Standard.

Accuracy on the answers test split (167 orders), tables fitted on its train split (290):

| Predictor | Accuracy |
|---|---|
| Always Standard | 0.449 |
| Probe (`checks`) | 0.443 |
| Probe's days-to-need rule (`checks`) | 0.485 |
| `stdMiss` alone | 0.695 |
| `stdMiss`, never-discussed masked | 0.641 |
| `asks_expedite` alone | 0.527 |
| Burst, highest crumb pressure, or requester alone | 0.449 each |
| Hidden reason alone | 0.802 |

`answers.summary.probe.days_to_need_rule_accuracy` is already 0.695, because `sim/answers.mjs` uses `est_delivery`; the two files disagree.

Fix: bin on Standard `est_delivery` minus need-by.

### C2. Critical: the hidden-reason band cannot be met
Method: `learn.mjs`, majority tier per reason.

| Reason | Expedite | Standard | Economy |
|---|---|---|---|
| cheap_default | 3 | 201 | 37 |
| genuine_gain | 36 | 27 | 0 |
| personal_habit | 29 | 21 | 2 |
| budget_squeeze | 0 | 13 | 24 |
| insurance_or_spare | 2 | 10 | 12 |
| ordered_late | 22 | 3 | 0 |
| pressure_manager_or_demo | 20 | 1 | 0 |
| no_gain_other_input_later | 17 | 0 | 0 |
| test_slot_cliff | 10 | 0 | 0 |

- In-sample ceiling of reason → tier: 0.757 on all orders, 0.802 on the test split, 0.844 with the habit type added.
- The probe's 0.647 is lower because its first cell is reason × bin × pressure × tercile × burst, which is sparse and fitted on the other regime.

Fix: score the sanity check on Expedite-or-not with the habit type (reason alone then errs on 59 of 490 orders, 88%), or lower the band to about 0.75.

### C3. Critical: the probe trains and tests on different regimes, and not on the real split
| Set | Orders | Expedite | Standard | Economy | In burst weeks |
|---|---|---|---|---|---|
| Answers train (03-10 to 09-09) | 290 | 21% | 61% | 18% | 39% |
| Answers test (09-10 on) | 167 | 46% | 45% | 10% | 88% |
| Coverage train | 108 | 50% | 42% | 8% | 94% |
| Coverage test | 46 | 39% | 46% | 15% | 85% |

- The always-Standard band of 50-60% cannot hold on either test set; the usable window is the two DVT bursts.
- The model will be trained on the coverage split, which the probe never uses. On it: always Standard 0.457, `stdMiss` 0.717, `stdMiss` masked 0.630, reason 0.761.

Fix: run the probe on the coverage split and restate the baseline band for the usable window.

### C4. Low
`checks` prints "not yet checked: I18 Jira quote id and Slack/Jira identity agreement; I32; I35; I36; I37; I38; I42". P2 and P3 fall inside I36-I38, so nothing catches them.

---

## 5. Seeds

- **Critical (with S1):** the pinned motor history has no `where` and a Saturday statement (11-07); the demo block's `motor.stated_at` is the same Saturday.
- **High (fork):** the policy beat says Arjun sets $600/day in week 11-09, against 10-05 in `policy.json`.
- **Low (fork):** the seed beat "ordered late again" matches a hidden-reason label.
- **Low (fork):** only the Slack actuators channel carries demo-priority jobs.

---

## Checked and found sound

- **Truth arithmetic, all 490 orders (`truth.mjs`), zero mismatches:**
  - every line's demand resolves, and its order, part, feeds and need-by agree;
  - a part → consumer edge exists for every fed line;
  - the chosen tier's ready date equals `ready_at`;
  - realized start, work-item end and milestone date equal the world's;
  - `days_gained`, `true_slack_days`, `expedite_helped` and the break-even recompute exactly;
  - ready dates are ordered Expedite ≤ Standard ≤ Economy;
  - no start precedes its own or another input's ready date, or a test's `earliest_start`;
  - the 77 orders that feed nothing have zero gain;
  - reasons agree with outcomes (no-gain ⇒ Expedite and no gain; late ⇒ `late_by_choice`; spare ⇒ spare demand; budget ⇒ never Expedite).
- **Beliefs (`learn.mjs`):** 28 of 28 test-fed orders have need-by = believed test start at `requested_at` − 2 wd. 188 of 188 `belief.inputs` dates equal the ETA history at the cutoff.
- **All 16 tests (`chain.mjs`):** every required part was ordered and ready before the test; no test started before an input; deliverable and work-item slips propagate (e.g. `wi-90011` done 11-03 → `test-battery-thermal` 10-07 → 11-04 → `m-leg-dvt-build` 11-05).
- **Imperfections (`events.mjs`):**
  - 164 corrections are each later than their target, state the target's true value and keep its subject;
  - 66 wrong crumbs are never corrected;
  - stated and true values differ on every non-true crumb and agree on every true one;
  - stale ETAs state a value that was announced earlier;
  - `orders` and `orders_after` agree with T.
  - These are gradeable from `world.events[].claim.true_value`; `answers.json` holds no per-crumb truth.
- **Leaks and causality in `out/` (fork):** no hidden keys, labels or internal ids; no record after demo-now; 20 open orders show no delivery; chosen tier and Ramp = Xometry total match on 490 of 490; across 712 pre-T record-order pairs no order number, and tier words only in `asks_expedite` crumbs.
- **Jobs and realism (fork):** index order; all 394 weekday-and-date phrases; no duplicate seconds; tax, shipping, tier ratios, lead triples (4% repeats); order numbers increase; no orders on full holidays; names and vendors.

## Not covered
Ramp bills, the calendar file, bot posts, format conformance of `out/` against real exports, meeting-transcript feasibility, provenance, and 702 `reports` values that are not slip ids.

## Writer agents
Per agent: 4-6 Slack crumbs jobs, or 5-8 Jira or meeting jobs, or 60-80 KB of Slack background (fork). Fix P1 before any crumbs job is filled and S1 before the demo jobs are filled.

---

## Status after the audit

The findings were sent to the three owning agents the same evening (simulator and probe; plan, Slack and Jira; meetings and Ramp). What each fixed is recorded in the commits that follow `e8c0f96` on the branch.
