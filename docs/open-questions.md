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

## Ramp (verify)

| # | Question | Status |
|---|---|---|
| R1 | Sandbox access: request submitted? How long does approval take? | **Action: request now** at docs.ramp.com/developer-api/v1/sandbox-access |
| R2 | Can `unified-requests` (purchase requests) early access be enabled on the sandbox business? | Ask Ramp; fallback is a request made by hand in the UI |
| R3 | Does the sandbox business have Plus / Procurement (needed for purchase orders and item receipts)? | Unknown; fallback is a memo plus Burn's own record |
| R4 | Does a ⌘J simulated transaction respect the card's merchant lock and amount? | Unknown |
| R5 | Exact format of `allowed_vendors` on Vault cards (names vs merchant IDs) | Unknown |
| R6 | Production Vault card access (PCI review) | Post-hackathon |
| R7 | Does the hosted Ramp MCP or CLI expose request or card tools in the sandbox? | Check for 15 minutes at the hackathon |

## Xometry (verify)

| # | Question | Status |
|---|---|---|
| X1 | Do Xometry's terms allow extension-driven quoting and checkout? | Unknown (terms page could not be fetched) |
| X2 | Does Teamspace quote sharing work for every quote type, so placement reuses the engineer's quote? | Unknown |
| X3 | How long is a Xometry quote valid? | Unknown (Protolabs and SendCutSend: 30 days) |
| X4 | Is there a buyer API or partner arrangement on request? | Ask Xometry; punchout exists for enterprise |

## Build and data

| # | Question | Status |
|---|---|---|
| B1 | What fraction of past Ramp charges can be linked confidently to Slack context and a Xometry order? | Measure on synthetic data first; report the link rate |
| B2 | Which meeting recorder and Jira data can we read, and what are the channel access rules? | Open; synthetic for the demo |
| B3 | What is the first-use signal: an engineer tap, or something already recorded (Jira, an assembly log)? | Engineer tap for v1 |
| B4 | Demo Slack workspace: who sets it up and seeds it? | Open |
| B5 | Who builds which pieces (extension, Ramp client/mock, decision core, training data)? | Open |

## Answered

| Question | Answer | Where |
|---|---|---|
| Do we need a BOM? | No; the demand anchors the decision | architecture §2.3 |
| Who approves? | The engineer's manager, in Ramp | architecture §2.12 |
| Is supply chain in the purchase? | No; a context source and tracking | architecture §2.13 |
| Engineer click or automatic placement? | Automatic on approval; the engineer is alerted before any browser tab opens | architecture §0.4, §2.16 |
| Use the Claude–Codex collaboration workflow? | No; dropped | CLAUDE.md |
| Which vendor first? | Xometry only, via the browser extension | architecture §2.14 |
| Does Xometry have a test mode or buyer API? | No; demo stops at a dummy checkout page | architecture §0.4 |
| Ramp MCP / Agent Cards instead of REST? | No; REST with app credentials; MCP is a stretch check | research/ramp-integration.md §2 |
