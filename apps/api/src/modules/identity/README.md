# Identity & Channels

Partially implemented — `contact_identities` is live and used by the contacts
slice. Still to come:

```
identity/
  channels/         connected endpoints (WhatsApp numbers, sender IDs, inboxes)
  visitors/         anonymous web-bot sessions, promoted on capture
  consents/         per-channel opt-in / opt-out
  resolution/       inbound → contact resolution + auto-merge
  identity.module.ts
  index.ts
```

## Resolution order for an inbound message

1. Look up `contact_identities` by `(kind, normalised value)` — unique per org,
   so this is a single indexed hit and can never be ambiguous.
2. Miss → match on `normalized_phone` / `normalized_email`. Found → **attach**
   the new identity to that contact (auto-merge).
3. Still no match → create a contact, then create its identity.

The result: the same person on WhatsApp and on the website is one contact with
one timeline, not two half-records that someone has to merge by hand later.

## Consent

Checked per recipient at send time. An opted-out contact produces a
`campaign_recipients` row with `skip_reason = 'opted_out'` — recorded, never
silently dropped. Consent history lives in `audit_log`.

## Channel credentials

Encrypted at the application layer via `CryptoService` before they touch the
database. A database dump must not be a working set of API tokens.
