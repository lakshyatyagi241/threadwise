# Wiring map: help-agent (the Help assistant)

A product extension, not a Reference feature (record: [product-extensions.md](../parity/product-extensions.md), "Help assistant"). Spec: [help-agent-assistant.md](../../specs/help-agent-assistant.md). API: [help-agent.md](../../api/help-agent.md). Update this file in the same change as any new route, table, permission, mark or consumer.

## API routes (all `/v2/help-agent`, user actors only, plan feature `help_agent` on the whole controller)

| Method | Path                | Permission          | Notes                                                                                                                                   |
| ------ | ------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/status`           | `help.agent.use`    | `available` = workspace switch on and no operator acting as the owner; throttle `ui-poll`                                               |
| GET    | `/settings`         | `help.agent.manage` | `{ enabled }`                                                                                                                           |
| PUT    | `/settings`         | `help.agent.manage` | `{ enabled }`; audit `help_agent_settings` only when it changes                                                                         |
| POST   | `/tasks`            | `help.agent.use`    | checks switch, screen, caps; 20 a minute per user; returns `taskId`, `maxSteps`, `expiresAt`                                            |
| POST   | `/tasks/:id/finish` | `help.agent.use`    | closes the task, writes the one audit event `help_agent_task`; idempotent                                                               |
| POST   | `/chat/completions` | `help.agent.use`    | the model proxy (OpenAI shape, not streamed); header `X-Help-Agent-Task`; 60 a minute per user; body limit class `help-agent` (512 KiB) |

## Tables read or written

`help_agent_settings` (new, one row per workspace, default off), `help_agent_tasks` (new, one row per task: counts, outcome, tokens), `audit_log` (modules `help_agent_task`, `help_agent_settings`), `ai_token_usage` (one row per model call, through `AiTokenMeter.record`), `admin_ai_keys` / `ai_provider_keys` (read through `AiKeyResolver`), `plans.features` (`help_agent`, read through the entitlement resolver), `permission_defs` / `workspace_preset_baseline` / `role_grants` (new keys). RLS forced on both new tables.

## Permissions

| Key                 | Meaning                                                   | Owner / Admin presets | Other roles |
| ------------------- | --------------------------------------------------------- | --------------------- | ----------- |
| `help.agent.use`    | Open the assistant and let it act on the person's session | yes                   | selectable  |
| `help.agent.manage` | Switch the assistant on or off for the workspace          | yes                   | selectable  |

## Plan feature

`help_agent` (group `aiCalling`, default false). Seeded true for the three demo plans (`starter`, `growth`, `scale`) by the migration and by `seed:auth`. Labels: `plans-subscriptions-trials.features.help_agent`, `auth-registration-security.account.plans.card.chips.help_agent`, `auth-registration-security.platform.plans.editor.featureKeys.help_agent` and `.featureHints.help_agent` (all 21 locales).

## Settings and environment read

| Setting                                                                                            | Where                  | Reader                                             |
| -------------------------------------------------------------------------------------------------- | ---------------------- | -------------------------------------------------- |
| `HELP_AGENT_PROVIDER` (openai, mistral, deepseek, groq), `HELP_AGENT_MODEL`, `HELP_AGENT_BASE_URL` | environment            | `readHelpAgentEnv`, the adapter                    |
| `HELP_AGENT_MAX_STEPS`, `_TASK_MINUTES`, `_TASK_TOKENS`, `_STEP_MAX_TOKENS`, `_REQUEST_CHARS`      | environment            | proxy service                                      |
| `HELP_AGENT_TASKS_PER_MINUTE`, `_PER_USER_DAY`, `_PER_ORG_DAY`                                     | environment            | `HelpAgentService.start`                           |
| Monthly AI allowance (`ai_token_limit_monthly`) and the output ceiling                             | plans, `admin_ai_keys` | `AiTokenMeter.guard`, `AiKeyResolver.capMaxTokens` |
| `help_agent_settings.enabled`                                                                      | database               | `HelpAgentRepository.enabled`                      |

## Web

| Piece                                                              | Where                                                                                                                          |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Launcher, panel, shortcut (Ctrl or Cmd + Shift + L)                | `features/help-agent/components/assistant-root.tsx` (mounted in `app/(app)/layout.tsx`, around the page content)               |
| Help center entry (`/help` card)                                   | `features/help-agent/components/ask-assistant-card.tsx`, slot in `help-home.tsx`                                               |
| Settings tile and screen `/settings/help-assistant`                | `features/help-agent/settings.ts`, `components/settings-screen.tsx`, `app/(app)/(help-agent)/settings/help-assistant/page.tsx` |
| Risk classifier, masker, URL allow-list, step budget, gate, runner | `features/help-agent/lib/`                                                                                                     |
| Guide retrieval and steps                                          | `lib/retrieval.ts`, `lib/steps.ts`, server action `actions.ts`                                                                 |
| Marks other screens put on their elements                          | `lib/agent-marks.ts` (`AGENT_IGNORE`, `AGENT_PII`, `AGENT_RISK_HIGH`)                                                          |
| Library                                                            | `@page-agent/core` and `@page-agent/page-controller`, pinned 1.12.4, loaded by dynamic import on the first task                |

### Every place the marks are used (add a line when you add a mark)

| Mark                | Where                                                                                                                                                            | Why                                     |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `data-agent-ignore` | contact detail timeline (`contact-detail.tsx`), form submission answers (`submissions-screen.tsx`), template bubble body (`wa-bubble.tsx`, `message-bubble.tsx`) | customer or third-party written text    |
| `data-agent-pii`    | form submission list preview (name, e-mail, phone)                                                                                                               | personal data                           |
| `data-agent-risk`   | every `ConfirmDialog` with `tone="danger"` (`packages/ui`)                                                                                                       | always ask before a destructive confirm |

### Screens the assistant is off on

`/inbox` (and everything under it), `/team-chat`, `/support`, `/admin`, `/platform` (one list in `packages/contracts/src/help-agent/routes.ts`, used by the launcher, the navigation guard and `POST /tasks`).

## Upstream feeders and consumers

- Feeds: the plan editor (operator) turns the feature on; the Roles screen grants the two permissions; Settings > Help assistant sets the switch; the platform owner configures the AI key (AI keys screen) and the environment values above.
- Consumes: `ai-keys-usage-admin` (`AiKeyResolver`, `AiTokenMeter`), `plans-subscriptions-trials` (entitlements, `RequirePlanFeature`), `help-center` (index, `getVisibleHelp`), the audit kernel.
- Shown in: the AI usage screen (tokens per call land in `ai_token_usage`), the audit log.

## Not built (recorded, not dropped)

Multi-page memory, saved recipes, Anthropic and Gemini adapters (`HELP_AGENT_PROVIDER` takes OpenAI-compatible vendors only), a report of tasks for the owner, per-plan step caps. The Chrome extension and MCP server of page-agent are not planned.
