# Research: integrating Burn with Ramp (hackathon and demo)

Date: 2026-11-10. Compiled by Claude (orchestrator) from three parallel research agents: (1) the Ramp REST call path, read from Ramp's OpenAPI spec and developer guides; (2) Ramp's agent tooling (MCP, CLI, Agent Cards) and positioning; (3) hackathon scope and demo design, read against this repo. Where the agents disagreed, the resolution is noted. **UNVERIFIED** marks anything not confirmed in Ramp's docs or a live sandbox.

Related: [`docs/architecture.md`](../architecture.md) §0.3, §0.4, §16.

## Bottom line

1. **Use Ramp's REST API with a server-side app token as the backbone.** Ramp's MCP servers and Agent Cards are not a shortcut for our flow:
   - The open-source MCP is read-only analytics.
   - The hosted MCP needs per-user OAuth consent, its tool list is unverified, and its sandbox support is unconfirmed.
   - Agent Cards assume the user authorizes the payment, while our flow is a manager-approved purchase request. They may also be beta-gated.
2. **Build one Ramp client with two backends, `RAMP_MODE=mock|sandbox`.** Start on the mock, and switch to the sandbox step by step as each call is verified. Sandbox access, and the early-access purchase-request feature, may arrive late or not at all.
3. **Three parts are realistic in the sandbox, per Ramp's docs:** the Xometry-locked card with an exact limit, the webhooks, and booking the receipt, memo and project code. **Two are uncertain:** the purchase request (early access) and the delivery receipt (needs the Plus plan).
4. **Positioning:** Burn is a vertical agent that plugs into Ramp's controls. Ramp's own procurement agents (launched April 2026) cover generic intake, compliance and vendor research. Nothing we found covers CAD, manufacturing tiers or vendor-specific ordering.

## 1. Ramp API path per step

Base URLs: sandbox UI `demo.ramp.com`, API `demo-api.ramp.com`, Vault (card numbers) `demo-vault-api.ramp.com`. Sandbox and production need separate apps.

**Auth:** Client Credentials. `POST /developer/v1/token` with Basic auth (client id and secret) and the form body `grant_type=client_credentials&scope=<space-separated scopes>`. If `scope` is left out, the token has no scopes. Tokens last 10 days, with no refresh. Actions that need a user are attributed to the person who created the app.

| Step | Calls | Scopes | Gating | Sandbox |
|---|---|---|---|---|
| Look up IDs | `GET /spend-programs`, `GET /users` | read scopes | — | Yes |
| Purchase request | `POST /unified-requests` (required: `currency`, `request_owner_id`, `spend_program_id`; optional: `name`, `line_items`, `field_answers`, `submit`), plus `POST /unified-requests/{id}/attachments` for the quote PDF | `unified_requests:write` | **Early access** per business; purchase-order or approval-only spend programs only; a required file-upload field in the form causes a failure | **UNVERIFIED** |
| Manager approval | The manager approves in Ramp's UI. Burn follows the `unified_requests.*` webhooks or polls `GET /unified-requests/{id}` | — | Burn cannot approve on the manager's behalf | Yes, if the request works |
| Card with number | `POST demo-vault-api…/developer/v1/cards/vault` (required: `user_id`; `spending_restrictions` with `interval` and `limit`, plus `allowed_vendors` (merchant names), `transaction_amount_limit` (cents) and `lock_date`). Returns the PAN, CVV and expiry | `cards:read_vault`, `limits:write` | Production needs Ramp's PCI review | **Yes** ("all customers can use the Vault API in Sandbox") |
| Webhooks | `POST /webhooks` (`endpoint_url`, `event_types`), answer the challenge, then `POST /webhooks/{id}/verify`. Each event is signed with HMAC-SHA256 in `X-Ramp-Signature`. `POST /webhooks/mock-webhook-event` fires test events | — | Needs a public HTTPS endpoint (a tunnel) | Yes |
| Simulate the charge | ⌘J in demo.ramp.com → "add transactions" | — | Manual; no API | Yes. Whether it applies the card's merchant lock is **UNVERIFIED** |
| Booking | `POST /memos/{transaction_id}` (`memo`); `POST /receipts` (multipart: `idempotency_key`, `receipt`, `user_id`, `transaction_id`); `POST /accounting/codings` (`object_id`, `object_type`, `accounting_coding_selections`) | `memos:write`, `receipts:write`, `accounting:write` | Accounting fields must exist (create them with `POST /accounting/fields`) | Yes |
| Delivery receipt | `POST /item-receipts` (`purchase_order_id`, `item_receipt_number`, `received_at`, line items). Needs a PO, either from a PO-type approved request or `POST /purchase-orders` | `item_receipts:write`, `purchase_orders:write` | **Plus plan**, plus the Procurement add-on | **UNVERIFIED** |

**Fallbacks if a step is blocked:**

| Blocked | Use instead |
|---|---|
| Purchase request (early access) | Create the request by hand in demo.ramp.com and have Burn poll for approval. Or `POST /spend-requests/draft-via-ocr` from the Xometry quote PDF (early access UNVERIFIED) |
| Vault card | A standalone fund (`POST /funds` with `virtual_card` permitted, an exact limit and `allowed_vendor_ids`) plus Embedded Cards to show the card number to a person (`localhost` allowed in the sandbox) |
| PO or delivery receipt | Record delivery as a memo on the transaction, plus Burn's own record |
| Sandbox access entirely | The mock backend (§3) |

**Minimum real-Ramp path:** get the sandbox app token → issue the Vault card (Xometry only, exact amount, lock date) → simulate the charge with ⌘J → `transactions.cleared` webhook → attach the memo, receipt and coding. Stage the manager's approval in the UI if the request API isn't enabled.

## 2. Ramp agent tooling (evaluated, not adopted)

| Tool | What it is | Verdict |
|---|---|---|
| Open-source `ramp-public/ramp-mcp` | Local stdio server with client credentials; defaults to the demo environment; only `load_*` read tools plus a SQLite query helper | Read-only. Can't create requests or cards |
| Hosted Ramp MCP | OAuth as the signed-in user; "full access" or read-only; 30-day connections; custom clients may need allowlisting | Tool list and sandbox support **UNVERIFIED**. Worth a 15-minute check at the hackathon |
| Ramp CLI (`ramp-public/ramp-cli`) | `ramp auth login`, `--env sandbox`, JSON output | Handy for setting up the sandbox (seeding funds, users), not as the runtime |
| Agent Cards | One-time card details from a fund (`ramp funds creds <fund_id>`), with merchant, amount and rationale; fund limits apply | Different approval model (user authorization, not a manager-approved request); possibly beta-gated. **Optional stretch** to show at checkout |

Ramp's procurement agents (launched April 29, 2026; co-built with Browserbase) handle intake, compliance research, sourcing, RFx and routing. They are generic and software-focused. **Pitch:** "Ramp's controls are the trust layer; Burn is the hardware domain expert that feeds them." The partner listing is an application process with no hackathon-speed path. Say "built on Ramp's Developer API", not "a listed Ramp app". No public third-party purchasing agent on Ramp was found.

## 3. Hackathon build plan

> **Update (v9):** the design replaced the browser extension with Burn's server-side headless browser on a company Xometry account (architecture §2.14). Read "extension" below as the headless Xometry provider; it also places the order immediately on the Ramp approval webhook.

**What exists in the repo:** Vite/React, Node and SQLite; the `/request` conversation and `/approvals` queue with streamed tool events; Slack and ICS connectors; the DAG engine; an agent with an offline fallback. All of it is built around the old Digi-Key sensor example. There is no extension, no Ramp client, no part entry and no Xometry quote model.

| Component | Demo value | Effort | Call |
|---|---|---|---|
| Recommendation card with break-even and the motor-date flip | Highest | Low (reuse the engine; replace the money logic in `src/decisions.js`) | **Real** |
| Part entry plus context gathering | High | Low–medium (retrofit `/request`) | **Real** UI; live seeded Slack; Jira and meeting notes as fixtures |
| Ramp request → approval → card → booking | High | Medium | **Mock first**, switching to the sandbox per step |
| Extension fills Xometry and reads back tiers | High | Medium–high (riskiest) | **Real**, fill and read only; recorded fallback |
| Verified read-back before placement | High | Medium | **Real** against a dummy checkout page, including one forced mismatch |
| Place order | Medium | Low | Dummy checkout page (Xometry has no test mode) |
| Question loop | Medium | Low | One scripted question (case D) |
| Tracking, slip re-check, first use | Low | Medium | **Cut**; one static slip alert at most |
| Learning model, backfill, heat map | Low live | High | **Slide**, labelled as simulated |
| World-script generator | Low | High | ~15 hand-written past orders |

**Order of work:** decision core and card → Ramp mock → extension (start it on day one, in parallel) → sandbox switch-over → polish and a recorded run.

### Ramp mock (`server/ramp/`)
- One client interface with two backends, `mock` and `sandbox`, selected by `RAMP_MODE`.
- The mock is about 200 lines, stores state in the existing SQLite, and **mirrors the real request and response fields in §1**. Use `spend_program_id`, `request_owner_id`, `field_answers` and `spending_restrictions`, not invented names. *Resolution: the scope agent proposed generic field names; the spec-based names from §1 take precedence.*
- It POSTs webhooks to Burn's own webhook route, so the real code path runs.
- It provides a "simulate charge" action standing in for ⌘J, which fires `transactions.cleared`.
- Approval UI: a Ramp-like approver page in our app, labelled **"Ramp (simulated)"**. Switch to demo.ramp.com only once the sandbox request API works. *Resolution: both agents agree demo.ramp.com can't show our requests unless `unified-requests` is enabled for the sandbox business.*
- The card number is handed to the extension only through a one-time Burn endpoint, and never logged.

## 4. Demo script (3 minutes)

| Time | Beat | On screen | Live or mocked |
|---|---|---|---|
| 0:00–0:20 | The pain: a $3,000 vs $3,900 gut call, then re-keyed, justified and approved by hand | One slide | Slide |
| 0:20–0:50 | "Hip-actuator bracket, for the spin test, need it soon" plus the STEP file | Part entry; context streaming in from Slack, Jira and calendar | Live (seeded Slack) |
| 0:50–1:20 | The extension fills Xometry and reads back the tiers | Split screen | Live, with a recorded fallback |
| 1:20–1:50 | **Wow 1:** "Expedited +$900 buys 2 days; break-even $450/day; policy $600." Move the motor to day 12 and the recommendation flips to Standard ("faster changes nothing") | Comparison card | Live |
| 1:50–2:15 | Okay creates the Ramp request; the manager approves; the webhook arrives | Ramp approval → Burn status | Mock or sandbox |
| 2:15–2:45 | A $3,900 Xometry-only card is issued. **Wow 2:** the extension checks every field, and a forced mismatch blocks placement. Then the clean run stops at the dummy checkout | Card, verification table, dummy page | Card mock or sandbox; verification live |
| 2:45–3:00 | The charge clears, and the receipt, memo and GL code fill in by themselves. Close on "Burn plugs into Ramp" | Coded Ramp transaction | Mock or sandbox (⌘J) |

## 5. Live-demo risks

| Risk | Mitigation |
|---|---|
| The Xometry extension breaks (bot checks, page changes, slow quotes) | Reopen a saved Teamspace quote; keep a local copy of the page; record a clean run with identical numbers |
| Auth (Xometry session, Slack, Ramp) | Log in before going on stage; tokens in `.env`; the Ramp token lasts 10 days |
| Venue wifi | Run everything locally with the mock as default; phone hotspot as backup |
| Webhooks need a public URL | A tunnel set up in advance; fall back to polling |
| Sandbox not granted in time | The mock is the default; switching is a config flag |
| Accidentally buying a real part | Never submit Xometry's real checkout; the dummy page is labelled |
| Two beats fail in a row | Switch to the recorded 3-minute video |

## 6. Likely judge questions

- **"Does the agent move money on its own?"** No. A manager approves in Ramp, and the card is locked to Xometry for the exact amount.
- **"What if the price changes after approval?"** The spec hash doesn't match, nothing is placed, and Burn creates a new Ramp request.
- **"Why not just use Ramp's own agents?"** They handle generic intake and compliance. Burn adds the hardware context and the vendor ordering, and feeds Ramp's controls.
- **"Where does the dollar value of a day come from?"** From the milestone owner's policy. Without one, Burn shows the break-even and asks.
- **"Does Xometry allow this?"** There's no buyer API. The extension runs in the user's own session. Whether Xometry's terms allow it is unverified; punchout or an API partnership is the production path.
- **"What's real in this demo?"** The decision maths, the context and the Xometry fill are real. Checkout stops at a dummy page. Ramp is the sandbox or a labelled mock.
- **"How does it learn?"** An advisory model on context attributes, trained on simulated history. It abstains when data is sparse.

## 7. Actions before the hackathon

1. **Request Ramp sandbox access now** (docs.ramp.com/developer-api/v1/sandbox-access). Ask Ramp to enable `unified-requests` early access and the Plus features on the sandbox business.
2. Create the sandbox app with these scopes: `unified_requests:write`, `cards:read_vault`, `limits:write`, `funds:write`, `memos:write`, `receipts:write`, `accounting:write`, `transactions:read`, `purchase_orders:write`, `item_receipts:write`, `users:read`, `spend_programs:read` (check the exact scope names in the app settings).
3. Set up a Xometry Teamspace and save a quote for the bracket.
4. Set up the demo Slack workspace and seed it.
5. At the hackathon, spend 15 minutes checking whether the hosted Ramp MCP or CLI exposes request or card tools in the sandbox.

## 8. Sandbox access timeline (researched 2026-11-10)

- **Stated:** Ramp's support article says the sandbox "should be ready in about one minute" after the sandbox access form, followed by an account access email. [support article](https://support.ramp.com/hc/en-us/articles/46681939909907-Accessing-the-Developer-API) · [form link](https://docs.ramp.com/developer-api/v1/sandbox-access)
- **Conflict:** one search summary claimed a support page calls the sandbox "not self-serve" and points to a support ticket; that wording was not found on the fetched pages.
- **Requirements:** creating a developer app needs Admin access; sandbox credentials come from a separate app created inside demo.ramp.com. The getting-started guide is written for "a Ramp customer with admin access." Whether non-customers can use the form is **UNVERIFIED** (its fields could not be read).
- **Early-access features** (purchase requests via the API, Custom API workflow): no timeline found. A changelog says the API supports the full procurement-request lifecycle. [releases.sh](https://releases.sh/ramp/overview.md)
- **Production access:** a separate application with no stated timeline; publishing an app for other businesses needs a partner application too.
- **Free plan:** no official source says the free plan can create developer apps; one third-party claim says basic API access comes with any account (**UNVERIFIED**).
- **Hackathons:** Ramp ran "Builders Cup 2026" (NYC, students); no evidence of hackathon-issued API credentials. [listing](https://luma.com/nrletiv9)
- **Ramp MCP** signs in as your Ramp account; it is not a sandbox shortcut.

**Fastest path:** submit the sandbox form today (minutes, if it works as documented) → create the sandbox developer app with client credentials → in parallel, ask Ramp support to enable purchase requests on the sandbox business.

**If access is not granted:** the mock backend in §3 (`RAMP_MODE=mock`), which mirrors Ramp's real request, card, transaction and booking fields and is labelled as simulated. Switching to the sandbox later is one setting.

## Sources

- Ramp OpenAPI spec and guides (downloaded locally): docs.ramp.com/openapi/developer-api.json, docs.ramp.com/llms.txt and the guides for sandbox, authorization, procurement, procurement-intake, virtual-cards, webhooks, agent-payments and rate-limiting
- github.com/ramp-public/ramp-mcp; docs.ramp.com/llms-guides/ramp-mcp.txt; docs.ramp.com/llms-guides/cli.txt
- agents.ramp.com/skills/ramp-agentic-purchase; agents.ramp.com/docs/guides/agentic-payments
- ramp.com/blog/procurement-ai-agents; browserbase.com/blog/case-study-ramp
- docs.ramp.com/llms-guides/build-with-ramp.txt
