# Research: custom-manufacturing vendor APIs and team accounts

Date: 2026-11-10. Synthesized from two web-research passes: the major CNC and sheet-metal vendors, then a wider search including EU and Asian services and marketplaces.

"None found" means searched and not found, not proof of absence. [3p] marks findings resting on supergood.ai, a third-party API audit site.

Related: [`../architecture.md`](../architecture.md) §0.4 and §2.14, [`ramp-integration.md`](ramp-integration.md).

## Bottom line

- **No major CNC vendor offers a usable buyer API.** Xometry's developer API is for its *suppliers* (machine shops), not buyers.
- **Only one self-serve CNC buyer API exists: AFN**, and it doesn't fit v1 (no sandbox, merchant of record, shipping options rather than production tiers, unproven).
- **Real buyer APIs exist for PCB and 3D printing** (PCBWay, JLC, partner-only; Shapeways, Sculpteo).
- **Almost every vendor supports team accounts with quote sharing.** This is what makes the extension approach work: the engineer's quote is the same quote checked out at placement.
- **Decision (updated):** Xometry behind a provider interface shaped like AFN's API, mocked for the demo; no browser extension (architecture §2.14). Xometry has **no test mode**, so the demo stops at a dummy checkout page.

## CNC and sheet-metal vendors

| Vendor | Quote API | Order API | Status API | Access | Team accounts / quote sharing | Sources |
|---|---|---|---|---|---|---|
| **Xometry** | None for buyers. developer.xometry.com is supplier-side (Jobs, Offers, Line Items, Webhooks) | None for buyers. cXML **punchout** to Coupa/Ariba/SAP/MS Dynamics, PO and invoice automation via TradeCentric | Supplier webhooks only | Supplier API: approved partners. Punchout: enterprise sales | **Teamspace**: share quotes with a team, optional auto-share; purchasing checks out | [developer](https://developer.xometry.com) · [punchout](https://www.xometry.com/xometry-enterprise/xometry-integration-punchout) · [Teamspace](https://community.xometry.com/kb/articles/804) |
| **Protolabs** | None found ("no public API" [3p]) | None found; no punchout found | None | — | Forwarded quote gives the recipient full rights to edit and order | [sharing](https://protolabs.helpdocs.io/l/en/help-center/sharing-quotes) · [3p](https://supergood.ai/api-report-card/protolabs) |
| **Hubs / Protolabs Network** | None found | None found | None | — | Team account: shared billing, Net 30, a designated member turns quotes into orders | [team account](https://hubs.com/team-account) |
| **Fictiv** | None | cXML punchout (Ariba, Coupa, Dynamics 365), only for quotes fully configured on Fictiv | None | Business customers via Fictiv Teams, through sales | Share a quote to a purchaser; any team member can check out | [procure-to-pay](https://fictiv.com/articles/fictiv-premium-membership-now-includes-new-procure-to-pay-integration) · [Teams](https://fictiv.com/help/fictiv-teams/managing-quotes-and-orders-in-a-team) |
| **SendCutSend** | None (api.sendcutsend.com: "route not found" [3p]) | None | None | — | Organizations: shared Net 30 and PO; Formal Quote for purchasing approval | [business account](https://sendcutsend.com/faq/how-to-set-up-business-account) |
| **OSH Cut** | None found | None found | None | — | Company accounts: "Send As Quote" emails a PDF and purchase link to purchasing | [enterprise](https://oshcut.com/enterprise-features) |
| **RapidDirect** | None; SolidWorks add-in quotes only | None | None | — | Teamspace (claims procure-to-pay hookup) | [Teamspace](https://rapiddirect.com/our-platform/teamspace) |
| **Jiga** | None found | Marketing mentions sending POs from an ERP; mechanism undocumented | None found | — | "Collaborate" feature | [collaborate](https://jiga.io/collaborate) |
| **Quickparts** | None found (web and email quoting) | None | None | — | Not found | — |
| **eMachineShop** | Nothing found | — | — | — | — | — |
| **MakerVerse** | "Customized API connections" (pricing, DFM, ordering), ERP connectors | Same | Unknown | Partner/enterprise only; marketing only | — | [MakerVerse Connect](https://www.makerverse.com/makerverse-connect/) |
| **Laserhub, CNC24, Facturee, Weerg, Karkhana, Geomiq, 3ERP, Treatstock** | No buyer API found (CNC24 quotes manually within 48h; Geomiq "no public API" [3p]) | — | — | — | — | — |

## The one CNC buyer API: AFN

**Agentic Fabrication Network** (operated by FabNet.Ai). [docs](https://agenticfabricationnetwork.ai/docs), spec at `/openapi.json`.

- **Calls:** `POST /v1/files` (STEP/STL/DXF), `POST /v1/quotes` (ranked offers with price, ETA, `shipping_options`), `/refine`, `/price-curve`, `POST /v1/checkout`, `GET /v1/orders/:id` (status, ETA, tracking).
- **Processes:** CNC, sheet metal, laser cut, FDM/resin.
- **Access:** self-serve. `POST /v1/agents` returns a `ufp_sk_` key, used as a Bearer token.
- **Why not v1:** no sandbox (checkout returns a hosted `checkout_url` a person must pay); AFN is merchant of record, so no bill-to-account and a conflict with the Ramp card; speed comes from shipping options and quantity, not production tiers; US shipping only; fulfilling shops unnamed; new and unproven.
- **Use:** its API shape informs Burn's provider interface (upload → quote tiers → order → status); a later provider.

## PCB and 3D-printing APIs (later candidates)

| Service | Covers | Access | Sandbox | Notes |
|---|---|---|---|---|
| **PCBWay** | `PcbQuotation`, `SMTQuotation`, `PlaceOrder`, `ConfirmOrder` (pays), `CheckOrderDetails`, `QueryOrderProcess` | Partners only (apply by email); api-key header | Yes | PCB and SMT only. [docs](https://api-partner.pcbway.com/Help) |
| **JLCPCB / JLC3DP** | Quote, order, tracking for PCB, stencil, 3D printing; **no CNC** | By application; ordering tier needs monthly volume | Unknown | [api.jlcpcb.com](https://api.jlcpcb.com/) |
| **Shapeways** | Model upload, materials, cart, orders (no explicit quote endpoint) | Self-serve, OAuth2, "free" | Not documented | 3D printing only; went through bankruptcy, API status unverified. [docs](https://developers.shapeways.com/) |
| **Sculpteo** (BASF) | Upload, price, order, tracking | Partner access; invoicing account | A test flag that places orders without producing or charging (per search excerpts) | 3D printing only; docs returned 403. [API](https://www.sculpteo.com/en/services/api-services/) |
| **Craftcloud** (All3DP) | Unofficial old gem returns a configurator URL | Not public | Unknown | CNC launched Aug 2025; no API for it found |
| **i.materialise** | Had documented APIs and a sandbox | — | — | **Closed** (no orders after 2025-10-31) |
| **Paperless Parts** | Shop-side API (quotes and orders into a shop's ERP) | Each shop's token | — | Not usable by a buyer. [API](https://www.paperlessparts.com/api/) |

## Integration routes ranked

1. **Browser extension + vendor team account** (v1): works with Xometry today; quote sharing gives the same-quote guarantee; terms of service unverified.
2. **Punchout** (Xometry, Fictiv): needs the customer to run Coupa or Ariba and an enterprise deal; no Ramp or Zip support found.
3. **Vendor partner API** (PCBWay, JLC): real, but PCB/3D printing only.
4. **AFN:** self-serve CNC API, but doesn't fit the Ramp-paid, production-tier flow yet.
5. **Server-side bot driving vendor sites:** rejected (no official support, bot detection, credentials on our servers, terms unverified).

## Terms of service

No explicit bot or scraping clause was confirmed. SendCutSend's terms forbid reproducing or exploiting "any portion of the Service." Xometry's terms page returned 404 when fetched. Read each vendor's terms before automating its website (open question X1).
