---
id: flow-geta-publishing
title: Geta publishing
summary: Enter your Geta connection once so that Publish in the flow builder also pushes your bot live on Geta.
area: settings
order: 40
documents: [tile:geta-publishing]
keywords: [geta, publish, go live, bot, console, token, authorization, geta-host, chatbot record]
---

## What it is for

When you press **Publish** in the flow builder, the flow is published here first. If your workspace has Geta publishing set up, your bot is then also pushed live on the Geta console, in two steps: the chatbot configuration is updated, and then the bot is published. The flow shows as live only when both steps worked.

## How to use it

1. Open **Marketplace**, select the **Add-ons** tab and open **Geta publishing**.
2. Enter the **Base URL** of the Geta API, for example `https://api-core-sandbox.geta.ai`.
3. Optionally enter the **Console origin**, for example `https://app-sandbox.geta.ai`. It is sent as the origin and referer of each request. Leave it empty to send neither.
4. Enter the **Authorization token** and the **geta-host token** exactly as Geta gave them. The authorization token is sent as it is, so include `Bearer ` yourself if Geta expects it.
5. Paste the **Geta chatbot record**: the chatbot object as it should be sent to Geta, or the whole request body with a `chatbot` key. It needs at least `id` and `bot_id`.
6. Select **Save**. The page then shows each secret as Saved and the chatbot record as its id, name and bot id.

## What you see in the editor

- **Going live…** while the push runs in the background.
- **Live** when both steps worked.
- **Failed at configuration update** or **Failed at publish**, with the reason and a **Retry** button. Retry continues from the step that failed. The flow stays published here either way.
- If nothing is set up, a notice says the flow was published here and links to this page.

## Options and settings

- A saved secret is never shown again. Leave its box empty to keep it, type a new value to replace it, or select **Remove**.
- **Clear all** removes every Geta setting of the workspace. Published flows stay published here.
- The chatbot record is sent as you pasted it. Only its `modified_time` is refreshed to the current time (UTC) each time it is sent.
- A single flow can use its own chatbot record instead of the workspace one. This is set through the API.

> If the page says the server is in fixture mode, publishing is simulated and nothing reaches Geta.

## Plan and access

The tile needs the **Automation** plan feature and the right to manage Geta publishing. Publishing and retrying use the usual right to publish flows.

## If something looks wrong

- **It says Failed with a reason.** Read the reason, fix the setting it points at, then select **Retry**.
- **Nothing happens after Publish.** Check that every field on this page is filled in and shows Ready.
- **Unauthorised or forbidden.** The tokens may have expired. Paste new ones and save.
