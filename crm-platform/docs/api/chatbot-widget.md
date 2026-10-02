# Chatbot widget API (WGT)

Website chat bubble: an embeddable script, a public chat page and visitor endpoints, and the admin API behind `/chatbot-widgets`.
Contracts: `packages/contracts/src/chatbot-widget/widget.ts`. Module: `apps/api/src/modules/chatbot-widget`.

## Admin (`/v2/widgets`, bearer token, problem+json errors)

Every mutation takes `Idempotency-Key`. Ids are uuids. Keys: `wgt.widgets.read|create|update|delete` (the Admin preset holds all).

| Method and path                       | Key    | Notes                                                                                                                                     |
| ------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v2/widgets?limit&cursor&status` | read   | `{ data, page, stats: {total, active, visitors}, planLocked }`; newest first, 20 per page; `stats` ignores the filter.                    |
| `GET /v2/widgets/assistants`          | read   | `{ data: [{id, name}], planLocked }`: active smart agents by name (the builder picker).                                                   |
| `GET /v2/widgets/:id`                 | read   | The widget as the builder edits it (all fields, `embedToken`, `embedUrl`, `previewUrl`, `rowVersion`).                                    |
| `POST /v2/widgets`                    | create | Whole form. 201 with the widget. 422 `WGT_ASSISTANT_REQUIRED` (mode ai/both without `assistantId`), 422 `WGT_ASSISTANT_NOT_IN_WORKSPACE`. |
| `PATCH /v2/widgets/:id`               | update | Whole form + `rowVersion`. 409 `ROW_VERSION_CONFLICT`; unknown id 404 (never creates). Slug and token never change.                       |
| `PATCH /v2/widgets/:id/status`        | update | `{ status: active\|paused, rowVersion }`.                                                                                                 |
| `POST /v2/widgets/:id/duplicate`      | create | 201; name `<name> (copy)`, new token, caller as author, paused stays paused.                                                              |
| `POST /v2/widgets/:id/rotate-token`   | update | `{ embedToken, embedUrl, previewUrl, rowVersion }`; the old token is dead at once.                                                        |
| `DELETE /v2/widgets/:id`              | delete | 204. Hard delete: visitors cascade, conversations and contacts stay.                                                                      |

Example create (whatsapp mode):

```json
{
  "name": "Pricing page",
  "mode": "whatsapp",
  "position": "bottom_right",
  "buttonColor": "#075E54",
  "headerTitle": "Chat with us",
  "headerBg": "#075E54",
  "headerTextColor": "#FFFFFF",
  "messageBubbleColor": "#FFFFFF",
  "messageTextColor": "#222222",
  "bodyBgKind": "color",
  "bodyBgColor": "#ECE5DD",
  "buttonLabel": "Send message",
  "actionButtonBg": "#075E54",
  "actionButtonTextColor": "#FFFFFF",
  "targetWhatsappCc": "+91",
  "targetWhatsappNumber": "9876543210"
}
```

`allowedDomains` (optional, max 50): trimmed, lower-cased, scheme and path stripped, de-duplicated; omitted on update keeps the stored list.
Every write has an audit row (`chatbot_widgets`) and an outbox event (`widget.created|updated|status_changed|token_rotated|deleted`).

## Public (no sign-in, not versioned, `{ ok, error }` JSON errors)

The token (48 characters, `[A-Za-z0-9]{16,80}` accepted by the route) is the only credential. The organization is found through the
SECURITY DEFINER function `wgt_widget_lookup(token)`; everything after runs in that organization's tenant transaction.

| Route                                    | Notes                                                                                                                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /widget/:token/embed` (`/embed.js`) | `application/javascript`, `Cache-Control: no-cache, must-revalidate`. 404 (still JavaScript, a comment) for unknown, paused, deleted or rotated tokens.                   |
| `GET /widget/:token/chat`                | The iframe document. No frame-blocking headers. 404 plain text "Widget not found".                                                                                        |
| `GET /widget/:token/api/config`          | Appearance, intake flags, `whatsapp_url`, visitor, last 200 messages. Creates the visitor, sets cookie `wgt_vid_<widget uuid>` once. 120/min.                             |
| `POST /widget/:token/api/message`        | `{ body (1..8000), name?, email?, phone?, visitor_uuid? }` -> `{ ok, inbound: {id}, reply: {id, body, at} \| null }`. 422 in Laravel's `{message, errors}` shape. 60/min. |
| `GET /widget/:token/api/history?since`   | Outbound lines newer than `since` (a person's inbox reply reaches the visitor here, polled every 4 s). 120/min, shares the message counter.                               |

Visitor id order: cookie, `X-Visitor-UUID` header, `visitor_uuid` query or body. It must belong to this widget; an unknown or foreign uuid is replaced by a new server-made one. `id` values in
the public responses are message sequence numbers used as a cursor, not entity ids.

Origin allow-list: no `Origin` skips the check; an empty list allows all; otherwise host[:port] must equal an entry (no wildcards, `www.` differs). Denied: 403 `cors_origin_denied`.
The widget's own host is always allowed. (A cross-origin `OPTIONS` preflight is answered by the global CORS middleware, not per widget.)

Environment: `WIDGET_PUBLIC_BASE_URL` (optional, else the request host / `APP_URL`), `WGT_AI_{OPENAI,MISTRAL,DEEPSEEK,GROQ}_API_KEY` and `_BASE_URL`, `WGT_AI_ANTHROPIC_API_KEY`, `WGT_AI_GEMINI_API_KEY`.
Without a key the assistant's fallback message is the reply (WaDesk: empty provider reply).

## Inbox hand-off seam

The widget writes `conversations` (`channel='chatbot_widget'`, `origin='web'`, `platform='WIDGET'`), `inbox_messages` and a `contacts` row through `_shims/sql-inbox-gateway.ts`
until the team inbox and contacts domains export services. An outbound `inbox_messages` row in the visitor's conversation reaches the visitor on the next poll; one not
written by the widget's own bot silences the AI for that thread.
