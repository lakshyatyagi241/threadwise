---
id: rest-api-keys
title: REST API keys
summary: Create the key your own apps use to call the REST API, choose what it may do, copy it once, and revoke it when it is no longer needed.
area: settings
order: 100
documents: [tile:rest-api, tile:api-keys]
keywords:
  [
    api key,
    developers,
    token,
    bearer,
    rest,
    curl,
    revoke,
    integration,
    scopes,
    permissions,
    access,
  ]
---

## What it is for

A REST API key lets your own software, such as a website, a CRM or an automation, call the product's REST API: send messages, manage contacts, templates, broadcasts and more. Open **Settings**, then **Data and security**, and select **API keys**, or open **Marketplace**, select the **Developer** tab and open **REST API**, to manage it.

## Create a key

1. Under **Create your key**, type a **Key name** that tells you where the key will be used, for example `Production backend`. It must be 1 to 120 characters.
2. Tick the scopes the key may use under **Allowed scopes** (see **Scopes** below). A key needs at least one scope.
3. Select **Create key**.
4. A green **Your new API key** box shows the full key. Select **Copy** and store it somewhere safe, such as your password manager.

> The key is shown only once. Only a fingerprint is kept, so if you lose it nobody can read it back. Reloading or leaving the page removes it from the screen. Revoke the key and create a new one if you lose it.

## Scopes

- A key can only do what its scopes allow. A scope is a resource and an action, written `contacts:read` or `contacts:write`. For example `contacts:read` lets the key list and read contacts, while `contacts:write` also lets it create, change and delete them. Ticking a write scope includes its read scope, so the read box is shown ticked and cannot be cleared while the write box is ticked.
- Every key needs at least one scope. Create key is refused otherwise, because a key with no scopes could do nothing.
- The **Your API key** card lists the scope names of the key. A call outside those scopes is refused with an error that names the scope it needed.
- A key can never do more than the person who created it. Keys made before scopes were required kept every scope, now written out in the list on their card.

> A key's scopes are fixed when it is created. To change them, revoke the key and create a new one.

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
- **An app is refused as not signed in**: the key was revoked or mistyped. Create a new key and update the app.
- **An app is refused with an error that names a scope**: the key does not hold that scope. Revoke it and create a new key with the scope ticked.
- **Tick at least one scope**: you ticked nothing. Tick the scopes the key needs.
