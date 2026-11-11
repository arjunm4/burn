# Burn demo script (3 minutes)

## Before you start

```bash
git pull origin main && npm install
npm run demo -- --reset
```

Open **http://localhost:5173/** in Chrome, full screen. The guide (bottom-left) rings each click in yellow.

## Script

| Time | Screen | Click | Say |
| --- | --- | --- | --- |
| 0:00 | Graph | — | "When an engineer orders a custom part, they guess which shipping speed to pay for. At this 60-person robotics startup, **61 of 133 rush orders bought no time: $31k wasted.**" |
| 0:20 | Graph | Sidebar: **Hip actuator bracket** | "Burn read the team's Slack, Jira and meetings and mapped what depends on what. Owen needs this bracket. It feeds the spin test, and that test also waits on a motor." |
| 0:50 | Orders | **Enter it as Owen** | "Owen just types the part and attaches the CAD file." |
| 1:10 | Order | Point at the **chart** and **Who is blocked** | "Burn got the Xometry quote and checked what the bracket is waiting on, and who is waiting on the bracket. The motor lands Friday." |
| 1:30 | Order | **Okay** | "So Expedite gets the test done 2 days sooner for $900: worth it at the owner's $600 a day. Rush costs more and finishes no sooner. One click." |
| 1:50 | Ramp | **Approve** | "The request goes to the manager in Ramp with the reason. She approves." |
| 2:10 | Order | ← back (guide) | "Burn places the order with a Ramp card that only works at Xometry for exactly $3,900, checks every field first, and books the receipt. No forms, no expense report." |
| 2:40 | — | — | "Burn pays for speed only when it buys time, and asks when it can't tell." |

**Optional (+30 s), before Okay:** post **"motor slipped to 11/30"** in the demo box under the card. The answer flips to Standard: rushing buys nothing.

## If something breaks

- Guide on the wrong step: **←** / **→** or **↺**.
- Order stuck: `npm run demo -- --reset`, then start again at Orders.
- Graph page blank: run `npm install`, or skip it and start at `/orders`.

## Judge questions

- **Real data?** Synthetic but realistic: a 60-person robotics company, 9 months of Slack, Jira and meetings. Services are simulated with real field names. Graded against an answer key: 400/400 decisions exact, 76% of true dependencies rebuilt from messages.
- **Where does $600/day come from?** The milestone owner sets it. Burn never invents it; with none, it shows the break-even and asks.
- **What does the LLM do?** Reads the messages: which part, which date, who is blocked. The money maths is deterministic and cited.
