---
domain: team-chat
code: TCHAT
title: Internal Team Chat
wadesk_version: '1.7.0'
sources_read: 24
---

# Internal Team Chat

## Overview

Team Chat is WaDesk's Slack-style internal messenger for the people inside one workspace. It lives entirely in-app: no WhatsApp, Baileys or WABA involvement, no message credits, nothing ever reaches a customer. It is a sibling of the customer Team Inbox (TIB1) and is reached from the inbox left rail, the sidebar nav (`Inbox & Chat` group, tier manager), a card in the inbox Tools flyout and the global command palette.

Actors: any workspace member (owner, admin, manager, agent, viewer) can open the page and use it. The controller applies NO workspace-role middleware, NO permission key and NO plan feature key: the only gates are "logged in", "has a current workspace" and "is owner or has a `workspace_user` row". The only role distinction is a private helper that treats `owner` and `admin` as "admin" for channel creation/deletion, invite approval, deleting other people's messages and pinning. Managers are therefore not admins here even though the nav tier is manager. Platform admins get no special treatment (an impersonating admin without a pivot row is rejected as "Not a workspace member").

Surface: one Blade page (`user/team-inbox/team-chat.blade.php`) driven by one vanilla-JS module (`user-team-chat.js`) that talks to 18 JSON endpoints under `team-inbox/api/team-chat`, all on `TeamChatController`. There is no websocket client: the page polls the message list every 3 seconds (diff mode by `since_id`) and the channel list every 15 seconds.

Main flow end to end:

1. Member opens `/team-chat`. The server makes sure a public `#general` channel exists (created lazily, first visitor triggers it), then the JS loads the channel list (public channels always visible; private channels only where a membership row exists), selects `#general`, loads the latest 50 messages plus the workspace roster, and marks the channel read.
2. The member types in the composer, optionally @mentions a teammate (typeahead inserting a `@[Name](userId)` token), replies to a message, or attaches one file (max 20 MB). The message is shown optimistically, POSTed as multipart, then swapped to the server id. Other members see it on their next 3-second poll.
3. Admins create public/private channels; anyone can file an invite request for a teammate's email (admins skip approval). Admins approve or decline pending requests; approval adds the invitee to `workspace_user` as role `member` and optionally to a channel.

The backend also ships edit (15-minute window), pin, emoji reactions, in-channel search, typing pings, presence pings and an activity snapshot, and a channel delete; NONE of these has any UI in the shipped page. Several docs claims (direct messages, online/typing header, edit/pin/react/search in the UI) are therefore docs-only or API-only and are marked `partial`/`docs-only` below.

CRITICAL DEFECT (verified statically, confirmed by an autoload check that `channel_id` is not mass-assignable on `TeamChatMessage`): the send endpoint writes the message with `TeamChatMessage::create([... 'channel_id' => ...])`, but `channel_id` is missing from the model's `$fillable`, so Laravel silently drops it and rows are inserted with `channel_id = NULL`. Every read path (history, diff poll, unread counts, search) filters by `channel_id`, so as shipped, sent messages would never appear in any channel. Live verification is needed (see Open questions). This inventory describes the INTENDED behavior (messages belong to exactly one channel) and the port must implement that; the defect is recorded so nobody "ports the bug".

Plan tiers: none. Team Chat is not gated by any plan feature key or limit. Approving an invitation inserts into `workspace_user` WITHOUT running the `user_seat_limit` plan cap that the regular member-invite flow (WSP) enforces.

Connections to other domains: WSP (`workspaces`, `workspace_user` roster, owner, roles; approval writes members), RBAC (role hierarchy, and the fact that this domain uses none of the permission keys), TIB1 (host UI shell, rail link, `ti-frame` layout CSS), NOTIF (nothing is emitted: no notifications, push or audit for chat; mentions do not notify), SET (media disk and `media_url` for attachments, cache store for presence), CORE (broadcast config, cache, Echo/Pusher), ASHELL (navigation registry entry `team-chat`), AUTH (`current_workspace_id` on the user).

## Feature index

| Id           | Feature                                                 | Status      | Priority | Effort | Depends on                 |
| ------------ | ------------------------------------------------------- | ----------- | -------- | ------ | -------------------------- |
| WD-TCHAT-001 | Team Chat page and lazily seeded #general channel       | implemented | P0       | S      | —                          |
| WD-TCHAT-002 | Workspace scoping, membership and admin access model    | implemented | P0       | M      | —                          |
| WD-TCHAT-003 | Channel list with per-channel unread counts             | implemented | P0       | M      | WD-TCHAT-001               |
| WD-TCHAT-004 | Create channel (admin only)                             | implemented | P0       | S      | WD-TCHAT-002               |
| WD-TCHAT-005 | Channel visibility and private-channel membership       | partial     | P1       | M      | WD-TCHAT-004               |
| WD-TCHAT-006 | Delete channel (admin only, #general protected)         | partial     | P2       | S      | WD-TCHAT-004               |
| WD-TCHAT-007 | Direct-message channels                                 | docs-only   | P2       | M      | WD-TCHAT-005               |
| WD-TCHAT-008 | Load message history and 3-second diff polling          | partial     | P0       | M      | WD-TCHAT-003               |
| WD-TCHAT-009 | Send message (text, mentions, reply parent, attachment) | partial     | P0       | L      | WD-TCHAT-008               |
| WD-TCHAT-010 | File and image attachments                              | implemented | P1       | M      | WD-TCHAT-009               |
| WD-TCHAT-011 | Reply to a message                                      | implemented | P1       | S      | WD-TCHAT-009               |
| WD-TCHAT-012 | @mentions (typeahead, token format, rendering)          | partial     | P1       | M      | WD-TCHAT-009               |
| WD-TCHAT-013 | Optimistic send, upload progress and failed state       | implemented | P1       | M      | WD-TCHAT-009               |
| WD-TCHAT-014 | Read state and unread badges                            | implemented | P0       | M      | WD-TCHAT-003               |
| WD-TCHAT-015 | Members rail and member search                          | implemented | P1       | S      | WD-TCHAT-008               |
| WD-TCHAT-016 | Delete message                                          | implemented | P1       | S      | WD-TCHAT-009               |
| WD-TCHAT-017 | Edit message within 15 minutes                          | partial     | P2       | S      | WD-TCHAT-009               |
| WD-TCHAT-018 | Pin and unpin message                                   | partial     | P2       | S      | WD-TCHAT-009               |
| WD-TCHAT-019 | Emoji reactions                                         | partial     | P2       | S      | WD-TCHAT-009               |
| WD-TCHAT-020 | Search messages in a channel                            | partial     | P2       | S      | WD-TCHAT-009               |
| WD-TCHAT-021 | Typing indicator ping                                   | partial     | P2       | S      | WD-TCHAT-008               |
| WD-TCHAT-022 | Online presence ping                                    | partial     | P2       | S      | WD-TCHAT-002               |
| WD-TCHAT-023 | Activity snapshot (who is typing, who is online)        | partial     | P2       | S      | WD-TCHAT-021, WD-TCHAT-022 |
| WD-TCHAT-024 | Request or grant a teammate invitation                  | implemented | P1       | M      | WD-TCHAT-002               |
| WD-TCHAT-025 | Invitation list and Pending requests modal              | implemented | P1       | S      | WD-TCHAT-024               |
| WD-TCHAT-026 | Approve invitation (joins workspace and channel)        | implemented | P1       | M      | WD-TCHAT-024               |
| WD-TCHAT-027 | Decline invitation                                      | implemented | P1       | S      | WD-TCHAT-024               |
| WD-TCHAT-028 | Realtime MessagePosted broadcast event                  | dead-code   | P2       | S      | WD-TCHAT-009               |
| WD-TCHAT-029 | Mobile layout (channel list home, thread slide-over)    | implemented | P2       | S      | WD-TCHAT-001               |
| WD-TCHAT-030 | Entry points and navigation into Team Chat              | implemented | P1       | S      | WD-TCHAT-001               |
| WD-TCHAT-031 | Legacy per-workspace read pointer (team_chat_reads)     | dead-code   | P2       | S      | —                          |
| WD-TCHAT-032 | Demo teammates seeder (dev tool)                        | implemented | P2       | S      | —                          |

## Features

### WD-TCHAT-001 — Team Chat page and lazily seeded #general channel

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** S (<=2 dev-days) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** none
- **Summary:** `/team-chat` renders the internal chat workspace. Opening it (or any endpoint that lists channels or defaults to the general channel) guarantees the workspace has a public channel `general`, creating it on demand.
- **Actors & access:** any authenticated user with a current workspace who is the workspace owner or has a `workspace_user` row. No role, permission-key or plan gate. Workspace scope, not platform scope.
- **UX & screens:** `resources/views/user/team-inbox/team-chat.blade.php` wrapped in `x-layouts.user` (title "Team Chat", nav key `team-inbox`, JS page id `user-team-chat`). Three-column frame `#tc-frame` (class `ti-frame no-contact`): (1) workspace name, Mode links (Customer chats to `/team-inbox`, Team chat active), Channels list with a "+" create button, People section with "+" invite button, a Members link to `/team-inbox/members` and a "Pending requests" button with a count badge; (2) a members rail with member count and a search box; (3) chat stream with a channel header (name, type pill, description, "Customer chats" back link), the message stream, and the composer. Three modals live on the page: create channel, invite teammate, pending invitations. The JS boots only when `#tc-stream` exists. Initial states: "Loading messages…" in the stream, "Loading…" in the members rail, "No channels yet" when the list is empty.
- **Endpoints:**

| Method uri    | Route name          | Controller@action       | Middleware | Request | Response                                                                                                                         |
| ------------- | ------------------- | ----------------------- | ---------- | ------- | -------------------------------------------------------------------------------------------------------------------------------- |
| GET team-chat | user.team-chat.page | TeamChatController@page | web, auth  | none    | Blade view; 403 "No active workspace" if the user has no current workspace; 403 "Workspace not found" / "Not a workspace member" |

- **Data:** reads `workspaces` (owner), `workspace_user`; writes `team_chat_channels` (one row, only if missing): name `general`, slug `general`, description "Everyone in this workspace", type `public`, created_by null.
- **Rules & edge cases:**
  1. Workspace comes from `users.current_workspace_id`; 0/null aborts 403.
  2. `#general` is looked up by slug within the workspace (soft-deleted rows are ignored, but `general` cannot be deleted through the API). The migration that introduced channels also backfilled a `general` channel for every existing workspace and moved orphan messages onto it.
  3. Creation is not race-safe: two simultaneous first visits can both try to insert and the unique `(workspace_id, slug)` index makes one fail with a 500.
  4. The page never checks role; agents and viewers can open it (their nav does not show it, but the inbox rail link does).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none (no plan feature, no admin setting).
- **Acceptance criteria:**
  - Given a workspace with no channels, when the owner opens `/team-chat`, then a public `general` channel exists afterwards and is selected.
  - Given a second visit, then no duplicate `general` is created.
  - Given a user whose `current_workspace_id` is empty, when they open `/team-chat`, then the response is 403.
  - Given a user who is not owner and not in `workspace_user` for the current workspace, then 403 "Not a workspace member".
- **Source refs:** app/Http/Controllers/TeamChatController.php, resources/views/user/team-inbox/team-chat.blade.php, resources/js/charts/user-team-chat.js, routes/web.php (line ~1558), database/migrations/2026_05_24_110000_team_chat_channels_and_invitations.php, Documentation/pages/messaging/team-chat.html
- **Port notes:** New module `apps/api/src/modules/team-chat` (does not exist in this repo yet). Seed `general` in the workspace-provisioning transaction (WSP) as well as lazily, with an `ON CONFLICT DO NOTHING` on `(workspace_id, slug)` to avoid the race. Page lives under the inbox area of `apps/web`. All tables need RLS by `workspace_id`; channel_members and reactions lack a workspace_id column in WaDesk, add one.

### WD-TCHAT-002 — Workspace scoping, membership and admin access model

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** none
- **Summary:** Defines who may do what in Team Chat. Everything is scoped to the caller's current workspace; membership is owner-or-pivot; "admin" means workspace role `owner` or `admin`.
- **Actors & access:** all Team Chat endpoints. No permission keys (`WorkspacePermissions::userCan` is never called), no `workspace.role` or `plan` middleware, no throttling.
- **UX & screens:** the JS learns `is_admin` from the message-list response (`me.is_admin`) and only uses it to show a Delete button on other people's messages. The create-channel "+" button is always shown; a non-admin gets a 403 "Only workspace admins can create channels" (the modal shows the JSON `message` or "Failed to create channel").
- **Endpoints:** applies to all 19 routes of this domain (see later features).
- **Data:** reads `workspaces.owner_user_id`, `workspace_user(workspace_id,user_id,role)`.
- **Rules & edge cases:**
  1. `workspaceId()`: current workspace or 403 "No active workspace".
  2. `memberCheck()`: workspace must exist; the user must be the owner or have a pivot row; else 403 "Not a workspace member". Called by page, channels index/store/destroy, messages index/store, mark-read, destroy, edit, pin, react and all invitation endpoints. NOT called by search, typing, presence and activity (those only resolve the workspace and, where a channel is involved, the channel). Because a non-member cannot have a current workspace they do not belong to in normal flow, this is mostly theoretical, but it is an inconsistency to fix in the port (check membership everywhere).
  3. `isAdmin()`: owner (by `workspaces.owner_user_id`) or pivot role, case-insensitive, equal to `owner` or `admin`. The roles `manager`, `agent`, `viewer` are non-admin. Admin gates: create channel, delete channel, approve/decline invitation, delete any message, pin any message, auto-approval of own invitation requests, seeing all invitations.
  4. Roster (`rosterIds`) = owner id plus all pivot user ids, de-duplicated. Used for the members list, mention validation and duplicate-invite checks.
  5. Cross-workspace isolation is enforced in code by adding `workspace_id` to queries for channels and messages; there is no global scope or RLS. Known gaps: invitation `channel_id` and reaction/pin/edit ownership are not checked against channel membership (see later features and Open questions).
  6. A platform admin impersonating a workspace has no pivot row, so `memberCheck` rejects them with 403 even though role middleware elsewhere would grant owner rights.
  7. No audit log rows are written for any Team Chat action.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a manager, when they POST a new channel, then 403 "Only workspace admins can create channels".
  - Given an owner whose pivot role is missing, then they still pass membership and admin checks via `owner_user_id`.
  - Given user A in workspace 1 with current workspace 1, when they request channel id of workspace 2, then 404 "Channel not found".
  - Given a viewer, when they open `/team-chat` and post a message, then it succeeds (no role gate).
- **Source refs:** app/Http/Controllers/TeamChatController.php (workspaceId, memberCheck, isAdmin, rosterIds, loadChannel), app/Support/WorkspacePermissions.php, app/Http/Middleware/EnsureWorkspaceRole.php
- **Port notes:** Recommend a `TeamChatAccessGuard` (Nest guard) resolving tenant from the session and applying RLS; consider introducing RBAC permission keys (`teamchat.use`, `teamchat.channel.manage`, `teamchat.invite.approve`) so the port is stricter than WaDesk but map `owner|admin` to the same set by default. Decide with RBAC whether managers should be able to create channels (WaDesk says no). Do not replicate the missing membership check on search/typing/presence/activity.

### WD-TCHAT-003 — Channel list with per-channel unread counts

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-TCHAT-001
- **Summary:** The left rail lists every channel the user can see with an unread badge. Public channels are always visible; private (and dm) channels only appear where the user has a membership row.
- **Actors & access:** any workspace member.
- **UX & screens:** `#tc-channel-list` renders one button per channel: a `#` glyph for public, a lock icon for private, the channel name (truncated) and a pulsing count badge when unread is greater than zero. The active channel is highlighted. Empty list shows "No channels yet". The list refreshes on boot, after each successful send, after creating a channel and every 15 seconds. Unread is not capped or abbreviated.
- **Endpoints:**

| Method uri                            | Route name                                   | Controller@action                | Middleware | Request | Response                                                                         |
| ------------------------------------- | -------------------------------------------- | -------------------------------- | ---------- | ------- | -------------------------------------------------------------------------------- |
| GET team-inbox/api/team-chat/channels | user.team-inbox.api.team-chat.channels.index | TeamChatController@channelsIndex | web, auth  | none    | `{channels:[{id,name,slug,type,description,last_message_at (ISO 8601),unread}]}` |

- **Data:** `team_chat_channels` (soft-delete scope hides deleted), `team_chat_channel_members`, `team_chat_messages` (soft-delete scope hides deleted).
- **Rules & edge cases:**
  1. Ordering: all public channels by id ascending, THEN private/dm channels the user belongs to by id ascending (not merged by id). `last_message_at` is returned but the UI does not sort by it.
  2. Unread for a channel = messages in that channel authored by someone else with id greater than the member row's `last_read_message_id` (0 when no membership row exists). A user who has never opened a public channel therefore sees the entire history as unread. Own messages never count.
  3. Implementation does one member fetch and one grouped max-id query, then a per-channel COUNT only for channels that have unread. Rebuild with a single query.
  4. The endpoint calls the general-channel seeder, so it never returns an empty list for a member.
  5. Default selected channel on first load: the one with slug `general`, else the first in the list. The selection is client state only (not persisted; a reload returns to #general).
  6. DM-type channels would be listed under the same rule but render with the public `#` glyph because the JS only special-cases `private`.
- **Async & events:** client poll every 15 s.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a public channel with three messages from others and last_read below all of them, then unread is 3; after mark-read to the newest id, unread is 0.
  - Given a private channel the user is not a member of, then it is absent from the list.
  - Given the user's own message is the newest, then it does not add to unread.
  - Given a channel is soft-deleted, then it disappears from the list on the next refresh.
- **Source refs:** app/Http/Controllers/TeamChatController.php (channelsIndex), resources/js/charts/user-team-chat.js (renderChannels, loadChannels), app/Models/TeamChatChannel.php, app/Models/TeamChatChannelMember.php
- **Port notes:** `GET /team-chat/channels`. Compute unread with `count(*) FILTER (WHERE id > last_read AND user_id <> me)` grouped by channel. Keep lazy membership rows for public channels, or drop them and store a per-user read pointer separately; do not treat "no row" as "member" for private channels.

### WD-TCHAT-004 — Create channel (admin only)

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** S (<=2 dev-days) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-TCHAT-002
- **Summary:** An owner or admin creates a public or private channel with a name and optional description.
- **Actors & access:** workspace owner/admin (isAdmin); others get 403.
- **UX & screens:** "Create a channel" modal (`#tc-create-modal`): Name (required, maxlength 64, HTML pattern lowercase letters/digits/dash/underscore, shown after a fixed `#` prefix, helper text "Lowercase, no spaces…"), Description (optional, maxlength 255), Privacy radio Public (default; "Everyone in workspace") or Private ("Invite-only"), inline red error area, Cancel / Create channel buttons. On success the modal closes, the channel list reloads, the new channel is opened and on mobile the thread slides in. Errors show the server `message` or "Failed to create channel"/"Network error". The form is reset each time it opens.
- **Endpoints:**

| Method uri                             | Route name                                   | Controller@action                | Middleware | Request                                                                                                                                                                                        | Response                                                                                                                                  |
| -------------------------------------- | -------------------------------------------- | -------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| POST team-inbox/api/team-chat/channels | user.team-inbox.api.team-chat.channels.store | TeamChatController@channelsStore | web, auth  | multipart/form or JSON: `name` (required, string, max 64, regex `^[a-z0-9][a-z0-9-_]*$` case-insensitive), `description` (nullable, string, max 255), `type` (required, `public` or `private`) | `{ok:true,channel:{id,name,slug,type}}`; 422 `{ok:false,message:"A channel with this name already exists"}`; 422 standard validation; 403 |

- **Data:** writes `team_chat_channels` (workspace_id, name lowercased, slug, description, type, created_by_user_id); for private channels also writes `team_chat_channel_members` (creator, role `admin`, joined_at now).
- **Rules & edge cases:**
  1. Name is lower-cased before storing even though the regex is case-insensitive (uppercase input is accepted and normalized).
  2. Slug = `Str::slug(lowercase name)`, which turns underscores into dashes: `dev_ops` and `dev-ops` collide on slug `dev-ops`; the "already exists" check is on slug within the workspace (soft-deleted channels are not counted).
  3. QUIRK: the DB unique index `(workspace_id, slug)` DOES include soft-deleted rows, so re-creating a name whose channel was deleted passes the application check and then fails on the index with a 500.
  4. `dm` cannot be created here (validation allows only public and private).
  5. Public channels get no member rows (implicit membership); private channels get exactly the creator as channel admin.
  6. No limit on channel count, no reserved-name list besides the `general` slug collision.
  7. The regex allows `-` or `_` after the first character but the character class also permits a name consisting only of digits.
- **Async & events:** none (no broadcast, no notification, no audit).
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an admin, when they create `Support_Team` public, then a channel with name `support_team` and slug `support-team` exists and is returned.
  - Given a channel with slug `support-team`, when creating `support_team`, then 422 "A channel with this name already exists".
  - Given a non-admin, then 403 and no row.
  - Given a private channel is created, then the creator has a channel-member row with role `admin`.
  - Given name `-abc` or `has space`, then 422 validation failure.
- **Source refs:** app/Http/Controllers/TeamChatController.php (channelsStore), resources/views/user/team-inbox/team-chat.blade.php (create modal), resources/js/charts/user-team-chat.js
- **Port notes:** Keep the slug rule but normalize underscores deliberately (store both `name` and `slug`), and make uniqueness partial (`WHERE deleted_at IS NULL`) so deleted names can be reused. Emit an outbox event `teamchat.channel.created` if any later notification wants it.

### WD-TCHAT-005 — Channel visibility and private-channel membership

- **Status:** partial
- **Priority:** P1 (expected by customers)
- **Effort:** M (<=1 week) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-TCHAT-004
- **Summary:** Public channels are open to every workspace member; private and dm channels require an explicit membership row. The only ways rows appear are channel creation (private creator), the first read or post in a channel, and an approved invitation that targets a channel.
- **Actors & access:** members subject to `loadChannel`.
- **UX & screens:** private channels show a lock icon and a "Private" pill; public show "Channel". There is NO UI to add members to a private channel, remove a member, leave a channel, rename or edit a channel, or view a channel member list; the invite modal has no channel picker (the API accepts `channel_id`, the form never sends it). Consequently a private channel created through the UI contains only its creator.
- **Endpoints:** enforced inside `loadChannel` for messages index/store, mark-read, search, typing and activity; no separate endpoint.
- **Data:** `team_chat_channels.type` enum `public|private|dm`; `team_chat_channel_members(channel_id,user_id,role admin|member,last_read_message_id,last_read_at,joined_at)` unique per `(channel_id,user_id)`.
- **Rules & edge cases:**
  1. `loadChannel(ws, user, channelId)` returns 404 "Channel not found" if the channel is missing (or soft-deleted) or belongs to another workspace; returns immediately for public; otherwise 403 "Not a member of this channel" unless a member row exists.
  2. The message-list response returns the WORKSPACE roster as `members`, not channel members, so a private channel's rail shows everyone and the @mention picker lists non-members of the channel.
  3. `channel_members.role` `admin` is stored for private creators and never read anywhere (docs say "channel admins can pin"; the code only checks workspace admins).
  4. Membership rows for public channels are created lazily as a side effect of mark-read and send (see WD-TCHAT-014); they carry no meaning for access.
  5. Edit/pin/react/delete-message endpoints only check the message's workspace, NOT channel membership, so a member who learns a message id in a private channel could act on it (Open questions).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a private channel where the user has no member row, when they GET its messages, then 403 "Not a member of this channel".
  - Given a public channel, when any workspace member GETs its messages, then it succeeds without a member row.
  - Given a channel id from another workspace, then 404.
- **Source refs:** app/Http/Controllers/TeamChatController.php (loadChannel, channelsIndex), app/Models/TeamChatChannelMember.php, database/migrations/2026_05_24_110000_team_chat_channels_and_invitations.php, Documentation/pages/messaging/team-chat.html
- **Port notes:** Implement the intended model fully: add-member and remove-member endpoints for private channels (admin or channel admin), a channel members panel, and enforce channel access on every message-scoped endpoint (edit, pin, react, delete). This is one place where the port should exceed WaDesk; list it in the parity tracker as "enhancement".

### WD-TCHAT-006 — Delete channel (admin only, #general protected)

- **Status:** partial
- **Priority:** P2 (nice to have)
- **Effort:** S (<=2 dev-days) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-TCHAT-004
- **Summary:** An owner/admin can soft-delete a channel via API. There is no button for it in the shipped UI.
- **Actors & access:** owner/admin; the page's `tcEndpoints.channelsDestroy` is defined but never called by the JS.
- **UX & screens:** none.
- **Endpoints:**

| Method uri                                    | Route name                                     | Controller@action                  | Middleware                | Request | Response                                                                                                              |
| --------------------------------------------- | ---------------------------------------------- | ---------------------------------- | ------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------- |
| DELETE team-inbox/api/team-chat/channels/{id} | user.team-inbox.api.team-chat.channels.destroy | TeamChatController@channelsDestroy | web, auth; `{id}` numeric | none    | `{ok:true}`; 422 `{ok:false,message:"#general cannot be deleted"}`; 403 (non-admin); 404 (unknown or other workspace) |

- **Data:** sets `team_chat_channels.deleted_at`. Messages, members, invitations are NOT touched (soft delete does not cascade).
- **Rules & edge cases:**
  1. Any channel whose slug is `general` is protected.
  2. Membership is not required, so an admin can delete a private channel they are not in.
  3. After deletion the channel disappears from listings and its messages become unreachable (`loadChannel` 404s), but rows remain; invitations pointing at it keep the id (`channel_id` FK only nulls on hard delete).
  4. The channel's slug remains reserved by the unique index (see WD-TCHAT-004 rule 3).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an admin, when deleting a normal channel, then `{ok:true}` and it no longer lists.
  - Given channel `general`, then 422 with the protected message and the channel remains.
  - Given a non-admin, then 403.
- **Source refs:** app/Http/Controllers/TeamChatController.php (channelsDestroy)
- **Port notes:** Add the missing UI (channel settings). Decide whether deletion should archive rather than hide; keep messages for retention. Provide undelete or hard purge job in CORE retention.

### WD-TCHAT-007 — Direct-message channels

- **Status:** docs-only
- **Priority:** P2 (nice to have)
- **Effort:** M (<=1 week) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-TCHAT-005
- **Summary:** The documentation and schema advertise one-to-one direct messages between teammates; nothing in the code creates them.
- **Actors & access:** n/a.
- **UX & screens:** none. The members rail click only inserts an @mention into the composer.
- **Endpoints:** none.
- **Data:** enum value `dm` exists on `team_chat_channels.type`; the migration comment says a dm is a system-managed private channel with two members whose name is derived from the other user. `channelsIndex` and `loadChannel` already treat `dm` like `private`.
- **Rules & edge cases:**
  1. No route, controller code, seeder or UI creates a `dm` row; the `channelsStore` validator rejects `dm`.
  2. The members rail is not wired to open a DM.
  3. Docs (messaging/team-chat) list "Direct message" as a channel kind; treat as advertised-but-absent.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - (Target behavior for the port) Given user A clicks user B in the members rail, when no DM exists, then a `dm` channel with exactly A and B is created and opened, and a second click reuses it.
  - Given a third user, then the DM is invisible and its endpoints return 403.
  - Given the DM list, then each user sees the other person's name as the channel title.
- **Source refs:** database/migrations/2026_05_24_110000_team_chat_channels_and_invitations.php, Documentation/pages/messaging/team-chat.html, app/Http/Controllers/TeamChatController.php
- **Port notes:** Build as a deterministic pair key (`dm:{minUserId}:{maxUserId}` slug) with a unique index, created on demand via `POST /team-chat/dm`. Lower priority than core channel features.

### WD-TCHAT-008 — Load message history and 3-second diff polling

- **Status:** partial
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-TCHAT-003
- **Summary:** Opening or switching a channel loads its latest messages, the workspace roster and the caller's admin flag; afterwards the page polls for messages newer than the last one it has.
- **Actors & access:** members; private channels require membership.
- **UX & screens:** the stream shows day separators (locale date "Mon D, YYYY") between days, message bubbles (own messages right-aligned, mint background; others left, white with border), avatar circle with initials and a colour picked from an 8-colour palette by user id, author name, time (today: HH:MM; otherwise "Mon D, HH:MM"), "(edited)" tag when `edited_at` is set, a reply quote line, message body with newline-to-`<br>` and highlighted mention tokens, and an attachment card. Empty channel shows a centered "No messages in #name yet / Say hello…". The stream auto-scrolls to bottom on full load; on poll it follows only if the user was within 100 px of the bottom. Switching channel updates header name, type pill (Private/Channel), description and composer placeholder, then does a full reload. There is no "load older messages" control even though the API supports it, so the UI only ever shows the latest 50.
- **Endpoints:**

| Method uri                   | Route name                          | Controller@action        | Middleware | Request                                                                                                                                                    | Response                                                                                                                                |
| ---------------------------- | ----------------------------------- | ------------------------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| GET team-inbox/api/team-chat | user.team-inbox.api.team-chat.index | TeamChatController@index | web, auth  | query `channel_id` (int, default 0 = #general), `before` (int id, older-than cursor), `since_id` (int id, newer-than), `limit` (clamped 10-50, default 50) | `{channel:{id,name,slug,type,description}, messages:[...ascending], members:[{id,name,email,avatar}], me:{id,name,is_admin}, has_more}` |

Message object: `id, channel_id, user_id, author_name ("Unknown" if user missing), author_avatar (absolute URL if stored as http(s), else media URL, else null), body, mentions (array of user ids), reply_to_id, attachment_url (media URL or null), attachment_mime, attachment_name, edited_at, created_at, is_mine`. It does NOT include reactions, pin state or thread counts.

- **Data:** reads `team_chat_messages` (soft-delete scope; `body` is decrypted by the model cast), `users` (name, email, avatar_path), roster.
- **Rules & edge cases:**
  1. Query fetches newest-first with the limit, then reverses to ascending. `before` and `since_id` combine as plain id predicates.
  2. `has_more` is true when the returned row count equals the limit (not a real more-exists check).
  3. QUIRK: diff mode with more than `limit` new messages returns only the NEWEST `limit`, silently skipping the gap.
  4. QUIRK: deletions and edits by others are never reflected by diff polling (it only appends); they appear after a full reload (channel switch, own delete, invitation decision).
  5. The poll compares against the highest non-temporary numeric id already in memory.
  6. `members` always contains the entire workspace roster (owner + pivot) regardless of channel privacy.
  7. Author avatars are returned but never rendered; the UI shows coloured initials.
  8. Full load also fires mark-read for the newest message id (WD-TCHAT-014).
  9. CRITICAL DEFECT: because posted messages get `channel_id = NULL` (see Overview and WD-TCHAT-009), the `channel_id = X` predicate never finds them, so this endpoint returns nothing for messages posted through the shipped send path. The rows only reappear if channel_id is set some other way (the migration backfill did this for legacy rows).
  10. The `page` boot, channel switch and invitation decisions all use the full-reload path; polling errors are swallowed and retried on the next tick.
- **Async & events:** polling every 3 s per open tab (no visibility pause, no backoff); no throttle middleware on the route.
- **External systems:** media disk for attachment URLs.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 120 messages, when the channel opens, then the newest 50 are returned in ascending order and `has_more` is true.
  - Given `since_id=N`, then only messages with id greater than N are returned.
  - Given `limit=5`, then 10 rows are returned (minimum clamp); `limit=500` returns at most 50.
  - Given a private channel without membership, then 403.
  - Given a deleted user's message, then `author_name` is "Unknown".
- **Source refs:** app/Http/Controllers/TeamChatController.php (index), resources/js/charts/user-team-chat.js (loadMessages, pollNewMessages, renderStream, renderMessage), app/Models/TeamChatMessage.php
- **Port notes:** Cursor pagination with keyset on `(channel_id, id)`; add "load older" UI. Return reactions and pinned flag in the payload (needed by features 017-019). Prefer server-sent events or websocket over polling, with polling as fallback (see WD-TCHAT-028). Index `(channel_id, id)` exists in WaDesk; keep it.

### WD-TCHAT-009 — Send message (text, mentions, reply parent, attachment)

- **Status:** partial
- **Priority:** P0 (product unusable without)
- **Effort:** L (<=2 weeks) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-TCHAT-008
- **Summary:** A member posts a message, with optional reply parent and one attachment, into a channel they can access. The server extracts mentions, stores the encrypted body, bumps the channel's `last_message_at`, and marks the channel read for the author.
- **Actors & access:** members; private channels require membership. Any role, including viewer.
- **UX & screens:** composer form `#tc-composer`: auto-growing textarea (max 8192 chars, up to 180 px tall), attach button, Send button, reply banner, attachment preview chip, and a keyboard hint bar (Enter sends, Shift+Enter newline, @ mention). Enter without Shift submits; Escape clears reply (or closes the mention popover first). Empty text with no attachment is silently ignored client-side.
- **Endpoints:**

| Method uri                    | Route name                          | Controller@action        | Middleware | Request                                                                                                                                                                                                                  | Response                                                                                                                                                                                 |
| ----------------------------- | ----------------------------------- | ------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST team-inbox/api/team-chat | user.team-inbox.api.team-chat.store | TeamChatController@store | web, auth  | multipart: `channel_id` (nullable int, must exist in team_chat_channels), `body` (nullable string, max 8192), `reply_to_id` (nullable int, must exist in team_chat_messages), `attachment` (nullable file, max 20480 KB) | `{ok:true,id,channel_id,created_at,mentions:[ids]}`; 422 `{ok:false,message:"empty"}` when no text and no file; 422 `{ok:false,message:"parent_other_channel"}`; 422 validation; 403/404 |

- **Data:** inserts `team_chat_messages` (workspace_id, channel_id, user_id, body (encrypted at rest through the Eloquent `encrypted` cast, trimmed; null when empty), mentions JSON array of user ids or null, reply_to_id, attachment_path/mime/name); updates `team_chat_channels.last_message_at = now`; upserts the author's `team_chat_channel_members` row (last_read_message_id = new id, last_read_at, joined_at = now).
- **Rules & edge cases:**
  1. Missing/0 `channel_id` posts to `#general` (seeded if needed); otherwise the channel goes through `loadChannel` (so private membership applies).
  2. Body is trimmed; if empty and there is no file the request returns 422 "empty" (the UI would display that literal on a failed bubble, but the client never sends empty).
  3. Mentions: regex over the body for tokens of the form `@[display name](numeric user id)`; ids are de-duplicated and intersected with the workspace roster; unknown ids are dropped from the stored array but the token text stays in the body. No notification, push, badge or email is produced for a mention (docs only promise highlighting).
  4. Reply parent: must belong to the same channel; a soft-deleted or missing parent counts as "other channel" and returns 422 `parent_other_channel`.
  5. The attachment is stored BEFORE the parent check, so a rejected reply leaves an orphan file.
  6. `last_message_at` is set via the channel `update`; `TeamChatChannel::$fillable` includes it.
  7. The author's member row is upserted with `joined_at = now()` every time, overwriting the original join time (QUIRK: `joined_at` is not stable).
  8. No rate limit, flood control, profanity filter or length limit beyond 8192.
  9. CRITICAL DEFECT (verified): `channel_id` is not in `TeamChatMessage::$fillable`, so `create()` discards it and the row is stored with `channel_id = NULL`; the message is then invisible to every channel query (WD-TCHAT-008). The port must persist channel_id.
  10. Realtime: after the insert the controller tries to broadcast `MessagePosted` to others and swallows failures with a warning log (see WD-TCHAT-028).
- **Async & events:** synchronous broadcast attempt (`ShouldBroadcastNow`, `toOthers`); log warning `[team-chat] broadcast failed` on error. No queue jobs.
- **External systems:** media disk (local or cloud storage configured by admin) for the attachment.
- **Settings:** admin cloud-storage setting decides the media disk (`media_disk()`); no chat-specific setting.
- **Acceptance criteria:**
  - Given text "hello" to channel C, then 200 `{ok:true,id}`, the channel's `last_message_at` updates and the author's `last_read_message_id` equals the new id.
  - Given body "@[Sam](7) hi" and user 7 is in the roster, then `mentions` is `[7]`; given user 99 not in the roster, then `mentions` is `[]`.
  - Given a reply parent in another channel, then 422 `parent_other_channel`.
  - Given neither text nor file, then 422 "empty".
  - Given a 21 MB file, then 422 validation error and nothing stored.
  - Given a private channel without membership, then 403.
  - Given the message is posted, then GET history for that channel includes it (regression test for the WaDesk channel_id defect).
- **Source refs:** app/Http/Controllers/TeamChatController.php (store), app/Models/TeamChatMessage.php, resources/js/charts/user-team-chat.js (sendMessage), database/migrations/2026_05_24_100000_create_team_chat_messages_table.php, database/migrations/2026_05_24_110000_team_chat_channels_and_invitations.php
- **Port notes:** POST body as JSON plus a separate upload step (presigned URL) is preferable to multipart; keep 8192/20 MB limits. Encrypt `body` at rest with a per-workspace key (AES-GCM) if parity with WaDesk's encrypted column is desired; if encrypted, search must use a separate strategy (see WD-TCHAT-020). Write the message, channel bump, read pointer and an outbox event `teamchat.message.posted` in one transaction (repo rule). Validate the mention ids against the roster and reply parent within the channel inside the same transaction; upload the attachment only after all checks pass.

### WD-TCHAT-010 — File and image attachments

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M (<=1 week) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-TCHAT-009
- **Summary:** A message can carry one file (image, PDF, common document). Images render inline; other files show as a named download card.
- **Actors & access:** members who can post.
- **UX & screens:** an attach (paperclip) button opens a file picker restricted by the input's `accept` list (`image/*`, PDF, `.doc`, `.docx`, `.xls`, `.xlsx`, `.txt`); files can also be dragged onto the stream (the stream is a drop target that highlights while dragging; only the first dropped file is used, no type filter on drop). A preview chip shows a thumbnail (images, read as a data URL) or a generic file icon, the file name, a human size (B/KB/MB) and a clear (×) button. In the stream, an image attachment is a clickable inline picture (max 280x280) opening in a new tab; other files render as a card with the file name opening in a new tab.
- **Endpoints:** carried by `POST team-inbox/api/team-chat` (WD-TCHAT-009).
- **Data:** `team_chat_messages.attachment_path` (varchar 255; storage path `team-chat/{workspaceId}/{generated name}` on `media_disk()`), `attachment_mime` (varchar 96, server-detected), `attachment_name` (varchar 191, client original name).
- **Rules & edge cases:**
  1. Server rule: any file up to 20480 KB. The `accept` list is client-only; the server does not restrict MIME types (docs list "images, PDFs and common document formats").
  2. Only one attachment per message; a message may be attachment-only (body null).
  3. The URL is built with `media_url(path)`, a public URL on the media disk, so anyone with the URL can fetch it (no signed URLs, no workspace check on download).
  4. Rendering is decided by the stored mime starting with `image/`.
  5. Deleting a message does not delete the stored file.
  6. `attachment_name` is limited by the column (191) but not validated; a very long client filename could truncate or error depending on DB mode.
- **Async & events:** upload progress events via XHR (WD-TCHAT-013). No virus scan, no thumbnailing.
- **External systems:** media disk (local `public` or an S3-compatible cloud disk chosen in admin storage settings, SET).
- **Settings:** admin cloud-storage/media-disk settings (SET domain).
- **Acceptance criteria:**
  - Given a 5 MB PNG, when sent, then the message shows an inline image using the media URL.
  - Given a 25 MB file, then the request is rejected with a validation error and no message is created.
  - Given a PDF, then the card shows the original file name and opens in a new tab.
  - Given an attachment-only message, then `body` is null and the bubble contains only the attachment.
- **Source refs:** app/Http/Controllers/TeamChatController.php (store), resources/js/charts/user-team-chat.js (setAttach, clearAttach, renderMessage), resources/views/user/team-inbox/team-chat.blade.php, app/Support/fc_helpers.php (media_disk, media_url)
- **Port notes:** Use the platform storage abstraction (SET) with tenant-prefixed keys; serve via short-lived signed URLs; enforce an allowlist of MIME types server-side and sniff content; add virus scan hook if CORE provides one. Delete or orphan-collect files when a message is deleted.

### WD-TCHAT-011 — Reply to a message

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-TCHAT-009
- **Summary:** A member can quote an earlier message in the same channel; the new message shows the parent's author and first 80 characters above its text. It is a single-level quote, not a separate thread view.
- **Actors & access:** members who can post.
- **UX & screens:** each bubble has a "Reply" link under it. Clicking sets `state.replyTo` and shows a banner above the composer ("Replying to NAME", first 80 chars of the parent, × cancel) and focuses the textarea; Escape cancels. On the bubble, the quote block shows the parent author name and the first 80 characters, with the fallback name "message" and empty snippet when the parent is not among the loaded messages (older than the latest 50 or deleted). Replying to an optimistic (not yet saved) message is impossible because the temp id is not numeric.
- **Endpoints:** `reply_to_id` on `POST team-inbox/api/team-chat`.
- **Data:** `team_chat_messages.reply_to_id` (self FK, ON DELETE SET NULL; soft-deleted parents keep the id).
- **Rules & edge cases:**
  1. Parent must be in the same channel (422 `parent_other_channel`).
  2. `reply_to_id` validation is `exists` on the whole table (not workspace-scoped) but the channel comparison then constrains it to the caller's channel.
  3. No reply counts, no thread panel, no unread tracking per thread.
  4. Replies also inherit the mention rules of a normal message.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given message M in channel C, when replying, then the new message has `reply_to_id = M` and the bubble shows the quote.
  - Given M belongs to channel D, then the API returns 422.
  - Given Escape while a reply banner is open, then the banner hides and no reply id is sent.
- **Source refs:** app/Http/Controllers/TeamChatController.php (store), resources/js/charts/user-team-chat.js (setReply, clearReply, renderMessage)
- **Port notes:** keep quote semantics; if the port adds real threads, treat that as a new feature. Return a small `reply_preview {id,author_name,snippet}` from the API so the quote works beyond the loaded window.

### WD-TCHAT-012 — @mentions (typeahead, token format, rendering)

- **Status:** partial
- **Priority:** P1 (expected by customers)
- **Effort:** M (<=1 week) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-TCHAT-009
- **Summary:** Typing `@` shows a filtered member picker; choosing one inserts a machine token that renders as a highlighted name. The server records valid mentioned user ids on the message but triggers nothing else.
- **Actors & access:** members who can post.
- **UX & screens:** the popover `#tc-mention-pop` is anchored above the textarea (max width 280 px, up to 6 rows) and appears when the text before the caret matches `@` followed by word characters at the start or after whitespace. It filters the workspace roster (excluding yourself) by case-insensitive substring of name or email, shows avatar initials, name and email, supports Arrow Up/Down (wraparound), Tab or Enter to insert, Escape to dismiss, mouse selection without blurring the input, and hides 200 ms after blur. Insertion replaces the typed `@prefix` with `@[Full Name](userId) ` (trailing space). In the stream, tokens render as pills (amber if it is you, green otherwise) with the display name only; raw text is HTML-escaped first, so tokens are the only markup. Clicking a member in the members rail also inserts a token at the caret (WD-TCHAT-015).
- **Endpoints:** carried by the send endpoint; server-side extraction described in WD-TCHAT-009.
- **Data:** `team_chat_messages.mentions` JSON array of ints (null when none).
- **Rules & edge cases:**
  1. Token format is `@[name](id)`; only the id matters server-side; the displayed name comes from the token text, so a forged name is displayed as typed (spoofable display).
  2. Ids are limited to the workspace roster; others are silently dropped from the JSON but remain visible as text pills.
  3. QUIRK / gap: no notification, no push, no unread-mention counter; the docs say only "highlighted". The mention array is exposed only inside the message payload and the broadcast payload.
  4. The picker uses `\w*` so names with spaces cannot be typed after `@`; only the first word narrows the list.
  5. Mentions of yourself via typing are not offered (list excludes self), but a pasted token for your own id is stored.
- **Async & events:** none (see gap above).
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given members Sam and Sara, when typing `@sa`, then both appear; Arrow Down + Enter inserts the highlighted one as `@[Sam](id) `.
  - Given a sent message with a valid token, then the response `mentions` contains the id and the stream shows a highlighted pill; for the mentioned user the pill is amber.
  - Given a token with an id outside the workspace, then `mentions` excludes it.
- **Source refs:** resources/js/charts/user-team-chat.js (detectMention, renderMentionPop, insertMention, renderBody), app/Http/Controllers/TeamChatController.php (store), resources/views/user/team-inbox/team-chat.blade.php (`#tc-mention-pop`)
- **Port notes:** Store mentions in a join table `team_chat_message_mentions(message_id,user_id)` for querying. Emit `teamchat.mention.created` through the outbox so NOTIF can deliver push/in-app alerts (an improvement over WaDesk; flag it as enhancement in the tracker). Resolve display names from the id at render time rather than trusting the token text.

### WD-TCHAT-013 — Optimistic send, upload progress and failed state

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M (<=1 week) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-TCHAT-009
- **Summary:** The bubble appears instantly when the user presses Send; the request runs in the background with an upload progress bar, and a failed send is marked in place.
- **Actors & access:** members.
- **UX & screens:** a temporary message with id `tmp-<timestamp>-<rand>` is pushed into state and rendered at 70 % opacity; the composer, reply and attachment are cleared immediately so the user can keep typing. For attachments an XHR upload-progress bar grows inside the bubble (0-100 %). On a 2xx with `ok`, the temp id becomes the server id, progress and opacity are removed and the channel list refreshes (unread reconciliation). On failure (non-2xx, `ok` false or network error) the bubble drops to 60 % opacity and a red banner shows the server `message` (for example the literal `parent_other_channel`), "Send failed" or "Network error". There is NO retry button (the header comment says one exists; it does not) and a failed bubble stays until reload. Image attachments preview via an object URL until replaced.
- **Endpoints:** POST as in WD-TCHAT-009 (XMLHttpRequest, `X-CSRF-TOKEN` from the page meta tag, `Accept: application/json`).
- **Data:** client-only state (`_temp`, `_status: sending|sent|failed`, `_attachFile`).
- **Rules & edge cases:**
  1. Clicking Reply/Delete on a temp bubble does nothing (id is not a number).
  2. Optimistic message uses the local clock; on reload it re-renders with server time (small clock skew visible).
  3. The poll's duplicate check compares ids, so a message returned by the poll before the XHR response arrives would appear twice (rare race, comment in code acknowledges).
  4. Message mentions are not computed client-side for the optimistic bubble (`mentions: []`) but the token renders as a pill from the text anyway.
- **Async & events:** XHR only.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a slow upload, when sending a file, then the bubble appears immediately with a progress bar reaching 100 %.
  - Given the server returns 422, then the bubble is dimmed and shows the reason, and the draft is not restored to the composer.
  - Given a network drop, then the banner reads "Network error".
- **Source refs:** resources/js/charts/user-team-chat.js (sendMessage, markMessageFailed, appendMessage)
- **Port notes:** Add a client-generated idempotency key so retry cannot duplicate; add a real retry button (improvement). Reconcile poll vs POST response by key rather than id.

### WD-TCHAT-014 — Read state and unread badges

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-TCHAT-003
- **Summary:** Each user has a per-channel "last read message id". Opening a channel or receiving new messages while it is open advances it; the channel list shows how many messages by others are newer.
- **Actors & access:** members; private membership rules apply.
- **UX & screens:** no explicit control. The client calls mark-read after every full load (with the newest id) and after each diff poll that returned messages. The list badge updates on the next 15 s refresh or after the next send.
- **Endpoints:**

| Method uri                              | Route name                              | Controller@action           | Middleware | Request                                                                    | Response             |
| --------------------------------------- | --------------------------------------- | --------------------------- | ---------- | -------------------------------------------------------------------------- | -------------------- |
| POST team-inbox/api/team-chat/mark-read | user.team-inbox.api.team-chat.mark-read | TeamChatController@markRead | web, auth  | JSON: `channel_id` (required int, exists), `last_id` (required int, min 0) | `{ok:true}`; 403/404 |

- **Data:** upserts `team_chat_channel_members` keyed `(channel_id,user_id)` with `last_read_message_id`, `last_read_at = now`, `joined_at = now`.
- **Rules & edge cases:**
  1. The value is written as given: it may move backwards and it is not verified to be an id in that channel.
  2. Every call overwrites `joined_at` with now (QUIRK), and creates a `member` role row for public channels on first use.
  3. It fires on the newest message id only; if the tab is hidden, polling still marks messages read (no visibility check), so unread never accumulates for the channel currently selected, even in a background tab.
  4. Unread counts only count messages by others; soft-deleted messages are excluded.
  5. There is no total-unread badge in the global nav, the inbox unread summary or the browser title.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 4 unread messages, when the user opens the channel, then mark-read is called with the newest id and the next list call returns unread 0.
  - Given `last_id` lower than the stored pointer, then the pointer is overwritten with the lower value (documented behavior; the port should use `GREATEST`).
  - Given no member row exists for a public channel, then one is created.
- **Source refs:** app/Http/Controllers/TeamChatController.php (markRead, channelsIndex), resources/js/charts/user-team-chat.js (markRead)
- **Port notes:** Use a monotonic upsert (`GREATEST`), track `joined_at` separately from read updates, and pause auto-read when the tab is hidden (improvement). Expose a total-unread count for the nav/badge via the NOTIF bell if product wants it.

### WD-TCHAT-015 — Members rail and member search

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-TCHAT-008
- **Summary:** The second column lists everyone in the workspace with a live member count and a client-side filter; clicking a person drops an @mention for them into the composer.
- **Actors & access:** members.
- **UX & screens:** heading "Team chat", "N members" (N is the roster length, "—" until loaded), a search input "Search members…" filtering by name or email (case-insensitive substring, client only), and a scrolling list of rows: coloured initials avatar, name (with "(you)" tag on the caller), email. Empty filter result: "No members match". Clicking another member (not yourself) opens the thread on mobile, inserts `@[Name](id) ` at the caret and focuses the textarea. There is no presence dot, role label or DM action (the API for presence exists but is unused). The rail always shows the whole workspace roster, not the channel's members.
- **Endpoints:** data comes from the `members` array of `GET team-inbox/api/team-chat` (WD-TCHAT-008).
- **Data:** roster = owner + `workspace_user` users, fields id, name, email, avatar.
- **Rules & edge cases:**
  1. The roster is refreshed on every full load only (channel switch, own delete, invitation decision), not on polls.
  2. The member email is exposed to every member (including viewers).
  3. Members link in column 1 goes to `/team-inbox/members` (admin-only page, WSP); non-admins are redirected to the inbox (agent/viewer) or get 403 (manager).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 10 members, then the header reads "10 members" and all appear.
  - Given the query "priya", then only matching name/email rows show.
  - Given a click on member X, then the composer contains their mention token and has focus.
- **Source refs:** resources/js/charts/user-team-chat.js (renderMembers, members-list click handler), resources/views/user/team-inbox/team-chat.blade.php, app/Http/Controllers/TeamChatController.php (index)
- **Port notes:** Show role and presence dots (WD-TCHAT-022/023); limit the payload to name and avatar and expose email only to admins if privacy requires. Use the WSP members read model instead of re-implementing the roster query.

### WD-TCHAT-016 — Delete message

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-TCHAT-009
- **Summary:** Authors can delete their own messages and workspace owners/admins can delete any message in the workspace.
- **Actors & access:** author, or owner/admin. Members only (`memberCheck`).
- **UX & screens:** a "Delete" link under a bubble is rendered when the message is mine or the caller is admin. Click shows a browser confirm "Delete this message?"; on OK the DELETE is sent and the whole channel is reloaded (full reload, which also re-marks read). Failure shows an alert "Delete failed" (network errors only; a 403 does not raise the alert because the JS ignores HTTP status).
- **Endpoints:**

| Method uri                           | Route name                            | Controller@action          | Middleware                | Request | Response                                                                |
| ------------------------------------ | ------------------------------------- | -------------------------- | ------------------------- | ------- | ----------------------------------------------------------------------- |
| DELETE team-inbox/api/team-chat/{id} | user.team-inbox.api.team-chat.destroy | TeamChatController@destroy | web, auth; `{id}` numeric | none    | `{ok:true}`; 404 (not found or other workspace); 403 "Not your message" |

- **Data:** soft-deletes the row (`deleted_at`). Reactions, files and replies pointing at it are left in place.
- **Rules & edge cases:**
  1. Lookup is by id and workspace only; channel membership is not checked, so an admin can delete messages in private channels they are not in (and an author who was removed from a channel can still delete).
  2. No time limit on deletion (unlike edit).
  3. No tombstone: the message vanishes from the author's view after reload; other open clients keep showing it until a full reload (see WD-TCHAT-008 rule 4).
  4. Replies to a deleted message keep `reply_to_id`; the quote falls back to "message".
  5. The stored attachment file is not removed.
- **Async & events:** none (no broadcast of deletion, no audit).
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given my message, when I delete it, then it no longer appears in history.
  - Given someone else's message and I am an agent, then 403 "Not your message".
  - Given I am admin, then I can delete any message in the workspace.
  - Given an id from another workspace, then 404.
- **Source refs:** app/Http/Controllers/TeamChatController.php (destroy), resources/js/charts/user-team-chat.js (deleteMessage)
- **Port notes:** Emit a `teamchat.message.deleted` realtime event so other clients drop it; keep soft delete with retention purge; write an audit entry for admin deletions of others' messages (improvement); delete or orphan-collect the attachment on purge.

### WD-TCHAT-017 — Edit message within 15 minutes

- **Status:** partial
- **Priority:** P2 (nice to have)
- **Effort:** S (<=2 dev-days) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-TCHAT-009
- **Summary:** The API lets an author change the text of their own message for 15 minutes and stamps `edited_at`; the stream already renders an "(edited)" tag, but there is no edit control in the UI.
- **Actors & access:** the author only (admins cannot edit others).
- **UX & screens:** no edit button; only the "(edited)" label rendering exists.
- **Endpoints:**

| Method uri                               | Route name                         | Controller@action       | Middleware                | Request                            | Response                                                                                                                   |
| ---------------------------------------- | ---------------------------------- | ----------------------- | ------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| PATCH team-inbox/api/team-chat/{id}/edit | user.team-inbox.api.team-chat.edit | TeamChatController@edit | web, auth; `{id}` numeric | `body` (required string, max 8000) | `{ok:true,message:<full message row>}`; 422 `{ok:false,error:"Edit window expired (15 min)"}`; 403 "Not your message"; 404 |

- **Data:** updates `team_chat_messages.body` (re-encrypted by the cast) and `edited_at = now`.
- **Rules & edge cases:**
  1. Window is measured from `created_at`; more than 15 whole minutes fails (`diffInMinutes` truncates, so up to 15:59 still passes).
  2. Max length is 8000 here versus 8192 on send.
  3. Mentions are NOT re-extracted, so editing tokens does not update the `mentions` array; the reply parent and attachment cannot be changed.
  4. Body is required, so an attachment-only message cannot be edited to empty and a text message cannot be cleared.
  5. Response returns the whole model including internal columns (pinned_by_user_id, workspace_id) and the decrypted body.
  6. Error key is `error` here while all other endpoints use `message` (inconsistent).
  7. No channel membership check; no broadcast.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given my message 5 minutes old, when I PATCH a new body, then `body` and `edited_at` update and the bubble shows "(edited)".
  - Given a message 20 minutes old, then 422 "Edit window expired (15 min)".
  - Given someone else's message, then 403.
- **Source refs:** app/Http/Controllers/TeamChatController.php (edit), resources/js/charts/user-team-chat.js (renderMessage "(edited)")
- **Port notes:** Build the UI (inline edit on own recent messages), re-extract mentions, keep the 15-minute window configurable, return a trimmed DTO, and keep a lightweight edit history if audit demands.

### WD-TCHAT-018 — Pin and unpin message

- **Status:** partial
- **Priority:** P2 (nice to have)
- **Effort:** S (<=2 dev-days) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-TCHAT-009
- **Summary:** The API toggles a message's pinned flag (author or workspace admin). Nothing reads it: pins are not returned by any list endpoint and the UI has no pin control or pinned view.
- **Actors & access:** author or owner/admin (docs say "channel admins or the message author"; code uses workspace admin, never channel admin).
- **UX & screens:** none.
- **Endpoints:**

| Method uri                              | Route name                        | Controller@action      | Middleware                | Request | Response              |
| --------------------------------------- | --------------------------------- | ---------------------- | ------------------------- | ------- | --------------------- |
| PATCH team-inbox/api/team-chat/{id}/pin | user.team-inbox.api.team-chat.pin | TeamChatController@pin | web, auth; `{id}` numeric | none    | `{ok:true,pinned:true | false}`; 403 "Pin requires author or admin"; 404 |

- **Data:** `team_chat_messages.pinned_at` (timestamp) and `pinned_by_user_id` (unsigned bigint, no FK). Toggle: if currently pinned, both set null; else set to now and the caller.
- **Rules & edge cases:**
  1. Single boolean state per message; multiple pins per channel allowed, no cap.
  2. Any author can unpin their own pin; an admin can unpin another's; a pin by admin on someone else's message can be removed by that message's author (author rule applies to the message, not the pinner).
  3. Not exposed in `index` responses, so a client cannot show pinned state or a pinned list.
  4. No channel membership check, no broadcast.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an unpinned message I authored, when I PATCH pin, then `pinned:true` and `pinned_at` is set; a second call returns `pinned:false`.
  - Given someone else's message and I am an agent, then 403.
  - Given an admin, then pin succeeds on any message.
- **Source refs:** app/Http/Controllers/TeamChatController.php (pin), database/migrations/2026_05_27_120000_team_chat_reactions_and_pins.php
- **Port notes:** Add pin state to the message DTO, a pin control on messages and a "Pinned" drawer per channel; consider limiting pin to channel admins as documented.

### WD-TCHAT-019 — Emoji reactions

- **Status:** partial
- **Priority:** P2 (nice to have)
- **Effort:** S (<=2 dev-days) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-TCHAT-009
- **Summary:** The API toggles an emoji reaction per user and message. Reactions are stored but never returned by any endpoint and have no UI.
- **Actors & access:** any member.
- **UX & screens:** none.
- **Endpoints:**

| Method uri                               | Route name                          | Controller@action        | Middleware                | Request                           | Response                                                                     |
| ---------------------------------------- | ----------------------------------- | ------------------------ | ------------------------- | --------------------------------- | ---------------------------------------------------------------------------- |
| POST team-inbox/api/team-chat/{id}/react | user.team-inbox.api.team-chat.react | TeamChatController@react | web, auth; `{id}` numeric | `emoji` (required string, max 16) | `{ok:true,reacted:true}` (added) or `{ok:true,reacted:false}` (removed); 404 |

- **Data:** `team_chat_reactions(message_id, user_id, workspace_id, emoji varchar 16, timestamps)`, unique `(message_id,user_id,emoji)` (`tcr_unique_per_user_per_emoji`), FK message and user cascade, index `(workspace_id,message_id)`. Raw `DB` inserts (no Eloquent model).
- **Rules & edge cases:**
  1. Toggle semantics: the second identical call by the same user deletes the row (Slack behavior); different emojis stack.
  2. Any string up to 16 chars is accepted (not validated as an emoji); a ZWJ sequence emoji can exceed 16 bytes/characters and be rejected.
  3. Lookup only checks message and workspace (soft-deleted messages are excluded); no channel membership check.
  4. Non-atomic read-then-write; a concurrent double tap can hit the unique index and 500.
  5. No reaction counts or names are returned anywhere; no realtime.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given no reaction, when POSTing thumbs-up, then `reacted:true` and one row exists; a repeat returns `reacted:false` and the row is gone.
  - Given two emojis by the same user, then two rows exist.
  - Given another workspace's message id, then 404.
- **Source refs:** app/Http/Controllers/TeamChatController.php (react), database/migrations/2026_05_27_120000_team_chat_reactions_and_pins.php
- **Port notes:** Implement as `INSERT ... ON CONFLICT DO NOTHING` / delete; add aggregated `reactions: [{emoji,count,mine,users}]` to message DTOs, an emoji picker and live updates; validate against a Unicode emoji allowlist.

### WD-TCHAT-020 — Search messages in a channel

- **Status:** partial
- **Priority:** P2 (nice to have)
- **Effort:** S (<=2 dev-days) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-TCHAT-009
- **Summary:** An endpoint searches one channel's messages by substring. The page has no search UI (the only search box filters members) and, because the body column is encrypted, the SQL LIKE cannot match plaintext.
- **Actors & access:** members with access to the channel (no `memberCheck`; `loadChannel` enforces workspace and channel access).
- **UX & screens:** none.
- **Endpoints:**

| Method uri                          | Route name                           | Controller@action         | Middleware | Request                                                                    | Response                                                                 |
| ----------------------------------- | ------------------------------------ | ------------------------- | ---------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| GET team-inbox/api/team-chat/search | user.team-inbox.api.team-chat.search | TeamChatController@search | web, auth  | `channel_id` (required int, exists), `q` (required string, min 2, max 191) | `{data:[{id,user_id,body,created_at,reply_to_id}]}` newest first, max 50 |

- **Data:** reads `team_chat_messages` `body LIKE %q%` with `%`, `_` and backslash escaped in the needle, scoped to workspace and channel.
- **Rules & edge cases:**
  1. QUIRK (defect): `body` is stored through Eloquent's `encrypted` cast, so the database holds ciphertext; `LIKE` on it matches essentially nothing useful (only accidental ciphertext substrings). Search therefore effectively returns empty.
  2. Result columns omit author name, attachment and channel; `body` in results would be decrypted by the cast.
  3. No pagination beyond the fixed 50; the docs' claim "client paginates beyond" has no implementation.
  4. Only the channel given is searched; there is no workspace-wide search.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given the port's intended behavior: messages "quarterly report" and "lunch", when searching "report", then only the first is returned with author and time, newest first, max 50.
  - Given `q` of 1 character, then 422.
  - Given a private channel without membership, then 403.
- **Source refs:** app/Http/Controllers/TeamChatController.php (search), app/Models/TeamChatMessage.php (encrypted cast)
- **Port notes:** Decide encryption vs search: either store plaintext body with Postgres full-text (`tsvector` + GIN, tenant-scoped) or keep encryption and search a separate normalized search index. Add UI (header search, results list jumping to a message). Do not port the LIKE-on-ciphertext bug.

### WD-TCHAT-021 — Typing indicator ping

- **Status:** partial
- **Priority:** P2 (nice to have)
- **Effort:** S (<=2 dev-days) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-TCHAT-008
- **Summary:** A client can ping "I am typing in channel X"; the server stores a short-lived cache key. The page never sends the ping and never shows typing state.
- **Actors & access:** members with access to the channel.
- **UX & screens:** none; docs describe a typing indicator that does not exist in the UI.
- **Endpoints:**

| Method uri                           | Route name                           | Controller@action         | Middleware | Request                             | Response    |
| ------------------------------------ | ------------------------------------ | ------------------------- | ---------- | ----------------------------------- | ----------- |
| POST team-inbox/api/team-chat/typing | user.team-inbox.api.team-chat.typing | TeamChatController@typing | web, auth  | `channel_id` (required int, exists) | `{ok:true}` |

- **Data:** cache key `tc:typing:{channelId}:{userId}` = true, TTL 8 seconds, on the default cache store (`CACHE_STORE`, default `database`). No table.
- **Rules & edge cases:**
  1. Comment says the client should ping about every 3 seconds while typing.
  2. Validation uses `exists` on the channel table (soft-deleted ids pass validation then 404 in `loadChannel`).
  3. No `memberCheck`; no throttle; with a database cache store each ping is a DB write.
- **Async & events:** none.
- **External systems:** cache store (database/redis).
- **Settings:** `CACHE_STORE`.
- **Acceptance criteria:**
  - Given a ping, then within 8 s the activity snapshot lists me as typing for other viewers of that channel; after 8 s I disappear.
  - Given a channel I cannot access, then 403.
- **Source refs:** app/Http/Controllers/TeamChatController.php (typing)
- **Port notes:** Use Redis with TTL or an in-memory presence map over the websocket gateway; broadcast typing as ephemeral events rather than polling.

### WD-TCHAT-022 — Online presence ping

- **Status:** partial
- **Priority:** P2 (nice to have)
- **Effort:** S (<=2 dev-days) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-TCHAT-002
- **Summary:** A client can ping "I am online in this workspace"; the server remembers it for 45 seconds. The shipped page never pings and shows no presence.
- **Actors & access:** any authenticated user with a current workspace (no membership check).
- **UX & screens:** none.
- **Endpoints:**

| Method uri                             | Route name                             | Controller@action           | Middleware | Request | Response    |
| -------------------------------------- | -------------------------------------- | --------------------------- | ---------- | ------- | ----------- |
| POST team-inbox/api/team-chat/presence | user.team-inbox.api.team-chat.presence | TeamChatController@presence | web, auth  | none    | `{ok:true}` |

- **Data:** cache key `tc:online:{workspaceId}:{userId}` = true, TTL 45 seconds.
- **Rules & edge cases:**
  1. Workspace-wide, not per channel.
  2. Independent of the separate agent status (`agent_statuses`, TIB2) that the inbox uses.
  3. Comment rationale: cheaper than websocket presence and works when Echo is not configured.
- **Async & events:** none.
- **External systems:** cache store.
- **Settings:** `CACHE_STORE`.
- **Acceptance criteria:**
  - Given a ping, then I appear in `online` for 45 s and then drop out.
  - Given no current workspace, then 403.
- **Source refs:** app/Http/Controllers/TeamChatController.php (presence)
- **Port notes:** Prefer a single workspace presence service shared with the inbox (TIB2) instead of a chat-only key; show dots in the members rail.

### WD-TCHAT-023 — Activity snapshot (who is typing, who is online)

- **Status:** partial
- **Priority:** P2 (nice to have)
- **Effort:** S (<=2 dev-days) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-TCHAT-021, WD-TCHAT-022
- **Summary:** Returns the user ids currently typing in a channel and online in the workspace, by probing the cache for every member. Intended to be polled about every 3 seconds; unused by the page.
- **Actors & access:** members with access to the channel.
- **UX & screens:** none (docs: "who is online or typing" in the header, absent).
- **Endpoints:**

| Method uri                            | Route name                             | Controller@action           | Middleware | Request                                                      | Response                               |
| ------------------------------------- | -------------------------------------- | --------------------------- | ---------- | ------------------------------------------------------------ | -------------------------------------- |
| GET team-inbox/api/team-chat/activity | user.team-inbox.api.team-chat.activity | TeamChatController@activity | web, auth  | `channel_id` (required int, not checked for existence in DB) | `{typing:[userIds], online:[userIds]}` |

- **Data:** reads cache keys above for each `workspace_user` user id (one cache lookup per member per key); typing excludes the caller; online includes the caller.
- **Rules & edge cases:**
  1. Iterates only the `workspace_user` pivot; the owner is included only if the owner also has a pivot row (normally true: provisioning attaches role `owner`).
  2. O(members) cache reads per call; the code notes it is fine to a few hundred users.
  3. Returns ids only; the client must join them with the roster.
  4. Notification domain's manifest lists this route under "activity" name-collision; it is unrelated to the audit Activity Log (NOTIF).
- **Async & events:** none.
- **External systems:** cache store.
- **Settings:** `CACHE_STORE`.
- **Acceptance criteria:**
  - Given user B pinged typing 2 s ago in channel C and presence 10 s ago, when A calls activity for C, then `typing` contains B and `online` contains B.
  - Given A also pinged typing, then A is absent from `typing` but may be in `online`.
- **Source refs:** app/Http/Controllers/TeamChatController.php (activity)
- **Port notes:** Replace with websocket presence state; if polling remains, use a single Redis `MGET`/set.

### WD-TCHAT-024 — Request or grant a teammate invitation

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M (<=1 week) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-TCHAT-002
- **Summary:** Anyone in the workspace can file a request to add a person by email (optionally to a channel). For owners/admins the request is auto-approved and applied immediately; for everyone else it is stored as pending for an admin.
- **Actors & access:** any workspace member (including viewers); admin for auto-approval.
- **UX & screens:** "+" next to People opens "Invite a teammate" (`#tc-invite-modal`): Email (required, type email), Name (optional, max 191), "Note for the admin" (optional, max 500), result line, Cancel / Submit invite. On success the result line shows the server message ("Member added" in green for approved, "Invitation submitted — waiting for admin approval" in amber for pending), closes after 1.5 s and refreshes the pending badge; errors show the server message or "Failed"/"Network error". There is no channel picker in the form.
- **Endpoints:**

| Method uri                                | Route name                                      | Controller@action                   | Middleware | Request                                                                                                                                                     | Response                       |
| ----------------------------------------- | ----------------------------------------------- | ----------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| POST team-inbox/api/team-chat/invitations | user.team-inbox.api.team-chat.invitations.store | TeamChatController@invitationsStore | web, auth  | `invitee_email` (required, email, max 191), `invitee_name` (nullable, max 191), `note` (nullable, max 500), `channel_id` (nullable int, exists in channels) | `{ok:true,id,status:"approved" | "pending",message}`; 422 `{ok:false,message:"Already a workspace member"}` |

- **Data:** inserts `team_chat_invitations` (workspace_id, channel_id, requester_user_id, invitee_user_id = user found by exact email or null, invitee_email, invitee_name = given or the found user's name, note, status `approved` when requester is admin else `pending`). Enum statuses `pending|approved|declined|expired`.
- **Rules & edge cases:**
  1. Duplicate check: if the email belongs to an existing user who is already on the roster and no channel was specified, return 422 "Already a workspace member". With a channel id it proceeds (used to add an existing member to a channel).
  2. No de-duplication of repeated requests for the same email (a member can create many pending rows) and no rate limit.
  3. For admin requesters, the row is created as approved and `applyApprovedInvitation` runs immediately (see WD-TCHAT-026); `decided_by_user_id` and `decided_at` stay null in this path (QUIRK: the "approved by" line never shows).
  4. If the email has no account, `invitee_user_id` is null; approval then does nothing, yet the admin sees "Member added" (QUIRK, misleading). No invitation email or sign-up link is sent.
  5. `invitee_user_id` is resolved only at creation; if the person registers later, approving the old request still does nothing (docs advise sending a signup link and then approving; that flow cannot work).
  6. `channel_id` is validated only as existing in the whole table: it is not required to be in this workspace, so an admin could pass another workspace's channel id and add the invitee to it (Open questions; do not port).
  7. Email matching is exact and case-sensitive per DB collation (utf8mb4_unicode_ci is case-insensitive, so effectively case-insensitive on MySQL).
- **Async & events:** none: no mail, no notification to admins about a pending request (admins only see the badge on next page load) and none to the invitee.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an agent submits an existing user's email, then a pending row is created and the message says it is waiting for admin approval.
  - Given an admin submits the same, then the row is approved, the user is added to `workspace_user` as `member` and the message is "Member added".
  - Given the email is already on the roster and no channel is given, then 422 "Already a workspace member".
  - Given an unknown email submitted by an admin, then the row is approved but no membership is created.
- **Source refs:** app/Http/Controllers/TeamChatController.php (invitationsStore, applyApprovedInvitation), resources/js/charts/user-team-chat.js, resources/views/user/team-inbox/team-chat.blade.php, database/migrations/2026_05_24_110000_team_chat_channels_and_invitations.php
- **Port notes:** This overlaps the WSP member-invite flow (`WorkspaceMembersController@invite`: permission `member.invite`, `user_seat_limit`, role grant rules, invite mail). Recommend the port routes chat invitations through the WSP invite service so seat limits and mail apply, and keep the chat-specific "request + admin approval" layer as a thin workflow. Fix the unknown-email case (send a real invite, link when they register) and validate the channel belongs to the workspace.

### WD-TCHAT-025 — Invitation list and Pending requests modal

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-TCHAT-024
- **Summary:** Shows recent invitation requests with status, requester, note and decision info. Admins see everyone's requests and can act on pending ones; non-admins see only their own.
- **Actors & access:** any member (scope depends on admin).
- **UX & screens:** the People section's "Pending requests" button opens "Pending invitations" (`#tc-pending-modal`, max 80 vh, scrollable). Each card shows invitee name (or email), email, "Requested by NAME · time", the note in quotes, "status by NAME · time" when decided, a status pill (amber pending, green approved, grey others) and, for admins on pending rows, Approve / Decline buttons. Empty state "No invitations yet"; loading text "Loading…". A count badge on the button shows the number of PENDING rows among the loaded ones; it is computed on page boot and after each submit or decision (hidden when zero).
- **Endpoints:**

| Method uri                               | Route name                                      | Controller@action                   | Middleware | Request | Response                                                                                                                                |
| ---------------------------------------- | ----------------------------------------------- | ----------------------------------- | ---------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| GET team-inbox/api/team-chat/invitations | user.team-inbox.api.team-chat.invitations.index | TeamChatController@invitationsIndex | web, auth  | none    | `{is_admin, invitations:[{id,invitee_email,invitee_name,requester_name,requester_email,status,note,decided_by,decided_at,created_at}]}` |

- **Data:** reads `team_chat_invitations` (workspace; admins all, others where requester is me), newest first (id desc), limit 50, plus users for names.
- **Rules & edge cases:**
  1. The controller comment says "everything pending" but the query returns ALL statuses; the badge counts only `pending` among the latest 50.
  2. `requester_name` falls back to "Unknown"; `decided_by` is null for auto-approved rows.
  3. The channel, if any, is not included in the response so the UI cannot show which channel an invite targets.
  4. No pagination past 50, no filter by status, no auto-expiry (`expired` is never set).
- **Async & events:** none (no polling of invitations; refreshed on open/submit/decision).
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given three requests by two agents, when agent A opens the modal, then only A's are listed; the admin sees all three.
  - Given 60 requests, then only the newest 50 are returned.
  - Given a pending request and an admin viewer, then Approve/Decline buttons are shown.
- **Source refs:** app/Http/Controllers/TeamChatController.php (invitationsIndex), resources/js/charts/user-team-chat.js (loadPending, renderPendingModal), resources/views/user/team-inbox/team-chat.blade.php
- **Port notes:** Add status filter, pagination, channel name, and a pending badge that also feeds the NOTIF bell for admins.

### WD-TCHAT-026 — Approve invitation (joins workspace and channel)

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M (<=1 week) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-TCHAT-024
- **Summary:** An owner/admin approves a pending request; if the invitee already has an account they are added to the workspace (role `member`) and to the target channel if one was specified.
- **Actors & access:** owner/admin only (403 otherwise).
- **UX & screens:** Approve button in the Pending modal; on success the modal re-renders, and the channel messages/roster are reloaded. Failure shows an alert with the server message ("Action failed" default) — for example "Already decided".
- **Endpoints:**

| Method uri                                             | Route name                                        | Controller@action                     | Middleware                | Request | Response                                                          |
| ------------------------------------------------------ | ------------------------------------------------- | ------------------------------------- | ------------------------- | ------- | ----------------------------------------------------------------- |
| POST team-inbox/api/team-chat/invitations/{id}/approve | user.team-inbox.api.team-chat.invitations.approve | TeamChatController@invitationsApprove | web, auth; `{id}` numeric | none    | `{ok:true}`; 422 `{ok:false,message:"Already decided"}`; 403; 404 |

- **Data:** updates the invitation (status `approved`, decided_by_user_id, decided_at); via `applyApprovedInvitation`: inserts `workspace_user` (workspace_id, user_id, role `member`, invited_at, joined_at, timestamps) if absent; `firstOrCreate` `team_chat_channel_members` (role `member`, joined_at) when `channel_id` is set.
- **Rules & edge cases:**
  1. Only status `pending` can be approved.
  2. If `invitee_user_id` is null nothing else happens (row is still marked approved; UI gives no warning).
  3. The new member gets role `member`, which is the legacy default of the `workspace_user.role` column but not one of the five current roles (owner, admin, manager, agent, viewer). QUIRK: the permission matrix aliases `member` to agent, but the role middleware hierarchy ranks an unknown role 0, so every role-gated page returns 403 for them, while the sidebar nav treats an unknown role as admin tier and shows every item. Port must assign a real role (default agent) or let the approver choose.
  4. Bypasses the plan `user_seat_limit` cap and the `member.invite` permission check used by the normal member-invite flow (WSP).
  5. Does not set the invitee's `current_workspace_id`, send mail or create a notification; the invitee only discovers the workspace through the workspace switcher.
  6. Idempotent for membership rows but not concurrency-safe.
  7. No audit-log entry.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** plan `user_seat_limit` is NOT applied here (gap).
- **Acceptance criteria:**
  - Given a pending request for an existing user not in the workspace, when an admin approves, then a `workspace_user` row exists and the request is approved with decider and time.
  - Given a request with `channel_id`, then the invitee is also a member of that channel.
  - Given an already approved request, then 422 "Already decided".
  - Given a non-admin caller, then 403.
- **Source refs:** app/Http/Controllers/TeamChatController.php (invitationsApprove, applyApprovedInvitation), app/Support/WorkspacePermissions.php, app/Http/Controllers/WorkspaceMembersController.php (seat cap for comparison)
- **Port notes:** Call the WSP member-add service (seat cap, role, welcome mail, audit) and emit `teamchat.invitation.approved`. Let approver choose role, default agent. Wrap the status update and membership insert in one transaction.

### WD-TCHAT-027 — Decline invitation

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-TCHAT-024
- **Summary:** An owner/admin rejects a pending request; nobody is added.
- **Actors & access:** owner/admin only.
- **UX & screens:** Decline button in the Pending modal; the card then shows a grey "declined" pill and "declined by NAME · time".
- **Endpoints:**

| Method uri                                             | Route name                                        | Controller@action                     | Middleware                | Request | Response                                     |
| ------------------------------------------------------ | ------------------------------------------------- | ------------------------------------- | ------------------------- | ------- | -------------------------------------------- |
| POST team-inbox/api/team-chat/invitations/{id}/decline | user.team-inbox.api.team-chat.invitations.decline | TeamChatController@invitationsDecline | web, auth; `{id}` numeric | none    | `{ok:true}`; 422 "Already decided"; 403; 404 |

- **Data:** updates the invitation: status `declined`, `decided_by_user_id`, `decided_at`.
- **Rules & edge cases:**
  1. Only `pending` rows can be declined.
  2. No reason field, no notification to the requester, no re-request block.
  3. The requester can submit the same email again immediately.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a pending request, when an admin declines it, then status is `declined` and no membership rows are created.
  - Given a declined request, when declined again, then 422 "Already decided".
  - Given a non-admin, then 403.
- **Source refs:** app/Http/Controllers/TeamChatController.php (invitationsDecline)
- **Port notes:** Notify the requester via NOTIF (improvement) and allow an optional decline reason.

### WD-TCHAT-028 — Realtime MessagePosted broadcast event

- **Status:** dead-code
- **Priority:** P2 (nice to have)
- **Effort:** S (<=2 dev-days) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-TCHAT-009
- **Summary:** Every successful send tries to broadcast a `team-chat.posted` event on a private workspace channel, but nothing authorizes the channel and nothing listens, so live updates are actually done by polling.
- **Actors & access:** server-side only.
- **UX & screens:** none.
- **Endpoints:** none.
- **Data:** payload `{message_id, user_id, reply_to_id, mentions, created_at}`; private channel `workspace.{workspaceId}.team-chat`, event name `team-chat.posted`, sent with `toOthers()` and `ShouldBroadcastNow` (synchronous).
- **Rules & edge cases:**
  1. `routes/channels.php` defines authorization only for `workspace.{id}.inbox` and `conversation.{id}`; there is no callback for `.team-chat`, so a browser subscription would be rejected.
  2. No JS subscribes (grep across resources/js finds no Echo listener for this event).
  3. Default `BROADCAST_CONNECTION` is `log`; with Pusher enabled the call performs an outbound HTTP request inside the request thread; failures are caught and logged as a warning.
  4. Edits, deletes, pins, reactions and typing emit no events at all.
- **Async & events:** the event itself.
- **External systems:** Pusher-compatible broadcaster (admin real-time settings, CORE/SET).
- **Settings:** `BROADCAST_CONNECTION`, admin real-time (Pusher) settings.
- **Acceptance criteria:**
  - (Target behavior) Given two clients on the same channel, when A posts, then B receives the message within 1 second without polling, and a client outside the workspace cannot subscribe.
  - Given the realtime service is down, then the send still succeeds.
- **Source refs:** app/Events/TeamChat/MessagePosted.php, app/Http/Controllers/TeamChatController.php (store), routes/channels.php
- **Port notes:** Implement realtime as a first-class transport (websocket/SSE gateway with tenant auth on connect) with events for message created/edited/deleted, reaction, pin, typing and read; fire from the outbox after commit, not inline in the request.

### WD-TCHAT-029 — Mobile layout (channel list home, thread slide-over)

- **Status:** implemented
- **Priority:** P2 (nice to have)
- **Effort:** S (<=2 dev-days) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-TCHAT-001
- **Summary:** On screens under 1024 px the channel list is the home screen and the conversation slides over it when a channel is opened, with a back arrow returning to the list.
- **Actors & access:** members.
- **UX & screens:** the header back button (`#tc-back`, visible below `lg`) removes the `mobile-thread-open` class from `#tc-frame`; opening a channel (tap in the list, creating a channel, tapping a member in the rail) adds it. The auto-selection on boot does not open the thread so the user lands on the list. The channel type pill and the header icon are hidden on small screens. CSS lives in `resources/css/wadesk.css` (`.ti-frame` rules shared with the inbox).
- **Endpoints:** none.
- **Data:** none (client state).
- **Rules & edge cases:**
  1. Tapping a member first reveals the thread, then writes the mention so the keyboard can appear.
  2. No unread indicator on the device tab title.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a 390 px viewport, when the page loads, then the channel list shows and the stream is hidden.
  - Given a tap on a channel, then the thread shows; tapping back shows the list again.
- **Source refs:** resources/js/charts/user-team-chat.js (openThreadMobile, closeThreadMobile), resources/views/user/team-inbox/team-chat.blade.php, resources/css/wadesk.css
- **Port notes:** Responsive layout in `apps/web`; keep list-first navigation on mobile. Consider a PWA/push surface via NOTIF later.

### WD-TCHAT-030 — Entry points and navigation into Team Chat

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-TCHAT-001
- **Summary:** Team Chat is reachable from several places, each with different visibility.
- **Actors & access:** varies per entry point.
- **UX & screens:** (1) Sidebar nav item "Team Chat" in the "Inbox & Chat" group, tier `manager` (hidden from agents and viewers; nav registry `UserNav`, ASHELL). (2) Team Inbox left-rail icon button titled "Team chat" (`ti-rl-btn`) and a "Internal team chat — Slack-style channels for staff only." card in the inbox Tools flyout, both linking to `/team-chat` (visible to whoever can see the inbox, including agents; TIB1 view `user/team-inbox/index.blade.php`). (3) Global command palette entry "Team Chat — Internal team channels" with keywords "staff slack channels" (`resources/js/wadesk.js`). (4) Return links on the chat page: "Customer chats" to `/team-inbox` and "Members" to `/team-inbox/members`. The docs say the entry is a top-navigation "Chat" item; the code puts it in the sidebar group and inbox rail.
- **Endpoints:** GET team-chat (WD-TCHAT-001).
- **Data:** none.
- **Rules & edge cases:**
  1. Nav tier `manager` is UI-only; the route itself has no role gate (WD-TCHAT-002).
  2. The chat page reuses nav key `team-inbox`, so the "Unified Inbox" item is highlighted while in Team Chat.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** admin "user_dashboard_layout" (topbar vs sidebar) decides which shell shows the nav item.
- **Acceptance criteria:**
  - Given a manager in sidebar layout, then "Team Chat" appears under Inbox & Chat.
  - Given an agent, then no nav item but the inbox rail button opens the page.
  - Given the command palette query "slack", then "Team Chat" is offered.
- **Source refs:** app/Support/UserNav.php, resources/views/user/team-inbox/index.blade.php, resources/js/wadesk.js, resources/views/user/team-inbox/team-chat.blade.php
- **Port notes:** Register the module in the web nav config with role visibility driven by RBAC permission (e.g., `teamchat.use`), and add the rail button and command-palette entry.

### WD-TCHAT-031 — Legacy per-workspace read pointer (team_chat_reads)

- **Status:** dead-code
- **Priority:** P2 (nice to have)
- **Effort:** S (<=2 dev-days) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** none
- **Summary:** The first-phase design tracked one read pointer per user per workspace in `team_chat_reads`. The multi-channel rewrite moved this to `team_chat_channel_members.last_read_message_id` and left the table and model unused.
- **Actors & access:** none.
- **UX & screens:** none.
- **Endpoints:** none.
- **Data:** `team_chat_reads(workspace_id,user_id,last_read_message_id default 0,last_read_at)` unique `(workspace_id,user_id)`; model `TeamChatRead`. Both empty and never referenced in code.
- **Rules & edge cases:**
  1. Do not port; keep documented so the orphan table is accounted for.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a search of the codebase, then no controller, service or view reads or writes `TeamChatRead`.
  - Given the port schema, then no equivalent table is created.
  - Given a data migration from WaDesk, then rows of `team_chat_reads` are ignored.
- **Source refs:** app/Models/TeamChatRead.php, database/migrations/2026_05_24_100000_create_team_chat_messages_table.php
- **Port notes:** Skip entirely; use per-channel read pointers only.

### WD-TCHAT-032 — Demo teammates seeder (dev tool)

- **Status:** implemented
- **Priority:** P2 (nice to have)
- **Effort:** S (<=2 dev-days) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** none
- **Summary:** A developer-run seeder creates ten fake teammates in a workspace so Team Chat's member list and mobile layout can be tested realistically.
- **Actors & access:** developer via CLI (`db:seed --class=TeamChatDemoMembersSeeder`); not run by default seeding.
- **UX & screens:** console output only (users created, linked, workspace member total).
- **Endpoints:** none.
- **Data:** creates `users` with emails `<first>.<last>@wadesk-demo.test` (a domain that cannot receive mail), verified now, random unusable password; inserts `workspace_user` rows with role `agent` (eight) or `manager` (two: Sneha Iyer, Karan Mehta), invited_at/joined_at now.
- **Rules & edge cases:**
  1. Idempotent: users matched by email, pivot inserted only when missing.
  2. Target workspace = env `SEED_WORKSPACE_ID` if set, else the lowest-id workspace. The docblock also mentions a `--workspace=2` flag that the code does not read (docs/code mismatch).
  3. Cleanup hint: delete users with the `@wadesk-demo.test` domain.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** env `SEED_WORKSPACE_ID`.
- **Acceptance criteria:**
  - Given a workspace with one member, when the seeder runs twice, then the workspace has 11 members and the second run adds nothing.
  - Given `SEED_WORKSPACE_ID=2`, then members are added to workspace 2.
  - Given the created accounts, then none can receive email (test TLD).
- **Source refs:** database/seeders/TeamChatDemoMembersSeeder.php
- **Port notes:** Provide an equivalent dev seed script in `apps/api` (not run in production); use the repo's seeding conventions and RLS-aware tenant context.

## Data model

All six tables are MySQL/InnoDB, utf8mb4, timestamps nullable. WaDesk foreign keys enforce cascade rules noted below. None of them has row-level isolation: tenant scoping is by hand-written `workspace_id` predicates. Expected volumes: channels tens per workspace, messages up to hundreds of thousands per busy workspace, reactions and reads small.

### team_chat_channels

Purpose: channels within a workspace. Features: 001, 003-007, 009, 026.

- `id` bigint unsigned PK.
- `workspace_id` bigint unsigned NOT NULL, FK `workspaces(id)` ON DELETE CASCADE.
- `name` varchar(64) NOT NULL: lower-case display name (shown as `#name`).
- `slug` varchar(64) NOT NULL: `Str::slug(name)` (underscores become dashes).
- `description` text NULL (validated max 255 on create).
- `type` enum `public|private|dm` NOT NULL default `public`.
- `created_by_user_id` bigint unsigned NULL, FK users ON DELETE SET NULL (null for the auto-created `general`).
- `last_message_at` timestamp NULL, updated on each send; returned to the UI, not used for ordering.
- `deleted_at` soft delete; `created_at`, `updated_at`.
- Indexes: unique `(workspace_id, slug)` (includes soft-deleted rows), `(workspace_id, type)`, FK index on created_by.

### team_chat_channel_members

Purpose: explicit membership for private/dm channels and per-user read pointer for every channel. Features: 005, 009, 014, 026.

- `id` PK; `channel_id` FK channels ON DELETE CASCADE; `user_id` FK users ON DELETE CASCADE.
- `role` enum `admin|member` default `member` (admin only for private creators; never read).
- `last_read_message_id` bigint unsigned NOT NULL default 0; `last_read_at` timestamp NULL; `joined_at` timestamp NULL (overwritten on every read/post).
- Unique `(channel_id, user_id)`. No workspace_id column (add one for RLS).

### team_chat_messages

Purpose: all channel messages. Features: 008-020, 028. Model `TeamChatMessage` (soft deletes; `body` cast `encrypted`; `mentions` cast array).

- `id` PK; `workspace_id` NOT NULL FK workspaces CASCADE; `channel_id` bigint NULL FK channels ON DELETE CASCADE (nullable because of the phase-2 backfill; NOT mass-assignable in the model, see defect).
- `user_id` NOT NULL FK users CASCADE (deleting a user deletes their messages).
- `body` text NULL (ciphertext in DB; plaintext max 8192 on send, 8000 on edit).
- `mentions` JSON NULL: array of user ids (roster-validated at send).
- `reply_to_id` NULL FK self ON DELETE SET NULL (soft-deleted parents keep the id).
- `attachment_path` varchar(255), `attachment_mime` varchar(96), `attachment_name` varchar(191), all NULL.
- `edited_at` timestamp NULL; `pinned_at` timestamp NULL; `pinned_by_user_id` bigint NULL (no FK).
- `deleted_at` soft delete; timestamps.
- Indexes: `(workspace_id, id)`, `(workspace_id, created_at)`, `(channel_id, id)` (the query path), FK indexes on user and reply_to.
- Ordering: by `id`; day separators and timestamps come from `created_at`.

### team_chat_reactions

Purpose: emoji reactions. Feature: 019. No Eloquent model (raw `DB` access).

- `id` PK; `message_id` FK messages ON DELETE CASCADE; `user_id` FK users CASCADE; `workspace_id` bigint NOT NULL (no FK); `emoji` varchar(16); timestamps.
- Unique `tcr_unique_per_user_per_emoji (message_id,user_id,emoji)`; index `(workspace_id, message_id)`.

### team_chat_invitations

Purpose: invite requests with admin approval. Features: 024-027.

- `id` PK; `workspace_id` FK CASCADE; `channel_id` NULL FK channels ON DELETE SET NULL (null = workspace only).
- `requester_user_id` NOT NULL FK users CASCADE; `invitee_user_id` NULL FK users SET NULL; `invitee_email` varchar(191) NULL (always filled by the API); `invitee_name` varchar(191) NULL.
- `status` enum `pending|approved|declined|expired` default `pending` (`expired` never written).
- `note` text NULL (max 500 on input); `decided_by_user_id` NULL FK users SET NULL; `decided_at` NULL.
- Index `(workspace_id, status)`.

### team_chat_reads

Purpose: legacy per-workspace read pointer, unused (feature 031). `workspace_id`, `user_id` (FK cascade), `last_read_message_id` default 0, `last_read_at`; unique `(workspace_id,user_id)`. Model `TeamChatRead`.

Non-table state: cache keys `tc:typing:{channelId}:{userId}` (8 s TTL) and `tc:online:{workspaceId}:{userId}` (45 s TTL). Files: `team-chat/{workspaceId}/...` on the media disk.

Tables owned elsewhere but written here: `workspace_user` (WSP) via approved invitations: inserts role `member` with invited_at and joined_at.

## Cross-domain contracts

- Consumes WSP: `workspaces.owner_user_id`, `workspace_user(role)` for roster and admin checks; `users.current_workspace_id` (AUTH/WSP) as tenant context. WRITES `workspace_user` when an invitation is approved (bypassing seat limits: WSP should expose an "add member" service the port calls instead).
- Consumes RBAC: role names (`owner|admin|manager|agent|viewer`) and nav tiers; exposes no permission keys today; the port should add keys (WD-TCHAT-002).
- Consumes SET/CORE: media disk and `media_url` for attachments (WD-TCHAT-010), cache store for presence/typing, broadcast configuration for the unused realtime event.
- Consumes ASHELL: navigation registry item `team-chat` (tier manager) and the command palette.
- Consumes TIB1: the shared `ti-frame` layout CSS and inbox links; the inbox left rail and Tools card link to `/team-chat` (owned by TIB1 view `user/team-inbox/index.blade.php`, referenced here only).
- Exposes to NOTIF (currently nothing): future events `teamchat.message.posted`, `teamchat.mention.created`, `teamchat.invitation.pending`.
- Notification domain note: the audit "Activity Log" (NOTIF) is unrelated to the chat `activity` endpoint that NOTIF's inventory deferred here.
- RBAC inventory already records that team-chat routes carry no role gate (WD-RBAC quirk list).

## Open questions & quirks

1. CRITICAL: `TeamChatMessage::$fillable` lacks `channel_id`, so `create()` drops it (autoload check: `isFillable('channel_id')` is false). Posted messages get `channel_id = NULL` and disappear from history, diff-poll, unread and search. The local reference DB has zero chat rows, so this could not be confirmed against data. Live parity verification must post a message and reload. The port must persist `channel_id`.
2. `body` is `encrypted`-cast, so SQL LIKE search cannot work (WD-TCHAT-020). Whether product wants encrypted-at-rest and searchable chat is a decision for the port.
3. UI gaps versus docs: no UI for edit, pin, reactions, search, typing, presence, channel delete, load-older messages, channel member management or DM creation; the header does not show online/typing; the docs describe the entry as a top-nav "Chat" item. All API-only features are marked `partial`; DMs are `docs-only`.
4. `MessagePosted` broadcasts to a private channel that has no authorization callback and no listener; realtime is effectively polling (3 s messages, 15 s channels). Marked dead-code.
5. Deletions and edits by other users are not synced to open clients until a full reload; diff polling only appends and can skip messages if more than 50 arrive between polls.
6. Approved invitations insert `workspace_user` with the legacy role `member` (not one of the five current roles; middleware ranks it 0, permission matrix aliases it to agent, nav treats it as admin tier), and bypass the `user_seat_limit` and `member.invite` checks; no mail or notification is sent; unknown-email invites are silently no-ops while admins are told "Member added"; a later sign-up cannot be linked because `invitee_user_id` is fixed at request time.
7. Invitation `channel_id` is validated with a global `exists`, not workspace-scoped; an admin (auto-approve) or approver could add a user into a channel of another workspace by id. Do not port.
8. Message-scoped endpoints (edit, pin, react, delete) check workspace but not channel membership; private-channel messages are addressable by id by any workspace member (and deletable by admins).
9. Search, typing, presence and activity skip `memberCheck`; and channel deletion leaves the slug reserved by the unique index (recreation 500s).
10. `team_chat_channel_members.joined_at` is overwritten on every read/post; `last_read_message_id` can move backwards; `role` `admin` on channel members is never used; docs claim "channel admins can pin" but only workspace admins can.
11. Mentions notify nobody (no notification, push or email); tokens carry the display name in the text and are spoofable.
12. The docs claim edit/pin/react/search are user-facing "things you can do"; the JS explicitly supports only reply and delete. The JS file header lists features that match this.
13. An impersonating platform admin without a pivot row is rejected by `memberCheck`, unlike the role middleware which lets platform admins through.
14. `expired` invitation status is never written; there is no expiry sweeper.
15. Attachment URLs are public and files are not removed on message delete; server has no MIME allowlist (only the client `accept` attribute).
16. Seeder docblock mentions a `--workspace` flag not implemented; only env `SEED_WORKSPACE_ID` works.
17. No tests exist in the reference for team chat. No console commands, schedules or Node/bridge files touch this domain.
18. The retry button described in the JS comments for failed sends does not exist.

## Coverage

```json wadesk-coverage
{
  "routes": [
    "GET team-chat",
    "GET team-inbox/api/team-chat",
    "POST team-inbox/api/team-chat",
    "GET team-inbox/api/team-chat/activity",
    "GET team-inbox/api/team-chat/channels",
    "POST team-inbox/api/team-chat/channels",
    "DELETE team-inbox/api/team-chat/channels/{id}",
    "GET team-inbox/api/team-chat/invitations",
    "POST team-inbox/api/team-chat/invitations",
    "POST team-inbox/api/team-chat/invitations/{id}/approve",
    "POST team-inbox/api/team-chat/invitations/{id}/decline",
    "POST team-inbox/api/team-chat/mark-read",
    "POST team-inbox/api/team-chat/presence",
    "GET team-inbox/api/team-chat/search",
    "POST team-inbox/api/team-chat/typing",
    "DELETE team-inbox/api/team-chat/{id}",
    "PATCH team-inbox/api/team-chat/{id}/edit",
    "PATCH team-inbox/api/team-chat/{id}/pin",
    "POST team-inbox/api/team-chat/{id}/react"
  ],
  "controllers": ["app/Http/Controllers/TeamChatController.php"],
  "services": [],
  "models": [
    "TeamChatChannel",
    "TeamChatChannelMember",
    "TeamChatInvitation",
    "TeamChatMessage",
    "TeamChatRead"
  ],
  "tables": [
    "team_chat_channels",
    "team_chat_channel_members",
    "team_chat_invitations",
    "team_chat_messages",
    "team_chat_reactions",
    "team_chat_reads"
  ],
  "views": ["resources/views/user/team-inbox/team-chat.blade.php"],
  "commands": [],
  "permissions": [],
  "middleware": [],
  "node_files": [],
  "js_assets": ["resources/js/charts/user-team-chat.js"],
  "misc_files": ["app/Events/TeamChat/MessagePosted.php"],
  "config_files": [],
  "doc_pages": ["Documentation/pages/messaging/team-chat.html"],
  "feature_map": {
    "WD-TCHAT-001": ["GET team-chat"],
    "WD-TCHAT-002": [],
    "WD-TCHAT-003": ["GET team-inbox/api/team-chat/channels"],
    "WD-TCHAT-004": ["POST team-inbox/api/team-chat/channels"],
    "WD-TCHAT-005": [],
    "WD-TCHAT-006": ["DELETE team-inbox/api/team-chat/channels/{id}"],
    "WD-TCHAT-007": [],
    "WD-TCHAT-008": ["GET team-inbox/api/team-chat"],
    "WD-TCHAT-009": ["POST team-inbox/api/team-chat"],
    "WD-TCHAT-010": [],
    "WD-TCHAT-011": [],
    "WD-TCHAT-012": [],
    "WD-TCHAT-013": [],
    "WD-TCHAT-014": ["POST team-inbox/api/team-chat/mark-read"],
    "WD-TCHAT-015": [],
    "WD-TCHAT-016": ["DELETE team-inbox/api/team-chat/{id}"],
    "WD-TCHAT-017": ["PATCH team-inbox/api/team-chat/{id}/edit"],
    "WD-TCHAT-018": ["PATCH team-inbox/api/team-chat/{id}/pin"],
    "WD-TCHAT-019": ["POST team-inbox/api/team-chat/{id}/react"],
    "WD-TCHAT-020": ["GET team-inbox/api/team-chat/search"],
    "WD-TCHAT-021": ["POST team-inbox/api/team-chat/typing"],
    "WD-TCHAT-022": ["POST team-inbox/api/team-chat/presence"],
    "WD-TCHAT-023": ["GET team-inbox/api/team-chat/activity"],
    "WD-TCHAT-024": ["POST team-inbox/api/team-chat/invitations"],
    "WD-TCHAT-025": ["GET team-inbox/api/team-chat/invitations"],
    "WD-TCHAT-026": ["POST team-inbox/api/team-chat/invitations/{id}/approve"],
    "WD-TCHAT-027": ["POST team-inbox/api/team-chat/invitations/{id}/decline"],
    "WD-TCHAT-028": [],
    "WD-TCHAT-029": [],
    "WD-TCHAT-030": [],
    "WD-TCHAT-031": [],
    "WD-TCHAT-032": []
  }
}
```
