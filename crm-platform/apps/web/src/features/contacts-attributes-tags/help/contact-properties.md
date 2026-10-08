---
id: contact-properties
title: Contact properties
summary: Design your contact record: add your own properties in sections, choose their type, make them required or conditional, and reorder or deactivate them.
area: settings
order: 22
documents: [tile:contact-properties]
keywords: [custom fields, fields, dropdown, required, sections, form, columns, conditional]
---

## What it is for

Contact properties are everything a contact can store. Some are built in, such as name, mobile number, email, lifecycle stage, status and groups. You add your own, such as a renewal date or a dropdown for source city, and group them into sections. They appear on the contact form and on the contact page.

## How to use it

1. Open **Settings**, then **Data and customization**, then **Contact properties**, or go to `/contact-properties`.
2. Select **New section** and name it, for example Education. Properties live inside sections, so create one first.
3. Select **New property**, or **Add property** inside a section.
4. Enter a **Name** and a **Key**, choose a **Type** and a **Section**, and add optional help text. For a dropdown or multi-select, type each option and press Enter.
5. Set the switches: **Required** (the contact form will not save without a value), **Visible** (show it on the form and the contact page), **Read only** (filled by imports and the API) and **Active**.
6. To show a property only in some cases, add a **Show only when** condition on another property.
7. Select **Create property**.

## Options and settings

- Types are Text, Long text, Number, Decimal number, Date, Dropdown, Multi-select, Checkbox, Link, Email and Phone. The key and the type cannot change after creation.
- The table shows name, key, type, whether it is required and visible, and **In use**: how many contacts hold a value.
- Reorder properties with the arrows or by dragging. Sections have arrows, rename and delete. Deleting a section keeps its properties and moves them to **No section**.
- The bin on a property deactivates it. It leaves the form and the contact page, its values are kept, and **Reactivate** brings it back. Tick **Show inactive** to see deactivated properties.
- Your properties are the same records as [Attributes](help:contact-attributes), so each key also works as a message variable.

## Plan and access

Opening the screen needs permission to read contact properties. Adding needs the create permission, editing, reordering and reactivating need update, and deactivating a property or deleting a section needs delete. Controls you cannot use are hidden. This screen has no plan requirement of its own.

## If something looks wrong

- **Create a section first.** A property cannot be added until a section exists.
- **A property is missing on the contact form.** It may be inactive, not visible, or waiting on a **Show only when** condition.
- **The key is taken or reserved.** Use another: lowercase letters, digits and underscores, starting with a letter.
- **Someone else changed this.** The list was refreshed. Try again.
- **Some of your changes may have been saved.** Close the window and open the property again to check.
