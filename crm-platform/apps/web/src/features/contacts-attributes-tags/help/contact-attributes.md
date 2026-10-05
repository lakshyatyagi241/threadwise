---
id: contact-attributes
title: Attributes
summary: Message variables you can insert with a slash: create your own, give each a key and a fallback value, and switch them on or off.
area: settings
order: 24
documents: [tile:attributes]
keywords: [variables, merge fields, placeholders, tokens, slash, personalization, template attributes]
---

## What it is for

Attributes are variables you drop into a message body. Each one is replaced by the contact's value when the message is sent, for example a name, an order ID or a coupon code. This screen is titled **Template attributes**. It lists the attributes you created; the built-in ones, such as First name, Phone number and Today's date, are always available in the picker.

## How to use it

1. Open **Settings**, then **Data and customization**, then **Attributes**, or go to `/attributes`.
2. Select **New attribute**.
3. Enter a **Display name**. The **Key** is suggested from it; you can change the suggestion before saving. Keys use lowercase letters, digits and underscores, start with a letter and must be unique.
4. Optionally add a **Default value** (used when a contact has no value) and a **Description**.
5. Leave **Active** on to show the attribute in the picker, then select **Save attribute**.
6. In a message body that supports it, type `/` to open the picker. Arrow keys move, Enter inserts, Esc closes. The attribute is inserted as its key in double braces, such as `{{order_id}}`. The **Try it** box on this screen lets you practise.

## Options and settings

- The left panel filters the list by **All**, **Active** or **Inactive** and shows counts. The search box looks in name, key and description.
- Each row shows the name, key, default, description and status. Use the pencil to edit and the bin to delete.
- When you edit an attribute, the key is locked because templates and flows already use it. The name, default, description and active switch can change at any time.
- Deleting an attribute that contacts hold values for asks a second time and offers **Delete anyway**. The stored values are kept, but messages that use the attribute then render blank.
- Every attribute is also a contact property, so each contact's value is filled in on the contact form. See [Contact properties](help:contact-properties) for other types, sections and rules.

## Plan and access

Opening the screen needs permission to read contact properties. **New attribute**, the pencil and the bin need the create, update and delete permissions for contact properties, and are hidden without them. This screen has no plan requirement of its own.

## If something looks wrong

- **That key is already used, or is reserved for a built-in token.** Choose another key.
- **A message shows a blank where a value should be.** The contact has no value and the attribute has no default. Set a default.
- **The attribute does not appear in the picker.** It is probably inactive.
- **Built-in attributes cannot be changed or deleted.**
- **Someone else changed this attribute.** Close the window and open it again.
