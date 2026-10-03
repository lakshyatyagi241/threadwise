# Parity: team-chat (TCHAT)

Evidence is automated (real Postgres): `apps/api/test/e2e/team-chat/team-chat.e2e.spec.ts` (77 scenarios, one block per TW-TCHAT id), `test/integration/team-chat/team-chat-schema.spec.ts`
(21: RLS, constraints), `test/unit/team-chat/chat-rules.spec.ts`, and `apps/web/src/features/team-chat/lib/chat-lib.test.ts` (9). The running reference was NOT driven side by side in this
run, and no browser smoke was run: every "looks the same" claim is unverified (see Not verified).

## Status

Built end to end (API + screen + tests): TW-TCHAT-001 to 006, 008 to 027, 029, 030. TW-TCHAT-007 (direct messages) is built too (API and sidebar). TW-TCHAT-032 (demo seeder) is a dev tool, not ported.
TW-TCHAT-028 and 031 are dead code in Reference and are not ported.

## Deviations (all intended, need owner approval)

| Where                                                                                         | Reference                                          | Here                                                                                 | Reason                                                                                               |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Message `channel_id`                                                                          | dropped by `$fillable` (messages vanished)      | stored                                                                               | plain defect                                                                                         |
| Channel name reuse                                                                            | 500 on the unique index after a delete          | reusable (hard delete frees the slug)                                                | defect                                                                                               |
| `#general` seed                                                                               | racy first visit                                | `ON CONFLICT`, plus seeded by migration                                              | defect                                                                                               |
| Message body                                                                                  | encrypted at rest, so search matched nothing    | plain text, trigram index, search works                                              | needed for TW-TCHAT-020 (decision 2 in the inventory)                                                |
| Poll with a gap                                                                               | only newest `limit` returned, rest skipped      | gap-free poll                                                                        | defect                                                                                               |
| Edits and deletes by others                                                                   | not synced until reload                         | the refresh picks them up                                                            | defect                                                                                               |
| Channel access on message/search/typing routes                                                | not checked                                     | checked on every route                                                               | security hardening                                                                                   |
| Invitation channel id                                                                         | global `exists`                                 | tenant scoped                                                                        | security hardening                                                                                   |
| Approved member role                                                                          | legacy `member`                                 | a real role, via the workspace member model                                          | defect                                                                                               |
| Attachments                                                                                   | public disk, URL guessable, file left on delete | bytes in `team_chat_attachment_blobs`, authenticated route, removed with the message | security hardening; object store not built                                                           |
| Edit, pin, reactions, search, typing, presence, channel delete, DM, private-member management | API only, no UI in Reference                       | screens added                                                                        | CONFLICT with PORTING_RULES 2.4 (no extra features): the owner decides whether to hide these screens |
| Admin-only actions                                                                            | role tier                                       | three permission keys                                                                | our RBAC                                                                                             |

## Blocked

- Object-store adapter for attachments (SET domain).
- Mention notifications: Reference sends none, so none are built.

## Not verified

Visual and behavioural parity with the live reference, Playwright twin run, mobile layout on a device, 3 s poll under real load, Redis presence in a multi-node deployment.

## Round 2 verification (fresh database crm_tchat, 178 migrations applied)

tier P0 done: TW-TCHAT-001, 002, 003, 004, 008, 009, 014.
tier P1 done: TW-TCHAT-005, 010, 011, 012, 013, 015, 016, 024, 025, 026, 027, 030.
tier P2 done: TW-TCHAT-006, 007, 017, 018, 019, 020, 021, 022, 023, 029. Not ported on purpose: 028 and 031 (dead code in Reference), 032 (dev seeder).
Re-run green: team-chat e2e 77, schema integration 21, unit 21, web 9; arch:check and db:verify-schema have no errors. Side-by-side screen conformance against the live reference is still not done.
