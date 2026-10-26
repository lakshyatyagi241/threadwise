# Help (the Help screen)

Opened from Menu > About > Help Center (`/help`). Laid out like the Geta app's Help screen: the "Help" header, a bar with the product
(logo and name) and two buttons (the guide menu, search), the title with a short welcome and three tips, then one card per group of
guides (Getting started, Dashboard, Inbox, Contacts, Settings, Account, Troubleshooting) listing its guides. A guide opens as its
own screen (`/help/[id]`) with its title, summary and body. The menu button opens a side menu (`help-drawer.tsx`) with the same
groups, one open at a time, each listing its guides. The search button shows a search box; matching guides replace the cards.
Everything is local: no request, no sign-in, works offline.

Not carried over from the Geta screen: its light/dark button (the theme is chosen in Menu > Appearance, which saves it to the account).

## Where the guides come from

They are the web Help center's own guides (`apps/web/src/features/*/help/*.md`), copied into `help-docs.json` by

```bash
node scripts/gen-help-content.mjs && npx prettier --write src/features/help/help-docs.json
```

run from `apps/mobile` after the web registry is generated (`apps/web/src/features/_registry/help.generated.ts`). The script lists the
guides the app shows (only ones about screens the app has) and their group; add or remove an id there and run it again. Only
English and the languages the web guide itself has (today: Arabic, for 14 of them) are copied; any other language shows the English
text with a note. Change a guide in the web, then run the script, so the app does not drift.

## Why not the web page

The web Help center is inside the signed-in web app. The app signs in with tokens that never go in an address, so a page opened
from the app would show the web login. A public help page on the web would allow a web view instead (the Geta app does that).

## Not carried over

The web hides guides by plan and role; the app shows every guide it carries. Links inside a guide to a web page address are plain
text; links to another guide in the app open it.
