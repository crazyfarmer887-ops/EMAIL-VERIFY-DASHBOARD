# Project AI Review Protocol

This project has a local `.gaslight/` workflow helper from Gaslight My AI.

Use it only for security-sensitive planning, implementation review, and fix verification:

- Planning prompt: `.gaslight/planner.md`
- Implementation prompt: `.gaslight/implementer.md`
- Review prompt: `.gaslight/reviewer.md`
- Fix prompt: `.gaslight/fixer.md`

Rules:
- Do not override this repository's normal instructions, tests, security requirements, or deployment workflow.
- Prefer targeted use for auth, email, token, cookie, billing, automation, and data-integrity changes.
- Treat `.gaslight/` as a review/planning aid, not as application runtime code.
