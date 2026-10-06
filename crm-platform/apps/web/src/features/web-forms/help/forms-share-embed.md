---
id: forms-share-embed
title: Sharing and embedding a form
summary: Share a form by link or QR code, or put it on your website with a script or an iframe.
area: campaigns
order: 17
documents: []
gates:
  planFeature: form_builder
keywords: [share, embed, iframe, script, qr code, allowed websites, domains, rotate key, public link]
---

## What it is for

The **Share** tab gives a published form its public address and the code to put it on your own website. Nothing works until the form is published; a draft shows a reminder.

## How to use it

1. Publish the form. See [Building a form](help:forms-builder).
2. Open the **Share** tab. Under **Public link**, copy the form address or open it in a new tab.
3. To print or show the form, download the **QR code** as a PNG or SVG. Scans carry a tracking tag so you can tell them apart in the submission details.
4. To put the form on your site, copy one of the two snippets under **Put the form on your website**: the script, which also sizes itself to the form, or the plain iframe.
5. Under **Allowed websites**, add the website where you embed the form, for example https://example.com. A wildcard works for one level of subdomain, for example https://*.example.com.

## Allowed websites

The list controls which websites may show your form inside their pages. An empty list means the form can be opened on its own link only and cannot be embedded. A bare asterisk and addresses with a path are refused, and plain http is accepted for localhost only. The hosted page itself can never be shown inside another site.

## Rotate the public key

**Rotate the public key** gives the form a new address. The old link, the old embed code and the old script stop working at once, so only rotate when a link must be withdrawn. Copy the new snippets afterwards.

## If something looks wrong

- **The embedded form is blank or refused.** The website is not on the allowed list, or the list was saved but the form has not been saved yet. Save the draft after changing the list.
- **The link says the form is not available.** The form is not published, is paused, is archived, or the key was rotated.
- **The copy button does nothing.** Your browser blocked the clipboard. Select the text and copy it by hand.
