# Local Gaslight Usage

This repository uses Gaslight My AI as an optional review/planning aid.

## Commands

```bash
.gaslight/run-plan.sh "plan a security-sensitive change"
.gaslight/run-review.sh path/to/file.ts
.gaslight/run-fix.sh "fix the issues from review"
```

The wrapper scripts print adversarial role context. Feed that context into the coding agent/review step.

## Scope

Use this for high-risk work only:
- authentication and authorization
- email parsing/ingestion
- tokens, cookies, API keys, sessions
- automation actions with external side effects
- billing/revenue/data-integrity logic

Do not let these prompts replace project-specific tests, existing AGENTS.md rules, or deployment rules.
