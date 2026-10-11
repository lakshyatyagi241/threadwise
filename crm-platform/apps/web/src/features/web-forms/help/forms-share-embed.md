---
id: forms-share-embed
title: Sharing and embedding a form
summary: Share a form by link or QR code, or put it on your website with a script or an iframe.
area: campaigns
order: 17
documents: []
gates:
  planFeature: form_builder
keywords:
  [share, embed, iframe, script, qr code, allowed websites, domains, rotate key, public link]
---

## What it is for

The **Share** tab gives a published form its public address and the code to put it on your own website. Nothing works until the form is published; a draft shows a reminder.

## How to use it

1. Publish the form. See [Building a form](help:forms-builder).
2. Open the **Share** tab. Under **Public link**, copy the form address or open it in a new tab.
3. To print or show the form, download the **QR code** as a PNG or SVG. Scans carry a tracking tag so you can tell them apart in the submission details.
4. To put the form on your site, copy one of the two snippets under **Put the form on your website**: the script, which also sizes itself to the form, or the plain iframe.
5. Under **Allowed websites**, add the website where you embed the form, for example https://example.com. A wildcard works for one level of subdomain, for example https://*.example.com.

## Show the form as a popup

Instead of placing the form in the page, you can open it in a popup. Under **Show as a popup**, choose when it opens, then copy the **Popup code** and paste it into your website, usually just before the closing body tag.

- **After a delay**: opens a set number of seconds after the page loads.
- **When the visitor scrolls down**: opens once they have scrolled the percentage of the page you set.
- **When the visitor scrolls back up**: opens when they have read down the page and then scroll back up, a sign they may be leaving.
- **When someone clicks a button**: opens only from a button or link that carries the **button code** (`data-forms-open`), or from your own script with `FormsPopup["<key>"].open()`. The button code works with every trigger.

**Where it appears** is the centre of the screen with the page dimmed, or a corner card that leaves the page undimmed. On a phone it always rises from the bottom as a full-width sheet. **Show again after** sets how many days pass before the same visitor sees it again; 0 shows it every visit. Once someone sends the form, it never opens for them again. Visitors can close it with the close button, the Escape key, or by clicking outside it.

The options are written into the code you copy, so after changing them copy the code again. The website still needs to be on the **Allowed websites** list below. To see how the popup looks before you publish it, open **Design** or **Preview** and choose **Popup**.

## Allowed websites

The list controls which websites may show your form inside their pages. An empty list means the form can be opened on its own link only and cannot be embedded. A bare asterisk and addresses with a path are refused, and plain http is accepted for localhost only. The hosted page itself can never be shown inside another site.

## Rotate the public key

**Rotate the public key** gives the form a new address. The old link, the old embed code and the old script stop working at once, so only rotate when a link must be withdrawn. Copy the new snippets afterwards.

## If something looks wrong

- **The embedded form is blank or refused.** The website is not on the allowed list, or the list was saved but the form has not been saved yet. Save the draft after changing the list.
- **The link says the form is not available.** The form is not published, is paused, is archived, or the key was rotated.
- **The copy button does nothing.** Your browser blocked the clipboard. Select the text and copy it by hand.
