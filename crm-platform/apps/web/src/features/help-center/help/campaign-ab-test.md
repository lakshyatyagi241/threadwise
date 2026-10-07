---
id: campaign-ab-test
title: A/B test a campaign
summary: Send two versions of a campaign message to a split of your audience and compare sent, delivered, read, reply and click counts side by side.
area: campaigns
order: 62
documents: [nav:campaigns]
keywords: [a/b test, split test, variant, version b, compare, template variants, campaign]
---

## What it is for

An A/B test lets one campaign send two versions of the message, so you can see which one gets more reads, replies or clicks. You choose the share of people who get each version, and the campaign page shows the results per version. For the rest of the builder, see [Campaigns](help:campaigns-overview).

## Set it up

1. Open **Campaigns** and select **New campaign**. Fill in **Campaign setup** and choose a message type under **Message**: **Text**, **Rich message**, **Template** or **Flow**.
2. Write or pick version A first. This is the message, template or flow you would send anyway.
3. Tick **A/B test this campaign**. A slider appears with the split, for example "50% get version A, 50% get version B". It moves in steps of 5.
4. Fill in version B. What you see depends on the message type, see below.
5. Choose the audience and when to send, then launch or schedule the campaign as usual.

What version B asks for:

- **Text** or **Rich message**: **Message for version B**. Left empty, version B sends the same message as A.
- **Template**: **Template for version B**. Left on "same template as A", both versions use one template. If you pick another template, fill in its variable values for version B separately.
- **Flow**: **Flow for version B**. Left on "same flow as A", both versions start the same flow.

> The split is made when the campaign is saved. Recipients are shuffled at random and the first share, rounded to a whole number of people, gets version A and everyone else gets version B. Both versions go out together. The campaign does not pick a winner or send a follow-up by itself.

## Read the results

1. Open the campaign and stay on the **Overview** tab.
2. Find **A/B results**. It appears when the campaign has two versions, with one row per version: **Recipients**, **Sent**, **Delivered**, **Read**, **Replies** and **Clicks**.
3. Open the **Messages** tab to see which version each recipient got in the **Version** column.

A 70/30 split gives one version more people, so compare rates rather than raw counts.

## Good habits

- Change one thing at a time, such as the first line or the template, so you know what made the difference.
- Use a split of 50/50 unless you have a reason not to.
- Wait until sending has finished before you judge. Read and reply counts keep rising for a while after delivery.
- Use the winner for the next campaign. See [Why a campaign shows few reads](help:campaign-read-rate) for what else to check.

## Limits and access

- You can edit the A/B settings while the campaign is a draft, scheduled or paused. See [Stop, resume or resend a campaign](help:campaign-stop-resume).
- A campaign has two versions at most.
- Creating and editing campaigns each need their own right, and your plan limits how many campaigns you can create.

## If something looks wrong

- **A/B results is missing.** The table only appears for a campaign that was saved with the test switched on.
- **Version B is the same as version A.** Version B was left empty, or "same template" or "same flow" was chosen, so both versions are identical.
- **A template is not in the version B list.** Some sending engines accept only templates that WhatsApp has approved. See [Message templates](help:message-templates-overview).
