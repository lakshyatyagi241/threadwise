---
domain: storage-quota
code: STQ
title: Storage quota (the workspace storage meter)
threadwise_version: 'none (product extension, not in Reference)'
sources_read: 0
---

# Storage quota (STQ): inventory of everything that stores a file

Not a Reference feature: Reference has no storage meter, so there is no Reference source to read and no Reference screen to compare with; this entry exists so the domain has the same map as the others.
The design is [specs/storage-quota-and-archival.md](../../specs/storage-quota-and-archival.md) (backlog BL-300, approved with the recommended defaults for O1 to O13 on 2026-10-18); the wiring is
[wiring/storage-quota.md](../wiring/storage-quota.md); the API is [api/storage-quota.md](../../api/storage-quota.md). Built so far: phases S0 and S1, **observe mode** (measure, never refuse, never delete).

## Overview

Storage is one platform bucket (or local disk) shared by every workspace, and nothing said how much of it each workspace held. The meter answers that with one number per workspace and a registry of
counted objects, so that later phases can bound it (a plan limit `storage_gb`), sell more (packs), warn, archive files of a lapsed feature, and delete at the end of retention.

Who uses it today: the platform operator (a read-only fleet and workspace view in the operator console API) and the worker (backfill, nightly counter check, reservation reaper). A workspace's people see
nothing yet.

## The inventory of writers (verified against `origin/main` at `f1ee1b5fd`, 2026-10-18)

Spec section 2.1 listed the file kinds; this pass re-read every writer in `apps/api/src` and the migrations, and the coverage test
(`apps/api/test/unit/storage-quota/storage-writes-guarded.spec.ts`) keeps the list true. Differences from the spec's table are marked **new**.

| Kind                                                  | Written by                                                                                  | Stored as                                      | Counted                                                                                      |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Call recordings                                       | `call-recordings.service.ts` -> `ChatMediaStore.store`                                      | object store / disk, `chat/<org>/...`          | yes (`call_recording`)                                                                       |
| Inbox media from agents, widget visitors, API, flows  | `ChatMediaStore.store`                                                                      | same                                           | yes (`inbox_media`)                                                                          |
| Inbox media from customers (every channel)            | `ChatMediaStore.storeInbound`, `storeInboundStream`                                         | same                                           | yes (`inbox_media_inbound`)                                                                  |
| Email attachments received                            | `mail-ingest.service.ts` -> `storeInbound`                                                  | same                                           | yes (`email_attachment_inbound`)                                                             |
| Email attachments staged for sending                  | `mail-outbound-attachments.service.ts` -> `store`                                           | same                                           | yes (`email_attachment_staged`)                                                              |
| Contact files                                         | no byte path: the row references an object a door stored                                    | key                                            | by object key, via the door that stored it (`contact_file` when the backfill finds it first) |
| Scheduled message media                               | `schedule-media.service.ts` -> `MediaStorageService.put`                                    | `scheduled/<org>/...`                          | yes (`scheduled_media`)                                                                      |
| Broadcast and campaign media                          | `marketing-media.service.ts` -> `MediaStorageService.put`                                   | `marketing/<org>/...`                          | yes (`campaign_media`)                                                                       |
| AI knowledge files                                    | `sources.service.ts` -> `TRAINING_FILE_STORE` (`LocalTrainingFileStore`)                    | local disk, `ai-training/<org>/...`            | yes (`ai_training_file`)                                                                     |
| Team chat attachments                                 | `messages.service.ts` -> `team-chat.repository.ts`                                          | Postgres `bytea`, `team_chat_attachment_blobs` | yes (`team_chat_attachment`, key `pg:...`)                                                   |
| Telegram profile pictures (**new**)                   | `channel-telegram/_shims/storage-media-store.ts` -> `MediaStorageService.put`               | `telegram/<org>/...`                           | yes (`channel_profile_media`)                                                                |
| Flow builder media (**new**)                          | `flow-builder-editor/flow-media.service.ts` -> `FLOW_MEDIA_STORE` (`LocalFlowMediaAdapter`) | local disk, keyed by the workspace UUID        | **not yet** (recorded gap)                                                                   |
| Order payment proofs, avatars, logos, widget pictures | their own tables (`bytea`)                                                                  | Postgres                                       | no (system, spec section 3)                                                                  |
| Report, message log, consent, audit, contact exports  | their own tables (`bytea`, gzip)                                                            | Postgres                                       | no (temporary)                                                                               |
| Privacy request export                                | `privacy_request_exports.file_zip`                                                          | Postgres                                       | no (legal duty; must work when full)                                                         |
| Event archive, message log archive, webhook failures  | platform tables and the archive bucket                                                      | other bucket / Postgres                        | no (platform data)                                                                           |
| Marketing site images (**new detail**)                | `marketing-site-cms/upload.service.ts` (`site/` keys, no workspace)                         | object store                                   | no (platform data)                                                                           |
| Invoice PDFs                                          | rendered on demand, never stored                                                            | n/a                                            | n/a                                                                                          |

Two doors write everything counted that is an object: `ChatMediaStore` (chat keys, local disk included) and `MediaStorageService.put` (the other workspace areas); `ChatMediaStore` calls the second as its
gateway, which is why `MediaStorageService.put` skips `chat/` keys. The Postgres blob and the knowledge-file store are metered at their own writers.

## Deletion paths (all return the bytes)

`ChatMediaStore.remove`, `MediaStorageService.remove` (also called by the privacy purge worker for every key), the training store's `remove`. Call recording retention, hand delete, consent withdrawal, mail
ingest rollback, staged-attachment expiry, scheduled-media release and the workspace erase all end in one of these. Team chat blobs cascade with their message and are reconciled nightly.

## Plan tiers and gates

New plan limit `storage_gb` (whole GB, 0 = unlimited). No plan feature, no persona module in S1 (the Storage tile is S2). Reference has no equivalent column.

## What is not covered yet (and where it goes)

Refusal and the messages (S2), warnings (S3), packs and grants (S4), the cold tier, restore and lapse archival (S5), the closing state and files export ([ADR-0030](../../adr/0030-workspace-closing-state.md), S6), moving
team chat blobs and the knowledge-file store to the object store (S7).
