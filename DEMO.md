# Burn demo script (3 minutes)

**Arjun** clicks through the app and explains what Burn is doing. In the story, Arjun also owns the motor.
**Owen** plays himself: the engineer who needs a part.

## Before you start

```bash
git pull origin main && npm install
npm run demo -- --reset
```

Open **http://localhost:5173/** in Chrome, full screen. The yellow ring in the bottom-left guide shows Arjun what to click next.

## The script

**1. The problem** *(screen: the graph)*

**Owen:** "I'm a hardware engineer at a robotics startup. When I order a custom machined part, the website asks me how fast I want it. Normal speed, or pay more to get it sooner. I usually just guess."

**Arjun:** "And I've watched that guessing get expensive. At our company, almost half the rush orders didn't actually speed anything up. That's thirty-one thousand dollars we paid for nothing."

**2. What the part is for** *(Arjun clicks **Hip actuator bracket** in the sidebar)*

**Owen:** "Today I need four of these brackets for my hip actuator."

**Arjun:** "I'm clicking on Owen's bracket. Burn read our Slack, Jira and meeting notes and drew this map of what depends on what. The bracket goes into the spin test. But the spin test is also waiting on a motor from my team. So getting the bracket faster only helps if my motor shows up in time."

*(The app moves to the Orders page.)*

**3. Owen orders the part** *(Arjun clicks **Enter it as Owen**)*

**Owen:** "All I do is type what I need and attach the design file. That's it."

**4. Burn's recommendation** *(Arjun points at the chart and the "Who is blocked" list)*

**Arjun:** "Burn got the price for every speed from the vendor. Then it checked my motor: I said in Slack it arrives Friday. This chart shows the bracket, my motor, and the spin test that needs both. And here's who is stuck until it all arrives."

**Arjun:** "Paying nine hundred dollars more gets the test done two days sooner. I own that test, and I said a day of it is worth six hundred dollars. So it's worth it. The fastest option, Rush, costs even more but finishes on the same day, because the test still has to wait for my motor."

**Owen:** "So I don't have to figure any of that out. I just say okay." *(Arjun clicks **Okay**.)*

**5. The manager approves in Ramp** *(Arjun goes to Ramp and clicks **Approve**)*

**Owen:** "It goes to my manager in Ramp with Burn's reason attached."

**Arjun:** "I'm switching to the manager's view now. She sees why, and approves it like any other purchase."

**6. Burn places the order** *(Arjun goes back to the order)*

**Arjun:** "I'm back on Owen's order. Burn places it by itself, with a Ramp card that only works at this vendor, for exactly the approved amount. It double-checks every detail first, and attaches the receipt and notes to the expense afterwards."

**Owen:** "No forms, no chasing approvals, no expense report. And I didn't pay for speed I didn't need."

**7. Close**

**Arjun:** "We built Burn so we only pay for speed when it actually saves time. And when it can't tell, it asks the one person who knows instead of guessing."

## Optional extra (30 seconds, before Owen clicks Okay)

**Arjun:** "Watch what happens if my motor is late. I'll post in Slack that it slipped to the 30th." *(Posts the message in the demo box under the card.)*

**Owen:** "Now Burn tells me not to rush. Arjun's motor is the hold-up, so paying more for my bracket wouldn't help."

## If something goes wrong

- The guide is on the wrong step: press **←**, **→** or **↺**.
- The order gets stuck: run `npm run demo -- --reset` and start again from Orders.
- The graph page is blank: run `npm install`, or skip it and start at Orders.

## If the judges ask

- **"Is this real data?"** "It's a realistic made-up company: sixty people, nine months of Slack, Jira and meetings. We checked Burn against the true answers: it got all four hundred decisions right, and it rebuilt about three quarters of the real dependencies just from the messages."
- **"Where does the six hundred dollars a day come from?"** "The person who owns that deadline sets it. Burn never makes it up. If nobody has set one, it shows the break-even and asks."
- **"What does the AI do?"** "It reads the messages: which part, which date, who is waiting on what. The money math is plain arithmetic, and every number links back to where it came from."
