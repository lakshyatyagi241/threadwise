# Saved replies API (TW-TIB1-024)

The workspace's library of reusable replies behind the inbox composer's `/` picker and Settings > Data and customization > Saved
replies. Code: `apps/api/src/modules/team-inbox-conversations/saved-replies/`, contracts in
`packages/contracts/src/team-inbox-conversations/saved-replies.ts`, table `saved_replies` (migrations 20261001102600,
20261014100300, 20261121090000). Wiring: [wiring/saved-replies.md](../threadwise-port/wiring/saved-replies.md). Parity:
[parity/team-inbox-conversations.md](../threadwise-port/parity/team-inbox-conversations.md).

All routes are under `/v2/inbox/saved-replies`, for staff users only, errors are problem+json with a stable `code`, every
mutation takes an `Idempotency-Key`.

| Method and path       | Permission                                              | What                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /`               | `inbox.conversation.reply` or `inbox.savedreply.manage` | Shared replies plus the caller's own personal ones, most used first. Query: `q` (shortcut, title, body; a leading `/` is ignored), `scope` (`all`, `shared`, `mine`), `channelKind`, `category`, `limit` (1 to 100, default 50), `cursor`. Answers `data`, `page`, `counts {all, shared, mine}`, `categories`, `total` (every reply of the workspace, what the plan counts) and `limit` (the plan cap, null = unlimited) |
| `POST /`              | `inbox.savedreply.manage`                               | Create. Body `shortcut`, `title`, `body`, `category?`, `language?`, `channelKinds?`, `scope` (`shared` default, `mine`). 201                                                                                                                                                                                                                                                                                             |
| `GET /:id`            | reply or manage                                         | One reply (a colleague's personal reply is 404)                                                                                                                                                                                                                                                                                                                                                                          |
| `PATCH /:id`          | reply or manage, then per row                           | Any subset of the fields with the `rowVersion` read. The scope cannot change                                                                                                                                                                                                                                                                                                                                             |
| `DELETE /:id`         | reply or manage, then per row                           | 204                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `POST /:id/duplicate` | `inbox.savedreply.manage`                               | Same scope and owner, title `(copy)`, first free `_2`, `_3` shortcut. 201                                                                                                                                                                                                                                                                                                                                                |
| `POST /:id/use`       | `inbox.conversation.reply`                              | Body `{ conversationId }`. Fills the variables for that conversation, counts the use, sends nothing                                                                                                                                                                                                                                                                                                                      |

## Rules

- **Shortcut**: stored without the slash, lower case, spaces and hyphens as `_`, letters and digits of any script, at most 64
  characters (`Thank You` is `thank_you`). Unique per workspace and owner: one shared reply per shortcut, one personal reply per
  person per shortcut, so a personal reply may reuse a shared shortcut. A clash is `409 SAVED_REPLY_SHORTCUT_TAKEN`.
- **Text**: title up to 128, body up to 4000 characters, category up to 64. Plain text with WhatsApp's markup (`*bold*`); never
  HTML, never rendered as HTML. Control characters are refused.
- **Who**: reading and using need the right to reply (the composer) or to manage; creating needs `inbox.savedreply.manage` for
  shared and personal alike (as in Reference); a shared reply is changed or deleted only with that right (`403
SAVED_REPLY_NOT_EDITABLE` otherwise), a personal reply by its owner. `canEdit` on each row says what the caller may do.
- **Plan**: the `saved_replies` limit counts every reply of the workspace, personal ones included; 0 or no limit is unlimited.
  Create and duplicate past it are `422 PLAN_LIMIT_REACHED` with the usual `limit`, `used`, `limitValue` and `upgradeUrl` details.
- **Channel restriction**: `channelKinds` empty means every channel. `use` on another kind is `422 SAVED_REPLY_CHANNEL_MISMATCH`.
- **Use**: needs a conversation the caller can see (else `404 CONVERSATION_NOT_FOUND`) and the right to reply to it. Counting a use
  does not change `rowVersion` or `updatedAt`, so an open edit dialog stays valid.
- **Audit and events**: module `saved_replies` (insert, update, delete); outbox `inbox.saved_reply.created`, `.updated`, `.deleted` with
  `savedReplyId`, `shortcut`, `scope`. A use is not audited (it is a counter).

## Variables

`{{name}}`, with spaces allowed inside, dotted spellings (`contact.first_name`, `agent.name`) and the merge-tag aliases
(`full_name` is `name`). Contact values and custom attributes come from the same resolver as templates and broadcasts
(`crm/attributes/merge-tags.ts`); catalogue in `SAVED_REPLY_VARIABLES`:

| Group        | Keys                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------ |
| Contact      | `first_name`, `last_name`, `name`, `email`, `phone`, and any custom attribute key          |
| You          | `agent_name`, `agent_first_name`                                                           |
| Workspace    | `workspace_name`, `company_name`, `today`                                                  |
| Conversation | `device_name` (the channel's name), `device_phone` (its number, when it is a phone number) |

A variable with no value (`reason: "empty"`) or no such variable (`"unknown"`) is left exactly as written in `text` and listed in
`issues`; it is never dropped and never replaced by an empty string. A thread without a contact falls back to the name the customer
writes under for `name` and `first_name`. The values are inserted as text; a value is not searched for further variables.

## Errors

`SAVED_REPLY_NOT_FOUND` (404), `SAVED_REPLY_SHORTCUT_TAKEN` (409), `SAVED_REPLY_NOT_EDITABLE` (403), `SAVED_REPLY_CHANNEL_MISMATCH`
(422), plus `ROW_VERSION_CONFLICT`, `PLAN_LIMIT_REACHED`, `VALIDATION_FAILED`, `CONVERSATION_NOT_FOUND`, `FORBIDDEN`.
