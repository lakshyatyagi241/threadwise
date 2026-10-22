# Marketplace tabs: how to check them on the deployed site

Nothing here has been verified in a browser. The tab shapes, the grid, the filters, the sort merge, the gates and the paywall line are covered by
automated tests that render the screens to static HTML (see the pull request); nobody has opened the pages, clicked, tabbed through them,
looked at them in Arabic or on a phone, or bought an add-on. This guide is for the team to do that on the deployed site. Allow 30 minutes.
Design and impact: `docs/specs/addons-marketplace-unification.md`, Part C.

## What you need

| Login / workspace                                                                    | Used for                      |
| ------------------------------------------------------------------------------------ | ----------------------------- |
| A workspace on a paid plan that **has** the Marketplace feature; owner or admin role | steps 1 to 6, the normal case |
| The same workspace, a **Viewer** or **Agent** login (no `market.apps.install`)       | step 7                        |
| A role with `market.apps.read` but **without** the Shopify / REST API permissions    | step 8 (tiles absent)         |
| A workspace on a plan **without** the Marketplace feature (for example Free)         | step 9 (paywall)              |
| A workspace with the **chat team** or **sales team** edition preset                  | step 10 (hidden modules)      |
| A login without `market.apps.read`                                                   | step 11                       |
| A phone, or the browser at 375 px wide; the app switched to Arabic                   | steps 12 and 13               |

## 1. The four tabs

1. Sign in as the owner. Open **Marketplace**.
2. Expected: it opens on **Integrations**. The tab row reads **Mini apps, Integrations, Add-ons, Developer**, in that order. To the right: **Installed (n of m)** and **Request an integration**.
3. Select each tab. The address changes to `/marketplace/apps`, `/marketplace/integrations`, `/marketplace/addons`, `/marketplace/developer`. The current tab is underlined.
4. Press Tab with the keyboard from the page title: the four tabs come first, left to right, then the links on the right, then the search box.

## 2. Integrations: one list

1. Open **Integrations** with no filter.
2. Expected: no separate block of cards above the shelves. Shelves **Featured / Popular / New** (when there are listings) show Marketplace listings only. Under **All apps**, one grid holds the listings and the built-in connectors: **Shopify, WooCommerce, Google account, Google Sheets, Google Docs, Google Forms, Google Calendar, Video meetings** (the ones your role and plan allow). A connector card has a **Built in** badge; otherwise it is the same size, border, spacing and type as a listing card.
3. If there is more than one page of listings, the connectors appear after you select **Load more** until the last page (documented behaviour for the Most installed / Featured / Newest sorts).
4. A connector's badge: **Connected** if the thing is connected (Google account connected; Sheets / Docs / Forms / Calendar connected with that permission ticked; a Shopify or WooCommerce store connected; a video account connected), **Not connected** if it is not, **Upgrade** if the plan lacks it. A card with no badge means the status could not be read; that is not an error.
5. Buttons: **Manage** on a connected card, **Connect** (blue) on a not-connected one, **Open** on an upgrade or unread one. Each goes to that connector's own screen (the Google cards all go to the Google account page).

## 3. Search, category, Installed, sort on the mixed grid

1. Type `shop` in the search box. Expected: Shopify (and any listing with "shop" in its name or text) stays, the other connectors go, the shelves go.
2. Clear it. Pick the category **E-commerce**. Expected: Shopify and WooCommerce appear with the e-commerce listings, and the count next to **E-commerce** includes them. **Productivity** holds the Google account, Sheets, Docs, Forms; **Calendar and meetings** holds Google Calendar and Video meetings.
3. Select **Installed**. Expected: only listings you installed and connectors that show Connected. Select **Available add-ons**: no connector at all.
4. **Sort by**: the options are **Most installed, Featured, Newest, Name**, in that order, on **Mini apps** and on **Integrations**, both starting on **Most installed**. Choose **Name**: connectors fall in alphabetically between the listings.
5. Open **Mini apps**: same search box, chips, sort, shelves, cards. No connector cards there. A paid app says **Included in your plan**, **Subscribed**, or its price.
6. Search for something that does not exist: the empty state says nothing matches; the **Request an integration** box shows. With no listings and no connector at all (an empty catalogue and a role with no tiles) it says nothing is listed yet.

## 4. Add-ons

1. Open **Add-ons**. Expected: the same cards as **Plans > Add-ons**: **Included in your plan**, **Active** (with the renewal date), a price and **Buy add-on**, or **Needs an active paid plan**. No developer tool cards. Under the list: "Need message credits? Top up wallet" (a link, not a card), and a line pointing to the **Developer** tab.
2. As the owner, **Buy add-on** opens the checkout of that pack. Do not finish a payment unless you use a test gateway.
3. Open **Plans** in the account menu: the list there is the same.

## 5. Developer

1. Open **Developer**. Expected: cards **REST API, Webhooks, Geta publishing, Translation** (those your role and plan allow). No Shopify or Google cards, and no card called Add-ons.
2. Select **Open** on each: the REST API (`/developers`), Webhooks, Geta publishing and Translation screens open. On **Webhooks** the link at the top reads **Developer** and returns here.
3. **Settings** (the hub) must not list REST API, Webhooks, Geta publishing, Translation, Shopify, WooCommerce or the Google cards a second time. (REST API keys stays under Data and security on purpose: it is the same screen.)

## 6. Back links

Open Shopify from its card. The breadcrumb at the top reads **Back to Marketplace / Integrations / Shopify**. Open **REST API**: **Back to Marketplace / Developer / REST API**. Each link returns to the tab you came from.

## 7. Viewer or agent (no install permission)

On Integrations and Mini apps, listing cards offer **View details** only. On **Add-ons**, a **Buy add-on** button is disabled with "Ask your account owner".

## 8. A role that lacks a tile's permission

Remove the permission for the store (or for API keys) from a role and sign in as that role. Expected: the Shopify / WooCommerce card (or the REST API card) is **absent**, not an empty card or a disabled one. The category count drops with it.

## 9. A plan without the Marketplace

1. Sign in to a workspace on a plan that lacks the Marketplace feature. The menu entry shows an upgrade mark.
2. Open each of the four tabs. Expected: the upgrade sheet (**Marketplace is not on your plan**) over each.
3. On **Add-ons** only, the sheet has an extra line: "Add-ons do not need the Marketplace on your plan ... **Open Plans and add-ons**". Follow it: the Plans page shows the add-ons list and a paid plan can buy there.

## 10. Edition presets

Sign in to a workspace with the **chat team** or **sales team** preset. Any connector whose module the preset hides (for example Shopify / WooCommerce) must not appear in the grid, in the category counts, or in search.

## 11. A login without `market.apps.read`

The Marketplace entry is not in the menu. Typing `/marketplace/developer` or `/marketplace/addons` in the address bar shows no data (a permission message, no cards).

## 12. Arabic

Switch the language to Arabic. Expected: the tab row, the cards, the category list and the sort read right to left; the search icon sits on the right edge of the box; badges and buttons keep their padding; the chevron of the back links points the right way. No text overflows a card.

## 13. Phone width (375 px)

Expected: no sideways scrolling of the page; the four tabs scroll sideways inside their row; the grid is one column; the category chips scroll sideways; each card's button is full width; the sticky header does not cover the first card.

## What to report

For each step: pass, or what you saw. Things most likely to be wrong, because they were never seen: the order of cards when sorting by name, the **Connected** badge of a connector after you connect it on its own screen (it should update when you come back; the page refetches on focus for Google only, so a reload may be needed for stores), card heights on a row that mixes both kinds, and Arabic spacing.
