# Research: making the synthetic data realistic

Date: 2026-11-10. Compiled from four research passes: Slack messages, tickets, meeting notes and calendars, and orders, spend and proving realism to judges.

**Evidence quality: thin.** No public archive of hardware-startup purchasing chat, tickets or meeting minutes was found, and Xometry prices are gated behind CAD upload. What *is* sourced: the data formats (Slack, Jira, Fireflies, Google Calendar and Ramp APIs) and a handful of real RespiraWorks tickets. Most numbers and style rules are the research agents' judgement, marked **(J)**. To firm them up: get 3–5 real Xometry instant quotes for simple parts, and have a hardware engineer skim samples.

Related: [`../architecture.md`](../architecture.md) §12 (world script and data layout), [`startup-purchasing.md`](startup-purchasing.md).

## Flintlock numbers (60 people, California, Xometry US)

Researched 2026-11-10 for Flintlock (~60 people, California, Xometry US). Mostly judgement (J); evidence (E) linked.

**Org (sums to 60, J):** Leadership 3 (CEO, CTO, VP Hardware) · Mechanical 15 (actuators 5, legs 4, arms and hands 3, torso/structures/battery 3) · Electrical 6 · Firmware 5 · Controls/locomotion 5 · ML/autonomy 5 · Software infra/sim 3 · Test and reliability 4 (dyno, life test, fixtures owner) · Technicians/build 4 · Manufacturing/NPI 2 · Supply chain 3 (Head of Supply Chain, Senior NPI Buyer, Buyer/Planner) · Program (TPM) 2 · Ops/finance/people 3. Manager span 4–7. E: humanoid postings show a "Hands Team" ([1X](https://1x.tech/open-positions/staff-mechanical-engineer-hands-team-2)), an actuation group ([Apptronik](https://job-boards.greenhouse.io/apptronik/jobs/5739881004)), "Senior NPI Buyer" ([Apptronik](https://builtin.com/job/npi-buyer/9140500)) and a mechanical supply manager covering CNC ([Figure](https://job-boards.greenhouse.io/figureai/jobs/4323471006)).

**Xometry CNC orders (J; scale with mech + test headcount):**
| Metric | Flintlock |
|---|---|
| Orders/week baseline | 8–14 |
| Burst (3 weeks before EVT/DVT) | 20–30/week |
| Quiet/holiday weeks | 3–5 |
| Total over ~39 weeks | 400–550 |
| Lines per order | 1–6, median 2 |
| Orderers | 16–22; two buyers place ~40%; 3–4 heavy engineers |
| Tier mix Exp/Std/Econ | 20–30/50–60/15–20%; expedite 40–50% in burst weeks |
| Revisions | 30–40% |
| Median order; tail | $600–900; $8–15k |
| 9-month spend | $400–700k |

A realistic company would not send every CNC job to Xometry: it keeps one or two local Bay Area shops for hot jobs (a small share, counted under "other custom fab" below).

**All other purchasing over the same 39 weeks (J unless marked E):**
| Category (typical vendors) | Orders/wk | Orders in 9 mo | Median; tail | Spend | Payment | Who orders |
|---|---|---|---|---|---|---|
| Fasteners and hardware (McMaster, some Misumi) | 6–10 | 250–400 | $90–180; $2k | $45–80k | Card or McMaster net-30 invoice | Engineers, techs |
| Amazon Business (consumables, cables, impulse buys) | 10–18 charges | 400–700 | $35–60; $1.5k | $25–45k | Card | Everyone |
| Electronics (Digi-Key, Mouser; rare Arrow, LCSC) | 4–7 | 160–270 | $120–250; $5k | $50–110k | Card | EE, firmware |
| PCB and PCBA (JLCPCB, PCBWay, OSH Park; MacroFab or a local CM for larger builds) | 1–2 | 40–80 | $150–600; $8k | $60–120k | Card or PayPal; CM on PO | EE |
| Other custom fab (SendCutSend, OSH Cut, Protolabs, Fictiv, local shop, Formlabs resin) | 3–5 | 110–190 | $200–500; $10k | $60–150k | Card; local shop net-30 | Mech, test |
| Motors, gearing, bearings (maxon, CubeMars, T-Motor, harmonic drives, bearing distributors) | 1–2 | 40–80 | $1.5–4k; $60k | $250–500k | PO, wire, net-30; samples on card | Buyers |
| Sensors and encoders (IMU, force-torque, cameras) | 0.5–1 | 20–40 | $800–2.5k; $25k | $60–150k | Mixed | Buyers, controls |
| Batteries, cells, power | 0.3–0.6 | 10–25 | $500–2k; $15k | $20–60k | Mixed | Buyers, EE |
| Tools and test equipment (Grainger, MSC, Home Depot, Harbor Freight, Uline, scope and PSU resellers) | 2–4 | 80–150 | $60–300; $20k | $80–200k | Card; capex on PO | Techs, test |
| Raw stock (OnlineMetals, local metal supplier) | 0.5–1 | 20–40 | $150–400 | $8–20k | Card | Techs, test |
| Shipping and couriers (FedEx, UPS) | 3–6 charges | 100–200 | $25–90; $600 | $10–25k | Card or carrier account | Ops, buyers |
| Software and SaaS (CAD, Altium, MATLAB, Slack, Jira, GitHub, cloud) | n/a | 250–400 recurring charges across 25–40 subscriptions | $50–2k/mo; annual $20–80k | $250–450k | Card monthly; annual on invoice | Ops, team leads |

**Totals (J):**
| | Count | Spend |
|---|---|---|
| Xometry CNC | 400–550 | $400–700k |
| Other hardware purchasing | 1,250–2,200 | $670k–1.46M |
| SaaS | 250–400 charges | $250–450k |
| **All** | **~1,900–3,100** | **~$1.3–2.6M** |

Xometry is about 18–25% of order count and 25–35% of spend: the largest single vendor by count after Amazon and McMaster, and roughly tied with actuator components on spend.

**Payment split (J):** net-30 and PO spend would sit in Ramp Bill Pay as bills, not card transactions: roughly 55–65% of dollars but only 10–15% of order count. How Ramp's API represents bills is unverified.

**Shipping speed and rush behaviour:**
- McMaster (E): "most orders arrive same or next day" ([delivery page](https://www.mcmaster.com/info/delivery)). A "rush" McMaster order is one placed before the cutoff, not a paid expedite. Shipping cost was often unknown until after ordering (anecdotal, dated: [blog](https://www.thefrankes.com/wp/?p=2602)), so the charge can differ from the confirmation.
- Digi-Key and Mouser (J): paid overnight on 15–25% of orders, more in burst weeks.
- Amazon (J): Prime one- or two-day by default.
- Motors and sensors (J): 2–12 week lead times; this is where backorders and partial shipments live.

**How other vendors appear in Ramp:**
| Vendor | Descriptor | Source |
|---|---|---|
| Digi-Key | `DKC*DIGI KEY CORP`, `DKC DIGI-KEY CORP`, `DKC*DIGI-KEY CORP` | E, [Ramp charge finder](https://ramp.com/charge-finder/digi-key) |
| Mouser | `MOUSER ELECTRONICS INC`, `PAYPAL *MOUSERELECT` | E, via search summary of [Brex](https://www.brex.com/tools/charge-finder/mouser-electronics) |
| Amazon | `AMZN Mktp US*A1B2C3D4E`, `Amazon.com`, `AMZN.COM/BILL`, `AMAZON MKTPLACE PMTS` | E, [Amazon help](https://digprjsurvey.amazon.com/csad/help/node/GSNBBJP63SM65UDB) |
| SendCutSend | `SENDCUTSEND.COM` | E, via search summary of [Brex](https://www.brex.com/tools/charge-finder/sendcutsendcom) |
| McMaster | `MCMASTER-CARR`, `BILL*McMaster-Carr` | E, search summary only |
| Others | `ULINE *SHIP SUPPLIES`, `GRAINGER`, `THE HOME DEPOT #0627`, `HARBOR FREIGHT TOOLS 412`, `PAYPAL *JLCPCB`, `PCBWAY`, `PROTOLABS`, `MISUMI USA`, `ONLINEMETALS.COM`, `FORMLABS`, `FEDEX 7812…`, `UPS*…`, `ALTIUM`, `MATHWORKS`, `PTC*ONSHAPE` | J, written in the usual style |

Amazon charges per shipment (E), so one order becomes two or three charges that sum to the order total. Amazon and Home Depot have the worst memo and receipt rates (30–40% missing, J). SaaS charges recur on the same day each month. Refunds run about 2–4% of Amazon charges and 1% elsewhere (J). JLCPCB and PCBWay may show as foreign or PayPal charges.

**Messiness to generate across vendors (J):** duplicate McMaster or Digi-Key orders by two engineers the same day (1–2%); McMaster orders at 16:30–17:30 PT the day before a test, then a "forgot the washers" order the next morning; Amazon impulse buys under $40 and an occasional personal-looking item flagged by policy; Digi-Key backorders that ship as a second charge weeks later; partial cancellations on motor POs; JLCPCB orders held for an engineering query; customs delays on CubeMars and T-Motor; a team lead's card carrying a SaaS tool nobody else knows about.

**Communication (J):** Slack 1,800–3,000 messages/day including DMs (30–50/person); public channels 700–1,100/day; 70–110 channels, 35–45 active weekly; #mech 60–120/day, #supply-chain/#procurement 25–50, per-subsystem channels 15–40, #build-evt 40–150 in build weeks; top 20% of people write ~60%, 15–20% lurk. Generating only the 8–12 purchasing-relevant channels: ~150–300/day, ~30–55k over 9 months. Jira: 250–400 new tickets/month across 6–8 projects.

**Meetings per week (J):** team standups 25–35 (mostly unrecorded); supply-chain sync 1; supply chain + mech 1–2 (daily in build weeks); program review 1; design reviews 2–4; vendor calls 2–4; leadership 1; all-hands every two weeks. ≈12–18 recorded meetings/week (450–700 over the window) plus 2–3 gate reviews.

**Xometry US:**
| Topic | Finding |
|---|---|
| Expedite CNC | 3–4 business days (E, [FAQ](https://www.xometry.com/resources/blog/answers-to-most-frequently-asked-questions/)) |
| Standard CNC | ~3–7 business days per a search summary of the help article (unconfirmed); use 5–9 for housings (J) |
| Economy (domestic) | Not published; use 10–15 business days, 10–20% cheaper (J) |
| International Economy | Cheapest and longest, not for ITAR, duties may apply (E, [blog](https://www.xometry.com/resources/blog/lead-time-options/)); 15–25 business days (J) |
| Tier scope | Order-level: Expedite applies to every part (E, via search summary) |
| Shipping | Free ground on Standard/Economy CNC, usually FedEx; transit to California 1–5 business days (J) |
| Sales tax | Added separately to prices (E, [help](https://community.xometry.com/kb/articles/644)); California taxes machining as fabrication labour (E, [CDTFA Pub 108](https://cdtfa.ca.gov/formspubs/pub108/taxable-labor.htm)). Show ~9.1–10.25% tax on parts, shipping untaxed (rates unverified) |
| Quote/order IDs | Format not found publicly (unverified) |

**California/Pacific:** America/Los_Angeles; PST (-0800) until 8 Mar 2026, PDT (-0700) until 1 Nov, then PST. Core hours 09:00–18:30 PT; supplier and Xometry emails often 05:00–15:00 PT. Holidays in the window: Presidents' Day 16 Feb (often worked), Memorial Day 25 May, Juneteenth 19 Jun (mixed), Independence Day observed Fri 3 Jul (quiet week), Labor Day 7 Sep; orders clump on the Thu/Fri before. Xometry, Inc. is in North Bethesda MD ([10-K](https://capedge.com/filing/1657573/0000950170-25-026655/10K-2024FY)); use descriptor variants like `XOMETRY INC`, `XOMETRY.COM` with `NORTH BETHESDA MD` or `DERWOOD MD` (J). Ramp: `currency_code: "USD"`, tax included in the charge.

**Still unverified:** Standard/Economy day counts, ID formats, card descriptor and MCC, whether Xometry collects CA tax on every order, Bay Area tax rates, all volume, spend and payment-split numbers for every vendor, the descriptors marked J, whether McMaster charges cards per shipment, the org split. One real Xometry quote PDF and one card statement line would settle the Xometry items.

## Principles across all sources (J)

- **Inconsistency is realism.** Sources disagree (Slack says 7075, the meeting decides 6061; a ticket's due date is stale). Dates move, and corrections arrive late.
- **Most fields are empty and most messages are short.** Uniform completeness and length look generated.
- **Odd numbers.** $412.37, "~3 wks", 8 business days, not $400 and 10 days.
- **People differ.** A lurker and a chatty person per channel; one or two heavy orderers; a manager who asks short questions.
- **Time has shape.** Weekdays, working hours, bursts before builds and vendor cutoffs, quiet weeks, rare weekend messages.
- **No explaining.** Engineers use shorthand and jargon without defining it.

## Slack

**Format (sourced: [conversations.history](https://docs.slack.dev/reference/methods/conversations.history), [message events](https://docs.slack.dev/reference/events/message)):**
- Every message: `type:"message"`, `user` (`U…`), `text`, `ts` as `"epoch.6digits"` (unique per channel).
- Edited: `edited:{user,ts}`. Reactions: `reactions[{name,count,users}]`. Join: `subtype:"channel_join"`. Subtypes: `thread_broadcast`, `bot_message`, `file_share`, `message_changed`.
- Link unfurls and bot posts: `attachments[]` (`service_name`, `text`, `fallback`, …).
- (J, spot-check) Thread parent: `thread_ts` = own `ts`, `reply_count`, `reply_users`, `latest_reply`. Replies: `thread_ts` = parent `ts`, `parent_user_id`. Bots: `bot_id`, `username`. Files: `files[{id,name,mimetype,…}]`. Human messages have `client_msg_id`.
- Mentions `<@U123>`, channels `<#C123|mech>`, links `<https://…|label>`; escape `&amp; &lt; &gt;`. Exports are per channel, per day, chronological.

**Style (J):**
| Feature | Target |
|---|---|
| Length | 60–70% are 3–15 words; ~20% 15–40; 5–10% long status or spec dumps; many one-word acks ("ok", "ty") |
| Threads | 25–35% of top-level posts get one; mostly 2–6 replies, a few 15+; ~1 in 10 replies broadcast |
| Cadence | Weekdays 09:00–18:30; small after-20:00 bump before builds; rare weekends; Thu/Fri bursts before Monday cutoffs |
| Writing | Mostly lowercase, little end punctuation, typos left or fixed with "*quote" |
| Dates | "EOD", "EOW", "Thurs", "next Tues", "~3 wks"; corrections ("actually Thurs not Weds") |
| Off-topic | 15–25% overall; ~85% on topic in project channels |
| Reactions | 👀 ✅ 👍 🙏 😬; ~80% of messages have none |
| Bots | GitHub, Jira and calendar bots in their own channels; never reply in threads |
| Links | Xometry quotes, McMaster, Onshape, screenshots ("Screenshot 2026-11-03 at 2.14.07 PM.png") |
| Channels | #mech, #procurement, #hw-purchasing, #build-evt, #dvt-actuator, #supply-chain, #general, #random, #eng-bots, plus DMs for awkward topics |
| Jargon | EVT/DVT/PVT, FAI, GD&T, tol, anodize type II/III, lead time, expedite, PO, RFQ, MOQ, bead blast, DFM, net-30, BOM, rev B |

**Example messages (J):** "xometry quote for the hip housing rev C came back, $412/ea x10, 12 day lead. anodize adds 3 more" · "can we expedite? EVT build is thurs the 20th" · "actually 19th not 20th, ben moved the review" · "tol on the bore is +0.02/-0 per the drawing, they flagged it in DFM, thoughts?" · "ugh black anodize is backordered til nxt wk. clear ok for DVT?" · "FAI report for batch 2 is in the drive, 2 of 10 oos on the flange thickness" · "any update on the shaft?" … hours later "bumping this, line's idle thurs".

## Tickets (Jira)

**Real examples (RespiraWorks GitHub, evidence):** terse noun-phrase titles ("Cooling fan and fan guard selection", "Finalize cooling fan assembly for v0.4"); one- or two-line bodies, some trailing off; revision tags in titles; many tickets are decisions ("Selection of X"). [#966](https://github.com/RespiraWorks/Ventilator/issues/966) · [#1034](https://github.com/RespiraWorks/Ventilator/issues/1034) · [#1255](https://github.com/RespiraWorks/Ventilator/issues/1255) · [#1026](https://github.com/RespiraWorks/Ventilator/issues/1026)

**Structure (J):**
| Feature | Target |
|---|---|
| Types | Task ~55%, Bug ~15%, one Epic per milestone; procurement, ECO and test as labels, not types |
| Statuses | To Do → In Progress → Blocked → In Review → Done; ~10% of open tickets blocked (often a label) |
| Fields | Description empty ~35%, 1–2 lines ~40%, long ~10%; due date ~30%; labels ~40%; components <15%; no story points; assignee ~85% of non-backlog |
| Slips | ~30% of due dates edited (usually +1–2 weeks); some past due and open; ~15% of open tickets stale 30+ days |
| Links | blocks / is blocked by ~15%; relates to ~10%; quote tickets linked to build or test tickets |
| Comments | 0 on ~45%, 1–3 on ~40%, 4+ on ~15%; fragments ("waiting on Xometry quote", "pushed to Fri, vendor slipped") |
| Volume | See Flintlock numbers above; median ~6 days to close, long tail |
| Titles | Mixed case and verb/noun order, abbreviations, part numbers, typos ("recieve"), "??", "- urgent" |

**Format (J, check against [Jira REST v3](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/)):** `id`, `key` (`HIP-212`), `fields{summary, issuetype, project, status{name,statusCategory}, priority, assignee|null, reporter, created/updated ("2026-10-12T14:03:22.123-0700"), duedate ("2026-11-14"|null), labels, components, parent, issuelinks[], description, comment{comments[],total}}`, `changelog.histories[]{author, created, items[{field, fromString, toString}]}` (status and duedate edits). v3 descriptions are ADF; v2 is plain text. Pick one.

**Example tickets (J):** HIP-212 "Order rev C hip bracket x6 (Xometry, 6061)" (procurement, due edited Nov 8→14, blocks HIP-230; "quote Q-48213 approved, lead time 8 BD, check anodize callout") · HIP-218 "Spin test fixture - shaft runout out of spec" (Bug, blocked; "0.09mm TIR on rev A, spec is 0.05. remaking bore") · HIP-221 "motor samples for DVT??" (empty, unassigned) · HIP-244 "get quote 316 SS gearbox housing" (stale 41 days; "any update?") · HIP-255 "Dyno rig PSU recieve + inspect" (past due; "arrived damaged box, photos in slack").

## Meeting notes and transcripts

**Format (sourced, verify field names: [Fireflies transcript API](https://docs.fireflies.ai/graphql-api/query/transcript)):** `sentences{index, speaker_name, speaker_id, text, raw_text, start_time, end_time}`; `summary{overview, shorthand_bullet, action_items (one text blob), outline, keywords, topics_discussed, transcript_chapters, meeting_type, …}`.

**Recommendations (J):**
- Mimic Fireflies for recorded meetings: metadata, overview, chapters with timestamps, action items as a loose block (some unowned), and a transcript as `[mm:ss] Speaker: text`. Optionally a `.vtt` export.
- Vary the note-taker by meeting: Fireflies for the program review, terse Granola-style bullets for the supply-chain sync, a Zoom AI summary for vendor calls.
- Cadence: daily standup (often unrecorded), weekly program review, weekly supply-chain sync, ad hoc design and build-readiness reviews, vendor calls, monthly all-hands, EVT/DVT gate reviews.
- Messiness: "uh", false starts, crosstalk, "can you hear me", speech-to-text errors on jargon ("anodized" → "and dyes"), vague actions ("can you look at it?"), off-topic, decisions that contradict Slack, durations like 31 or 47 minutes, late joiners.

## Calendar

**Format (sourced: [Google Calendar events](https://developers.google.com/workspace/calendar/api/v3/reference/events)):** `attendees[]{email, displayName, optional, resource, responseStatus}`; `recurrence` (RRULE strings); instances carry `recurringEventId` and `originalStartTime`; `conferenceData`. `.ics`: `DTSTART;TZID=`, `RRULE`, `ATTENDEE;PARTSTAT=`, `CATEGORIES`, `LOCATION`, `DESCRIPTION`.

**Content (J):** milestones as all-day events (some tentative, some moved twice); bench and chamber bookings (spin chamber, thermal chamber, CMM) with one double-booking; a weekly recurring sync with one moved or cancelled instance; out-of-office covering a key owner during a milestone; vendor calls with external attendees and meeting links; mixed accept/tentative/decline; descriptions with agenda notes ("Need housings back by 11/16").

## Xometry orders

**Sourced:** Economy, Standard and Expedite tiers; the quote reprices with quantity, tolerance and finish; expedite CNC is 3–4 business days ([FAQ](https://www.xometry.com/resources/blog/answers-to-most-frequently-asked-questions/)); 6061 is the most common machining metal ([guide](https://www.xometry.com/resources/machining/ways-save-money-cnc-prototypes/)).

**Parts catalog (J, prices per lot at Standard; unverified):**
| Part | Material | Qty | Finish / tol | Standard $ | Lead Econ / Std / Exp | Expedite vs Std |
|---|---|---|---|---|---|---|
| Sensor bracket | 6061-T6 | 5–25 | bead blast, ±0.005" | 60–250 | 12–15 / 7–10 / 3–4 d | +40–80% |
| Motor mount plate | 6061-T6 | 4–10 | black anodize, ±0.002" | 180–600 | 14 / 8–10 / 4 d | +50–90% |
| Housing | 6061 or 7075 | 2–10 | anodize II/III | 350–1,400 | 15 / 10 / 5 d | +50–100% |
| Drive shaft | 303 SS or 4140 | 5–30 | ground fit, ±0.0005" | 150–700 | 15 / 10 / 5 d | +50–90% |
| Adapter plate | 6061 / 7075 | 1–10 | clear anodize | 90–450 | 12 / 7–9 / 3–4 d | +40–80% |
| Test fixture / jig | 6061 / Delrin | 1–3 | none | 120–900 | 10–14 / 7 / 3 d | +40–100% |
| Spacer, bushing | Delrin / 303 SS | 20–200 | none | 80–400 | 12 / 7 / 3 d | +30–70% |
| Arm link | 7075-T651 | 2–10 | hard anodize | 250–1,100 | 15 / 10 / 5 d | +50–100% |

Economy ~10–20% below Standard; the expedite premium is proportionally higher on small lots; unit price drops ~30–60% from qty 1 to 10–25.

**Cadence:** see Flintlock numbers above.

**Fields (J, from the UI):** quote ID (`Q-1234567-1` style), order number, file name and revision, material ("Aluminum 6061-T6"), process (CNC milling 3- or 5-axis, turning), finish, quantity, tolerance class, certifications (CoC, material cert, FAI), unit price, subtotal, shipping, tax, total, tier, ship and delivery estimates, carrier and tracking. Status: Quote → Order placed → DFM review (sometimes "action required") → In production → Quality inspection → Shipped → Delivered; branches Cancelled, Refunded.

## Ramp transactions

**Format (sourced: Ramp OpenAPI `Transaction` schema, [spec](https://docs.ramp.com/openapi/developer-api.json)):** `id`, `amount`, `currency_code`, `state` (PENDING, CLEARED, DECLINED, …), `card_id`, `card_holder{first_name, last_name, user_id, department_name}`, `merchant_name`, `merchant_descriptor`, `merchant_id`, `merchant_category_code`, `sk_category_id`/`sk_category_name`, `user_transaction_time`, `settlement_date`, `accounting_date`, `memo`, `receipts[]`, `line_items[]`, `accounting_field_selections[]`, `policy_violations[]`, `sync_status`, `original_transaction_id` (refunds).

**Messiness (J):** descriptor variants (`XOMETRY`, `XOMETRY INC`, `XOMETRY*ORDER`, `XOMETRY.COM MD`); inconsistent categories; settlement 1–3 days after the transaction; shipping or tax splits or two charges for one order; refunds as negative amounts linked to the original; 15–30% missing memos, 10–20% missing receipts; a few declines then retries; the same engineer on several cards; an occasional charge on the founder's card.

## Showing judges the data is realistic

Ranked by persuasiveness in a short demo (methods are established; the ranking is judgement):

1. **Provenance trail.** Click a Ramp charge → the Slack thread → the ticket → the Xometry quote → the world-script event that produced them. Says plainly "this is generated, and here is exactly how."
2. **Real formats, side by side.** Show the official Ramp, Slack or Jira API schema next to a generated record: same fields, same enums. The strongest hard evidence.
3. **Distribution charts against stated ranges.** Order size, tier mix, weekly orders with pre-build bursts, price vs quantity, message length and time of day, labelled "target ranges from research" (there is no real dataset to compare against; say so).
4. **A datasheet for the dataset** (Gebru et al.): one slide covering motivation, composition, how it was generated, known limits, seed and script. [paper](https://lamarr01.cs.tu-dortmund.de/LEHRE/SEMINARE/WS2021/TrustworthyAIMachineLearning/literature/gebru2020.pdf)
5. **Public real snippet vs generated,** e.g. a real RespiraWorks ticket next to a generated one, or a real Xometry quote screenshot. Public material only; don't claim equivalence.
6. **Expert review.** A hardware engineer at the event skims ten records; quote their reaction.
7. **"Spot the fake"** with a few real public examples mixed in. Fun but slow.
8. **Train on synthetic, test on real:** not possible without real data; state that limit honestly.

## Fake-looking patterns to avoid (all sources)

Complete, polite, punctuated sentences everywhere · every message on topic · uniform lengths · no threads or one-word replies · perfect ISO dates with no corrections · everyone agreeing · every user equally active · round numbers · bots that sound human, or no bots · evenly spaced timestamps, 3am activity, weekends as busy as weekdays · no bursts before deadlines · every ticket fully filled in with a description, assignee, due date and labels · no slipped dates, stale tickets or blocked chains · tickets moving cleanly To Do → Done with no changelog · polite paragraph comments · every action item owned and dated · perfect transcription · meetings exactly 30 or 60 minutes · milestones that never move or always agree with Slack · the same prices, quantities and lead times everywhere.
