# Email templates API (BL-004 / E-14)

The workspace's library of reusable emails behind the email composer's Templates button and the `/email-templates` screen. A template is
a name, an optional subject, a rich-text body and `{{variables}}`. Code: `apps/api/src/modules/email-templates/`, the render route in
`apps/api/src/modules/team-inbox-conversations/email-templates/`, contracts in `packages/contracts/src/email-templates/index.ts`, table
`email_templates` (migrations 20261202090000 and 20261202090100). Wiring: [wiring/email-templates.md](../threadwise-port/wiring/email-templates.md).
Parity: [parity/email-templates.md](../threadwise-port/parity/email-templates.md).

All routes are for staff users only, part of the email add-on (plan feature `email_channel`: a workspace without it gets
`422 PLAN_FEATURE_LOCKED` and keeps its data), errors are problem+json with a stable `code`, every mutation takes an `Idempotency-Key`.

| Method and path                             | Permission                                                             | What                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /v2/email/templates`                   | `mail.templates.read`                                                  | Shared templates plus the caller's own personal ones, newest first. Query `q` (name, subject, category), `scope` (`all`, `shared`, `mine`), `purpose`, `status` (`active` default, `archived`, `all`), `category`, `limit` (1 to 100), `cursor`. Answers `data`, `page`, `categories`                                                            |
| `POST /v2/email/templates`                  | `mail.templates.read`, and `mail.templates.manage` for `scope: shared` | Create. Body `name`, `subject?`, `bodyHtml`, `bodyText?`, `category?`, `purpose` (`general` default, `marketing`), `scope` (`shared` default, `mine`). 201. A shared template without the manage right is `403 EMAIL_TEMPLATE_NOT_EDITABLE`                                                                                                      |
| `GET /v2/email/templates/:id`               | `mail.templates.read`                                                  | One template (a colleague's personal template is 404)                                                                                                                                                                                                                                                                                            |
| `PATCH /v2/email/templates/:id`             | `mail.templates.read`, then per row                                    | Any subset of the fields (and `status: archived\|active`) with the `rowVersion` read: `409 ROW_VERSION_CONFLICT` otherwise. A shared template needs `mail.templates.manage`, a personal one is its owner's. The scope cannot change                                                                                                              |
| `DELETE /v2/email/templates/:id`            | `mail.templates.read`, then per row                                    | 204                                                                                                                                                                                                                                                                                                                                              |
| `POST /v2/email/templates/preview`          | `mail.templates.read`                                                  | Body `subject?`, `bodyHtml`. Renders unsaved text with sample data (the HTML sanitised exactly as on save) and lists the variables left as written in `issues`. Stores nothing                                                                                                                                                                   |
| `POST /v2/inbox/email-templates/:id/render` | `mail.templates.read` and the right to reply to the conversation       | Body `{ conversationId }`. The template filled in for that conversation's contact, the caller and the workspace: `{ subject, html, text, issues, source }`. Sends nothing, counts nothing. `422 EMAIL_TEMPLATE_ARCHIVED`, `422 CHANNEL_CAPABILITY_UNSUPPORTED` (not an email thread), `404` for a conversation or template the caller cannot see |

## Rules

- **Name** up to 120 characters, unique per owner ignoring case: one shared template per name, one personal template per person per
  name (a personal one may reuse a shared name). A clash is `409 EMAIL_TEMPLATE_NAME_TAKEN`.
- **Subject** up to 300 characters, one line, optional. Empty means the reply keeps its own `Re:` subject. **Body** up to 100,000
  characters of HTML, required.
- **HTML** is sanitised on write with the same allow-list as signatures and outbound mail; the text twin is derived when not given.
- **Variables** `{{key}}` use the saved-reply catalogue without the device group: contact (`first_name`, `last_name`, `name`, `email`,
  `phone` and the contact's custom attributes), agent (`agent_name`, `agent_first_name`), workspace (`workspace_name`, `company_name`,
  `today`). A variable with no value, and one that does not exist, stay as written and are returned in `issues` (`empty` or `unknown`).
  Values are HTML-escaped in the body and flattened to one line in the subject, so a contact cannot inject markup or a header.
- **Visibility**: a colleague's personal template does not exist for you: 404 by id, absent from the list, not usable in a reply.
- **Archived** templates are hidden from the default list and cannot be rendered or used in a reply.
- **Audit and events**: module `email_templates` (insert, update, delete); outbox `mail.email_template.created`, `.updated`, `.deleted`.
  Using a template is not audited (it is a counter, `used_count` and `last_used_at`, which never move `rowVersion`).

## Sending from a template

The composer fills its box from `POST /v2/inbox/email-templates/:id/render` and sends the reply through the normal message route with
`email.templateId` set (`POST /v2/inbox/conversations/:id/messages`, `kind: text`). The server then:

1. checks the sender may use the template (404 `EMAIL_TEMPLATE_NOT_FOUND`, 422 `EMAIL_TEMPLATE_ARCHIVED`) before the reply is queued;
2. when the template is `marketing`, stores the reply as marketing mail. The client cannot set or clear this: the ConsentGate treats it as
   `marketing_messaging`, and the email adapter adds the signed unsubscribe link (to the text part AND the HTML part) and the RFC 8058
   `List-Unsubscribe` headers; a recipient who is not a contact is refused;
3. after the provider accepted the mail, counts one use of the template. A template deleted in the meantime counts nothing and does not
   stop the mail.

The signature, attachments, rate limits and bounce protection of the email channel apply unchanged.
