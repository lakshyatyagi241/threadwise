---
domain: whatsapp-personal-groups
code: WAGRP
title: WhatsApp Groups on Personal (Unofficial, Baileys) Numbers
threadwise_version: '1.7.0'
sources_read: 46
---

# WhatsApp Groups on Personal (Unofficial, Baileys) Numbers

## Overview

This domain covers everything Reference does with **WhatsApp groups on a personal number** (the "Unofficial API", internal engine `baileys`, a phone linked like WhatsApp Web through the Node bridge): reading the groups a number belongs to, creating a group, changing members, name, description and restrictions, leaving, invite links, receiving group messages into the team inbox, replying into a group, posting an order notice into a customer's group with an @mention, and the group directory with ordering codes. It also records, feature by feature, what our **official** Cloud API groups feature (`docs/specs/waba-groups-management.md`, inventory TW-WABA-039 and 040) already gives that a personal number should mirror, and what is new in the port (status `port-addition`). Device pairing, sessions, proxy and the engine switch are owned by WADEV (`whatsapp-devices-baileys.md`); the bridge process and its generic send/receive plumbing by NODE (`node-bridge-runtime.md`). This file owns the group-specific behavior of both.

Who uses it:

- **Workspace member on the mobile app** (any authenticated member of the workspace; Reference puts no role check on these routes) creates and manages groups through `api/app/groups*` and chats in them through the `api/app/chats*` endpoints.
- **Workspace admin on the web** sees group threads in the team inbox like any other thread, replies into them, and has exactly one group screen: `/store/groups` (the synced directory with an "ordering code" per group, part of the Store area). **Reference has no web screen to create or manage a personal-number group**; the management surface is the mobile API only.
- **Customers inside a group** are never contacted by automation: the bot number is a member of a customer's group and the order flow posts an order notice there with an @mention.
- **The Node bridge** holds one Baileys socket per number, mirrors the group directory to Laravel, forwards group messages, and exposes ten group passthrough routes plus one group-send route.
- **Platform super-admin** only through WADEV: the whole engine is off unless allowed.

Main flows end to end:

1. **Directory sync.** A number connects; 7 s later (and 5 s after any participant change or newly seen group) the bridge lists the groups the account participates in and posts them to Laravel; Laravel upserts one `wa_groups` row per group and replaces each group's member list in one transaction. The directory feeds the ordering flow (find a customer's group by phone, post with @mention) and the `/store/groups` screen. (TW-WAGRP-003, 022 to 024)
2. **Manage from the app.** The app lists groups (live roster merged with a local conversation mirror), opens one (metadata plus "can this device send"), creates one, edits members/name/description/restrictions, gets or rotates the invite link, leaves, or "opens a chat" for a group that already exists on WhatsApp. Every call resolves a Baileys device on the workspace, then calls the bridge. (TW-WAGRP-004 to 014)
3. **Group chat in the inbox.** A message in a group reaches the bridge as a normal `messages.upsert`; the bridge sends only the narrow "store it" call to Laravel (no flow, keyword reply or AI at the bridge); Laravel files it on the single workspace-wide thread for that group, titled with the group subject, with the speaker's number on the message. Operators reply from the web inbox or the app; the reply is forced onto Baileys and addressed to the group JID. (TW-WAGRP-015 to 021)

Plan tiers and gates: Reference has **no group-specific plan limit, plan feature or permission key**. Groups ride on the engine gates owned by WADEV (`device_limit`, enabled engines) and on the roles of the screen: the web group screen requires workspace role `admin` (the `/store` area); the mobile group API requires only an authenticated workspace member. In our repo the engine is additionally behind the platform switch plus per-workspace allow-list (`unofficial_whatsapp` entitlement, 422 `WA_UNOFFICIAL_DISABLED`).

### What Reference does NOT do with groups (so nobody ports a rumour)

| Capability                                                                 | Reference                                                                                                                                                                                         |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Broadcast, campaign or bulk scheduled message to a WhatsApp group          | **No.** Audience pickers use contact groups (Reference's own tag-like lists, a different thing) and phone numbers; no `@g.us` audience exists in any broadcast, campaign or scheduled-bulk code.  |
| Flows, keyword auto-reply or AI agent on a group                           | **Not at the bridge** (deliberately skipped). Laravel's inbound handler has no group guard and still runs part of the pipeline (TW-WAGRP-018, QUIRK).                                             |
| Join a group by invite link or code (`groupAcceptInvite`, invite preview)  | **No** (the bot is added by a human on WhatsApp). Port addition only (TW-WAGRP-030).                                                                                                              |
| Group picture (`updateProfilePicture`)                                     | **No.** Port addition only (TW-WAGRP-031).                                                                                                                                                        |
| Join-approval mode, pending join requests, approve or reject               | **No** (no call to `groupJoinApprovalMode`, `groupRequestParticipantsList` or `groupRequestParticipantsUpdate`; the event `group.join-request` is not listened to). Port addition (TW-WAGRP-029). |
| Ephemeral (disappearing) messages setting, "members can add members" mode  | **No** (`groupToggleEphemeral` and `groupMemberAddMode` unused). Not planned.                                                                                                                     |
| Reacting to, replying with a mention, or tagging inside the inbox composer | **No.** Mentions exist only in the order notifier (TW-WAGRP-020, 024).                                                                                                                            |
| Delete a group, or remove every member and leave in one step               | **No.** WhatsApp has no delete: the only exit is leave (TW-WAGRP-011).                                                                                                                            |
| Web screen to create or manage a group                                     | **No** (mobile API only). Port addition (TW-WAGRP-027, 028).                                                                                                                                      |
| Reacting to the `groups.update` event (rename, restrictions changed)       | **No**; only `groups.upsert` (new group) and `group-participants.update` trigger a directory sync, and the pairing-code start path registers only the second (TW-WAGRP-003).                      |

### Official (Cloud API) groups versus personal-number groups: what to mirror

Our official feature is described in `docs/specs/waba-groups-management.md` and inventory TW-WABA-039/040. The two have different shapes (Meta groups are invite-only, created by the business, no add-by-number; Baileys groups are ordinary WhatsApp groups where the account can add people if it is an admin). The matrix says what a personal-number group screen should mirror from the official one.

| Capability                               | Reference, personal (Baileys)                          | Our official (WABA) groups                                          | Personal port plan                                                                   |
| ---------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Screen with KPIs, create, list, rows     | Mobile only; web has the ordering-code directory       | `/waba-groups` (rail, KPIs, create form, rows, invite panel)        | Mirror as `TW-WAGRP-027` (port-addition)                                             |
| Create group                             | Mobile `POST api/app/groups`                           | `POST /v2/waba/numbers/:id/groups`                                  | `TW-WAGRP-006` port, same limits as Reference unless D12 changes them                |
| Eligibility state ("not eligible")       | n/a (any connected personal number works)              | Probe, only error 131215 is a no                                    | Not applicable; replaced by "device connected and engine allowed" (TW-WAGRP-001)     |
| Refresh one group from the source        | Live list each call                                    | Per-row Refresh, cached mirror                                      | Per-row refresh against the live socket, roster cached (TW-WAGRP-035)                |
| Invite link get / reset                  | `GET invite-code`, `POST revoke-invite`                | Copy panel, "New link" with confirm                                 | Same, with the same confirm sentence (TW-WAGRP-012, 013)                             |
| Edit subject and description             | Mobile `subject`, `description`                        | PATCH, answered 202, confirmed by webhook                           | Same endpoints; confirmation from the `groups.update` event (TW-WAGRP-008, 009, 032) |
| Member list, remove participants         | Metadata read, `participants` action                   | On-demand member list, remove up to 8                               | `TW-WAGRP-028`; plus add, promote, demote (Reference has them, WABA cannot)          |
| Join approvals                           | None                                                   | Pending list, approve/reject                                        | `TW-WAGRP-029` port-addition                                                         |
| Suspended group                          | n/a (a ban hits the whole number)                      | Banner, sends refused (`WABA_GROUP_SUSPENDED`)                      | Replaced by "number disconnected / banned" banner and refusal (TW-WAGRP-034)         |
| Group thread in inbox, author per bubble | Thread stored; speaker number kept, name dropped       | `g:<id>` thread, author from `meta.group`, delivery tally, header   | `TW-WAGRP-033`                                                                       |
| Safe send guard                          | Forced to Baileys with `target_jid`; no announce check | `WABA_GROUP_SEND_UNAVAILABLE` then verbatim group id; kinds limited | `TW-WAGRP-034`: refuse admin-only groups for non-admin, refuse unsupported kinds     |
| Events and notifications                 | FCM push `is_group`, webhook `conversation.*`          | `whatsapp.group.*` outbox events, notification consumer             | `TW-WAGRP-032`                                                                       |
| Plan gate, permissions, audit            | None (mobile has no role gate)                         | Plan feature `waba_groups`, keys `waba.groups.*`, audit per action  | `TW-WAGRP-036`                                                                       |
| Delete group                             | None                                                   | `DELETE` removes everyone, row deleted                              | Not possible on WhatsApp; leave only                                                 |
| Ordering codes, order-in-group notice    | Yes (personal only)                                    | Explicit non-goal                                                   | Keep personal-only (TW-WAGRP-023, 024)                                               |
| Mentions                                 | Order notifier only                                    | Not in scope                                                        | Keep; optional composer mentions are a decision (D8)                                 |

### Limits and risks that must be visible to every builder and every user

The list separates what the **Reference code** proves from **WhatsApp or Baileys facts that are general knowledge and not re-verified in this working tree** (marked "not verified"). Re-verify the second kind against a real number before quoting a figure in the UI or help.

1. **No official API.** Groups on a personal number work by speaking WhatsApp Web's protocol through the open-source Baileys library (installed here at 6.7.24, pinned). WhatsApp does not offer or approve this; it can change the protocol or block the number at any time. Reference's own FAQ page (`faqs/whatsapp-bans.html`) tells buyers to treat any unofficial number as expendable. (Reference docs, verified.)
2. **Ban and restriction risk is higher for groups than for 1:1 chats** (not verified as a number, but widely reported): creating many groups quickly, adding many people who have not saved the number, mass-adding, and repeatedly polling the full group list are the typical triggers. Reference has **no throttle, cap or warning on any group call** (verified: none in `GroupController`, `groupController.js`).
3. **Admin rights are required for most management.** Adding or removing members, promoting or demoting, rotating the invite link, and changing subject or description when the group is "admins only edit" all fail for a non-admin. Reference knows this only through error text (TW-WAGRP-007 hint) and the `viewer_is_admin` flag on group detail; it never checks before calling. Super-admin (creator) can demote others; a plain admin cannot demote the creator (not verified).
4. **Admin-only messaging.** In an "only admins can send" group a non-admin account's sends are silently dropped by WhatsApp. Reference computes `can_send` for the app but the server does **not** refuse (grep: no use outside `GroupController`).
5. **Group size.** WhatsApp caps a group at 1,024 members (not verified for the current date). Reference's create form allows up to 1,024 participants in one call and 200 per later change; neither number is a WhatsApp guarantee.
6. **Text limits.** Reference caps subject at 60 and description at 512 characters (app-chosen; a code comment says WhatsApp's own subject limit is 25 historically and Baileys accepts 100). WhatsApp's current limits are not verified here (D12).
7. **Adding people.** A person whose privacy setting is "who can add me to groups: contacts only" cannot be added by a number that is not in their contacts: WhatsApp answers per participant with 403 and may offer an invite instead (not verified). Reference passes the per-participant result through but does nothing with it (no invite fallback).
8. **Addressing mode (LID).** Newer groups use anonymous ids (`@lid`) for members. Baileys 6.7.24 exposes the group's `addressingMode` and each member as `id` plus optional `jid`/`lid`. Reference's member sync reads only `id`, so a LID-addressed member is stored under the LID digits, not the phone (TW-WAGRP-003 QUIRK).
9. **No group history.** The socket is built with history sync off (WADEV), so a group thread starts at the first message after the number is linked or the bot is added; there is no back-fill.
10. **Rate limits.** `groupFetchAllParticipating` is a heavy call that Reference makes on every list refresh and on every sync (TW-WAGRP-004, 003). `groupMetadata` is called once per inbound group message (TW-WAGRP-015). Both are known sources of WhatsApp "rate-overlimit" errors (not verified).
11. **The number is shared with its owner.** Everything the bridge does appears on the owner's phone as that person; a group created or left from the CRM is created or left by a human in the eyes of the group.
12. **Kill-switch behavior.** With the platform switch off or the workspace removed from the allow-list, every group command is refused (`WA_UNOFFICIAL_DISABLED`) and the worker closes the socket; group rows and threads are kept (runbook `whatsapp-unofficial-switch.md`).

## Feature index

| Id           | Feature                                                                           | Status        | Priority | Effort | Depends on                 |
| ------------ | --------------------------------------------------------------------------------- | ------------- | -------- | ------ | -------------------------- |
| TW-WAGRP-001 | Engine gate and device resolution for group operations (Baileys only)             | implemented   | P0       | M      | TW-WADEV-001, TW-WADEV-032 |
| TW-WAGRP-002 | Bridge group command surface (routes, guard, JID rule, response shapes)           | implemented   | P0       | M      | TW-NODE-002, TW-NODE-021   |
| TW-WAGRP-003 | Group directory sync into `wa_groups` and `wa_group_members`                      | partial       | P1       | M      | TW-WAGRP-002, TW-NODE-021  |
| TW-WAGRP-004 | List groups (live roster merged with the local mirror)                            | implemented   | P0       | M      | TW-WAGRP-001, TW-WAGRP-002 |
| TW-WAGRP-005 | Group detail with the connected account's role and send permission                | implemented   | P0       | S      | TW-WAGRP-004               |
| TW-WAGRP-006 | Create a group                                                                    | implemented   | P0       | M      | TW-WAGRP-001, TW-WAGRP-002 |
| TW-WAGRP-007 | Add, remove, promote, demote participants                                         | implemented   | P0       | M      | TW-WAGRP-014               |
| TW-WAGRP-008 | Change the group name (subject)                                                   | implemented   | P1       | S      | TW-WAGRP-014               |
| TW-WAGRP-009 | Change the group description                                                      | implemented   | P1       | S      | TW-WAGRP-014               |
| TW-WAGRP-010 | Group restrictions (admin-only messaging, admin-only editing)                     | implemented   | P1       | S      | TW-WAGRP-014               |
| TW-WAGRP-011 | Leave a group                                                                     | implemented   | P1       | S      | TW-WAGRP-014               |
| TW-WAGRP-012 | Read the invite link                                                              | implemented   | P1       | S      | TW-WAGRP-014               |
| TW-WAGRP-013 | Rotate (revoke) the invite link                                                   | implemented   | P1       | S      | TW-WAGRP-014               |
| TW-WAGRP-014 | Open a chat for an existing group and the group access check                      | implemented   | P0       | M      | TW-WAGRP-001, TW-WAGRP-017 |
| TW-WAGRP-015 | Group message capture at the bridge (storage-only path)                           | partial       | P0       | M      | TW-NODE-016, TW-NODE-018   |
| TW-WAGRP-016 | Group inbound handling in Laravel (thread, title, dedupe, unread, push, webhooks) | implemented   | P0       | L      | TW-WAGRP-015, TW-WAGRP-017 |
| TW-WAGRP-017 | Group thread identity, listing rules and de-duplication                           | implemented   | P0       | M      | -                          |
| TW-WAGRP-018 | No automation on group messages: the rule and what actually runs                  | partial       | P0       | M      | TW-WAGRP-016               |
| TW-WAGRP-019 | Reply into a group from the inbox or the app                                      | implemented   | P0       | M      | TW-WAGRP-017, TW-WADEV-030 |
| TW-WAGRP-020 | Send into a group with @mentions                                                  | implemented   | P1       | S      | TW-WAGRP-002               |
| TW-WAGRP-021 | Message actions in a group thread (react, star, pin, forward, delete)             | partial       | P2       | S      | TW-WAGRP-019               |
| TW-WAGRP-022 | Group directory screen (`/store/groups`)                                          | implemented   | P1       | M      | TW-WAGRP-003               |
| TW-WAGRP-023 | Ordering code per group and the ordering link                                     | implemented   | P1       | S      | TW-WAGRP-022               |
| TW-WAGRP-024 | Order notice into the customer's group with @mention                              | implemented   | P1       | M      | TW-WAGRP-003, TW-WAGRP-020 |
| TW-WAGRP-025 | Access control, tenancy and plan gating of group operations                       | partial       | P0       | S      | TW-WAGRP-001               |
| TW-WAGRP-026 | Scheduled send to a group thread                                                  | partial       | P2       | S      | TW-WAGRP-019, TW-NODE-030  |
| TW-WAGRP-027 | Personal groups management screen (web)                                           | port-addition | P1       | L      | TW-WAGRP-004, TW-WAGRP-036 |
| TW-WAGRP-028 | Members panel with promote, demote, remove                                        | port-addition | P1       | M      | TW-WAGRP-005, TW-WAGRP-007 |
| TW-WAGRP-029 | Join approvals (approval mode, pending requests, approve or reject)               | port-addition | P2       | M      | TW-WAGRP-032               |
| TW-WAGRP-030 | Join a group by invite link or code                                               | port-addition | P2       | M      | TW-WAGRP-035, TW-WAGRP-036 |
| TW-WAGRP-031 | Group picture                                                                     | port-addition | P2       | S      | TW-WAGRP-008               |
| TW-WAGRP-032 | Group events, outbox events and notifications                                     | port-addition | P1       | M      | TW-WAGRP-003               |
| TW-WAGRP-033 | Group thread display in the inbox (author, header, banners)                       | port-addition | P1       | M      | TW-WAGRP-016, TW-WAGRP-005 |
| TW-WAGRP-034 | Send guard on the `whatsapp_qr` channel for group peers                           | port-addition | P0       | M      | TW-WAGRP-019, TW-WAGRP-005 |
| TW-WAGRP-035 | Ban-safety controls: throttles, roster cache, caps, risk text                     | port-addition | P0       | M      | TW-WAGRP-002               |
| TW-WAGRP-036 | Permissions, plan feature, audit, help and i18n for personal groups               | port-addition | P0       | M      | TW-WAGRP-001               |

## Features

### TW-WAGRP-001 — Engine gate and device resolution for group operations (Baileys only)

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M
- **Depends on:** TW-WADEV-001, TW-WADEV-032
- **Summary:** Every group operation first decides which of the workspace's Baileys numbers performs it, and refuses when the picked sender is not a personal number. Meta's Cloud API and Twilio have no way to create or manage arbitrary groups, so this is the capability gate for the whole domain.
- **Actors & access:** mobile app caller (authenticated workspace member). Workspace scope. No role check, no plan check.
- **UX & screens:** none of its own. Visible as messages in the app: "Group create is only supported on the Unofficial API engine. Pick a Baileys device." (409, carries the picked `engine`), "No connected Unofficial API device on this workspace." (422), "Device has no phone number." (422).
- **Endpoints:** applies to every `api/app/groups*` route (TW-WAGRP-004 to 014). Inputs that pick the device: body or query `sender` (composite key `engine:id`), `device_id`, or the app's `X-Device-Id` header (the workspace-resolution middleware copies a validated header into `device_id`).
- **Data:** reads `devices` (workspace scope), the sender registry keys. Writes nothing.
- **Rules & edge cases:**
  1. Resolution order: (a) `sender` present: resolve through the engine registry; an unknown key or a non-Baileys engine returns null (no fallback); a Baileys key must resolve to a `devices` row of the current workspace; (b) else `device_id` present: that device in the workspace, else null; (c) else the **first active** Baileys device, highest id (`active=1`, not `status=connected`).
  2. **No fallback when the caller was explicit.** Silently using another number made the group appear under the wrong device in an earlier version (comment in code).
  3. Null device: if the request named a non-Baileys engine the answer is 409 (create only; other routes answer the 422 text); otherwise 422.
  4. The device's phone for the bridge is the digits of country code plus phone number; empty digits give 422.
  5. A workspace default engine of Twilio or WABA must not block group calls: the gate looks at the picked device, never the default.
  6. The Node file's header comment says a non-Baileys sender gets 501; no code returns 501 (QUIRK, comment only).
- **Async & events:** none.
- **External systems:** none beyond the bridge (TW-WAGRP-002).
- **Settings:** the engine switch and allow-list (WADEV); `workspaces.enabled_engines`.
- **Acceptance criteria:**
  - Given a workspace whose default engine is Twilio and which has a connected Baileys device, When a member creates a group without naming a sender, Then the Baileys device is used and the create succeeds.
  - Given the request names `sender=twilio:5`, When creating a group, Then 409 with the message above and no bridge call.
  - Given `device_id` names a device of another workspace, When listing groups, Then 422 "No connected device" and nothing is read from the other workspace.
  - Given the platform switch is off for the workspace, When any group call runs, Then it is refused with `WA_UNOFFICIAL_DISABLED` (our repo's gate, not in Reference).
- **Source refs:** app/Http/Controllers/Api/App/GroupController.php (`resolveBaileysDevice`, `enginePickedByRequest`), app/Http/Middleware/ResolveAppWorkspace.php, app/Services/WorkspaceEngine.php, node/controllers/groupController.js (header comment).
- **Port notes:** `apps/api/src/modules/node-bridge-runtime/runtime/device-control.service.ts` `groupAction` already calls `UnofficialWhatsappGate.assertEnabledFor` and routes to the lease owner; the missing piece is an HTTP module (suggest `apps/api/src/modules/whatsapp-personal-groups`) that resolves the device by uuid inside `DatabaseService.tx()` and checks channel kind `whatsapp_qr`. Resolve explicit device first, never fall back; keep "first active" only for the legacy no-device call, and prefer `status=connected` over `active`.

### TW-WAGRP-002 — Bridge group command surface (routes, guard, JID rule, response shapes)

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M
- **Depends on:** TW-NODE-002, TW-NODE-021
- **Summary:** The Node bridge exposes ten group routes that translate to Baileys calls on the sender's live socket, plus one group-send route. This feature is the contract every other feature leans on: auth, JID validation, status codes, per-participant results and the post-leave suppression.
- **Actors & access:** Laravel server only. The ten `/api/groups/*` routes demand `X-Node-Token` strictly (header only, constant-time compare against `NODE_WEBHOOK_TOKEN` from the bridge env; 401 `{ok:false,error:unauthorized}`; no loopback bypass; an empty configured token rejects everyone). `POST /api/send-group-message/:phone` is **not** behind that strict guard (only the app-level loopback-or-token guard).
- **UX & screens:** none.
- **Endpoints:**

  | METHOD uri (Node)                        | Body or query                                                     | Success body                                                                                                                  | Failures                                        |
  | ---------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
  | POST /api/groups/create/:phone           | `subject` (or `name`), `participants[]` (numbers or JIDs)         | `{ok, jid, subject, participants_count, meta}`                                                                                | 503 not connected; 422 missing; 502 no JID; 500 |
  | GET /api/groups/all/:phone?workspace_id= | -                                                                 | `{ok, groups:[{jid,subject,owner,creation,description,participants_count,announce_only,restrict,ephemeral_duration}], total}` | 503; 500                                        |
  | GET /api/groups/meta/:phone?jid=         | `jid`                                                             | `{ok, meta}` (raw Baileys metadata)                                                                                           | 503; 422 bad JID; 500                           |
  | POST /api/groups/participants/:phone     | `jid`, `action` add, remove, promote, demote, `participants[]`    | `{ok, action, result[], meta, partial, ok_count, fail_count, total_count}`                                                    | 503; 422; 500                                   |
  | POST /api/groups/subject/:phone          | `jid`, `subject`                                                  | `{ok, jid, subject}`                                                                                                          | 503; 422; 500                                   |
  | POST /api/groups/description/:phone      | `jid`, `description` (may be empty)                               | `{ok, jid, description}`                                                                                                      | 503; 422; 500                                   |
  | POST /api/groups/settings/:phone         | `jid`, `setting` announcement, not_announcement, locked, unlocked | `{ok, jid, setting}`                                                                                                          | 503; 422; 500                                   |
  | POST /api/groups/leave/:phone            | `jid`, `workspace_id`                                             | `{ok, jid}`                                                                                                                   | 503; 422; 500                                   |
  | GET /api/groups/invite-code/:phone?jid=  | `jid`                                                             | `{ok, jid, code, url:"https://chat.whatsapp.com/<code>"}`                                                                     | 503; 422; 500                                   |
  | POST /api/groups/revoke-invite/:phone    | `jid`                                                             | `{ok, jid, code, url}` (new code)                                                                                             | 503; 422; 500                                   |
  | POST /api/send-group-message/:phone      | `group_jid`, `text`, `mentions[]`                                 | `{message:"GROUP MESSAGE SENT", id}`                                                                                          | 503 no socket; 400 no `group_jid`; 500          |

- **Data:** in-memory only: the clients map, the ready flags and the recently-left ledger.
- **Rules & edge cases:**
  1. The socket for `:phone` must be present **and ready** (`client_ready[digits]`); the path value is stripped to digits. Not ready gives 503 "Sender device is not connected." The send-group-message route uses the raw path value and checks only that a socket exists (no ready check, no digit normalization; QUIRK).
  2. A group JID is valid only when it matches digits, optionally a dash and digits, then `@g.us`. Anything else is 422 "jid must match <digits>(-<digits>)?@g.us". (Laravel normalizes the same way before calling, so neither end accepts a forged JID.)
  3. Participant inputs may be numbers or JIDs; a bare number becomes `<digits>@s.whatsapp.net`; an input with `@` is passed through unchanged; empties are dropped.
  4. **Recently-left ledger:** after a successful leave the JID is remembered for 30 s keyed by workspace id (monotonic clock, swept every 60 s and every 32nd write); the list route hides those JIDs because Baileys' participating roster can still contain a group for a few seconds after leaving. Without a `workspace_id` no suppression applies.
  5. **Fresh metadata with retry:** after create and after a participant change the bridge re-reads group metadata up to 3 times with 300 ms gaps; terminal errors (not-authorized, item-not-found, forbidden, 404, 410) stop at once; a freshly created one-member group counts as valid.
  6. **Per-participant result:** WhatsApp answers each participant with a status; `"200"` is success. `ok` is false only when every row failed (HTTP 200 with `ok:false`); `partial` is true when some succeeded and some failed; on all-failed no metadata is re-read.
  7. Node's own failures return 500 `{ok:false,error:<library message>}`; Laravel's `callNode` turns transport errors into `{ok:false,error}` and non-JSON bodies into "Bridge returned non-JSON."
  8. No explicit timeout in Node (the socket's 120 s query timeout applies); Laravel's call timeout is 20 s, so a slow but successful WhatsApp answer can be reported as failed (the same duplicate-risk pattern as sends, WADEV QUIRK).
- **Async & events:** none (request/response). The directory sync is separate (TW-WAGRP-003).
- **External systems:** WhatsApp servers through Baileys.
- **Settings:** `NODE_WEBHOOK_TOKEN` (bridge env) and the Laravel-side token (`node_token()`); the bridge URL (`baileys_server_url` or `SERVER_URL`).
- **Acceptance criteria:**
  - Given a missing or wrong `X-Node-Token`, When any `/api/groups/*` route is called, Then 401 and no socket is touched.
  - Given the sender number is paired but its socket is not ready, When listing groups, Then 503 "Sender device is not connected."
  - Given a participant change where 2 of 3 numbers succeed, When the route answers, Then `ok:true`, `partial:true`, `ok_count:2`, `fail_count:1` and the metadata is the refreshed roster.
  - Given the account leaves a group, When the list is requested within 30 s with the same workspace id, Then that group is absent.
- **Source refs:** node/routes/index.js (group routes, `nodeTokenGuard`, app-level guard), node/controllers/groupController.js, node/controllers/messageController.js (`sendGroupMessage`), app/Http/Controllers/Api/App/GroupController.php (`callNode`).
- **Port notes:** Our worker already answers a `group` command on Redis `wa:cmd` (`runtime/device-command.ts` type `group`, 60 s timeout, `DeviceControlService.groupAction`, `BaileysSocketFactory` `groups()`), replacing these HTTP routes; the lease owner answers, others stay silent. Gaps to close in the port: (a) `GroupAction` has no participant-result detail (it returns `{ok:true}` and drops per-participant statuses; Reference returned them), (b) no JID validation beyond the lenient `groupJid()` helper (it strips and appends `@g.us` for any string), (c) no recently-left suppression, (d) no mentions/send for groups beyond `group_text` in `outbound.port.ts`, (e) `GroupSnapshot` carries only jid, subject, description, size. Extend `GroupAction`/`GroupResult` rather than adding HTTP between API and worker. Keep the strict token guard idea irrelevant (no HTTP hop), but keep the JID regex and workspace-scoped suppression.

### TW-WAGRP-003 — Group directory sync into `wa_groups` and `wa_group_members`

- **Status:** partial (works for adds and member changes; never removes a group the number left, never refreshes on rename, loses LID members, stores no description)
- **Priority:** P1 (expected by customers; needed by the ordering flow)
- **Effort:** M
- **Depends on:** TW-WAGRP-002, TW-NODE-021
- **Summary:** The bridge mirrors the groups each number belongs to, with every participant, into Laravel so the ordering flow can find a customer's group by phone and the Store screen can list groups. Only metadata is synced; messages come through the separate inbound path.
- **Actors & access:** machine caller (bridge to Laravel, `POST api/groups/sync`, `X-Node-Token`). Route is claimed by NODE (TW-NODE-021); the sync behavior is owned here.
- **UX & screens:** none; the result is read by TW-WAGRP-022 and 024.
- **Endpoints:** `POST api/groups/sync` | `api.groups.sync` | `WaGroupController@sync` | api | `device_phone` required max 24; `workspace_id` nullable int; `groups` required array; per group `jid` required max 64, `subject` nullable max 191, `size` nullable int, `participants[]` of `{phone max 24, admin bool}` | `{ok, workspace_id, groups, members}`; 401 bad token; 422 `{ok:false,error:"no workspace for device"}`.
- **Data:** writes `wa_groups` (workspace, `device_phone`, `group_jid`, `subject` truncated to 191, `size`, `synced_at`; `group_code` and `meta_json` untouched) and `wa_group_members` (workspace, `group_jid`, `phone` digits max 24, `is_admin`, `synced_at`).
- **Rules & edge cases:**
  1. **When the bridge pushes:** 7 s after every `open` (both start paths), and debounced 5 s after `groups.upsert` (a newly created or newly joined group) and `group-participants.update`. The pairing-code start path registers **only** the participants listener, not `groups.upsert` (QUIRK: after a code pairing a newly joined group appears only at the next reconnect). `groups.update` (rename, restriction change) is never listened to, so a rename reaches the directory at the next reconnect or participant change.
  2. The bridge posts nothing when the account is in zero groups (`if no groups return`), so **leaving the last group never clears the directory** (QUIRK), and in general the receiver never deletes a `wa_groups` row or a member of a group it did not mention; groups the number has left stay forever with a stale `synced_at`.
  3. Workspace resolution: the body's `workspace_id` when sent (the bridge does not send it), else the first `devices` row whose country code plus phone digits equals `device_phone`, platform-wide, in PHP (encrypted columns). No device or no workspace gives 422. Two workspaces holding the same number resolve to the first (WADEV QUIRK).
  4. Per group: `updateOrCreate` on `(workspace_id, group_jid)`; `device_phone` is overwritten on every sync, so a group that two of the workspace's numbers belong to flips between them (the notifier then sends from whichever synced last).
  5. Members are **replaced** per group in one transaction: delete the workspace's rows for that JID, then upsert the new list in chunks of 500 keyed on `(workspace_id, group_jid, phone)`, de-duplicated by phone, non-digits stripped, empty phones skipped. The unique key is workspace-scoped since a fix in July 2026 (a tenant-blind key made the second workspace in the same group fail the whole sync).
  6. The bridge derives each member's phone from the participant `id` (text before `@` and `:`). For a **LID-addressed group** `id` is the LID, so the stored "phone" is the LID digits and the reverse lookup "which group is this customer in" misses them (QUIRK, from the Baileys 6.7.24 type: `id` may be a lid, `jid` is the phone form). `admin` is true for admin and super-admin alike.
  7. The receiver reads the token from the process environment only (`NODE_WEBHOOK_TOKEN`), not from the DB-saved token, so with a cached config it can reject a correctly configured bridge (NODE QUIRK).
  8. The sync does **not** create or touch any `conversations` row, although code comments elsewhere say it does (QUIRK: group threads are created by the first inbound message or by the app's open-chat).
  9. `size` is the participant count at sync time; capped by nothing.
- **Async & events:** debounced timer in the bridge; one HTTP post (timeout 20 s); no queue, no event, no audit.
- **External systems:** WhatsApp (`groupFetchAllParticipating`).
- **Settings:** token only. No on/off switch for sync.
- **Acceptance criteria:**
  - Given a connected number joins a new group on the phone, When 5 s pass, Then a `wa_groups` row and its members exist for the number's workspace.
  - Given a member leaves the group, When the next sync runs, Then that phone is no longer in `wa_group_members` for the group.
  - Given two workspaces both hold the same group (each with its own number), When both sync, Then each keeps its own rows and neither sync fails.
  - Given the number is removed from a group, When syncs run, Then (Reference) the row stays; (port) the row is marked left (decision D5).
- **Source refs:** node/classes/BaileysClientManager.js (`scheduleGroupSync`, `syncGroups`, listeners in `start` and `startWithPairingCode`, post-open scheduling), app/Http/Controllers/WaGroupController.php (`sync`, `workspaceForPhone`), app/Models/WaGroup.php, app/Models/WaGroupMember.php, database/migrations/2026_06_19_000200_create_wa_groups.php, database/migrations/2026_07_17_000100_fix_wa_group_members_unique_scope.php.
- **Port notes:** tables already exist (`packages/db/migrations/20261001103400_wfl_threadwise_schema.sql`, forced RLS, `(org_id, group_jid)` unique) and `StoreGroupsService` reads them, but **nothing writes them**: `GroupSnapshot` (`infra/providers/node-bridge-runtime/inbound.port.ts`) has jid, subject, description and size only, no participants or admin flags, and no `InboundSink.groups` consumer is registered (`InboxBridge` has none), so snapshots are dropped. Build a worker-side sink that upserts per `(org_id, group_jid)` and replaces members in one transaction, keyed on the device id (not a phone string) and with `phone` taken from the member's phone form (`jid`) and the LID kept in its own column. Also add: mark-left when a previously known group is missing from a snapshot (including an empty snapshot), listen to `groups.update`, register both listeners on both start paths. Never hold a transaction across the socket call.

### TW-WAGRP-004 — List groups (live roster merged with the local mirror)

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M
- **Depends on:** TW-WAGRP-001, TW-WAGRP-002
- **Summary:** The app asks for "my groups" and gets every group the picked number participates in right now, plus any group this workspace already has a chat for that the live roster missed, never showing archived or left ones in the main feed.
- **Actors & access:** mobile app, any workspace member. Also called in-process by the app's combined inbox sync.
- **UX & screens:** app groups tab; "syncing" indicator on rows flagged `stale`. No web screen.
- **Endpoints:** `GET api/app/groups` | (app) | `GroupController@index` | api, sanctum, workspace resolver | optional `sender`, `device_id`, header `X-Device-Id` | `{success, data[], total, stale, bridge_error}`.
- **Data:** bridge roster (TW-WAGRP-002 list route); `conversations` where `raw_jid` ends `@g.us`, workspace-scoped, `status != left`, and (when a device is pinned by the header) `device_id` = that device.
- **Rules & edge cases:**
  1. Source 1 is the live roster; source 2 is the conversation mirror. Keys are the JID reduced to pure digits so `120363012345678901@g.us` and a dashed form dedupe as one.
  2. Mirror rows that are **archived** hide the matching live row (the live roster does not know about local archiving); active mirror rows fill gaps with a minimal row: subject = thread title, `creation` = row creation, `participants_count` = the stored `recipients_count`, `announce_only=false`, `restrict=false`, `source:"mirror"`, `stale:true`.
  3. Live rows carry `source:"bridge"`, `stale:false`. Sorted newest creation first (null last).
  4. A bridge failure does **not** fail the call: 200 with mirror rows only, top-level `stale:true` and `bridge_error` text. Empty on a healthy workspace is a degraded read, not a 502.
  5. Without a pinned device the mirror leg is workspace-wide (groups of other numbers appear); with one it is that device's.
  6. No pagination; no search; no member data.
  7. Every call runs `groupFetchAllParticipating`, a heavy WhatsApp query; the app's full sync calls it each time while its delta sync skips groups (QUIRK/risk, see TW-WAGRP-035).
  8. The combined inbox sync also strips groups out of the `chats` bucket so a group never appears twice with conflicting `announce_only`.
- **Async & events:** none.
- **External systems:** WhatsApp via the bridge.
- **Settings:** none.
- **Acceptance criteria:**
  - Given the bridge is unreachable and the workspace has two group chats, When listing, Then both come back with `stale:true` on each row and at top level.
  - Given a group is archived locally, When listing, Then it is absent from the result even though the roster contains it.
  - Given a group created from another linked phone, When listing, Then it appears (live roster is authoritative).
- **Source refs:** app/Http/Controllers/Api/App/GroupController.php (`index`), app/Http/Controllers/Api/App/InboxController.php (bucket split), node/controllers/groupController.js (`groupListAll`).
- **Port notes:** serve from the cached directory (TW-WAGRP-003) with an explicit "refresh" instead of querying WhatsApp per request; keep `source` and `stale` flags; keyset pagination (Reference has none) and a search on subject (as `/store/groups` has). Keep the archived-hides-live rule using the conversation's `archived`.

### TW-WAGRP-005 — Group detail with the connected account's role and send permission

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** S
- **Depends on:** TW-WAGRP-004
- **Summary:** Opening a group returns its full WhatsApp metadata plus whether the connected number is an admin and whether it can post (an admin-only group blocks non-admin accounts).
- **Actors & access:** mobile app, any workspace member.
- **UX & screens:** group info screen; the composer is disabled with the reason when `can_send` is false.
- **Endpoints:** `GET api/app/groups/{jid}` | `GroupController@show` | api, sanctum, workspace resolver | `{jid}` any form, normalized | `{success, data:<meta + extras>}`; 422 invalid JID; 404 "Group not visible from this device"; 502 on bridge failure; `data:null` when metadata is not an object.
- **Data:** bridge metadata (subject, description, owner, creation, participants with admin flags, `announce`, `restrict`, ephemeral duration, size). Extras added: `viewer_phone`, `viewer_jid`, `viewer_is_admin`, `viewer_role` (`superadmin`, `admin`, `member` or null), `announce_only`, `can_send`, `cannot_send_reason`.
- **Rules & edge cases:**
  1. The viewer is found by comparing the digits before `@` of each participant id with the device's phone digits; matches both phone and LID-shaped ids by digit prefix. A device whose phone matches no participant (LID-only group) is treated as **not admin**.
  2. `can_send` is true unless the group is announce-only and the viewer is not an admin. The server never enforces it on send (TW-WAGRP-019 QUIRK).
  3. Access check: TW-WAGRP-014 (a local conversation row, else the bridge confirms the device is a participant and a row is created as a side effect).
  4. Participant phone numbers are returned in full to any workspace member.
- **Async & events:** a missing local conversation is auto-created on first read.
- **External systems:** WhatsApp via the bridge.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an announce-only group where the number is a plain member, When the detail is read, Then `can_send:false` with the admin-only reason.
  - Given the number is the creator, Then `viewer_role` is `superadmin` and `viewer_is_admin` true.
  - Given a JID with letters, Then 422 "Invalid group jid." and no bridge call.
- **Source refs:** app/Http/Controllers/Api/App/GroupController.php (`show`, `resolveViewerRoleInGroup`), node/controllers/groupController.js (`groupMetadata`).
- **Port notes:** match the viewer on the `jid`/`lid` pair that Baileys 6.7.24 provides (the group's `addressingMode` tells which), not on `id` digits. Return phone numbers only to holders of the manage permission (TW-WAGRP-036).

### TW-WAGRP-006 — Create a group

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M
- **Depends on:** TW-WAGRP-001, TW-WAGRP-002
- **Summary:** A member creates a new WhatsApp group from the connected number with a name, an optional description and a list of phone numbers; the group appears immediately as a chat the team can write into.
- **Actors & access:** mobile app, any workspace member. No plan gate, no permission key.
- **UX & screens:** app "new group" form. Messages: "Group created." (201), "Group create failed at the WhatsApp bridge." (502 with the bridge error), "No valid participant phones supplied." (422).
- **Endpoints:** `POST api/app/groups` | `GroupController@create` | api, sanctum, workspace resolver | `subject` required string max 60; `description` nullable max 512; `participants` required array 1 to 1024, each string max 32; `device_id` nullable int; `sender` nullable max 64 | 201 `{success, message, data:{conversation_id, jid, subject, description, participants_count, device_id, meta}}`.
- **Data:** creates one `conversations` row: `title`=subject, `status=pending`, `platform=W`, `provider=baileys`, `origin=chat`, `device_id`, `recipients_count`=number of valid numbers submitted, `last_message_at`=now, `raw_jid`=the new JID, `workspace_id`, `user_id`=creator.
- **Rules & edge cases:**
  1. Numbers are reduced to digits, anything under 8 digits dropped, duplicates removed; if none remain, 422.
  2. The account itself is added by WhatsApp; the list should not include it.
  3. The bridge call returns the group id and refreshed metadata; no id gives 502 and **no** conversation row.
  4. The description is set by a **second, best-effort call**; if it fails the group still exists and the response does not say so (QUIRK: the 201 echoes the requested description either way).
  5. `participants_count` is the bridge's count (metadata, else the create reply, else the input); `recipients_count` on the conversation is the **input** count, so people WhatsApp refused (privacy settings, not on WhatsApp) are still counted (QUIRK). The per-participant outcome of the create is not surfaced.
  6. Not idempotent: a retry after a timeout creates a second group.
  7. Subject cap 60 is the app's choice (code comment: WhatsApp 25 historically, Baileys 100).
  8. There is no limit on groups created per day, no confirmation and no ban warning (TW-WAGRP-035).
- **Async & events:** none (the directory picks the new group up through TW-WAGRP-003 within 5 s). No audit, no webhook.
- **External systems:** WhatsApp group-create, then optional description update.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a connected Baileys device, When a member creates "Team A" with 3 numbers, Then 201 with a JID, a `conversations` row with `raw_jid` that JID, and the group exists on the phone.
  - Given all numbers are shorter than 8 digits, Then 422 and nothing is created.
  - Given the bridge returns no JID, Then 502 and no conversation row.
  - Given the same request is sent twice, Then two groups exist (Reference); port: an `Idempotency-Key` makes the second a replay.
- **Source refs:** app/Http/Controllers/Api/App/GroupController.php (`create`), node/controllers/groupController.js (`groupCreate`, `_freshMeta`).
- **Port notes:** Group commands run on the lease-owning worker (`GroupAction` `create`); extend it to return per-participant results and to set the description in the same step. Insert the thread through the conversations facade (`peerKey` namespace `g:`), in one transaction after the socket call, with `Idempotency-Key`. Add the throttles and caps of TW-WAGRP-035 before calling WhatsApp.

### TW-WAGRP-007 — Add, remove, promote, demote participants

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M
- **Depends on:** TW-WAGRP-014
- **Summary:** An operator changes who is in a group and who administers it: add people by number, remove them, make them admins, or take admin away. The reply says what happened to each person.
- **Actors & access:** mobile app, any workspace member (Reference). WhatsApp itself requires the connected number to be an admin (and, for adds, often needs the group not to restrict adding).
- **UX & screens:** app member list actions. Failure text is translated into actionable hints.
- **Endpoints:** `POST api/app/groups/{jid}/participants` | `GroupController@participants` | api, sanctum, workspace resolver | `action` in add, remove, promote, demote; `participants` array 1 to 200, each max 32 | `{success, message:"Participants updated.", data:{action, result[], meta}}`; 502 `{success:false, message:<hint>, error, action, common_causes[4]}`.
- **Data:** none stored locally (the directory catches up through the next sync).
- **Rules & edge cases:**
  1. Numbers are reduced to digits, under 8 digits dropped, duplicates removed.
  2. The bridge returns one status per number; `"200"` means done. All failed gives bridge `ok:false` (Laravel 502 with a hint); **partial success is returned as success** and Laravel drops the `partial`, `ok_count` and `fail_count` fields (the app must read `result[]`; QUIRK).
  3. Hints keyed on the error text: 403, not allowed, forbidden or admin gives "The connected device is not an admin of this group, promote it via WhatsApp first, then retry."; 404 or not-on-whatsapp gives "One or more numbers are not on WhatsApp."; 408 or timeout gives "WhatsApp timed out, try again in a few seconds."; 409 or already gives an add-specific or remove-specific "already" text; "no participants" gives the 8-digit message; default gives the generic admin hint. `common_causes` lists four causes (not admin, not on WhatsApp, already in or not in the group, "only admins can add members" setting).
  4. Access: TW-WAGRP-014.
  5. No guard against removing the connected number itself, removing the creator, or demoting the creator.
  6. Adding is the riskiest action for ban purposes (many adds to non-contacts); no cap per hour (TW-WAGRP-035). Max 200 per call is Reference's number, not WhatsApp's.
  7. After the change the bridge re-reads metadata and returns it as `meta`, so the app need not call detail again.
- **Async & events:** none locally; WhatsApp then emits `group-participants.update`, which triggers a directory sync after 5 s.
- **External systems:** WhatsApp participant update.
- **Settings:** none.
- **Acceptance criteria:**
  - Given the number is an admin, When two numbers are added, Then `result` has two `"200"` rows and `meta` lists them.
  - Given the number is a plain member, When adding, Then 502 with the admin hint.
  - Given one of three numbers is not on WhatsApp, Then success with a failing row in `result` for that number.
  - Given `action=kick`, Then 422 validation.
- **Source refs:** app/Http/Controllers/Api/App/GroupController.php (`participants`), node/controllers/groupController.js (`groupParticipantsUpdate`).
- **Port notes:** return `{okCount, failCount, results[{phone, status, reason}]}` from the command (current `GroupAction` participants returns only `{ok:true}`); surface the privacy-403 as "could not be added, send them the invite link" with a one-tap link share; confirm remove and demote in the UI; throttle adds (TW-WAGRP-035).

### TW-WAGRP-008 — Change the group name (subject)

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S
- **Depends on:** TW-WAGRP-014
- **Summary:** Rename a group. The local chat title follows.
- **Actors & access:** mobile app, any workspace member; WhatsApp needs admin rights when the group is "admins only edit group info".
- **UX & screens:** app group info, edit name.
- **Endpoints:** `POST api/app/groups/{jid}/subject` | `GroupController@updateSubject` | api, sanctum, workspace resolver | `subject` required max 60 | `{success, message:"Group subject updated.", data:{jid, subject}}`; 502 "Subject update failed." with the error.
- **Data:** `conversations.title` for every row of the workspace with that `raw_jid`.
- **Rules & edge cases:**
  1. The title is updated immediately after the bridge accepts; the `wa_groups.subject` (directory) is not touched until a sync (and a rename does not trigger one, TW-WAGRP-003).
  2. A rename done on the phone does not reach the app thread title unless the next inbound carries `group_subject` and the title has no 8+ digit run (TW-WAGRP-016).
  3. Whitespace trimmed at the bridge; empty gives 422.
- **Async & events:** none.
- **External systems:** WhatsApp subject update.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an admin number, When the subject is changed, Then WhatsApp shows the new name and the chat title matches.
  - Given a non-admin number and an edit-restricted group, Then 502 "Subject update failed." with the error.
  - Given a 61-character name, Then 422.
- **Source refs:** app/Http/Controllers/Api/App/GroupController.php (`updateSubject`), node/controllers/groupController.js (`groupUpdateSubject`).
- **Port notes:** also update the directory row and retitle the thread on the `groups.update` event (TW-WAGRP-032) so renames made on the phone are followed. Limit text per D12.

### TW-WAGRP-009 — Change the group description

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S
- **Depends on:** TW-WAGRP-014
- **Summary:** Set or clear the description of a group.
- **Actors & access:** as TW-WAGRP-008.
- **UX & screens:** app group info, edit description; an empty value clears it.
- **Endpoints:** `POST api/app/groups/{jid}/description` | `GroupController@updateDescription` | api, sanctum, workspace resolver | `description` must be present, string, max 512 (empty allowed) | `{success, message:"Group description updated.", data:{jid, description}}`; 502 "Description update failed."
- **Data:** nothing stored locally (the description is not kept in `wa_groups` either).
- **Rules & edge cases:** 1. Empty string is a valid "clear". 2. Cap 512 is the app's; WhatsApp's own cap is higher (not verified, D12). 3. No local mirror.
- **Async & events:** none.
- **External systems:** WhatsApp description update.
- **Settings:** none.
- **Acceptance criteria:** Given an admin number, When the description is set to text, Then it shows on WhatsApp; When set to empty, Then it is cleared. Given 513 characters, Then 422.
- **Source refs:** app/Http/Controllers/Api/App/GroupController.php (`updateDescription`), node/controllers/groupController.js (`groupUpdateDescription`).
- **Port notes:** store the description on the directory row (our `wa_groups` has `meta_json`; add a real column if the screen shows it).

### TW-WAGRP-010 — Group restrictions (admin-only messaging, admin-only editing)

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S
- **Depends on:** TW-WAGRP-014
- **Summary:** Toggle "only admins can send messages" (announcement) and "only admins can edit group info" (locked) and their opposites.
- **Actors & access:** as TW-WAGRP-008; WhatsApp requires admin.
- **UX & screens:** app group info toggles.
- **Endpoints:** `POST api/app/groups/{jid}/settings` | `GroupController@updateSetting` | api, sanctum, workspace resolver | `setting` in announcement, not_announcement, locked, unlocked | `{success, message:"Group setting updated.", data:{jid, setting}}`; 502 "Setting update failed."
- **Data:** none locally; the list shows `announce_only` and `restrict` from the live roster only.
- **Rules & edge cases:** 1. `announcement` means admin-only messaging; `locked` means admin-only metadata edits. 2. Turning on announcement for a group the connected number does not administer makes the number unable to post (TW-WAGRP-005 `can_send`). 3. Two flags, four values, no combined call.
- **Async & events:** none.
- **External systems:** WhatsApp group setting update.
- **Settings:** none.
- **Acceptance criteria:** Given an admin number, When `announcement` is set, Then members cannot post and `announce_only` is true on the next read. Given `setting=mute`, Then 422.
- **Source refs:** app/Http/Controllers/Api/App/GroupController.php (`updateSetting`), node/controllers/groupController.js (`groupUpdateSetting`).
- **Port notes:** confirm before enabling announcement when the connected number is not an admin (it locks the CRM out). Keep both flags on the directory row.

### TW-WAGRP-011 — Leave a group

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S
- **Depends on:** TW-WAGRP-014
- **Summary:** The connected number leaves a group. The chat history stays but the chat is archived and marked left so it drops out of the group list.
- **Actors & access:** mobile app, any workspace member (Reference: no role check; a member of any role can make the business number leave a customer group).
- **UX & screens:** app group info, "leave group". Message "Left the group."
- **Endpoints:** `POST api/app/groups/{jid}/leave` | `GroupController@leave` | api, sanctum, workspace resolver | none | `{success, message}`; 502 "Leave group failed."
- **Data:** `conversations` of the workspace with that `raw_jid`: `status=left`, `archived=true`; messages are kept; the directory rows are **not** removed (TW-WAGRP-003).
- **Rules & edge cases:**
  1. The bridge remembers the JID for 30 s so an immediate list does not resurrect it; the durable signal is the conversation status.
  2. The row is matched by workspace and JID only (not device), so a re-paired device updates its old row.
  3. `status=left` rows are excluded from the group list's mirror leg forever; if the number is **added back later** the live roster shows the group again but the old thread stays archived and left, so new messages arrive in a hidden thread (inferred from the code; not run).
  4. A super-admin leaving does not delete the group; WhatsApp promotes someone else or leaves it.
- **Async & events:** none; WhatsApp emits participant updates for the group.
- **External systems:** WhatsApp leave.
- **Settings:** none.
- **Acceptance criteria:** Given a joined group, When the number leaves, Then the app no longer lists it within the next call and the thread is archived with `status=left` and still readable. Given another workspace holds the same group with its own number, Then its rows are untouched.
- **Source refs:** app/Http/Controllers/Api/App/GroupController.php (`leave`), node/controllers/groupController.js (`groupLeave`, `_markLeft`).
- **Port notes:** a re-joined group should reopen its thread (clear `left`, unarchive on the first new message or on the join event). Require the manage permission and a confirm; record who left in audit.

### TW-WAGRP-012 — Read the invite link

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S
- **Depends on:** TW-WAGRP-014
- **Summary:** Get the group's current invite link so a person can share it.
- **Actors & access:** mobile app, any workspace member; WhatsApp requires admin to read the code in most groups (not verified).
- **UX & screens:** app group info, "invite link" with copy/share.
- **Endpoints:** `GET api/app/groups/{jid}/invite-code` | `GroupController@inviteCode` | api, sanctum, workspace resolver | none | `{success, data:{jid, code, url}}`; 502 "Invite-code fetch failed."
- **Data:** none stored. The link is a bearer secret: anyone holding it can join.
- **Rules & edge cases:** 1. URL form `https://chat.whatsapp.com/<code>`. 2. Not logged, not stored. 3. Returned to any workspace member.
- **Async & events:** none.
- **External systems:** WhatsApp invite-code query.
- **Settings:** none.
- **Acceptance criteria:** Given an admin number, When the link is requested, Then a URL on `chat.whatsapp.com` is returned. Given a non-admin number, Then 502 with the bridge error.
- **Source refs:** app/Http/Controllers/Api/App/GroupController.php (`inviteCode`), node/controllers/groupController.js (`groupInviteCode`).
- **Port notes:** mirror the WABA invite panel: code box, Copy with a 1.5 s "Copied", never in audit or logs or URLs, shown only to the read permission.

### TW-WAGRP-013 — Rotate (revoke) the invite link

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S
- **Depends on:** TW-WAGRP-014
- **Summary:** Replace the invite link; the previous link stops working.
- **Actors & access:** as TW-WAGRP-012; WhatsApp requires admin.
- **UX & screens:** app "reset link". (The official WABA screen confirms with "Everyone you already sent the old link to will not be able to use it."; Reference's app confirm text is not in the server code.)
- **Endpoints:** `POST api/app/groups/{jid}/revoke-invite` | `GroupController@revokeInvite` | api, sanctum, workspace resolver | none | `{success, message:"Invite code rotated.", data:{jid, code, url}}`; 502 "Revoke invite failed."
- **Data:** none.
- **Rules & edge cases:** 1. Irreversible; the old code is dead at once. 2. No confirmation server-side.
- **Async & events:** none.
- **External systems:** WhatsApp revoke-invite.
- **Settings:** none.
- **Acceptance criteria:** Given an admin number, When the link is rotated, Then the new URL differs and the old URL no longer lets anyone join.
- **Source refs:** app/Http/Controllers/Api/App/GroupController.php (`revokeInvite`), node/controllers/groupController.js (`groupRevokeInvite`).
- **Port notes:** same confirm sentence as the WABA screen; audit the action without the code.

### TW-WAGRP-014 — Open a chat for an existing group and the group access check

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M
- **Depends on:** TW-WAGRP-001, TW-WAGRP-017
- **Summary:** A group that already exists on WhatsApp (created elsewhere, or before the app knew) gets a local chat on demand so it can be read and written to like any chat. The same helper is the access check of every group action: the workspace may act on a group it has a chat for, or one the connected number really belongs to.
- **Actors & access:** mobile app, any workspace member.
- **UX & screens:** tapping a group in the list; no screen of its own.
- **Endpoints:** `POST api/app/groups/{jid}/open-chat` | `GroupController@openChat` | api, sanctum, workspace resolver | `sender`/`device_id` optional | 200 (already open) or 201 (created) `{success, message, data:{conversation_id, jid, subject, device_id, created}}`; 404 "Group not visible from this device (not a participant or device offline)."; 422 invalid JID or no device.
- **Data:** creates or updates a `conversations` row as in TW-WAGRP-006 (`origin=chat`, `status=pending`, `recipients_count` from the live participant count).
- **Rules & edge cases:**
  1. `open-chat` always asks the bridge for the group's metadata first (no phantom rows for forged JIDs); a refusal is 404.
  2. Existing row (workspace + JID): title re-synced from the live subject; the row is **re-pointed to the device that just proved membership** (`device_id`, provider and platform set to Baileys) because the first number may now be offline.
  3. **Shared access helper** (`resolveGroupAccess`) used by detail, participants, subject, description, settings, leave, invite and revoke: if a local row exists the call proceeds with **no bridge check** (so the local row, not live membership, is the authorization after the first time; a different picked device that is not a member then fails at the bridge instead); otherwise the bridge confirms membership and a row is created.
  4. Tenancy: rows are matched by workspace and JID, never across workspaces; a guessed JID of another tenant gets 404 or a bridge refusal.
  5. The row is created with `last_message_at=now` and an empty preview.
- **Async & events:** none.
- **External systems:** WhatsApp group metadata.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a group exists on WhatsApp but not in the CRM, When open-chat is called, Then 201 with a new conversation and later chat sends reach the group.
  - Given the number is not in the group, Then 404 and no conversation.
  - Given a second call, Then 200 `created:false` with the same conversation id.
- **Source refs:** app/Http/Controllers/Api/App/GroupController.php (`openChat`, `resolveGroupAccess`, `mirrorForJid`).
- **Port notes:** a tenant-scoped `findOrCreateGroupThread(orgId, deviceId, groupJid, subject)` in the conversations facade, key `g:<digits>`; verify membership against the cached directory first and the socket second; take the thread lock to avoid two parallel opens creating two threads.

### TW-WAGRP-015 — Group message capture at the bridge (storage-only path)

- **Status:** partial (stores text and five media kinds; drops wrapped or other message types, and the operator's own phone-typed group messages)
- **Priority:** P0 (product unusable without)
- **Effort:** M
- **Depends on:** TW-NODE-016, TW-NODE-018
- **Summary:** A message in a WhatsApp group the number belongs to is posted to Laravel so the group chat is readable in the team inbox. It deliberately skips every automation at the bridge: a group of hundreds would fan a flow or AI reply out on every message.
- **Actors & access:** machine caller (bridge to Laravel, `POST api/inbound-message`; claimed by CHAT/NODE).
- **UX & screens:** appears as group threads in the team inbox and app.
- **Endpoints:** posts to `api/inbound-message` with `raw_jid=<jid>@g.us`, `sender_phone` (the speaker), `sender_name`, `group_subject`, `body`, media fields, `wa_message_id`, `direction`, `timestamp`; timeout 15 s (60 s with media).
- **Data:** none at the bridge.
- **Rules & edge cases:**
  1. Only batches of type `notify` reach this path; messages older than 600 s are skipped (reconnect replay guard); `status@broadcast`, newsletters and broadcast lists are skipped.
  2. The speaker is `participantPn` else `participant` with the suffix and every non-digit removed; for a LID-only speaker with no phone form this yields the LID digits, and Laravel validation (`sender_phone` required) can reject an empty one (NODE finding: group rows with unresolved participants are rejected).
  3. Content read: plain text or extended text; image, video, document (with captions), audio, sticker. **Not read:** location, contact card, poll, reaction, ephemeral or view-once wrappers (the code reads the message object without unwrapping), buttons or lists. A group with disappearing messages on therefore stores nothing (inferred from the code; not run). Reactions, receipts and system events produce no body and no media and are dropped.
  4. Media is downloaded (with the re-upload fallback) up to 16 MB and sent as base64; a download failure downgrades to a text-only row.
  5. The group subject is fetched with a metadata call **per message**; failure is ignored (an extra WhatsApp query per group message; ban/rate risk, TW-WAGRP-035).
  6. `direction` is derived from `fromMe`, but a `fromMe` message never reaches this function: the main loop sends every own message to the outbound-echo path, which **skips groups**. So messages the operator types in a group **from the phone** (or from another linked device) are never mirrored (QUIRK), while Laravel-side sends are stored by Laravel itself.
  7. Campaign response tracking runs on every incoming message before this path; for a group it matches by substring against the group JID text, which can mis-credit a campaign contact whose number appears inside the group id (QUIRK, inferred).
  8. Failures are logged and swallowed; no retry, no dead-letter.
- **Async & events:** fire-and-forget HTTP; nothing retried.
- **External systems:** Laravel inbound endpoint.
- **Settings:** none (no per-number "capture groups" switch exists).
- **Acceptance criteria:**
  - Given a member posts text in a group the number is in, When the bridge processes it, Then one inbound call carries the group JID, the speaker's number and the subject.
  - Given a status broadcast or an event older than 10 minutes, Then nothing is posted.
  - Given an image with a caption, Then the call carries the base64 image and the caption as body.
  - Given an operator types in the group on the phone, Then (Reference) nothing is mirrored; (port) mirrored as outbound, decision D3.
- **Source refs:** node/classes/BaileysClientManager.js (`handleMessages`, `forwardGroupInbound`, `syncOutboundFromPhone`), node/services/campaignService.js (`trackCampaignResponse`), Documentation/pages/developer-guide/node-bridge.html (claims groups are filtered out: stale).
- **Port notes:** today `InboxBridge.message` returns at once for `kind:'group'` (`inbox-bridge.service.ts`), and `parity/node-bridge-runtime.md` records "group messages are not threads" as a deviation justified by Reference listing individual chats; that is **not what Reference's current code does** (it stores them). Decision D2. If accepted: `normalizeInbound` already returns `kind:'group'` with `chat.isGroup`, `participant`; unwrap ephemeral and view-once content, handle location/contact like 1:1, cache group subject from the directory instead of a per-message query, mirror the operator's phone-typed group messages as echoes, and keep the age guard.

### TW-WAGRP-016 — Group inbound handling in Laravel (thread, title, dedupe, unread, push, webhooks)

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** L
- **Depends on:** TW-WAGRP-015, TW-WAGRP-017
- **Summary:** Laravel files each group message on the group's single thread, titles the thread with the group name, keeps the speaker's number on the message and notifies the team like any inbound message.
- **Actors & access:** machine caller (`POST api/inbound-message`, owned by CHAT; group-specific behavior here).
- **UX & screens:** team inbox thread list and thread view; the thread title is the group subject; the inbox shows no group-specific controls.
- **Endpoints:** `POST api/inbound-message` | `baileys.inbound` | `WaInboundController@baileys` (claimed by CHAT). Group-relevant fields: `raw_jid` (the `@g.us` JID), `group_subject` nullable max 191, `sender_phone` (speaker), `sender_name`, `wa_message_id`, `direction`.
- **Data:** `conversations` (title, `raw_jid`, `contact_digits` = `g:<digits>`, `provider=baileys`, `origin=inbox`, `recipients_count=1`, unread counter, `inbox_status`), `inbox_messages` (`from_number` = speaker digits for inbound, `to_number` = bot number, `meta.wa_message_id`, media path), `contacts`.
- **Rules & edge cases:**
  1. Device resolution is the receiving number's digits (first match platform-wide, WADEV QUIRK).
  2. Thread lookup goes through the resolver with the `g:` namespace: **one thread per group per workspace**, never split per receiving number (TW-WAGRP-017).
  3. Title: for a group, the supplied `group_subject` replaces the speaker-based title; on an existing thread the title is refreshed only when the stored title has no run of 8 or more digits (so a rename arrives with the next message when `group_subject` is sent, and a title containing a long number never updates).
  4. A new group thread gets `recipients_count=1` (not the member count).
  5. Idempotency: a repeated `wa_message_id` on the same thread (looked at in the last 80 rows of `inbox_messages` and `messages`) returns `kind:dedup`.
  6. Inbound bumps `unread_count`, sets `last_inbound_at`, `inbox_status=open`, preview (body, "location" or "attachment" fallback, max 191 chars).
  7. **Contact capture runs for the speaker:** unless the sender looks like a LID, the speaker's number is remembered as a CRM contact (existing contacts reused) and, when the thread has no contact yet, the **first speaker's contact is stamped on the group thread** (QUIRK: every speaking member becomes a contact; the thread is linked to an arbitrary member).
  8. The speaker's push name is used for the contact only; the **message keeps no sender name**, only the number in `from_number`.
  9. A realtime `MessageReceived` event is broadcast; an FCM push goes out after the response with `is_group:true` so the app renders it as a group notification; the title is built from the speaker's name and number, not the group name (QUIRK).
  10. `conversation.created` (once) and `conversation.received` webhooks fire to subscribers with the speaker as `sender_phone`.
  11. A workspace-less thread is healed from the device's workspace.
  12. Outbound-direction group posts (bot flows) would be stored as `out` with `to_number` = the speaker (QUIRK; unreachable today because the bridge never sends them).
- **Async & events:** broadcast, FCM push (terminating callback), outbound webhooks, contact capture; billing is not charged on inbound.
- **External systems:** FCM, subscriber webhooks.
- **Settings:** none specific.
- **Acceptance criteria:**
  - Given a first message from a group, When stored, Then one thread exists titled with the group name, one message with the speaker's digits as `from_number`, unread 1.
  - Given the same message id twice, Then the second returns `dedup` and no second message exists.
  - Given two numbers of the workspace are in the same group, When each receives the post, Then both land on the same thread (one thread).
  - Given a group renamed on the phone, When the next message arrives with the new subject and the title has no long digit run, Then the thread title updates.
- **Source refs:** app/Http/Controllers/WaInboundController.php (title rule, resolver call, dedupe, preview and unread, contact capture, push `is_group`, webhooks), app/Services/Inbox/ConversationResolver.php, app/Services/Push/InboxPushNotifier.php.
- **Port notes:** our inbox ingest already has a group branch for Cloud API groups (`waba-inbox-sink.ts` `onGroupMessage`, `inbound-ingest.service.ts`: key `g:<id>`, title from subject, no contact, `meta.group={groupId, participant, senderName}`). Reuse it for `whatsapp_qr` rather than copying Reference: **do not create contacts for group speakers** (follows TW-WABA-039, deviates from Reference on purpose, record as `intended`), store the speaker name in `meta.group`, push title = group subject plus speaker.

### TW-WAGRP-017 — Group thread identity, listing rules and de-duplication

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M
- **Depends on:** -
- **Summary:** A WhatsApp group is one shared thing per workspace. It is keyed in its own namespace so it can never collide with a phone number, is not split per receiving number, ignores the app's pinned-device filter, and old duplicate threads are collapsed in the lists.
- **Actors & access:** internal rules used by the inbox and the mobile chat endpoints.
- **UX & screens:** app chat list (groups shown on whichever number is pinned, with `is_group`), archived list with a `kind` filter (`group`, `one_to_one`).
- **Endpoints:** applies to `GET api/app/chats` and archived/detail endpoints (CHAT/MOB); no own routes.
- **Data:** `conversations.contact_digits` = `g:<digits of the group id>` (the `@g.us` suffix is cut before stripping digits); `raw_jid` ends `@g.us`; `is_group` is derived by suffix.
- **Rules & edge cases:**
  1. Resolver: groups skip the "separate thread per receiving number" split that applies to 1:1 chats in a multi-number workspace. The reason in code: two of the workspace's numbers in the same group each receive every post and used to create two threads.
  2. The oldest thread (lowest id) wins on lookup.
  3. The chat list shows groups regardless of the pinned device (list, archived list and detail all exempt `@g.us`); non-group rows still obey the pin.
  4. The list collapses duplicate group threads per JID, keeping the one with the latest activity (legacy duplicates may exist).
  5. `kind=group|one_to_one` filters by suffix; counts per kind are returned.
  6. A group row has no phone: the app's phone helper returns an empty string for it; title is the subject.
  7. Group chats created by create/open-chat have `origin=chat`; inbound-created ones `origin=inbox`; both match the chat list's origin filter.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given two numbers of one workspace in the same group, When both receive a post, Then one thread exists.
  - Given the app pins number B and the group was first seen on number A, Then the group still appears.
  - Given legacy duplicates for one JID, Then the list returns one.
- **Source refs:** app/Services/Inbox/ConversationResolver.php (`digitsFor`, `resolveScoped`), app/Http/Controllers/Api/App/ChatController.php (`convOffPinnedDevice`, `dedupeGroupThreads`, list and archived queries, `convPhone`), database/migrations/2026_07_20_090000_add_contact_digits_to_conversations.php.
- **Port notes:** WABA groups already use `g:<group id>` as the peer key; use the same convention for personal groups with the **digits-only JID** as the id, so one identity function (`isGroupPeer`, `groupIdOf` in `infra/providers/whatsapp/group-peer.ts`) serves both. Add a unique index on `(org_id, peer_key)` so two parallel inbounds cannot make two threads.

### TW-WAGRP-018 — No automation on group messages: the rule and what actually runs

- **Status:** partial (the bridge honors the rule; Laravel does not)
- **Priority:** P0 (product unusable without)
- **Effort:** M
- **Depends on:** TW-WAGRP-016
- **Summary:** The intended rule is that group messages are stored and nothing else happens: no flow, keyword reply or AI agent. At the bridge that is true. In Laravel's inbound handler there is no group guard, so part of the 1:1 pipeline still runs on a group message with the speaker standing in as the "customer".
- **Actors & access:** internal.
- **UX & screens:** none (surprising side effects in the inbox).
- **Endpoints:** `POST api/inbound-message` (CHAT).
- **Data:** may write contacts, tags, assignments, opt-out flags, order state and sent messages.
- **Rules & edge cases:**
  1. **Bridge:** no flow, keyword auto-reply, drip or AI call for `@g.us` (the branch `continue`s before the 1:1 pipeline).
  2. **Laravel, for an inbound group message (verified by reading; no `@g.us` guard exists between thread creation and the end of the handler):** the speaker is captured as a contact (TW-WAGRP-016 rule 7); Shopify and WooCommerce cash-on-delivery replies, back-in-stock opt-ins, the WooCommerce concierge and the catalog concierge receive the group body and the speaker's number; the AI CRM copilot gate may treat a staff member's group message as a CRM command and **reply into the group**; the routing engine runs with the speaker as the contact (one-shot actions only on the first message of the thread: assign team or user, priority; per-message actions on every message: add tag, auto-reply, start flow); the opt-out service reacts to a STOP/START body with the speaker's number; and an AI agent assigned to the thread (by routing or by an operator) **answers every group message into the group**.
  3. Therefore the stated safety ("a group would fan these out on every message and burn credits") holds only until a rule or an assignee exists on the thread. QUIRK, high impact: one routing rule with an auto-reply could spam a group.
  4. The mobile app's message actions and the web inbox allow an operator to assign an AI agent to a group thread; nothing forbids it.
  5. The WABA groups feature does the opposite on purpose: "no hook fires for groups" (TW-WABA-036/039).
- **Async & events:** the usual post-store fan-out.
- **External systems:** AI providers, commerce stores, WhatsApp (replies into the group).
- **Settings:** routing rules, AI agent assignment, concierge toggles.
- **Acceptance criteria:**
  - Given a group message that matches a keyword rule with an auto-reply, When stored, Then (port) no reply is sent and no contact is created; (Reference) the rule may reply into the group.
  - Given an AI agent assigned to a group thread, When a message arrives, Then (port) the agent is not invoked and the assignment is refused for group threads.
  - Given the speaker types "STOP" in a group, Then the group message is stored and nothing else happens (port).
- **Source refs:** app/Http/Controllers/WaInboundController.php (post-store pipeline: contact capture, COD, stock, concierge, copilot, routing, opt-out, AI agent), node/classes/BaileysClientManager.js (group branch).
- **Port notes:** make the rule explicit in the ingest: group threads (peer key `g:`) never run `InboundMessageHooks`, never enroll in flows, never auto-reply, cannot be assigned an AI agent, and never create contacts; this is the existing behavior for Cloud API groups (TW-WABA-036/039), so the personal path should share the same code path. Record the departures from Reference as `intended` in the parity file. Owner decision D3.

### TW-WAGRP-019 — Reply into a group from the inbox or the app

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M
- **Depends on:** TW-WAGRP-017, TW-WADEV-030
- **Summary:** An operator writes into a group thread the same way as into any thread. The message is forced onto the personal-number engine and addressed to the group, never to a person.
- **Actors & access:** web team-inbox agents (inbox role) and mobile members. No group-specific permission.
- **UX & screens:** the normal composer in the team inbox (`team-inbox`) and the app chat; the app disables the composer when `can_send` is false (TW-WAGRP-005). No group header or mention picker exists on the web.
- **Endpoints:** `POST api/app/chats/{id}/messages` (text, media, location, scheduled), `POST api/app/chats/{id}/template`, forward (TW-WAGRP-021); the web team inbox reply route (CHAT/TIB1). Group-specific fields are set server-side.
- **Data:** an outbound `messages` or `inbox_messages` row with `meta.target_jid` = the group JID.
- **Rules & edge cases:**
  1. **Engine rule ("GROUP HARD RULE"):** for a thread whose JID ends `@g.us` the engine is forced to Baileys and a thread stamped with another provider is rewritten to `provider=baileys, platform=W` on the spot. Cloud API and Twilio silently drop group sends, and a multi-engine workspace with Twilio as default must not lose them.
  2. `meta.target_jid` = the full group JID is stamped on every group send so the bridge hands it to WhatsApp verbatim; without it the number-formatting step would append `@s.whatsapp.net` to the group's digits and land the message on a nonexistent user. The text, media, location and catalog send endpoints all honor `targetJid`.
  3. **Recipient field:** because the send code needs a number, `to_number` is taken from the last outbound row, else the last inbound row's `from_number` (a **member's** number), else the JID digits (QUIRK: group messages are stored with an arbitrary member as recipient; delivery is still correct through the JID).
  4. The device that sends is the thread's `device_id` (the number that first saw the group, or the one that last proved membership through open-chat). If it is offline the send fails; there is no failover to another member number.
  5. `can_send` (announce-only and not admin) is **not** enforced on the server; WhatsApp drops the message silently while Reference shows a normal "sent" state (QUIRK).
  6. Billing: the message is counted as one message through the normal send path (no per-member charge; not verified against the wallet code).
  7. Quoting a message works inside the same thread.
  8. Web inbox: the inbox dispatcher backfills the recipient the same way and also sets `target_jid` from the thread's JID when absent.
- **Async & events:** same as any send (status callbacks by `wa_message_id`).
- **External systems:** WhatsApp via the bridge `send-message`, `send-media-message`, `send-location`.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a group thread on a workspace whose default engine is Twilio, When an agent replies, Then the message goes out through the Baileys device and appears in the group.
  - Given a group thread, When a media message is sent, Then it is addressed to the group JID, not a user.
  - Given the connected number is a non-admin in an announce-only group, Then (port) the send is refused before reaching WhatsApp with the admin-only reason.
- **Source refs:** app/Http/Controllers/Api/App/ChatController.php (`sendMessage`, `sendTemplate`), app/Services/InboxDispatcher.php (recipient backfill, `buildNodeRequest`), app/Services/WhatsAppDispatcher.php (`targetJid` on text, media, location, catalog), node/controllers/messageController.js (`targetJid` handling).
- **Port notes:** `QrChannelAdapter` (`inbox/qr-channel.adapter.ts`) sends through `DeviceControlService` and has **no group handling**; the outbound port already defines `{type:'group_text', groupJid, body, mentions}`. Add: peer `g:` resolves to `group_text`/group media with the JID, store the group as the recipient (not a member), refuse admin-only groups for a non-admin (TW-WAGRP-034), and refuse kinds a group cannot take (reuse `assertGroupSendKind`).

### TW-WAGRP-020 — Send into a group with @mentions

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S
- **Depends on:** TW-WAGRP-002
- **Summary:** Post a text into a group and make WhatsApp render @mentions of chosen people. In Reference this is used only by the order notifier; there is no mention picker in any composer.
- **Actors & access:** internal (the ordering services). Node route `POST /api/send-group-message/:phone`.
- **UX & screens:** none; the text must already contain `@<number>` tokens.
- **Endpoints:** `POST /api/send-group-message/:phone` (Node, TW-WAGRP-002 table).
- **Data:** none stored by this call (the notifier does not write an inbox row, TW-WAGRP-024).
- **Rules & edge cases:**
  1. A `group_jid` without `@g.us` has every character except digits and dashes removed and the suffix appended.
  2. Each mention number becomes `<digits>@s.whatsapp.net`; the text is sent as given.
  3. Baileys-only; no provider routing.
  4. Returns the WhatsApp message id; failure 500 `GROUP SEND FAILED` with details; no socket 503.
  5. A mention of a LID-addressed member by phone jid may not render (not verified).
- **Async & events:** none.
- **External systems:** WhatsApp.
- **Settings:** none.
- **Acceptance criteria:** Given a group the bot belongs to and two mention numbers, When called, Then the group shows two mentions. Given no socket, Then 503. Given an empty `group_jid`, Then 400.
- **Source refs:** node/controllers/messageController.js (`sendGroupMessage`), node/routes/index.js, app/Services/Ordering/GroupNotifier.php.
- **Port notes:** exists as `group_text` in `infra/providers/node-bridge-runtime/outbound.port.ts` and the socket factory; nothing calls it yet. Optional composer mentions are decision D8.

### TW-WAGRP-021 — Message actions in a group thread (react, star, pin, forward, delete)

- **Status:** partial (forward into a group is group-aware; the others rely on the 1:1 shape)
- **Priority:** P2 (nice to have)
- **Effort:** S
- **Depends on:** TW-WAGRP-019
- **Summary:** Operators can react to, star, pin, delete and forward messages in a group thread the same way as in a 1:1 chat. Forwarding **into** a group is handled explicitly; the other actions send the bridge a recipient and message id without the member who wrote the original.
- **Actors & access:** mobile members and web agents.
- **UX & screens:** message long-press menu.
- **Endpoints:** `POST api/app/chats/{c}/messages/{m}/react`, `PATCH .../star`, `POST .../pin`, `POST .../forward`, `DELETE .../{m}` (owned by MOB/CHAT).
- **Data:** message flags (`reaction`, `starred`, `pinned`), forwarded copy rows.
- **Rules & edge cases:**
  1. Forward: when the destination is a group the copy carries `meta.target_jid` = the destination group JID; the source's own `target_jid` is deliberately not copied.
  2. React on an inbound group message passes the **speaker's number** as the recipient and `fromMe=false`; the bridge builds the reaction key from the chat JID and message id and **never sets `participant`** (grep: the word does not appear in the message controller). In WhatsApp a reaction or delete-for-everyone key in a group needs the author's participant id; reactions to other members' group messages may therefore fail or mis-target (inferred from the code and the protocol; not run).
  3. Pin and star need the same key.
  4. Deleting an own message in a group works for messages the account sent.
- **Async & events:** none.
- **External systems:** WhatsApp via the bridge.
- **Settings:** none.
- **Acceptance criteria:** Given a message forwarded to a group thread, Then it arrives in the group. Given a reaction on a member's message in a group, Then (port) the reaction key includes the author's participant id and the reaction shows on WhatsApp.
- **Source refs:** app/Http/Controllers/Api/App/ChatController.php (`messageForward`, reaction and pin routes), app/Services/WhatsAppDispatcher.php (reaction), node/controllers/messageController.js.
- **Port notes:** `MessageAction` in `socket.port.ts` needs an optional `participant` for group chats; the inbound message must keep the speaker's id (`meta.group.participant`) for this.

### TW-WAGRP-022 — Group directory screen (`/store/groups`)

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M
- **Depends on:** TW-WAGRP-003
- **Summary:** A web page lists the groups the connected number belongs to, searchable by name, with counts and each group's ordering code. It is the only group screen on the Reference web.
- **Actors & access:** workspace role `admin` or above (the `/store` area middleware); no plan gate on the route; the Store area itself is a nav item.
- **UX & screens:** `resources/views/user/store/groups/index.blade.php` inside the Store layout (sidebar with a "Groups" count badge). Header "Store / Groups", title "WhatsApp Groups", one explanatory sentence ("Groups your connected number belongs to ... Add your number to a group on WhatsApp, it appears here automatically."). Three KPI tiles: "Groups synced", "With ordering code", "Bot number" (the first device of the workspace, shown as `+<digits>`, or "connect a device"). A GET search form ("Search group name..." plus a "Search" button). A table: Group (subject or "(unnamed group)", with the JID in small mono text), Members, Bot device (`+<digits>` or a dash), Synced ("x ago"), Ordering code (TW-WAGRP-023). Empty state "No groups synced yet" with the instruction to add the number to a group and send any message, "mirrors the group here within a minute". Pagination 30 per page. A footer note "How ordering codes work".
- **Endpoints:** `GET store/groups` | `user.store.groups.index` | `WaGroupController@index` | web, auth, `EnsureWorkspaceRole:admin` | `q` | HTML.
- **Data:** `wa_groups` of the workspace (`subject like %q%`), ordered by `synced_at` descending then subject; counts from the same table; bot number from `devices` (decrypted in PHP).
- **Rules & edge cases:**
  1. Workspace comes from the user's current workspace; none gives zero rows.
  2. The "Bot number" is the first device regardless of connection status or whether it is the one in the group; with several numbers it can be wrong.
  3. Search is a plain substring on the subject; the page reloads (no live update).
  4. No actions other than saving a code; no create, no leave, no refresh button (the sync is automatic).
  5. The Store area is gated on engine availability only through the data (an empty list when none).
  6. Stale groups the number has left stay listed (TW-WAGRP-003).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:** Given two synced groups, When an admin opens the page, Then both show with member counts and the bot number. Given a search "acme", Then only matching subjects. Given a manager role, Then the page is refused.
- **Source refs:** app/Http/Controllers/WaGroupController.php (`index`), resources/views/user/store/groups/index.blade.php, resources/views/user/store/_sidebar.blade.php, routes/web.php (store group).
- **Port notes:** already built in `apps/api/src/modules/storefront-builder/admin/store-groups.service.ts` (list with cursor, summary, `setCode`) reading `wa_groups`; it shows empty until TW-WAGRP-003 writes rows. Fold into the new management screen (TW-WAGRP-027) as a tab, keep the route and the copy.

### TW-WAGRP-023 — Ordering code per group and the ordering link

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S
- **Depends on:** TW-WAGRP-022
- **Summary:** An admin gives a group a short code and copies a `wa.me` ordering link that carries it. When a customer taps the link and confirms an order, the order notice goes to that exact group, even if the customer is in several.
- **Actors & access:** workspace admin.
- **UX & screens:** the row's code input (placeholder "e.g. ACME", max 48) with a "Save" button; when the group has a code and the workspace has a bot number, a "Copy ordering link" link that copies `https://wa.me/<bot digits>?text=ORDER G:<code>` and shows "Copied!" for 1.5 s. Flash "Ordering code saved." or "Ordering code cleared."; error "That code is already used by another group."
- **Endpoints:** `PUT store/groups/{id}/code` | `user.store.groups.code` | `WaGroupController@updateCode` | web, auth, admin | `group_code` nullable string max 48, characters letters, digits, dot, underscore, hyphen | redirect back with flash.
- **Data:** `wa_groups.group_code` (unique per workspace by code check, not by index; indexed).
- **Rules & edge cases:**
  1. Blank clears the code.
  2. Uniqueness is checked in the workspace, excluding the same group; race: two saves can both pass (no unique index).
  3. A group row of another workspace is a 404.
  4. The ordering text `ORDER G:<code>` is parsed by the ordering flow (TW-WAGRP-024).
- **Async & events:** none; no audit.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:** Given a group, When code ACME is saved, Then the row shows it and the copy link appears. Given ACME on another group, Then the error. Given `bad code!`, Then validation fails.
- **Source refs:** app/Http/Controllers/WaGroupController.php (`updateCode`), resources/views/user/store/groups/index.blade.php.
- **Port notes:** exists in `StoreGroupsService.setCode`; add a partial unique index on `(org_id, group_code) WHERE group_code <> ''` to close the race.

### TW-WAGRP-024 — Order notice into the customer's group with @mention

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M
- **Depends on:** TW-WAGRP-003, TW-WAGRP-020
- **Summary:** When a customer confirms an order in a private chat, the system finds the customer's WhatsApp group (by the code in the link, else by membership) and posts the order summary there, mentioning the customer; later order status changes are posted the same way. This was a customer-specific customization that Reference ships as a default-on behavior.
- **Actors & access:** automatic (ordering flow nodes and an order model observer); the merchant controls it through flow settings (`notify_group=false` turns it off).
- **UX & screens:** none; the post appears in the customer's group as the bot number.
- **Endpoints:** triggered by `api/flow-node/order-confirm`, `api/flow-node/order-reply` (NODE/WFL) and `WaOrder` status updates.
- **Data:** reads `wa_groups`, `wa_group_members`; no rows written; no inbox row for the post.
- **Rules & edge cases:**
  1. **Resolution order:** (a) a `group_code` from the link, matched in the workspace; (b) else the groups whose member list contains the customer's phone digits: one gives `single`, several give `ambiguous` (freshest sync wins), none gives `not_member`.
  2. **order-confirm** posts for `code`, `single` and, on purpose, `ambiguous`; **order-reply** posts only for `code` and `single` (the two endpoints disagree; QUIRK). `not_member` posts nothing.
  3. The post runs after the HTTP response (terminating callback); failures are logged only.
  4. Text: the customer's number as `@<digits>` on the first line, then the summary; translated into the customer's language when known (best effort, falls back to the original).
  5. Order status update: only for orders sourced from the AI ordering flow or pinned to a group code, when `status` changes; text "Order #<id> status: <Status>" and the total.
  6. The post is sent through the group's recorded `device_phone` (the last number that synced it), so it needs that number connected; there is no fallback number.
  7. A group the number has left but that is still in the directory is still posted to and fails silently.
  8. LID-addressed members are not matched by phone (TW-WAGRP-003 rule 6), so those customers get no notice.
  9. A log line reads a non-existent `name` attribute of the group (logging bug only).
- **Async & events:** terminating callbacks; no queue, no retry.
- **External systems:** the bridge send-group-message route, a translation call.
- **Settings:** flow node option `notify_group` (default true); group code in the ordering link.
- **Acceptance criteria:**
  - Given a customer who is in exactly one synced group, When the order is confirmed, Then the group receives the summary with an @mention of the customer.
  - Given the link carried code ACME, Then the post goes to the group with that code even if the customer is in three groups.
  - Given the customer is in no synced group, Then nothing is posted and the order still completes.
  - Given `notify_group=false`, Then nothing is posted.
- **Source refs:** app/Services/Ordering/GroupDirectory.php, app/Services/Ordering/GroupNotifier.php, app/Http/Controllers/FlowNodeActionsController.php (order confirm and reply), app/Models/WaOrder.php (status observer), node/controllers/messageController.js (`sendGroupMessage`).
- **Port notes:** the ordering flow and orders belong to CHK/WFL; here only the group lookup and post: a `GroupDirectory.resolveForCustomer` and a `GroupNotifier.send` on top of the `group_text` command; post through the number that is **connected and in the group** now, reconnect-aware, with a retry job (BullMQ) instead of a terminating callback. Needs TW-WAGRP-003 to exist.

### TW-WAGRP-025 — Access control, tenancy and plan gating of group operations

- **Status:** partial (strong tenancy, almost no role or plan control)
- **Priority:** P0 (product unusable without)
- **Effort:** S
- **Depends on:** TW-WAGRP-001
- **Summary:** One place that states who may do what with groups in Reference, so the port makes deliberate choices instead of inheriting accidents.
- **Actors & access:** see rules.
- **UX & screens:** none.
- **Endpoints:** all of the above.
- **Data:** none.
- **Rules & edge cases:**
  1. **Mobile group API** (`api/app/groups*`): sanctum login plus the app workspace resolver; **no workspace role check** (a viewer or agent can create, rename, remove members from, rotate links of and leave any group of the workspace's numbers); **no plan feature**; **no per-plan limit** on groups created; no rate limit on the routes.
  2. **Web `/store/groups`:** workspace role `admin`; no plan gate.
  3. **Bridge:** group routes require the shared secret strictly (header only); the group-send route does not.
  4. **Tenancy:** group threads, directory rows and mirrors are keyed by workspace; the bridge's recently-left ledger is keyed by workspace; the member unique key is workspace-scoped; the sync resolves the workspace from the device phone. The bridge itself has no concept of a tenant: **it trusts Laravel's phone in the URL**, which is why the token matters.
  5. **Device limit / engine** gates are WADEV's (`device_limit`, enabled engines, per-number proxy plan feature).
  6. **No permission keys** for groups exist in Reference (`devices.*` keys are dead code, WADEV 044).
  7. **Information exposure:** member phone numbers and invite links are returned to any member of the workspace.
  8. **Audit:** none of the group actions writes an audit row.
  9. **JID safety:** both ends reject non-conforming JIDs, closing injection and traversal.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:** Given a viewer role on the mobile API, When leaving a group, Then (Reference) it succeeds; (port) 403. Given workspace A's token and workspace B's JID, Then 404 (no cross-tenant read).
- **Source refs:** routes/app.php, routes/web.php (store area), app/Http/Middleware/ResolveAppWorkspace.php, node/routes/index.js.
- **Port notes:** see TW-WAGRP-036 for the proposed keys and plan feature.

### TW-WAGRP-026 — Scheduled send to a group thread

- **Status:** partial (accepted and stored, but delivered to the wrong address)
- **Priority:** P2 (nice to have)
- **Effort:** S
- **Depends on:** TW-WAGRP-019, TW-NODE-030
- **Summary:** A reply to a group scheduled for later is stored with the group's JID, but the bridge's single-schedule endpoint ignores the JID, so at the due time the message is addressed to a user made from the group's digits.
- **Actors & access:** mobile members (schedule on `sendMessage`).
- **UX & screens:** "send later" on the composer.
- **Endpoints:** `POST api/app/chats/{id}/messages` with a scheduled time; Node `POST /api/schedule-message/:phone`.
- **Data:** `messages` row with `scheduled_at`, `meta.target_jid`.
- **Rules & edge cases:** 1. Laravel puts `targetJid` in the schedule payload with a comment that Node needs it; the Node register handler does not read `targetJid` for single schedules (NODE inventory), so the fire path formats digits as `@s.whatsapp.net`. 2. Location pins scheduled into a group have the same problem. 3. Bulk, recurring, broadcast and campaign endpoints have no group concept at all.
- **Async & events:** Node timers.
- **External systems:** the bridge scheduler.
- **Settings:** none.
- **Acceptance criteria:** Given a message scheduled into a group, When the time arrives, Then (port) it is posted to the group; (Reference) it is addressed to a fabricated user.
- **Source refs:** app/Services/WhatsAppDispatcher.php (schedule payload), node/controllers (schedule handlers; see NODE inventory), app/Http/Controllers/Api/App/ChatController.php.
- **Port notes:** our scheduled messages run as BullMQ jobs through the same outbound port: a group peer must resolve to `group_text` at fire time. Decide whether to refuse scheduling into groups instead (D10).

### TW-WAGRP-027 — Personal groups management screen (web)

- **Status:** port-addition (Reference has no web screen to manage personal-number groups; our official groups have one)
- **Priority:** P1 (expected by customers)
- **Effort:** L
- **Depends on:** TW-WAGRP-004, TW-WAGRP-036
- **Summary:** A web screen for personal-number groups that mirrors the official `/waba-groups` page: pick a number, see KPIs, create a group, list groups with member counts and flags, and per-row actions. Reference's team could only do this from the mobile app.
- **Actors & access:** holders of the group permissions (TW-WAGRP-036); visible only when the workspace has a connected personal number and the engine is allowed.
- **UX & screens:** route proposal `/personal-groups` (a tab "Directory and ordering codes" for TW-WAGRP-022), under the WADEV feature area. Layout copied from the official screen: left rail with the number card (status badge "Connected" / "Disconnected" / "Banned or unlinked") and a number switcher when there are two or more numbers; a "How personal groups work" note carrying the ban warning (TW-WAGRP-035); KPI strip (Groups, Members, Where this number is admin, Pending join requests); an inline create form (name, description, optional first members); list rows with subject, member count, admin-or-member badge, "admins only" badge, Refresh, Members, Edit, Invite link, Leave. States: no personal number, engine off for the workspace (`WA_UNOFFICIAL_DISABLED` as a normal state), loading, error, empty.
- **Endpoints:** new `/v2` routes (proposal): `GET /v2/wa-groups?deviceId=` (cursor list from the directory), `POST /v2/wa-groups`, `POST /v2/wa-groups/:uuid/refresh`, plus the action routes of TW-WAGRP-007 to 013.
- **Data:** the directory rows of TW-WAGRP-003 plus live metadata on demand.
- **Rules & edge cases:** 1. Same copy and limits as Reference where the behavior is the same. 2. Destructive actions confirm. 3. Realtime refresh from the events of TW-WAGRP-032. 4. The screen never calls WhatsApp on page load; Refresh does, once per click (TW-WAGRP-035).
- **Async & events:** Socket.IO group events.
- **External systems:** WhatsApp through the worker.
- **Settings:** none.
- **Acceptance criteria:** Given a connected personal number, When an admin opens the page, Then groups list with KPIs; When creating a group, Then it appears and the thread exists. Given the engine is off, Then the page explains it and shows no controls.
- **Source refs:** (design only; official counterpart) crm-platform/docs/specs/waba-groups-management.md section 14, resources/views/user/waba-groups/index.blade.php.
- **Port notes:** build under the feature folder `apps/web/src/features/whatsapp-devices-baileys/` (or a sibling `whatsapp-personal-groups`) with `@crm/ui`, help guide (`help-docs-sync`), 21 locales (`i18n-translate-sync`). The ban warning is mandatory copy.

### TW-WAGRP-028 — Members panel with promote, demote, remove

- **Status:** port-addition
- **Priority:** P1 (expected by customers)
- **Effort:** M
- **Depends on:** TW-WAGRP-005, TW-WAGRP-007
- **Summary:** A members modal reads the live member list of a group on demand (not stored) and lets an admin remove, promote or demote people, and add by number. This mirrors the official "Members" modal and exposes what the Reference mobile API already supports.
- **Actors & access:** manage permission; shown only to a connected number that is an admin (otherwise read-only with the reason).
- **UX & screens:** modal with search, role badges (creator, admin, member), per-row actions with confirm, an "Add people" box (numbers, validated to 8 or more digits, duplicate-free, capped per call; D11), per-person results after each action.
- **Endpoints:** `GET /v2/wa-groups/:uuid/members` and the participants action route.
- **Data:** none stored (personal data; the directory already holds a phone list for ordering, TW-WAGRP-003).
- **Rules & edge cases:** 1. Member list from live metadata with a short cache. 2. Removing the connected number or the creator is blocked with a message. 3. Results show each person's outcome (added, not on WhatsApp, privacy blocked, already in). 4. Member numbers visible only to the manage permission.
- **Async & events:** events of TW-WAGRP-032.
- **External systems:** WhatsApp.
- **Settings:** none.
- **Acceptance criteria:** Given an admin number, When two people are added and one cannot be, Then the modal shows two added and one reason. Given a non-admin number, Then actions are disabled with the admin-required line.
- **Source refs:** (design) waba-groups-management.md D3; GroupController.php (`participants`).
- **Port notes:** depends on the per-participant result added in TW-WAGRP-007's port notes.

### TW-WAGRP-029 — Join approvals (approval mode, pending requests, approve or reject)

- **Status:** port-addition (official groups have it; Reference personal groups have none)
- **Priority:** P2 (nice to have)
- **Effort:** M
- **Depends on:** TW-WAGRP-032
- **Summary:** Toggle "approve new members" on a group and approve or reject people who ask to join through the invite link. Mirrors the official "Waiting to join" box.
- **Actors & access:** manage permission; the connected number must be an admin.
- **UX & screens:** a switch "Approve new members" on the row or edit modal; a "Waiting to join" box with Approve and Reject per person ("..." while working, row removed on success, failure text as a toast).
- **Endpoints:** `POST /v2/wa-groups/:uuid/join-approval {enabled}`, `GET .../join-requests`, `POST .../join-requests {action, ids[]}`.
- **Data:** pending requests kept short-lived (a small table or `meta_json` as the official one does) and removed when handled; personal data, no copy into contacts.
- **Rules & edge cases:** 1. Baileys 6.7.24 provides `groupJoinApprovalMode`, `groupRequestParticipantsList`, `groupRequestParticipantsUpdate` and the `group.join-request` event (verified in the installed package); none is used by Reference. 2. The list call is the recovery path when the event was missed. 3. Approve/reject is per person; bulk is a series of calls with the throttle of TW-WAGRP-035.
- **Async & events:** the `group.join-request` event feeds the pending list and a notification.
- **External systems:** WhatsApp.
- **Settings:** none.
- **Acceptance criteria:** Given approval mode on, When someone requests via the link, Then the request shows within seconds; When approved, Then the person is in the group and the row disappears.
- **Source refs:** (design) waba-groups-management.md section 3.3; installed Baileys 6.7.24 `lib/Socket/groups.js`.
- **Port notes:** extend `GroupAction` with `joinApproval`, `requests`, `requestAction`, and the socket factory with a `group.join-request` listener that emits a snapshot-like event.

### TW-WAGRP-030 — Join a group by invite link or code

- **Status:** port-addition (neither Reference nor the official feature has it)
- **Priority:** P2 (nice to have)
- **Effort:** M
- **Depends on:** TW-WAGRP-035, TW-WAGRP-036
- **Summary:** Paste a `chat.whatsapp.com` link or code, preview the group (name, size) and join with the connected number, so the CRM can be added to a customer's group without touching the phone.
- **Actors & access:** manage permission plus an explicit confirm; high ban risk.
- **UX & screens:** a "Join with link" dialog: paste, "Preview", then "Join". Errors: invalid or expired link, group full, approval required (request sent), number already in.
- **Endpoints:** `POST /v2/wa-groups/join-preview {code}`, `POST /v2/wa-groups/join {code}`.
- **Data:** a thread/directory row once joined.
- **Rules & edge cases:** 1. Code extracted from the URL; only letters and digits accepted. 2. Baileys has `groupGetInviteInfo` and `groupAcceptInvite` (verified present in 6.7.24). 3. Joining many groups quickly is a recognised ban trigger (not verified): cap per day (D11). 4. A group that requires approval turns the join into a request.
- **Async & events:** `groups.upsert` then the directory sync.
- **External systems:** WhatsApp.
- **Settings:** per-number daily join cap.
- **Acceptance criteria:** Given a valid link, When previewed, Then the name and size show; When joined, Then the group appears in the list within 10 s. Given an expired link, Then a clear error.
- **Source refs:** (design) installed Baileys; no Reference source.
- **Port notes:** owner decision D7 (new behavior beyond Reference).

### TW-WAGRP-031 — Group picture

- **Status:** port-addition
- **Priority:** P2 (nice to have)
- **Effort:** S
- **Depends on:** TW-WAGRP-008
- **Summary:** Change a group's picture from the CRM and read it for display.
- **Actors & access:** manage permission; admin on WhatsApp when the group restricts edits.
- **UX & screens:** edit modal image picker with crop-to-square preview.
- **Endpoints:** `POST /v2/wa-groups/:uuid/picture` (multipart).
- **Data:** none stored (or a cached thumbnail).
- **Rules & edge cases:** 1. Baileys `updateProfilePicture(jid, content)` accepts a group JID (present in 6.7.24). 2. Size and type limits set by us (JPEG or PNG, 5 MB; the official feature also caps at 5 MB per Meta docs, not verified). 3. Not in Reference.
- **Async & events:** `groups.update`.
- **External systems:** WhatsApp.
- **Settings:** none.
- **Acceptance criteria:** Given an admin number and a 600 by 600 image, When saved, Then the group picture changes. Given a non-image, Then 422.
- **Source refs:** (design) installed Baileys `lib/Socket/chats.js`.
- **Port notes:** D7.

### TW-WAGRP-032 — Group events, outbox events and notifications

- **Status:** port-addition (Reference reacts to two events only to resync the directory and has no group notifications)
- **Priority:** P1 (expected by customers)
- **Effort:** M
- **Depends on:** TW-WAGRP-003
- **Summary:** Turn WhatsApp's group events into the same kind of platform events the official groups emit, so screens refresh live and admins are told when something needs them.
- **Actors & access:** internal; notifications to users with the manage permission.
- **UX & screens:** toasts and notification bell entries; the screen refreshes without reload.
- **Endpoints:** none (events).
- **Data:** directory rows updated from events; outbox rows.
- **Rules & edge cases:**
  1. Source events: `groups.upsert` (joined or created), `groups.update` (subject, description, restrictions, picture), `group-participants.update` (add, remove, promote, demote), `group.join-request`. Reference listens to the first and the third only, and only to trigger a full sync.
  2. Events (naming follows the official `whatsapp.group.*` family): `whatsapp.group.created`, `.updated`, `.deleted` (the number left or was removed), `.join_request`, `.removed` (the connected number was removed by someone: a useful ban/abuse signal), `.role_changed` (the number was promoted or demoted, which changes what the screen allows).
  3. Notifications: "N people want to join <group>" and "Your number was removed from <group>"; default push off, like the official ones.
  4. Debounce bursts (Reference debounces 5 s).
  5. The thread is retitled on `groups.update`; archived and marked left when the number is removed.
- **Async & events:** `outbox-event` skill, same transaction as the write; worker consumer for notifications.
- **External systems:** WhatsApp.
- **Settings:** notification preferences per user.
- **Acceptance criteria:** Given a rename on the phone, When the event arrives, Then the directory row, the thread title and any open screen update. Given the number is removed from a group, Then the thread is archived with a "removed" banner and one notification is sent.
- **Source refs:** node/classes/BaileysClientManager.js (listeners), (design) waba-groups-management.md section 11.
- **Port notes:** `BaileysSocketFactory` already debounces `groups.upsert` and `group-participants.update` into a `groups` event; extend with `groups.update` and `group.join-request` and carry per-event detail, not only a roster.

### TW-WAGRP-033 — Group thread display in the inbox (author, header, banners)

- **Status:** port-addition
- **Priority:** P1 (expected by customers)
- **Effort:** M
- **Depends on:** TW-WAGRP-016, TW-WAGRP-005
- **Summary:** Make a personal-number group thread readable: who wrote each bubble, a group badge with the member count, and banners when the thread cannot be written to.
- **Actors & access:** every inbox viewer.
- **UX & screens:** author name (else number) above each inbound bubble; group badge and member count in the thread header; banners: "Only admins can send in this group" (number not admin), "This number was removed or the group was left", "This number is disconnected". Composer disabled with the reason in those cases. Reference shows none of these (the speaker's number is on the stored row but the web inbox and the app message payload do not display it).
- **Endpoints:** inbox thread and message contracts gain `meta.group`.
- **Data:** `meta.group = {groupId, participant, senderName}` (as the official groups do).
- **Rules & edge cases:** 1. No contact is created for the speaker; the name is the push name at that moment. 2. LID speakers show the push name or "member". 3. The banner reasons come from TW-WAGRP-005's role data cached on the directory row.
- **Async & events:** realtime message events.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:** Given two members post, Then each bubble shows its author. Given the number is a non-admin in an announce-only group, Then the composer is disabled with the admin-only reason.
- **Source refs:** (design) waba-groups-management.md section 12.3.
- **Port notes:** reuse the web parts built for Cloud API groups.

### TW-WAGRP-034 — Send guard on the `whatsapp_qr` channel for group peers

- **Status:** port-addition (our counterpart of Reference's "GROUP HARD RULE"; closes the same wrong-recipient risk we closed for Cloud API groups)
- **Priority:** P0 (product unusable without)
- **Effort:** M
- **Depends on:** TW-WAGRP-019, TW-WAGRP-005
- **Summary:** A thread keyed `g:` must never be turned into a person's number on the personal-number channel. Group sends are addressed by JID, limited to what a group accepts, and refused when the connected number cannot post.
- **Actors & access:** internal (the channel adapter).
- **UX & screens:** typed errors shown in the composer.
- **Endpoints:** none.
- **Data:** none.
- **Rules & edge cases:**
  1. Refuse with a typed, non-retryable error: unsupported kind (reaction, interactive, location, order, template), `WA_GROUP_ANNOUNCE_ONLY` (not admin in an admin-only group), `WA_GROUP_NOT_MEMBER` (number removed), `WA_UNOFFICIAL_DISABLED`, number disconnected.
  2. Address by the group JID built from the peer key; text and files only (location and contact cards are allowed on a personal number by WhatsApp; whether to allow them is D8).
  3. Record the group as the recipient, never a member.
  4. Pace group sends through the same pacing as 1:1.
- **Async & events:** standard send status events.
- **External systems:** WhatsApp.
- **Settings:** none.
- **Acceptance criteria:** Given a `g:` peer, When sent, Then the message goes to the group JID. Given a reaction, Then refused with a capability error. Given announce-only and not admin, Then refused with the typed error before any WhatsApp call.
- **Source refs:** (design) crm-platform apps/api `infra/providers/whatsapp/group-peer.ts`, `test/unit/whatsapp/group-send-guard.spec.ts`.
- **Port notes:** put the guard in `qr-channel.adapter.ts` using the shared helpers.

### TW-WAGRP-035 — Ban-safety controls: throttles, roster cache, caps, risk text

- **Status:** port-addition (Reference has none for groups)
- **Priority:** P0 (product unusable without)
- **Effort:** M
- **Depends on:** TW-WAGRP-002
- **Summary:** Because groups are where personal numbers get banned fastest, every group action goes through limits and the user is told the risk before and after.
- **Actors & access:** applies to all group actions.
- **UX & screens:** a persistent note on the screen and a confirm on risky actions (create, add many, join by link, leave several in a row); counters shown ("3 of 10 groups created today").
- **Endpoints:** applies to all.
- **Data:** per-device counters in Redis.
- **Rules & edge cases (all values are proposals to tune, not Reference numbers):**
  1. Per-device throttle on mutations (proposal 20 per minute) and daily caps for create (10), add participants (100 people), join by link (10).
  2. Roster cache: the group list and metadata are served from the directory with a short TTL; "Refresh" is rate limited (once per 30 s per device). No `groupFetchAllParticipating` per request, no `groupMetadata` per inbound message (use the cached subject).
  3. Group sends use the same random pacing as 1:1 and one group at a time per device.
  4. Reuse the connect-time risk acknowledgement (WADEV); add a second acknowledgement the first time a user adds people to a group.
  5. When the device status turns disconnected or banned, group controls disable themselves.
  6. Refuse on `WA_UNOFFICIAL_DISABLED`.
- **Async & events:** counters expire at midnight in the workspace timezone.
- **External systems:** none.
- **Settings:** platform settings for the caps.
- **Acceptance criteria:** Given the daily create cap is reached, When creating, Then 429-type `problem+json` with the reset time. Given two list refreshes within 30 s, Then the second is served from cache.
- **Source refs:** (design) Reference faqs/whatsapp-bans.html; waba-groups-management.md section 10 (throttle precedent).
- **Port notes:** use the repo's Redis throttle pattern (fail-open like `LeadHookThrottle`).

### TW-WAGRP-036 — Permissions, plan feature, audit, help and i18n for personal groups

- **Status:** port-addition (Reference has none; the official groups set the precedent)
- **Priority:** P0 (product unusable without)
- **Effort:** M
- **Depends on:** TW-WAGRP-001
- **Summary:** Give personal groups the same guard rails as official groups: permission keys, an optional plan feature, audit rows, a help guide and translated copy.
- **Actors & access:** see rules.
- **UX & screens:** Roles editor entries, plan editor switch, Help guide.
- **Endpoints:** all new `/v2` group routes.
- **Data:** permission rows by migration (`rbac-permission` skill), plan feature registry entry.
- **Rules & edge cases:**
  1. Keys (proposal, following `wa.devices.*` of WADEV): `wa.groups.read`, `wa.groups.create`, `wa.groups.manage` (members, name, description, restrictions, invite link, approvals), `wa.groups.leave`; `supports_scope=false`; granted to Owner and Admin only (Reference's mobile API let any member do all of it; the web screen was admin).
  2. Plan: no Reference gate. Recommendation: no separate plan feature; the existing `unofficial_whatsapp` entitlement plus the allow-list already gate it; add a plan feature only if the owner wants to sell it (D1).
  3. Audit (no member numbers, no invite codes in the message): `wa.group.create`, `.update`, `.participants` (action, count), `.link_reset`, `.leave`, `.join_requests`.
  4. Phone numbers of members only to `wa.groups.manage`.
  5. Help guide gated like the screen, stating the ban risk, admin requirements and that leaving cannot be undone.
  6. English and the 20 other locales for every string; the ban-risk text goes through counsel (WADEV D1).
- **Async & events:** audit and outbox in the write transaction.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:** Given a role without `wa.groups.manage`, When removing a member, Then 403 and no WhatsApp call. Given a member removal, Then an audit row without any phone number.
- **Source refs:** (design) waba-groups-management.md section 9 and 15; whatsapp-devices-baileys.md TW-WADEV-044 (dead `devices.*` keys).
- **Port notes:** skills `rbac-permission`, `help-docs-sync`, `i18n-translate-sync`.

## Data model

### `wa_groups` (Reference table; already created in our schema, nothing writes it yet)

Purpose: one row per WhatsApp group a personal number belongs to, per workspace. Written by TW-WAGRP-003, read by 022 to 024. Volume: tens to low thousands per workspace.

| Column                 | Type / null / default (Reference) | Behavior                                                                                                  |
| ---------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------- |
| id                     | bigint PK                         | Row id used by the ordering-code route                                                                    |
| workspace_id           | bigint NOT NULL, indexed          | Tenant (our `org_id`)                                                                                     |
| device_phone           | varchar(24) null, indexed         | Digits of the bot number that last synced the group; overwritten by every sync; the sender of order posts |
| group_jid              | varchar(64) NOT NULL              | `<digits>(-<digits>)?@g.us`; unique per workspace                                                         |
| subject                | varchar(191) null                 | Group name, truncated to 191                                                                              |
| size                   | int unsigned default 0            | Participant count at sync time                                                                            |
| group_code             | varchar(48) null, indexed         | Ordering code; uniqueness enforced in code, not by an index                                               |
| meta_json              | json null                         | Unused                                                                                                    |
| synced_at              | timestamp null                    | Last sync; the list orders by it                                                                          |
| created_at, updated_at | timestamps                        |                                                                                                           |

Unique `(workspace_id, group_jid)`. Our version adds `uuid`, `row_version`, composite primary key `(org_id, id)`, forced RLS and `touch_row`.

### `wa_group_members`

Purpose: participants of each group (digits-only phone), powering the reverse lookup "which groups is this customer in". Replaced wholesale per group on every sync.

| Column       | Type / null / default         | Behavior                                                      |
| ------------ | ----------------------------- | ------------------------------------------------------------- |
| workspace_id | bigint NOT NULL               | Tenant                                                        |
| group_jid    | varchar(64) NOT NULL, indexed |                                                               |
| phone        | varchar(24) NOT NULL          | Digits only; **LID digits for LID-addressed members** (QUIRK) |
| is_admin     | boolean default false         | Admin or super-admin                                          |
| synced_at    | timestamp null                |                                                               |

Unique `(workspace_id, group_jid, phone)` (the July 2026 fix; the original `(group_jid, phone)` broke multi-tenant syncs); index `(workspace_id, phone)` for the reverse lookup.

### `conversations` (group-relevant columns; owned by CHAT)

`raw_jid` (the `@g.us` JID, the only marker of a group), `contact_digits` (`g:<digits>`), `device_id`, `provider=baileys`, `platform=W`, `origin` (`chat` or `inbox`), `status` (`left` after leaving), `archived`, `recipients_count` (inputs count at creation, `1` for inbound-created), `title` (subject). `inbox_messages.from_number` holds the speaker's digits for inbound group messages; `to_number` is the bot number.

### In-memory state at the bridge

Clients and ready maps keyed by digits; recently-left ledger `<workspaceId>::<jid>` with a 30 s TTL (monotonic clock). Not persisted.

### Proposed additions for the port (not in Reference)

- `wa_groups`: `device_id` (FK to the device row, replacing the phone string as the sender), `left_at`, `description`, `announce_only`, `restricted`, `join_approval`, `viewer_role`, `addressing_mode`, `created_by_user_id`; a partial unique index on `(org_id, group_code)` where not blank; keep `meta_json`.
- `wa_group_members`: `lid`, `display_name` (push name) in addition to `phone`; keep it a cache, personal data, deleted with the group.
- Pending join requests: `meta_json` first (as the official groups), a table only if a missed-event recovery list is built.
- Counters and caches in Redis (TW-WAGRP-035).

## Cross-domain contracts

- **Consumes WADEV (`whatsapp-devices-baileys`):** device identity (digits of country code plus phone), engine gate, `devices` rows, `UnofficialWhatsappGate`/allow-list, per-number proxy, connect-time risk acknowledgement, plan limit `devices`; the first-group sync is scheduled by the session lifecycle (TW-WADEV-021 rule 15).
- **Consumes and exposes NODE (`node-bridge-runtime`):** NODE owns `POST api/groups/sync` (TW-NODE-021), the group route list, token scheme and the generic send/inbound plumbing (TW-NODE-016, 018, 024). This file owns what a group does with them. Exposes: the `GroupAction` extension list (TW-WAGRP-002 port notes). `wa:cmd` carries `group` commands (60 s timeout) in our runtime.
- **Consumes and exposes CHAT / TIB1 (`chat-conversations`, `team-inbox-conversations`):** `POST api/inbound-message`, `ConversationResolver` (`g:` namespace), the conversation row, the inbox send path, `InboxDispatcher` (`target_jid`), inbox realtime and push. Exposes: the group-thread rules (TW-WAGRP-016 to 019) and the proposal that group threads never run hooks (TW-WAGRP-018). Cloud API groups use the same `g:<id>` key (TW-WABA-039).
- **Consumes WABA (`whatsapp-cloud-api-waba`):** the official groups feature as the pattern (events `whatsapp.group.*`, screen, plan feature `waba_groups`, keys `waba.groups.*`, `group-peer.ts` helpers); no data is shared. The two engines must never be confused: `waba_groups` versus `wa_groups`.
- **Consumes CHK / STORE (`storefront-builder`, checkout and ordering domain):** the ordering flow nodes, orders, `wa.me` order links. Exposes: `GroupDirectory.resolveForCustomer`, `GroupNotifier`, the directory tables and `/store/groups` (listed in the storefront file as CHK-owned; **claimed here in the coverage block because no CHK inventory file exists yet; move the two routes if CHK is written**).
- **Consumes WFL (`forms-links-groups`, no inventory file yet):** schema `wa_groups`, `wa_group_members` (migration `20261001103400_wfl_threadwise_schema.sql`) is WFL's; behavior is described here.
- **Consumes MOB (`mobile-app-api`, no inventory file yet):** the app's chat endpoints (`api/app/chats*`) and the group routes claimed here. If a MOB file appears, move the eleven `api/app/groups*` routes there and keep the behavior text here.
- **Consumes RBAC, PLAN, NOTIF, WALLET:** permission keys (`wa.devices.*` precedent), plan features and the `unofficial_whatsapp` entitlement, notifications and audit, message billing (a group send counts as one message in Reference; not verified).
- **Consumes AIAG, FLB/WFL runtime:** the agent assignment and flow enrollment that group threads must refuse (TW-WAGRP-018).
- **Consumes CAMP/BCAST/SCHED:** their audiences contain no groups; TW-WAGRP-026 is the only scheduled link.

## Open questions & quirks

Decisions needed from the owner (all gated by the fact that the unofficial engine is off by default and allow-listed):

- **D1 Plan and scope.** Are personal groups available to every allowed workspace, or behind a sellable plan feature? Recommendation: no extra plan feature in v1 (the engine allow-list already gates it); permission keys yes (TW-WAGRP-036).
- **D2 Group messages as inbox threads.** Reference stores them (`forwardGroupInbound`); our parity file states "group messages are not threads (Reference's inbox listed individual chats)", which does not match the current Reference code. Recommendation: build them as threads (storage only), because the app, the order notifier and `g:` threads for Cloud API groups already assume groups are chats.
- **D3 Automation on groups and the operator's own phone-typed messages.** Recommendation: nothing automated on any group (fix Reference's Laravel-side leak, TW-WAGRP-018), no contact per speaker, mirror the operator's phone-typed group messages as echoes (Reference does not).
- **D4 Who may manage groups.** Reference's app lets any member; web screen was admin. Recommendation: the four keys of TW-WAGRP-036, Owner and Admin by default, member numbers visible to `manage` only.
- **D5 Departed groups.** Mark groups the number left or was removed from (`left_at`) instead of keeping them forever as Reference does.
- **D6 Web management screen.** Build it (TW-WAGRP-027, 028) as an addition to Reference, or keep groups mobile-only as Reference did.
- **D7 New capabilities beyond Reference:** join approvals (029), join by link (030), group picture (031). The porting rule forbids new behavior unless the owner accepts each as an `intended` addition; 030 is also the highest ban-risk item.
- **D8 Composer mentions and extra send kinds in groups** (location, contact cards): Reference has neither mentions in the composer nor a refusal; recommendation: text and files only at first.
- **D9 Billing of a group send:** one message (Reference, not verified) versus per member; on a personal number there is no per-recipient charge from WhatsApp, so recommendation one message.
- **D10 Bulk, scheduled or campaign sends to groups:** Reference has none (and scheduled-to-group is broken); recommendation: refuse scheduling into groups until the scheduler addresses by JID, and never offer broadcasts to groups (spam and ban risk).
- **D11 Caps for adding people and joining:** Reference allows 1,024 at create and 200 per change with no daily cap; the proposed daily caps (TW-WAGRP-035) are guesses to tune with a real number.
- **D12 Text limits:** Reference caps subject 60 and description 512; WhatsApp's real limits (subject 25 in older clients, 100 in newer; description about 2,048) need a live check before changing.

Quirks and gaps found in Reference (keep a QUIRK in the test plan so the port does not copy them by accident):

1. QUIRK: the directory is never pruned: leaving a group, being removed, or leaving all groups (empty sync is not even posted) leaves `wa_groups` and `wa_group_members` rows forever (TW-WAGRP-003).
2. QUIRK: `groups.update` is not listened to and the pairing-code start path lacks the `groups.upsert` listener, so some changes reach the directory only at the next reconnect.
3. QUIRK: LID-addressed members are stored as LID digits, so ordering lookups by phone miss them; Baileys 6.7.24 exposes both forms.
4. QUIRK: the directory's `device_phone` flips between numbers when several of the workspace's numbers share a group; order posts go through the last syncer.
5. QUIRK: the directory sync token is read from the process environment only; with cached config the receiver can reject a correctly configured bridge (NODE).
6. QUIRK: the sync does not create group threads although comments say it does; threads come from the first inbound message or open-chat.
7. QUIRK (high impact): Laravel's inbound handler has no group guard, so routing rules, an assigned AI agent, concierge services, COD and stock replies, the AI CRM copilot and the opt-out service can act on group messages with the speaker as the "customer"; the bridge's "storage only" promise holds only for the bridge (TW-WAGRP-018).
8. QUIRK: every group speaker becomes a CRM contact and the first speaker's contact is stamped on the group thread.
9. QUIRK: group messages typed by the operator on the phone are not mirrored (the group branch is unreachable for `fromMe`), although `forwardGroupInbound` contains `direction` logic for it.
10. QUIRK: ephemeral and view-once wrapped messages, locations, contact cards and polls in groups are dropped silently; group subject fetched per message.
11. QUIRK: group sends store a member's number (or the group id digits) as the recipient; delivery is correct only because `target_jid` carries the group JID.
12. QUIRK: announce-only groups are not enforced server-side; the app disables the composer, the web inbox does not.
13. QUIRK: participant changes with partial success return success and drop the `partial`/count fields; create reports the requested count as `recipients_count`, not the real one.
14. QUIRK: `leave` marks the thread `left` and archived for good; re-joining the group later leaves a hidden thread receiving new messages.
15. QUIRK: scheduled messages into a group are addressed to a fabricated user at fire time (TW-WAGRP-026); forwarded reactions/pins/deletes in groups lack the author's participant id.
16. QUIRK: campaign response tracking compares a group JID string by substring against contact phones and can credit the wrong contact.
17. QUIRK: `send-group-message` is outside the strict token guard and its socket check does not look at the ready flag nor normalize the phone.
18. QUIRK: the push notification title for a group message is the speaker's name and number, not the group name.
19. QUIRK: the Node file header says non-Baileys senders get 501; no code does that. The notifier logs a non-existent group attribute (`name`).
20. QUIRK: `ordering` disagreement: `order-confirm` posts on an ambiguous group, `order-reply` does not.
21. QUIRK: the mobile group list calls the heavy `groupFetchAllParticipating` on every full refresh; `groupMetadata` per inbound group message; no throttle on any group action (ban-risk, TW-WAGRP-035).
22. Docs versus code: `Documentation/pages/developer-guide/node-bridge.html` says groups are filtered out; the code stores them. No Reference documentation page describes group management, ordering codes or the mobile group API.
23. Parity record to correct: `docs/threadwise-port/parity/node-bridge-runtime.md` says "group messages are not threads (Reference's inbox listed individual chats)" and `inbox-bridge.service.ts` drops group messages, while `docs/specs/personal-whatsapp-connect.md` lists "a group message is ignored" as a manual check; all three contradict Reference's current behavior (D2).
24. Our repo status: the `group` command, `GroupAction` and group snapshots exist in the worker; **nothing consumes the snapshots, no HTTP route exposes the commands, `wa_groups` is never written, the QR channel adapter has no group send, and the inbox drops group messages**. The tables, the Store screen service and the group-peer helpers already exist.

## Coverage

```json threadwise-coverage
{
  "routes": [
    "GET api/app/groups",
    "POST api/app/groups",
    "GET api/app/groups/{jid}",
    "POST api/app/groups/{jid}/participants",
    "POST api/app/groups/{jid}/subject",
    "POST api/app/groups/{jid}/description",
    "POST api/app/groups/{jid}/settings",
    "POST api/app/groups/{jid}/leave",
    "GET api/app/groups/{jid}/invite-code",
    "POST api/app/groups/{jid}/revoke-invite",
    "POST api/app/groups/{jid}/open-chat",
    "GET store/groups",
    "PUT store/groups/{id}/code"
  ],
  "controllers": [
    "app/Http/Controllers/Api/App/GroupController.php",
    "app/Http/Controllers/WaGroupController.php"
  ],
  "services": [
    "app/Services/Ordering/GroupDirectory.php",
    "app/Services/Ordering/GroupNotifier.php"
  ],
  "models": ["WaGroup", "WaGroupMember"],
  "tables": ["wa_groups", "wa_group_members"],
  "views": ["resources/views/user/store/groups/index.blade.php"],
  "commands": [],
  "permissions": [],
  "middleware": [],
  "node_files": ["node/controllers/groupController.js"],
  "js_assets": [],
  "misc_files": [],
  "config_files": [],
  "doc_pages": ["Documentation/pages/developer-guide/node-bridge.html"],
  "feature_map": {
    "TW-WAGRP-004": ["GET api/app/groups"],
    "TW-WAGRP-005": ["GET api/app/groups/{jid}"],
    "TW-WAGRP-006": ["POST api/app/groups"],
    "TW-WAGRP-007": ["POST api/app/groups/{jid}/participants"],
    "TW-WAGRP-008": ["POST api/app/groups/{jid}/subject"],
    "TW-WAGRP-009": ["POST api/app/groups/{jid}/description"],
    "TW-WAGRP-010": ["POST api/app/groups/{jid}/settings"],
    "TW-WAGRP-011": ["POST api/app/groups/{jid}/leave"],
    "TW-WAGRP-012": ["GET api/app/groups/{jid}/invite-code"],
    "TW-WAGRP-013": ["POST api/app/groups/{jid}/revoke-invite"],
    "TW-WAGRP-014": ["POST api/app/groups/{jid}/open-chat"],
    "TW-WAGRP-022": ["GET store/groups"],
    "TW-WAGRP-023": ["PUT store/groups/{id}/code"]
  }
}
```
