# API: contacts PQL (plain English search)

A product extension: Reference has no free-text query builder. Base path `/v2`.

`POST /contacts/pql` with `{ "query": "vip contacts from India not active in 30 days" }` (1 to 500 characters) answers
`{ rules, summary, ignored }`. Needs `record.contacts.read`. `rules` is a segment rule tree (`@crm/contracts` `segments/rules.ts`) or
`null` when nothing could be mapped; pass it, as JSON text, as the `rules` filter of `GET /contacts` (or save it as a segment).
`summary` is one sentence of what was understood; `ignored` lists parts that named something the workspace does not have.

## How it is built

- The AI model gets the query and the workspace's names (tags, groups, owners, lifecycle stages, statuses, filterable custom
  fields), never a contact row. It answers JSON only; the model never writes SQL.
- The answer is validated with `pqlResultSchema` (which embeds `segmentRulesSchema`), then conditions pointing at an id, key or value
  the workspace does not have are dropped (`pql.prune.ts`) and named in `ignored`.
- The existing contacts list compiles the rules, so RLS, owner scope and field permissions apply as for any filter.
- Countries match on the start of the phone number (`phone starts_with +91`): `countryCode` is often empty.

## Key, model, cost

Always on: no workspace switch. The key comes from `AiKeyResolver` (the workspace's own key when its plan allows, else the
platform's `openrouter` key); with none, `422 PQL_NO_KEY`. Platform-key calls go through `AiTokenMeter.guard` and every call is
recorded with `AiTokenMeter.record`. Model: `PQL_MODEL`, default `openai/gpt-oss-120b`. Each user is limited to 30 searches a minute
per API process (`429 PLAN_LIMIT_REACHED`). A provider failure is `502 PQL_PROVIDER_FAILED` (`422` when the key is refused).

## Offline run

`LEAD_SCORING_AI_DRIVER=fixture` (never in production) answers a few fixed phrases: a tag name, `India`, `not active for N days`,
`last N days`. Used by the unit tests and the browser run.
