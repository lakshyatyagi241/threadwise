# Wiring map: Compliance center and regime profiles (COMPL), a product extension

Not a Reference feature. Spec: [privacy-and-data-governance.md](../../specs/privacy-and-data-governance.md) section 11; API:
[compliance.md](../../api/compliance.md); differences recorded in [product-extensions.md](../parity/product-extensions.md). Update this file in
the same change as anything that reads or writes the settings below.

## Route, permission, tables

| Surface                                          | Where                                                                                                   | Gate                                                                  |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Screen `/compliance` (Settings, Security tile)   | `apps/web/src/features/compliance-center`, route `apps/web/src/app/(app)/(compliance-center)`           | tile gate `settings.compliance.read`; save needs `.manage`            |
| API `/v2/compliance/*`                           | `apps/api/src/modules/compliance-center`                                                                | `settings.compliance.read` / `.manage` (migration `20261206090100`)   |
| Public page `/trust/<workspace slug>`            | `apps/web/src/app/trust/[org]`, API `GET /v2/public/compliance/trust/:slug`                              | public; 404 unless `compliance_settings.subprocessors_public`         |
| Tables                                           | `compliance_settings` (PK org_id), `compliance_subprocessors`, `consent_notices.terms_url` + scope `workspace` | forced RLS, `tenant_isolation`                                  |
| Help guide                                       | `features/compliance-center/help/compliance-center.md` (+ `.ar.md`), unit `tile:compliance-center`       | like the tile                                                         |

## What reads what (upstream feeders)

| Needs                                  | From                                                                                                              |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Country suggestion                     | `orders.billing_country` of the latest paid order, else `organizations.settings.country` (onboarding)             |
| Time zone default                      | `organizations.settings.timezone`                                                                                 |
| Checklist: consent                     | `ConsentSettingsService.effective()` (detection, require recorded consent)                                         |
| Checklist: notices                     | `consent_notices` (latest enabled version per scope and ref)                                                       |
| Checklist: requests                    | `privacy_settings.sla_days`, `privacy_requests` (open, overdue)                                                    |
| Checklist: recordings                  | `call_recording_settings` (enabled, retention days)                                                                |
| Checklist: sub-processors              | `compliance_subprocessors`                                                                                         |

## Consumers of the settings (every place they are used)

| Consumer                                     | What it takes                                                                                                                     | State                        |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Form builder, consent line (settings tab)    | `GET /v2/compliance/links`: a "use workspace link" button for `privacyUrl` and the new `termsUrl` field                           | built                        |
| Public form (`/f/<key>`)                     | `consent.termsUrl` shown next to the privacy link                                                                                 | built                        |
| Consent notice editor (chat widget, booking page, store, workspace default) | the links and the default wording as one-click offers; new `termsUrl` field               | built                        |
| Onboarding, workspace step                   | the "do not store protected health information" note (`compliance-center.phi`)                                                    | built                        |
| Privacy requests deadline (`privacy_settings.sla_days`) | compared with the strictest profile's days in the checklist; not changed by it                                          | read only                    |
| ConsentGate / dispatcher                     | quiet hours, calling window, DND registry                                                                                         | **not wired (BL-177)**       |
| Consent switch "require recorded consent"    | hinted and linked from the profile summary; never flipped by a profile                                                            | by design (D13)              |
| Per-contact minor tag, parental evidence, do-not-sell opt-out | `subject_minor` reason and BL-140b columns                                                                       | **not built (BL-180)**       |
| DPDP consent manager, DNC / NDNC feed        | name and link stored as a note                                                                                                    | **placeholder (BL-181)**     |

## Privacy register entries

`compliance_settings` and `compliance_subprocessors` hold no contact's data (officer contacts are the workspace's business contacts). Both are on
`apps/api/src/modules/privacy/registry/allowlist.ts` as `workspace`. They go with the workspace on a workspace wipe (cascade on `organizations`).

## Open

BL-177 (enforcement by deferring), BL-180 (contact-level extras), BL-181 (integrations behind the placeholders). Owner decisions D13 to D17 are in
the spec, section 11.8.
