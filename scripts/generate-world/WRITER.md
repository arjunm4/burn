# Writer agent guide

You are filling in the words of planned records for a synthetic dataset about a fictional humanoid robotics startup, Flintlock Robotics (60 people, California; only pieces of the robot work, and much of the work is testing them). Code has already fixed who speaks, when, where, and what fact each piece of text carries. **You write only the text.** The goal is realism: a judge who has worked at a hardware startup should believe these are real.

## Ground rules

- Repo: `/Users/owen/Documents/burn`. Do not run git. Do not edit any repository file by hand: job files change only through the tool below.
- Node 24: `export PATH="$HOME/.local/node/bin:$PATH"`.
- Work only on the job ids you were given. Write your text files only in the folder you were given, and run `fill` only for your own jobs. Other writers are working at the same time.

## Steps, for each job

1. `node scripts/generate-world/job-tool.mjs view <job_id>` shows the participants and their writing styles, the context, every text slot (its key, author, time, place in its thread or meeting, crumb or background, the brief, the exact `must` strings) and the FILL SHAPE.
2. Write a JSON file in that FILL SHAPE, covering every slot, to `<your folder>/<job_id>.json`.
3. `node scripts/generate-world/job-tool.mjs fill <job_id> <that file>`. It validates and reports problems per slot. Fix and re-run until it exits 0.

Before writing, read in `docs/research/data-realism.md` only: "Principles across all sources", the section for your source ("Slack", "Tickets (Jira)" or "Meeting notes and transcripts"), and "Fake-looking patterns to avoid".

## Rules for all sources

- The brief says **what** is said, never how. Do not reuse its wording. Write what that person would actually type or say, in their style notes.
- A **crumb** is a purchasing-relevant fact inside ordinary work talk. Do not spotlight it, summarise it or explain jargon. Every `must` string must appear verbatim, exact characters and case (the check is case-sensitive, even for people who write in capitals), placed naturally. Where a `must` string is a long formal name, use it once the way someone reading it off a tracker would.
- **Add no facts.** No dates, part numbers, quantities, prices, vendors or names that are not in the brief, the `must` strings or the job's context. Relative time ("last week", "tmrw") is fine. Never state which shipping tier was chosen, and never explain why a decision was made unless the brief says so.
- **Background** slots must contain no part numbers, ids, amounts of $50 or more, or explicit dates (the tool rejects them). Make them specific to the team's engineering work or plainly off-topic, not generic filler.
- No markdown, no quotation marks around a message, no greetings, nothing that sounds like an assistant.
- Vary sentence shapes; do not let every line follow the same pattern.

## Slack

- Replies must read as replies to what came before in the thread.
- Most messages are 3 to 15 words; follow each slot's length class; one-word acks are common.
- Mostly lowercase, little end punctuation, the occasional typo left in, emoji sparingly, each according to the person's style notes.

## Jira

- Titles are terse and inconsistent: noun phrases or verb-first, mixed capitalisation, abbreviations (BOM, DFM, FAI, CMM, EVT), a revision tag, an occasional typo or trailing "??".
- Descriptions are short: often one or two lines, sometimes a pasted spec fragment, sometimes trailing off. Follow the slot's length class.
- Comments are fragments with no greeting ("waiting on quote", "pushed to fri, vendor slipped").
- No headings, no "As a user I want".

## Meetings

- Most of each meeting is real work talk for that kind of meeting: engineering trade-offs, test results, build problems, vendor and lead-time talk in a supply-chain sync, schedule in a program review. The crumbs are a small part, said in passing by the person named, near the minute given. Do not build the meeting around them and do not have anyone summarise them.
- A `must` string may appear in the transcript or the summary.
- Transcript: speaker-labelled lines with rising `start_s` inside the meeting's length. The `speaker` value is the person's handle exactly as `view` lists it (e.g. `dmitri`, `zoe.c`), not their full name; the tool rejects anything else as "not present". Spoken language: false starts, "uh", interruptions, someone joining late or asking to repeat, an occasional speech-to-text error on jargon, a little off-topic chat. Each person sounds like their style notes. Roughly 25 to 45 lines; a long meeting need not be transcribed in full.
- Summary in a note-taker's voice: a short overview, shorthand bullets, action items as loose lines (some vague, some with no owner), keywords.
- No attendee who was not present speaks.

## Report

When every job exits 0, report in under 60 words: jobs filled, slots written, and any slot you could not satisfy and why.
