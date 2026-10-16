# Wiring map: ai-copilot-lead-finder (AICRM), AI CRM Copilot slice

Read with [the inventory entry](../inventory/ai-copilot-lead-finder.md). `built` = in this repo and tested;
`blocked:<what>` = not in this slice; `owned:<domain>` = another domain's. This file covers TW-AICRM-001 to 011,
015, 016. TW-AICRM-012/013/014 are `blocked` (no Briefs or Projects domain; no inbound-pipeline bridge). Lead Finder
(the domain's other feature) is out of scope entirely — not referenced below.

## Route, permission, plan

| Id             | What            | Where                                                                                                                                     |
| -------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| WIRE-AICRM-001 | Screen          | `/ai-crm` chat page in `apps/web/src/app/(app)/(ai-copilot-lead-finder)/ai-crm/`; feature `apps/web/src/features/ai-copilot-lead-finder/` |
| WIRE-AICRM-002 | API             | `/v2/ai-crm/*` in `apps/api/src/modules/ai-copilot-lead-finder/ai-crm.controller.ts` (message, reset, settings)                           |
| WIRE-AICRM-003 | Permission keys | `aicrm.copilot.use` (chat), `aicrm.copilot.manage` (the WhatsApp-channel toggle); migration `<ts>_aicrm_permissions.sql`                  |
| WIRE-AICRM-004 | Plan gate       | `@RequirePlanFeature('ai_crm_copilot')` on the controller (new key; Reference `access_ai_agents`)                                         |
| WIRE-AICRM-005 | Menu entry      | nav entry `ai-crm` under Automation/AI, gated by `aicrm.copilot.use` + the plan feature                                                   |
| WIRE-AICRM-006 | Help            | `features/ai-copilot-lead-finder/help/ai-crm.md`                                                                                          |

## Tables

| Id             | Table                                   | Notes                                                                                                                    |
| -------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| WIRE-AICRM-007 | `ai_crm_actions`                        | written by this slice on every tool call (read or write); forced RLS on `org_id`                                         |
| WIRE-AICRM-008 | `workspace_settings.wa_copilot_enabled` | pre-existing column (unwired, from an earlier unrelated migration); this slice is the first reader/writer (TW-AICRM-015) |
| WIRE-AICRM-009 | `ai_token_usage`                        | written via `AiTokenMeter.record` (AI-keys-usage-admin's table), not owned here                                          |

## Upstream (what feeds the data) and downstream (what reads it)

| Id             | Reader or feeder                                                                                                                                   | What it does                                                                                                                                | State                                |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| WIRE-AICRM-010 | `ai-keys-usage-admin` `AiKeyResolver`/`AiTokenMeter`                                                                                               | resolves the workspace's AI provider/key for each turn; meters tokens against the platform cap when billed to the admin key                 | built (reused, not duplicated)       |
| WIRE-AICRM-011 | `crm` `ContactsService`/`CompaniesService`/`DealsService`/`PipelinesService`/`TasksService`/`InvoicesService`/`PaymentsService`/`SalesDocsService` | every write/read tool calls these application services directly (never their repositories), so RBAC/audit/outbox stay intact                | built (orchestrated, not duplicated) |
| WIRE-AICRM-012 | `workspaces-teams-tenancy` `MembersService`                                                                                                        | resolves an "assignee/owner by name" argument to a member uuid before calling a CRM service that takes a uuid                               | built                                |
| WIRE-AICRM-013 | `chat-conversations` `InboxThreadService`/`OutboundService`                                                                                        | `send_message`/`send_quote` tools open a conversation and enqueue a message through the same path the inbox UI itself uses                  | built                                |
| WIRE-AICRM-014 | `plans-subscriptions-trials` catalogue                                                                                                             | new `ai_crm_copilot` plan-feature key                                                                                                       | built                                |
| WIRE-AICRM-015 | WhatsApp staff-channel bridge (inbound pipeline)                                                                                                   | nothing reads `wa_copilot_enabled` yet — TW-AICRM-014, blocked                                                                              | blocked:runtime bridge               |
| WIRE-AICRM-016 | Briefs / Projects domains                                                                                                                          | `generate_brief`/`create_project`/`list_projects` tools are not registered at all — neither domain exists                                   | blocked:no domain                    |
| WIRE-AICRM-017 | Plan retention, workspace delete, data wipe                                                                                                        | `ai_crm_actions` should be listed wherever other per-workspace audit/log tables are purged on data-wipe; not yet checked against this slice | open                                 |
| WIRE-AICRM-018 | Mobile app, developer REST API v1                                                                                                                  | no AI-CRM endpoint in either; out of scope for this slice (chat is a staff-desktop surface)                                                 | none                                 |
