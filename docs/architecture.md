# Burn: expedite-decision architecture (joint Claude + Codex)

Status: **Jointly reviewed and approved by Claude and Codex (v4); proposed for Arjun and Owen.** This approves the architecture only; it does not authorize implementation. The product inputs only Arjun and Owen can provide stay open questions (§16), not hidden assumptions. Architecture only.
Inputs: Arjun + Owen design conversation (`data/design/transcript-arjun-owen.md`, local only); independent positions (`claude-position.md`, `codex-position.md`); critiques and settlement (`claude-critique.md`, `codex-review-r2.md`, `codex-settlement-r3.md`); worked example (`worked-decision-example.md`).

## 1. Problem and scope

The proposal borrows one idea from software workflows: linked issues with owners and history, so you can see what depends on what. It applies that idea to a hardware-specific timing problem: supplier production, transport and inspection time for custom parts. Today, a team's knowledge of what a custom part feeds is spread across Slack, DMs, meetings, a partial Jira, the CAD/PDM tree, and people's heads. Whether to pay for faster manufacturing is usually an engineer's judgment call, relayed to supply chain.

**Burn answers one decision:** *for a custom CNC part the engineer has already specified and sourced, which quoted production/shipping option, and when to order, is justified by its effect on the work waiting for it?*

| In scope (v1) | Out of scope (v1) |
|---|---|
| Custom **CNC-machined** parts with tiered instant quotes (Xometry-style) | Off-the-shelf parts; PCB and sheet metal (a later, separately proposed expansion with its own calendars and constraints) |
| Choosing among valid quoted options; ordering now vs. a guaranteed later option | Choosing the supplier or region (US vs. China, quality): **the engineer's judgment, deliberately deferred** |
| Explaining the schedule effect and economics; routing questions one at a time; approval audit | CAD understanding or geometry; uploading CAD to vendor sites; automatic purchasing |
| Latest-order windows for confirmed demands | Inventing demand from chat; company-wide scheduling or optimization; budget creation |

The data model uses a general *supplier-fixed, made-to-order tiered quote* schema internally. Shared arithmetic doesn't imply we've evaluated other part types.

## 2. Settled decisions

Each decision is listed with the alternative we rejected and why.

1. **Part-first, reverse computation.** A concrete quote starts the work. We walk from that part to the work and milestone it feeds. *Rejected:* an agent that ingests everything and decides what to buy (unbounded context, untestable).
2. **One shared evidence store and planning model, with bounded jobs.** *Rejected:* one persistent agent per project (divergent memories, and cross-project edges become negotiations between agents). Records own state. Models propose over snapshots and never approve their own output.
3. **The BOM anchors identity, not dependency truth.** PDM/BOM supplies part identity, revision, quantity, release state and structural membership, and automatically links an unambiguous quote to its BOM item. Process, test and use dependencies form a separate dependency graph, built from accepted claims plus the engineer: which test needs the part, partial-test feasibility, substitutes, inspection, fixtures. *Rejected:* "every part is in the BOM, so the existence problem is solved". Fixtures, tooling and unreleased variants can sit outside it, and membership doesn't say *when* or *for what* a part is needed. Without a BOM, Burn can still make one bounded decision from an explicitly scoped requirement, but it can't claim company-wide gap detection.
4. **Evidence and accepted planning facts are separate layers.** Extracted claims stay assertions until accepted into the planning view. *Rejected:* latest-claim-wins (later messages can be tentative, about another revision, or from someone without authority).
5. **Marginal, same-world comparison.** Every admissible action is compared with the others in the *same* scenario. Quotes, the baseline and every other assumption stay fixed across actions. *Rejected:* "downstream people × slip" and all-fastest baselines, which count reachability as impact.
6. **A dollar valuation is needed only for a genuine price/time trade-off.** Burn always shows the break-even $/day. It decides in this order:
   1. **Admissibility.** A valid, unexpired quote; a compatible revision, use and quantity; authority; owner-approved hard constraints.
   2. **Dominance (no valuation needed).** A robustly dominated option is eliminated, and the cheapest option with an equally good outcome is recommended.
   3. **Owner-approved policy.** An explicit risk or priority policy can select an action.
   4. **Economic trade-off.** Uses an **owner-approved value-of-time curve or range**, set once per milestone or policy revision, not per order.

   With none of these, Burn shows the options and the break-even and asks the milestone owner. Preferences inferred from history are advisory until an owner authorizes their use. *Rejected:* summing salaries of downstream people, and a default "gating fraction". Both invent a valuation and double-count serial work. A capacity-based estimate is an opt-in, separately labelled method needing real allocatable person-time; it is never a default and is never added to a milestone curve.
7. **Scenarios and switching conditions by default; probabilities only with a source.** Monte Carlo is an optional mode, used only with empirical or explicitly elicited distributions. *Rejected:* treating extraction confidence as probability; calling sensitivity checks EVPI; a default minimax rule the model picks for itself.
8. **Questions earn their interruption, one at a time.** We ask when a plausible answer changes the action or its justification and can arrive before it matters. We re-solve after each answer. Retrieval from trusted evidence comes first.
9. **Learning starts with measurable facts.** Vendor quoted-vs-actual ready-to-use time, approval lag and inspection time come first. Implied preferences come later, only from decisions *we logged prospectively*, and stay advisory. *Rejected:* training on Ramp receipts. Receipts lack the unchosen options and context, and a payment isn't proof of delivery.
10. **Slack-first surface, with a web view for explanation and audit.** *Rejected:* browser extension first (per-user install, brittle per-site scrapers, and the approver often isn't the person browsing). It remains a possible later capture adapter for quote options.

## 3. Workflow

Actors: the **engineer** (owns the part and its demand), **supply chain** (places the order), the **approver** (a lead or a policy threshold), and the **milestone owner** (owns the value-of-time policy).

1. The engineer posts in the supply-chain thread as today: part, revision, quantity, quote link or PDF.
2. Burn captures the **QuoteSet** and resolves the part against the BOM.
   - An exact revision match is accepted under the source policy and shown, cancellable.
   - The engineer is asked only about an ambiguous identity, an incompatible revision or use, an unresolved quantity allocation, or a material contradiction.
3. Burn retrieves evidence the participants are allowed to see and builds the planning view for the affected subgraph.
4. Burn computes the admissible actions and their outcomes per scenario.
5. If a decision-critical gap remains, Burn asks its owner **one question at a time** (gates first, if trusted evidence can't settle them), then re-solves. If the interruption budget runs out, the decision ends in an explicit *unresolved / escalated* state, never with defaulted facts.
6. Burn posts a **recommendation card** in the thread with:
   - each option's ready-to-use date and the milestone effect
   - spend and the break-even $/day
   - the decision basis: dominance, policy or valuation, with its source
   - the switching condition
   - any open assumptions
7. The approver approves or overrides in Slack, giving a reason on override. The decision revision is frozen.
8. If a quote or evidence changes, Burn proposes a new decision revision. A *material* change invalidates a pending approval. Approved commitments are never rewritten; they are revalidated before execution.

Engineer steps added: none in the common case; occasionally one tap or one sentence. Milestone owners set their policy once per milestone.

## 4. Runtime and lifecycle

```
 sources (Slack, calendar, files) ──► Sync jobs ──► DocumentRevision store (immutable, access-scoped)
                                          │
                                          ▼
                                 Extraction jobs ──► Claims (proposed) ──► Acceptance ──► PlanningView
                                                                                            │
 Slack request ──► Decision orchestrator (per decision) ◄───────────── snapshot ───────────┘
                     │  admissible actions × scenarios → schedule → outcomes → basis
                     │  question loop (one at a time, re-solve)
                     ▼
                DecisionRevision ──► Slack card / web explanation ──► Approval ──► PO placement
```

**Decision states:**
- `captured` → `resolving` → `needs_answer` ⇄ `resolving`
- `resolving` → `recommended` → `approved` | `overridden` → `placed`
- side exits: `unresolved` (escalated), `superseded` (a new revision), `invalidated` (a material change before approval)

**Runtime contracts:**
- Sync and extraction jobs run independently of decisions. A decision always reads a frozen snapshot hash.
- Progress shown in the UI comes from real backend run and tool events, never simulated timers.
- **Access scope** is carried through retrieval, question routing, explanations **and the Slack card itself**. A source record in the store doesn't mean every approver may read its raw private text. Cards and explanations reveal only what their audience is allowed to see. **That includes derived conclusions**: leaving out a private quote doesn't permit disclosing its substance. When a decision depends on evidence the audience can't see, the card says so and routes the matter to someone with access.
- Secrets stay server-side. Document text is data: it can't trigger tools or change policy.

## 5. Core objects

```
Part(number, revision, release state) · Assembly(BOM node) ◄─ membership (BOM)
Demand(part rev, qty, use/test, assembly, usable-by, owner)        ◄─ what a quote satisfies
QuoteSet(vendor, quote revision, valid-until, cutoff, time zone)
  └ QuoteOption(tier, total price, mfg days @shop calendar, ship promise @carrier, source)
Order(requested-at, approved-at, placed-at, acknowledged-at) · Shipment(dispatched-at, delivered-at)
Inspection(received-at, ready-to-use-at @site calendar) · Allocation(qty → Demand)
Milestone(target, owner, hard|soft, ValuePolicy: curve | range | none)
Method(requires-all inputs | alternative method with fit/quality/qty/permission filters)
WorkItem(duration: known | range | unknown, assignees, calendar) · Resource/Booking(slots)
DocumentRevision(source, access scope, immutable spans)
  → Claim(typed, subject+revision+use, effective interval, speaker, authority,
          status: proposed|accepted|disputed|superseded)
PlanningView(snapshot hash: accepted facts + named assumptions + open gaps)
Scenario(world assumptions) × Action(option, placement time, confirmed method) → Outcome
Question(kind: gate|elective, owner, response deadline, sensitivity, why it matters)
DecisionRevision(snapshot hash, admissible set, outcomes, basis, approval, override reason)
```

**Typed claim kinds** (extraction schema):
- `needs(demand, by, for_use)`
- `eta(item, date)`
- `done(work)`
- `blocked(work, on)`
- `owner(item, person)`
- `need_earlier(item, date, reason)`
- `substitute(item, alternative, applicability)`
- `duration(work, range)`

Meeting noise is handled by extracting only **supported, decision-relevant typed assertions**, with proposal/disputed status, and ignoring irrelevant detail. Segments are never discarded by genre: an engineering debate can contain the deciding substitute, usable-by or test constraint.

## 6. Pipeline

1. **Ingest** document revisions. The demo bundle has four inputs, all replaceable adapters, so no live PDM, Ramp or meeting connector is needed for the architecture proof:
   1. a scoped BOM/assembly manifest
   2. a revision- and quantity-specific tiered quote set
   3. source messages, selected meeting transcripts and the milestone/calendar plan
   4. **owner-approved valuation and approval policy**

   A small order/delivery event history illustrates the facts layer and existing allocations. Slack and the calendar can also be read live, as already built. Each decision's full quote set, snapshot and outcome is logged prospectively from the first run.
2. **Extract** typed claims, with spans, from messages and transcripts. Model text is untrusted data.
3. **Resolve** mentions against a closed candidate set: BOM numbers exact, names fuzzy, the model as tie-breaker. A failed resolution stays unresolved; it is never guessed. A name similarity never authorizes a revision substitution.
4. **Accept** claims into the planning view. A later assertion supersedes an earlier one only when it is authorized and applicable (same subject, revision and use, within its validity). A timestamp or model confidence alone never settles a conflict. Validity is fact-specific: quote expiry, release, deadline. Material conflicts stay **unresolved**, so they become gaps.
5. **Decide.** The orchestrator owns scheduling, retries and the question loop. The model extracts and explains. It can't invent costs, redefine demand or approve.

## 7. Decision mathematics

**Time semantics.** These events are distinct and are never added twice:

> decision request → approval complete → **placed-at** → supplier acknowledgement → dispatch → delivery → inspection → **ready-to-use**

Manufacturing runs on the shop calendar (with cutoffs and time zone), shipping on the carrier's promise and calendar, and receiving and inspection on the site's calendar. An option's ready-to-use time composes these clocks from its placement time. Approval lag applies only when placement hasn't happened yet. "Day N" arithmetic is a conceptual simplification.

**Admissible actions.**
- An action is a quote option × placement time × confirmed method.
- **Inadmissible:** an expired or invalid quote, an incompatible revision, use or quantity, a lack of authority, a failed owner hard constraint. Such options may appear as a reference, never as a recommendation.
- A **soft target** miss doesn't make an option inadmissible; it incurs loss under the owner's policy.
- **Waiting N days** is a conditional scenario unless future price, availability and cutoff are actually guaranteed.

**Schedule (per scenario).**
- Precedence over the dependency graph on working calendars. `requires-all` waits for all inputs.
- **Alternatives are explicit methods**, filtered by revision, fit, quality, quantity, permission and resource feasibility, and evaluated as separate actions. They are never an indiscriminate minimum, which could pick an unapproved substitute or allocate the same lot to two demands.
- Allocations, bookings and scarce resources belong to each scenario. Unknown durations stay unknown.
- The result is labelled a **lower bound** only where known durations and constraints support one. An unbounded unknown duration makes the outcome **unknown**, never an optimistic substitute.
- A cycle or contradiction blocks or qualifies the result; it is never dropped.

**Comparison.**
- **Milestone effect** ΔT_m(a, s) = T_m(cheapest admissible, s) − T_m(a, s).
- **Break-even** = extra spend / ΔT_m when ΔT_m > 0. If ΔT_m = 0, there is no schedule justification ("another input dominates").
- **Dominance and policy first.** Then, with an owner value curve V_m: loss(a, s) = spend(a) + V_m(T_m(a, s)). Use one explicit economic outcome model with deduplicated cost components. Independent, non-overlapping outcomes can add (e.g. two distinct contractual penalties); overlapping valuations of the same loss or project value never do. A cliff (missed launch, missed test slot) is part of V_m or of the slot model, not a linear rate.

**Across scenarios**, without probabilities, report:
- dominance and robust dominance (holding only across the **declared** scenarios, not a proof about unobserved worlds)
- outcome and loss **ranges**
- the **switching condition**
- tie-breaks, and how sensitive the result is to which scenarios were included

A worst-case or minimax-regret rule is used only if an owner adopts it as explicit policy (regret needs a loss model too); otherwise Burn shows the Pareto options. **Optional Monte Carlo** runs only with empirical (vendor lateness) or explicitly elicited distributions, using shared latent draws across actions and preserving supplier, customs and resource correlations.

### Worked example (synthetic inputs, integer working days from placement)

Owen's released hip-actuator bracket (a fixed revision and quantity; supplier and quality already accepted) feeds an integration that also needs Arjun's motor:
- **Standard:** $3,000, bracket ready on day 10.
- **Expedited:** $3,900, ready on day 5.
- **Integration:** 3 working days after **both** the bracket and the motor (ready on day M) are ready.
- Spin-test completion T = max(bracket, M) + 3, with the same M for both actions.
- No resource conflict is assumed, and the card says so.

| Case | M | Standard | Expedited | Result |
|---|---|---|---|---|
| A. Partial acceleration | 8 | day 13 | day 11 | ΔT = 2 → break-even $900 / 2 = **$450/day**. At the owner policy of $600/day with a day-11 target: avoided loss $1,200 − $900 = **+$300**, so Expedited. No salaries counted. |
| B. Another input dominates | 12 | day 15 | day 15 | ΔT = 0 → Standard **dominates**; no valuation needed, even though the target is missed. |
| C. Every option is late | 8, target day 10 | 3 days late | 1 day late | Avoiding 2 days × $600 = $1,200 > $900, so Expedited. "All late" doesn't make expediting worthless (with a linear policy; a cliff changes this). |
| D. Unknown motor date | 7–12 | — | — | ΔT = 3, 2, 1, 0 for M = 7, 8, 9, ≥10. At $600/day Expedited wins iff M ≤ 8. **Ask the motor's owner** "ready for integration by day 8?", after checking the evidence. A day's wait for the answer is re-checked against the quote cutoff. No numeric EVPI, and no treating an LLM confidence of 0.8 as P(M ≤ 8). |
| E. Test-slot cliff | — | — | — | With chamber slots on days 14 and 21, a one-day improvement can save seven days or none. What matters is readiness at the slot, including preparation and reservation validity. |

**Card for Case A:** "Expedited: +$300 under the spin-test policy ($600/day, owner: Arjun). It is justified while a day is worth more than $450. Assumes the motor is ready by day 8 and no bench conflict; if the motor slips to day 10 or later, Standard dominates."

## 8. Questions and the existence problem

We can't detect knowledge that exists only in someone's head in general. We *can* detect **decision-critical gaps against a declared coverage boundary**: the BOM plus declared extras such as fixtures, test plans and milestones.

| Gap | Detected as |
|---|---|
| **Structural** | A demand with no usable-by; a BOM item feeding a milestone with no order or ETA; an assembly with no milestone; a mention that resolves to nothing |
| **Validity** | An expired quote, a superseded revision, a deadline past its validity |
| **Conflict** | Unresolved contradictory candidate claims |
| **Shadow of tacit knowledge** | Behavior the model can't explain, e.g. an expedite request where the schedule shows slack. This prompts a typed question ("Is there an earlier need, e.g. a test slot?") rather than an assumption |

**Question loop.**
- **Order the candidates** by action sensitivity, by whether evidence could answer them without asking, by owner, and by response deadline vs. the order cutoff.
- **Ask one; re-solve; repeat.** A recommendation is never shown as confident while another decision-critical gate remains open.
- **Gates** (validity, authority) are settled from trusted evidence first and asked only if needed.
- **Sensitivity test (no probabilities):** re-solve under each plausible answer and ask only if the action or its justification changes.
- **With credible probabilities:** the value of the *obtainable* answer (noisy, delayed, net of interruption cost) replaces the sensitivity test. EVPI is only an upper bound.
- **Interruption budget:** when it is exhausted, the decision ends in `unresolved` with an escalation.

## 9. Proactive ordering

For a **confirmed** demand (revision, quantity and usable-by confirmed, existing inventory and allocations checked first), Burn schedules backwards on the same calendars and booked resources as the expedite decision. That gives a **latest-placement window** per admissible option, rather than a subtraction across mixed time units. Nudges:
- "place by Thu at Standard, or pay $X later" (if the later price is guaranteed; otherwise shown as a scenario)
- "all options late; B saves 3 days"
- "faster changes nothing; Y dominates"

Burn never creates demand from a chat mention. An unreleased or churning revision is a **risk signal** shown on the card, not proof that ordering early is wrong.

## 10. Learning

- **Now (facts).** Quoted vs. actual ready-to-use time per vendor and option, approval lag and inspection time, from order, ship, delivery and inspection events. **A payment receipt is not proof of delivery or inspection**; each observed outcome carries its own source and time semantics. These feed scenario ranges and, once the sample is large enough, empirical distributions.
- **Later (preferences).** From prospectively logged decisions (quote set + snapshot + choice + override reason), infer bounds on the value of time a team acts on. Show it as an *assumption-bound implied preference* next to the owner's stated policy ("your choices imply ≥ $300/day; your policy says $150/day"). It is **advisory until the owner authorizes its use**: never measured causal cost of delay, never learned from records without the option set.

## 11. Surfaces

- **Slack bot (primary):** capture, recommendation card, one question at a time, approval and override buttons, revalidation notices.
- **Web (secondary):**
  - the evidence trail per claim, limited to the reader's access
  - the decisive dependency path with scenario toggles; this highlights the path that decides the outcome, not every downstream person
  - value-policy settings for milestone owners
  - decision revision history and audit

The existing `/graph` and approvals views evolve into this.

## 12. Validation (what we defend)

**Design acceptance scenarios.** Each must produce the stated behavior:
1. Faster bracket, motor still later: zero acceleration, so no schedule justification (worked example, case B).
2. All options late: an option that still improves a valued outcome remains worth considering (case C).
3. A booked test slot: compare which options catch it (case E).
4. One engineer on two delayed serial tasks: no duplicated person-days.
5. Rev B substitution: only the affected work changes; the thermal work still needs Rev C.
6. An old Slack deadline conflicts with a meeting update: the conflict is exposed, not auto-picked.
7. Two orders, two assemblies, a partial delivery: allocation decides which demand is met.
8. Answers wouldn't change the action: no elective question.
9. The quote expires during approval: a new revision and revalidation.
10. A historical receipt without unchosen quotes: no preference or savings claim from it.
11. A sibling input dominates (the harness case): "faster changes nothing", naming the dominating input.
12. Tacit-need shadow: an expedite request when the schedule shows slack triggers a need-earlier question.
13. Two decision-critical gaps: questions are asked in sequence; there is no confident card after the first answer.

**Synthetic worlds.** A simulator diagnostic: a robot program with BOM, Slack, meetings, calendar and order/delivery events, with planted gaps and hidden true durations. All numbers are reported as "in this simulator, under these assumptions".
- Fitting and evaluation are split by time and project.
- The test worlds include model-mismatched worlds, correlated delays, missing alternatives, resource constraints, stale or conflicting evidence, uncertain durations and changing owner preferences.
- Generating the model and its test data from the same assumptions proves nothing.
- Prefer a few rigorous worked worlds over an arbitrary scale target.

Each stage gets its own metrics:
- **Extraction:** evidence-supported assertion precision.
- **Schedule:** validity.
- **Decision:** regret under the declared simulator loss, and milestone/cost Pareto quality.
- **Questions:** unnecessary-question rate, and material-gap detection on planted gaps.
- **Facts layer:** quoted-vs-actual timing calibration, when the sample supports it.

We make **no production ROI claims** from synthetic data, and no claim of recall for unknown facts in general.

## 13. Phased design plan (design phases, not build tickets)

1. **Decision core.** Records (Demand, QuoteSet, Milestone and its policy, DecisionRevision), time semantics, admissibility, same-world schedule comparison, dominance and break-even. The worked example's cases A–C and scenarios 1, 2, 11.
2. **Evidence layer.** Access-scoped document revisions, typed claims, an acceptance/supersession policy, conflicts as gaps. Scenarios 5, 6, 12.
3. **Questions and surfaces.** The question loop and gates, the Slack card and approval, revisions, invalidation and revalidation. Cases D and E; scenarios 8, 9, 13.
4. **Proactive and learning.** Latest-placement windows, the facts layer from delivery and inspection events, prospective decision logging. Scenarios 3, 4, 7, 10.
5. **Simulator evaluation.** Mismatched and correlated worlds, per-stage metrics.

## 14. Current repo vs. this architecture

| Area | Keep | Change | Known defects to fix |
|---|---|---|---|
| Ingestion (`server/connectors`, `server/ingest`) | Slack/ICS connectors, versioned graph, per-channel cursors | File imports (BOM, quotes, transcripts, order/delivery events, value policy); immutable, access-scoped document revisions | — |
| Extraction (`server/graph/extract.js`) | Cited edges, closed key set for model output | Typed claims with spans and status; BOM-anchored resolution; rules only as fallback | Edges go straight into the plan without an acceptance step |
| Engine (`src/graph/engine.js`) | DAG scheduling, OOO windows, booking conflicts, critical path | Time semantics and calendars; explicit methods for alternatives; same-world admissible comparison; scenarios; dominance and break-even | Unknown duration defaults to 1 day; cycles are reported but scheduling continues; `idleCost` uses an all-fastest baseline and prices people-days |
| Money (`src/decisions.js`) | Approval policy shape | Remove the hardcoded `blocked`, `slack` and `chain`; use owner value policies and break-even | $1,100 × people × days presented as a cost |
| Requests/approvals (`server/store.js`) | Lifecycle, revisions, audit, draft POs | Decision states and revisions with frozen snapshots; quote expiry; invalidation; override reason | — |
| UI (`/request`, `/approvals`, `/graph`) | Graph visual, evidence panel, approvals, real run events | The engineer surface becomes a Slack thread (web chat kept as a demo fallback); the card shows the decision basis, break-even and assumptions | "Idle engineering $" tile implies cash savings |
| Agent (`server/agent`) | Tool loop, offline fallback | Becomes the extractor/explainer behind the orchestrator; no free-form recommendation | — |

## 15. Disagreement log (how we got here)

| Topic | Claude R1 | Codex R1 | Settled |
|---|---|---|---|
| Dependency truth | The BOM solves existence for parts | The engineer links each order | BOM auto-resolution is primary and anchors identity; a separate process/test graph; no completeness guarantee |
| Valuation | Gated people × loaded cost × gating fraction | Break-even or Pareto only | Admissibility → dominance → owner policy → owner value curve, else break-even and a question; no gating fraction |
| History | Past choices → cost-of-delay inequalities | Receipts can't identify preferences | Facts layer first; implied preference only from prospective logs, advisory until authorized |
| Uncertainty | Monte Carlo + EVPI | Scenarios + thresholds | Scenarios and ranges by default; minimax only as owner policy; Monte Carlo only with sourced distributions |
| Claims | Latest wins, with decay | Authority, applicability, supersession | Codex's rule; fact-specific validity |
| Questions | At most one | Only if decision-changing | One at a time, re-solve, never confident while a gate remains |
| Scope | Mechanism-general (incl. PCB) | CNC | CNC product and demo; mechanism-general schema internally |
| Evaluation | Synthetic ground-truth metrics | Acceptance counterexamples | Both; synthetic results labelled as simulator diagnostics, per-stage metrics |
| Worked example | Calendar dates (contained a weekend error) | Integer working days | Codex's working-day example, cases A–E |
| Agents | One graph | No per-project agents | Agreed from the start |

## 16. Open questions for Arjun and Owen

1. Do target startups run PDM (Onshape, SolidWorks PDM), or a BOM spreadsheet? This determines the first import.
2. Who approves today: the ME lead, supply chain, or a $ threshold? Who would own a milestone's value policy, and would they set it?
3. Do purchase requests carry a need-by date or the intended test today?
4. Which meeting recorder, and do we get full transcripts or only summaries? Who may see which channels and transcripts (access scope)?
5. Do Ramp exports include promised dates or the quote's unchosen tiers? Does anything record delivery and inspection separately from payment?
6. For the demo: is the hip-actuator program the right story, and which three worked cases (A–E) do we show live?
