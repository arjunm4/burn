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

Not needed for the demo: every external service is mocked (architecture §2.18). The verification questions (sandbox access, early access, Vault cards, Xometry terms and Teamspace) apply only if the real services are connected later; see `research/ramp-integration.md` and `research/vendor-apis.md`. The findings so far are kept below.

### If the real services are connected later

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
| X1 | Do Xometry's terms allow automated (headless) quoting and checkout? | **No, as written**: the Customer Service Agreement bans robots and scrapers (§7.1.2) and account sharing (§7.1.7); robots.txt disallows `/quoting/`, `/checkout/`, `/login`. Sanctioned paths: cXML punchout or Xometry's written permission. Demo-only until resolved ([research](research/xometry-automation.md)) |
| X5 | Can we set up a company Xometry account (Teamspace purchasing user) for Burn's headless browser, and does it need 2FA or a CAPTCHA at login? | Partly: a dedicated Teamspace member works (roles are Admin/Contributor; any member can check out a shared quote); Auth0 login with optional email-code MFA; card or PO payment; quotes held 30 days. **Still to test:** session length, and entering a fresh Ramp card per order ([research](research/xometry-automation.md)) |
| X6 | Does Xometry show bot detection to a headless browser (quote upload and checkout)? | Light on pages (Cloudflare, no challenge seen); **login uses Auth0 Bot Detection (Cloudflare Turnstile)**; React quote page with a hidden file input; FullStory session replay records visits. Log in by hand once and reuse the session; test early ([research](research/xometry-automation.md)) |
| X2 | Does Teamspace quote sharing work for every quote type, so placement reuses the engineer's quote? | Unknown |
| X3 | How long is a Xometry quote valid? | Unknown (Protolabs and SendCutSend: 30 days) |
| X4 | Is there a buyer API or partner arrangement on request? | Ask Xometry; punchout exists for enterprise |

## Build and data

| # | Question | Status |
|---|---|---|
| B1 | What fraction of past Ramp charges can be linked confidently to Slack context and a Xometry order? | Measure on synthetic data first; report the link rate |
| B3 | What is the first-use signal: an engineer tap, or something already recorded (Jira, an assembly log)? | Engineer tap for v1 |
| B5 | Who builds the remaining pieces: the company dependency graph (tonight), part-entry screen and recommendation card, automatic placement and bookkeeping, training and heat map? | Open (see Answered for what's assigned) |
| B7 | Headless runtime: local Playwright on the demo laptop, or a hosted browser (e.g. Browserbase) for always-on placement? | Recommended: local Playwright with a saved Chrome profile plus video/trace for the demo; Browserbase for production (persistent contexts, 30-day replays, live view, identifies the agent); Kernel runner-up. Plain Playwright for exact steps, Stagehand only for reading prices; never let an LLM place the order ([research](research/xometry-automation.md)) |
| B6 | `scripts/collab.mjs` fails on Node 14 (`randomUUID`); the README requires Node 24.2+ | Use Node 24 locally |

## Answered

| Question | Answer | Where |
|---|---|---|
| Keep the habit model in the demo? | No: removed. The card shows the schedule decision only; the code was deleted (in git history). On world v2 it scored 56% vs 60% for never-expedite (n = 45); recoverable from git history | docs/build/time-value-plan.md |
| What does the habit model learn from? | Only the context heat map (context linked to the part, per time band before T, plus the requester's expedite rate and the extra cost of the fastest tier); never the dependency graph. Label from the Ramp receipt | architecture §10 |
| Per-order search, or a persistent graph? | One company-wide dependency graph, built continuously from every source; orders navigate it. Built tonight | architecture §2.1, §6.1 |
| Do we need a BOM? | No; the demand anchors the decision | architecture §2.3 |
| Who approves? | The engineer's manager, in Ramp | architecture §2.12 |
| Is supply chain in the purchase? | No; a context source and tracking | architecture §2.13 |
| Engineer click or automatic placement? | Automatic on approval; the engineer is alerted before any browser tab opens | architecture §0.4, §2.16 |
| Use the Claude–Codex collaboration workflow? | No; dropped | CLAUDE.md |
| Real Ramp sandbox or mocks? | Mock everything: Ramp, Xometry, Slack, Jira, meetings, calendar | architecture §2.18 |
| Example company for the demo data? | Flintlock Robotics, a fictional humanoid robotics startup | architecture §12 |
| Who builds what (so far)? | Owen: world script and its generator. Arjun (with Claude): the flow, the decision core, the connectors and extractor, the Ramp mock and Ramp-side view, the simulated Xometry site and headless provider, notifications, demo controls. Cost of delay: Owen and Arjun together. Rest: unassigned (B5) | README “Status” and code map |
| Which vendor first? | Xometry only, through a provider interface; no browser extension. Demo: the simulated Xometry site; production: Burn's server-side headless browser on a company account | architecture §2.14 |
| Extension in the engineer's browser, or server-side? | Server-side headless browser on a company Xometry account, for both quoting and placement, so placement is immediate on approval | architecture §2.14, §0.2, §0.4 |
| Does Xometry have a test mode or buyer API? | No; demo stops at a dummy checkout page | architecture §0.4 |
| Ramp MCP / Agent Cards instead of REST? | No; REST with app credentials; MCP is a stretch check | research/ramp-integration.md §2 |
