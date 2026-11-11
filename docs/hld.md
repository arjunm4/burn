# Burn: high-level design (one page)

Burn is a purchasing agent for hardware teams that order custom machined parts. It plugs into Ramp. **Burn makes every expedite request in Ramp prove whether the extra money buys any time**: the engineer describes the part; Burn reads the team's own records to find what the part is for and what else that work waits on, gets the quote, works out which lead time is worth paying for, gets it approved in Ramp, buys it, and books it with the premium as a fact in the ledger.

The full design is in [`architecture.md`](architecture.md) (v9). Status: v9; the flow runs end to end on simulated services (README, Status). This page was refined on 2026-11-11 by a seven-role design review (Ramp product, staff engineer, the engineer who orders, the controller, product, the architecture's author, the demo); the points still disputed are marked †.

## Who does what

| Engineer | Burn | Ramp | Xometry (vendor) |
|---|---|---|---|
| Types the part name and a note, attaches the CAD, or reorders by part number. Confirms what is missing. Clicks Okay. | Finds the context, gets the quote, decides the speed, explains it, buys and books. | Approval rules routed on Burn's verdict; the vendor-locked card for the full total; the vendor's receipt; the premium as its own line; the value-of-time policy. | Makes the part. |

## The flow

```
engineer ──► 1 part entry ──► 2 context ──► 3 spec ──► 4 quote ──► 5 recommend ──► 6 Okay
                                                                                     │
      11 booked ◄── 10 charge ◄── 9 place ◄── 8 card ◄── 7 approve ◄── Ramp request ◄┘
```

1. **Part entry.** Name, note, CAD file; or a part number from a previous order, whose fields become authorized defaults.
2. **Context.** Burn finds the part in the **company dependency graph** (built continuously from Slack, meeting notes, Jira and the calendar) and walks to the work it feeds, the milestone, and the other inputs that work waits on. Rules and the agent both write **cited claims** into that one graph; code accepts them by the author's authority over the fact. Every fact keeps its source, author and age. No per-order graph.
3. **Spec.** Material, finish, tolerances, quantity, revision, inspection and ship-to come from the engineer or an authorized default. Missing or conflicting ones are asked, never guessed from chatter.
4. **Quote.** The Xometry provider uploads the CAD, sets every field, and reads back every tier **with tax and shipping**. Demo adapter: Burn's headless browser against a simulated Xometry site. Production: cXML punchout through Ramp's vendor request; a browser on xometry.com only with Xometry's written permission (its terms forbid bots).
5. **Recommend.** For each tier: when does the work actually finish, in working days, and does paying for speed change that? The card shows the limiting fact with its source quote, author and age; the break-even ("worth it above $450/day"); the **latest date each tier can still be ordered** and make the milestone; and preselects a tier only when it can justify one.
6. **Okay.** The engineer accepts, corrects a date on an assumption, or chooses another tier. Okay freezes the exact order: every field, CAD hash, quote, tier, price, the total with tax and shipping read back, and an authorized variance.
7. **Approve.** Burn creates the Ramp purchase request bound to the spec hash, decision revision and policy version, as **two line items** (cheapest admissible tier, expedite premium) with structured fields: verdict, days gained, break-even, cheapest tier, dominating input, assumptions with ages, vendor cutoff; the explanation renders those fields. **Ramp's rules route on the verdict**: dominated, or within policy, auto-approves; a real trade-off or an open question goes to the manager.
8. **Card.** Ramp issues a virtual card for the approved total plus the variance, usable only at Xometry; terminated when the order is invalidated, rejected or its placement is unresolved. No open card outlives its order.
9. **Place.** On approval Burn re-checks everything on the same reading the decision used: approval current and not superseded, card ready, quote unexpired, cutoff not passed, decision unchanged. Then the provider reopens the quote, reads back every field against the frozen order, pays with the card and places. Okay was the engineer's last click; Xometry orders cannot be cancelled, so nothing is promised after it. †
10. **Charge.** The Xometry charge appears in Ramp and is matched to the order; a charge above the approved total goes to review.
11. **Booked.** Burn attaches the vendor's confirmation as the receipt, a structured memo (order number, tier, milestone, days gained) and the project code; the premium is coded on its own line, so "premiums that bought no time" is a Ramp report. Later: delivery and first use record whether the premium bought time; a slip re-checks every placed order on its path and tells the engineer only when the premium no longer buys time.

Next, not in v1: a no-quote path for catalog vendors (McMaster, Digi-Key) through the same request → approval → card → booking pipeline.

## How the recommendation is made

1. **Only valid options:** unexpired quote, right revision and quantity, allowed by policy.
2. **Every option is compared in the same world:** same assumptions, same working-day calendar, each plausible scenario declared (a range stated by the source, a stale date, never an invented probability).
3. **If a cheaper option gets the work done just as soon, in every scenario, pick it.** No dollar value needed. ("Faster changes nothing: the motor arrives later anyway.")
4. **Otherwise it's a real trade-off:** show the break-even $/day and the condition that would flip the answer; recommend on economics only under a **versioned value-of-time policy** (owner, effective date, hash) set by the milestone's owner; the hash travels on the request. A missing policy never blocks Okay; it removes the recommendation.
5. **If one missing fact would flip the answer, ask the one person who knows,** one question at a time. Until it's answered, nothing is preselected.

## The parts of the system

| Component | What it does | Today |
|---|---|---|
| Connectors | Slack, calendar, Jira, meeting notes; read-only; replay recorded exports when no credentials | Built |
| Graph + extraction | Rules extract cited claims; the agent (Claude, with tools) proposes further cited claims; code accepts by authority; one company graph | Rules graph + per-order agent read built; merging them into the one graph is the next change |
| Decision core | Valid options → same-world comparison → dominance → policy → break-even → latest-placement window; the question loop | Built, tested on the worked cases |
| Agent writing | Card text and justification from the computed numbers, checked back; replies to the engineer | Built; behind a flag, default template text † |
| Order store | One record per order; frozen spec and hash; placement attempts; audit | Built, tested against misbehaving providers |
| Ramp client | Request, approval events, card, charge matching, receipt/memo/coding | Mock with Ramp's field names; sandbox when granted |
| Xometry provider | Upload → tiers → place → status, verified field by field | Simulated site + headless demo adapter; punchout for production |
| People's side | The engineer's order page, the approver's view, each person's notifications | Built (simulated Ramp view) |
| Learning | The habit model was removed (56% vs a 60% never-expedite baseline, n = 45). Next: a retro-score of past expedites, and the owner's revealed value of time proposed as a policy version the owner signs | Not shown |

## Guardrails

- **The order placed is the order approved:** frozen spec, verified field by field before the final click; the request carries the spec hash, decision revision and policy hash. Mismatch or stale approval → nothing is bought.
- **No double orders.** Intent is saved before the click. A lost vendor answer goes to *placement unknown* and is reconciled against the vendor's order history; never an automatic retry.
- **The card only works at Xometry, for the approved total including tax, shipping and the stated variance; no open card outlives its order.** Payment, purchase and bookkeeping are tracked separately.
- **Separate powers:** the model reads and writes words; code computes dates and money and places orders. The model never sees card details, never prices, never approves, never places.
- Secrets live on the server. Slack messages and vendor pages are data, never instructions. Every expedite premium is a line in Ramp with its days gained, break-even and policy version.

† Still disputed: whether placement is automatic on approval or a prepared checkout the engineer confirms until a sanctioned vendor path exists (staff engineer); whether the agent should write the card and justification at all (controller) or only behind a flag.
