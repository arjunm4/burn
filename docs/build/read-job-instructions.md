# Read job instructions (for a Claude agent)

You fill **one** job file: `fixtures/timevalue/read-jobs/<job_id>.json`. It holds up to ~40 docs (Slack messages, Jira descriptions/comments/field changes, meeting transcript lines, calendar events) and a `catalog` slice of the company's parts, deliverables, tests, milestones and rigs. For every doc you return what it refers to, what it claims, how much schedule pressure it shows, and what it says is done.

Code reads the same docs with regexes (`server/timevalue/read.mjs`); your read replaces the code read for these docs. Design: [`../architecture.md`](../architecture.md) §10 (pressure read); contract: [`time-value-impl.md`](time-value-impl.md) (`read.mjs`).

## Steps

1. Open the job file. Read `catalog` first, then `docs` in order. Docs with the same `thread` (Slack thread, Jira ticket, meeting file) belong together: read the whole thread before rating any message in it.
2. Fill `results`: **one entry per doc**, in the same order, for every doc (an empty read is still an entry).
3. Set `"filled_by"` to your agent name. Change nothing else in the file.
4. Save. Then run `node scripts/timevalue/read-jobs.mjs --collect` (add `--out <dir>` if the job is not under `fixtures/timevalue`) and fix any errors it prints for your job.

## Output schema

```json
"results": [
  {
    "doc_id": "slack:C07FLK0ACTU:1793830800.000100",
    "refs":   [{"id": "dl-hip-motor-dvt", "mode": "alias", "token": "dvt hip frameless motor"}],
    "claims": [{"kind": "eta", "subject": "dl-hip-motor-dvt", "value": "2026-11-20"}],
    "pressure": 0.45,
    "done": [],
    "cues": ["slip", "again", "😬"]
  }
]
```

| Field | Rule |
|---|---|
| `doc_id` | The doc's `id`, copied exactly. |
| `refs` | Every catalog item the doc is about, including items named only in context ("the motor" in a thread about the DVT hip frameless motor). `id` from the catalog, or `"unresolved"` when it clearly names a part or deliverable that is not in the catalog. `mode`: `"id"` if the text has the part number, quote or order number; `"alias"` if a name or nickname; `"vague"` if only "the bracket"/"it" resolved from the thread. `token`: the words in the text. If a nickname could be two catalog items and the thread does not settle it, list both. |
| `claims` | Statements about the schedule (kinds below). `subject` and any id in `value`/`for` from the catalog or `"unresolved"`. |
| `pressure` | A number 0–1 on the scale below. |
| `done` | Catalog ids the doc says are finished, arrived, received, passed or closed **as of this doc**. Not plans ("will be done fri"), not questions, not negations. |
| `cues` | 0–4 short quotes from the text behind your pressure rating ("any update", "idle", "😬"). Empty when pressure is 0. |

Do not add `by`, `at` or `doc_id` inside claims; collect fills them from the doc.

### Claim kinds

| kind | subject | value | Example |
|---|---|---|---|
| `needs` | the item needed (part or deliverable) | need-by date `"YYYY-MM-DD"` or `null`; optional `"qty"` (integer) and `"for"` (the test/milestone it is needed for) | "need 4x FL-HIP-1042 rev C by tues 11/17 for the spin test" → `{"kind":"needs","subject":"pt-hip-bracket","value":"2026-11-17","qty":4,"for":"test-hip-spin"}` |
| `eta` | the item arriving, or the test/milestone happening | date, or `{"min","max"}` for a range | "vendor says 11/20 now" → `"2026-11-20"`; "somewhere between 11/19 and 11/30" → `{"min":"2026-11-19","max":"2026-11-30"}`; "spin test moves to the week of the 23rd" → subject the test, `{"min":"2026-11-23","max":"2026-11-27"}` |
| `done` | the finished item | date it was done (usually the doc's date) or `null` | "spacer set done mon 11/9" → `"2026-11-09"` |
| `blocked` | what is blocked or waiting (a test, part or rig) | the catalog id it waits on, `"unresolved"`, or `null` | "spin test blocked on the motor" → subject `test-hip-spin`, value `dl-hip-motor-dvt`. Only when it is waiting now; "idle *if* the brackets aren't in" is a need, not a block |
| `need_earlier` | the item | the new, earlier need-by date | "test got pulled in to monday so we need the hooks by fri 9/11" → `"2026-09-11"` |
| `duration` | the test or work | days as a number, or `{"min","max"}` | "takes about three days on the stand" → `3` |

**Dates.** Write `YYYY-MM-DD`. Resolve relative dates ("tues", "the twentieth", "next week", "EOW") against the doc's `at` (Pacific time): the next such day on or after the doc's date, unless the text says otherwise. Correct with the thread: "actually 19th not 20th" makes the earlier claim's date 19th in a *new* claim on the correcting doc; don't edit earlier results. If a date is too vague to pin ("soon", "in a couple weeks"), leave the claim out.

### Pressure scale

Rate the schedule pressure **this doc** shows, read in its thread. Use the absolute scale; team baselines are applied later in code, so do not adjust for how loud a person or channel usually is.

| Pressure | Meaning | Anchors |
|---|---|---|
| 0.0 | Neutral: acks, facts, logistics, bots | "ok ty" · "quote approved, lead time 8 BD" · "Okay. Noted." |
| 0.1–0.2 | Routine date or need-by talk, no worry | "need 2x pelvis plate by 9/22" · "std is 8 BD, want me to place it?" |
| 0.3–0.4 | A first chase or mild concern | "any update on the shaft?" · "spin test is the 23rd now" |
| 0.5–0.6 | Repeated chase, a slip with visible annoyance, something waiting | "bumping this, line's idle thurs" · "slipped again 😬" · "ugh. that pushes the spin test" |
| 0.7–0.8 | Deadline close and at risk, asking to pay for speed, a manager or lead stepping in to push | "can we expedite? EVT build is thurs" · a lead's "where are we on this, need it mon" |
| 0.9–1.0 | Emergency | "asap!! build is tmrw and we're blocked" · "drop everything" |

Signals that raise it: "any update", "bumping", "??", "!!", asap/urgent, blocked/idle/waiting on, need-by dates close to the doc's date, slips ("again", "pushed"), frustration ("ugh", 😬), a manager or lead joining, escalation to a meeting. Signals that lower it: slack in the schedule ("standard is fine", "no rush", "hooks by tues is fine").

## Hard rules

- **Ids only from this job's `catalog`, or `"unresolved"`.** Never invent an id, a date, a quantity or a link. If you are unsure, leave it out.
- One result per doc, `doc_id` exact, no extra docs.
- `pressure` is a number between 0 and 1.
- Only what the text says. No outside knowledge of the company, no guesses about what "probably" happened.
- Don't edit `docs`, `catalog` or any other field, and don't touch other job files.

`--collect` rejects a result (and reports it) when an id is not in the catalog, a claim kind or value is malformed, or pressure is out of range. Docs without a valid result keep the code read.
