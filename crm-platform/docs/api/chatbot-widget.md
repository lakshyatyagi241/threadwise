# Chatbot widget API (WGT)

Website chat bubble: an embeddable script, a public chat page and visitor endpoints, and the admin API behind `/v2/widgets`.
Contracts: `packages/contracts/src/chatbot-widget/{widget,launcher}.ts`. Module: `apps/api/src/modules/chatbot-widget`.
Behaviour follows Reference exactly, quirks included (see `docs/threadwise-port/parity/chatbot-widget.md`); the WhatsApp launcher (`launcher`) is the one user-requested addition.

## Admin (`/v2/widgets`, bearer token, problem+json errors)

Every mutation takes `Idempotency-Key`. Ids are uuids. Keys: `wgt.widgets.read|create|update|delete` (the Admin preset holds all). The plan flag `chatbot_widgets`
(plan catalogue) gates every admin call: when the plan lacks it, writes are 422 `PLAN_FEATURE_LOCKED` and the list and the assistant picker answer with `planLocked: true`.
The public routes ignore the plan and the widget limit is never enforced, as in Reference.

| Method and path                  | Key    | Notes                                                                                                                                                                        |
| -------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v2/widgets?limit&cursor`   | read   | `{ data, page, stats: {total, active, visitors}, planLocked }`; newest first, 20 per page. There is no status filter (Reference's status views do nothing).                      |
| `GET /v2/widgets/assistants`     | read   | `{ data: [{id, name}], planLocked }`: active smart agents by name (the builder picker).                                                                                      |
| `GET /v2/widgets/:id`            | read   | The widget as the builder edits it (all fields, `launcher`, `embedToken`, `embedUrl`, `previewUrl`, `rowVersion`).                                                           |
| `POST /v2/widgets`               | create | Whole form. 201 with the widget. 422 `WGT_ASSISTANT_REQUIRED` (mode ai/both without `assistantId`), 422 `WGT_ASSISTANT_NOT_IN_WORKSPACE`.                                    |
| `PATCH /v2/widgets/:id`          | update | Whole form + `rowVersion`. 409 `ROW_VERSION_CONFLICT`. QUIRK: an id that is not in the workspace creates a NEW widget instead of answering 404. Slug and token never change. |
| `POST /v2/widgets/:id/duplicate` | create | 201; name `<name> (copy)` (not truncated), new token, the ORIGINAL author is kept, paused stays paused.                                                                      |
| `POST /v2/widgets/:id/rotate-token` | update | `{ embedToken, embedUrl, previewUrl, rowVersion }`; the old token is dead at once.                                                                                         |
| `DELETE /v2/widgets/:id`         | delete | 204. Hard delete: visitors cascade, conversations and contacts stay.                                                                                                         |

There is no status endpoint: nothing in Reference can pause a widget (the column exists, no screen or route sets it).

Example create (whatsapp mode, with the launcher):

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
  "targetWhatsappNumber": "9876543210",
  "prefilledMessage": "Hi there",
  "launcher": {
    "buttonType": "pill",
    "colour": "blue-lagoon",
    "avatar": "preset:store",
    "greeting": "HI THERE!",
    "introMessage": "We are here to help you!",
    "desktop": { "side": "right", "sideSpacing": 10, "bottomSpacing": 10 },
    "mobile": { "side": "right", "sideSpacing": 10, "bottomSpacing": 60 }
  }
}
```

`allowedDomains` (optional, max 50): trimmed, lower-cased, scheme and path stripped, de-duplicated; omitted on update keeps the stored list. A blank entry is 422 (as Reference).
Colours are free text up to 16 characters (no format check on the server, as Reference).
Every write has an audit row (`chatbot_widgets`) and an outbox event (`widget.created|updated|token_rotated|deleted`).

### `launcher` (TW-WGT-028, user-requested Interakt reference)

One object, stored in `chatbot_widgets.launcher` (jsonb), the look and placement of the WhatsApp widget. Absent on create: the defaults; absent on update: the stored object is kept.
Every key is optional (a missing key takes its default; unknown keys are dropped), so a later option is a new key with a default and needs no migration.

| Key                                  | Values                                                                                                | Default                                              |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `buttonType`                         | `pill` (Chat With Us) or `icon` (round)                                                               | `pill`                                               |
| `colour`                             | preset key (`original`, `teal-deal`, `green-lime`, `blue-lagoon`, `red-cherry`, `orange-sunset`, `yellow-sand`, `pink-margarita`, `navy-suit`, `purple-velvet`, `silver-spoon`, `dark-night`) or `#rgb` / `#rrggbb` | `original`                  |
| `avatar`                             | `preset:support`, `preset:store`, `preset:chat`, `preset:person`, or an http(s) image address (up to 1024) | `preset:support`                                |
| `greeting`                           | 1 to 60 characters                                                                                    | `HI THERE!`                                          |
| `introMessage`                       | 1 to 500 characters                                                                                   | `We are here to help you! Chat with us on WhatsApp for any queries.` |
| `desktop`, `mobile`                  | `{ side: left\|right, sideSpacing: 0..500, bottomSpacing: 0..500 }` (whole pixels)                    | desktop right 10/10, mobile right 10/60              |

Errors are 422 `VALIDATION_FAILED` with the field path (for example `launcher.desktop.sideSpacing`).

## Public (no sign-in, not versioned, `{ ok, error }` JSON errors)

The token (48 characters, `[A-Za-z0-9]{16,80}` accepted by the route) is the only credential. The organization is found through the
SECURITY DEFINER function `wgt_widget_lookup(token)`; everything after runs in that organization's tenant transaction.

| Route                                    | Notes                                                                                                                                                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /widget/:token/embed` (`/embed.js`) | `application/javascript`, `Cache-Control: no-cache, must-revalidate`. 404 (still JavaScript, a comment) for unknown, paused, deleted or rotated tokens. `ai` and `both`: the frame loader. `whatsapp`: draws the launcher and the messenger panel itself (Start Conversation opens the `wa.me` link in a new tab; mobile placement at 768 px and below). |
| `GET /widget/:token/chat`                | The iframe document. No frame-blocking headers. 404 plain text "Widget not found".                                                                                                                     |
| `GET /widget/:token/api/config`          | Appearance, intake flags, `whatsapp_url`, `launcher` (resolved colour ends, image, texts, both placements), visitor, the OLDEST 200 messages. Creates the visitor, sets cookie `wgt_vid_<widget uuid>`. Not throttled. |
| `POST /widget/:token/api/message`        | `{ body (1..8000), name?, email?, phone?, visitor_uuid? }` -> `{ ok, inbound: {id}, reply: {id, body, at} \| null }`. 422 in Laravel's `{message, errors}` shape. 60 a minute.                           |
| `GET /widget/:token/api/history?since`   | Outbound lines newer than `since` (polled every 4 s). 120 a minute. Ignores the widget status and creates visitors (as Reference).                                                                        |

The two throttled routes share ONE counter per client address, across every widget (as Reference's guest throttle); the limit applied is the called route's. Over the limit: 429 `Too Many Attempts.`

Visitor id order: cookie, `X-Visitor-UUID` header, `visitor_uuid` query or body. It must belong to this widget; an unknown or foreign uuid is replaced by a new server-made one. `id` values in
the public responses are message sequence numbers used as a cursor, not entity ids.

Origin allow-list: no `Origin` skips the check; an empty list allows all; otherwise host[:port] must equal an entry (no wildcards, `www.` differs). Denied: 403 `cors_origin_denied`.
QUIRK (as Reference): the widget's own host is NOT implicitly allowed, so a non-empty list that names only customer sites also blocks the chat page's own posts.

AI: the assistant answers the FIRST message of a conversation only (any outbound row counts as a human takeover; as Reference). The prompt history includes the current message.

Environment: `WIDGET_PUBLIC_BASE_URL` (optional, else the request host / `APP_URL`), `WGT_AI_{OPENAI,MISTRAL,DEEPSEEK,GROQ}_API_KEY` and `_BASE_URL`, `WGT_AI_ANTHROPIC_API_KEY`, `WGT_AI_GEMINI_API_KEY`.
Without a key the assistant's fallback message is the reply (Reference: empty provider reply).

## Inbox hand-off seam

The widget writes `conversations` (`channel='chatbot_widget'`, `origin='web'`, `platform='WIDGET'`), `inbox_messages`, the opening line into the legacy `messages` table, and a `contacts` row through
`_shims/sql-inbox-gateway.ts` until the team inbox and contacts domains export services. An outbound `inbox_messages` row in the visitor's conversation reaches the visitor on the next poll.
