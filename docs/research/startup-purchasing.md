# Research: how hardware startups buy custom parts

Date: 2026-11-10. Synthesized from three web-research passes: expedite decisions, BOMs and purchase requests, and receiving and part-use tracking.

**Evidence quality:** thin. Reddit and Hacker News were mostly blocked from the research tools, so most sources are vendor docs, vendor case studies and job postings. Treat conclusions as directional and confirm them in user interviews. Labels used below: **evidence** (first-hand or primary), **vendor** (a company describing its own product or selling a fix), **inference** (ours).

Related: [`../architecture.md`](../architecture.md), [`../open-questions.md`](../open-questions.md).

## Summary

| Question | Finding | Confidence | Implication for Burn |
|---|---|---|---|
| Are tiers and prices public? | Tier structures are documented; **premiums appear only inside quotes** | High | Capture the full quote; there is no price list to look up |
| Do quotes expire? | 30 days at Protolabs and SendCutSend; a CAD change needs a new quote | High | Expiry and revalidation in the order flow |
| Are expedited dates reliable? | No audited data. Fictiv claims 95.4% on time (self-reported); Xometry publishes no rate, overall or for Expedite (re-checked 2026-11-10); one unverified buyer anecdote says ~95% | Low | Don't promise vendor-reliability learning early |
| Who approves expedites? | **No direct evidence.** Engineers buy on a card at seed stage; a dedicated buyer appears around Series A | Low | Approval is a product decision (manager, in Ramp) |
| Are BOMs current, and do they include fixtures? | Spreadsheets and lightweight tools, often stale; fixtures and jigs are usually outside the BOM | Medium | Dropped the BOM; the demand is the anchor |
| Do requests say what a part is for? | Requests carry *when*, not *for what* | Low–medium | Ask for a one-line summary in the part entry |
| Is receipt recorded separately from payment? | Only with tooling (inventory apps; Ramp 3-way match) | Medium | Burn records delivery itself |
| Is first use recorded? | Rarely at small startups; physical kitting bins | Low | Ask the engineer with one tap |
| Do expedited parts sit unused? | **No public data** | None | Plausible, undocumented: ask users; an opening for the pitch |
| Does a tool already recommend expedite vs standard per part? | None found | Medium | Burn's gap |

## 1. Vendor tiers, prices and expiry

- **Protolabs CNC:** Standard 3 business days; Expedite same-day/1/2 days "as available"; Economy 7/12/18 days; "Manufactured Globally" 11/14/23 and "Made in USA" 5/9/13. Finishing adds time (anodize +5 days, inspection report +3–7). A flexible lead time (6–12 days) gives an unpublished discount. Quotes are valid 30 days; a CAD change needs a new quote. [lead times](https://www.protolabs.com/help-center/lead-times/) · [flexible](https://www.protolabs.com/en-gb/resources/blog/cnc-flexible-lead-time-option-save-costs-with-longer-lead-times/) · [quote terms](https://www.protolabs.com/legal-notices/protoquote/)
- **Xometry:** Expedite, Standard, Economy, plus International Economy. No published day counts or premiums. Expedite gets "prioritization" but no ground shipping. If any part in a quote can be expedited, Expedite pricing applies to the whole quote. Quote validity not found. [lead-time options](https://www.xometry.com/resources/blog/lead-time-options/) · [FAQ](https://www.comparably.com/companies/xometry/faqs)
- **Fictiv:** several lead-time options per part; **the whole order ships with the slowest part**. [help](https://www.fictiv.com/help/getting-a-quote/how-do-i-select-a-lead-time-for-my-quote)
- **SendCutSend:** Standard (free, 2–4 business days), Fast (1–3), Faster (1–2), Fastest (ships within 24h); fees shown only at checkout. CNC 2–7 days, anodize +7–10. Formal quotes expire after 30 days. Misses on the expedited production window are refunded; delivery dates are not guaranteed. [rush](https://sendcutsend.com/rush-production) · [lead times](https://sendcutsend.com/lead-times-new/) · [quote expiry](https://sendcutsend.com/faq/why-is-my-formal-quote-expired/)
- **Premium size (unverified):** a Practical Machinist thread is quoted as saying Xometry "USA made" is about 2× and USA expedite about 3× (page returned 403). A third-party blog's $500/10 days, $900/5 days, $1,000+/2 days looks illustrative. [thread](https://www.practicalmachinist.com/forum/threads/using-xometry-to-compare-your-own-quotes.389827/)

**Gaps for the architecture:** (1) whole-order tier pricing at Xometry and slowest-part shipping at Fictiv mean a multi-part order needs one decision for the whole order; (2) finishing and inspection add time outside the quoted lead time, so ready-to-use must include them.

## 2. Reliability of expedited lead times

- Fictiv: 95.4% on time and in full, self-reported. [Fictiv](https://www.fictiv.com/cnc-machining-service)
- Xometry (re-checked 2026-11-10): **no published on-time rate, overall or for Expedite**, in Xometry's FAQs, help center or blog. Mixed Trustpilot reviews: one CNC order on time and a few days early, another "late and out of conformance." [Trustpilot](https://www.trustpilot.com/review/xometry.com?page=5)
- Xometry's own terms: Expedite is the fastest production and delivery option, with a fee; for some configurations it cannot beat Standard; Expedite assumes 1-day shipping vs 2-day for Standard and Economy; expedited CNC listed at 3–4 days. A separate Rush option ships qualifying CNC parts in as little as 1 business day. [Help center](https://support.xometry.com/hc/en-us/articles/360023734134-Learn-more-about-lead-time-and-delivery-options) · [FAQ](https://www.xometry.com/resources/blog/answers-to-most-frequently-asked-questions/)
- Anecdote only (unverified, site's affiliation with Xometry unclear): a buyer's blog says "about 95%" on time with 1 late order in ~40, and that Xometry pays for expedited shipping when it misses the promised date; the author says they have no hard data. Not confirmed against Xometry's terms. [xometryus.com blog](https://www.xometryus.com/blog/why-i-always-pay-for-rush-delivery-and-you-should-too-13.html)
- **Vendor opinion on slip causes:** design revisions restart the clock; quoted lead times often exclude first-article inspection and outside finishing. [bearingsdirect](https://bearingsdirect.com/blog/lead-time-custom-parts-turnaround-speed-up-order/) · [precisionam](https://precisionam.com/articles/aerospace/aerospace-cnc-machining-lead-times/)
- No data found on receiving or incoming-inspection delays at startups.

## 3. Who orders and who approves

- **Evidence (job postings):** by Series A, dedicated buyers order from Xometry, SendCutSend and OshCut (Gritt); "submit and track purchase requests" (Apptronik); a procurement specialist owns POs from quote to delivery (Standard Bots). [Gritt](https://www.builtinsf.com/job/hardware-procurement-specialist/10106221) · [Apptronik](https://builtin.com/job/npi-buyer/9140500) · [Standard Bots](https://wellfound.com/jobs/4781704-procurement-specialist)
- **Vendor opinion:** engineers at early startups "inherit procurement" until supply chain staff are hired. [Cofactr](https://blog.cofactr.com/articles/modern-procurement-stack-for-electronic-hardware-startups)
- Xometry's buyers include "engineers, product designers, procurement and supply chain personnel," no split given. [10-K](https://capedge.com/filing/1657573/0000950170-25-026655/10K-2024FY)
- Xometry accepts a card or a PO; POs need approved credit terms. **Inference:** card buying is the default for small buyers. [terms](https://www.xometry.com/xometry-vendor-tooling-and-materials-purchase-terms/)
- An aerospace commenter said routing parts to vendors is "not an Engineer's function" (larger company; snippet only).
- **Not found:** startup approval thresholds, or whether expedites are treated differently. Generic SMB guides suggest manager approval under ~$1,500 and executive above; not startup-specific. [ProcureDesk](https://www.procuredesk.com/purchase-order-approval-process/)
- **Pattern (inference):** seed: engineer on a card, little formal approval; Series A: buyer receives requests, engineering lead approves above a threshold; later: tiered approvals.

## 4. BOMs and purchase requests

- **Evidence (anecdotal):** an r/hwstartups thread names Excel/Sheets with macros, dokuly, PDXpert, Aras, OpenBOM, Odoo, Aligni and Onshape; "people would still come in and break the spreadsheet"; full PLM felt like "overkill" at the prototype stage. [thread mirror](https://lr.in.psf.lt/r/hwstartups/comments/18z0ly5/how_are_folks_doing_bom_management_for_new)
- **Evidence (job posting):** Gritt (Series A, ~14–50 staff) uses an in-house database for BOM, inventory and POs, and lists "an accurate, up-to-date BOM" as a six-month goal.
- **Vendor case studies:** Pyka moved from Google Sheets to OpenBOM; Xtend Robotics uses Onshape + OpenBOM; Coco Robotics uses Onshape + Arena. [Pyka](https://www.casestudies.com/company/openbom/case-study/flypyka-is-replacing-google-spreadsheets-with-openbom-managing-one-source-of-truth-for-autonomous-electric-airplane-development) · [Xtend](https://openbom.com/user-stories/xtend-robotics-is-using-a-magic-duo-openbom-and-onshape-to-deliver-the-service-robots-of-the-future) · [Coco](https://onshape.com/en/blog/coco-robotics-delivery-bot-reliable-cloud-native-cad-arena-plm)
- **BOM drift:** parts substituted during debugging without updating the BOM (practitioner notebook, electronics). [notebook](https://applied-ee.github.io/ee-notebook/docs/design-development/iteration-and-revision-control/bom-drift)
- **Fixtures:** engineering BOMs usually leave out tools and fixtures (PLM guide; Formlabs lists fixtures as a hidden cost a BOM doesn't capture). [PLM guide](https://plmtechnologyguide.com/?p=2058) · [Formlabs](https://formlabs.com/global/blog/bill-of-materials-bom/)
- **Request flow:** RespiraWorks posts in a #purchasing-sourcing Slack channel and tags @purchasing; a buyer orders on the company card; no need-by or purpose field. Gritt engineers "flag what's needed and when." Ramp intake forms are configurable and commonly include a delivery date. [RespiraWorks](https://respiraworks.github.io/Ventilator/purchasing/purchasing-guidelines.html) · [Ramp intake](https://ramp.com/blog/what-is-intake-to-procure)
- **Not found:** requests recording which test a part is for; Brex, Airtable or Jira used for parts requests.

## 5. Receiving, payment and first use

- **Receiving:** PO line statuses (not received / partially received / received) in Katana, inFlow, Airtable templates, OpenBOM or spreadsheets. A materials startup moved from Google Sheets to barcode stock-in/stock-out. [Katana](https://support.katanamrp.com/en/articles/5945017-purchase-order-po-delivery-statuses) · [inFlow](https://www.inflowinventory.com/support/cloud/how-do-i-partially-receive-products-on-a-purchase-order-in-inflow-cloud) · [BoxHero](https://www.boxhero.io/blog/genforge-customer-interview)
- **Practitioner opinion:** a digital tool to track receipt of material is "critical"; payment can come 90 days after receipt (Base Power supply-chain lead). [OVR](https://newsletter.ovr.vc/p/hard-truths-from-the-hardware-trenches-justin-lopas-base-power)
- **Ramp:** item receipts are separate objects, required only under 3-way match (Procurement add-on, or Plus for imported POs). **Inference:** a card-paid startup without it has payments but no receipt record. [Ramp 3-way match](https://support.ramp.com/hc/en-us/articles/30227975187731-3-Way-Match-with-Ramp-Procurement)
- **First use:** MES tools such as Ion (First Resonance) scan parts through receiving, kitting and installation into an as-built record. Small shops often kit with physical bins, untracked. No evidence of Jira or Linear transitions used as a usage signal. [Ion](https://firstresonance.io/ion) · [Hackaday/Othermill](https://hackaday.com/2016/08/10/lessons-in-small-scale-manufacturing-from-the-othermill-shop-floor)
- **Unused expedites:** no first-hand data. Adjacent: a machine-shop owner says quoting an expedite price on every quote separates real emergencies from false ones; an excess-inventory broker says over-bought parts "sit on the shelf for years." [Paperless Parts](https://paperlessparts.com/can-we-get-the-parts-sooner-sure/) · [Altium interview](https://resources.altium.com/p/interview-with-josh-sharpe-co-founder-of-xscomponents-com)

## 6. Existing tools and frameworks

- **Cost of delay:** see [`cost-of-delay.md`](cost-of-delay.md).
- **Lead-time prediction (all enterprise or marketplace):** Xometry enterprise lead-time model (March 2026, trained on its supplier network); Cin7 ForesightAI; GAINS; Oracle Lead-Time Insights; Mandel AI (YC) chases suppliers for updates. [Xometry](https://www.digitalengineering247.com/article/xometry-enhances-ai-native-marketplace-with-enterprise-lead-time-intelligence) · [Cin7](https://help.foresightai.cin7.com/hc/en-us/articles/13547758250511-Lead-times) · [Mandel](https://www.ycombinator.com/launches/LXP-mandel-ai-never-chase-suppliers-for-updates-again)
- **Procurement tools:** Cofactr (electronics sourcing and lead-time checks), Silkline ("where is my part" tracking). [Silkline](https://silkline.ai/blog/procurement-management-software-was-never-built-for-parts-how-silkline-differs-from-coupa-and-ariba)
- **None found** that recommends expedite vs standard per part based on what the part feeds or whether it was used.

## Questions for user interviews

1. Of your last 20 machined orders, how many were fixtures, prototypes or rush revisions, and which were expedited?
2. Who approves an expedite today, and at what dollar amount?
3. When you expedite, how do you decide? Has an expedited part ever sat unused?
4. Do purchase requests say what the part is for, or only when it's needed?
5. How do you know a part arrived, and when it was first used?
