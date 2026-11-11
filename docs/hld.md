# Burn: high-level design (one page)

Burn is a purchasing agent for hardware teams that order custom machined parts. It plugs into Ramp. The engineer describes the part; Burn works out how fast it's worth buying, gets it approved in Ramp, buys it, and books it.

The full design is in [`architecture.md`](architecture.md) (v9). This page is the map.

## Who does what

| Engineer | Burn | Ramp | Xometry (vendor) |
|---|---|---|---|
| Types the part name, a one-line note, attaches the CAD file. Clicks Okay. | Finds the context, gets the quote, decides the speed, explains it, buys and books. | Approval, the card, the receipt and bookkeeping. | Makes the part. |

## The flow

```
engineer ──► 1 part entry ──► 2 context ──► 3 quote ──► 4 recommend ──► 5 Okay
                                                                          │
   10 booked ◄── 9 charge ◄── 8 place ◄── 7 card ◄── 6 approve ◄── Ramp request
```

1. **Part entry.** Name, note, CAD file.
2. **Context.** Burn searches Slack, meeting notes, Jira and the calendar for what the part is for, what else that work waits on, and the deadline. Facts are kept with their source and age.
3. **Quote.** Burn's own headless browser (on Burn's server, company Xometry account) uploads the CAD, fills the form and reads back every production/shipping tier. Nothing opens on anyone's machine.
4. **Recommend.** For each tier: when does the part's assembly actually finish, and does paying for speed change that? Burn preselects one tier and shows the break-even ("worth it above $450/day").
5. **Okay.** The engineer accepts, edits, or talks it through with Burn. Okay freezes the exact order (every field, CAD hash, tier, price).
6. **Approve.** Burn creates the Ramp purchase request with the explanation attached. The manager approves in Ramp; Ramp's rules auto-approve small orders.
7. **Card.** Ramp issues a virtual card for the exact amount, usable only at Xometry.
8. **Place.** The moment approval lands, Burn alerts the engineer and its browser reopens the quote, checks every field against the frozen order, and places it. Any mismatch stops it.
9. **Charge.** The Xometry charge appears in Ramp.
10. **Booked.** Burn attaches the receipt, the explanation and the project code. Later: delivery and first use.

## How the recommendation is made

1. **Only valid options:** unexpired quote, right revision and quantity, allowed by policy.
2. **If a cheaper option gets the work done just as soon, pick it.** No dollar value needed. ("Faster changes nothing: the motor arrives later anyway.")
3. **Otherwise it's a real trade-off:** show the break-even $/day, and recommend only if the milestone's owner has set what a day is worth. Burn never invents that number.
4. **If one missing fact would flip the answer, ask the one person who knows.** One question at a time.

## The parts of the system

| Component | What it does | In the demo |
|---|---|---|
| Ingestion | Pulls Slack, calendar, meeting notes, Jira into a versioned, permission-tagged store | Real code; seeded demo world |
| Context + extraction | Finds documents related to a part; extracts typed facts with their source | Real (Claude, with an offline fallback) |
| Schedule engine | Works out finish dates per option; unknowns stay unknown | Real |
| Decision core | Valid options → dominance → policy → break-even; the question loop | Real, unit-tested against the worked cases |
| Order store | One record per order through its states; the frozen spec and its hash; audit log | Real |
| Ramp client | Request, approval webhooks, card, receipt/memo/coding | Mock now (same fields as Ramp's API); sandbox when granted |
| Xometry provider | Upload → tiers → place → status, via headless browser | Local fake Xometry site for placement; real tier read-back as a stretch |
| Engineer UI | Part entry, live progress, comparison card, chat, order status | Real |
| Learning | Advisory model of the team's habits, from past orders and their context | Slide only, labelled simulated |

Every external system sits behind one interface with swappable backends (`mock` / `sandbox` / `real`), chosen by config. The demo runs the same code as production.

## Guardrails

- The order placed is the order approved: frozen spec, verified field by field, before the final click. Mismatch → nothing is bought.
- The card only works at Xometry, for the exact amount; one placement per order, ever.
- Secrets live on the server. Slack messages and vendor pages are data, never instructions.
- No invented dollar values, no fake probabilities. Unknown stays unknown.

## Demo vs. production

| | Demo | Production |
|---|---|---|
| Ramp | Mock, or sandbox if granted | Ramp API (purchase requests are early access; Vault cards need Ramp review) |
| Xometry | Fake site; never a real checkout | Punchout or written permission from Xometry (its terms forbid bots today) |
| Browser | Playwright on the laptop | Hosted browser (e.g. Browserbase) |
| Data | Seeded demo company | The team's own Slack, calendar, Jira |
