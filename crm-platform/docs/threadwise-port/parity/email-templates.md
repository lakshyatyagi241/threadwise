# Parity: email templates

Reference has no email-templates feature, so there is no running Reference behaviour to compare against and the WaDesk parity
run has nothing to be the oracle for. The behaviour follows `docs/specs/email-channel-and-social-leads.md` E-14 and the saved-replies
precedent (see [wiring/email-templates.md](../wiring/email-templates.md)).

## Intended (decisions in the build)

| Id    | Decision                                                                                                                                                                    |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ET-D1 | Templates are email-only (subject + rich text). Saved replies stay the plain-text, any-channel library; the two are not merged.                                             |
| ET-D2 | A `marketing` template makes the reply marketing mail on the SERVER (ConsentGate + unsubscribe link and headers), never on the client's word.                               |
| ET-D3 | Creating a personal template needs only `mail.templates.read` (saved replies make even a personal reply need the manage right); a shared one needs `mail.templates.manage`. |
| ET-D4 | A use is counted when the provider accepted the mail, not when the template is inserted.                                                                                    |
| ET-D5 | The marketing unsubscribe link is now also written into the HTML part of a rich reply (before, only the text part and the headers carried it).                              |
| ET-D6 | Variable values are HTML-escaped in the body and flattened to one line in the subject (saved replies are plain text and need neither).                                      |

## Not verified

- No browser run of the screen or the composer picker in this change (the Next.js dev server cannot start in the agent sandbox); the
  web slice is covered by type checks, string-render component tests and the message-key tests, and the API slice by unit, schema
  (real Postgres) and end-to-end tests through the Gmail stand-in.
- No real mail provider was used. The send path is proven against the in-repo Gmail stand-in only.
- Right-to-left layout of the screen and the editor (Arabic, Hebrew, Urdu) was not looked at.
