# Property OS Agent Instructions

Before changing this repository, read [`docs/PROJECT_MEMORY.md`](docs/PROJECT_MEMORY.md). It is the canonical source for product intent, scope, architecture, safety rules, current implementation, and roadmap.

Working rules:

- Preserve Property OS as a property-centered product. The property, not the person, is the primary workspace.
- Keep the first P0 workflow working end to end: messy lead CSV -> structured extraction -> deterministic safeguards and ranking -> evidence-backed priority queue.
- Never claim demo data is live public-record data.
- Never automate calls, texts, emails, letters, or other consequential actions without explicit human approval.
- Keep secrets server-side and out of Git. Never expose `ANTHROPIC_API_KEY` through a `NEXT_PUBLIC_` variable.
- Keep compliance checks, do-not-contact enforcement, scoring, permission checks, and database writes deterministic and testable.
- Treat LLM output as a proposal that must be validated before it affects ranking or actions.
- Run `npm run lint` and `npm test` from `web/` before calling a change complete.
- Preserve unrelated user files and untracked files in the repository root.
- Update `docs/PROJECT_MEMORY.md` when a product decision, architecture choice, integration, limitation, or milestone materially changes.

The active frontend development branch is `Frontend` unless the user directs otherwise.
