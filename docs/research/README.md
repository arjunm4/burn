# Research

Evidence behind the design. Written once and rarely changed; the design in [`../architecture.md`](../architecture.md) links here for the reasons behind its decisions. Open questions live in [`../open-questions.md`](../open-questions.md).

| File | Covers | Main conclusions |
|---|---|---|
| [`startup-purchasing.md`](startup-purchasing.md) | How hardware startups buy custom parts: vendor tiers, approvals, BOMs, purchase requests, receiving, first use | Premiums only inside quotes; BOMs stale and omit fixtures; requests say *when* not *for what*; no data on unused expedites; no tool recommends expedite vs standard per part |
| [`vendor-apis.md`](vendor-apis.md) | Which manufacturing vendors have buyer APIs, punchout or team accounts | No CNC vendor has a usable buyer API; Xometry via extension + Teamspace; AFN is the only CNC API but doesn't fit v1 |
| [`data-realism.md`](data-realism.md) | Making synthetic Slack, tickets, meetings, calendar, orders across all vendors and Ramp charges realistic for Flintlock (60 people, California, Xometry US); showing judges | Real API formats for every source; style rules and numbers (mostly judgement); fake-looking patterns to avoid; provenance trail and real-format comparison as the strongest proof |
| [`cost-of-delay.md`](cost-of-delay.md) | Cost of delay, urgency curves, expedite economics, critical path and merge bias, progress measures, eliciting a $/day from owners | Pay less than cost of delay only for critical-path time; estimates disagree widely, so ask the owner; curves can be linear, deadline steps or cliffs; switching values are standard practice; no data on how often expedites change finish dates or on startup $/day |
| [`ramp-integration.md`](ramp-integration.md) | Ramp API path, sandbox, MCP and Agent Cards, hackathon build plan, demo script, risks, judge questions | REST with app credentials; mock first, then sandbox per step; card, webhooks and booking work in sandbox; purchase requests and item receipts uncertain |

**Conventions:** date each file; label evidence vs vendor claims vs inference; cite a URL for every claim; mark anything unverified.
