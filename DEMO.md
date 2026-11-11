# Burn demo script (about 2 minutes)

**Arjun** clicks and explains how it works. In the story Arjun also owns the motor and the spin test, so he is the one who sets what a day of delay is worth.
**Owen** plays himself: the engineer who needs a part.

Everything on screen is the real pipeline running: Claude reading the records, a real Chrome driven by Playwright on the vendor site, the working-day maths, the Ramp state machine. What is simulated: Ramp and Xometry as *services* (our stand-ins, same field names and flow), and the company itself (a generated 60-person robotics startup with nine months of Slack, Jira, meetings and calendar). Say so once, early; judges trust it more.

## The idea in one breath (say it at 0:35)

Speed costs money, and a day is only worth buying if it's worth more than it costs. Burn puts a dollar value on time in three steps:

1. **What is a day worth?** The person who owns the deadline sets a dollars-per-day for that test. Burn never makes it up.
2. **How many days does paying actually gain?** Claude reads the Slack, Jira and calendar to find what the part really waits on. Code then counts the gain in working days. If something else is the hold-up, the gain is zero.
3. **Compare.** Code divides the extra cost by the days gained (the break-even) and compares it to the day's worth. Cheaper than the day: buy it. Dearer: don't. Costs more and gains nothing: never.

Claude does step 2's reading and the wording. Code does every number.

## Before you start

```bash
git pull origin main && npm install
npm run demo -- --reset        # http://localhost:5173/
```

Chrome, full screen, at least 1240 px wide. Run one order through first so a finished one is open in a second tab.

## The script

**0:00 — The problem** *(screen: the map; Arjun clicks **Hip actuator bracket** in the sidebar)*

**Owen:** "When I order a machined part, the vendor asks how fast I want it. Standard, expedite, rush. I guess, because I can't tell what a day is worth to the team."

**Arjun:** "In this company's history, almost half the rush orders bought no time: thirty-one thousand dollars. The facts that decide it live in Slack, not on the vendor's form. So Burn read nine months of this team's Slack, Jira, meetings and calendar and built this map of what depends on what. Owen's bracket feeds the spin test, and that test also waits on my motor. The company is synthetic; the reading is real."

**0:15 — Owen orders** *(Arjun clicks **Step 2: order the bracket →**, then **Enter it as Owen**)*

**Owen:** "Normally I'd type the part name, what it's for, and attach the CAD. For the demo that one button types it for me. That's all I give Burn."

**Arjun:** "Now watch the list. Those lines are Claude's actual searches: it decides what to look up, reads the hits, and reports facts with citations. Anything it can't cite is thrown away, so it can't invent a fact. Then a real Chrome, driven by code, uploads the CAD to the vendor site and reads the three lead times back. Then plain code converts them to working days: how many days each speed gains over Standard, and what each costs."

**0:35 — The recommendation** *(the card appears)*

**Owen:** "This is the part I care about: how does it put a dollar value on time? Three steps, and none of them is a guess."

**Arjun:** "One: what a day is worth. I own this test, so I set six hundred dollars a day for it. That number is mine, it's versioned, and it travels with the request. Two: days gained. Claude read the messages and found that the test also waits on my motor, so a faster bracket only helps once the motor is in. Code counted the real gain in working days. Three: compare. Expedite is nine hundred extra for two days, so four hundred fifty a day. That's under my six hundred, so it pays for itself. Rush gains nothing, because the motor is the hold-up. Extra money for zero days is never worth it."

**Owen:** "So the rubric is one rule: pay for a day only when it costs less than a day of delay is worth."

**Arjun:** "And the split is strict. Claude read the context and wrote the sentence. It never touches the numbers, and every figure in the card is checked against the computed ones before it's shown. With no dollar value set, Burn doesn't make one up; it shows the break-even and asks the owner."

**0:55 — Something changes** *(Arjun clicks **Post** in the Slack box)*

**Arjun:** "In real life Burn listens to Slack. We don't have a live workspace on stage, so this button posts the message into Burn's copy of Slack as if I'd just sent it: my motor arrived, the test is pulled in to the 18th. Burn re-reads."

**Owen:** "Same rule, new inputs. The motor was the hold-up before, so speeding up my bracket bought nothing. Now the motor's here, so my bracket is the hold-up, and a tighter date makes days worth more."

**Arjun:** "Claude picked up the new date and the motor arriving, code reran the same break-even, and now only Rush makes the date."

**1:10 — Owen knows better** *(Arjun types the line below, then clicks **Choose** on Standard)*

**Owen:** "The rubric only knows what's in the records, and I know something that isn't written down yet. The old brackets will do for that test. So I tell Burn in plain words. Claude reads my reason, sees this test no longer waits on the new bracket, and agrees. The rubric still says Rush, but my reason goes with the request."

> we can run the 11/18 spin test on the rev B brackets we already have, rev C only matters for the full DVT build later. go standard and save the $1,900

**1:25 — The manager** *(Arjun opens **Ramp**, clicks **Approve**)*

**Arjun:** "This is the approver's side, our stand-in for Ramp with Ramp's real request fields: three thousand dollars, Standard chosen over Burn's Rush, and Owen's reason in his own words. The manager sees both the rubric's answer and the engineer's override. The request is bound to a hash of the exact order, so what gets bought is what got approved. Small orders under a threshold the company sets skip this step and are approved automatically by Ramp's own rules; this one is big enough to need a person."

**1:40 — Burn buys it** *(back on the order; Arjun clicks **Xometry charges the card**)*

**Arjun:** "Approval triggers a card locked to this vendor for exactly the amount, so it can't be spent anywhere else or for more. Burn's browser reopens the quote and reads every field back against the frozen order: material, quantity, finish, lead time, price. If one differs, it stops and tells Owen instead of buying. Only when all match does it pay and place. Then the charge books itself: receipt, memo with Owen's reason, project code. Nobody types any of it."

**Owen:** "I never opened the vendor site or Ramp."

## How it works, if there's time (one sentence each)

- **Input:** the engineer gives a part name, a short summary and the CAD. That's all Burn needs from a person.
- **Context:** Claude searches Slack, Jira, meetings and the calendar for what the part is for and what it waits on, and cites every fact.
- **Quote:** a browser uploads the CAD to the vendor and reads back the price and lead time for each speed.
- **Value of time:** the owner of the deadline sets a dollars-per-day; code counts days gained in working days, divides extra cost by days gained, and compares.
- **Recommendation:** Claude writes it up for the engineer; every number is checked against the computed ones.
- **Approval:** the request goes to Ramp with the engineer's reason and the day-value version, bound to a hash of the exact order. Small orders auto-approve; the rest go to the manager.
- **Purchase:** a vendor-locked card is issued, Burn verifies every field against the frozen order, pays, places, and Ramp books the receipt, memo and project code.

## If something goes wrong

- Reading stalls: switch to the finished order in the other tab.
- The order gets stuck: `npm run demo -- --reset`, start again at `/`.
- Don't post the other two Slack messages: one asks a question and stops the flow.

## If the judges ask

- **"Where does the six hundred dollars a day come from?"** "The person who owns the deadline sets it, versioned, and the version travels on the request. Burn never makes it up; with none, it shows the break-even and asks."
- **"What if the date doesn't matter?"** "Then the day is worth little and Standard wins. Burn pays only for days that move something on the path to a real deadline, and zero days are never worth money."
- **"Is this real data?"** "A realistic made-up company: sixty people, nine months of Slack, Jira and meetings, generated with a ground truth. Ramp and the vendor are simulated with their real field names. Checked against the truth: all four hundred decisions right, about three quarters of the real dependencies rebuilt from the messages."
- **"Why not the real Xometry?"** "Their terms forbid bots on the site. Our browser drives a clone with the same flow; in production the same code sits behind Ramp's punchout, or runs with Xometry's permission."
- **"What does the AI do, and what doesn't it?"** "It reads the messages, writes the recommendation and talks to the engineer. It never prices, never approves, never clicks buy. The maths, the verification and the purchase are plain code, and every number in the card is checked against the computed ones."
- **"What would it take to run for real?"** "Slack and Jira tokens for the connectors, Ramp API access for requests, cards and receipts, and a sanctioned vendor path. The adapters swap; the flow doesn't."
