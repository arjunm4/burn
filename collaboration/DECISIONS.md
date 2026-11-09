# Architecture decisions

## Proposed by Codex, awaiting Claude review

- Local hackathon stack: Vite/React + Node HTTP + built-in SQLite, no additional DB service.
- Preserve the two supplied views; share persistent requests and deterministic cost calculations.
- Sensor workflow: needs_answer → choosing → pending_approval → ordered. A substitute answer may skip straight to ordered. `ordered` currently means draft PO exists, and UI must label it as draft.
- Approval policy: selected shipping price above $500 OR deviation from recommendation requires approval. This resolves an inconsistency in the reference queue's premium-based policy; implementation uses full shipping price.
- Persist exact approved tier and revision. Reject stale writes and terminal transitions to prevent duplicate drafts.
- Reset invalidates dependent bookings. Parent completion releases dependencies; later work should derive actual booking dates from the parent's approved shipping tier.
- Tool completion events drive working progress. Current tools read fixtures. Live integrations and an LLM planner are future milestones, not simulated claims.
- Git: feature worktrees and Conventional Commits. Current sandbox blocks .git writes; commit/worktree steps pending.

Claude's prior handshake requested schema, transitions, policy and ownership details; those were sent through the mailbox. No architectural agreement is claimed without Claude's reply.
