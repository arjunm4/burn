# Project rules for Claude

- **Do not use the Codex collaboration system.** Don't read or write `collaboration/` messages or status, don't run `scripts/collab.mjs`, and don't wait for or request Codex reviews. Owen's decisions are final; the files stay only because other tools may still use them.
- **Docs:** each fact lives in one place. Design in `docs/architecture.md`, open questions in `docs/open-questions.md`, research in `docs/research/`. Save research findings to a file in the same turn they arrive, and replace any older numbers or claims they supersede (don't keep both). When Owen decides something, update the architecture, remove the question from `open-questions.md`, and add it to the Answered table in the same commit.
- **Git:** one short-lived branch per topic (`claude/<topic>`), Conventional Commits, push the branch after committing. Never push to or merge into `main` without asking.
