---
id: two-step-sign-in-locked-out
title: Locked out by two-step sign-in
summary: What to do when a code is refused, your phone or recovery codes are lost, or a teammate cannot sign in because of two-step verification.
area: troubleshooting
order: 50
documents: [tile:account-security]
keywords:
  [
    two-factor,
    2fa,
    mfa,
    authenticator,
    recovery codes,
    locked out,
    lost phone,
    too many incorrect codes,
  ]
---

## What it is for

With two-step sign-in on, you enter your password and then a six-digit code from your authenticator app. This guide covers a code that is refused, a lost phone, lost recovery codes and what a workspace admin can do for a teammate. To set two-step sign-in up, see [Password and two-step sign-in](help:account-sign-in-security).

## If your code is refused

1. **Wait for the next code.** The app shows a new code every 30 seconds, and a code works once. Typing the same code twice, or a code you already used, is refused.
2. **Check your phone's clock.** Set it to update automatically. A clock that is more than about half a minute off makes every code fail.
3. **Mind the time limit.** After your password is accepted, the code screen shows **Verification expires in**, counting down from 5 minutes. If it runs out you see "Your verification took too long. Sign in again." Select **Back to sign in** and start again.
4. **Mind the attempts.** Each code screen allows 5 tries and then expires, so you sign in again. Your account also allows only 5 wrong codes in 15 minutes. After that you see "Too many incorrect codes. Try again in N minutes." Wait for the time shown. A correct code clears the count.
5. **Check your password attempts too.** Repeated wrong passwords lock sign-in in the same way, 5 failures in 15 minutes by default. The message says "Too many failed attempts. Try again in N minutes." Your platform can change these numbers.

## If you lost your phone but have recovery codes

1. On the code screen, select **Use a recovery code instead**.
2. Type one of the ten codes you saved. Capital letters, small letters and the dash do not matter.
3. Each code works once and is then gone.
4. Once you are in, open [Password and two-step sign-in](help:account-sign-in-security). The page shows how many recovery codes are left. Use **Replace recovery codes** for ten fresh ones. To move to a new phone, select **Turn off** and set two-step sign-in up again with the new phone.

## If you lost your phone and your codes

Resetting your password does not turn two-step sign-in off. What helps depends on whether you are still signed in somewhere.

- **You are still signed in on another device or browser.** Open **Settings**, then **Data and security**, then **Password and two-step sign-in**. Select **Turn off** and enter your password. No code is needed. Then turn it on again with your new phone and keep the new recovery codes. If your workspace requires two-step sign-in, you will be asked to set it up again straight away.
- **You are not signed in anywhere.** There is no self-service reset. Ask a workspace admin to follow the steps below, or contact the people who run your platform.

## If you are an admin helping a teammate

An Owner or Admin who can invite members can give a teammate a clean start:

1. Open [Team members](help:team-members) under **Settings**, then **Team and permissions**.
2. Find the person and select **Remove from workspace**. They are signed out at once, and their account is kept.
3. Select **Invite teammate** and invite the same email address again with a role.
4. They open the new invite link, which works for 7 days, and choose a new password. The returning account starts without two-step sign-in, so they can sign in and turn it on again with their new phone.

Things to know:

- The invite counts against your plan's seat limit, like any invite. Removing someone frees their seat first.
- An Owner cannot be removed, and you cannot remove yourself. If an Owner is locked out, contact the people who run your platform.
- There is no button that turns off someone else's two-step sign-in directly.

## If something looks wrong

- **You turned on two-step sign-in and never saw recovery codes.** They are shown once, right after the first code is accepted. If you did not save them, sign in while you still have the app and use **Replace recovery codes**.
- **Only a few recovery codes are left.** The security page warns you. Replace them before they run out.
- **The code screen keeps returning to the password page.** Your 5 minutes ran out. Sign in again and enter the code quickly.

> Keep your recovery codes somewhere other than the phone that holds the authenticator app.
