# Wiring map: saved replies (TW-TIB1-024)

Reference calls them "Quick replies" in the UI and `SavedReply` in code (`reference/app/app/Models/SavedReply.php`,
`TeamInboxController@savedReplies*`, `resources/js/charts/user-team-inbox-index.js` savedRepliesPicker, `team-inbox/index.blade.php`).

| What             | Where                                                                                                                                                                                                                       |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Route (web)      | `/inbox/saved-replies` (nav entry `inbox-saved-replies`, not in the menu, gate `inbox.savedreply.manage`); Settings tile `saved-replies` (Data and customization), shortcut from `/inbox`; the picker in the inbox composer |
| Route (API)      | `/v2/inbox/saved-replies` list, create, `:id` get, patch, delete, `:id/duplicate`, `:id/use` ([docs/api/saved-replies.md](../../api/saved-replies.md))                                                                      |
| Permissions      | `inbox.savedreply.manage` (create, shared edit and delete, duplicate, the screen), `inbox.conversation.reply` (list, use); personal replies are their owner's                                                               |
| Plan             | limit `saved_replies` (`plans.saved_replies_limit`; create and duplicate; counted by `PlanUsageService`, shown in the usage panel and the downgrade check); seeds: Starter 10, Growth 50, Scale unlimited (`seed-auth.ts`)  |
| Tables           | `saved_replies` (adds `created_by`, `language`, `channel_kinds`, `last_used_at`; owner FK now cascades); reads `conversations`, `channels`, `contacts`, `users` for `use`                                                   |
| Upstream feeders | none (agents write the replies); the contact merge-tag resolver (`MergeTagService`), the channel's name and address, the caller's name                                                                                      |
| Downstream       | audit `saved_replies`, outbox `inbox.saved_reply.created/updated/deleted`, `used_count` / `last_used_at` (ordering of the picker and the list), plan usage panel, retention (`plan-retention.service.ts` lists the table)   |

## Reference behaviour, every consumer ("every place it is used")

| Consumer in Reference                                                                                                                   | Here                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Team inbox bootstrap returns `saved_replies` (shared + own, by `used_count`)                                                            | `GET /inbox/saved-replies` (the bootstrap is split into endpoints, see the inventory port note)                                                          |
| Composer "Shortcuts" tab opens the picker; `/` as the first character opens it; search by shortcut/title/body                           | "Saved replies" button and `/` at the start of a word, keyboard navigable listbox (`saved-reply-picker.tsx`)                                             |
| Picking a reply loads the body into the composer (replaces the text), expands `{{device_phone}}`, `{{device_name}}`, counts a use       | Replaces the typed `/query` or inserts at the caret, server fills the variables (`POST :id/use`), counts a use; never sends                              |
| "Create new shortcut" row inside the picker                                                                                             | footer link "Manage saved replies" for holders of the manage right (opens the screen)                                                                    |
| Rail button + modal "Quick Replies": list with edit, delete, "Add reply", count badge; form shortcut, title, body, category, "Personal" | Settings screen `/inbox/saved-replies` (tabs, search, category filter, plan meter, form with preview and variable chips); the count is in the tabs       |
| Create gated by `savedreply.manage` and the plan cap on all rows                                                                        | same (`inbox.savedreply.manage`, `saved_replies` limit)                                                                                                  |
| Update and delete: any member for shared (quirk), owner or manage for personal                                                          | shared needs the manage right, personal is the owner's (recorded as `intended`)                                                                          |
| AI agent `use_saved_replies`: the 15 most used shared replies go into the system prompt                                                 | **Not built** here: BL-105. `ai_agents.use_saved_replies` exists; the consumer must read shared replies (never personal) by `used_count`                 |
| Routing rule auto-reply expands `{{device_phone}}` / `{{device_name}}` like the picker                                                  | Not part of this feature (routing has no reply action here); the same two variables exist in the catalogue                                               |
| Package form field `saved_replies_limit`; workspace wipe lists `saved_replies`; demo seeder                                             | plan editor already has the limit; retention lists the table; no seeder                                                                                  |
| Permission `savedreply.manage` held by Owner, Admin, Manager                                                                            | `inbox.savedreply.manage`, granted to the same presets in 20261013100000_rbac_workspace_presets.sql; the AWAITING line in `key-coverage.spec.ts` is gone |

## Not built, recorded

- BL-105 AI agent consumer of the shared replies (`use_saved_replies`).
- BL-106 email composer (TW-MAIL-027): the rich editor has no picker yet. `SavedReplyPicker` takes the insert as a callback
  (`onInsert(text, range)`), so the email editor only needs to supply its own insert.
- BL-107 import and export of saved replies (Reference has neither).
- Reference's `attachments` column is unused there and here.
