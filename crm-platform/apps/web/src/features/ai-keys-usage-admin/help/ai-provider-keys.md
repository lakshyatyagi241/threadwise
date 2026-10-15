---
id: ai-provider-keys
title: AI provider keys
summary: Add your own AI provider key so your AI features run on your account, switch it on or off, replace it or remove it.
area: settings
order: 40
documents: [tile:ai-keys]
keywords:
  [ai, api key, openai, anthropic, gemini, own key, byok, provider, token, bring your own key]
---

## What it is for

AI features need a key from an AI provider. By default they use a shared key that comes with the platform, and the tokens used count against your plan's monthly allowance. Here you can add your own key for a provider, so calls use your own account instead.

## How to use it

1. Open **Settings**, then **Automation and AI**, then **AI provider keys**. You can also go to `/ai-keys`.
2. Read the message at the top. A success message says your plan lets your own keys take precedence. A warning says your plan does not include your own keys yet: you can still save them, but calls keep using the shared key until you upgrade.
3. Under **Add a key**, choose the **Provider** and paste your **API key**. A key must be at least 8 characters.
4. Select **Save key**. If you already have a key for that provider, the button reads **Replace key** and the new key takes the old one's place.
5. Your saved keys are listed below the form. Each row shows the provider, an **On** or **Off** badge, and the last four characters of the key, for example **Ends in 1234**.

## Managing a saved key

- Use the switch on a row to turn that key on or off. A key that is off is not used.
- Select **Remove** to delete a key. Calls then fall back to the shared key if one is available.
- Each row says **Calls use** your key, the shared key, or no key. Check this line to see which key is really being used.

> Keys are encrypted when saved and are never shown again, not even to you. If you lose a key, paste a new one.

## Plan and access

Seeing the screen needs the permission to view AI provider keys, and adding, switching or removing a key needs the permission to manage them. Without the manage permission, those actions are refused with a message. Whether your own key is used ahead of the shared key depends on your plan, as the message at the top of the page tells you. To see what your AI features have used, open [AI usage](help:ai-usage-overview).

## If something looks wrong

- **Calls still use the shared key.** Your plan may not include your own keys, or the key is switched off. Check the message at the top and the **Calls use** line.
- **A key is refused as too short.** Keys are at least 8 characters. Copy the whole key again.
- **Saving says you have no permission.** Ask a workspace admin for the manage permission.
