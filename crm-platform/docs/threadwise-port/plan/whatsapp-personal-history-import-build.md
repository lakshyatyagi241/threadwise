# whatsapp-personal-history-import build plan

Spec: `docs/specs/personal-whatsapp-connect.md` section 23. Inventory: `inventory/whatsapp-personal-history-import.md` (TW-WAHIST-001..005). Wiring: `wiring/whatsapp-devices-baileys.md` (last section). Related: the groups build plan
(`whatsapp-personal-groups-build.md`) whose bridge-to-API pattern (sink on `InboundRouter`, worker module, sweep) this follows, and TW-WABA-046 (coexistence history) whose quiet-ingest mechanism it reuses.
Goal: an OPT-IN import of existing chats and people when a personal number (Baileys, channel kind `whatsapp_qr`) is first linked, so the shared inbox is not empty. Reference has no such feature.

## What the audit found (before building)

- `BaileysSocketFactory` built every socket with `syncFullHistory: false` and `shouldSyncHistoryMessage: () => false` (copied from Reference); browser identity `Browsers.macOS('Desktop')` for all.
- The "node bridge" in this repo is in-process: the worker owns the sockets (`DeviceRuntimeService`, Redis lease, `wa:cmd` commands from the API), and `InboundRouter` replaces Reference's `api/inbound-message` HTTP post. The device-groups work registers an `InboundSink` there; this feature does the same.
- The inbox ingest already has the quiet marker: `NormalisedInbound.history { direction }` (coexistence TW-WABA-046, mail backfill): backdated, no unread, no listener, `meta.historySync`, `applyHistory` keeps the thread ordered by the last real message, dedupe by the `message_ledger` unique key (channel + provider message id).
  What it did NOT do: create contacts (`noContact` for history), and it still wrote the `conversation.created` outbox event.
- Contacts: `ContactsService.resolveOrCreateByIdentity` already has `quiet: true` (the WABA address-book sync, TW-WABA-045) and the plan cap (`quota_reached`). The consent ledger never invents consent: no row means unknown.
- Reference: nothing to port (`syncFullHistory: false`; the inbound handler drops anything older than ten minutes).

## Decisions taken (owner may overrule)

- H1 The choice is a pairing input (`importHistory`), not a create input: it is valid for one attempt only, so a re-link imports only if chosen again. Stored on `devices.history_import_mode` + a run row.
- H2 `recent` = bootstrap + recent + push-name syncs without `requireFullSync`; `full` = `syncFullHistory: true` and also the FULL chunks. Same desktop browser identity for all (unchanged for non-opt-in).
- H3 Window defaults: 90 days (recent), 730 days (full); hard caps 50 000 messages per number, 500 per chat, 5 000 chats; env-configurable (`WA_HISTORY_IMPORT_*`), copied onto each run.
- H4 Reuse the ingest `history` marker instead of a new mechanism; extend it with `contact: true` (quiet contact link, counted against the plan cap) and make history skip the `conversation.created` event. This also applies to coexistence history (no consumer of `conversation.created` exists today).
- H5 Contacts only for 1:1 chats with a known number and at least one imported message. Not for groups, not for anonymous-id chats, not for people who only appear in push-name lists. Source `whatsapp_personal_import`. No consent event is ever written.
- H6 Plan cap: the run stops with `limit_reached`, keeps what it stored, takes nothing more.
- H7 Media is never downloaded; placeholder text + `meta.mediaOmitted`.
- H8 No new permission: choosing and cancelling use `wa.devices.pair`, reading `wa.devices.read`.
- H9 Completion: the last slice of the final sync type at progress 100, else silence for 180 s (sweep). A request nobody answered for 30 minutes fails with `history_not_received`.
- H10 (superseded by H14) No "imported" marker at first; the owner asked for one.
- H11 Disconnect, a failed or cancelled QR and a new pairing request cancel a waiting run.

## Files

Contracts `packages/contracts/src/whatsapp-devices-baileys/history-import.ts` (+ `devices.ts`, `errors.ts`). Migration `packages/db/migrations/20261202090000_wa_device_history_import.sql`, Drizzle `waDeviceHistoryImports`.
Adapter `infra/providers/node-bridge-runtime/history-sync.ts`, `baileys.socket-factory.ts`, `inbound-normalizer.ts` (`history` mode), `inbound.port.ts`, `socket.port.ts`.
Runtime `modules/node-bridge-runtime/runtime/{device-session,device-runtime.service,routers}.ts`, worker module (limits provider).
Device module `modules/whatsapp-devices-baileys/history-import-{rules,sweep.service}.ts`, `history-import.{mapper,repository,service,sink}.ts`, `device-pairing.service.ts`, `devices.{controller,mapper,repository,service}.ts`, worker module.
Ingest `modules/chat-conversations/{inbound-ingest,conversation-lifecycle}.service.ts`, `message-rules.ts` (`mediaOmitted`), contract `channel.port.ts`, `channel-ingest.job.ts`.
Config `config/domains/whatsapp-history-import.env.ts`, `.env.example`.
Web `features/whatsapp-devices-baileys/{api/history.ts, lib/history-model.ts, components/history-choice.tsx, components/history-import-card.tsx}`, wizard and detail screen, `messages/*/whatsapp-devices-baileys.history.json` (21 locales), help `help/import-your-existing-personal-whatsapp-chats.md`.

## Tests

Unit `test/unit/node-bridge-runtime/{history-sync,baileys-history}.spec.ts`, `test/unit/whatsapp-devices-baileys/history-import-rules.spec.ts`. Integration `test/integration/whatsapp-devices-baileys/history-import-rls.spec.ts`.
E2E `test/e2e/whatsapp-devices-baileys/history-import.e2e.spec.ts` (real Postgres, Redis, BullMQ workers, fake socket). Web: `lib/history-model.test.ts`, `components/history.render.test.tsx`, Playwright `apps/web/e2e/whatsapp-devices-baileys/history-import.spec.ts` (needs the running stack and WADEV_E2E_* credentials).
How the history event is simulated: unit tests mock the `baileys` module and fire `messaging-history.set` on its event emitter; the importer tests hand the sink the batches the adapter would produce. No real WhatsApp account was used.

## Owner decisions of 2026-10-14 (applied)

- H3 confirmed: defaults stay 90 / 730 days, 500 per chat, 50 000 per number, 5 000 chats.
- H12 `full` is a plan feature `personal_history_full` (catalogue `PLAN_FEATURE_DEFS`, group messaging, default false; migration `20261203090000_wa_history_import_followups.sql`). `recent` stays open to every workspace with personal numbers. Enforced on the server (pairing start: 422 `PLAN_FEATURE_LOCKED`, `errors[]` names the feature) and in the web (`meta.historyFullAllowed`; the option is shown disabled with an upgrade hint). Switched on for plans with an unlimited or at least 3 personal numbers (demo plans growth and scale); off on starter. Plan labels and hints exist in the plan editor, the account plan card and the plans screens, in 21 locales.
- H13 Cloud API coexistence history now also creates contacts, quietly (no `contact.created`, no consent event, counted against the plan cap, source `whatsapp_coexistence_import`). A behaviour change from TW-WABA-046, noted in the spec (23.4), the WABA parity notes and the coexistence e2e. There is no run to stop in coexistence, so at the cap the thread is kept without a contact (`needs_contact`) and every message is stored.
- H14 The inbox marks imported chats and messages: `conversations.imported_at` (set once when an import creates the thread) drives `ConversationSummary.imported`; `meta.historySync` drives `MessageResponse.imported`. A small "Imported" tag with a hint, in the row's spoken label too. The mail backfill carries the same flag and so shows it.
- H15 One realtime hint when an import ends (`inbox.history.imported`: number uuid + final state), never per message; a cancel that stored nothing or a superseded run sends none. The inbox list and the card refetch on it.
- H16 Counsel review is an explicit open item (O1 below). No legal text was changed.

## Open owner decisions

- O1 **Counsel review (open).** Importing the past messages of a number used personally and making contacts of the people in them: purpose, notice to those people, retention. The wizard explains what happens; the risk notice text was NOT changed and must not be changed by engineering. Needed before the feature is offered beyond the pilot.
- O2 Real-account verification: the owner will do the first-link test with the checklist below.

## Manual test checklist (real device, owner)

Use a test number on a workspace on the unofficial allow-list with `personal_history_full` on (growth or scale demo plan). Keep the `.env` defaults. Watch the "Imported chats" card on the number's page and the inbox.

1. **Recent.** Add the number. On the link step choose "Yes, recent chats and contacts" (the expectations list shows). Scan the QR. Expect: state Waiting for WhatsApp, then Importing with counts rising, then Finished. Check: chats are in the inbox as read conversations dated as sent, each with the "Imported" tag; the open inbox refreshed by itself when the run ended; no notification, no unread badge, no automatic reply fired; each person is a contact, named from the phone book, and a group is a group conversation with no contact; photos show `[Photo]`; the number's own chat and status updates are absent; no consent is recorded on the new contacts.
2. **Full.** Disconnect, then link again and choose "Yes, as much as WhatsApp sends". Expect more history than the first run (older chats and messages up to 730 days), no duplicates of what the first run stored, and a second run row (state Finished). On a workspace WITHOUT the feature the option is disabled with "See plans".
3. **Cancel mid-run.** Link again choosing recent and press "Stop the import" while it is Importing. Expect state Cancelled, counts frozen, what was stored still in the inbox, no further chats appear, and one refresh hint. Pressing it again says there is nothing running.
4. **Cap reached.** Lower the limits in `.env` (for example `WA_HISTORY_IMPORT_MAX_CHATS=5` and `WA_HISTORY_IMPORT_MAX_MESSAGES_PER_CHAT=10`) and restart the worker, or set the plan's contact limit just above the current contact count. Link again choosing recent. Expect Finished with the chat-limit message, or "Stopped at your contact limit" with what was stored kept and no contact above the limit.
5. **Re-link without choosing again.** Link again leaving "No, start empty". Expect nothing imported (card says Not requested or shows the previous run as history), and new messages arrive normally and are unread.
6. **Also confirm:** the phone's linked-devices list shows one companion; WhatsApp does not warn about the link; a number that never opted in is unchanged after a reconnect.

Record anything that differs (what WhatsApp actually sends, the `progress` values, how long it took) in `docs/threadwise-port/parity/whatsapp-devices-baileys.md` section on TW-WAHIST.
