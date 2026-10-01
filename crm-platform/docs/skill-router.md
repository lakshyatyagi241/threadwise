# Skill Router

Paste this at start of chat. Applies to every prompt after it in session.

## Rule

Before answering any prompt below, pick best-fitting skill from table.
Invoke via Skill tool. If none fits, say so and proceed without one.

**Every response must start with one line:**

`Skill used: <name> — <one-line reason>`
or
`Skill used: none — <one-line reason>`

If a skill's doc says "invoke X skill", chain into X, and mention both
in the line (`new-module → add-migration — schema change needed`).

## Selection table

| Prompt mentions / intent                                                                                                              | Skill                      |
| ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| first-time repo setup, "get me running", "onboard me", pnpm dev fails                                                                 | `setup`                    |
| new entity/resource/CRUD ("add a deals module", "companies API")                                                                      | `new-module`               |
| schema change, new table/column, migration file                                                                                       | `add-migration`            |
| new/changed request or response shape, DTO, Zod schema, new error code                                                                | `contracts-change`         |
| new permission, gate route by role, RBAC                                                                                              | `rbac-permission`          |
| side effect after a write, "notify when X", webhook fire, event                                                                       | `outbox-event`             |
| background/scheduled/async work, queue, cron, "in the background", "every N minutes"                                                  | `worker-job`               |
| integrate vendor API (BSP, SMS, email, payment, voice)                                                                                | `provider-adapter`         |
| inbound webhook endpoint, provider callback                                                                                           | `webhook-handler`          |
| frontend fetch from apps/web or apps/partner, data hook, form submit to API                                                           | `frontend-api-call`        |
| decision expensive to reverse, "why did we do X", new dependency choice                                                               | `write-adr`                |
| docs/adr/*.md touched, "is ADR bookkeeping ok"                                                                                        | `adr-diff-guard`           |
| "open a PR", "is this ready", "run the checks"                                                                                        | `pre-pr`                   |
| review diff/PR against this repo's own rules (tenant scoping, RLS, AppError, outbox)                                                  | `adr-compliance-review`    |
| any feature, screen, endpoint, contract, migration or worker job just built or changed; "compare with threadwise", "parity", "playwright" | `threadwise-playwright-parity` |
| general code review (bugs, simplification, not repo-specific)                                                                         | `code-review`              |
| explicit "simplify this"                                                                                                              | `simplify`                 |

## Chains (from `.claude/skills/README.md`)

```
"add a deals module"
  new-module -> add-migration -> contracts-change -> rbac-permission
            -> outbox-event
            -> pre-pr -> adr-diff-guard
                      -> adr-compliance-review

"integrate Gupshup"
  provider-adapter -> webhook-handler -> worker-job
                  -> write-adr -> adr-diff-guard
                  -> pre-pr

"add a field to the contact API"
  contracts-change -> add-migration (if column is new)
                  -> frontend-api-call
                  -> pre-pr
```

## Fallback

Prompt not code/repo-related (question, explanation, unrelated task) ->
`Skill used: none — not covered by project skills`. Do not force a skill.
