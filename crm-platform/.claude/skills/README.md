# Project skills

Claude Code skills scoped to this repo. Anyone working here with Claude Code
gets these automatically — no install step, they live in `.claude/skills/`
and are picked up from the working directory.

They exist so an agent (or a teammate skimming for the right doc) follows
this repo's actual conventions instead of writing plausible-looking code that
quietly breaks one of the non-negotiables in
[CONTRIBUTING.md](../../CONTRIBUTING.md) — most of which (RLS forced vs
merely enabled, an outbox emit outside its transaction, a bare id leaking
into a response) look completely fine on a casual read and only fail under
an actual Postgres connection or an actual cross-tenant request.

## The library

**Getting started**

| Skill           | Use it when                                                                |
| --------------- | -------------------------------------------------------------------------- |
| [setup](setup/) | first time on the repo — one command brings up the whole local environment |

**Building**

| Skill                                   | Use it when                                                                            |
| --------------------------------------- | -------------------------------------------------------------------------------------- |
| [new-module](new-module/)               | adding a new entity/CRUD resource (`add a deals module`)                               |
| [add-migration](add-migration/)         | any schema change — checks RLS against the live database, not the SQL text             |
| [contracts-change](contracts-change/)   | adding/changing a request or response shape in `@crm/contracts`                        |
| [rbac-permission](rbac-permission/)     | adding or gating a route behind a new permission                                       |
| [outbox-event](outbox-event/)           | a change needs to trigger a side effect                                                |
| [worker-job](worker-job/)               | work that shouldn't block an HTTP request — queues, schedules, sweeps                  |
| [provider-adapter](provider-adapter/)   | integrating a vendor API behind a port (BSP, gateway, SMS)                             |
| [webhook-handler](webhook-handler/)     | receiving inbound webhooks safely                                                      |
| [frontend-api-call](frontend-api-call/) | calling the API from `apps/web` or `apps/partner`                                      |
| [help-docs-sync](help-docs-sync/)       | **after every screen, and after a pull**: write the Help guide, draft the missing ones |

**Deciding and verifying**

| Skill                                                 | Use it when                                                                                                              |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| [pre-pr](pre-pr/)                                     | before opening a PR — runs the same checks as CI, locally                                                                |
| [wadesk-playwright-parity](wadesk-playwright-parity/) | **after every feature, automatically**: Playwright twin test against the running WaDesk, fix sub-agents for what differs |

**Mobile app** (`apps/mobile`, see [docs/mobile](../../docs/mobile/README.md))

| Skill                                                 | Use it when                                                                         |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [mobile-setup](mobile-setup/)                         | first time on the mobile app: toolchain, `.env`, first development build            |
| [mobile-feature-port](mobile-feature-port/)           | **any unit of mobile work**: bringing a product feature to the app; chains the rest |
| [mobile-new-screen](mobile-new-screen/)               | adding a route and screen                                                           |
| [mobile-api-call](mobile-api-call/)                   | fetching or sending data from the app                                               |
| [mobile-auth-session](mobile-auth-session/)           | sign-in, tokens, sign-out, account gates, deep links                                |
| [mobile-i18n-sync](mobile-i18n-sync/)                 | **after any mobile text change**: all 21 locales                                    |
| [mobile-native-capability](mobile-native-capability/) | camera, push, files, biometrics, a permission, a native library                     |
| [mobile-test](mobile-test/)                           | unit, component and Maestro tests                                                   |
| [mobile-quality-review](mobile-quality-review/)       | before a PR: accessibility, performance, security, store policy                     |
| [mobile-pre-pr](mobile-pre-pr/)                       | the mobile gate, same checks as CI                                                  |
| [mobile-release](mobile-release/)                     | EAS build, submit, OTA update, rollback                                             |

## Skills call each other

A multi-step task should stay on rails end to end, so skills invoke each
other via the Skill tool rather than just linking. The common chains:

```
"add a deals module"
  new-module ──> add-migration ──> contracts-change ──> rbac-permission
            └──> outbox-event
            └──> pre-pr

"integrate Gupshup"
  provider-adapter ──> webhook-handler ──> worker-job
                  └──> pre-pr

"add a field to the contact API"
  contracts-change ──> add-migration (if the column is new)
                  └──> frontend-api-call
                  └──> pre-pr
```

```
"add the inbox list to the app"
  mobile-feature-port ──> mobile-new-screen ──> mobile-api-call ──> mobile-i18n-sync
                     └──> mobile-test ──> mobile-quality-review ──> mobile-pre-pr
                     └──> (contracts-change / new-module if the API is missing something)
```

When a skill says **"invoke the X skill"**, do it — that's what keeps a
four-step task from drifting on step three.

## Why scripts, not just prose

Where a rule is mechanically checkable — RLS actually enabled and forced on a
live table, a permission key actually registered, the CI gate actually passing — the skill runs a script against real
state instead of asking the agent to reason about whether it _should_ be
true. `add-migration`'s `check-rls.sh` exists because "I added the policy" and
"the policy actually blocks a cross-tenant query" are different claims, and
only the second one matters.

None of these scripts auto-fix anything. They report; the fix still takes
judgment.

## Adding a new one

Same shape as the others: `SKILL.md` with a **pushy** description (name the
exact phrases that should trigger it, don't make the agent guess), a
`scripts/` folder only if there's something worth actually checking rather
than just explaining, explicit "invoke the X skill" links to whatever it
chains into, and every command in the skill body should be something you've
personally run against this repo — not something that looks like it should
work. Then add it to the tables above.
