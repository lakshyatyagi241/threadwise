---
id: rest-api-keys
title: REST API keys
summary: Create the key your own apps use to call the REST API, copy it once, and revoke it when it is no longer needed.
area: settings
order: 100
documents: [tile:rest-api]
keywords: [api key, developers, token, bearer, rest, curl, revoke, integration]
---

## What it is for

A REST API key lets your own software, such as a website, a CRM or an automation, call the product's REST API: send messages, manage contacts, templates, broadcasts and more. Open **Settings**, then **REST API**, to manage it.

## Create a key

1. Under **Create your key**, type a **Key name** that tells you where the key will be used, for example `Production backend`. It must be 1 to 120 characters.
2. Select **Create key**.
3. A green **Your new API key** box shows the full key. Select **Copy** and store it somewhere safe, such as your password manager.

> The key is shown only once. Only a fingerprint is kept, so if you lose it nobody can read it back. Reloading or leaving the page removes it from the screen. Revoke the key and create a new one if you lose it.

## Use the key

Send the key in the `Authorization` header of every request: `Authorization: Bearer <key>`. The **Base URL** card on the left shows the address to call, with a copy button. The **Quickstart** card at the bottom shows a ready request that sends a text message; replace `YOUR_API_KEY` and the recipient number. Right after you create a key, the example already holds your new key.

## Revoke a key

1. On the **Your API key** card, select **Revoke**.
2. Confirm in the **Revoke this key?** window.

Anything that uses the key stops working immediately and this cannot be undone. Afterwards the **Create your key** card comes back and you can create a new key. The card also shows when the key was created and when it was last used (`never` until the first call).

## Limits and access

- Your plan decides how many keys are active at once. On the standard plans it is one per workspace; revoke the current key before creating another.
- You need the API keys permission to see this page. Creating and revoking each have their own permission: without them the button is disabled and says why.
- The REST API is a plan feature. If your plan does not include it, creating a key shows an upgrade pointer.

## If something looks wrong

- **You already have an active API key**: revoke it first, then create the new one.
- **You cannot copy**: your browser may block clipboard access. Select the key text and copy it by hand.
- **An app got a 401 error**: the key was revoked or mistyped. Create a new key and update the app.
