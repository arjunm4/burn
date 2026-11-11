# Burn

**A purchasing agent for hardware teams. It plugs into Ramp and makes every expedite prove it buys time.**

Built at the Ramp × BBS hackathon at Berkeley. Prompt: *automate an outdated financial workflow with the latest AI tools.*

## The problem

When an engineer orders a machined part from a site like Xometry, the vendor asks how fast they want it: $3,000 in 10 days, $3,900 in 5, $4,900 in 2. Whether speed is worth paying for depends on facts that live in Slack, Jira, meetings and calendars: what the part is for, what else that work waits on, and when the deadline is. So the engineer guesses. Then they fill in the vendor form, chase an approval, find a card, and write up the expense afterwards.

In our demo company's history, 61 of 133 rush orders bought no time. $31,159 in premiums for nothing.

## What Burn does

The engineer types a part name, a short note on what it's for, and attaches the CAD. Burn does the rest:

1. **Reads the records.** Claude searches Slack, Jira, meeting notes and the calendar for what the part is for, which test it feeds, what else that test waits on, and the deadline. Every fact it reports carries a citation; anything it can't cite is thrown away.
2. **Gets the quote.** A real Chrome, driven by Playwright, uploads the CAD to the vendor site (a simulated Xometry in the demo) and reads back the price and lead time of every speed.
3. **Puts a dollar value on time.** The owner of the deadline sets what a day of delay is worth. Code counts, in working days, how many days each speed actually gains, divides the extra cost by the days gained, and compares. Under the day's worth: buy it. Over: don't. Gains no days because something else is the hold-up: never.
4. **Recommends.** Claude writes the card in two sentences; every number in it is checked against the computed ones first. The engineer clicks Okay, picks another tier, or tells Burn something it didn't know. Burn re-reads when a fact changes, and if the engineer overrides it, their reason travels with the request.
5. **Approval in Ramp.** The purchase request carries the verdict, days gained, break-even, the engineer's reason and a hash of the exact order. Small orders auto-approve under the company's Ramp rules; the rest go to the manager.
6. **Buys it.** Ramp issues a card locked to the vendor for exactly the approved total. Burn's browser reopens the quote, checks every field against the frozen order, and only then pays and places. If anything differs, it stops and tells the engineer.
7. **Books it.** When the charge clears, Burn attaches the receipt, a memo with the reason, and the project code. The premium is its own line, so "expedites that bought no time" is a Ramp report.

**The split is strict.** Claude reads the records, writes the words, and talks to the engineer. Plain code does every number, the approval request, the verification and the purchase. The model never prices, never approves, never clicks buy.

## Run the demo

```bash
npm install
npm run demo -- --reset      # http://localhost:5173/
```

Add `ANTHROPIC_API_KEY=...` to a `.env` file for the live agent (copy `.env.example`). Without it Burn runs on rules and template text and says so. [`DEMO.md`](DEMO.md) has the two-minute script.

1. **The map** (`/`): the dependency graph Burn rebuilt from nine months of the company's messages. The hip actuator bracket feeds the spin test, which also waits on a motor. *Step 2: order the bracket →*
2. **Enter it as Owen**: in real life the engineer types the part and attaches the CAD; this button does it for the demo. Watch Claude's searches stream in, the browser quote on Xometry, and the card: **Expedite**, $900 for 2 working days, break-even $450 against the owner's $600 a day. Rush buys nothing because the motor is the hold-up.
3. **Post the Slack message**: the motor arrived and the test moved to Nov 18. Burn re-reads and flips to **Rush**, the only tier that makes the date.
4. **Tell Burn** the old brackets will do for that test and choose **Standard**. Claude reads the reason, agrees, and sends it on.
5. **Ramp** (`/ramp`): $3,000, Standard chosen over Burn's Rush, the engineer's reason in their own words. **Approve.**
6. Back on the order: card issued, every field verified, placed, charged, booked. The engineer never opened Xometry or Ramp.

## What's real and what's simulated

Real: the Claude agent and its tool calls, the Playwright browser, the working-day maths, the order store, the Ramp state machine, the connectors. Simulated: Ramp and Xometry as services (our stand-ins, same fields and flow; Xometry's terms forbid bots, and the real path is Ramp's punchout), and the company itself. Flintlock Robotics is a generated 60-person robotics startup with nine months of Slack, Jira, meetings and calendar and a ground truth to grade against. Checked against that truth, the maths gets 400 of 400 past decisions right and Burn rebuilds about three quarters of the real dependencies from the messages alone.

## Known limits

- **The dollars-per-day values are invented.** There is no public data on what a day of schedule is worth at a hardware startup. Burn takes it from the deadline's owner and shows the break-even when there is none.
- **Burn catches the wasted rush in the demo, but 0 of the 61 past ones.** Most of them fed work (fit checks, rig setup) rather than a test, and Burn follows part → test → milestone only.
- **Xometry prices are modelled** from published anecdotes; real quotes need a CAD upload.
- **Not built:** delivery tracking and recording whether each premium actually bought time, the real xometry.com, the Ramp sandbox. A learned habit model was built and removed: it beat "never expedite" by nothing.

## Documentation

| Document | What's in it |
| --- | --- |
| [`DEMO.md`](DEMO.md) | The two-minute demo script and the answers for judges |
| [`docs/hld.md`](docs/hld.md) | One-page design: who does what, the flow, how the recommendation is made |
| [`docs/architecture.md`](docs/architecture.md) | The full design (v9), the cost-of-delay maths, the learning model, how the demo data was built |
| [`docs/running.md`](docs/running.md) | Environment variables, screens, API, code map, and the Time Value grading |
| [`docs/open-questions.md`](docs/open-questions.md) | What's not decided, and what has been |
| [`docs/research/`](docs/research/) | How startups buy parts, vendor APIs, Xometry automation, Ramp, data realism, cost of delay |
| [`fixtures/world/SCHEMA.md`](fixtures/world/SCHEMA.md), [`docs/build/`](docs/build/) | The Flintlock Robotics world: ground truth, generator spec, verification |

## Working in this repo

One short-lived branch per topic, merged into `main` through a pull request. Conventional Commits. When a decision is made, update `docs/architecture.md` and move the question to the Answered table in `docs/open-questions.md`. `npm test` runs the 265 tests.
