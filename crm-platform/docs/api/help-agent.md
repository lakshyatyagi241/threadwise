# Help assistant API

Everything is under `/v2/help-agent`, signed in as a user. Gates, in this order on every route: sign-in, the permission, the plan feature `help_agent` (422 `PLAN_FEATURE_LOCKED`, reads included), the body. The workspace switch (`help_agent_settings.enabled`, default off) is checked by the services on every call, so turning it off takes effect on the next step of a running task. Operator "act as" sessions get 403 `HELP_AGENT_DISABLED`. Design and threat model: [help-agent-assistant.md](../specs/help-agent-assistant.md).

Write routes take an `Idempotency-Key`. No response ever carries a provider key. Nothing in a request or response of the model route is logged: only ids and token counts.

## Settings

| Method and path | Permission          | What it does                                                                                                                             |
| --------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /settings` | `help.agent.manage` | `{ enabled }` (`false` when the workspace never saved).                                                                                  |
| `PUT /settings` | `help.agent.manage` | `{ enabled }` -> `{ enabled }`. Audited (`help_agent_settings`) when it changes.                                                         |
| `GET /status`   | `help.agent.use`    | `{ available, enabled, canManage, limits: { maxSteps, tasksLeftToday } }`. `available` is `enabled` and no operator acting as the owner. |

## A task

| Method and path          | Permission       | What it does                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------ | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /tasks`            | `help.agent.use` | `{ locale, taskLength, route }` -> `201 { taskId, maxSteps, expiresAt }`. Only the length of the task sentence is sent, never the sentence. 403 `HELP_AGENT_DISABLED` (switch off, or `route` is one of the screens it is off on), 429 `HELP_AGENT_TASK_LIMIT` (3 starts a minute, 40 a day per person, 400 a day per workspace by default). Starting closes the person's earlier unfinished task as `abandoned`. |
| `POST /chat/completions` | `help.agent.use` | OpenAI-compatible request, header `X-Help-Agent-Task: <taskId>`. Answers the OpenAI completion shape (`choices[0].message.tool_calls`, `usage`).                                                                                                                                                                                                                                                                  |
| `POST /tasks/:id/finish` | `help.agent.use` | `{ outcome: completed\|failed\|stopped\|error, steps, confirmedActions, deniedActions }` -> `{ status }`. Writes the one audit event. A second call changes nothing. The step count in the audit event is the server's own count of model calls, not the browser's.                                                                                                                                               |

### What `POST /chat/completions` accepts

Only `messages` (at most 40; roles system, user, assistant, tool; text content), `tools` (at most 16 function tools with plain names, 40,000 characters), and `tool_choice` (`required`, `auto`, `none` or one named function). Everything else is dropped: the model, the output size and the sampling are the server's (`HELP_AGENT_MODEL` or the default model of the platform key, `HELP_AGENT_STEP_MAX_TOKENS` lowered to the vendor's ceiling). `stream: true` is refused. The body may be 512 KiB (its own body-limit class); the messages 120,000 characters.

Errors (problem+json with `code` and `requestId`):

| Status | Code                              | When                                                                                 |
| ------ | --------------------------------- | ------------------------------------------------------------------------------------ |
| 400    | `HELP_AGENT_REQUEST_INVALID`      | No task header, a malformed task id, or a body the sanitiser refuses                 |
| 403    | `HELP_AGENT_DISABLED`             | The workspace switch is off                                                          |
| 404    | `NOT_FOUND`                       | The task is not the caller's own (another person's, another workspace's, or unknown) |
| 409    | `HELP_AGENT_TASK_CLOSED`          | Finished, abandoned, or older than `HELP_AGENT_TASK_MINUTES` (15)                    |
| 422    | `PLAN_FEATURE_LOCKED`             | The plan does not include `help_agent`                                               |
| 422    | `PLAN_LIMIT_REACHED`              | The platform's key pays and the workspace used its monthly AI allowance              |
| 429    | `HELP_AGENT_STEP_LIMIT`           | The task used its model calls (40) or its token allowance (400,000)                  |
| 429    | `RATE_LIMITED`                    | More than 60 calls a minute from the person                                          |
| 502    | `HELP_AGENT_PROVIDER_UNAVAILABLE` | The vendor failed or timed out (its text is never passed on)                         |
| 503    | `HELP_AGENT_PROVIDER_UNAVAILABLE` | No AI key is configured for `HELP_AGENT_PROVIDER`, or no model is known              |

Each answered call writes one `ai_token_usage` row (provider, model, tokens, `billed_against` = the side whose key paid) and adds the tokens to the task.

## Configuration (environment)

`HELP_AGENT_PROVIDER` (`openai` default, `mistral`, `deepseek`, `groq`: vendors that speak the OpenAI dialect with tool calls), `HELP_AGENT_MODEL` (blank = the default model of the platform key row), `HELP_AGENT_BASE_URL` (a gateway or a test stub), `HELP_AGENT_TIMEOUT_MS`, `HELP_AGENT_MAX_STEPS`, `HELP_AGENT_TASK_MINUTES`, `HELP_AGENT_TASK_TOKENS`, `HELP_AGENT_STEP_MAX_TOKENS`, `HELP_AGENT_REQUEST_CHARS`, `HELP_AGENT_TASKS_PER_MINUTE`, `HELP_AGENT_TASKS_PER_USER_DAY`, `HELP_AGENT_TASKS_PER_ORG_DAY`. A bad value stops the boot with a readable message.
