---
id: wa-links
title: WhatsApp Links
summary: Mint a trackable short link that opens WhatsApp with a pre-filled message, for ads, bios and QR codes.
area: automation
order: 16
documents: [nav:wa-links]
gates:
  planFeature: forms_and_links
  permission: wfl.links.read
keywords: [link, click to chat, wa.me, short link, qr code, utm, bio link]
---

## What it is for

A WhatsApp Link is a short URL (yours to share in an ad, a bio, a QR code) that opens WhatsApp with your number and
an optional pre-filled message already typed in. The visitor still has to tap **Send** — nothing goes out
automatically — which makes links a safer way to start conversations than a cold bulk send. Every open and scan is
counted, so you can see which placement is working.

**WhatsApp Links** works no matter how your number is connected — Unofficial API, Cloud API or Twilio.

## How to use it

1. Open **WhatsApp Links** in the menu and select **New link**.
2. **Destination**: give the link a name (for your own reference only — the visitor never sees it), choose whether
   it starts **Live** or **Paused**, and enter the WhatsApp number it should open.
3. **Starter message**: the text already typed into the chat when someone taps the link. Leave it blank for a plain
   open with no pre-filled text.
4. **Tracking**: optionally set a custom short link (letters, numbers and hyphens; leave blank for a random one), an
   expiry date, and UTM source/medium/campaign for your own reporting. UTM values are saved with the link but are
   never added to the WhatsApp link itself — WhatsApp would ignore them.
5. Select **Mint link**. You get the short link, the full `wa.me` link, and a downloadable QR code.

## Managing links

- The **All / Live / Paused** tabs and the search box filter the list.
- **Copy** copies the short link; **Open** tests it in a new tab.
- **Duplicate** makes a new link with a fresh short link, starting from the same destination and message.
- **Delete** stops the short link working immediately — anyone who taps an old copy of it gets a "no longer
  active" page.

## Troubleshooting

- **The link says it doesn't exist** — it was deleted, or the short link was mistyped.
- **The link says it's no longer active** — it's paused, or past its expiry date.
- **The phone number is rejected when saving** — WhatsApp link numbers need 7 to 15 digits including the country
  code; check for a typo.
- **A custom short link is taken** — short links are shared across every workspace on this platform, so a common
  word may already be in use; a numeric suffix is added automatically if you leave the field blank.
