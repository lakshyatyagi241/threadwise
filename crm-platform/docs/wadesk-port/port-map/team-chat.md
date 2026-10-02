# Port map: team-chat (TCHAT)

Spec: [inventory/team-chat.md](../inventory/team-chat.md). Parity and deviations: [parity/team-chat.md](../parity/team-chat.md).

## Target

| Layer            | Where                                                                                                                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tables           | `team_chat_channels`, `_channel_members`, `_messages`, `_reactions`, `_invitations`, `_reads` (ported earlier, `20261001101600_tchat_wadesk_schema.sql`) and `team_chat_attachment_blobs` (new) |
| Migrations       | `20261005100000_tchat_chat_model_fixes`, `..100100_tchat_permissions`, `..100200_tchat_message_body_trgm_idx`, `..100300_tchat_attachment_blobs`                                                |
| Drizzle          | `packages/db/src/schema/team-chat/tables.ts`                                                                                                                                                    |
| Contracts        | `packages/contracts/src/team-chat/chat.ts` (+ `TCHAT_*` codes in `common/errors.ts`)                                                                                                            |
| API module       | `apps/api/src/modules/team-chat` (controller, channels / messages / invitations / presence services, access service, repository, mapper, rules)                                                 |
| Web              | `apps/web/src/features/team-chat` (screen, sidebar, stream, composer, dialogs, side panel, members rail), route `(app)/(team-chat)/team-chat`, file proxy route                                 |
| Messages and nav | `apps/web/messages/en/team-chat.json`, `features/team-chat/nav.ts` (Inbox group, order 30)                                                                                                      |

## Endpoints (all under `/api/v2/team-chat`, tenant scoped, RLS)

Channels: `GET/POST channels`, `DELETE channels/:id`, `POST dm`, `GET members`, `GET/POST channels/:id/members`, `DELETE channels/:id/members/:userId`.
Messages: `GET/POST channels/:id/messages` (keyset history, gap-free poll by `after`), `GET channels/:id/pinned`, `GET channels/:id/search`, `POST channels/:id/read`,
`PATCH/DELETE messages/:id`, `POST messages/:id/pin`, `POST messages/:id/reactions`, `GET messages/:id/attachment`.
Activity: `POST presence`, `POST channels/:id/typing`, `GET channels/:id/activity`.
Invitations: `GET/POST invitations`, `POST invitations/:id/approve|decline`.

## Permission keys

`tchat.channel.manage` (create/delete channels, manage private members), `tchat.invite.approve`, `tchat.message.moderate` (delete or pin others' messages).
Reading and posting need no key: every active staff user is a member (WaDesk applied no role there). Admin preset gets all three.

## Audit, outbox, async

Every write records an audit row and an outbox event in the same transaction. No worker job: presence and typing are short-lived Redis keys, the 3 s refresh is a client poll
(WaDesk's realtime broadcast was dead code, WD-TCHAT-028).

## Prerequisites from other domains

Auth (staff identity, roles, permission registry), organisations. Attachments: object-store adapter (SET domain) is not built, so bytes live in `team_chat_attachment_blobs`
(a shim in this zone, replace with the adapter later). Approving an invitation reuses the workspace member model.

## Build order (done)

schema fixes -> permissions -> contracts -> channels/DM -> messages/history/poll/read -> attachments -> mentions/replies -> edit/delete/pin/react/search -> presence/typing -> invitations -> web screen -> tests.

## Risks

Attachment bytes in Postgres (20 MB cap) until the object store exists. Invitation approval depends on the member model of the AUTH domain. The Redis-backed presence needs Redis in the API.
