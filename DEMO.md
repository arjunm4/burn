# Burn demo script (under a minute)

```bash
git pull origin main && npm install
npm run demo -- --reset        # http://localhost:5173/
```

Chrome, full screen, ≥1240 px wide. Run one order through before recording so a finished one exists in a second tab.

| Time | Screen | Click | Say |
| --- | --- | --- | --- |
| 0:00 | Map (`/`) | Sidebar: **Hip actuator bracket** | "Burn mapped this robotics startup from its Slack, Jira and meetings. Owen needs this bracket; the spin test waits on it, and on a motor. 61 of their 133 rush orders bought no time." |
| 0:10 | Map | **Step 2: order the bracket →** then **Enter it as Owen** | "Owen types the part and attaches the CAD. Burn reads the records, quotes Xometry in its own browser, and does the maths in working days." |
| 0:25 | Order | — (card appears) | "Expedite: $900 buys two days, break-even $450 against the team's $600. Rush buys nothing: the motor is the bottleneck." |
| 0:33 | Order | **Post** the Slack message | "Arjun posts: motor's here, test pulled in to the 18th. Burn re-reads: now only Rush makes it." |
| 0:42 | Order | Type the rev B line → **Choose** Standard | "Owen knows the old brackets will do. Burn agrees, and sends his reason with the request." |
| 0:50 | Ramp | **Approve** | "Ingrid sees $3,000, Standard over Burn's Rush, and why. One click." |
| 0:55 | Order | **Xometry charges the card** | "Card locked to Xometry, every field verified, placed, booked. Owen never opened Xometry or Ramp." |

The line to type: *we can run the 11/18 spin test on the rev B brackets we already have, rev C only matters for the full DVT build later. go standard and save the $1,900*

## If something breaks

- Reading stalls: switch to the finished order in the other tab.
- Order stuck: `npm run demo -- --reset`, start again at `/`.
- Don't post the other two Slack messages (one asks a question and stalls the flow).

## Judge questions

- **Real data?** Synthetic but realistic: a 60-person robotics company, 9 months of Slack, Jira and meetings. Ramp and Xometry are simulated with real field names. Graded against an answer key: 400/400 decisions exact, 76% of true dependencies rebuilt from messages.
- **Where does $600/day come from?** The milestone owner sets it, versioned. Burn never invents it; with none, it shows the break-even and asks.
- **What does the LLM do?** Reads the records (which part, which date, who is blocked), writes the card and talks to the engineer. The money maths, the verification and the purchase are deterministic code; every number in the card is checked against the computed ones.
