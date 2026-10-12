# Contact consent API

Product extension (spec [contact-consent-ledger.md](../specs/contact-consent-ledger.md)). Errors are problem+json with a stable `code`.

## Workspace API (`/v2/contact-consent`, session or bearer user)

| Route                                            | Permission                | Notes                                                                                                                                                                                                                                      |
| ------------------------------------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /settings`                                  | `settings.consent.manage` | Defaults when never saved: detection on, auto reply on, policy off                                                                                                                                                                         |
| `PATCH /settings`                                | `settings.consent.manage` | Whole document; `rowVersion` absent on the first save. 409 `ROW_VERSION_CONFLICT`, 422 `CONSENT_SETTINGS_INVALID`                                                                                                                          |
| `POST /settings/test`                            | `settings.consent.manage` | `{ text, optOutKeywords?, optInKeywords? }` gives `{ match, keyword, lang, reply, outcome }`; changes and sends nothing                                                                                                                    |
| `GET /composer-config`                           | any composer permission   | Footer text, its default, the policy switch                                                                                                                                                                                                |
| `GET /events?limit&cursor&channel&action&source` | `contacts.consent.read`   | Newest recorded first                                                                                                                                                                                                                      |
| `GET /contacts/:uuid`                            | `contacts.consent.read`   | `{ contactId, optedOut, states[], events[] }`                                                                                                                                                                                              |
| `POST /contacts/:uuid/events`                    | `contacts.consent.manage` | `{ action: granted or withdrawn, channel, purpose, note, evidence }`. A grant needs `note` (422 `CONSENT_NOTE_REQUIRED`). `Idempotency-Key` makes a repeat record nothing (409 `CONSENT_IDEMPOTENCY_MISMATCH` if reused for another event) |
| `GET /contacts/:uuid/export`, `GET /export`      | read / manage             | CSV with formula-safe cells; the workspace export is capped at 50,000 rows (`X-Export-Truncated: true`)                                                                                                                                    |

## Customer REST API v1

`GET /api/v1/contacts/{id}/consent` (scope `contacts:read`) and `POST /api/v1/contacts/{id}/consent` (scope `contacts:write`, the
source is stored as `api`). The existing `is_unsubscribed` field keeps working and now also writes the ledger.

## Events

`contact.consent.granted`, `contact.consent.withdrawn` (payload: contactId, channel, purpose, source, eventId),
`contact.consent.settings_changed`.
