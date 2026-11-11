# Open questions

The single list of open questions. Update the status here when one is answered, and record the answer in [`architecture.md`](architecture.md) (or `collaboration/DECISIONS.md` for build decisions).

Owners: **A+O** = Arjun and Owen (product); **Build** = whoever is building it; **Ramp** / **Xometry** = needs an answer from that company.

## Product decisions (A+O)

| # | Question | Why it matters | Status |
|---|---|---|---|
| P1 | Who owns a milestone's value-of-time policy ($/day), and will they set it? | Without it Burn can only show break-evens, not recommend on economics | Open |
| P2 | What auto-approval limit will managers set in Ramp, and do large orders need a second approver? | Sets which demo orders skip the manager | Open |
| P3 | Will engineers reliably type a one-line summary of what the part is for? | The part entry is the retrieval anchor for all context | Open; ask users |
| P5 | Which demo story and cases: the hip-actuator bracket with cases A, B and D? | Drives the seeded data and script | Proposed |
| P6 | How many past orders before the habit model is shown at all? | Avoid showing a model trained on too little | Open |
| P7 | Do expedited parts actually sit unused at real startups? | Core pitch claim; no public data found | Open; ask users |

## Ramp and Xometry

Not needed for the demo: every external service is mocked (architecture §2.18). The verification questions (sandbox access, early access, Vault cards, Xometry terms and Teamspace) apply only if the real services are connected later; see `research/ramp-integration.md` and `research/vendor-apis.md`.

## Build and data

| # | Question | Status |
|---|---|---|
| B1 | What fraction of past Ramp charges can be linked confidently to Slack context and a Xometry order? | Measure on synthetic data first; report the link rate |
| B3 | What is the first-use signal: an engineer tap, or something already recorded (Jira, an assembly log)? | Engineer tap for v1 |
| B5 | Who builds the remaining pieces: the company dependency graph (tonight), part-entry screen and recommendation card, automatic placement and bookkeeping, training and heat map? | Open (see Answered for what's assigned) |

## Answered

| Question | Answer | Where |
|---|---|---|
| What does the habit model learn from? | Only the context heat map (context linked to the part, per time band before T, plus the requester's expedite rate and the extra cost of the fastest tier); never the dependency graph. Label from the Ramp receipt | architecture §10 |
| Per-order search, or a persistent graph? | One company-wide dependency graph, built continuously from every source; orders navigate it. Built tonight | architecture §2.1, §6.1 |
| Do we need a BOM? | No; the demand anchors the decision | architecture §2.3 |
| Who approves? | The engineer's manager, in Ramp | architecture §2.12 |
| Is supply chain in the purchase? | No; a context source and tracking | architecture §2.13 |
| Engineer click or automatic placement? | Automatic on approval; the engineer is alerted before any browser tab opens | architecture §0.4, §2.16 |
| Use the Claude–Codex collaboration workflow? | No; dropped | CLAUDE.md |
| Real Ramp sandbox or mocks? | Mock everything: Ramp, Xometry, Slack, Jira, meetings, calendar | architecture §2.18 |
| Example company for the demo data? | Flintlock Robotics, a fictional humanoid robotics startup | architecture §12 |
| Who builds what (so far)? | Owen: world script and its generator. Arjun: the other mock services (Ramp, Xometry, Slack, Jira, meetings, calendar). Cost of delay: Owen and Arjun together. Rest: unassigned (B5) | — |
| Which vendor first? | Xometry only, via the browser extension | architecture §2.14 |
| Does Xometry have a test mode or buyer API? | No; demo stops at a dummy checkout page | architecture §0.4 |
| Ramp MCP / Agent Cards instead of REST? | No; REST with app credentials; MCP is a stretch check | research/ramp-integration.md §2 |
