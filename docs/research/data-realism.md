# Research: making the synthetic data realistic

Date: 2026-11-10. Compiled from four research passes: Slack messages, tickets, meeting notes and calendars, and orders, spend and proving realism to judges.

**Evidence quality: thin.** No public archive of hardware-startup purchasing chat, tickets or meeting minutes was found, and Xometry prices are gated behind CAD upload. What *is* sourced: the data formats (Slack, Jira, Fireflies, Google Calendar and Ramp APIs) and a handful of real RespiraWorks tickets. Most numbers and style rules are the research agents' judgement, marked **(J)**. To firm them up: get 3–5 real Xometry instant quotes for simple parts, and have a hardware engineer skim samples.

Related: [`../architecture.md`](../architecture.md) §12 (world script and data layout), [`startup-purchasing.md`](startup-purchasing.md).

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
| Volume | 60–150 new tickets/month for 15–30 people; median ~6 days to close, long tail |
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

**Cadence (J):** 2–4 orders/week baseline with clumping; 2–3× in the 3 weeks before EVT/DVT; quiet weeks of 0–1; tier mix Expedite 15–25% (in bursts), Standard 55–65%, Economy 15–25%; ~25–30% are revisions (Rev B/C); 2–4% cancelled; 3–5% short-shipped or re-quoted after DFM; 1–3% remade; 4–8 orderers, 1–2 heavy. Median order ~$250–400, tail to $2–4k; ~$45–90k over 9 months.

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
