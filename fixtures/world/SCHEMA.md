# World model schema (v1.0)

The ground truth for Flintlock Robotics. Code decides facts, ids and times; models write only text.
Machine-readable copy: `scripts/generate-world/schema.mjs` (`SPEC`, `ANSWERS_SPEC`, `ENUMS`). If this file and `schema.mjs` disagree, `schema.mjs` wins; fix this file.
Canonical ids: `seed/canon.json`. Tiny valid world: `example/`. Validator: `node scripts/generate-world/validate.mjs <world.json> [answers.json]`.

**The app never reads `fixtures/world/`.** It reads only rendered sources.

## 1. Conventions

| Rule | Detail |
|---|---|
| Types | `str` `num` `int` `bool` `obj` `any`; `date` = `YYYY-MM-DD`; `time` = ISO 8601 with Pacific offset, inside `meta.window`; `ftime` = same format, may be after the window (deliveries, first use, bookings); `ref:X` = id of an entity in collection X (`ref:any` = any id); `[T]` = array; `hist:T` = history list (below) |
| Req | `yes` = present and non-null. `opt` = may be absent or `null`. Arrays marked `yes` may be empty |
| Time offset | `-08:00` (PST) before 2026-03-08 02:00 and from 2026-11-01 02:00; `-07:00` (PDT) between. The validator rejects the wrong offset. Helpers: `toPacificIso`, `checkTime`, `pacificOffset` in `schema.mjs` |
| Money | USD numbers, 2 decimals, field names end `_usd` |
| References | Always by id, never by name |
| Text | `world.json` holds no rendered text. `brief` fields are one-line internal notes for writers, never rendered verbatim |
| Working days | Mon–Fri minus `meta.holidays` with observance `full`. Demo "day N" = N working days after 2026-11-10 |

### History convention

Every fact that changes is a list ordered by `known_at` (ascending; equal allowed). The last entry with `known_at <= t` is what was believed at `t`.

| Field | Type | Req | Meaning | Example |
|---|---|---|---|---|
| `value` | per field | yes (may be `null`, e.g. due date cleared) | What was stated | `"2026-11-13"` |
| `effective` | date or time | opt | When it is (or was) true in the world; null = from `known_at` on | `"2026-10-26"` |
| `known_at` | time | yes | When it became knowable (available-at) | `"2026-10-14T15:02:33-07:00"` |
| `by` | ref:people | opt | Who said or set it; null = vendor or system | `"p-dana"` |
| `where` | ref:events | opt | Event that revealed it; null = never written down | `"ev-000007"` |
| extra | any | opt | Field-specific extras, e.g. `reason` on part revisions | `"reason": "bore moved 0.5 mm"` |

Truth vs belief: histories record what was **stated**; for planned dates (`eta`, milestone `date`) the truth is a separate field (`true_arrival`, actual test times) or lives in `answers.json`. Wrong or stale statements live only in `events` (with `truth`), not in histories, unless someone also edited the record (e.g. a Jira due date set to a wrong date).

## 2. ID formats

| Entity | Format | Example |
|---|---|---|
| teams | `t-<slug>` (canon) | `t-mech-actuators` |
| people | `p-<firstname>`; `p-<firstname>-<lastinitial>` on clash | `p-owen`, `p-sam-k` |
| Slack user id | `U` + 10 `[A-Z0-9]` | `U07FLK0OWEN` |
| Slack channel id | `C` + 10 (public/private), `D` + 10 (DM), `G` + 10 (group DM) | `C07FLK0TLAB` |
| channels | `ch-<slug>` (canon); DMs `dm-<a>-<b>` (person slugs, sorted) | `ch-test-lab`, `dm-arjun-owen` |
| Jira account id | 24 lowercase hex | `5f8a1c2e3b4d5e6f7a8b9c01` |
| Jira projects | key, 2–4 capitals (canon) | `HIP` |
| tickets | Jira key `<PROJECT>-<n>` (n from 1, per project) | `HIP-212` |
| Ramp user, card, transaction ids | UUID v4 | `d6da5f41-2ac4-4142-84a3-9303affce510` |
| assemblies | `a-<slug>` (canon) | `a-hip-actuator` |
| parts | `pt-<slug>` | `pt-leg-lift-hook` |
| part number | `FL-<AREA>-<4 digits>`; AREA ∈ HIP KNE ANK LEG HND STR BAT TST | `FL-TST-2017` |
| CAD file | `<part_number>_<slug>_rev<R>.step` | `FL-TST-2017_lift-hook_revA.step` |
| test rigs / resources | `rig-<slug>` / `res-<slug>` (canon) | `rig-leg-drop-gantry` |
| bookings | `bk-<5 digits>` | `bk-00002` |
| tests | `test-<slug>` | `test-leg-drop` |
| deliverables | `dl-<slug>` | `dl-hip-motor-dvt` |
| work items | `wi-<5 digits>` | `wi-00001` |
| milestones | `m-<slug>` (canon) | `m-hip-spin-test` |
| edges | `e-<5 digits>` | `e-00001` |
| storylines | `sl-<slug>` | `sl-hip-backlash` |
| meeting series / meetings | `ms-<slug>` / `mtg-<5 digits>` | `ms-sc-mech`, `mtg-00001` |
| vendors | `v-<slug>` (canon) | `v-xometry` |
| orders | `ord-x-<5 digits>` (Xometry CNC), `ord-o-<5 digits>` (other) | `ord-x-00001` |
| Xometry quote id | `Q-<7 digits>-<rev>` **(format unverified; chosen)** | `Q-2604417-1` |
| Xometry order number | `XO-<7 digits>` **(format unverified; chosen)** | `XO-5520193` |
| events | `ev-<6 digits>` (no time order implied) | `ev-000010` |
| Slack `ts` | `<epoch seconds>.<6 digits>`, unique per channel | `1788282862.104211` |
| calendar uid | `cal-<entity id>` for meetings, bookings, milestones, OOO (`cal-ooo-<person>-<start>`) | `cal-mtg-00001` |
| Ramp department | `dept-<slug>` | `dept-mechanical` |
| live demo changes | `live-<case>` | `live-b` |

## 3. Enumerations

| Enum | Values |
|---|---|
| `hidden_reason` | `genuine_gain` (genuine schedule gain) · `test_slot_cliff` · `no_gain_other_input_later` · `pressure_manager_or_demo` · `ordered_late` · `insurance_or_spare` · `personal_habit` · `budget_squeeze` (chose slower) · `cheap_default` (cheap part, default tier) |
| `claim_kind` | `needs` `eta` `done` `blocked` `owner` `need_earlier` `substitute` `duration` `stock` |
| `event_kind` | `crumb` (tied to an order or a decision-relevant fact) · `background` |
| `background_topic` | `tradeoff` `test_result` `failure` `debate` `status` `logistics` `question` `ack` `social` `offtopic` |
| `source` | `slack` `jira` `meeting` `calendar` (Xometry and Ramp records are rendered from `orders`/`ramp_transactions`, not events) |
| `ticket_field` | `created` `description` `comment` `status` `due_date` |
| `tier` | `economy` `standard` `expedite` `international_economy` (past orders show 2–4; most show economy/standard/expedite) |
| `link_quality` | `clean_id` (quote/order no. or part number in context) · `alias_only` · `never_discussed` |
| `ref_mode` | `id` `part_number` `alias` `vague` |
| `truth_status` | `true` · `stale` (was true, repeated after it changed) · `wrong` (never true) |
| `pressure` | `low` `elevated` `high` |
| `time_band` (days before T) | `0-1` `1-3` `3-7` `7-14` `14-30` |
| `ticket_status` | `To Do` `In Progress` `Blocked` `In Review` `Done` |
| `ticket_type` | `Task` `Bug` `Epic` `Story` `Sub-task` (procurement/ECO/test are labels) |
| `ticket_priority` | `Highest` `High` `Medium` `Low` |
| `ticket_link` | `blocks` `is_blocked_by` `relates_to` |
| `meeting_type` | `supply_chain_sync` `supply_chain_mech` `program_review` `design_review` `standup` `build_readiness` `gate_review` `vendor_call` `leadership` `all_hands` `test_review` |
| `note_taker` | `fireflies` `granola` `zoom_ai` `manual_doc` `none` |
| `rsvp` | `accepted` `tentative` `declined` `needs_action` |
| `payment_method` | `card` `bill_net30` `po_wire` `paypal` `carrier_account` |
| `xometry_status` | `quote` `order_placed` `dfm_review` `dfm_action_required` `in_production` `quality_inspection` `shipped` `delivered` `cancelled` `refunded` |
| `other_status` | `placed` `backordered` `partially_shipped` `shipped` `delivered` `cancelled` `refunded` |
| `order_type` | `xometry_cnc` `other` |
| `vendor_category` | `cnc_xometry` `fasteners` `amazon_consumables` `electronics` `pcb` `other_custom_fab` `motors_gearing_bearings` `sensors` `batteries_power` `tools_test_equipment` `raw_stock` `shipping` `saas` |
| `part_kind` | `robot_part` `test_hardware` |
| `process` | `cnc_milling_3axis` `cnc_milling_5axis` `cnc_turning` `cnc_mill_turn` |
| `inspection_result` | `pass` `fail` `partial` `skipped` |
| `working_state` | `design` `build` `bring_up` `partly_working` `working` `blocked` |
| `work_status` | `not_started` `in_progress` `blocked` `done` |
| `test_result` | `not_run` `pass` `fail` `partial` `aborted` |
| `milestone_kind` | `build` `test` `gate` `demo` `review` |
| `hardness` | `hard` `soft` |
| `value_policy_type` | `per_day` `curve` `none` |
| `edge_kind` | `requires_all` `alternative` |
| `reveal` | `revealed` `hinted` `never` |
| `deliverable_kind` | `motor` `gearbox` `pcb` `pcba` `firmware` `sensor` `cells` `harness` `other` |
| `booking_status` | `confirmed` `tentative` `cancelled` |
| `resource_kind` | `chamber` `metrology` `bench` `bay` `machine` |
| `channel_type` | `public` `private` `dm` `mpim` |
| `order_weight` | `none` `light` `medium` `heavy` |
| `ordering_habit` | `none` `over_expedites` `always_standard` `last_minute` `batches_orders` `budget_conscious` |
| style enums | `style_case`: `lower` `mixed` `proper` · `style_punctuation`: `none` `light` `full` · `style_level` (typos, emoji): `none` `rare` `some` `lots` · `style_length`: `terse` `medium` `long` · `style_hedging`: `low` `medium` `high` |
| `holiday_observance` | `full` `partial` `worked` |
| `ramp_instrument` / `ramp_kind` / `ramp_state` | `card` `bill` / `charge` `split` `refund` `decline` / `PENDING` `CLEARED` `DECLINED` |

## 4. Files and top-level layout

```
fixtures/world/
  SCHEMA.md            this file
  knobs.json           tunable rates (§8)
  seed/canon.json      canonical ids and names (phase 0; never renamed)
  seed/org.json        people, team membership, channels, meeting series, vendors, finance   (seed agent 1)
  seed/program.json    assemblies, parts, rigs, resources, tests, milestones, deliverables, storylines, demo   (seed agent 2)
  world.json           simulator output (truth)
  answers.json         simulator output (answer key; grading only)
  jobs/                text jobs written by `plan` (§7)
  example/             tiny valid world, answers and example jobs
```

**world.json** (object): `meta`, `teams`, `people`, `assemblies`, `parts`, `test_rigs`, `resources`, `tests`, `deliverables`, `work_items`, `milestones`, `edges`, `storylines`, `channels`, `jira_projects`, `meeting_series`, `meetings`, `tickets`, `vendors`, `finance`, `orders`, `ramp_transactions`, `events`, `demo`. Every collection is an array of objects with unique `id` (ids are unique across the whole world); `meta`, `finance`, `demo` are objects.

**answers.json** (object): `schema_version`, `seed`, `orders` (one entry per Xometry order, no more), `assembly_weeks`.

## 5. Entities

### meta
| Field | Type | Req | Meaning | Example |
|---|---|---|---|---|
| schema_version | str | yes | Schema version | `"1.0"` |
| seed | int | yes | Simulator seed | `20261110` |
| company | str | yes | | `"Flintlock Robotics"` |
| time_zone | str | yes | IANA zone | `"America/Los_Angeles"` |
| window.start / window.end | time | yes | Truth window | `"2026-02-10T00:00:00-08:00"` / `"2026-11-10T23:59:59-08:00"` |
| demo_now | time | yes | Demo "now" | `"2026-11-10T10:30:00-08:00"` |
| periods.lead_in / train / test | {start,end} date | yes | Month 0–1 context only; months 1–7 training orders; months 7–9 held out | train `2026-03-10`–`2026-09-09` |
| context_first_pass | {start,end} date | yes | Weeks written in the first text pass (13) | `2026-08-11`–`2026-11-10` |
| holidays[] | {date, name, observance, in_window} | yes | US holidays (plus Thanksgiving, after the window, for demo day arithmetic) | `{"date":"2026-09-07","name":"Labor Day","observance":"full","in_window":true}` |
| business_hours | {days, start, end, supplier_email_start, supplier_email_end} | yes | Days 1=Mon; local `HH:MM` | `{"days":[1,2,3,4,5],"start":"09:00","end":"18:30",...}` |

### teams
| Field | Type | Req | Meaning | Example |
|---|---|---|---|---|
| id, name | str | yes | | `t-supply`, `"Supply Chain"` |
| department | str | yes | Ramp/HR department label | `"Operations"` |
| headcount | int | yes | Researched size; equals `members.length` | `3` |
| lead | ref:people | yes | Team lead | `p-dana` |
| members | [ref:people] | yes | Each member's `team` must be this team | `["p-dana",...]` |
| channels | [ref:channels] | yes | Team's home channels | `["ch-supply-chain"]` |
| jira_project | ref:jira_projects | opt | Main project | `"SCM"` |

### people
| Field | Type | Req | Meaning | Example |
|---|---|---|---|---|
| id, name | str | yes | Invented names only | `p-owen`, `"Owen Halloran"` |
| display_name | str | yes | Slack handle | `"owen"` |
| title | str | yes | | `"Mechanical Engineer, Actuators"` |
| team | ref:teams | yes | | `t-mech-actuators` |
| manager | ref:people | opt | null for CEO | `p-arjun` |
| email | str | yes | `<first>@flintlockrobotics.com` | `"owen@flintlockrobotics.com"` |
| slack_id | str | yes | `U…` | `"U07FLK0OWEN"` |
| jira_account_id | str | yes | 24 hex | |
| ramp_user_id | str | yes | UUID | |
| ramp_card_ids | [str] | yes | UUIDs; empty = no card | |
| start_date / end_date | date | yes / opt | Employment | `"2025-06-02"` |
| ooo[] | {start, end date, reason} | yes | Out-of-office periods | `{"start":"2026-08-24","end":"2026-08-28","reason":"vacation"}` |
| orders.weight | enum order_weight | yes | Whether and how heavily they place orders | `"heavy"` |
| orders.habit | enum ordering_habit | yes | Personal ordering habit | `"over_expedites"` |
| style.case, punctuation, typos, emoji, length, hedging | style enums | yes | Writing style | `"lower"`, `"none"`, `"some"`, `"rare"`, `"terse"`, `"low"` |
| style.quirks | [str] | opt | Free-form tics | `["fixes typos with *word"]` |
| chattiness | num | yes | Multiplier on channel base rate (0–3) | `1.4` |
| lurker | bool | yes | Rarely posts | `false` |
| authority_on | [str] | yes | Topics they are the authority on | `["DVT hip motor"]` |

### assemblies
| Field | Type | Req | Meaning | Example |
|---|---|---|---|---|
| id, name | str | yes | Canon ids | `a-hip-actuator` |
| owner | ref:people | yes | | `p-arjun` |
| team | ref:teams | yes | | `t-mech-actuators` |
| working_state | hist enum working_state | yes | No full humanoid: never all `working` | `[{value:"partly_working",...}]` |
| revision | hist str | yes | Revision letter history | `[{value:"C",...}]` |
| jira_project | ref:jira_projects | yes | | `"HIP"` |
| channel | ref:channels | yes | | `ch-actuators` |
| project_code | str | yes | Ramp/finance project code | `"PRJ-HIP"` |
| parent | ref:assemblies | opt | Containing assembly | `null` |
| description | str | opt | | |

### parts
| Field | Type | Req | Meaning | Example |
|---|---|---|---|---|
| id, name | str | yes | Canonical name | `pt-leg-lift-hook`, `"Leg drop-test lift hook"` |
| part_number | str | yes | | `"FL-TST-2017"` |
| cad_file | str | yes | Current CAD file name | `"FL-TST-2017_lift-hook_revA.step"` |
| aliases | [str] | yes | What people actually call it | `["lift hook","the hook","gantry hook"]` |
| belongs_to | ref:any (assembly or rig/resource) | yes | | `rig-leg-drop-gantry` |
| kind | enum part_kind | yes | Robot part or test hardware | `"test_hardware"` |
| material / finish / tolerance | str | yes | | `"Steel 4140, pre-hardened"` / `"Black oxide"` / `"+/-0.005 in"` |
| process | enum process | yes | | `"cnc_milling_3axis"` |
| typical_qty | int | yes | | `2` |
| vendor | ref:vendors | yes | Default vendor (`v-xometry` for Burn's parts) | `v-xometry` |
| revisions | hist str, extra `reason` | yes | Revisions with dates and reasons | `{value:"B", effective:"2026-10-19", reason:"bolt pattern"...}` |
| price_hint_usd | num | opt | Typical Standard price per lot | `350` |

### test_rigs, resources
| Field | Type | Req | Meaning | Example |
|---|---|---|---|---|
| id, name | str | yes | Canon ids | `rig-leg-drop-gantry` |
| kind | enum resource_kind | yes (resources only) | | `"chamber"` |
| location | str | yes | | `"High bay"` |
| owner | ref:people | yes | | `p-mateo` |
| needs | [ref:any] | yes | Parts/deliverables the rig itself needs | `["pt-leg-lift-hook"]` |
| bookings[].id | str | yes | | `bk-00002` |
| bookings[].start / end | ftime | yes | | `"2026-09-16T09:00:00-07:00"` |
| bookings[].test | ref:tests | opt | null = ad hoc use | `test-leg-drop` |
| bookings[].by | ref:people | yes | | `p-mateo` |
| bookings[].status | enum booking_status | yes | | `"confirmed"` |
| bookings[].conflict_with | [str] booking ids | opt | Double-bookings | `["bk-00003"]` |

### tests
| Field | Type | Req | Meaning | Example |
|---|---|---|---|---|
| id, name | str | yes | | `test-leg-drop` |
| assembly | ref:assemblies | yes | Assembly under test | `a-leg` |
| rig | ref:test_rigs | opt | | `rig-leg-drop-gantry` |
| resources | [ref:resources] | yes | Other bookable resources | `[]` |
| owner | ref:people | yes | | `p-mateo` |
| milestone | ref:milestones | opt | Milestone it gates | `m-leg-drop-complete` |
| duration_true_days | num | yes | True working days | `2` |
| duration_estimate_days | [min,max] num | yes | What people quote | `[1,2]` |
| planned_date | hist date | yes | Planned start | |
| actual_start / actual_end | ftime | opt | | |
| result | enum test_result | opt | | `"pass"` |
| *inputs* | derived | — | Edges with `to` = this test. Seed lists `inputs`; the simulator turns them into edges | |

### deliverables (non-CNC inputs)
| Field | Type | Req | Meaning | Example |
|---|---|---|---|---|
| id, name | str | yes | | `dl-hip-motor-dvt` |
| kind | enum deliverable_kind | yes | | `"motor"` |
| owner | ref:people | yes | | `p-arjun` |
| assembly | ref:assemblies | opt | | `a-hip-actuator` |
| vendor | ref:vendors | opt | If bought | `v-cubemars` |
| order | ref:orders | opt | Vendor order if bought | `ord-o-00412` |
| eta | hist date | yes | ETA as stated over time | |
| true_arrival | date | opt | Truth (may be after the window) | `"2026-11-20"` |

### work_items
| Field | Type | Req | Meaning | Example |
|---|---|---|---|---|
| id, name | str | yes | | `wi-00001` |
| owner | ref:people | yes | | |
| assembly | ref:assemblies | yes | | |
| duration_true_days | num | yes | | `3` |
| duration_estimate_days | [min,max] | opt | null = unknown | `[2,3]` |
| blocked_by | [ref:any] | yes | | `["dl-hip-motor-dvt"]` |
| status | hist enum work_status | yes | | |

### milestones
| Field | Type | Req | Meaning | Example |
|---|---|---|---|---|
| id, name | str | yes | Canon ids | `m-hip-spin-test` |
| owner | ref:people | yes | | `p-arjun` |
| kind | enum milestone_kind | yes | | `"test"` |
| hardness | enum hardness | yes | | `"soft"` |
| assemblies | [ref:assemblies] | yes | | |
| date | hist date | yes | Target date over time | |
| value_policy | hist obj | yes | `{type: per_day, usd_per_day}` · `{type: curve, curve:[{days_late, usd}]}` · `{type: none}`; `by` = who set it | `{value:{type:"per_day",usd_per_day:600}, by:"p-arjun",...}` |
| burst_weeks | int | opt | Builds: order burst length before the date | `3` |
| *feeds* | derived | — | Edges with `to` = this milestone | |

### edges (true dependency graph)
| Field | Type | Req | Meaning | Example |
|---|---|---|---|---|
| id | str | yes | | `e-00001` |
| from / to | ref:any | yes | part, deliverable, work item, rig, resource → test or work item; test → milestone | `pt-leg-lift-hook` → `test-leg-drop` |
| kind | enum edge_kind | yes | | `"requires_all"` |
| group | str | opt | Alternatives sharing a group satisfy each other | `"alt-hook"` |
| reveal | enum reveal | yes | Whether the sources reveal it | `"hinted"` |
| revealed_by | [ref:events] | yes | Events that reveal or hint it; empty if `never` | `["ev-000001"]` |
| note | str | opt | | |

### storylines
| Field | Type | Req | Meaning | Example |
|---|---|---|---|---|
| id, name | str | yes | | `sl-hip-backlash` |
| team | ref:teams | yes | | |
| topic | str | yes | Engineering background | `"Backlash in the rev B reducer"` |
| people | [ref:people] | yes | | |
| start / end | date | yes | | |
| beats[] | {week date (Monday), summary} | yes | What happens each week | |

### channels
| Field | Type | Req | Meaning | Example |
|---|---|---|---|---|
| id, name | str | yes | Name without `#` | `ch-test-lab`, `"test-lab"` |
| slack_id | str | yes | | `"C07FLK0TLAB"` |
| purpose | str | yes | | |
| type | enum channel_type | yes | | `"public"` |
| members | [ref:people] | yes | | |
| bots | [str] | yes | Bot display names | `["Jira Cloud"]` |
| base_rate_per_day | num | yes | Messages per working day | `20` |
| on_topic_share | num | yes | 0–1 | `0.85` |
| purchasing_relevant | bool | yes | One of the 8–12 generated channels | `true` |
| assembly | ref:assemblies | opt | | |

### jira_projects
| Field | Type | Req | Meaning | Example |
|---|---|---|---|---|
| id | str | yes | Project key | `"HIP"` |
| name | str | yes | | |
| lead | ref:people | yes | | |
| team | ref:teams | yes | | |
| assemblies | [ref:assemblies] | yes | | |

### meeting_series
| Field | Type | Req | Meaning | Example |
|---|---|---|---|---|
| id, name | str | yes | | `ms-sc-mech` |
| type | enum meeting_type | yes | | `"supply_chain_mech"` |
| rrule | str | yes | iCal RRULE (cadence) | `"FREQ=WEEKLY;BYDAY=TH"` |
| start_local | str | yes | `HH:MM` Pacific | `"10:30"` |
| duration_min | int | yes | Scheduled length | `30` |
| organizer | ref:people | yes | | |
| attendees / optional_attendees | [ref:people] | yes / opt | | |
| note_taker | enum note_taker | yes | Note-taker style | `"granola"` |
| recorded | bool | yes | | |
| conference | str | opt | Meeting link | |

### meetings
| Field | Type | Req | Meaning | Example |
|---|---|---|---|---|
| id, name | str | yes | | `mtg-00001` |
| series | ref:meeting_series | opt | null = ad hoc | |
| type | enum meeting_type | yes | | |
| start | time | yes | | `"2026-10-22T10:30:00-07:00"` |
| scheduled_min / actual_min | int | yes | Length | `30` / `37` |
| invited / present | [ref:people] | yes | Who was invited / showed up | |
| late_joiners | [ref:people] | opt | | |
| external | [str] | opt | External attendees (vendor calls) | `["rep@vendor.com"]` |
| note_taker, recorded | | yes | | |
| storylines | [ref:storylines] | yes | Storylines discussed | |
| rsvp | obj {person id: enum rsvp} | yes | Calendar responses | `{"p-owen":"tentative"}` |
| moved_from | time | opt | Original start if moved | |
| cancelled | bool | opt | | |
| *crumbs carried* | derived | — | Events with `where.meeting` = id | |
| *calendar event* | derived | — | uid `cal-<id>`, from this record and the series | |

### tickets
| Field | Type | Req | Meaning | Example |
|---|---|---|---|---|
| id | str | yes | Jira key | `"HIP-212"` |
| project | ref:jira_projects | yes | | `"HIP"` |
| type | enum ticket_type | yes | | `"Task"` |
| brief | str | yes | Internal one-liner for the writer | |
| assembly / work_item / order / test | refs | opt | Linked entity | `ord-x-00002` |
| reporter / assignee | ref:people | yes / opt | | |
| labels / components | [str] | yes / opt | | `["procurement"]` |
| priority | enum ticket_priority | yes | | |
| parent | ref:tickets | opt | Epic | |
| created | time | yes | | |
| status | hist enum ticket_status | yes | First entry at `created` | |
| due_date | hist date (value may be null) | yes | Due-date history | |
| links[] | {type enum ticket_link, key ref:tickets} | yes | | `{"type":"relates_to","key":"HIP-219"}` |
| *comments, description* | derived | — | Events with `where.ticket` = key and `ticket_field` `comment`/`description`; text from jobs | |

### vendors
| Field | Type | Req | Meaning | Example |
|---|---|---|---|---|
| id, name | str | yes | Canon ids | `v-mcmaster` |
| category | enum vendor_category | yes | | `"fasteners"` |
| descriptors | [str] | yes | Card descriptor variants | `["MCMASTER-CARR","BILL*McMaster-Carr"]` |
| payment_method | enum payment_method | yes | Default | `"card"` |
| terms | str | opt | | `"net-30"` |
| mcc | str | opt | Unverified; leave null unless known | |
| local | bool | yes | Bay Area shop | |
| shipping | {carrier, transit_days [min,max], splits_shipments, cutoff_local} | yes | Shipping behaviour | |

### finance
| Field | Type | Req | Meaning | Example |
|---|---|---|---|---|
| gl_accounts[] | {id, name} | yes | | `{"id":"5120","name":"Test equipment and fixtures"}` |
| project_codes[] | {code, name, assembly?} | yes | | `{"code":"PRJ-HIP",...}` |
| ramp_departments[] | {id, name, teams} | yes | | |
| approval | {rule, auto_approve_under_usd, second_approver_over_usd, second_approver} | yes | Approval rule | `{"rule":"requester's manager approves","auto_approve_under_usd":250,...}` |

### orders: Xometry CNC (`type: "xometry_cnc"`)
| Field | Type | Req | Meaning | Example |
|---|---|---|---|---|
| id | str | yes | | `ord-x-00001` |
| type / vendor | enum / ref | yes | `xometry_cnc` / `v-xometry` | |
| quote_id / order_number | str | yes | Formats unverified (§2) | `Q-2604417-1` / `XO-5520193` |
| lines[] | {part, revision, quantity, unit_price_usd} | yes, ≥1 | Part and revision, quantity (1–6 lines, median 2) | |
| tiers[] | {tier, subtotal_usd, lead_business_days, est_ship, est_delivery} | yes, 2–4 | **Every tier** with price and lead time | |
| chosen_tier | enum tier | yes | Must be one of `tiers` | `"expedite"` |
| quoted_at / quote_expires | time / date | yes | | |
| requester / placer / approver | ref:people | yes | | |
| approved_at | time | yes | | |
| placed_at | time | yes | T, the training anchor | |
| subtotal_usd, shipping_usd, tax_usd, total_usd | num | yes | total = sum (checked) | |
| promised_date | date | yes | | |
| status | hist enum xometry_status | yes | Status timeline (`by` null = Xometry) | |
| delivered_at | ftime | opt | Actual delivery | |
| carrier, tracking | str | opt | | |
| inspection | {result, at ftime, by} | opt | | |
| first_use | {at ftime, recorded bool, evidence ref:events} | opt | May be unrecorded | |
| feeds_test / feeds_milestone | refs | opt | What this order feeds | |
| need_by_believed | date | opt | Need-by as believed at T | |
| link_quality | enum link_quality | yes | | `"alias_only"` |
| cancelled | bool | yes | | |
| remade_from | ref:orders | opt | Remake of an earlier order | |
| ramp_transaction_ids | [ref:ramp_transactions] | yes | | |
| descriptor | str | yes | Card descriptor used | `"XOMETRY INC NORTH BETHESDA MD"` |
| memo_present / receipt_present | bool | yes | | |
| certifications | [str] | opt | | `["CoC"]` |

### orders: other vendors (`type: "other"`, light records)
| Field | Type | Req | Meaning | Example |
|---|---|---|---|---|
| id | str | yes | | `ord-o-00001` |
| vendor / category | ref / enum vendor_category | yes | | `v-mcmaster` / `"fasteners"` |
| description | str | yes | Short, code-generated | `"Shoulder bolts 1/2 x 1-1/2 in (4)"` |
| amount_usd | num | yes | Order total | `61.37` |
| placed_at | time | yes | | |
| by | ref:people | yes | Who ordered | |
| payment_method | enum | yes | Card or bill | |
| status | enum other_status | yes | Final status | |
| delivered_at | ftime | opt | | |
| ramp_transaction_ids | [ref] | yes | Splits and refunds are separate transactions | |
| deliverable / test | refs | opt | Linked deliverable or test | |
| recurring | bool | opt | SaaS subscription charge | |

### ramp_transactions
| Field | Type | Req | Meaning | Example |
|---|---|---|---|---|
| id | str | yes | UUID | |
| order | ref:orders | opt | | |
| instrument / kind / state | enums | yes | `card`/`bill` · `charge`/`split`/`refund`/`decline` · Ramp state | |
| amount_usd | num | yes | Negative for refunds | `507.64` |
| user_transaction_time | time | yes | | |
| settlement_date | date | opt | 1–3 days later | |
| card_id | str | opt | null for bills | |
| card_holder | ref:people | yes | | |
| merchant_name / merchant_descriptor | str | yes | | `"Xometry"` / `"XOMETRY.COM DERWOOD MD"` |
| mcc | str | opt | | |
| memo_present / receipt_present | bool | yes | | |
| original_transaction_id | ref:ramp_transactions | opt | For refunds | |
| department / gl_account / project_code | str | opt | Accounting coding | |

### events (the timeline everything is rendered from)
| Field | Type | Req | Meaning | Example |
|---|---|---|---|---|
| id | str | yes | | `ev-000003` |
| known_at | time | yes | When it became knowable | |
| source | enum source | yes | | `"slack"` |
| where.channel / thread_of | ref:channels / ref:events | slack: channel yes | Thread parent = an earlier event | `ch-test-lab` |
| where.ticket / ticket_field | ref:tickets / enum | jira: ticket yes | | `TEST-141`, `"comment"` |
| where.meeting | ref:meetings | meeting: yes | | |
| where.calendar | str | calendar: yes | Calendar uid | `cal-bk-00002` |
| by | ref:people | yes | Speaker/author | |
| kind | enum event_kind | yes | Crumb or background | |
| topic | enum background_topic | opt | For background | `"debate"` |
| claim | {kind, subject, value, effective, for_use} | crumbs: yes | Typed claim. `value` by kind: needs `{qty, by}` · eta date · done date · blocked ref · owner ref:people · need_earlier `{date, reason}` · substitute ref or str · duration `[min,max]` days · stock int | `{"kind":"eta","subject":"dl-hip-motor-dvt","value":"2026-11-13"}` |
| refs[] | {id ref:any, mode enum ref_mode} | yes | Entities referred to and how | `{"id":"pt-leg-lift-hook","mode":"alias"}` |
| truth | enum truth_status | yes | | `"wrong"` |
| corrects | ref:events | opt | Earlier event this corrects | |
| contradicts | [ref:events] | opt | Events from another source it conflicts with | |
| pressure | enum pressure | opt | Pressure conveyed | |
| storyline | ref:storylines | opt | | |
| orders | [ref:orders] | yes | Orders this informs | |
| brief | str | yes | What to express (internal) | |

### demo (the bracket order; follows architecture §7)
| Field | Type | Req | Meaning | Example |
|---|---|---|---|---|
| part, revision, quantity | ref, str, int | yes | | `pt-hip-bracket`, `"C"`, `4` |
| requester | ref:people | yes | | `p-owen` |
| placed_at | time | yes | Day 0 = 2026-11-10 | `"2026-11-10T11:30:00-08:00"` |
| quote | {quote_id, captured_at, valid_until, tiers[{tier, price_usd, ready_working_day, ready_date}]} | yes | Standard $3,000 day 10 (11/24); Expedite $3,900 day 5 (11/17) | |
| test, test_duration_working_days, inputs | | yes | `test-hip-spin`, 3, bracket + motor | |
| motor | {deliverable, owner, ready_working_day, ready_date, stated_by, stated_at, uncertain_range_days} | yes | Day 8 (11/20), Arjun 3 days ago; uncertainty 7–12 | |
| milestone, target_working_day | | yes | `m-hip-spin-test`, 10 (case C) | |
| policy | {type, usd_per_day, set_by} | yes | $600/day, Arjun | |
| context_window | {start, end} time | yes | Last 30 days | |
| cases | obj | yes | A–E as in architecture §7 with days and dates | see example |
| live_changes[] | {id, case, at, source, by, where, claim, brief} | yes | Scripted: `live-b` motor → day 12 (11/30); `live-d` motor 7–12 | |

Working days after 2026-11-10 (Thanksgiving 11/26–27 off): 5 = 11/17, 8 = 11/20, 10 = 11/24, 11 = 11/25, 12 = 11/30, 13 = 12/01, 15 = 12/03.

### answers.json
| Field | Type | Req | Meaning | Example |
|---|---|---|---|---|
| orders[].order | ref:orders | yes | Xometry order (exactly one entry each) | |
| hidden_reason | enum hidden_reason | yes | | `"no_gain_other_input_later"` |
| true_need_date | date | opt | | |
| true_links | [ref:edges] | yes | True links | |
| true_pressure | {time_band: pressure} | yes | True pressure per band before T | `{"0-1":"elevated",...}` |
| tier_outcomes[] | {tier, ready_date, gated_date?, days_gained} | yes | Outcome of **every** quoted tier; days_gained = working days the fed test/milestone finishes earlier than with the cheapest tier | |
| expedite_helped | bool | opt | null if not expedited | |
| crumbs | [ref:events] | yes | Crumbs that exist (where = from the event) | |
| never_revealed | [str] | yes | What was never written down | |
| assembly_weeks[] | {assembly, week_start (Monday), true_progress 0–1, true_pressure} | yes | True progress per assembly per week | |

## 6. Derived, never stored twice

| Derived | From |
|---|---|
| Tickets open and done per assembly per week | `tickets` status histories |
| Progress ranking | tickets + `answers.assembly_weeks` (truth) or rendered conversation (Burn) |
| Calendar (.ics / Google events) | milestones (`date`), bookings, meetings + series, people `ooo` |
| Test inputs, milestone feeds | `edges` |
| Meeting crumbs, ticket comments and descriptions | `events.where` |
| Slack, Jira, meeting, Xometry and Ramp files | world + filled jobs, by `assemble` |

## 7. Seed, simulation and text jobs

**Seed provides** (two files, written in parallel; ids from `canon.json`; same field names as §5; history fields are given as a single initial value, which the simulator wraps into a one-entry history):

| File | Keys | Owner |
|---|---|---|
| `seed/org.json` | `people` (all 60, incl. `p-owen`, `p-arjun` from canon), `teams` (lead, members, channels, jira_project), `channels` (members, bots, rates; plus DMs), `jira_projects` (lead, assemblies), `meeting_series`, `vendors`, `finance` | Seed agent 1 |
| `seed/program.json` | `assemblies` (owner, description), `parts` (catalog), `test_rigs`, `resources` (no bookings), `tests` (with `inputs: [ids]`), `milestones` (owner, initial date and value policy), `deliverables` (initial eta, true_arrival), `storylines`, `demo` | Seed agent 2 |

Cross-file references (e.g. program owners → people) use ids that agent 1 creates; agent 2 may only reference people listed in `canon.fixed_people` or by role placeholders `@role:<team-id>` (e.g. `@role:t-test`), which the simulator resolves to that team's lead.

**Simulation produces** everything else: schedule histories and slips, work items, tickets, bookings, meetings, orders of all vendors with decisions and hidden reasons, deliveries, first use, ramp transactions, edges (from test inputs plus discovered links), events with imperfections, and `answers.json`.

CLI: `node scripts/generate-world/simulate.mjs --seed <n>` reads `seed/*.json` and `knobs.json`, writes `fixtures/world/world.json` and `fixtures/world/answers.json`, then runs the validator.

### Text jobs (`fixtures/world/jobs/<source>/<job_id>.json`, written by `plan`)

Every job has: `job_id`, `source`, `status` (`blank` → `filled`), `style_rules` (pointers into `docs/research/data-realism.md`), `people` (id, name, display_name, slack_id, title, style), `forbidden` (what the writer must not say). The writer changes **only** the fields listed below and sets `status: "filled"`; everything else (ids, times, users, threads, counts, order) is fixed. Hidden reasons never appear. Every claim must be expressed with its exact value; every `must_mention` string must appear verbatim. Examples: `example/jobs/*.blank.json` and `*.filled.json`.

| Job | Unit | Extra fields (fixed) | Writer fills |
|---|---|---|---|
| Slack channel-week | one channel, Mon–Sun | `channel`, `week`, `context`, `messages[]{ts, user, thread_ts, events, brief, claim?, must_mention, length}` | `messages[].text` |
| Jira ticket batch | one project-week of new tickets | `project`, `week`, `tickets[]{key, type, status, reporter, assignee, labels, priority, created, due_date, events, brief, must_mention, description_length, comments[]{id, by, at, events, brief}}` | `tickets[].summary`, `tickets[].description` (may be `""`), `comments[].body` |
| Meeting | one meeting | `meeting{id, title, type, note_taker, start, actual_min, present, late_joiners}`, `storylines`, `crumbs[]{event, speaker, at_min [from,to], brief, claim}`, `background[]` | `transcript[]{start_s, speaker, text}` (start_s < actual_min×60, speakers ∈ present), `summary{overview, shorthand_bullet, action_items, keywords}` |

## 8. Knobs (`knobs.json`)

| Knob | Meaning | Default |
|---|---|---|
| `weeks_of_context` | Most recent weeks of text to plan and write | 13 |
| `hidden_reason_mix` | Share of Xometry orders per hidden reason (sums to 1) | genuine .10, cliff .03, no-gain .05, pressure .04, late .04, insurance .05, habit .06, budget .15, cheap default .48 |
| `expedite_true_gain_share` | Share of expedites that truly gained time | .45 |
| `ordering_habit_mix` | Share of ordering people per habit | none .45, over-expedites .15, always-standard .20, last-minute .10, batches .05, budget .05 |
| `edge_reveal_mix` | Share of graph edges revealed / hinted / never written | .50 / .30 / .20 |
| `link_quality_mix` | Xometry orders by link quality | clean id .45, alias only .35, never discussed .20 |
| `imperfection_rates.stale_fact` | Share of crumbs that repeat a superseded fact | .08 |
| `imperfection_rates.wrong_date_corrected` | Share of crumbs with a wrong date later corrected | .05 |
| `imperfection_rates.wrong_never_corrected` | Share of crumbs with an error never corrected | .02 |
| `imperfection_rates.contradiction` | Share of crumbs contradicted by another source | .04 |
| `background_share` | Share of events that are background, per source | slack .88, jira .75, meeting .92, calendar .85 |
| `off_topic_share` | Share of messages that are off-topic, per source | slack .20, jira 0, meeting .08, calendar .10 |

## 9. Validator

`validateWorld(world, answers)` → `{errors, warnings, counts}` (`scripts/generate-world/validate.mjs`). Checks: required fields and types; enums; every id reference resolves; ids unique across the world; times well formed, correct Pacific offset, inside the window (`time`) or after its start (`ftime`); histories non-empty and ordered by `known_at`; Xometry orders have 2–4 tiers, chosen tier among them, totals add up; crumbs have claims; events have the `where` key their source needs; team members point back to the team; every Xometry order has exactly one answers entry and every entry an order. Prints entity counts.
