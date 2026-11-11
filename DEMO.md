# Burn demo script (about 90 seconds)

**Arjun** clicks and explains how it works. In the story Arjun also owns the motor and the spin test.
**Owen** plays himself: the engineer who needs a part.

Everything on screen is the real pipeline running: Claude reading the records, a real Chrome driven by Playwright on the vendor site, the working-day maths, the Ramp state machine. What is simulated: Ramp and Xometry as *services* (our stand-ins, same field names and flow), and the company itself (a generated 60-person robotics startup with nine months of Slack, Jira, meetings and calendar). Say so once, early; judges trust it more.

## Before you start

```bash
git pull origin main && npm install
npm run demo -- --reset        # http://localhost:5173/
```

Chrome, full screen, at least 1240 px wide. Run one order through first so a finished one is open in a second tab.

## The script

**0:00 — The problem** *(screen: the map; Arjun clicks **Hip actuator bracket** in the sidebar)*

**Owen:** "When I order a machined part, the vendor asks how fast I want it. Standard, expedite, rush. I guess."
**Arjun:** "In this company's history, almost half the rush orders bought no time: thirty-one thousand dollars. The facts that decide it live in Slack, not on the vendor's form. So Burn read nine months of this team's Slack, Jira, meetings and calendar and built this map of what depends on what. Owen's bracket feeds the spin test, and that test also waits on my motor. *The company is synthetic; the reading is real.*"

**0:15 — Owen orders** *(Arjun clicks **Step 2: order the bracket →**, then **Enter it as Owen**)*

**Owen:** "Normally I'd type the part name, what it's for, and attach the CAD. For the demo that one button types it for me."
**Arjun:** "Now watch the list. Those lines are Claude's actual searches: it decides what to look up, reads the hits, and reports facts with citations. Anything it can't cite is thrown away. Then a real Chrome, driven by code, uploads the CAD to the vendor site and reads the three lead times back. Then plain code does the maths in working days."

**0:35 — The recommendation** *(the card appears)*

**Arjun:** "Expedite: nine hundred dollars buys two days, worth it against the six hundred a day I put on this test. Rush buys nothing, because my motor is the hold-up. Claude wrote that sentence, but every number in it is checked against the computed ones before it's shown."

**0:45 — Something changes** *(Arjun clicks **Post** in the Slack box)*

**Arjun:** "In real life Burn listens to Slack. We don't have a live workspace on stage, so this button posts the message into Burn's copy of Slack as if I'd just sent it: my motor arrived, the test is pulled in to the 18th. Burn re-reads, and now only Rush makes the date."

**0:58 — Owen knows better** *(Arjun types the line below, then clicks **Choose** on Standard)*

**Owen:** "The old brackets will do for that test. I tell Burn, it agrees, and my reason goes with the request."

> we can run the 11/18 spin test on the rev B brackets we already have, rev C only matters for the full DVT build later. go standard and save the $1,900

**1:10 — The manager** *(Arjun opens **Ramp**, clicks **Approve**)*

**Arjun:** "This is the approver's side, our stand-in for Ramp with Ramp's real request fields: three thousand dollars, Standard chosen over Burn's Rush, and Owen's reason in his own words. The request is bound to a hash of the exact order, so what gets bought is what got approved."

**1:20 — Burn buys it** *(back on the order; Arjun clicks **Xometry charges the card**)*

**Arjun:** "Approval triggers a card locked to this vendor for exactly the amount. Burn's browser reopens the quote, reads every field back against the frozen order, pays, places. The charge books itself: receipt, memo, project code."
**Owen:** "I never opened the vendor site or Ramp."

## If something goes wrong

- Reading stalls: switch to the finished order in the other tab.
- The order gets stuck: `npm run demo -- --reset`, start again at `/`.
- Don't post the other two Slack messages: one asks a question and stops the flow.

## If the judges ask

- **"Is this real data?"** "A realistic made-up company: sixty people, nine months of Slack, Jira and meetings, generated with a ground truth. Ramp and the vendor are simulated with their real field names. Checked against the truth: all four hundred decisions right, about three quarters of the real dependencies rebuilt from the messages."
- **"Why not the real Xometry?"** "Their terms forbid bots on the site. Our browser drives a clone with the same flow; in production the same code sits behind Ramp's punchout, or runs with Xometry's permission."
- **"Where does the six hundred dollars a day come from?"** "The person who owns the deadline sets it, versioned, and the version travels on the request. Burn never makes it up; with none, it shows the break-even and asks."
- **"What does the AI do, and what doesn't it?"** "It reads the messages, writes the recommendation and talks to the engineer. It never prices, never approves, never clicks buy. The maths, the verification and the purchase are plain code, and every number in the card is checked against the computed ones."
- **"What would it take to run for real?"** "Slack and Jira tokens for the connectors, Ramp API access for requests, cards and receipts, and a sanctioned vendor path. The adapters swap; the flow doesn't."
