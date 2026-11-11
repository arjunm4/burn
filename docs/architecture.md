# Burn: expedite-decision architecture (joint Claude + Codex)

Status: **v8 draft (Claude), pending Codex review.** v8: Xometry only; the engineer's part entry kicks off every order; Ramp owns approval, payment and accounting; supply chain is a context source, not a purchase step; learning is a context-attribute model anchored on Ramp purchases (§10). v7 adds the end-to-end ordering flow (§0): Burn fills the vendor page, the engineer clicks Okay, approval routes per settings, and supply chain's one click places the order automatically against a verified frozen spec. v6 drops the BOM as a required input (Owen's decision; see §2.3) and makes the engineer's manager the approver, with an optional auto-approval setting (Owen's decisions; see §2.14). v5 was jointly reviewed and approved by Claude and Codex. v5 incorporates Arjun and Owen's second conversation (quote-page entry, disagreement, learning, assembly readiness). Architecture only; no implementation authorized. Product inputs only Arjun and Owen can provide stay open questions (§16).
Inputs: Arjun + Owen design conversation (`data/design/transcript-arjun-owen.md`, local only); independent positions (`claude-position.md`, `codex-position.md`); critiques and settlement (`claude-critique.md`, `codex-review-r2.md`, `codex-settlement-r3.md`); worked example (`worked-decision-example.md`); conversation 2 (`transcript-2-arjun-owen.md`) and its review (`codex-review-round2.md`).

## At a glance

### Problem
When an engineer orders a custom machined part on a site like Xometry, they fill in the file, material and quantity. Then they hit the one field they can't answer: which **production and shipping tier** (e.g. Standard 10 days for $3,000, Expedited 5 days for $3,900). Someone has to decide whether the faster option is worth it. Today that's a gut call. The facts that should drive it are scattered across Slack threads, meeting notes, calendars and people's heads:
- what the part is for
- whether the engineer's own subsystem is ahead or behind its milestone
- what else that work is waiting on
- what a day of delay is actually worth

So teams overpay to expedite parts that wouldn't have sped anything up, and underpay on the ones that would.

### Product
**Burn helps the engineer pick the production and shipping tier right on the quote page, sends the quote with its justification to the engineer's manager for approval, and hands the approved order to supply chain to place.**

At the moment the engineer reaches the tier choice, Burn works out what the part feeds, whether that assembly is on pace for its milestone, and what else it's waiting on. It then compares the options:

> "Expedited gets the spin test done 2 days sooner for +$900. Worth it if a day is worth more than $450 (your policy says $600). If the motor slips to day 10, Standard is just as fast."

What happens next:
- **The engineer can disagree.** They can argue with Burn on the spot, and the exchange travels with the quote.
- **The manager approves.** The engineer's manager signs off; supply chain receives the approved order and places it.
- **Burn picks the cheaper option outright** when paying more buys no time.
- **When the answer hinges on a missing fact**, Burn asks the one person who knows.
- **It never invents a dollar value for time**; that comes from whoever owns the deadline.
- **The engineer chooses the supplier**; Burn only advises on the tier and timing.

Burn isn't meant to be omniscient. It turns a gut call into one with traceable reasons.

### Architecture

```
 ┌─────────── Sources ───────────┐
 │ quote page · Slack · mtg      │
 │ notes · calendar · past orders│
 │ · owner's $/day policy        │
 └───────────────┬───────────────┘
                 ▼
 1. Ingest       store every document version (never edited, permission-tagged)
                 ▼
 2. Extract      pull out typed facts with their source:
                 "bracket needed for spin test", "motor ready day 8", ...
                 ▼
 3. Accept       keep only facts that are current, authoritative and consistent;
                 conflicts and gaps are flagged, not guessed
                 ▼
 4. Plan         dependency graph: part → work/test → milestone
                 ▼
 5. Decide       for each quote option: when the milestone lands
                 → drop invalid options → pick dominant one
                 → else apply the owner's $/day → else show break-even
                 ▼
 6. Ask          if one missing fact could change the answer, ask its owner, re-run
                 ▼
 7. Recommend    on the quote page: dates, cost, break-even, assumptions;
                 engineer accepts or argues (exchange kept with the quote)
                 ▼
 8. Approve      quote + justification → Slack → manager approves → supply chain places
                 ▼
 9. Record       freeze the decision; log what Burn showed, what was chosen and why,
                 then observe delivery and first use (learning signals)
```

### Data flow, in one example
1. Owen configures the bracket on the quote page and reaches the tier choice: Standard (day 10, $3,000) or Expedited (day 5, $3,900).
2. Burn captures the quote snapshot (every tier shown) and identifies the demand: Slack says the new bracket is for the hip-actuator spin test, and Owen confirms with one tap.
3. From Slack and meeting notes it learns the bracket is needed for the actuator spin test, which also needs Arjun's motor (ready day 8). The test takes 3 days.
4. It computes the test's finish date for each option: Standard finishes day 13, Expedited day 11. Expedited is 2 days sooner for $900, so the break-even is $450/day.
5. The spin-test owner's policy says a day is worth $600, so it recommends Expedited (+$300 net) and states the assumption: the motor is ready by day 8.
6. If the motor date were uncertain, it would first ask Arjun "ready by day 8?", because that answer flips the decision.
7. Owen agrees, or argues ("the bench is booked until day 12 anyway"). A supported correction is accepted and Burn re-solves.
8. The quote, recommendation and exchange go to Slack. Owen's manager approves it there, and supply chain places the order.
9. The decision is frozen. Later, delivery and first use are observed and logged as learning signals, not as verdicts.

The sections below are the detailed design.

## 0. Ordering flow (v7)

*Added in v7 (Owen's decisions). Where §1–§11 still describe the quote-page-only flow, this section governs; those sections are to be reconciled in review.*

Burn moves from advising at the vendor's quote page to running the order from the engineer's request to the placed order. One vendor (Xometry) first; other vendors (Protolabs, PCBWay, …) are later adapters.

```
 1. Engineer → Burn       "I need the hip-actuator bracket" + CAD file
 2. Burn builds the form  fields from context (use, need-by, qty, revision, owner);
                          asks only for gaps (almost always the CAD file)
 3. Extension fills       uploads CAD, sets every vendor field in the engineer's
    the vendor page       own browser session; reads back every tier, price, expiry
 4. Burn recommends       comparison card (thumbnail, summary, tiers), best option
                          preselected; engineer clicks Okay, or edits via chat/fields
 5. Freeze order spec     every field value + CAD hash + quote ID + tier + price → spec hash
 6. Route                 auto-approval on and conditions met → skip manager
                          otherwise → manager approves the spec hash (one tap)
 7. Place trigger         no supply chain role → the approval itself triggers placement
                          supply chain role → their queue; one click (or their auto-place)
 8. Extension checks out  in the placing user's own browser, in a background tab that
                          exists only for the seconds after the trigger: reopens the
                          same shared vendor quote, verifies every field against the
                          spec, attaches the company payment method, clicks Place order
 9. Confirm and return    reads the vendor confirmation, verifies it against the spec,
                          writes order no., promised date, approval and payment back
                          to the engineer's order record
10. After                 tracking, receipt, first-use check, learning log
```

**What the engineer does:** describe the part, attach the CAD, click Okay. No vendor forms, no card, no re-sending quotes, no second check.

**Auto-approval** (§2.14) only skips the manager.

**Supply chain is an optional role** (§2.18). Every human step must either add judgment (the manager decides whether speed is worth paying for) or own something (supply chain owns payment, vendors, batching, compliance, receiving). On a team without supply chain, the manager's approval is the purchase authorization and Burn places the order with the company payment method from settings. On a team with supply chain, their queue shows batching opportunities (several orders to one vendor), payment and coding, and exceptions (price change, compliance, unapproved vendor); supply chain can enable **auto-place** so routine approved orders go straight through and they see only exceptions.

**Vendor integration (research, Nov 2026).** No CNC or sheet-metal vendor checked (Xometry, Protolabs, Hubs, Fictiv, SendCutSend, OSH Cut, RapidDirect, Jiga) has a public buyer API; Xometry's developer API is supplier-side only. Xometry and Fictiv offer cXML punchout into Coupa/Ariba/SAP via enterprise sales. PCBWay and JLCPCB/JLC3DP document quote → order → status APIs for approved partners (PCB, SMT, stencil, 3D printing; no CNC). Almost every vendor supports **team accounts with quote sharing** (Xometry Teamspace, Fictiv Teams, Hubs team accounts, SendCutSend Organizations, OSH Cut "Send As Quote"). Therefore:
- **v1 requires the company to use the vendor's team account**, so the quote the engineer's extension creates is the same quote checked out at placement. The vendor holds the configuration; Burn's field-by-field read-back is the backstop.
- Checkout runs in the placing user's own browser, triggered only by their click (or the approval/auto-place event while their browser is open); never in the engineer's browser, never at random times.
- *Rejected:* a server-side bot driving vendor websites (no official support; terms of service unverified; credentials on our servers).
- Later adapters: vendor APIs where they exist (PCBWay, JLC for PCB), punchout for customers on Coupa/Ariba, and a buyer API if Xometry offers one on request.

**The final click is automated (step 8), guarded by the frozen order spec:**
- The manager approves the spec hash, not a description. Supply chain's Order click authorizes buying exactly that spec.
- At checkout the extension reopens the *same vendor quote* when the vendor allows it (configuration held by the vendor, not re-entered); otherwise it re-fills from the spec. Either way it **reads back every field** and compares it with the spec before clicking.
- All fields match → Burn clicks Place order. Any mismatch → nothing is placed:

| Mismatch | Handling |
|---|---|
| A field failed to fill | Re-fill from the spec and re-verify; if it still fails, show supply chain the field |
| Price rose or quote expired | Back to the manager (or auto-approval if still within its limit); the engineer isn't asked |
| The vendor dropped an option the spec uses | Back to the engineer: the part itself would change |

- Guards on the automated click: a per-order spend cap; an idempotency key per spec so a retry or double click can't place two orders; a single-use virtual card per order where the payment platform supports it.
- The confirmation is verified against the spec after placement; a mismatch is flagged at once for supply chain to cancel.

**Data captured with both time keys (§10):** where each field came from (context, CAD, question) and the age of each context fact; every tier shown and what Burn preselected; the engineer's edits; approval path and time; every verification result and auto-repair; price drift between quote and order; the placed order; then delivery and first use.

**Not yet verified:** Xometry's terms for extension-driven checkout (its terms page could not be fetched); whether Teamspace sharing works for every quote type (otherwise the re-fill path is used); placement when no one's browser is open on the auto-place path; CAD access control (which vendors received which file).

### v8 changes (Owen's decisions; supersede the matching parts of §0 above)

**Xometry only for v1.** Other vendors and vendor-reliability learning are deferred. Xometry is reached through the browser extension (§0) behind one internal **provider interface**: upload CAD → quote tiers → place order → status. The demo may use a stub with realistic Xometry tiers if the extension isn't ready. *Considered (research, Nov 2026):* AFN (agenticfabricationnetwork.ai) is the only documented self-serve buyer API covering CNC, but it has no sandbox, is merchant of record (conflicts with Ramp-issued payment), offers shipping options rather than production tiers, and is new and unproven; its API shape informs the interface and it can be a later provider. Shapeways and Sculpteo (3D printing only) and PCBWay/JLC (PCB, partner-only) are later candidates.

**Kickoff: the engineer's part entry.** Every order starts in Burn's purchasing interface, where the engineer enters the **part name and a short summary** in their own words (what it is, what it's for, anything urgent) plus the CAD file. This entry is the anchor for everything after it:
- it is the **retrieval query**: Burn finds the Slack threads, meeting notes and calendar items related to this part and synthesizes them into the part's **context record**;
- Burn fills the order form from the summary plus the context, and asks only for gaps (almost always the CAD file);
- the summary is stored verbatim with its time and is itself a context source for training.

**Purchase without supply chain; Ramp owns the money.**

| Step | Burn | Ramp |
|---|---|---|
| Part entry, context, Xometry fill, tier recommendation, frozen spec | ✓ | — |
| Purchase request with justification and quote PDF | creates it (`/unified-requests`, early access) | shows it as a procurement request |
| Approval | watches webhooks | manager approves in Ramp; small orders auto-approved by Ramp rules |
| Payment | requests the card | virtual card: exact limit, Xometry only, lock date (Vault API; production needs Ramp PCI review) |
| Checkout | verifies every field, places the order with the Ramp card | — |
| Receipt, memo, project/GL | sends them on `transactions.cleared` | records them |
| Delivery | asks "arrived OK?" | item receipt against the PO |

The purchase involves two people: the engineer and the manager. When approval comes back, the engineer gets a "ready to place" notice and one click places the order (their browser may have closed during a slow approval). Burn's own approval settings and the supply-chain queue are removed. Demo: Ramp sandbox (demo.ramp.com), ⌘J to simulate charges.

**Supply chain is a context source, not a purchase step.** Their Slack messages (ETAs of sibling parts, stock on hand, shipping cutoffs, vendor rules) are claims with supply-chain authority; they also see orders, handle tracking and exceptions.

## 1. Problem and scope

The proposal borrows one idea from software workflows: linked issues with owners and history, so you can see what depends on what. It applies that idea to a hardware-specific timing problem: supplier production, transport and inspection time for custom parts. Today, a team's knowledge of what a custom part feeds is spread across Slack, DMs, meetings, a partial Jira, the CAD/PDM tree, and people's heads. Whether to pay for faster manufacturing is usually an engineer's judgment call, relayed to supply chain.

**Burn answers one decision:** *for a custom CNC part the engineer has already specified and sourced, which quoted production/shipping option, and when to order, is justified by its effect on the work waiting for it?*

| In scope (v1) | Out of scope (v1) |
|---|---|
| Custom **CNC-machined** parts with tiered instant quotes (Xometry-style) | Off-the-shelf parts; PCB and sheet metal (a later, separately proposed expansion with its own calendars and constraints) |
| Choosing among valid quoted options; ordering now vs. a guaranteed later option | Choosing the supplier or region (US vs. China, quality): **the engineer's judgment, deliberately deferred** |
| Recommending the tier on the quote page; explaining the schedule effect and economics; logging disagreement; routing questions one at a time; policy-based approval and audit | CAD understanding or geometry. *(v7 moved CAD upload to vendor sites and the automated checkout click into scope; see §0)* |
| Latest-order windows for confirmed demands | Inventing demand from chat; company-wide scheduling or optimization; budget creation |

The data model uses a general *supplier-fixed, made-to-order tiered quote* schema internally. Shared arithmetic doesn't imply we've evaluated other part types.

## 2. Settled decisions

Each decision is listed with the alternative we rejected and why.

1. **Part-first, reverse computation.** A concrete quote starts the work. We walk from that part to the work and milestone it feeds. *Rejected:* an agent that ingests everything and decides what to buy (unbounded context, untestable).
2. **One shared evidence store and planning model, with bounded jobs.** *Rejected:* one persistent agent per project (divergent memories, and cross-project edges become negotiations between agents). Records own state. Models propose over snapshots and never approve their own output.
3. **The demand anchors the decision; no BOM.** *Revised in v6.* The anchor is the **Demand**: this part (from the quote: file, revision, quantity), for this use or test, by this date, owned by this person. Burn proposes the demand from accepted context (e.g. "need the new bracket for the spin test") and the engineer confirms it with one tap; otherwise the engineer answers one "what's this for?" field with autocomplete over known tests, assemblies and milestones. Process, test and use dependencies form the dependency graph, built from accepted claims plus the engineer. *Rejected (v5):* the BOM as identity anchor. The parts most often expedited (fixtures, test adapters, tooling, prototype iterations, rush revisions) are usually outside it, and early teams often have no reliable BOM. *Cost accepted:* no product-wide gap detection ("a part feeding a milestone with no order"); gaps are detected only against declared tests, assemblies and milestones (§8).
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
9. **Learning starts with measurable facts.** Vendor quoted-vs-actual ready-to-use time, approval lag and inspection time come first. A descriptive "house habit" model comes later, from prospective logs, and stays **advisory** (§10). *Rejected:* training on Ramp receipts. Receipts lack the unchosen options and context, and a payment isn't proof of delivery.
10. **Entry at the quote page; Slack for approval and conversation; web for evidence and audit.**
    - The engineer gets the recommendation where the tier is chosen.
    - The proposal, justification and any disagreement go to Slack for policy-required approvals.
    - **The desired surface is a browser extension.** The demo adapter is a deliberately invoked quote-snapshot import. A pasted link is only promised once the adapter can actually fetch and validate every tier, expiry and configuration.
    - *Revised:* v4 had "Slack-first, extension later". Conversation 2 placed the decision at the quote page.
11. **Disagreement is first-class.**
    - The engineer can argue before approval. Supported new context is accepted through the normal claim process and the decision is re-solved.
    - The exchange is kept with the quote, typed as *factual correction / policy disagreement / preference / unresolved*, and access-scoped.
    - An argument doesn't silently become a planning fact or a training label, and an override isn't proof the recommendation was wrong.
12. **Assembly readiness, not "who is blocked".** The lead question is: *does faster delivery improve this assembly's readiness and the milestone it serves?* An engineer's own subsystem is a legitimate affected outcome even when nobody else waits.
    - Readiness comes from the actual remaining work, dependencies and constraints, never from the fraction of parts received.
    - Burn scores neither people nor assemblies in a league table.
    - "Behind schedule" alone never justifies spend unless the option changes the outcome.
13. **The decision is a decomposition, not an additive urgency score** (§7):
    1. eligibility and policy
    2. schedule and uncertainty: vendor reliability enters the arrival scenarios here
    3. choice basis: dominance → policy → owner economics
    4. advisory comparison with house habit

    Buffer status is derived from the schedule, not added as a second charge.
14. **The engineer's manager is the approver.** *Added in v6 (Owen's decision).* The manager judges whether speed is worth paying for and approves in Slack; supply chain receives the approved order and places it. **Auto-approval is a setting**, off by default, that the manager turns on and scopes: when the engineer's choice follows Burn's recommendation, the order is under the manager's dollar limit, and no decision-critical gap or unresolved disagreement remains, Burn approves on the manager's behalf, records it as `auto-approved (manager setting vN)` and notifies the manager. Anything else goes to the manager. Auto-approval skips only the manager, never supply chain (§0). *Rejected (v5):* supply chain as approver for small orders, with a manager added above a threshold.
15. **Burn runs the order through a browser extension.** *Added in v7.* The extension works in the user's own logged-in session: it fills the vendor page for the engineer and checks out for supply chain. *Rejected:* a server-side bot (bot detection, credentials, terms-of-service risk). Vendor APIs replace the extension per vendor when available.
16. **One frozen order spec, verified by read-back.** *Added in v7.* The engineer's Okay freezes the spec; approval binds to its hash; checkout proceeds only if every field read back from the vendor page matches it. This is the guarantee that supply chain buys what the engineer configured, with no second check by the engineer.
17. **A human authorization (manager approval, or supply chain's click where that role exists) triggers placement; Burn performs the final vendor click.** *Added in v7 (Owen's decision).* Reverses v5's "no automatic purchasing". Guarded by spec verification, a spend cap, idempotency and per-order cards (§0).
18. **Supply chain is an optional role.** *Added in v7 (Owen's decision).* A human step must add judgment or own something. Without a supply-chain role, approval triggers placement; with one, supply chain owns payment, batching, vendor and compliance exceptions, and may enable auto-place.

## 3. Workflow

Actors: the **engineer** (owns the part and its demand), **supply chain** (receives the approved order and places it; not an approver), the **approver** (the engineer's manager), and the **milestone owner** (owns the value-of-time policy).

1. On the quote page the engineer completes specification, material, quantity and supplier, then reaches the tier choice. Burn captures a **quote snapshot**: every tier shown, with completeness flags, capture time and the vendor configuration revision.
2. Burn identifies the **demand** the quote serves.
   - A demand proposed from accepted context is shown for one-tap confirmation; otherwise the engineer picks it in one "what's this for?" field.
   - Part identity, revision and quantity come from the quote. The engineer is asked only about an ambiguous use, an incompatible revision, an unresolved quantity allocation, or a material contradiction.
3. Burn retrieves evidence the participants are allowed to see and builds the planning view for the affected subgraph.
4. Burn computes the admissible actions and their outcomes per scenario.
5. If a decision-critical gap remains, Burn asks its owner **one question at a time** (gates first, if trusted evidence can't settle them), then re-solves. If the interruption budget runs out, the decision ends in an explicit *unresolved / escalated* state, never with defaulted facts.
6. Burn shows its **recommendation on the quote page**:
   - each option's ready-to-use date and its effect on the assembly and milestone
   - spend and the break-even $/day
   - the decision basis: dominance, policy or valuation, with its source
   - the switching condition
   - any open assumptions
7. The engineer **accepts or argues**. Supported new context is accepted and Burn re-solves; everything else is kept as typed, unresolved disagreement. The engineer's chosen tier becomes an **engineer proposal**, which isn't an approval.
8. The proposal, recommendation and a concise disagreement summary go to the Slack approval thread. The **approver is the engineer's manager**. Supply chain is notified and places the order once approved. If the manager has turned on **auto-approval** (§2.14) and the proposal meets its conditions, Burn approves it under that setting and notifies the manager instead. Whether large orders need an extra sign-off is still to be decided.
9. Approvers approve or override with a reason. The order is then placed with the vendor and acknowledged. A quote is not a PO: captured quote → engineer proposal → approvals → placed order → vendor acknowledgement are separate steps.
10. If the quote configuration, tier prices or evidence change, Burn creates a new snapshot and decision revision. A *material* change invalidates the affected pending sign-offs. Approved commitments are never rewritten; they are revalidated before placement.

Engineer steps added: none in the common case **once the quote-page integration exists**; with the demo's manual snapshot import, one deliberate import. Occasionally one tap or one sentence. Milestone owners set their policy once per milestone.

## 4. Runtime and lifecycle

```
 sources (Slack, calendar, files) ──► Sync jobs ──► DocumentRevision store (immutable, access-scoped)
                                          │
                                          ▼
                                 Extraction jobs ──► Claims (proposed) ──► Acceptance ──► PlanningView
                                                                                            │
 quote page ──► QuoteSnapshot ──► Decision orchestrator (per decision) ◄──── snapshot ────┘
 (extension /                        │  admissible actions × scenarios → schedule → outcomes → basis
  snapshot import)                   │  question loop (one at a time, re-solve)
                                     ▼
          DecisionRevision ──► quote-page recommendation ──► engineer proposal (+ exchange)
                                     ──► Slack approval set (policy) ──► placed order ──► vendor ack
                                     ──► observed delivery / inspection / first use (learning signals)
```

**Decision states:**
- `captured` → `resolving` → `needs_answer` ⇄ `resolving`
- `resolving` → `recommended` → `proposed` (engineer's tier, possibly disputed) → `awaiting_approvals` → `approved` → `placed` → `acknowledged`
- **An override is a changed proposal**, not an authorization state. An approver choosing a different option creates a new proposal and decision revision, which needs its own required approval set.
- **Placement** requires *all* required approvals on the same current quote snapshot, configuration, option and decision revision.
- **No-placement exits:** `rejected` (an approver declines), `cancelled` (the engineer or supply chain withdraws)
- side exits: `unresolved` (escalated), `superseded` (a new revision), `invalidated` (a material change before approval)

**Runtime contracts:**
- Sync and extraction jobs run independently of decisions. A decision always reads a frozen snapshot hash.
- Progress shown in the UI comes from real backend run and tool events, never simulated timers.
- **Access scope** is carried through retrieval, question routing, explanations **and the Slack card itself**. A source record in the store doesn't mean every approver may read its raw private text. Cards and explanations reveal only what their audience is allowed to see. **That includes derived conclusions**: leaving out a private quote doesn't permit disclosing its substance. When a decision depends on evidence the audience can't see, the card says so and routes the matter to someone with access.
- Secrets stay server-side. Document text **and vendor page content** are data: they can't trigger tools, approvals, ordering or policy changes.

## 5. Core objects

```
Demand(part rev, qty, use/test, assembly, usable-by, owner, source: context|engineer) ◄─ the anchor
Part(number or file, revision; from the quote) · Assembly(declared name, milestone)
QuoteSnapshot(vendor, configuration revision, captured-at, capture source, completeness,
              quantity, currency, price inclusions, valid-until, cutoff, time zone)
  └ QuoteOption(tier, total price, mfg days @shop calendar, ship promise @carrier, source)
Proposal(decision rev, engineer-selected option, rationale) · Exchange(statements typed:
         factual correction | policy disagreement | preference | unresolved; access scope)
ApprovalRequirement(policy rule, role, threshold) → Approval(approver, choice, rationale, at)
Order(requested-at, approved-at, placed-at, acknowledged-at) · Shipment(dispatched-at, delivered-at)
Inspection(received-at, ready-to-use-at @site calendar) · Allocation(qty → Demand)
UseEvent(demand/qty, first confirmed use, evidence, recorded-at) · Baseline(plan, revision)
Milestone(target, owner, hard|soft, ValuePolicy: curve | range | none)
Method(requires-all inputs | alternative method with fit/quality/qty/permission filters)
WorkItem(duration: known | range | unknown, assignees, calendar) · Resource/Booking(slots)
DocumentRevision(source, access scope, immutable spans)
  → Claim(typed, subject+revision+use, effective interval, speaker, authority,
          status: proposed|accepted|disputed|superseded)
PlanningView(snapshot hash: accepted facts + named assumptions + open gaps)
Scenario(world assumptions) × Action(option, placement time, confirmed method) → Outcome
Question(kind: gate|elective, owner, response deadline, sensitivity, why it matters)
DecisionRevision(snapshot hash, admissible set, outcomes, basis, what Burn displayed,
                 proposal, approvals, override reason)
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

1. **Ingest** document revisions. The demo bundle has three inputs, all replaceable adapters, so no live PDM, Ramp or meeting connector is needed for the architecture proof:
   1. a revision- and quantity-specific tiered quote set
   2. source messages, selected meeting transcripts and the milestone/calendar plan, including declared tests and assemblies
   3. **owner-approved valuation and approval policy**

   A small order/delivery event history illustrates the facts layer and existing allocations. Slack and the calendar can also be read live, as already built. Each decision's full quote set, snapshot and outcome is logged prospectively from the first run.
2. **Extract** typed claims, with spans, from messages and transcripts. Model text is untrusted data.
3. **Resolve** mentions against a closed candidate set of declared parts, tests, assemblies and milestones: part numbers exact, names fuzzy, the model as tie-breaker. A failed resolution stays unresolved; it is never guessed. A name similarity never authorizes a revision substitution.
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

**Assembly readiness (the lead view).**
- For the affected assembly, show its forecast readiness range, its need-by date, the known remaining work and constraints, the **forecast slack in days** (negative shown explicitly) and the effect of each option.
- Readiness is driven by known remaining work and dependencies: serial vs. parallel structure, hard remaining items, resource capacity and booking windows. It is never the fraction of parts received or percent of effort alone. Unknown remaining effort stays unknown.
- Intermediate milestones (e.g. "transfer subsystem functional") can carry their own owner-defined value, never double-counted against the program milestone they feed.
- **Optional buffer view.** A critical-chain style buffer-consumption chart appears only when there is an accepted baseline, a defined protected chain and feeding point, a defined buffer and an auditable progress measure. A zero or undefined buffer has no percentage. Buffer status is a diagnostic, never a dollar penalty or an automatic expedite.
- Baselines change only through an explicit, recorded replan, so moving goalposts can't make progress look better.

**Comparison.**
- **Milestone effect** ΔT_m(a, s) = T_m(cheapest admissible, s) − T_m(a, s).
- **Break-even** = extra spend / ΔT_m when ΔT_m > 0. ΔT_m = 0 means no acceleration of *that* outcome ("another input dominates it").
- **Dominance is judged across every independently valued outcome** (assembly readiness, intermediate and program milestones) and every declared scenario. An unchanged program date doesn't cancel an independently valued subsystem benefit.
- **Dominance and policy first.** Then, with an owner value curve V_m: loss(a, s) = spend(a) + V_m(T_m(a, s)). Use one explicit economic outcome model with deduplicated cost components. Independent, non-overlapping outcomes can add (e.g. two distinct contractual penalties); overlapping valuations of the same loss or project value never do. A cliff (missed launch, missed test slot) is part of V_m or of the slot model, not a linear rate.

**Across scenarios**, without probabilities, report:
- dominance and robust dominance (holding only across the **declared** scenarios, not a proof about unobserved worlds)
- outcome and loss **ranges**
- the **switching condition**
- tie-breaks, and how sensitive the result is to which scenarios were included

**Vendor reliability** (quoted vs. actual lateness) shapes the arrival scenarios upstream. It is never a post-hoc adjustment that counts lateness twice.

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

We can't detect knowledge that exists only in someone's head in general. We *can* detect **decision-critical gaps against a declared coverage boundary**: the declared tests, assemblies, fixtures and milestones, plus confirmed demands.

| Gap | Detected as |
|---|---|
| **Structural** | A demand with no usable-by; a declared test or milestone input with no order or ETA; an assembly with no milestone; a mention that resolves to nothing |
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

**v8 learning plan (governs; the phases below are retained for reference).** Training is on the **attributes of the synthesized context**, not on the part itself and not on vendor reliability.
- **One example = one Xometry purchase in Ramp at time T.** Inputs are attributes of the context related to that part and *available before T* (available-at key), over a window (e.g. 30 days), bucketed into time bands before T (0–1, 1–3, 3–7, 7–14, 14–30 days): the context heat map.
- **The anchor text** is the engineer's part name and summary (§0 v8). For historical purchases, which have no Burn entry, it is reconstructed from the Xometry order line, file name and the nearest related messages, and marked as reconstructed.
- **Attributes:** timing (days to the next need-by, test or milestone; how late in the run-up the order came); pressure (urgency language, message rate and its trend, reply speed); dependencies (who or what is waiting; whether a sibling part lands later); people (manager or supply chain involved, number of participants); change (slips, conflicting dates, revisions); freshness (age of key facts, distribution across bands); meetings (mentions, action items); the engineer's own summary (stated urgency and purpose).
- **Label:** the tier chosen, from the matching Xometry order in the company account (Ramp's amount alone doesn't give the tier).
- **Backfill:** existing Ramp × Xometry × Slack history can produce a training set before Burn's first live order.
- **Model:** small and explainable (e.g. gradient-boosted trees); shown as advisory with its sample size; the schedule and break-even computation remains the decision.
- **Risks:** linking a charge to the right context (report the clean-link rate before trusting the model); it learns habit, not correctness; small samples; Slack access must follow channel permissions; Burn's own recommendations are logged so its influence is separable.


**What gets logged from the first decision (prospectively):**
- the full quote snapshot, including its completeness
- the context **as known at decision time**, recorded with both its effective time and its available-at time, so later messages never leak into a past decision
- what Burn displayed and recommended
- the engineer's proposal and exchange
- approvals and overrides with reasons
- the placed order
- later: delivery, inspection and first use

Logging Burn's own recommendation matters. Without it, a learned habit becomes a loop of Burn imitating itself.

**Limits we state up front:**
- Full captured menus improve evidence but **do not identify** the company's true urgency valuation or the causal benefit of a choice. Omitted and private constraints, approver policy, quote availability and which requests get logged at all remain confounders.
- Slack and Jira activity only *proposes* use assertions; it isn't confirmed use telemetry.
- Retrospective replay of other options against what actually happened is conditional analysis, subject to hindsight bias. The world itself may have changed because of the action taken.

**Phase 1: facts.** Quoted vs. actual ready-to-use time per vendor and option, approval lag and inspection time, from order, ship, delivery and inspection events. **A payment receipt is not proof of delivery or inspection.** These feed the arrival scenarios.

**Phase 1b: descriptive house habit.**
- A model of which option the company tends to pick, conditioned on **context**, compared **within each admissible menu** rather than as a raw tier label:
  - the price and ready-to-use differences
  - the schedule effect
  - milestone proximity
  - remaining work and slack
  - uncertainty
  - authorized policy
- Part geometry isn't a learned predictor. Revision, quantity, inspection, substitutability and reliability still matter operationally, so "the part doesn't matter" is too strong. Staffing counts only through an evidenced capacity constraint or policy, never as an urgency multiplier.
- This answers Owen's point that gut feel hides real signals. The model makes the habit visible and auditable, but learning *weights* is still learning from choices. It's shown as **advisory**, with its sample support, and it abstains when data is sparse.
- Its coefficients are not presented as causal importance or a discovered value of time.
- A habit becomes policy only through an owner-authorized, versioned policy change.

**Phase 2: questioning the habit.** Owen's "maybe they weren't making the right decisions" is the stronger pitch.
- **Already possible without outcomes:** a habit can contradict an explicit owner policy, or favor an option that is dominated on its declared outcomes.
- **Outcome signals:** delivery, inspection and the **ready-to-use → first-use gap**, used allocation-aware and recorded with when each fact became known. These are **diagnostics, not verdicts**:
  - A part shelved for two weeks may reflect a blocker that appeared after approval, deliberate readiness insurance, a spare, or an unrecorded use.
  - A part used immediately may simply have arrived on time.
  - Expedited ready day 5, used day 8, Standard ready day 10: three days on the shelf, yet expediting may still be justified. It avoided two days of waiting, if the use and valuation support it. Timing alone can't prove the premium was worth it.
  - No observed use is censored or unknown, not infinite shelf time.
- **Three outputs are kept separate:** (1) the observed timing and outcome, (2) a model-based retrospective comparison under stated assumptions (hindsight caveats), and (3) an estimated causal improvement, only when an evaluation design supports it.
- Decisions are judged against the information available at the time as well as on outcomes. A bad outcome doesn't mean a bad decision.
- Phase 2 surfaces **review candidates** for an authorized owner to revise policy. Automatic optimization is out of scope.

## 11. Surfaces

- **Quote page (entry):** the recommendation at the tier choice, the "why" panel, accept or argue. Desired as a browser extension; the demo uses a quote-snapshot import.
- **Slack (approval and conversation):** the proposal with its justification and disagreement summary, one question at a time, the policy-required approval buttons, revalidation notices.
- **Web (evidence and audit):**
  - the evidence trail per claim, limited to the reader's access
  - the decisive dependency path with scenario toggles; this highlights the path that decides the outcome, not every downstream person
  - assembly readiness and slack for the affected assembly (no company-wide league table)
  - value-policy settings for milestone owners
  - approval settings for managers: auto-approval on/off, dollar limit, and scope (e.g. only when Burn's recommendation is followed)
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
14. The engineer's own subsystem is delayed, nobody else is directly waiting, and earlier delivery improves its valued readiness: the justified speed choice is shown.
15. A behind-schedule assembly also has a later lab or resource blocker: expediting changes nothing, so "behind" alone justifies no spend.
16. Two assemblies with different fractions of parts received and different hard remaining work: readiness follows the actual plan; no part-count or person ranking.
17. The engineer supplies a supported earlier-use requirement while disagreeing with Burn: the exchange is kept, the evidence accepted, the decision re-solved, and the revised tier routed for the required approvals.
18. The quote capture omits tiers, or the configuration changes mid-capture: the incomplete or inconsistent set is disclosed; no optimal-tier claim and no learning comparison.
19. Expedited is ready on day 5 and first used on day 8, while Standard would have been ready on day 10: three days on the shelf doesn't mean a wasted premium. Two weeks on the shelf because a blocker changed after approval: no automatic bad-decision label.
20. Standard is used immediately with no waiting or deadline loss: no under-expedite label. Missing or partial use evidence stays unknown.
21. The habit data is sparse, or conflicts with authorized policy: abstain or show the advisory difference; policy governs. Post-decision information and Burn's own influence are never treated as independent pre-decision features.
22. A revised quote changes the price or the selected tier after one approval: the approval requirements and decision revision are revalidated before placement.

**Synthetic worlds.** A simulator diagnostic: a robot program with Slack, meetings, calendar and order/delivery events, with planted gaps and hidden true durations. All numbers are reported as "in this simulator, under these assumptions".
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

1. **Decision core.** Records (Demand, QuoteSnapshot, Milestone and its policy, DecisionRevision), time semantics, admissibility, same-world schedule comparison, dominance and break-even. The worked example's cases A–C and scenarios 1, 2, 11.
2. **Evidence layer.** Access-scoped document revisions, typed claims, an acceptance/supersession policy, conflicts as gaps. Scenarios 5, 6, 12.
3. **Questions and surfaces.**
   - the question loop and gates
   - the quote-snapshot capture and the quote-page recommendation
   - disagreement exchange, engineer proposal and the policy-based Slack approval set
   - revisions, invalidation and revalidation

   Cases D and E; scenarios 8, 9, 13, 17, 18, 22.
4. **Readiness, proactive and learning.**
   - assembly readiness and slack, with the optional buffer view
   - latest-placement windows
   - the facts layer
   - prospective logging (what Burn displayed, proposal, approvals, use events)
   - the descriptive house habit (advisory)
   - Phase 2 review candidates

   Scenarios 3, 4, 7, 10, 14–16, 19–21.
5. **Simulator evaluation.** Mismatched and correlated worlds, per-stage metrics.

## 14. Current repo vs. this architecture

| Area | Keep | Change | Known defects to fix |
|---|---|---|---|
| Ingestion (`server/connectors`, `server/ingest`) | Slack/ICS connectors, versioned graph, per-channel cursors | File imports (quotes, transcripts, order/delivery events, value policy); immutable, access-scoped document revisions | — |
| Extraction (`server/graph/extract.js`) | Cited edges, closed key set for model output | Typed claims with spans and status; demand-anchored resolution; rules only as fallback | Edges go straight into the plan without an acceptance step |
| Engine (`src/graph/engine.js`) | DAG scheduling, OOO windows, booking conflicts, critical path | Time semantics and calendars; explicit methods for alternatives; same-world admissible comparison; scenarios; dominance and break-even | Unknown duration defaults to 1 day; cycles are reported but scheduling continues; `idleCost` uses an all-fastest baseline and prices people-days |
| Money (`src/decisions.js`) | Approval policy shape | Remove the hardcoded `blocked`, `slack` and `chain`; use owner value policies and break-even | $1,100 × people × days presented as a cost |
| Requests/approvals (`server/store.js`) | Lifecycle, revisions, audit, draft POs | Decision states and revisions with frozen snapshots; quote expiry; invalidation; override reason | — |
| UI (`/request`, `/approvals`, `/graph`) | Graph visual, evidence panel, approvals, real run events | The engineer surface becomes the quote-page recommendation (a snapshot import for the demo) with accept/argue; Slack carries approvals; the card shows the decision basis, break-even and assumptions | "Idle engineering $" tile implies cash savings; the engineer chat doesn't separate a proposal from an approval |
| Agent (`server/agent`) | Tool loop, offline fallback | Becomes the extractor/explainer behind the orchestrator; no free-form recommendation | — |

## 15. Disagreement log (how we got here)

| Topic | Claude R1 | Codex R1 | Settled |
|---|---|---|---|
| Dependency truth | The BOM solves existence for parts | The engineer links each order | BOM auto-resolution anchors identity (v5; superseded in v6, see BOM row); a separate process/test graph; no completeness guarantee |
| Valuation | Gated people × loaded cost × gating fraction | Break-even or Pareto only | Admissibility → dominance → owner policy → owner value curve, else break-even and a question; no gating fraction |
| History | Past choices → cost-of-delay inequalities | Receipts can't identify preferences | Facts layer first; implied preference only from prospective logs, advisory until authorized |
| Uncertainty | Monte Carlo + EVPI | Scenarios + thresholds | Scenarios and ranges by default; minimax only as owner policy; Monte Carlo only with sourced distributions |
| Claims | Latest wins, with decay | Authority, applicability, supersession | Codex's rule; fact-specific validity |
| Questions | At most one | Only if decision-changing | One at a time, re-solve, never confident while a gate remains |
| Scope | Mechanism-general (incl. PCB) | CNC | CNC product and demo; mechanism-general schema internally |
| Evaluation | Synthetic ground-truth metrics | Acceptance counterexamples | Both; synthetic results labelled as simulator diagnostics, per-stage metrics |
| BOM (v6) | Identity anchor (v5) | — | Dropped by Owen: demand is the anchor; product-wide gap detection given up |
| Approver (v6) | — | — | Owen: the engineer's manager approves; supply chain places; optional manager-set auto-approval |
| Ordering (v7) | Advise only; no automatic purchasing (v5) | — | Owen: extension fills vendor page; frozen spec on a shared vendor team quote; supply chain optional; Burn places the order |
| Worked example | Calendar dates (contained a weekend error) | Integer working days | Codex's working-day example, cases A–E |
| Agents | One graph | No per-project agents | Agreed from the start |
| Entry point (conv. 2) | Quote page; pasted link for the demo | Quote page; a link isn't promised until the adapter validates tiers | Extension as the desired surface; a deliberate snapshot import for the demo; Slack for approvals |
| Learning (conv. 2) | Full option sets satisfy identifiability; only outcomes can show habits are wrong | Option sets improve evidence, not causal identification; policy and dominance can challenge habits already | Log what Burn displayed and freeze as-known context; habit is advisory; outcome signals are diagnostics with three separate outputs |
| Shelf gap (conv. 2) | Arrival-to-use gap as the outcome label | A diagnostic, censored when unknown | A diagnostic, never a wasted-premium label |
| Progress (conv. 2) | Fever chart per assembly, normalized by effort | Forecast slack by default; buffer view only with a baseline | Assembly readiness and slack by default; optional buffer view; never ranking |
| Factors (conv. 2) | Decide/adjust factor table | A decomposition, not an additive score | Eligibility → schedule (reliability upstream) → basis → advisory habit |

## 16. Open questions for Arjun and Owen

1. Of a team's recent machined orders, how many are fixtures, prototypes or rush revisions, and which were expedited? Can engineers reliably say what each part is for?
2. *Settled in v6: the engineer's manager approves.* Who would own a milestone's value policy, and would they set it?
3. Do purchase requests carry a need-by date or the intended test today?
4. Which meeting recorder, and do we get full transcripts or only summaries? Who may see which channels and transcripts (access scope)?
5. Do Ramp exports include promised dates or the quote's unchosen tiers? Does anything record delivery and inspection separately from payment?
6. For the demo: is the hip-actuator program the right story, and which three worked cases (A–E) do we show live?
7. Which supplier and capture surface first (Xometry? an extension vs. a manual quote-snapshot import), and can we get complete, stable access to every tier and its expiry?
8. What default auto-approval limit would managers accept, and do large orders need an extra sign-off?
9. What authoritative signal shows a part was *used* (a Jira transition, an assembly log, an inspection sign-off)? And does anyone maintain an accepted plan baseline for buffer tracking?
10. Do intermediate subsystem milestones get their own value, or only the program milestone?
11. How much company history is enough before the house-habit view is shown at all?
