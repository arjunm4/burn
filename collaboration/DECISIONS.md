# Architecture decisions

**Note (2026-11-10):** the decisions below were made for the pre-v8 prototype (Digi-Key sensor demo) and still describe the code as it runs. The product design has moved to v8 ([`docs/architecture.md`](../docs/architecture.md)), which supersedes some of them for future work:
- The local approval policy ($500 or deviation from the recommendation) is replaced by approval in Ramp (architecture §2.12).
- Local draft purchase orders are replaced by Ramp requests and verified Xometry placement (§0.3, §0.4).
- The Digi-Key sensor workflow states are replaced by the v8 order states (§4).

Build ownership for v8 is not yet agreed (see `docs/open-questions.md` B5).

## Agreed direction (Claude mailbox 7291fdba, Codex reply 65b6015b)

- Local hackathon stack: Vite/React + Node HTTP + built-in SQLite, no additional DB service.
- Preserve the two supplied views; share persistent requests and deterministic cost calculations.
- Sensor workflow: needs_answer → choosing → pending_approval → ordered. A substitute answer may skip straight to ordered. `ordered` currently means draft PO exists, and UI must label it as draft.
- Approval policy: selected shipping price above $500 OR deviation from recommendation requires approval. This resolves an inconsistency in the reference queue's premium-based policy; implementation uses full shipping price.
- Persist exact approved tier and revision. Reject stale writes and terminal transitions to prevent duplicate drafts.
- Reset invalidates dependent bookings. Parent completion releases dependencies; later work should derive actual booking dates from the parent's approved shipping tier.
- Tool completion events drive working progress. Current tools read fixtures. The model-backed planner is implemented with a no-key deterministic fallback; the UI identifies which planner ran. Live source integrations remain future work.
- Git: feature worktrees and Conventional Commits. Both agents have feature worktrees and conventional commits merged into main.

Claude and Codex agreed the core storage, policy and agent/fallback approach. Final implemented v1 API uses `{requests, approved, resolvedBy}` snapshots, `{request}` mutations and numeric `revision`; this supersedes Claude's proposed view array/expectedRevision contract. Contract integration is confirmed and tested across backend and frontend. Claude owns `server/agent/` and subsequent UI work; Codex owns backend core, shared decisions, protocol and README outside Agent/UI sections.


## Integration and verification

- Fixed demo date: order November 9, expedited arrival November 14, priority November 16, standard November 21. Dates and delay totals share deterministic derivation.
- Completed agent tool labels/summaries are persisted and replayed after reload; replay never invents execution events.
- Catalog matching uses whole-word aliases. Unsupported requests cannot place orders. Parsed quantity is reflected in approval and saved draft identity, along with vendor and the exact shipping quote.
- A same-project replacement purchase can satisfy a seeded catalog dependency when it covers the required catalog quantity. Partial purchases leave that dependency waiting.
- Chrome verified the sensor Standard selection → Priority approval override → same draft PO in engineer and approver views. All purchasing remains local draft creation; no live vendor order is placed.
