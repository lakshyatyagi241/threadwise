---
id: account-sign-in-security
title: Password and two-step sign-in
summary: Change your password, turn on two-factor sign-in with an authenticator app, keep recovery codes, and sign out other devices.
area: account
order: 40
documents: [tile:account-security]
keywords:
  [
    password,
    two-factor,
    2fa,
    mfa,
    authenticator,
    recovery codes,
    passkey,
    sessions,
    devices,
    sign out,
    security,
  ]
---

## What it is for

This page protects how you sign in. It has four parts: **Change password**, **Two-factor authentication**, **Passkeys** and **Where you are signed in**. Open it from **Settings**, then **Data and security**, or from the **Security** group on the Account page.

## How to use it

### Change your password

1. Type your **Current password**, then the **New password** twice (the second box is **Confirm new password**).
2. Follow the hint under the new password. It shows the minimum length and any rules your workspace sets, such as mixed case, a number or a symbol. If a rule is broken, the broken rules are listed.
3. Select **Update password**. Every other device is signed out, and the page says how many.

### Turn on two-factor sign-in

1. While it is off, the setup is already on the page. Open an authenticator app on your phone and scan the QR code, or type the setup key by hand.
2. Enter the six-digit code the app shows and select **Turn on**.
3. Ten recovery codes appear once. Use **Copy codes** or **Download**, tick **I have saved these codes in a safe place**, then select **I saved them**. Each code works once if you lose your phone.

Once it is on, the page shows the date it started and how many recovery codes are left, and it warns you when only a few remain. **Replace recovery codes** makes ten new codes and cancels the old ones. **Turn off** removes the second step and every passkey you added. Both ask for your password.

### Add a passkey

With two-factor on, the **Passkeys** card under it lets you confirm sign-in with your fingerprint, face, screen lock or a security key instead of typing a code. See [Passkeys](help:account-passkeys) for adding, reviewing and removing them.

### Review your devices

**Where you are signed in** lists each session with its device, address and last activity, and marks **This device**. Select **Revoke** on a row to sign that device out, or **Sign out of all others**. Ten sessions show per page, with **Prev** and **Next**.

## Plan and access

Every signed-in member can use this page for their own account. No plan feature is needed. If an administrator requires a new password or two-factor sign-in for your account, you are sent here and the other account pages stay greyed out until you finish.

## If something looks wrong

- **The new password is refused.** The page lists which workspace rules it breaks. A new password also cannot be the same as the current one.
- **You do not remember your current password.** When a new password is required, the page offers **Email me a reset link**, which sends a link to your account email.
- **The code is rejected.** Wait for the next code from the app and try again. If the setup has expired, select **Start again**.
