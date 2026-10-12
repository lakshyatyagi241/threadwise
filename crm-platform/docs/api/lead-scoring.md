# API: lead scoring (AI)

A product extension: Reference only stores a hand-typed `lead_score`; scoring a contact with an AI model is new. Base path `/v2`.
Errors are `application/problem+json` with a stable `code` and a `requestId`; the codes this adds are `LSC_PLATFORM_DISABLED`,
`LSC_NOT_ENABLED`, `LSC_NO_KEY`, `LSC_PROVIDER_FAILED` and `LSC_MANUAL_SCORE` in `@crm/contracts` `lead-scoring/errors.ts`. Shapes live in
`packages/contracts/src/lead-scoring/`. Every id on the wire is a uuid.

## How it works

1. **Three things must be true** before a contact is scored: the platform switch is on (operator), the workspace opted in (it is off by
   default: contact facts go to an AI vendor), and a key resolves (the workspace's own OpenRouter key, else the platform's). Otherwise
   the Score button answers 422 with the code that says which, and background work does nothing (or logs a `skipped` row when it is a
   problem the workspace should see: no key, token allowance, hourly limit).
2. **What the model sees is anonymised**: stage, status, source, channel, title, language, country, whether an email and phone exist, a
   business/free email kind, company name, tags, up to 15 short custom properties, days since created and last activity, deal counts and
   open deal value. Never the name, email address, phone number or message text.
3. **The scorer never overwrites a person's score.** A score typed (or imported, or created with the contact) has `leadScoreSource:
"manual"` and is left alone; a contact with no score, or one the scorer wrote (`"ai"`), is scored. Typing a score over an AI score
   takes it over and drops the AI's reasons; clearing a typed score (`leadScore: null`) hands the contact back to the scorer. The write
   is guarded in the SQL statement itself, so a score typed a moment earlier wins a race (the call is then logged as `kept`).
4. **Automatic scoring**: `contact.created`, `contact.updated` and `contact.stage_changed` are consumed in the worker, which queues one
   job per contact (20 s delay, deduplicated per contact: ten edits in a burst are one score). The queue (`lsc-score`) calls the vendor
   with no transaction open; a busy vendor is retried (3 attempts), a refused key or an unusable answer is not.
5. **Cost**: every attempt is a row in `lead_scoring_runs` with prompt and completion tokens, `costUsd` (decimal string, 8 decimals),
   `costSource` (`vendor` = the figure OpenRouter reported with `usage: {include: true}`, `estimate` = tokens x the list price,
   `none`), who paid (`billedAgainst`: `admin` = the platform key, `workspace` = its own key) and the duration. Tokens also go to the
   shared `ai_token_usage` ledger, so the plan's monthly AI allowance counts them when the platform key pays. The log is kept for
   `retentionDays` (default 90) and deleted by a daily sweep.

## Capabilities (workspace)

| Key                   | Grants                                          | Presets               |
| --------------------- | ----------------------------------------------- | --------------------- |
| `lsc.runs.read`       | the settings read, the scoring log and its cost | Owner, Admin, Manager |
| `lsc.contacts.score`  | Score one contact now, the backfill             | Owner, Admin, Manager |
| `lsc.settings.manage` | the workspace switch                            | Owner, Admin          |

A contact's own `leadScore`, `leadScoreSource`, `leadScoreReasons`, `leadScoredAt` and `leadScoreModel` come with the contact (any role
that can read contacts).

## Workspace routes

| Method and path                           | Key                   | What                                                                                                                        |
| ----------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `GET /lead-scoring/settings`              | `lsc.runs.read`       | `{enabled, autoScore, platformEnabled, model, keySource, eligibleContacts, scoredContacts, last30d, rowVersion, updatedAt}` |
| `PATCH /lead-scoring/settings`            | `lsc.settings.manage` | `{enabled, autoScore?, rowVersion?}`. First save has no `rowVersion` (the GET says `null`); later saves need it, else 409.  |
| `GET /lead-scoring/runs`                  | `lsc.runs.read`       | cursor pages, newest first; `?contactId=` (uuid), `?status=ok\|kept\|failed\|skipped`, `?limit=` (25, max 100)              |
| `POST /lead-scoring/contacts/:uuid/score` | `lsc.contacts.score`  | scores now (waits for the vendor): `{contactId, score, reasons, model, costUsd, promptTokens, completionTokens}`            |
| `POST /lead-scoring/backfill`             | `lsc.contacts.score`  | `{limit}` (default 500, max 5000): queues contacts with no score; `{queued}`                                                |

Errors of the Score button and the backfill: `422 LSC_PLATFORM_DISABLED`, `422 LSC_NOT_ENABLED`, `422 LSC_NO_KEY`, `422 PLAN_LIMIT_REACHED`
(monthly token allowance on the platform key, or the operator's per-hour limit), `409 LSC_MANUAL_SCORE`, `422 LSC_PROVIDER_FAILED` (key
refused) or `502 LSC_PROVIDER_FAILED` (vendor down or not a score). A contact that is not in the workspace is `404`.

## Operator routes (`/platform/lead-scoring`, super admin only, reads included)

| Method and path                         | What                                                                                                                                                                                                        |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /platform/lead-scoring`            | config (`platformEnabled`, `model`, `scoresPerHour`, `retentionDays`, the model list with prices), `platformKeyReady`, `workspacesEnabled`, `contactsScored`, cost totals for the last 24 hours and 30 days |
| `PATCH /platform/lead-scoring`          | any of `platformEnabled`, `model` (an OpenRouter id), `scoresPerHour` (0 = no limit), `retentionDays` (7 to 730); returns the overview; audited                                                             |
| `GET /platform/lead-scoring/workspaces` | workspaces by 30 day cost: enabled, contacts scored, scores, cost                                                                                                                                           |
| `GET /platform/lead-scoring/runs`       | the log across workspaces with the workspace name; `?workspaceId=`, `?status=`, cursor                                                                                                                      |

The platform switch is OFF until the operator turns it on. Default model `openai/gpt-6-luna-pro` (list price 0.10 USD in / 0.50 USD
out per million tokens, a score is about 0.0001 USD); the picker offers the ones checked against OpenRouter's public models list.

## Known behaviour to be aware of

- Writing a score updates the contact row, so its `updated_at` and `row_version` move (the audit trail records `leadScore` old and new
  under `contacts`). A person with the edit form open sees one version conflict and reloads.
- The score is a hint for a human, not a decision: the reasons are the model's own words about anonymised facts.
