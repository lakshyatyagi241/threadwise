---
id: email-templates
title: Email templates
summary: Write an email once with a subject, formatted text and variables, then insert it into any email reply, as general mail or as marketing mail.
area: audience
order: 80
documents: [nav:email-templates]
keywords:
  [
    email,
    template,
    reply,
    subject,
    variables,
    merge tags,
    personalise,
    marketing,
    unsubscribe,
    shared,
    personal,
    archive,
    category,
  ]
---

## What it is for

**Email templates** is the library of reusable emails for your email conversations. A template has a name, an optional subject, a formatted message and variables such as the contact's first name. In an email conversation you pick a template, it is filled in for that contact, and you read and edit it before you send. Templates are only for email: they are separate from saved replies (plain text for any channel) and from WhatsApp message templates.

## How to use it

1. Open **Email templates** in the CRM area of the menu, or go to `/email-templates`.
2. Select **New template**. Give it a **Name**. Add a **Subject** if the template should set one; left empty, a reply keeps its own **Re:** subject.
3. Write the **Message** with the toolbar: bold, italic, underline, lists, a quote and links. To personalise it, select a variable chip under **Insert a variable**. It is added where you were last typing, in the subject or in the message.
4. Choose a **Type**, an optional **Category**, and who can use it (see below). The preview at the bottom shows the result with sample data and tells you which variables stayed as written.
5. Select **Create template**.
6. To use it, open an email conversation in the Team inbox, select **Templates** above the reply box and choose one. The message (and the subject, if the template has one) is filled in for the conversation's contact. Edit it, then send as usual. If the box already holds text, you are asked before it is replaced. **Stop using this template** detaches the reply from the template without touching the text.

## Variables

- **Contact**: first name, last name, name, email, phone, plus the contact's own custom fields such as `{{city}}`.
- **You**: your name and first name. **Workspace**: the workspace name, the company name and today's date.
- A variable the contact has no value for stays as written, and the composer warns you so you can fix it before sending. A name that is not a variable at all is flagged the same way. Nothing is invented.
- Values are inserted as plain text: a contact named with markup is shown as text, never as formatting, and a line break in a name cannot change the subject.

## Options and settings

- **Type: General** is for answers and one-to-one mail and is sent like any reply. **Type: Marketing** is promotional mail: where your workspace requires marketing consent, a contact with no consent or one who unsubscribed is not sent to, and the email always ends with an unsubscribe link and carries the one-click unsubscribe headers. The server applies this whenever a reply is sent from a marketing template, whatever the reply box shows.
- **Shared** templates belong to the workspace; only people who may manage templates can create, change, archive or delete them. **Only me** templates are personal and nobody else sees them. The choice is made when you create a template and cannot be changed later.
- **Archive** hides a template from the reply box without deleting it; **Restore** brings it back. An archived template cannot be used. **Delete** removes it for everyone who could use it; emails already sent are not affected.
- Every template shows how many times it was sent and when it was last used. A use is counted when the email was accepted for sending, not when you pick the template.
- Filter the list by **Whose**, **Type**, **Status** and **Category**, or search by name, subject or category. The list loads in pages: select **Load more**.
- A name is unique among the workspace's templates and, separately, among your own. A personal template may reuse a shared name.
- The message is cleaned when it is saved: scripts, styles, forms and unknown markup are removed.

## Plan and access

Email templates are part of the email add-on, so the screen and the Templates button need the email feature on your plan; without it the page asks you to upgrade. Using templates and keeping your own needs the permission to use email templates, and creating or changing shared templates needs the permission to manage them. Owners and admins have both. Managers and agents of workspaces that already existed can manage and use templates respectively; in a new workspace give them the permissions in the Roles editor. Filling a template into a conversation also needs the right to reply to that conversation.

## If something looks wrong

- **No Templates button in the reply box.** You are not in an email conversation, or you lack the permission to use email templates.
- **A variable still shows in braces.** The contact has no value for it, or the name is mistyped. Fill it in by hand or fix the template.
- **Someone else changed this template.** Their version is loaded. Review it and save again.
- **You already have a template with this name.** Choose a different name.
- **The email was not sent after choosing a marketing template.** The contact has not given marketing consent, or has unsubscribed, or is not a saved contact who could carry an unsubscribe link.
