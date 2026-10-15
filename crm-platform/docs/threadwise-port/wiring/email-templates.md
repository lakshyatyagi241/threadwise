# Wiring map: email templates (BL-004 / E-14)

Reference has no email-templates feature (its only "template" concepts are WhatsApp/Meta message templates, which are the
`message-templates` domain, and the plain-text Quick Replies, which are `saved-replies`). This is a Threadwise feature specified in
`docs/specs/email-channel-and-social-leads.md` (E-14: "Saved replies and the email templates feature usable in the composer ... variable
substitution from the contact") and reserved in the menu as the planned `email-templates` entry. There is nothing in `reference/` to
port; the closest precedents here are saved replies (library, scopes, variables) and email signatures (rich text, sanitising).

| What             | Where                                                                                                                                                                                                                                                                                          |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Route (web)      | `/email-templates` (nav entry `email-templates`, CRM group, order 80, gate `mail.templates.read` + plan feature `email_channel`); the Templates button in the email composer of the Team inbox                                                                                                 |
| Route (API)      | `/v2/email/templates` (list, create, `:id` get, patch, delete, `preview`) and `/v2/inbox/email-templates/:id/render` ([docs/api/email-templates.md](../../api/email-templates.md))                                                                                                             |
| Permissions      | `mail.templates.read` (see, insert, keep personal templates), `mail.templates.manage` (create and change SHARED templates); the render route also needs the right to reply to the conversation                                                                                                 |
| Plan             | feature `email_channel` on the controller, the nav entry and both permission keys (`permission_defs.plan_feature`). No limit key: templates are not metered (decision for the owner)                                                                                                           |
| Tables           | `email_templates` (RLS forced, composite FKs, partial unique indexes on the lower-cased name per owner, usage trigger that keeps `row_version` still); reads `contacts`, `users`, `conversations` for the render                                                                               |
| Upstream feeders | agents write the templates; the contact merge-tag resolver (`MergeTagService`), the caller's name, the workspace name                                                                                                                                                                          |
| Downstream       | the email reply path (`email.templateId` on the message route -> `messages.meta.emailReply` -> `OutboundEmail.templateId/marketing`), ConsentGate (marketing purpose), the email adapter (unsubscribe link and headers), `used_count`, audit `email_templates`, outbox `mail.email_template.*` |

## Every consumer

| Consumer                                             | Here                                                                                                                                                                                                                         |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Email composer "Templates" picker                    | `EmailTemplatePicker` (features/email-templates), mounted by `composer.tsx` for an email conversation; fills the box and the subject, never sends; asks before replacing text                                                |
| Reply route `POST /inbox/conversations/:id/messages` | `email.templateId`: checked in `InboxThreadService.send` through `EmailTemplatesReader.purposeForReply`; a marketing template sets `marketing` server-side (stored in `messages.meta.emailReply`, so a retry sends the same) |
| ConsentGate                                          | unchanged: `ChannelDispatcher` already treats `email.marketing` as `marketing_messaging`; now reachable from a template                                                                                                      |
| Email adapter / outbound preparer                    | marketing mail now also gets the unsubscribe link in the HTML part (it was text-only for rich replies) and counts a use after the provider accepted it (`MailOutboundPreparer.sent` -> `EmailTemplatesReader.recordUse`)     |
| Help centre                                          | `features/email-templates/help/email-templates.md`                                                                                                                                                                           |
| Roles editor                                         | both keys carry `plan_feature = 'email_channel'` so they are hidden in a workspace without the add-on                                                                                                                        |

## Not built, recorded

- Templates in **campaigns and broadcasts over email**: those domains have no email send path yet (BL-141 left the `marketing` flag in
  place for them). When they get one they should call `EmailTemplatesService`/`Reader` through the barrel; nothing needs to change here.
- Templates for **bot, flow and automation** emails (no sending person): the render needs a conversation and a person, so these stay
  out until an automation sender exists.
- Import and export (CSV), duplicate, versions and attachments on a template.
- A plan limit key for templates (the saved-replies limit pattern) and Manager/Agent grants for workspaces created after the
  migration (`provision_workspace_presets` does not know the keys, like the forms keys; the Roles editor widens them).
