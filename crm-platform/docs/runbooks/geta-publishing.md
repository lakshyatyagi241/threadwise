# Geta publishing: setup and troubleshooting

Publish in the flow builder also pushes the workspace's bot live on the Geta console (see `docs/api/flow-builder-editor.md`, "Geta publishing"). This is
the setup note and what to look at when it does not go live.

## Where the user enters the credentials

Per workspace, in the app: **Settings -> Integrations and developer -> Geta publishing** (`/flows/geta-publishing`). Needs the `flb.geta.manage` key (the Owner
and Admin presets have it). Enter:

| Field               | What to put                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Base URL            | The Geta API address, `https://api-core-sandbox.geta.ai` for the sandbox                                                 |
| Console origin      | Optional, `https://app-sandbox.geta.ai`; sent as `origin` and `referer`                                                  |
| Authorization token | The value of the `authorization` header, exactly as Geta gives it (no `Bearer ` is added)                                |
| geta-host token     | The value of the `geta-host` header                                                                                      |
| Geta chatbot record | The chatbot JSON as it should be sent (the whole request body with a `chatbot` key is accepted); needs `id` and `bot_id` |

Nothing is read from environment variables for these: they are stored encrypted (`CREDENTIALS_ENCRYPTION_KEY`) in `flb_geta_publish_settings`.
The bot id of the `appid` header is the record's `bot_id`. A single flow can carry its own record: `PUT /v2/flows/:id/publish-sync/chatbot`.

## Deployment settings

`GETA_PUBLISH_MODE` must be `live` for a real push (it defaults to `live` only when `NODE_ENV=production`; anywhere else it is `fixture` and nothing is sent).
The worker process makes the calls, so it needs the same value and network access to the Geta API. See `.env.example` for the other `GETA_PUBLISH_*` keys.

## When a flow does not go live

1. Open the flow in the editor: the pill says why (`Failed at configuration update` / `Failed at publish`) and the notice shows the sanitised reason.
2. **Going live... forever**: the worker is not running or the outbox is backed up (`docs/runbooks/outbox-backlog.md`). The event is `flow.geta_publish_requested`;
   `flb_geta_publish_syncs.state = 'pending'` until the worker settles it.
3. **Geta answered 401 / 403**: the tokens expired; paste new ones and Retry.
4. **Geta answered 4xx on the configuration update**: the chatbot record is not what Geta expects; paste the correct record. A 4xx is never retried by the adapter.
5. **Could not reach Geta**: network or base URL; the adapter already tried `GETA_PUBLISH_MAX_ATTEMPTS` times with backoff.
6. Retry (`POST /v2/flows/:id/publish-sync/retry`) continues from the failed step. A flow that reads `live` there is live; Geta's own console is the final word.

```sql
SELECT f.uuid, s.publish_version, s.state, s.step, s.failed_step, s.last_error, s.attempted_at
FROM flb_geta_publish_syncs s JOIN flows f ON f.org_id = s.org_id AND f.id = s.flow_id
WHERE s.state <> 'live' ORDER BY s.updated_at DESC;
```

No secret is ever in `last_error`, the outbox payload or the audit trail; if one is, that is a bug.
