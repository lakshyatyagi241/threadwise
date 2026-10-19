# Parity: team-chat (TCHAT)

Evidence is automated (real Postgres): `apps/api/test/e2e/team-chat/team-chat.e2e.spec.ts` (77 scenarios, one block per TW-TCHAT id), `test/integration/team-chat/team-chat-schema.spec.ts`
(21: RLS, constraints), `test/unit/team-chat/chat-rules.spec.ts`, and `apps/web/src/features/team-chat/lib/chat-lib.test.ts` (9). The running reference was NOT driven side by side in this
run, and no browser smoke was run: every "looks the same" claim is unverified (see Not verified).

## Status

Built end to end (API + screen + tests): TW-TCHAT-001 to 006, 008 to 027, 029, 030. TW-TCHAT-007 (direct messages) is built too (API and sidebar). TW-TCHAT-032 (demo seeder) is built as a dev CLI (`pnpm --filter @crm/api seed:team-chat-demo`, `SEED_ORG_ID` picks the workspace; `apps/api/src/modules/team-chat/cli/`), tested by `test/integration/team-chat/demo-members.spec.ts` (3 scenarios: 10 teammates and idempotent rerun, org scoping, verified mail-less accounts with an unusable password).
TW-TCHAT-028 (MessagePosted broadcast: no channel authorisation, no listener, live updates are the 3 s poll) and TW-TCHAT-031 (`team_chat_reads`, unused legacy table) are dead code in Reference and are NOT PORTED ON PURPOSE. The port migration did create `team_chat_reads` (empty, never written); migration `20261216090000_drop_dormant_tables.sql` drops it, and read state is `team_chat_channel_members.last_read_message_id`.

## Deviations (all intended, need owner approval)

| Where                                                                                         | Reference                                       | Here                                                                                                                                | Reason                                                                                               |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Message `channel_id`                                                                          | dropped by `$fillable` (messages vanished)      | stored                                                                                                                              | plain defect                                                                                         |
| Channel name reuse                                                                            | 500 on the unique index after a delete          | reusable (hard delete frees the slug)                                                                                               | defect                                                                                               |
| `#general` seed                                                                               | racy first visit                                | `ON CONFLICT`, plus seeded by migration                                                                                             | defect                                                                                               |
| Message body                                                                                  | encrypted at rest, so search matched nothing    | plain text, trigram index, search works                                                                                             | needed for TW-TCHAT-020 (decision 2 in the inventory)                                                |
| Poll with a gap                                                                               | only newest `limit` returned, rest skipped      | gap-free poll                                                                                                                       | defect                                                                                               |
| Edits and deletes by others                                                                   | not synced until reload                         | the refresh picks them up                                                                                                           | defect                                                                                               |
| Channel access on message/search/typing routes                                                | not checked                                     | checked on every route                                                                                                              | security hardening                                                                                   |
| Invitation channel id                                                                         | global `exists`                                 | tenant scoped                                                                                                                       | security hardening                                                                                   |
| Approved member role                                                                          | legacy `member`                                 | a real role, via the workspace member model                                                                                         | defect                                                                                               |
| Attachments                                                                                   | public disk, URL guessable, file left on delete | bytes in `team_chat_attachment_blobs`, authenticated route, removed with the message                                                | security hardening; object store not built                                                           |
| Edit, pin, reactions, search, typing, presence, channel delete, DM, private-member management | API only, no UI in Reference                    | screens added                                                                                                                       | CONFLICT with PORTING_RULES 2.4 (no extra features): the owner decides whether to hide these screens |
| Admin-only actions                                                                            | role tier                                       | three permission keys                                                                                                               | our RBAC                                                                                             |
| `team_chat_reads` (TW-TCHAT-031)                                                              | unused legacy table, never written              | table dropped by migration `20261216090000_drop_dormant_tables.sql`; read state is `team_chat_channel_members.last_read_message_id` | dead in Reference; the port migration created it and nothing ever wrote it                           |

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

## Round 3: conformance against the running Reference (live pages compared 2026-10-04)

Compared: `/team-chat` in Reference 1.7.0 (workspace user, one channel created, two messages sent, a reply, the three modals, a 390 px viewport) with ours at 1440 and 390 px. Fixed to match:

- Column 1 (200 px): `WORKSPACE` eyebrow plus workspace name in serif, `MODE` with `Customer chats` (link to the inbox) and the active `Team chat` pill, `CHANNELS` with the `+` add button shown to everyone (the server decides, as in Reference), channel rows as `#name` pills with a pulsing unread count, `PEOPLE` with the `+` invite button, a `Members` link (to team members) and `Pending requests` with a count pill.
- Column 2 (290 px): serif `Team chat` heading with the italic accent, `N members`, search with its icon and `Search members...`, rows with a 32 px avatar, bold name, `(you)` and the email, hairline separators, click inserts the mention.
- Channel header: round brand icon, `#name` in serif, `CHANNEL` / `PRIVATE` pill, description with Reference's fallback `Internal workspace chat`, `Customer chats` pill link on the right.
- Stream: tinted background, date separators as pills, bubbles with Reference's radius and mint own-message colour, 10 px `Reply` / `Delete` links, `Name · snippet` reply quote on one line, Reference's centred empty state.
- Composer: textarea, then attach, then the `Send` pill; Reference's placeholder, `Replying to` banner and the `Enter send, Shift+Enter new line, @ mention` key hints.
- Create channel and invite dialogs: `#` prefix box, Reference's placeholders and hint copy, two bordered privacy cards.

Intended differences left (need owner approval): the card frame and the app shell's padding instead of Reference's full-bleed frame (same as the inbox screen here); `@crm/ui` modal titles and field labels (sentence case, not Reference's mono eyebrow); the extra controls listed in the deviation table above (search, pins, reactions, edit, direct messages, online dots) are shown only as icons in the header and on row hover; avatar colours come from our palette; times use the browser locale.
Reference quirk not reproduced: its empty-state placeholder stays above the first message sent in an empty channel until a reload.

Gates run in this round: team-chat API e2e 77, integration 24 (schema 21, seeder 3), unit 21, web unit 5276 (whole app), `db:verify-schema` 0 errors. `pnpm arch:check`, `@crm/api typecheck` and `@crm/api lint` fail only on flow-runtime-engine files (circular import in `commerce-shapes.ts`, `FlowPipeline` type in `commerce-book.e2e.spec.ts`), not on team-chat.

tier P0 done: TW-TCHAT-001, 002, 003, 004, 008, 009, 014 (screen conformance re-checked).
tier P1 done: TW-TCHAT-005, 010, 011, 012, 013, 015, 016, 024, 025, 026, 027, 030.
tier P2 done: TW-TCHAT-006, 007, 017 to 023, 029, 032. Not ported on purpose: 028 and 031.
