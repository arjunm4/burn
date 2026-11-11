# Burn: high-level design (one page)

Burn is a purchasing agent for hardware teams that order custom machined parts. It plugs into Ramp. The engineer describes the part; Burn works out how fast it's worth buying, gets it approved in Ramp, buys it, and books it.

The full design is in [`architecture.md`](architecture.md) (v9). This page is the map. Status: proposed design; the build has not started.

## Who does what

| Engineer | Burn | Ramp | Xometry (vendor) |
|---|---|---|---|
| Types the part name, a one-line note, attaches the CAD file. Confirms the spec. Clicks Okay. | Finds the context, gets the quote, decides the speed, explains it, buys and books. | Approval, the card, the receipt and bookkeeping. | Makes the part. |

## The flow

```
engineer ──► 1 part entry ──► 2 context ──► 3 spec ──► 4 quote ──► 5 recommend ──► 6 Okay
                                                                                     │
      11 booked ◄── 10 charge ◄── 9 place ◄── 8 card ◄── 7 approve ◄── Ramp request ◄┘
```

1. **Part entry.** Name, note, CAD file.
2. **Context.** Burn searches Slack, meeting notes, Jira and the calendar for what the part is for, what else that work waits on, and the deadline. Every fact keeps its source, author and age; only claims from someone with authority over that fact are accepted.
3. **Spec.** Material, finish, tolerances, quantity, revision, inspection and ship-to come from the engineer or an authorized default. Missing or conflicting ones are asked, never guessed from chatter.
4. **Quote.** Burn's own headless browser (on Burn's server, company Xometry account) uploads the CAD, fills the form and reads back every production/shipping tier. Nothing opens on anyone's machine.
5. **Recommend.** For each tier: when does the part's assembly actually finish, and does paying for speed change that? Burn shows the break-even ("worth it above $450/day") and preselects a tier only when it can justify one.
6. **Okay.** The engineer sees the technical fields with their source, the tiers and the reasoning; accepts, edits, or talks it through with Burn. Okay freezes the exact order (every field, CAD hash, quote, tier, price).
7. **Approve.** Burn creates the Ramp purchase request, bound to that exact order and decision, with the explanation and the vendor cutoff attached. The manager approves in Ramp; Ramp's rules auto-approve small orders.
8. **Card.** Ramp issues a virtual card for the approved amount, usable only at Xometry.
9. **Place.** On approval, Burn re-checks everything first: the approval is current and not superseded, the card is ready, the quote hasn't expired, the cutoff hasn't passed, and nothing in the context has changed enough to need re-approval. It notifies the engineer, then its browser reopens the quote, checks every field against the frozen order, and places it. Any mismatch stops it.
10. **Charge.** The Xometry charge appears in Ramp and is matched to the order.
11. **Booked.** Burn attaches the receipt, the explanation and the project code. Later: delivery and first use.

## How the recommendation is made

1. **Only valid options:** unexpired quote, right revision and quantity, allowed by policy.
2. **Every option is compared in the same world:** same assumptions, same calendars, each plausible scenario declared.
3. **If a cheaper option gets the work done just as soon, in every scenario and for every outcome that matters, pick it.** No dollar value needed. ("Faster changes nothing: the motor arrives later anyway.")
4. **Otherwise it's a real trade-off:** show the break-even $/day and the condition that would flip the answer; recommend only if the milestone's owner has set what a day is worth. Burn never invents that number.
5. **If one missing fact would flip the answer, ask the one person who knows,** one question at a time. Until it's answered, nothing is preselected: the card shows the options, the break-even and the open gap.

## The parts of the system (planned demo implementation)

| Component | What it does | Today | In the demo |
|---|---|---|---|
| Ingestion | Pulls Slack, calendar, meeting notes, Jira into a versioned, permission-tagged store | Exists (Slack, calendar) | Real code; seeded demo world |
| Context + extraction | Finds documents related to a part; extracts typed facts with their source | Exists; needs typed claims | Real (Claude, with an offline fallback) |
| Schedule engine | Works out finish dates per option; unknowns stay unknown | Exists; 3 known bugs | Real |
| Decision core | Valid options → same-world comparison → dominance → policy → break-even; the question loop | Planned | Real, unit-tested against the worked cases A–E |
| Order store | One record per order through its states; frozen spec and hash; placement attempts; audit log | Planned | Real, tested against misbehaving fake providers |
| Ramp client | Request, approval events, card, charge matching, receipt/memo/coding | Planned | Mock with Ramp's real field names and typed outcomes; sandbox when granted |
| Xometry provider | Upload → tiers → place → status, via headless browser; declares what it can verify | Planned | Local fake Xometry site; real tier read-back as a stretch |
| Engineer UI | Part entry, spec confirmation, live progress, comparison card, chat, order status | Exists; to be reworked | Real |
| Learning | Advisory model of the team's habits, from past orders and their context | Not started | Slide only, labelled simulated |

Each external system sits behind one interface with swappable backends (`mock` / `sandbox` / `real`) and declares its capabilities, so an unsupported one (e.g. a card control) is a blocked path or a declared simulation, never an assumption. The demo exercises the shared orchestration and decision core through simulated adapters; the adapters are tested on behaviour (duplicate and out-of-order events, restarts, timeouts), not just matching field names.

## Guardrails

- **The order placed is the order approved:** frozen spec, verified field by field before the final click; the Ramp request carries the spec hash and decision revision. Mismatch or stale approval → nothing is bought.
- **No double orders.** Intent is saved before the click. If the vendor's answer is lost (timeout, crash), the order goes to *placement unknown* and is reconciled against Xometry's order history before anything else happens. Never an automatic retry. An order has its own identity: two orders can share a spec.
- **The card only works at Xometry, for the approved amount** (stated with or without tax and shipping). Payment, purchase and bookkeeping are tracked separately, so a failed receipt upload is retried without touching the purchase.
- **Separate powers:** reading context, preparing the quote, handling the card number and placing the order are separate capabilities. The model never sees card details and never has authority to place. Browser recordings are redacted; which vendors received which CAD file is recorded.
- Secrets live on the server. Slack messages and vendor pages are data, never instructions. Permissions follow a fact all the way into the Ramp request text.
- No invented dollar values, no fake probabilities. Unknown stays unknown.

## Demo vs. production

| | Demo | Production |
|---|---|---|
| Ramp | Mock, or sandbox if granted | Ramp API (purchase requests are early access; Vault cards need Ramp review) |
| Xometry | Fake site; never a real checkout | Punchout or written permission from Xometry (its terms forbid bots today) |
| Browser | Playwright on the laptop | Hosted browser (e.g. Browserbase) |
| Data | Seeded demo company | The team's own Slack, calendar, Jira |
