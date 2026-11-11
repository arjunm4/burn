# Burn demo script (one minute)

**Arjun** clicks and explains. In the story Arjun also owns the motor and the spin test.
**Owen** plays himself: the engineer who needs a part.

## Before you start

```bash
git pull origin main && npm install
npm run demo -- --reset        # http://localhost:5173/
```

Chrome, full screen, at least 1240 px wide. Run one order through first so a finished one is open in a second tab.

## The script

**0:00 — The problem** *(screen: the map; Arjun clicks **Hip actuator bracket** in the sidebar)*

**Owen:** "When I order a machined part, the website asks how fast I want it. I guess."
**Arjun:** "Almost half our rush orders bought no time: thirty-one thousand dollars. Burn mapped our Slack, Jira and meetings. Owen's bracket feeds the spin test, and that test also waits on my motor."

**0:12 — Owen orders** *(Arjun clicks **Step 2: order the bracket →**, then **Enter it as Owen**)*

**Owen:** "I type the part and attach the design file. That's it."
**Arjun:** "Burn reads our records, gets the price for every speed from the vendor in its own browser, and does the maths in working days."

**0:25 — The recommendation** *(the card appears)*

**Arjun:** "Expedite: nine hundred dollars buys two days, worth it at the six hundred a day I put on this test. Rush buys nothing, because my motor is the hold-up."

**0:33 — Something changes** *(Arjun clicks **Post** in the Slack box)*

**Arjun:** "I just posted that my motor arrived and the test is pulled in to the 18th. Burn re-reads. Now only Rush makes the date."

**0:42 — Owen knows better** *(Arjun types the line below, then clicks **Choose** on Standard)*

**Owen:** "The old brackets will do for that test. Burn agrees, and sends my reason with the request."

> we can run the 11/18 spin test on the rev B brackets we already have, rev C only matters for the full DVT build later. go standard and save the $1,900

**0:50 — The manager** *(Arjun opens **Ramp**, clicks **Approve**)*

**Arjun:** "Ingrid sees three thousand dollars, Standard over Burn's Rush, and Owen's reason. One click."

**0:55 — Burn buys it** *(back on the order; Arjun clicks **Xometry charges the card**)*

**Owen:** "A card that only works at this vendor, every field checked, placed, receipt booked. I never opened the vendor site or Ramp."

## If something goes wrong

- Reading stalls: switch to the finished order in the other tab.
- The order gets stuck: `npm run demo -- --reset`, start again at `/`.
- Don't post the other two Slack messages: one asks a question and stops the flow.

## If the judges ask

- **"Is this real data?"** "A realistic made-up company: sixty people, nine months of Slack, Jira and meetings. Ramp and the vendor are simulated with their real field names. Checked against the true answers: all four hundred decisions right, about three quarters of the real dependencies rebuilt from the messages."
- **"Where does the six hundred dollars a day come from?"** "The person who owns the deadline sets it, versioned. Burn never makes it up; with none, it shows the break-even and asks."
- **"What does the AI do?"** "It reads the messages, writes the recommendation and talks to the engineer. The money maths, the verification and the purchase are plain code, and every number in the card is checked against the computed ones."
