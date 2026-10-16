# Wiring map: Compliance center and regime profiles (COMPL), a product extension

Not a Reference feature. Spec: [privacy-and-data-governance.md](../../specs/privacy-and-data-governance.md) section 11; API:
[compliance.md](../../api/compliance.md); differences recorded in [product-extensions.md](../parity/product-extensions.md). Update this file in
the same change as anything that reads or writes the settings below.

## Route, permission, tables

| Surface                                        | Where                                                                                                                                                                                                         | Gate                                                                |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Screen `/compliance` (Settings, Security tile) | `apps/web/src/features/compliance-center`, route `apps/web/src/app/(app)/(compliance-center)`                                                                                                                 | tile gate `settings.compliance.read`; save needs `.manage`          |
| API `/v2/compliance/*`                         | `apps/api/src/modules/compliance-center`                                                                                                                                                                      | `settings.compliance.read` / `.manage` (migration `20261206090100`) |
| Public page `/trust/<workspace slug>`          | `apps/web/src/app/trust/[org]`, API `GET /v2/public/compliance/trust/:slug`                                                                                                                                   | public; 404 unless `compliance_settings.subprocessors_public`       |
| Tables                                         | `compliance_settings` (PK org_id; `consent_manager_registration` since 20261224090000), `compliance_subprocessors`, `dnc_entries` (Do-Not-Call list, BL-181), `consent_notices.terms_url` + scope `workspace` | forced RLS, `tenant_isolation`                                      |
| API `/v2/compliance/dnc*`                      | `dnc.service.ts`; list (`GET`), add (`POST`), CSV text (`POST /import`), remove (`DELETE /:id`)                                                                                                               | `settings.compliance.read` (list) / `.manage` (everything else)     |
| Help guide                                     | `features/compliance-center/help/compliance-center.md` (+ `.ar.md`), unit `tile:compliance-center`                                                                                                            | like the tile                                                       |

## What reads what (upstream feeders)

| Needs                     | From                                                                                                  |
| ------------------------- | ----------------------------------------------------------------------------------------------------- |
| Country suggestion        | `orders.billing_country` of the latest paid order, else `organizations.settings.country` (onboarding) |
| Time zone default         | `organizations.settings.timezone`                                                                     |
| Checklist: consent        | `ConsentSettingsService.effective()` (detection, require recorded consent)                            |
| Checklist: notices        | `consent_notices` (latest enabled version per scope and ref)                                          |
| Checklist: requests       | `privacy_settings.sla_days`, `privacy_requests` (open, overdue)                                       |
| Checklist: recordings     | `call_recording_settings` (enabled, retention days)                                                   |
| Checklist: sub-processors | `compliance_subprocessors`                                                                            |

## Consumers of the settings (every place they are used)

| Consumer                                                                    | What it takes                                                                                                                                                                                                                                                                                       | State                     |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Form builder, consent line (settings tab)                                   | `GET /v2/compliance/links`: a "use workspace link" button for `privacyUrl` and the new `termsUrl` field                                                                                                                                                                                             | built                     |
| Public form (`/f/<key>`)                                                    | `consent.termsUrl` shown next to the privacy link                                                                                                                                                                                                                                                   | built                     |
| Consent notice editor (chat widget, booking page, store, workspace default) | the links and the default wording as one-click offers; new `termsUrl` field                                                                                                                                                                                                                         | built                     |
| Onboarding, workspace step                                                  | the "do not store protected health information" note (`compliance-center.phi`)                                                                                                                                                                                                                      | built                     |
| Privacy requests deadline (`privacy_settings.sla_days`)                     | compared with the strictest profile's days in the checklist; not changed by it                                                                                                                                                                                                                      | read only                 |
| Chat dispatcher, broadcasts, campaigns, scheduled messages, flows, dialler  | quiet hours (marketing sends are held), calling window (a dial is refused): `SendWindowService`                                                                                                                                                                                                     | built (BL-177)            |
| ConsentGate                                                                 | asked first, and again when a held send is released; the DND registry is a note                                                                                                                                                                                                                     | built / **hook (BL-181)** |
| Consent switch "require recorded consent"                                   | hinted and linked from the profile summary; never flipped by a profile                                                                                                                                                                                                                              | by design (D13)           |
| Per-contact minor tag, parental evidence, do-not-sell opt-out               | `childrenPolicy` + `parentalConsentRequired` -> `minorRuleOf` -> ConsentGate `subject_minor`; `ccpa_us` -> the opt-out switch and the Global Privacy Control rule; tables `contact_privacy_*`                                                                                                       | built (BL-180)            |
| DPDP consent manager, DNC / NDNC feed                                       | name, link and registration number stored as a note; the inbound event is a contract only (`consentManagerEventSchema`, BL-222). The workspace's own Do-Not-Call list (`dnc_entries`) is read by the ConsentGate for voice and SMS marketing (reason `on_dnc_list`); no registry is called (BL-221) | **placeholder (BL-181)**  |

## Privacy register entries

`dnc_entries` holds phone numbers of people who asked not to be called: holder `consent.ledger` in `privacy/manifests/contacts.ts`, disposition `retain` (an erasure keeps the suppression record, the note is the reason). `compliance_settings` and `compliance_subprocessors` hold no contact's data (officer contacts are the workspace's business contacts). Both are on
`apps/api/src/modules/privacy/registry/allowlist.ts` as `workspace`. They go with the workspace on a workspace wipe (cascade on `organizations`).

## Open

BL-191 to BL-193 (quiet hours: the remaining senders, a recurring campaign's held recipients, a visible contact time zone), BL-181 (the DNC list is built; the registries and the consent manager route are BL-221 and BL-222), BL-188 to BL-190 (follow-ups of BL-180). BL-180 (contact-level extras) is built: saving the Compliance center drops the gate's cached minor rule. Owner decisions D13 to D17 are in
the spec, section 11.8.

BL-191 (built): the remaining senders hold the same way. Held-recipient helpers live in `apps/api/src/modules/compliance-center/held-recipients.ts` (`splitByQuietHours`, `holdRecipient`, `heldSummaries`, `scheduleWake`); phone-only audiences use `SendWindowService.checkPhones`. See the per-channel wiring files.
