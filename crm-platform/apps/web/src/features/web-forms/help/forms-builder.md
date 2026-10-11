---
id: forms-builder
title: Building a form
summary: Add fields, map them to contact and company properties, style the form and publish it.
area: campaigns
order: 16
documents: []
gates:
  planFeature: form_builder
keywords:
  [
    form builder,
    fields,
    crm mapping,
    custom fields,
    hidden fields,
    utm,
    consent,
    theme,
    design,
    publish,
    versions,
  ]
---

## What it is for

The builder has four tabs: **Build**, **Design**, **What happens next** and **Share**. Changes stay in your browser until you select **Save draft**, and visitors see nothing new until you select **Publish**.

## Build

1. Add fields from the left. **New fields** lists the field types: short text, long text, email, phone number, number, amount, date, dropdown, single choice, multiple choice, checkbox and rating. **Text and layout** adds a heading, a paragraph or a divider.
2. Select a block to change its settings on the right: label, help text, placeholder, required, width (full or half) and its rules. A choice field has an options list you can reorder.
3. Move a block with its up and down buttons, duplicate it, or remove it. On a phone, **Add a field** opens the same list in a dialog.
4. Set the form title and the introduction above the list. The introduction accepts plain text and the simple tags b, i, u, br, ul, ol, li and a.

### Where an answer goes

Each field either stays with the submission only (**Create new field**) or fills a CRM property (**Map to CRM property**). The property list shows built-in contact and company properties and your custom ones. A property your workspace marks as required must be in the form and must be required, and the form cannot be published without it. A property can be used by one field only.

A form needs a way to reach the person: link an email or a phone field to the contact. Without it the form cannot be published.

### Hidden fields

A **hidden field** is saved with every submission without the visitor seeing it. Its value is a tracking parameter (UTM source, medium, campaign, term or content), the referring page, the page address, or a fixed value you type.

## Design

Pick one of eight themes, then change colours, corner shape, spacing, font, font size, label position, button style and width, shadow, the maximum width, light or dark mode and the layout (classic, full width, split with a cover image, or minimal). Logo, cover and background are https addresses. A live preview beside the controls shows the form on desktop or a phone width, and a warning appears when text or the button falls under a contrast ratio of 4.5 to 1. Forms are styled with these settings only: there is no custom code.

## What happens next

Set the submit button text, the thank-you message or a redirect address (https only), an optional consent box, the company match rule, tags and lifecycle stage added to every contact, who owns the contact (nobody, one person or in turn), who is notified, and the protection settings: the hidden spam trap, CAPTCHA, how long answers are kept, and rate limits.

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
