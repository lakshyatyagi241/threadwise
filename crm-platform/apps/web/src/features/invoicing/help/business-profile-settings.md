---
id: business-profile-settings
title: Business profile
summary: Set who you invoice as: business details, logo, bank details, document numbering, defaults and the online payment connection.
area: settings
order: 10
documents: [tile:business-profile]
keywords: [company, seller, address, tax id, gst, vat, logo, bank details, numbering, prefix, online payments, invoice settings]
---

## What it is for

The business profile holds what is printed on your invoices, credit notes and proposals: who you are, how documents look, where customers should pay, how they are numbered and what new invoices start with. It also holds the connection that lets customers pay online.

## How to use it

1. Open **Settings**, find **Business and billing** and select **Business profile**.
2. Use the chips at the top (**Business**, **Branding**, **Payment details**, **Numbering**, **Defaults**, **Online payments**) to jump to a section.
3. Start with **Business** and choose your **Country** first. It decides the tax ID format, the numbering rules and which tax rates are offered. If your country has usual settings, a prompt offers to apply a default tax regime and fiscal year start: select **Apply** or **Not now**.
4. Fill in the other sections, then select **Save changes** in the bar at the bottom. **Discard** drops your edits. Leaving the page with unsaved changes asks you first.

## Options and settings

- **Business:** seller name, registration number, address, country, tax ID, phone and support email. The tax ID is checked for format as you type, which does not prove it is registered.
- **Branding:** the logo (paste the https address of a hosted image), a brand colour, the invoice heading and a footer note.
- **Payment details:** label and value rows such as an IBAN, plus payment instructions shown on invoices.
- **Numbering:** a prefix for each document type, the number format (it must contain `{SEQ}`), digits in the counter, and whether the counter restarts every year. **Your next numbers** previews the result.
- **Defaults:** default payment terms in days (empty means due on issue), default terms and conditions and the default tax regime.
- **Online payments:** turn on **Accept online payments**, choose test or live mode and enter a webhook signing secret (at least 16 characters, shown only once). Without a connection the customer's page shows your bank details instead.

## Plan and access

Changing the profile needs the invoice settings permission, and the tile only appears for roles that have it. Nothing here depends on a plan feature.

## If something looks wrong

- **Save is refused:** fix the highlighted fields first, for example a number format without the counter token, a prefix longer than 10 characters or a colour that is not a hex code.
- **"Someone else changed the business profile":** select **Reload latest** to see their version (your edits are replaced), or **Keep editing**.
- **Online payments will not turn on:** add a webhook signing secret first.
- **A logo does not show:** the address must be a public https link to an image.
