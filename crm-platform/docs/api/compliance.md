# Compliance center (regime profiles, officer contacts, sub-processors, checklist)

Product extension (no reference screen). Spec: [privacy-and-data-governance.md](../specs/privacy-and-data-governance.md) section 11. Wiring:
[../threadwise-port/wiring/compliance-center.md](../threadwise-port/wiring/compliance-center.md). Position on health data:
[../privacy/hipaa-not-supported.md](../privacy/hipaa-not-supported.md). DPA template: [../privacy/dpa-template.md](../privacy/dpa-template.md).

Wording rule for every screen, text and answer here: **tools to help a workspace comply**. Nothing returns or says that a workspace "is
compliant"; a `built` row means the tool is set up.

All routes are `/v2/compliance/...`, user tokens only, except the public page.

| Method and path                         | Permission                                                       | What                                                                                                                                               |
| --------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /settings`                         | `settings.compliance.read` or `.manage`                          | the settings document, `suggestion` (country, source `billing` or `onboarding`, profiles), `regimesConfirmedAt`, `workspaceTimezone`, `rowVersion` |
| `PATCH /settings`                       | `settings.compliance.manage`                                     | save the whole document; `rowVersion` as read (absent on the first save); a non-empty `regimes` confirms the choice                                |
| `GET /links`                            | read, manage, `settings.consent.manage` or `record.forms.update` | `privacyUrl`, `termsUrl` and the current English default notice (`noticeText`), for the form builder and the notice editor                         |
| `GET /checklist`                        | read or manage                                                   | `items[]` (id, scope `baseline` or `profile`, regimes that ask for it, status `built`/`partial`/`open`, `detail`, `params`, `href`) and `summary`  |
| `GET /subprocessors`                    | read or manage                                                   | the workspace list, in-use first, then by name                                                                                                     |
| `POST /subprocessors`                   | manage                                                           | add (name unique per workspace, any capitalisation: 409 `COMPLIANCE_SUBPROCESSOR_DUPLICATE`)                                                       |
| `PATCH /subprocessors/:id`              | manage                                                           | change, with the `rowVersion` read (409 `ROW_VERSION_CONFLICT`)                                                                                    |
| `DELETE /subprocessors/:id`             | manage                                                           | remove (204); mark it `removed` instead to keep the history                                                                                        |
| `GET /v2/public/compliance/trust/:slug` | none (public, throttled 60 per minute per IP)                    | the workspace's active sub-processors, privacy and terms links and privacy contact; 404 unless the workspace switched `subprocessorsPublic` on     |

Roles: Owner and Admin everything; Manager `settings.compliance.read` (migration `20261206090100_compliance_permissions.sql`).

## Settings document

`regimes` (any of `gdpr_eu`, `uk_gdpr`, `dpdp_in`, `ccpa_us`, `tcpa_us`, `trai_in`, `lgpd_br`, `pdpa_sg`, `generic`), `privacyUrl`, `termsUrl`
(https only), `dpo` and `grievanceOfficer` (name, email, phone, address), `childrenPolicy` (`unset`, `no_minors`, `may_include_minors`),
`parentalConsentRequired` (with `childrenPolicy`, the rule the ConsentGate applies to a contact flagged as a minor, BL-180), `offerSaleShareOptOut`, `optOutNoticeUrl`, `consentManager` (name, url: a placeholder), `quietHours` (enabled,
start, end: may cross midnight), `callingWindow` (enabled, start, end, ISO weekdays), `windowTimezone` (IANA or null for the workspace's),
`dndRegistry` (`none`, `trai_ndnc`, `us_dnc`, `sg_dnc`, `custom`: a note), `secondaryNoticeLocale` (the second DPDP notice language),
`subprocessorsPublic`.

Rules: a calling window ends after it starts on the same day and has a day; quiet hours need an end different from the start; the time zone
must exist; the second language is not English; a link is https. Otherwise 422 `COMPLIANCE_SETTINGS_INVALID` with the field paths.

**The country only suggests.** The billing country of the latest paid order (a free-text field, read as an ISO code or a common name) wins
over the country given at onboarding. Nothing is switched on by a suggestion: the profiles listed in `regimes` are only those a person saved.

**Quiet hours and calling windows are enforced by deferring, not denying** (BL-177); the DND registry is still a note (BL-181). Spec:
[section 11.5](../specs/privacy-and-data-governance.md). The decision is `SendWindowService` (`apps/api/src/modules/compliance-center`, module
`SendWindowModule`) over the pure `decideSendWindow` / `resolveContactZones` in `@crm/contracts` (`compliance/send-window.ts`):

| Sender                                   | Marketing send inside the quiet hours                                                                                                                          |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inbox, REST API v1 (`ChannelDispatcher`) | accepted; the message stays `queued` with `meta.hold`, event `held`, its `message-dispatch` job is delayed to the opening; `MessageResponse.hold` while queued |
| Flows (`FlowSender`)                     | the run halts (`SEND_HELD`) and tries again every 5 minutes                                                                                                    |
| Broadcasts                               | recipient stays `pending` with `held_until`; the rest is sent; the broadcast is `paused` with reason `quiet_hours` and resumes by itself                       |
| Campaigns and guided follow-ups          | recipient back to `queued` with `held_until` (the claim skips it); the campaign is scheduled again for the first opening                                       |
| Scheduled messages                       | recipient stays `pending` with `held_until`; the schedule pauses until the first opening (the due sweep resumes it)                                            |
| LINE, Messenger, Telegram, Viber broadcasts (BL-191) | recipient goes back to `pending` with `held_until`; the claim skips it; the rest is sent; the run ends and a **delayed job** (`<uuid>-held-<opening>`) takes the held up at the first opening; the list shows `held` and `heldUntil` |
| WeChat broadcast (BL-191)                | one mass-send call: the whole broadcast waits (`wechat_broadcasts.held_until`), read on the workspace clock, then the call is made at the opening                 |
| Instagram broadcasts page (BL-191)       | the answer carries `held` and `heldUntil`; a delayed job (`ig-pull` queue, `held-broadcast`) sends them at the opening; the inbox composer is never held        |
| Shopify / WooCommerce offer and win-back (BL-191) | the log row stays `processed` with `held`; a delayed `broadcast` job with `resume` sends the held customers at the opening and ends the log with both runs' totals |
| Wizard test send (BL-191)                | a test of a MARKETING template to a number in its quiet hours is logged `held` (`camp_test_sends.held_until`) and a `test-send-release` job on the campaign queue sends it at the opening |
| Dial (`POST /v2/calling/calls/dial`)     | **refused**, 422 `CALL_OUTSIDE_WINDOW` with `opensAt`, `zone`, `zoneSource` in the details; a call back to someone who contacted us in 24 hours is exempt      |

Only the `marketing` ledger purpose is asked: replies in the 24 hour window, utility and authentication templates, booking notices are never
held. The window is the one the workspace switched on (a profile only suggests hours). The ConsentGate runs first (a denied contact is refused,
never merely held) and **again at release**. Which clock: the contact's time zone property (a contact property of type `timezone`, else a
property keyed `timezone`), the country code of the number (a country spanning hours must be inside the hours in all its zones), the zone
chosen in the settings (`windowTimezone` is the fallback), the workspace zone, UTC. When the windows cannot be read a marketing send waits
five minutes. Migration `20261216090000_quiet_hours_hold.sql` adds the `held` message event and `held_until`/`held_reason` to
`broadcast_contacts`, `wp_campaign_contacts` and `scheduled_message_contacts` (no new table). Migration `20261222090000_quiet_hours_senders.sql`
(BL-191) adds the same two columns to `line_`, `facebook_`, `telegram_` and `viber_broadcast_recipients`, to `wechat_broadcasts` and to
`camp_test_sends` (status `held`).

**The remaining senders (BL-191), how they differ.** Every social broadcast is marketing, so it is always asked (no purpose to read). A
recipient with a conversation is read on its contact's clock (the conversation's `contact_id`); one without (a group, a person who never
became a contact) on the workspace fallback clock. Wake-up: a BullMQ delayed job on the sender's own queue, named by broadcast and opening so
asking twice queues once; if Redis is down the recipients stay `pending` with `held_until` and the next Start (or run) takes them up. At release
the ConsentGate is asked again for LINE (every batch), and for a released recipient on Messenger, Telegram, Viber and Instagram (a recipient that
was never held keeps the check those senders had before: none). Messenger still checks its 24 hour window at send time, so a person whose
window closed while they waited is `blocked` with a note saying so. WeChat cannot be split per contact, so the whole mass send waits on the
workspace clock. Commerce broadcasts and the wizard test send hold only a MARKETING template (a utility one is a notice). Not covered: the
event messages of a store (abandoned cart, order status) and the one-off sends of other screens.

## Strictest wins

`effectivePolicy(regimes)` and `suggestRegimes(country)` are pure functions in `packages/contracts/src/compliance/regimes.ts`; the web screen
uses them for the summary, the API for the checklist.

## Checklist

Facts read per request: the consent settings (detection, require consent), the workspace's current notices, `privacy_settings` and
`privacy_requests` (deadline, open, overdue), `call_recording_settings`, the settings row and the sub-processor list. The rules are the pure
`buildChecklist` (`compliance-checklist.rules.ts`); `CHECKLIST_DETAIL_KEYS` in contracts lists every sentence a row can carry and the web
test proves each has text in every language.

## Consent notices (changed by this feature)

`PUT/GET /v2/contact-consent/notices/:scope/:ref` now also carries:

- `termsUrl` (optional, https, additive: an older client that does not send it keeps working and stores null). A change to it is a new
  version, like the privacy `url`.
- scope `workspace`, `ref` a language code (`en`, `hi`...): the workspace default notice (BL-179). Same permission
  (`settings.consent.manage`).

The public consent notice (`PublicConsentNotice`) also carries `termsUrl` (optional on the wire). The forms builder's consent block
(`formConsentSchema`) has an optional `termsUrl` next to `privacyUrl`, and the public form returns it.

## Audit and events

Settings: audit module `compliance_settings` (changed fields; the officer contacts are recorded as "changed", never with their values);
outbox `compliance.settings_changed`. Sub-processors: audit module `compliance_subprocessors`; outbox `compliance.subprocessor_added`,
`_changed`, `_removed`.

## Errors

`COMPLIANCE_SETTINGS_INVALID` 422, `COMPLIANCE_SUBPROCESSOR_NOT_FOUND` 404, `COMPLIANCE_SUBPROCESSOR_DUPLICATE` 409,
`COMPLIANCE_TRUST_PAGE_NOT_FOUND` 404 (the public page answers one 404 for every reason), `ROW_VERSION_CONFLICT` 409.

## Data

Migration `20261206090000_compliance_center.sql`: `compliance_settings` (one row per workspace), `compliance_subprocessors`,
`consent_notices.terms_url`, the `workspace` scope. Forced RLS on both new tables. Neither table holds a contact's data (the officer
contacts are the workspace's own business contacts); both are on the privacy registry allowlist.
