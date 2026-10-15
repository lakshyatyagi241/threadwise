---
id: template-variables-buttons
title: Template variables and buttons
summary: How the header, body, footer, variables and buttons of a template work, with the limits the form enforces for each.
area: campaigns
order: 54
documents: [nav:templates]
keywords:
  [
    variables,
    placeholders,
    header,
    footer,
    buttons,
    quick reply,
    call to action,
    sample value,
    components,
  ]
---

## What it is for

A template is built from parts: an optional header, a body, an optional footer and optional buttons. This guide explains each part, how variables fill the gaps, and the limits the template form applies. To start a template, see [Message templates](help:message-templates-overview). For the checks that run before you submit, see [Template rules and pre-submit checks](help:template-rules-checks).

## The parts of a template

- **Header.** Choose **None**, **Text**, **Image**, **Video**, **Document** or **Location**. A text header is up to 60 characters with one variable at most. For media you pick a **Sample file** for Meta's review (image up to 5 MB, video up to 16 MB, PDF up to 100 MB). With a location header nothing is attached here, because the location is filled in when the message is sent.
- **Body.** The message itself, up to 1024 characters. The buttons above the box add bold, italic, strikethrough and code, and **Add variable** inserts a placeholder.
- **Footer.** A short line under the body, up to 60 characters, with no variables.
- **Buttons.** Up to 10 in total, described below.

## Variables

1. Type a placeholder such as `{{name}}` in the header or body, or select **Add variable** above the body.
2. Open **Variable mapping**. Each distinct variable gets a row. Under **Contact attribute**, name the contact field that fills it when you send. Under **Sample value**, type an example for Meta's review.
3. Save. Names are turned into numbers (`{{1}}`, `{{2}}`) in the order they first appear, and the mapping follows the numbers. The phone preview uses your sample values.

Remove a variable from the text and its row goes away. A variable typed twice is one row.

## Buttons

Select one of the four kinds above the button list. Each button has its own limit:

- **Quick reply.** A tap-to-answer button. Up to 10. Its text cannot contain a variable. Quick replies must sit together, at the start or at the end of the list.
- **Visit website.** Up to 2. Needs a **Website URL** that begins with `http://` or `https://`. You can end the address with `{{1}}` for a part that changes per message, and then you must give a **Sample for the variable**. One variable per URL.
- **Call phone.** Up to 1. Needs the phone number with its country code.
- **Copy code.** Up to 1. Needs a **Sample code**, for example `PROMO50`.

Every button except Copy code needs button text, at most 25 characters. Use the move up and move down controls on a button to reorder the list. A kind that has reached its limit is greyed out, and the form shows how many buttons you have used.

> A stored button of a kind this editor does not offer is kept as it is: the form says so, and you can move or remove it but not change it.

## If something looks wrong

- **A button error appears under the list.** The row names what is missing, such as button text, a URL, a phone number or a sample value. Quick replies that are split up show "Quick replies must be together".
- **A variable row is missing.** Rows come from placeholders typed in the header or the body. The footer and the text of a quick reply cannot hold variables.
- **The preview shows the placeholder instead of text.** Type a sample value in **Variable mapping** and the preview will use it.
- **An approved template needs different buttons.** Approved templates cannot be edited. See [Change an approved template](help:template-change-approved).
