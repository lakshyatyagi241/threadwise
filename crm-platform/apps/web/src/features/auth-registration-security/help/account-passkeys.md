---
id: account-passkeys
title: Passkeys
summary: Confirm your sign-in with your fingerprint, face, screen lock or a security key instead of typing a code. Add, review and remove passkeys.
area: account
order: 41
documents: [tile:account-security]
keywords: [passkey, passkeys, webauthn, fingerprint, face, security key, yubikey, two-factor, 2fa, second step, sign in]
---

## What it is for

A passkey is a second step at sign-in that your device confirms for you: your fingerprint, your face, your screen lock or a physical security key. After you enter your password, you can choose **Use a passkey** instead of typing the six-digit code from your authenticator app. A passkey cannot be typed into a fake sign-in page, so it protects you from phishing better than a code does.

Passkeys sit next to your authenticator app, not in place of it. The app and its recovery codes stay on, so you can still sign in if you lose the device that holds a passkey.

## How to use it

Open **Settings**, then **Data and security**, or the **Security** group on the Account page. The **Passkeys** card is under **Two-factor authentication**.

### Add a passkey

1. Make sure **Two-factor authentication** above it is on. While it is off, the card says to turn it on first and links to it, and the add button is hidden.
2. Select **Add a passkey**.
3. Give it a name you will recognize, such as Work laptop or Phone. The name can be up to 60 characters.
4. Select **Continue**. If you signed in more than ten minutes ago, a **Current password** box appears first; enter your password and select **Continue** again.
5. Your browser opens its own prompt. Confirm with your fingerprint, face, screen lock or security key.

When it works, the card says the passkey was added and lists it. You also get an email telling you a passkey was added, so you notice if it was not you.

### Read the list

Each row shows the passkey's name, **Added** with the date, and **Last used** with how long ago, or **Never used**. A label tells a **Synced** passkey (kept by your phone, browser or password manager and available on your other devices) from one that stays on **This device only**, such as a hardware security key.

### Remove a passkey

1. Select **Remove** on its row.
2. Enter your password and select **Remove passkey**.

You get an email when a passkey is removed. Removing the last one does not turn anything else off: you still sign in with your password and your authenticator app.

### Sign in with a passkey

After your password, the **Two-step verification** step shows **Use a passkey** whenever your account has one. Select it and confirm in the browser prompt. The code field and your recovery codes keep working on the same screen. The same button appears when you switch to another workspace that asks for a second step.

## Plan and access

Every signed-in member can add passkeys for their own account; no plan feature is needed. The card only works while two-factor authentication with an authenticator app is on. An account can hold up to ten passkeys.

Turning two-factor authentication off also removes all of your passkeys, because they depend on it. Turn it on again and add them again.

## If something looks wrong

- **The card says to turn on two-factor first.** Set up the authenticator app, then come back and add the passkey.
- **The add button is greyed out and a notice mentions the browser.** This browser cannot use passkeys. Use a current version of Chrome, Edge, Safari or Firefox.
- **The browser prompt closed or timed out.** Nothing was saved. Select **Add a passkey** and try again.
- **It says this device already has a passkey for your account.** Use another device or a security key, or remove the existing passkey first.
- **It says you reached the most passkeys.** Remove one you no longer use, then add the new one.
- **Use a passkey does not appear at sign-in.** It only shows when the account has a passkey and the browser supports them. You can always use the authenticator code or a recovery code.
