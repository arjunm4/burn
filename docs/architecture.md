# Burn: architecture

Status: **v8 draft.** This version consolidates Owen's decisions of 2026-11-10 into one consistent document and removes superseded material; the history is in §15. v5 was the last version jointly approved by Claude and Codex. Architecture only; no implementation authorized. Open questions are tracked in [`open-questions.md`](open-questions.md).

## At a glance

### Problem
When an engineer orders a custom machined part from a site like Xometry, they hit one field they can't easily answer: which **production and shipping tier** (e.g. Standard 10 days for $3,000, Expedited 5 days for $3,900). Today that's a gut call, and then the order is re-keyed, justified and approved by hand. The facts that should drive the choice are scattered across Slack, meeting notes, Jira, calendars and people's heads:
- what the part is for
- whether the engineer's own subsystem is ahead or behind its milestone
- what else that work is waiting on
- what a day of delay is actually worth

So teams overpay to expedite parts that wouldn't have sped anything up, underpay on the ones that would, and spend time on forms, approvals and expense memos.

### Product
**Burn is a hardware purchasing agent that plugs into Ramp.** The engineer tells Burn what part they need. Burn gathers the related context, fills the Xometry order, recommends a tier with a justification, sends the request through Ramp for the manager's approval, places the order with a Ramp card, and codes the expense.

> "Expedited gets the spin test done 2 days sooner for +$900. Worth it if a day is worth more than $450 (your policy says $600). If the motor slips to day 10, Standard is just as fast."

- **The engineer** enters the part name, a short summary and the CAD file, then clicks Okay (or edits, or argues).
- **The manager** approves in Ramp. Small orders are auto-approved by Ramp's own rules.
- **Supply chain** is not a purchase step. Their Slack messages are a trusted context source, and they see orders, tracking and exceptions.
- **Burn picks the cheaper option outright** when paying more buys no time, **asks one person** when the answer hinges on a missing fact, and **never invents a dollar value for time**.

**Who does what**

| Burn (hardware-specific) | Ramp (money) |
|---|---|
| Part entry, context gathering, Xometry fill, tier recommendation, frozen order spec, verified checkout, tracking, learning | Purchase request, manager approval and auto-approval rules, virtual card, receipt/memo/GL, item receipt |

### Flow

```
 1. Part entry      engineer: part name + short summary + CAD file
 2. Context         Burn retrieves related Slack, meetings, Jira, calendar → context record
 3. Form            Burn fills the order fields; asks only for gaps
 4. Quote           extension fills Xometry in the engineer's browser; reads back every tier
 5. Recommend       schedule effect, break-even, basis; best tier preselected
 6. Okay            engineer accepts / edits / argues → frozen order spec (hash)
 7. Ramp request    Burn creates it with justification + quote PDF
 8. Approve         manager approves in Ramp (or Ramp auto-approves)
 9. Card            Ramp virtual card: exact amount, Xometry only, lock date
10. Place           Burn places automatically on approval; it alerts the engineer
                    before the extension opens Xometry, then verifies every field
                    against the spec, pays with the Ramp card, places the order
11. Book            Burn sends receipt, memo, project/GL to Ramp when the charge clears
12. After           tracking, slip re-checks, delivery (Ramp item receipt), first use, learning log
```

### Example
1. Owen enters "hip-actuator bracket, for the spin test, need it soon" and attaches the STEP file.
2. Burn finds the #actuator thread: the spin test also needs Arjun's motor (ready day 8), and the test takes 3 days.
3. The extension fills Xometry. Standard: day 10, $3,000. Expedited: day 5, $3,900.
4. Standard finishes the test on day 13, Expedited on day 11: 2 days for $900, break-even $450/day. The spin-test policy says $600/day, so Burn preselects Expedited and states the assumption (motor by day 8).
5. Owen clicks Okay. The request appears in Ramp; Owen's manager approves.
6. Ramp issues a $3,900 card locked to Xometry. Owen clicks "place"; the extension checks every field and places the order.
7. When the charge clears, the receipt, memo and project code fill in. Later, delivery and first use are logged.

## 1. Scope

**Burn answers one decision and runs the order around it:** *for a custom CNC part, which Xometry production/shipping tier is justified by its effect on the work waiting for it, and then get it approved, paid, placed and booked with no re-keying.*

| In scope (v1) | Out of scope (v1) |
|---|---|
| Custom **CNC-machined** parts on **Xometry** | Other vendors (later adapters); PCB, sheet metal, off-the-shelf parts |
| Part entry, context retrieval, form fill, CAD upload, tier recommendation | Choosing the vendor; CAD geometry understanding |
| Ramp request, approval, card, booking and item receipt | Approval logic of our own (Ramp's rules govern) |
| Verified checkout via the browser extension | Server-side bots driving vendor sites |
| Tracking, slip re-checks, first-use check | Vendor-reliability learning (deferred) |
| A context-attribute model trained on past Ramp purchases (advisory) | Company-wide scheduling; budget creation; inventing demand from chat |

## 2. Settled decisions

Each lists what we rejected and why.

1. **Part-first.** The engineer's part entry starts the work; Burn walks from that part to the work and milestone it feeds. *Rejected:* an agent that ingests everything and decides what to buy.
2. **One shared evidence store and planning model, with bounded jobs.** Records own state; models propose over snapshots and never approve their own output. *Rejected:* one persistent agent per project.
3. **The demand anchors the decision; no BOM.** The demand is: this part, for this use or test, by this date, owned by this person. It comes from the engineer's entry plus accepted context, confirmed by the engineer. *Rejected:* the BOM as anchor; fixtures, test adapters, prototypes and rush revisions (the parts most often expedited) are usually outside it, and early teams often have no reliable BOM. *Cost:* no product-wide gap detection.
4. **Evidence and accepted facts are separate layers.** Extracted claims stay assertions until accepted. *Rejected:* latest-claim-wins.
5. **Same-world comparison.** Every option is compared in the *same* scenario. *Rejected:* "downstream people × slip" and all-fastest baselines.
6. **A dollar valuation is needed only for a genuine trade-off.** Burn always shows the break-even $/day and decides in this order: (1) admissibility, (2) dominance, (3) owner policy, (4) the milestone owner's value-of-time curve or range. With none, it shows the break-even and asks the milestone owner. *Rejected:* summing salaries; a default "gating fraction".
7. **Scenarios and switching conditions by default; probabilities only with a source.** *Rejected:* model confidence as probability.
8. **Questions earn their interruption, one at a time,** and only when the answer could change the action. Trusted evidence is checked first.
9. **Disagreement is first-class.** The engineer can argue; supported new context is accepted and Burn re-solves; the exchange is kept, typed and access-scoped. An argument never silently becomes a fact or a training label.
10. **Assembly readiness, not "who is blocked".** The question is whether faster delivery improves the assembly's readiness and its milestone. "Behind schedule" alone never justifies spend.
11. **The decision is a decomposition, not an additive urgency score:** eligibility → schedule → basis (dominance → policy → economics) → advisory comparison with the learned habit.
12. **Ramp owns the money.** Purchase request, approval (the engineer's manager), auto-approval of small orders, card, booking and item receipt are Ramp's. *Rejected:* Burn's own approval settings and a supply-chain purchase queue.
13. **Supply chain is a context source, not a purchase step.** Every human step must add judgment or own something; with Ramp approving and paying, a supply-chain click only adds delay. Their Slack messages (sibling ETAs, stock, cutoffs, vendor rules) are trusted for those topics.
14. **Xometry through a browser extension, behind a provider interface.** The extension works in the user's own logged-in session. The interface is upload CAD → quote tiers → place order → status. *Rejected:* a server-side bot (no official support, unverified terms, credentials on our servers). No CNC vendor has a usable buyer API today (§0.4).
15. **One frozen order spec, verified by read-back.** The engineer's Okay freezes every field, the CAD hash, quote ID, tier and price; the Ramp request carries its hash; checkout proceeds only if every field read back from Xometry matches. The engineer never re-checks.
16. **Burn places the order automatically once Ramp approval and the card are ready** (Owen's decision). It never opens a browser tab without alerting the engineer first. Guarded by spec verification, the Ramp card's exact limit and vendor lock, and idempotency.
17. **Learning is on the synthesized context, not the part.** One example is one Xometry purchase in Ramp at time T; inputs are attributes of the context available before T; the label is the tier chosen (§10). The model is advisory.

## 0. Detailed flow

*(Numbered 0 so section references from earlier versions stay valid.)*

### 0.1 Part entry and context
- The engineer enters the **part name and a short summary** in their own words (what it is, what it's for, anything urgent) and attaches the CAD file.
- The entry is the **retrieval query**: Burn finds related Slack threads, meeting notes, Jira tickets and calendar items and synthesizes the part's **context record** (§5, §6).
- Burn fills the order fields from the entry plus the context and asks only for gaps.
- The entry is stored verbatim with its time; it is itself a training input.

### 0.2 Quote and recommendation
- The extension opens Xometry in the engineer's browser, uploads the CAD, sets every field, and reads back every tier, price and expiry into a **quote snapshot**.
- Burn computes each tier's schedule effect and the decision basis (§7) and shows a comparison card (thumbnail, summary, tiers, break-even, assumptions) with the recommended tier preselected.
- The engineer clicks **Okay**, edits by chat or directly in fields, or argues. Okay freezes the **order spec**.

### 0.3 Ramp: request, approval, card, booking

| Step | Burn | Ramp | API status (research, Nov 2026) |
|---|---|---|---|
| Purchase request | `POST /unified-requests` in the engineer's name, justification in fields, quote PDF via `/attachments` | Shows a procurement request | Documented; early access per business |
| Approval | Follows `unified_requests.*` webhooks | Manager approves; auto-approval per Ramp rules | Documented; Burn cannot approve on the manager's behalf |
| Card | Requests it | Virtual card with exact `limit`, `interval: TOTAL`, `allowed_vendors`, `lock_date` (`POST /cards/vault`) | Works in sandbox; production needs Ramp PCI review; no explicit single-use flag |
| Booking | On `transactions.cleared`: `POST /receipts`, `POST /memos/{id}`, `POST /accounting/codings` | Records them | Documented |
| Delivery | Asks "arrived OK?" | `POST /item-receipts` against the PO | Documented; needs a Ramp PO (Plus or Procurement add-on) |

Demo: Ramp sandbox (demo.ramp.com; ⌘J simulates transactions). Access is requested through a form; apply early.

### 0.4 Placement
- When approval and the card are ready, **Burn places the order automatically** (Owen's decision). **The engineer is alerted before the extension opens Xometry**; a browser tab never opens without that alert.
- The extension reopens the **same Xometry quote** (company Teamspace, so the configuration is held by Xometry) or re-fills from the spec, **reads back every field**, and compares it with the frozen spec.
- All match → the extension enters the Ramp card and clicks Place order. Any mismatch → nothing is placed:

| Mismatch | Handling |
|---|---|
| A field failed to fill | Re-fill and re-verify; if it still fails, show the engineer the field |
| Price rose or quote expired | New Ramp request for re-approval; the configuration is unchanged |
| Xometry dropped an option the spec uses | Back to the engineer: the part itself would change |

- An idempotency key per spec prevents double orders. The Xometry confirmation is read and verified against the spec; the order number and promised date are written to the order record.

**Vendor API research (Nov 2026).** No CNC vendor checked offers a usable buyer API: Xometry's developer API is supplier-side; Xometry and Fictiv offer cXML punchout via enterprise sales; Protolabs, Hubs, SendCutSend, OSH Cut and others have none. AFN (agenticfabricationnetwork.ai) has a self-serve CNC API but no sandbox, acts as merchant of record (conflicts with the Ramp card), offers shipping options rather than production tiers, and is unproven; its API shape informs our provider interface. PCBWay/JLC (PCB, partner-only) and Shapeways/Sculpteo (3D printing) are later candidates.

### 0.5 After placement
- Tracking from Xometry emails and supply-chain Slack messages.
- **Slip re-check:** when the arrival or the need date moves, Burn re-solves and alerts only if the right decision changed.
- Delivery: one tap from the engineer, then a Ramp item receipt.
- First use: one tap a few days after delivery if no other signal appears. Unknown stays unknown.

## 3. Actors

- **Engineer:** enters the part, confirms context, clicks Okay and "place".
- **Manager:** approves in Ramp; sets the auto-approval rules in Ramp.
- **Milestone owner:** sets the value-of-time policy for a milestone, once.
- **Supply chain:** context source (ETAs, stock, cutoffs, vendor rules); sees orders; handles tracking and exceptions.

Engineer steps: part entry, Okay, place. Occasionally one tap or one sentence to answer a question.

## 4. Runtime and lifecycle

```
 Slack, meetings, Jira, calendar ──► sync ──► DocumentRevision store (immutable, access-scoped)
                                                 │
                                                 ▼
                                     extraction ──► Claims ──► acceptance ──► PlanningView
                                                                                 │
 part entry ──► context record ──► form ──► QuoteSnapshot ──► decision ◄─ snapshot ┘
                                                 │  options × scenarios → outcomes → basis
                                                 │  question loop (one at a time)
                                                 ▼
             DecisionRevision ──► Okay (frozen spec) ──► Ramp request ──► approval ──► card
                              ──► verified placement ──► booking ──► tracking ──► delivery ──► first use
```

**Order states:** `entered` → `resolving` ⇄ `needs_answer` → `recommended` → `specified` (Okay) → `requested` (in Ramp) → `approved` → `placing` → `placed` → `booked` → `delivered` → `in_use`. Exits: `rejected` (in Ramp), `cancelled`, `unresolved` (escalated), `superseded` (new revision), `invalidated` (material change before placement).

**Runtime contracts:**
- A decision reads a frozen snapshot hash; sync and extraction run independently.
- UI progress comes from real backend events, never simulated timers.
- **Access scope** is carried through retrieval, questions, explanations and the Ramp request text. Cards reveal only what their audience may see, including derived conclusions.
- Secrets stay server-side. Document text and vendor page content are data: they can't trigger tools, approvals, ordering or policy changes.

## 5. Core objects

```
PartEntry(name, summary, CAD file + hash, engineer, entered-at)
ContextRecord(part entry, linked document spans, synthesized summary, built-at)
Demand(part, qty, use/test, assembly, usable-by, owner, source: entry|context|engineer)
QuoteSnapshot(vendor=Xometry, quote id, configuration, captured-at, completeness,
              qty, currency, valid-until, cutoff, time zone)
  └ QuoteOption(tier, total price, mfg days, ship promise)
OrderSpec(every field, CAD hash, quote id, tier, price) → spec hash
Proposal(decision rev, selected option, rationale) · Exchange(typed statements; access scope)
RampLink(request id, approval status, card id, transaction id, PO id, item receipt id)
Order(specified-at, requested-at, approved-at, placed-at, xometry order no., promised date)
Shipment(dispatched-at, delivered-at) · UseEvent(first confirmed use, evidence, recorded-at)
Milestone(target, owner, hard|soft, ValuePolicy: curve | range | none)
WorkItem(duration: known | range | unknown, assignees, calendar) · Resource/Booking(slots)
DocumentRevision(source, access scope, immutable spans)
  → Claim(typed, subject+use, effective interval, available-at, speaker, authority,
          status: proposed|accepted|disputed|superseded)
PlanningView(snapshot hash: accepted facts + named assumptions + open gaps)
Scenario × Action(option, placement time) → Outcome
Question(kind: gate|elective, owner, deadline, why it matters)
DecisionRevision(snapshot hash, options, outcomes, basis, what Burn displayed, proposal)
```

**Two time keys on every fact:** *effective* (when it is true in the world) and *available-at* (when Burn could have known it). Replays and training use only facts available before the moment in question.

**Typed claim kinds:** `needs(demand, by, for_use)`, `eta(item, date)`, `done(work)`, `blocked(work, on)`, `owner(item, person)`, `need_earlier(item, date, reason)`, `substitute(item, alternative)`, `duration(work, range)`, `stock(item, qty)`.

**Authority by source:** engineers for use, need-by and design changes; supply chain for ETAs, stock, cutoffs and vendor rules; milestone owners for value policy.

## 6. Pipeline

1. **Ingest** document revisions from Slack, meetings, Jira and calendar (live Slack and calendar connectors exist; others are file imports).
2. **Retrieve** the documents related to a part entry: the entry text is the query; links by part name, file name, Xometry quote/order number, people and test names.
3. **Extract** typed claims with spans. Model text is untrusted data.
4. **Resolve** mentions against declared parts, tests, assemblies and milestones. A failed resolution stays unresolved.
5. **Accept** claims: a later assertion supersedes an earlier one only when authorized and applicable. Conflicts stay unresolved and become gaps.
6. **Decide.** The orchestrator owns scheduling and the question loop; the model extracts and explains, and cannot invent costs, redefine demand or approve.

**Staleness.** Each claim kind has a re-confirmation horizon. A stale fact stays in the plan but becomes a gap that can trigger a question if it could flip the decision. The card shows the age of every assumption it relies on. Age changes what Burn asks and shows, never how much a fact counts.

## 7. Decision mathematics

**Time semantics.** Distinct events, never double-counted: decision → approval → **placed** → acknowledgement → dispatch → delivery → inspection → **ready-to-use**. Manufacturing runs on the shop calendar (cutoffs, time zone), shipping on the carrier's, receiving on the site's. "Day N" arithmetic is a simplification.

**Admissible actions.** An action is a quote option × placement time. Inadmissible: an expired quote, an incompatible use or quantity, a failed hard constraint. A soft-target miss is a loss, not inadmissibility. Waiting is a scenario unless the later price is guaranteed.

**Schedule.** Precedence over the dependency graph on working calendars; `requires-all` waits for all inputs. Unknown durations stay unknown; a cycle or contradiction blocks or qualifies the result.

**Assembly readiness.** For the affected assembly: forecast readiness, need-by, remaining work, **slack in days** (negative shown), and each option's effect. Never the fraction of parts received. An optional buffer view appears only with an accepted baseline.

**Comparison.**
- Milestone effect ΔT_m(a, s) = T_m(cheapest admissible, s) − T_m(a, s).
- Break-even = extra spend / ΔT_m when ΔT_m > 0. ΔT_m = 0 means another input dominates.
- Dominance is judged across every independently valued outcome and every declared scenario.
- With an owner value curve V_m: loss(a, s) = spend(a) + V_m(T_m(a, s)). Cliffs (a missed test slot) belong in V_m or the slot model.
- Across scenarios without probabilities: dominance, outcome ranges, the switching condition.

### Worked example (synthetic, working days from placement)
Bracket: Standard $3,000 ready day 10; Expedited $3,900 ready day 5. Spin test = 3 days after both bracket and motor (day M) are ready.

| Case | M | Standard | Expedited | Result |
|---|---|---|---|---|
| A. Partial acceleration | 8 | day 13 | day 11 | ΔT = 2, break-even $450/day; policy $600/day → Expedited (+$300) |
| B. Another input dominates | 12 | day 15 | day 15 | ΔT = 0 → Standard dominates |
| C. Every option late | 8, target 10 | 3 days late | 1 day late | Avoiding 2 × $600 > $900 → Expedited |
| D. Unknown motor date | 7–12 | — | — | Expedited wins iff M ≤ 8 → ask the motor's owner "ready by day 8?" |
| E. Test-slot cliff | — | — | — | Slots on days 14 and 21: one day can save seven or none |

**Card for case A:** "Expedited: +$300 under the spin-test policy ($600/day, owner: Arjun). Justified while a day is worth more than $450. Assumes the motor is ready by day 8 (Arjun, 3 days ago); if it slips to day 10 or later, Standard is as fast."

## 8. Questions and gaps

Burn detects **decision-critical gaps against declared tests, assemblies and milestones plus confirmed demands**:

| Gap | Detected as |
|---|---|
| Structural | A demand with no usable-by; a declared test input with no order or ETA; a mention that resolves to nothing |
| Validity | An expired quote; a deadline past its validity; a stale fact |
| Conflict | Unresolved contradictory claims |
| Tacit-need shadow | An urgent entry where the schedule shows slack → "Is there an earlier need, e.g. a test slot?" |

**Question loop:** order candidates by whether the answer could change the action, whether evidence could answer it, owner and deadline; ask one, re-solve, repeat. Never a confident card while a decision-critical gap is open. When the interruption budget runs out, the order goes to `unresolved`.

## 9. Proactive ordering

For a confirmed demand, Burn schedules backwards to a **latest-placement window** per tier: "order by Thursday at Standard, or pay $900 more on Monday" (shown as a scenario unless the later price is guaranteed). Burn never creates demand from a chat mention.

## 10. Learning

**What is learned:** the team's habit of choosing tiers, as a function of **attributes of the synthesized context**, not the part itself and not vendor reliability. It is **advisory**: shown beside the recommendation with its sample size; the schedule and break-even computation remains the decision; a habit becomes policy only through an owner's explicit, versioned change.

**One training example:**
```
anchor:   a Xometry charge in Ramp at time T
text:     the engineer's part entry (or, for history, a reconstruction from the
          Xometry order line, file name and nearest messages, marked reconstructed)
window:   context related to the part, available before T, over ~30 days,
          bucketed into bands before T: 0–1, 1–3, 3–7, 7–14, 14–30 days (the heat map)
inputs:   attributes of that context (below)
label:    the tier chosen, from the matching Xometry order (Ramp's amount alone doesn't give it)
```

**Attributes:**
- Timing: days to the next need-by, test or milestone; how late in the run-up the order came.
- Pressure: urgency language; message rate and its trend; reply speed.
- Dependencies: who or what is waiting; whether a sibling part lands later.
- People: manager or supply chain involved; number of participants.
- Change: slips, conflicting dates, revisions.
- Freshness: age of key facts; distribution across time bands.
- Meetings: mentions, action items.
- The entry itself: stated urgency and purpose.

**Model:** small and explainable (e.g. gradient-boosted trees). Explanations are in context terms: "teams expedite when a test is ≤5 days away and the thread got hot in the last 48 hours."

**Backfill:** existing Ramp × Xometry × Slack history can produce a training set before Burn's first live order.

**Logged prospectively from the first order** (both time keys): the part entry; which fields came from entry, context, CAD or a question, and each fact's age; every tier shown and what Burn preselected; the engineer's edits and exchange; Ramp approval path and time; verification results; the placed order; delivery and first use. Logging Burn's own recommendation keeps its influence separable from the team's habit.

**Limits stated up front:**
- **Linking** a charge to the right context is the hardest step; report the clean-link rate before trusting the model.
- It learns habit, not correctness. Outcome signals (delivery, first use) are diagnostics for human review, never automatic labels of good or bad decisions.
- Small samples: show support and abstain when sparse.
- Slack access follows channel permissions.

## 11. Surfaces

- **Burn purchasing interface (engineer):** part entry, questions, the comparison card, Okay / edit / argue, the alert before automatic placement, order status.
- **Browser extension:** fills Xometry, reads back tiers, verifies and places.
- **Ramp:** request, approval, card, booking, item receipt (Ramp's own UI).
- **Slack:** questions to the person who knows; slip alerts; supply-chain visibility.
- **Web (evidence and audit):** evidence per claim (access-scoped), the decisive dependency path, assembly readiness and slack, milestone value-policy settings, order history and audit.

## 12. Validation and synthetic data

**Acceptance scenarios** (each must produce the stated behavior):
1. Faster bracket, motor still later: "faster changes nothing", naming the dominating input (case B).
2. All options late: an option that still improves a valued outcome stays worth considering (case C).
3. A booked test slot: compare which options catch it (case E).
4. One engineer on two delayed serial tasks: no duplicated person-days.
5. An old Slack deadline conflicts with a meeting update: the conflict is exposed, not auto-picked.
6. Answers wouldn't change the action: no question.
7. Two decision-critical gaps: asked in sequence; no confident card after the first answer.
8. The quote expires or the price rises after approval: new Ramp request; nothing placed.
9. A field fails to fill or reads back differently at checkout: nothing placed; re-fill or show the field.
10. The engineer supplies a supported earlier-use requirement while arguing: exchange kept, decision re-solved.
11. The quote capture omits tiers: disclosed; no optimal-tier claim, no training comparison.
12. Urgent entry while the schedule shows slack: a need-earlier question.
13. A behind-schedule assembly with a later lab blocker: expediting changes nothing.
14. Training: a fact that became available after T never appears in that example's inputs.
15. Training: a Ramp charge with no confident link to context is excluded and counted in the link rate.
16. Habit data sparse or contrary to policy: abstain or show the difference; policy governs.

**Synthetic data for the demo and training.** All context except Slack and the live Ramp order is generated:
- **One world script first:** the hip-actuator program, people and roles, milestones and tests, and ~100–150 past Xometry orders over ~9 months, each with its need-by, blockers, sibling ETAs, urgency, the chosen tier and the hidden reason.
- **Rendered into each source** with consistent names and timestamps: Slack messages, Jira tickets, meeting notes, calendar, Xometry order history and Ramp-shaped charges. An LLM writes the text from each scripted event; facts and times come from the script.
- **Noise:** off-topic chatter, corrected dates, undiscussed orders, panic expedites that bought nothing.
- **Real in the demo:** a demo Slack workspace seeded by the generator (so the channel can be scrolled live) and the Ramp sandbox for the live order.
- The hidden reasons are ground truth for evaluation only, never training inputs.
- Results are reported as "in this simulator, under these assumptions"; no real-world accuracy or ROI claims.

The current `fixtures/` (14 Slack messages about Rev C electronics, one calendar) will be replaced by the generator's output.

## 13. Phased plan (design phases, not build tickets)

1. **Decision core:** demand, quote snapshot, milestone policy, time semantics, same-world comparison, dominance, break-even. Cases A–C.
2. **Context:** part entry, retrieval, typed claims, acceptance, staleness, gaps and the question loop. Cases D–E.
3. **Ordering:** Xometry extension (fill, read back, verify, place), frozen spec, Ramp request / approval / card / booking.
4. **After placement:** tracking, slip re-check, delivery and first-use taps, Ramp item receipt.
5. **Learning and synthetic data:** world-script generator, backfill, context-attribute model, link-rate reporting.

## 14. Current repo vs. this architecture

| Area | Keep | Change | Known defects |
|---|---|---|---|
| Ingestion (`server/connectors`, `server/ingest`) | Slack/ICS connectors, per-channel cursors | Add Jira, meeting-note and Xometry/Ramp history imports; immutable, access-scoped revisions | — |
| Extraction (`server/graph/extract.js`) | Cited edges, closed key set | Typed claims with both time keys; retrieval anchored on the part entry | Edges go into the plan without acceptance |
| Engine (`src/graph/engine.js`) | DAG scheduling, OOO windows, bookings, critical path | Calendars; same-world comparison; dominance and break-even | Unknown duration defaults to 1 day; cycles don't block; `idleCost` prices people-days |
| Money (`src/decisions.js`) | — | Replace hardcoded `blocked`/`slack`/`chain` and the $500 approval policy with owner value policies and Ramp approval | $1,100 × people × days presented as a cost |
| Requests (`server/store.js`) | Lifecycle, revisions, audit | Order states (§4), frozen spec, Ramp links | Draft POs are superseded by Ramp |
| UI (`/request`, `/approvals`, `/graph`) | Graph visual, evidence panel, run events | `/request` becomes part entry + comparison card; `/approvals` is replaced by Ramp | "Idle engineering $" tile implies cash savings |
| Agent (`server/agent`) | Tool loop, offline fallback | Extractor and explainer behind the orchestrator | — |
| New | — | Browser extension (Xometry provider); Ramp client (sandbox); world-script generator | — |

## 15. History

| Version | Change | Decided by |
|---|---|---|
| v1–v5 | Joint Claude + Codex design: decision core, evidence layer, questions, learning limits, quote-page entry, disagreement, assembly readiness | Claude + Codex; approved |
| v6 | Dropped the BOM; the demand anchors the decision | Owen |
| v6 | The engineer's manager is the approver | Owen |
| v7 | Burn runs the order: extension fills the vendor page, frozen spec verified by read-back, Burn places the order | Owen |
| v8 | Xometry only; part entry kicks off every order; Ramp owns approval, card and booking; supply chain is a context source; learning on context attributes with a time-band heat map; synthetic world script | Owen |

Superseded and removed in v8: the quote-page-only entry; Slack approval cards; Burn's own auto-approval settings; supply chain as approver or placer; vendor-reliability learning as phase 1; the BOM. Settled joint positions that remain: valuation order and no gating fraction; scenarios before probabilities; authority-based claim acceptance; one question at a time; working-day worked example; no per-project agents; habit is advisory; outcome signals are diagnostics.

## 16. Open questions

All open questions (product, Ramp, Xometry, build) are tracked in one place: [`open-questions.md`](open-questions.md).
