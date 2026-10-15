---
id: forms-builder
title: Building a form
summary: Add fields, map them to contact and company properties, style the form and publish it.
area: campaigns
order: 16
documents: []
gates:
  planFeature: form_builder
keywords: [form builder, fields, crm mapping, custom fields, hidden fields, utm, consent, theme]
---

## What it is for

The builder has four tabs: **Build**, **Design**, **What happens next** and **Share**. Changes stay in your browser until you select **Save draft**, and visitors see nothing new until you select **Publish**.

## Build

1. Add fields from the left. **CRM properties** comes first: pick a contact or company property and the field is added already linked to it (Full name and Email are marked **In form** once used). Below it, **New fields** lists the field types: short text, long text, email, phone number, number, amount, date, dropdown, single choice, multiple choice, checkbox and rating. **Text and layout** adds a heading, a paragraph or a divider.
2. Select a block to change its settings on the right: label, help text, placeholder, required, width (full or half) and its rules. A choice field has an options list you can reorder.
3. Move a block with its up and down buttons, duplicate it, or remove it. On a phone or a narrow window, **Add a field** opens the same list in a dialog, and a field's settings open under it; the three-column layout needs a wide screen.
4. Set the form title and the introduction above the list. The introduction accepts plain text and the simple tags b, i, u, br, ul, ol, li and a.

### Where an answer goes

Each field either stays with the submission only (**Create new field**) or fills a CRM property (**Map to CRM property**). The property list shows built-in contact and company properties and your custom ones. A property your workspace marks as required must be in the form and must be required, and the form cannot be published without it. A property can be used by one field only.

**Address.** The contact and the company each have their own **address** group. **Add all address fields** adds Street, City, State or region, Postal code and Country in one go. The CRM keeps one address line, so the parts are joined into it ("12 Park Street, Kolkata, West Bengal 700016, India"); parts left empty are skipped. If a field is also linked to the **Full address**, that field wins and the parts are ignored. A returning contact keeps an address a person already entered; only blanks are filled. **Middle name** is also available for contacts.

A form needs a way to reach the person: link an email or a phone field to the contact. Without it the form cannot be published.

### Hidden fields

A **hidden field** is saved with every submission without the visitor seeing it. Its value is a tracking parameter (UTM source, medium, campaign, term or content), the referring page, the page address, or a fixed value you type.

## Design

Pick one of eight themes, then change colours, corner shape, spacing, font, font size, label position, button style and width, shadow, the maximum width, light or dark mode and the layout (classic, full width, split with a cover image, or minimal). Logo, cover and background are https addresses. A live preview beside the controls shows the form on desktop or a phone width, and a warning appears when text or the button falls under a contrast ratio of 4.5 to 1. Forms are styled with these settings only: there is no custom code.

## What happens next

Set the submit button text, the thank-you message or a redirect address (https only), an optional consent box, the company match rule, tags and lifecycle stage added to every contact, who owns the contact (nobody, one person or in turn), who is notified, and the protection settings: the hidden spam trap, CAPTCHA, how long answers are kept, and rate limits.

### Spam protection and notifications

- **Hidden trap field**: a field people never see. A bot that fills it gets a normal-looking thank-you, nothing is stored, and it is counted under Protection ("stopped N bots this month").
- **CAPTCHA**: the CAPTCHA provider belongs to your platform administrator, not to your workspace. **Follow the platform setting** checks visitors when the platform has one. **Always on** needs one: without it the form checks nothing, a warning says so, and publishing is refused. **Off** skips the check for this form. The section always says whether the platform has a CAPTCHA.
- **Spam bin**: a submission that looks like spam is kept, not deleted, and is not notified. Protection shows how many are held, with a link to the **Spam** tab, where **Not spam: process it** creates the contact and sends the usual notification.
- **Notifications**: the contact's owner and the people you list get an in-app notification for every submission, and the email addresses you list get an email. Selecting the notification opens that exact submission, with the consent wording and time the visitor agreed to.

## Save, publish and versions

- **Save draft** stores your work. A form with unsaved changes warns you before you leave the page.
- **Publish** saves, checks the form and makes it a new numbered version. If something blocks it, a list says what to fix.
- **Versions** under **More** lists every published version. **Restore** copies one into the draft; it does not change what visitors see until you publish.
- **Preview** shows the draft as visitors will see it. Nothing is sent from the preview.

## Plan and access

Changing a form needs permission to update forms. Without it every control is read only.

## If something looks wrong

- **Someone else changed this form.** A save is refused when the form was changed elsewhere after you opened it. Reload and make your change again.
- **The CRM property list is empty.** It could not be loaded. You can still add plain fields.

## Consent wording and channels

The consent box can link to your privacy policy and to your terms. If you stored them once under [Compliance center](help:compliance-center), a button under each field fills them in.

Under **Channels this consent covers** tick the channels you will use: WhatsApp, SMS, email. The consent text is written for you from your choice (for example "I agree to receive updates and offers on WhatsApp and email. I can reply STOP at any time to unsubscribe."). You can edit it; once you do, ticking a channel no longer rewrites it, and a button offers the generated sentence again. The wording, its version and the channels are stored with every submission as proof. Changing the channels of a published form starts a new wording version. A channel the form has no field for (no phone number or no email) is flagged: nobody can be subscribed on it from that form.

## What the consent line records

- **Marketing opt-in on**: a ticked box records marketing consent only on the channels you ticked, and only where the visitor gave a phone number (WhatsApp, SMS) or an email address (email).
- **Marketing opt-in off**: the line is not marketing. A ticked box is recorded as the person's agreement to be contacted about their request (service messages only) on the ticked channels, with this exact wording and its version. It never subscribes anyone to marketing.
- **Unticked**: if the box is optional and the visitor leaves it empty, nothing is recorded about consent. The submission still keeps the wording that was shown.

Someone who already stopped a channel is not turned back on by a new submission.
