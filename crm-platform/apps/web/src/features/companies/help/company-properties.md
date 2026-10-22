---
id: company-properties
title: Company properties
summary: Design your company record: add your own properties in sections, choose their type, make them required or conditional, and reorder or deactivate them.
area: settings
order: 23
documents: [tile:company-properties]
gates:
  planFeature: sales_pipeline
keywords: [custom fields, fields, dropdown, required, sections, form, organization, account, conditional]
---

## What it is for

Company properties are the extra fields you keep on every company, such as a VAT number, a renewal date or a dropdown for account tier. You group them into sections. They appear on the company form, where you fill them in, and on the company page, under **Properties**. A company's name, website, email, phone, industry, size, address, notes and owner are always there and are not listed here.

## How to use it

1. Open **Settings**, then **Data and customization**, then **Company properties**, or go to `/company-properties`.
2. Select **New section** and name it, for example Billing. Properties live inside sections, so create one first.
3. Select **New property**, or **Add property** inside a section.
4. Enter a **Name** and a **Key**, choose a **Type** and a **Section**, and add optional help text. For a dropdown or multi-select, type each option and press Enter.
5. Set the switches: **Required** (the company form will not save without a value), **Visible** (show it on the form and the company page), **Read only** (filled by the API and by forms, not by hand) and **Active**.
6. To show a property only in some cases, add a **Show only when** condition on another property.
7. Select **Create property**.

## Options and settings

- Types are Text, Long text, Number, Decimal number, Date, Dropdown, Multi-select, Checkbox, Link, Email and Phone. The key and the type cannot change after creation.
- The table shows name, key, type, whether it is required and visible, and **In use**: how many companies hold a value.
- Reorder properties with the arrows or by dragging. Sections have arrows, rename and delete. Deleting a section keeps its properties and moves them to **No section**.
- The bin on a property deactivates it. It leaves the form and the company page, its values are kept, and **Reactivate** brings it back. Tick **Show inactive** to see deactivated properties.
- A required property that is only shown under a **Show only when** condition is required only when that condition holds.
- Properties of companies are separate from [Contact properties](help:contact-properties). A form built in the form builder can fill them.
- The activity history on a company lists which properties changed, never what they held.
- Company properties reach beyond the form. They can be columns, filters and a sort order on the [Companies](help:companies-overview) list, columns in its CSV export and import, rules on the company of a contact in a segment (the field is shown as **Company** followed by the property name), merge tags in templates and messages (`{{company.key}}`, with `key` as shown in the table, and `{{company.industry}}`, `{{company.website}}` and the other details), values in the AI brief of a company.
- A property marked **masked** is left out of list filters and orders, of the CSV export and of the AI brief.
- The **In use** count also shows how many segments use a property in a rule, and deleting a property leaves those rules in place, flagged, matching nothing until someone fixes them.

## Plan and access

The tile needs permission to edit company properties and the sales pipeline feature on your plan. Opening the screen needs permission to read company properties; adding needs the create permission, editing, reordering and reactivating need update, and deactivating a property or deleting a section needs delete. The Owner and Admin roles can do all of this; the Agent and Manager roles can read the definitions, so they see the properties on the company form and page. Controls you cannot use are hidden.

## If something looks wrong

- **Create a section first.** A property cannot be added until a section exists.
- **A property is missing on the company form.** It may be inactive, not visible, or waiting on a **Show only when** condition. Someone who cannot read company properties does not see any.
- **The form says a property is required.** Fill it in, or ask an admin to make it optional.
- **The form says a property can no longer be edited.** An admin changed it after you opened the form. Close the form and open it again.
