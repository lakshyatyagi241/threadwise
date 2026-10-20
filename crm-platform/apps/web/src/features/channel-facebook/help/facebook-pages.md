---
id: facebook-pages
title: Facebook Pages
summary: Connect your Facebook account or a single Page, so its Messenger messages and comments reach your team inbox.
area: settings
order: 20
documents: [tile:facebook, nav:facebook]
keywords: [facebook, messenger, page, connect, login, access token, webhook, comments, meta]
---

## What it is for

Facebook Pages connects the Facebook Pages you manage to this workspace. Once connected, Messenger messages and comments arrive in your team inbox, and you can publish posts, run broadcasts and set up Messenger from the Facebook screens.

## How to use it

1. Open **Settings**, then **Facebook Messenger** under **Channels**. The screen also lists your connected Pages.
2. Select **Connect a Page**. Then choose **Continue with Facebook** to log in once. Every Page your account manages is added automatically.
3. To add a single Page instead, open **Add a Page manually with an access token**, paste the Page access token and select **Connect Page**.
4. Once connected, each Page shows whether it is live. Use its buttons for the rest.
5. If Meta asks for a webhook address, copy the **Webhook address** shown at the bottom into your Meta app's webhook settings.

## Options and settings

- **Reconnect** appears when Meta stopped accepting a Page's connection. It starts the login again.
- **Refresh profile** reloads the Page's name, picture and follower count.
- **Fix inbound** registers the message and comment subscriptions for that Page again.
- **Disconnect** removes the Page after you confirm. Its inbox conversations stay, but sending stops until you reconnect it.

## Plan and access

You need the view permission for Facebook Pages to see this screen, and the manage permission to connect, refresh, fix or disconnect. The Facebook integration must be set up by your administrator with a Meta app before a Page can be connected.

## If something looks wrong

- **"Facebook is not configured on this install yet."** An administrator has to add the Meta app first.
- **"Could not connect. Try again."** Start the login again. If it keeps failing, check that you are an admin of the Page on Facebook.
- **A Page token was refused.** Create a fresh Page access token and paste it again.
- **Messages do not arrive.** Use **Fix inbound** on the Page, then send a test message.
- **Data access ends on a date.** Meta limits how long a Page's data can be used. Reconnect the Page before that date.
