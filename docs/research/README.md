# Research

Evidence behind the design. Written once and rarely changed; the design in [`../architecture.md`](../architecture.md) links here for the reasons behind its decisions. Open questions live in [`../open-questions.md`](../open-questions.md).

| File | Covers | Main conclusions |
|---|---|---|
| [`startup-purchasing.md`](startup-purchasing.md) | How hardware startups buy custom parts: vendor tiers, approvals, BOMs, purchase requests, receiving, first use | Premiums only inside quotes; BOMs stale and omit fixtures; requests say *when* not *for what*; no data on unused expedites; no tool recommends expedite vs standard per part |
| [`vendor-apis.md`](vendor-apis.md) | Which manufacturing vendors have buyer APIs, punchout or team accounts | No CNC vendor has a usable buyer API; Xometry via automation + Teamspace (the design later chose a server-side headless browser, see architecture §2.14); AFN is the only CNC API but doesn't fit v1 |
| [`ramp-integration.md`](ramp-integration.md) | Ramp API path, sandbox, MCP and Agent Cards, hackathon build plan, demo script, risks, judge questions | REST with app credentials; mock first, then sandbox per step; card, webhooks and booking work in sandbox; purchase requests and item receipts uncertain |
| [`xometry-automation.md`](xometry-automation.md) | Xometry terms, company account and login, bot protection, headless runtime options | Terms ban bots and account sharing (punchout or written permission needed for production); dedicated Teamspace user workable; Turnstile at login; local Playwright for the demo, Browserbase for production |

**Conventions:** date each file; label evidence vs vendor claims vs inference; cite a URL for every claim; mark anything unverified.
