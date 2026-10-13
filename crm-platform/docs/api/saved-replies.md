# Saved replies API (TW-TIB1-024)

The workspace's library of reusable replies behind the inbox composer's `/` picker and Settings > Data and customization > Saved
replies. Code: `apps/api/src/modules/team-inbox-conversations/saved-replies/`, contracts in
`packages/contracts/src/team-inbox-conversations/saved-replies.ts`, table `saved_replies` (migrations 20261001102600,
20261014100300, 20261121090000). Wiring: [wiring/saved-replies.md](../threadwise-port/wiring/saved-replies.md). Parity:
[parity/team-inbox-conversations.md](../threadwise-port/parity/team-inbox-conversations.md).

All routes are under `/v2/inbox/saved-replies`, for staff users only, errors are problem+json with a stable `code`, every
mutation takes an `Idempotency-Key`.

| Method and path       | Permission                                              | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /`               | `inbox.conversation.reply` or `inbox.savedreply.manage` | Shared replies plus the caller's own personal ones, most used first. Query: `q` (shortcut, title, body; a leading `/` is ignored), `scope` (`all`, `shared`, `mine`), `channelKind`, `category`, `limit` (1 to 100, default 50), `cursor`. Answers `data`, `page`, `counts {all, shared, mine}`, `categories`, `total` (every reply of the workspace, what the plan counts) and `limit` (the plan cap, null = unlimited)                                                                                       |
| `POST /`              | `inbox.savedreply.manage`                               | Create. Body `shortcut`, `title`, `body`, `category?`, `language?`, `channelKinds?`, `scope` (`shared` default, `mine`). 201                                                                                                                                                                                                                                                                                                                                                                                   |
| `GET /:id`            | reply or manage                                         | One reply (a colleague's personal reply is 404)                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `PATCH /:id`          | reply or manage, then per row                           | Any subset of the fields with the `rowVersion` read. The scope cannot change                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `DELETE /:id`         | reply or manage, then per row                           | 204                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `POST /:id/duplicate` | `inbox.savedreply.manage`                               | Same scope and owner, title `(copy)`, first free `_2`, `_3` shortcut. 201                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `GET /export`         | `inbox.savedreply.manage`                               | The SHARED replies as CSV: `title, shortcut, body, category, language, channel` (channel kinds joined with `\|`, empty = every channel). Every text cell is formula-safe (a leading `= + - @` gets an apostrophe; the import removes it, so a reply that starts with a dash survives a round trip). Personal replies are never exported                                                                                                                                                                        |
| `POST /import`        | `inbox.savedreply.manage`                               | Multipart `file` (CSV or TXT, up to 1 MB and 1,000 rows, UTF-8 or Windows-1252) and `options` JSON `{ duplicatePolicy: skip \| overwrite, dryRun }`. Always creates or updates SHARED replies. 200 with `{ dryRun, duplicatePolicy, totals { rows, create, update, skip, invalid }, rows[], rowsTruncated, plan { limit, used, remaining } }`; `rows` lists the rows that are not a plain create, problems first (up to 200). 422 `SAVED_REPLY_IMPORT_INVALID` for a file that cannot be read as saved replies |
| `POST /:id/use`       | `inbox.conversation.reply`                              | Body `{ conversationId }`. Fills the variables for that conversation, counts the use, sends nothing                                                                                                                                                                                                                                                                                                                                                                                                            |

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

## Import and export (CSV)

- **Columns**: `title`, `shortcut`, `body` are required in the header (any order, any case); `category`, `language` and `channel` are
  optional. A byte-order mark is fine.
- **Per row**: the shortcut is normalised like a typed one; a row is `invalid` with one reason (`missing_shortcut`,
  `shortcut_invalid`, `missing_title`, `title_too_long`, `missing_body`, `body_too_long`, `control_characters`, `category_too_long`,
  `language_invalid`, `channel_unknown`, `duplicate_in_file`, `plan_limit_reached`). A bad row never stops the others.
- **Duplicates**: a shortcut a shared reply already uses is `skip` (the reply stays) or, with `overwrite`, `update` (title, text,
  category, language and channels are replaced; the use count and the shortcut stay). A shortcut repeated in the file is
  `duplicate_in_file` from its second row on. A personal reply of the same shortcut is not a clash.
- **Plan**: the `saved_replies` limit counts every reply of the workspace; the rows past it are `plan_limit_reached` and nothing else is
  affected. An overwrite does not add to the count.
- **Dry run**: `dryRun: true` reads everything and writes nothing; the answer is what a real run would do (the web screen requires a
  check before it offers the import). A real import is one transaction with an audit row and an `inbox.saved_reply.created|updated`
  event per reply.

## AI agents (`use_saved_replies`)

`AgentSavedRepliesService.promptSection(orgId, { id | uuid })` (module `ai-agents-training`) is the consumer of
`ai_agents.use_saved_replies`: with the flag on it returns the section of the agent's system prompt that carries the most used
SHARED replies (never personal ones, read through `SharedSavedRepliesReader`), as `- Title: first 280 characters`, at most 15 replies
and 4,000 characters. A reply with a variable that cannot be filled for the whole workspace (anything but `workspace_name`,
`company_name` and `today`) is left out, never shown with its braces. Flag off, unknown agent or another workspace's agent: an empty
string. The inbox AI agent reply loop (TW-AIAG-017) is not in this repo yet; it appends this section to its prompt.
