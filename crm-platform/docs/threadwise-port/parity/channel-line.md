# Parity evidence: channel-line (LINE)

Reference 1.7.0 vs branch `lakshya/channels/line`. Inventory: [inventory/channel-line.md](../inventory/channel-line.md). API reference:
[docs/api/channel-line.md](../../api/channel-line.md). Wiring: [wiring/channel-line.md](../wiring/channel-line.md).

Evidence is automated. **Nothing was run against the real LINE** (no channel access token or secret was used, no webhook was registered with
LINE, no message was sent): every provider call goes through the `LINE_API` port and the tests use a fake. The side-by-side run against the
running Reference (Playwright) was not done for this branch.

- `apps/api/test/e2e/channel-line/line-channels.e2e.spec.ts`: 18 scenarios (connect with encrypted secrets and no secret in the answer, the inbox channel, validation,
  a rejected token, re-paste, two accounts, a refused webhook, re-hook, pause, disconnect, token rotation: encrypted key, first mint, numeric Channel ID asked, a failed
  mint keeps the pasted token, an unusable key, off with blank fields, renewal near the end; isolation and permissions).
- `line-inbound.e2e.spec.ts`: 14 scenarios (signature refused, unknown token, signature over the exact bytes, LINE's verify and a paused channel, ignored events, first message with
  profile, contact and reply token, second message without a profile call, no profile, redelivery, several events with a failing one, postback replay and sticker, location and
  file text, an image downloaded with the channel token, groups and rooms, flow before automation, isolation).
- `line-sender.e2e.spec.ts`: 10 scenarios (free reply with a fresh token and a push after, a stale token, a refused token falling back to a push and a refused push, another person,
  a removed and a foreign channel, a file after its caption to a group; the adapter: registered and live, text, error mapping, unsupported kinds and a file without a public link).
- `line-broadcasts.e2e.spec.ts`: 13 scenarios (audience, frozen draft and forged ids, empty and no-recipient refusals, template and its buttons, a 45-person run in batches of 40
  with blocked and failed and the inbox mirror, media first, withdrawn consent blocked, paused channel, pause and a second start without double sends, retry, nothing to send, list totals
  and delete, isolation and permissions).
- `apps/api/test/unit/channel-line/*.spec.ts`: 45 tests (signature, routing token, rotation JWT verified with the public key, message builders, event reading, broadcast rules).
- `apps/web/src/features/channel-line`: model tests (compose and channel) and `screens.render.test.tsx` (the hub, the channel card, the broadcast list and the compose screen rendered with the
  real messages in all 21 languages, failing on any missing key) and `channel-cards.test.ts` (the Campaigns chooser card).

Each suite got its own Postgres and Redis container. The run results are in the delivery report of the branch.

## Status of each feature

| Feature     | Status       | Notes                                                                                                                                        |
| ----------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| TW-LINE-001 | screen-done  | `/line`: connect form, channels, guide. The Rich menus and Insights pills are not shown (blocked).                                           |
| TW-LINE-002 | screen-done  | Connect by token and secret, encrypted, re-paste updates, webhook registered, a refusal keeps the channel.                                   |
| TW-LINE-003 | screen-done  | Re-hook.                                                                                                                                     |
| TW-LINE-004 | screen-done  | Pause, enable, remove (confirm).                                                                                                             |
| TW-LINE-005 | screen-done  | Token rotation with a documented fix (the numeric Channel ID is asked).                                                                      |
| TW-LINE-006 | backend-done | Public webhook, routing token, signature on the raw body, 401 on a bad signature, tenant by a narrow lookup function.                        |
| TW-LINE-007 | partial      | Thread, contact, file, unread, redelivery are done. Flow hand-off and routing, AI and keyword replies are stand-ins until their owners bind. |
| TW-LINE-008 | backend-done | The `line` adapter: free reply token while fresh, else push; files as a signed link (cloud storage only).                                    |
| TW-LINE-009 | backend-done | Template buttons as a buttons card and quick replies.                                                                                        |
| TW-LINE-010 | screen-done  | Audience: the channel's `U` threads, newest 500.                                                                                             |
| TW-LINE-011 | screen-done  | List with tiles and live progress.                                                                                                           |
| TW-LINE-012 | screen-done  | Compose with a live preview, template, attachment and recipients.                                                                            |
| TW-LINE-013 | backend-done | BullMQ job `line-broadcast`: batches of 40, push per person, blocked vs failed, counters recomputed, inbox mirror, consent gate.             |
| TW-LINE-014 | screen-done  | Start, pause, retry failed, delete.                                                                                                          |
| TW-LINE-015 | blocked      | Needs the flow runtime and the Node bridge. The inbound path calls the stand-in hooks.                                                       |
| TW-LINE-016 | blocked      | Rich menus: not ported (outside the brief of this branch). `line_rich_menus` exists.                                                         |
| TW-LINE-017 | blocked      | Insights: not ported (outside the brief of this branch).                                                                                     |
| TW-LINE-018 | partial      | Permission keys `line.*`; the three plan flags are folded into `extra_channels`; the channel cap is not enforced (Reference never did).      |
| TW-LINE-019 | wontfix      | The unused Messaging API client methods have no caller in Reference.                                                                         |

## Decisions where Reference was silent or inconsistent

- **Broadcasts are one push per person, not narrowcast.** Reference's docs page and changelog say broadcasts use LINE's narrowcast API "where an audience filter is set", but the
  code has no audience filter and `LineBroadcastController` sends `push` per recipient in batches of 40. We build the code's behaviour. The unused `narrowcast`, `multicast` and
  `broadcast` calls are not ported (TW-LINE-019).
- **Follow and unfollow are acknowledged and ignored**, as the Reference code does. A comment in Reference says follow events create a thread; the code does not. A friend who never writes
  has no thread, so is not in the audience. Creating threads from follow events would add behaviour Reference does not have.
- **Reference's docs say an invalid reply token falls back to a push**; its code only used a reply token when it was fresh and did not fall back. We fall back (the documented behaviour).
- **A plan without LINE:** every controller carries the plan feature `extra_channels` instead of `access_line`, `line_broadcasts` and `line_channels_limit` (one decision for the three channels).

## Intended differences from Reference

| #   | Area                         | Reference                                                                                           | Here                                                                                                                                                               |
| --- | ---------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Access                       | Plan flags `access_line`, `line_broadcasts`, no role check                                          | Permission keys `line.channels.read                                                                                                                                | manage`, `line.broadcasts.read | manage`and the plan feature`extra_channels`. |
| 2   | Webhook address              | `/api/line/inbound/{token}`                                                                         | `/v2/line/inbound/{token}`. Existing webhooks must be registered once more ("Re-hook").                                                                            |
| 3   | Connect answer               | Redirect back with a flash message; a refused webhook is an error flash on the saved row            | 201 with the channel and a `webhookError` field; a refused webhook is not an HTTP error. Rotation errors are 422 `LINE_ROTATION_FAILED`.                           |
| 4   | Token rotation (fix)         | Signs with `line_channel_id`, which connect fills with the bot user id (U...) that LINE refuses     | The form asks once for the numeric Channel ID; a re-paste keeps a numeric id. A documented bug fix; without it rotation cannot work.                               |
| 5   | Group and room threads (fix) | A group message by a user whose id LINE sent was keyed by that user id, landing in their 1:1 thread | A group or room is a thread of its own keyed by its id, with no contact and no flow. A documented bug fix.                                                         |
| 6   | Send loop                    | Driven by an open browser tab (`/batch` called in a loop); closing it paused it                     | A worker job (`line-broadcast`); closing the page does not pause it. Pause is an explicit action, so "Resume" becomes "Pause".                                     |
| 7   | Counters                     | Incremented per row                                                                                 | Recomputed from the recipient rows after each batch, so an interrupted batch cannot drift them. The "Sending" tile counts every broadcast, not only the 50 listed. |
| 8   | Sender profile               | Fetched on every message, used only for the first                                                   | Fetched only until the person is a contact (same visible result, fewer API calls). The contact also gets LINE's picture address as its image.                      |
| 9   | Stored data                  | `buttons` encrypted array                                                                           | `buttons` is plain JSON (labels, links and numbers of a template; the column is jsonb). The body stays encrypted.                                                  |
| 10  | Webhook signature            | Compared with `hash_equals` on the raw body                                                         | Same, and the answer for a wrong signature is the same 401. The webhook tolerates an empty body (signed, nothing to read).                                         |
| 11  | Consent                      | None                                                                                                | Every broadcast batch asks the ConsentGate (marketing, channel `line`): a contact who withdrew is `blocked` with a reason and not messaged (privacy hardening).    |
| 12  | Files in a reply             | A permanent public URL of our own storage                                                           | A signed link of the cloud bucket that lives a week; local-disk storage has no public address, so the reply fails with `MEDIA_NOT_REACHABLE`.                      |
| 13  | Flood limit                  | `throttle:240,1` per client                                                                         | 240 a minute per routing token (429 beyond).                                                                                                                       |
| 14  | Ids                          | Numeric database ids in URLs                                                                        | Uuids.                                                                                                                                                             |
| 15  | Connect form                 | An inline form on the hub                                                                           | Kept inline on the hub (no modal), as Reference has it.                                                                                                            |
| 16  | `{name}`                     | Screen promises `{name}`; the sender only replaced `{{name}}`                                       | The sender replaces `{name}` too, so what the screen promises is what is sent. Nothing Reference accepted is refused.                                              |
| 17  | Attachment                   | A file picker posted with the form (50 MB)                                                          | A public address, or a file uploaded to the workspace's storage through `POST /v2/media/marketing` with the same picker as the other channels.                     |
| 18  | Hub pills                    | Rich menus, Insights, Broadcasts                                                                    | Broadcasts only: the two others are not built yet (TW-LINE-016, 017), so no dead button is shown.                                                                  |

## Stubbed inputs (shims)

| Shim                                 | Real owner                                              | Effect now                                                                                                |
| ------------------------------------ | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `InboundHooks` (`NoInboundHooks`)    | flow-runtime-engine, TIB routing, AI agents, auto-reply | Nothing consumes a message and nothing replies on LINE; flow sessions (`line_flow_sessions`) stay unused. |
| `InboxIngest` (`ChatInboxIngest`)    | chat-conversations                                      | Real: the inbound pipeline, one channel per account; the sender is a contact keyed by the LINE user id.   |
| `LineTemplates` (`SqlLineTemplates`) | message-templates                                       | Reads `wa_templates` rows whose channel is line directly.                                                 |

## Not verified

- No real LINE call was made. The HTTP client (`line-api.client.ts`) is not covered by a test at all: it was written from LINE's documented endpoints and Reference's client and never exercised.
  The first real connect, send, token rotation and profile or content download must be tried with a sandbox channel.
- The Playwright twin run against the running Reference was not done. UI parity is by reading Reference's views, not by comparing running screens.
- The 3-second polling while a broadcast is sending and the flood limit (240 a minute) are not covered by a test.
- Signed media links: the success path of a file reply is tested with a stand-in link; no cloud bucket was used. Whether LINE fetches a week-old link later than that is unknown.
- Flow hand-off, routing and keyword replies run through stand-ins, so the order "flow first, then routing, AI, keyword" is tested only as hook calls.
- The consent check relies on the contact roll-up flag (`is_unsubscribed`) in the tests; the ledger and the workspace "require consent" switch were not exercised here.
