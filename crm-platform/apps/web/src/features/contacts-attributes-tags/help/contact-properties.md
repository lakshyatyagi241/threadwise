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

Contact properties are everything a contact can store. Some are built in, such as name, mobile number, email, owner, lifecycle stage, status and groups. You add your own, such as a renewal date or a dropdown for source city, and group them into sections. They appear on the contact form and on the contact page.

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

## Dependent fields

A **dependent field** is a dropdown whose choices depend on another dropdown: for example City under Region. Select **Dependent fields** above the list to manage them.

1. Select **Add dependent field**.
2. Choose the **Parent property** (a dropdown, multi-select or radio property with its choices in the list) and the **Dependent property** (another one).
3. For each choice of the parent, tick the choices of the dependent property it allows. A choice that is not ticked under a parent choice is never offered there.
4. Select **Save**.

The list shows "Choices depend on" the parent under the dependent property. A dependent field always shows on the contact form. It offers only the choices its parent allows, and until the parent has a choice it offers none; the hint under it names the parent to choose first. When the parent changes, a dependent choice that the new parent does not allow is cleared.

To change the parent or the allowed choices, select the pencil on that row. The bin removes the dependency: the property then offers all its choices again. The values contacts already hold are kept.

A dependent field can also have a **Show only when** condition; both apply together.

## Plan and access

Opening the screen needs permission to read contact properties. Adding needs the create permission, editing, reordering and reactivating need update, and deactivating a property or deleting a section needs delete. Controls you cannot use are hidden. This screen has no plan requirement of its own.

## If something looks wrong

- **Create a section first.** A property cannot be added until a section exists.
- **A property is missing on the contact form.** It may be inactive, not visible, or waiting on a **Show only when** condition.
- **The key is taken or reserved.** Use another: lowercase letters, digits and underscores, starting with a letter.
- **A dependent field offers no choices.** Choose its parent first. A parent choice with no ticked choices offers none.
- **A dependency would make two properties wait for each other.** The dialog refuses it. Remove one of the two dependencies first.
- **A property is missing from the dependent fields dialog.** Only dropdown, multi-select and radio properties whose choices are all in the list can take part. A property with a very long list is not offered.
- **Bulk update and imports do not narrow dependent choices.** Choose the value in the contact form for a contact's dependent field.
- **Someone else changed this.** The list was refreshed. Try again.
- **Some of your changes may have been saved.** Close the window and open the property again to check.
