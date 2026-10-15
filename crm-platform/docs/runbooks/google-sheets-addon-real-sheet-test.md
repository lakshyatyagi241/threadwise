# Testing the Google Sheets add-on in a real Sheet (manual procedure)

The add-on (`apps/api/assets/google-sheets-addon/`) has been tested against an emulator of Google Apps Script and against the real CRM API, but never inside Google. This page is for one person
with a Google account who walks through it once, writes down what happened, and sends the result back. It takes about 60 to 90 minutes, plus up to two hours of waiting for the hourly trigger
(step 7), which can run alongside the rest.

Google changes the wording and the place of its buttons from time to time. Where a label below differs from what you see, use the nearest equivalent and note the difference in the "Notes" column.

## What you need

- A Google account. **Use a personal Gmail account if you can.** A company Google Workspace account may be set by its admin to block apps that Google has not verified, and then step 4 stops at "Access blocked".
- A CRM workspace that is reachable from the public internet over **https**. Apps Script runs on Google's servers: it cannot call `localhost`, a private address or plain `http`. A staging deployment works; a tunnel
  (for example a Cloudflare or ngrok https address) to a development machine works too.
- In that CRM: an admin user, the **Google Sheets** add-on installed for the workspace (Marketplace), and a key. Open **Settings > Google Sheets add-on**, create the key, and copy the **Webhook URL** at once
  (it is shown in full only once). It looks like `https://<your-api>/api/v1/sheets-addon/webhook/wsn_live_` followed by 32 characters. Keep it in a note you can paste from. Never paste it into a chat or a ticket.
- The five project files. Download them from the same CRM page (they come with `CRM_BASE` already set to your server), or take them from `crm-platform/apps/api/assets/google-sheets-addon/` in the repository:
  `Code.gs`, `Settings.html`, `Dialog.html`, `Help.html`, `appsscript.json`. A sixth file, `README.md`, is documentation and is not pasted into Google.
- A second CRM user with a role that may **read** contacts but not create or edit them, and a key for that user (used once, in part G of the checklist). Optional but it covers two failure messages.

## 1. Create the test Sheet

1. Go to https://sheets.google.com and choose **Blank spreadsheet**.
2. Click the title "Untitled spreadsheet" and rename it **CRM add-on test**.
3. Rename the first tab to **Leads** (right-click the tab > **Rename**). In row 1, type the headings in A1, B1, C1: `Name`, `Email`, `Phone`. In row 2 type `Test One`, then in B2 an email address that
   does not exist in the CRM yet, for example `test.one+<today's date>@example.com`, and leave C2 empty. Use a fresh address on every run, otherwise "created" will read "unchanged".
4. Add a second tab with the **+** at the bottom left and name it **Products**. Headings in row 1: `Name`, `Price`, `SKU`, `Stock`. Row 2: `Blue Tee`, `499`, `TEE-1`, `10`. Row 3: `Red Cap`, `19.99`, `CAP-1`, and leave Stock empty.
5. Click the **Leads** tab again so it is the one showing.

## 2. Paste the five project files

1. In the Sheet choose **Extensions > Apps Script**. A new tab opens with a project called "Untitled project". Click the name and rename it **CRM add-on**.
2. Click the gear **Project Settings** on the left. Tick **Show "appsscript.json" manifest file in editor**. Go back to the editor (the `< >` icon on the left).
3. In the file list on the left, click `appsscript.json`. Select everything in the editor (Ctrl+A or Cmd+A), delete it, and paste the contents of your `appsscript.json`.
4. Click `Code.gs`, select all, delete, paste the contents of `Code.gs`. In the first lines, find `const CRM_BASE = '...';`. A file from the CRM page already holds your server; a file from the repository holds
   `https://api.example.com`, which is fine, because the Webhook URL you paste later carries the real server.
5. Click the **+** next to **Files** > **HTML**. Type `Settings` (without ".html"; the editor adds it) and press Enter. Select all in the new file, delete, paste the contents of `Settings.html`.
6. Repeat step 5 for `Dialog` (paste `Dialog.html`) and `Help` (paste `Help.html`). The names must be exactly `Settings`, `Dialog`, `Help`, capital first letter.
7. Press **Ctrl+S** (Cmd+S) to save. The file list now shows `Code.gs`, `Dialog.html`, `Help.html`, `Settings.html`, `appsscript.json` (the editor sorts them).
8. Check the manifest once: open `appsscript.json`. It must say `"runtimeVersion": "V8"` and list exactly four scopes: `script.container.ui`, `script.external_request`, `script.scriptapp`,
   `spreadsheets.currentonly`. If the editor added any other scope on its own, write that down: it means Google found an API use the automated tests did not.
9. Go back to the Sheet tab and **reload the page** (F5). Wait 5 to 10 seconds.

## 3. Find the menu

After the reload a **CRM** menu appears next to **Help** in the menu bar. (If the add-on menu API is available the entries may instead be under **Extensions > CRM add-on**. Write down which one you saw: the code
tries the add-on menu first and falls back to a menu called CRM.) If no menu appears after a minute, open the Apps Script tab, pick `onOpen` in the function list at the top and press **Run**; that triggers
step 4 and shows any error. Note what happened in checklist item A1.

The first menu entry is **Initial Setup**, then **Send a test row**, **Check connection**, a line, **Pull contacts into a sheet**, **Push contacts from this sheet**, a line, **Sync products to a shop**, a line, **Help**.

## 4. Authorize, and what the consent screens show

The first time you use an entry, Google asks you to allow the add-on. In order:

1. Click **CRM > Initial Setup**. A box "Authorization required" says the script needs your permission. Click **Continue**.
2. "Choose an account": pick the account that owns the Sheet.
3. **"Google hasn't verified this app"**. This is expected: the project is not published or reviewed. It says the app has not been verified by Google and may be unsafe. Do not click "Back to safety".
   Click **Advanced** (small grey text at the bottom left), then **Go to CRM add-on (unsafe)** (the name is your project's name).
4. "CRM add-on wants to access your Google Account". It shows your account and lists what it asks, in Google's words, which may differ a little:
   - "View and manage spreadsheets that this application has been installed in" (`spreadsheets.currentonly`)
   - "Display and run third-party web content in prompts and sidebars inside Google applications" (`script.container.ui`)
   - "Connect to an external service" (`script.external_request`)
   - "Allow this application to run when you are not present" (`script.scriptapp`, for the edit and hourly triggers)

   There must be **four** lines and no Drive, Gmail or "see your email address" line. Take a screenshot. If there are more lines, stop and report it.

5. Click **Allow**. The Initial Setup window opens, or you may have to click **CRM > Initial Setup** once more.

If you see "Access blocked: Authorization Error" or "This app is blocked", the account is a Workspace account that blocks unverified apps: use a personal Gmail account.

To start over later: https://myaccount.google.com/permissions > pick the project > **Delete all connections** (or "Remove access"), then reload the Sheet.

## 5. Run the setup (Initial Setup, Send Test, Submit)

1. **CRM > Initial Setup** opens a window "Initial Setup" (about 520 x 640). Fields: Webhook URL (a masked box), Sheet to watch (a list), Trigger column, two ticks "Send on event" and "Send on schedule",
   buttons Send Test and Submit.
2. Paste the Webhook URL. Choose **Leads** in "Sheet to watch". In "Trigger column" type `Email` (the heading) or `B` (the letter): a row is sent when this cell is filled. Leave both ticks off for now.
3. Click **Send Test**. Expected: a green box "Connected as <your CRM name> (<email>). Workspace: <name>", then "The CRM received row 2 as a test (nothing was saved). It saw these columns:" and a small table `Name`, `Email`, `Phone`.
   Check in the CRM (Settings > Google Sheets add-on): the last capture shows those columns, and **no contact was created**.
4. Tick **Send on event** and **Send on schedule**. Click **Submit**. Expected: a green box with "Saved. Sending on every edit. Sweeping every hour." The "Connected" box above shows the server and `wsn_live_••••••••` and the last 8 characters (never the whole key).
   If you instead see "Saved, but Google did not let the add-on create its triggers: ...", note the exact words (item C5).
5. Close the window, open it again: the saved sheet, column and both ticks must still be there, and the Webhook URL box is empty (it says: leave it empty to keep the saved one). Click **Submit** again with the box empty: it must succeed.

## 6. Send on event (the edit trigger)

1. In the **Leads** tab, click B2 and type the new email you prepared in step 1.3 (or retype it), press Enter.
2. Within a few seconds a **CRM status** column appears at D1 and D2 reads `created`. (The edit trigger runs as soon as you leave the cell; it is not instant. Wait up to 30 seconds.)
3. In the CRM, **Contacts** now has "Test One" with that email, source `google_sheets`.
4. Retype the same address in B2 (select the cell, type it again, press Enter). Google may not count that as an edit; if D2 still reads `created`, that is fine. If it changes, it reads `unchanged`. Either way there must still be **one** contact.
5. Change A2 to `Test One Changed`. The trigger column is Email, so editing the Name does **not** send. Now retype the email: D2 reads `updated`, and the contact's name changed, still one contact.
6. In the bottom tabs you do not see a "CRM sync state" tab: it is a hidden sheet. To confirm it exists: **View > Hidden sheets** (or the "All sheets" list at the bottom left, the four-line icon). Do not edit it.

## 7. Send on schedule (the hourly trigger)

1. Add a row without touching the Email cell through the trigger: in row 3 type `Test Two`, `test.two+<date>@example.com`. If "Send on event" is on, typing the email already sends. So for this check first untick
   "Send on event" in Initial Setup and Submit, then add row 4: `Test Three`, `test.three+<date>@example.com`.
2. To run the sweep **now** without waiting: in the Apps Script tab choose `crmScheduledSend` in the function list at the top and press **Run**. This is the same code the trigger runs, as you. Within seconds the status of
   row 4 reads `created`. (This does not prove the trigger fires by itself.)
3. For the real thing, add row 5 (`Test Four`, new email) and wait. Google runs an "every hour" trigger at an unpredictable moment within the hour. Check back after 60 and again after 120 minutes: row 5 should read
   `created` without you doing anything. Write the times down (checklist E3). Check the Executions page (below) for the run.
4. Run the sweep a second time (or let the next hour pass): nothing is sent again (the Executions page shows a run that completes quickly; the CRM shows no new contacts).

## 8. Reading the Executions page and the Triggers page

In the Apps Script editor the left bar has icons: **Overview**, **Editor** (`< >`), **Triggers** (a clock), **Executions** (a list) and **Project Settings** (a gear).

**Triggers** (the clock). After Submit with both ticks it must list exactly two rows:

| Function           | Event source     | Event type |
| ------------------ | ---------------- | ---------- |
| `crmOnEditSend`    | From spreadsheet | On edit    |
| `crmScheduledSend` | Time-driven      | Hour timer |

The page also has "Last run", "Failure rate" and a three-dot menu (Delete trigger). More than one row of the same function means the clean-up did not work (report it). After **Remove connection** both rows must be gone.
If you ever need to remove them by hand, use the three-dot menu on each row.

**Executions** (the list). Every run of any function appears here, newest first: **Function**, **Deployment**, **Type** (for example "Editor add-on", "Trigger", "Time-driven"), **Start time**, **Duration**, **Status**
(Completed, Failed, Running, **Timed out**). Click a row to see its log. This add-on writes **no log lines** on purpose (the key must never be logged), so the detail is mostly empty.
How to read it for this add-on:

- A trigger run (`crmOnEditSend`, `crmScheduledSend`) says **Completed** even when the CRM refused the rows: the code catches errors, because nobody is there to show them to. The evidence of what happened is the **CRM status** column
  and the CRM itself. A trigger run that says **Failed** means an uncaught error: copy its message into the checklist.
- **Timed out** on `crmScheduledSend` means a run went past Google's 6 minute limit: the sweep is meant to stop sending after 4.5 minutes and carry on the next hour. Report it with the number of rows in the sheet.
- Durations: an edit run should take a few seconds; a sweep of a few rows under 10 seconds.
- **Failed** on `onOpen` (a menu that does not appear) or on a menu function shows the error text in the row's detail.

## 9. Manual test checklist

Fill the last two columns. "Pass" means exactly the expected result. Copy any difference in words into Notes, with a screenshot name if you took one. Items marked (auto) are covered by the automated suites and cannot be
reproduced by hand; skip them. A test is cleaner after **CRM > Initial Setup > Remove connection** between parts, but not required.

**A. The menu**

| #   | Step                                                                            | Expected result                                                                                        | Pass / fail | Notes |
| --- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------- | ----- |
| A1  | Reload the Sheet                                                                | A CRM menu (or an Extensions entry) appears with the ten lines listed in section 3                     |             |       |
| A2  | Before saving any connection, open the menu                                     | Every entry is shown (the code shows everything until the first connection check)                      |             |       |
| A3  | Save a connection with a key whose role cannot create contacts or edit products | After the check, "Push contacts from this sheet" and "Sync products to a shop" disappear from the menu |             |       |
| A4  | Click **Help**                                                                  | A window "Help" opens, readable, with a Close button that closes it                                    |             |       |

**B. Authorization**

| #   | Step                         | Expected result                                                                                  | Pass / fail | Notes |
| --- | ---------------------------- | ------------------------------------------------------------------------------------------------ | ----------- | ----- |
| B1  | First click on Initial Setup | "Authorization required"; "Google hasn't verified this app"; Advanced > Go to ... (unsafe) works |             |       |
| B2  | Read the permission list     | Exactly the four lines in section 4, nothing about Drive, Gmail or your email address            |             |       |
| B3  | Allow                        | The Initial Setup window opens                                                                   |             |       |

**C. Initial Setup**

| #   | Step                                                                                                                                 | Expected result                                                                                                                                                                                                                                                  | Pass / fail | Notes |
| --- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ----- |
| C1  | Click **Send Test** with the URL box empty and nothing saved                                                                         | Red box: "Paste the Webhook URL from the CRM first."                                                                                                                                                                                                             |             |       |
| C2  | Paste `https://example.com/hello`, Send Test                                                                                         | Red box: "This does not look like a Webhook URL. Copy it from the CRM (Settings > Google Sheets add-on). It ends with wsn_live_ and 32 more characters."                                                                                                         |             |       |
| C3  | Paste the real Webhook URL, Send Test                                                                                                | Green: connected as you, workspace name, "received row 2 as a test", the columns Name, Email, Phone; no contact created                                                                                                                                          |             |       |
| C4  | Type `Company` in Trigger column, Send Test                                                                                          | The same green box plus "The trigger column was not found in row 1."                                                                                                                                                                                             |             |       |
| C5  | Tick both boxes, Submit                                                                                                              | Green "Saved. Sending on every edit. Sweeping every hour."; Triggers page shows two triggers                                                                                                                                                                     |             |       |
| C6  | Close and reopen Initial Setup                                                                                                       | "Connected" box shows the server and `wsn_live_••••••••` plus 8 characters; sheet, column and ticks are kept; URL box empty                                                                                                                                      |             |       |
| C7  | Change the Trigger column, leave the URL box empty, Submit                                                                           | Succeeds (the saved connection is kept)                                                                                                                                                                                                                          |             |       |
| C8  | Untick both boxes, Submit                                                                                                            | Success; Triggers page shows no `crmOnEditSend` or `crmScheduledSend`                                                                                                                                                                                            |             |       |
| C9  | Paste a Webhook URL with a wrong host, for example `https://crm.invalid/api/v1/sheets-addon/webhook/wsn_live_` + 32 zeros, Send Test | Red box: "Could not reach the CRM at https://crm.invalid. Check your connection and try again."                                                                                                                                                                  |             |       |
| C10 | Paste the right host with a wrong key (change the last character), Submit                                                            | Red box: "The key in your Webhook URL is not valid any more. Create a new one in the CRM (Settings > Google Sheets add-on), then paste the new Webhook URL in Initial Setup." and the old connection is kept                                                     |             |       |
| C11 | Click **Remove connection**                                                                                                          | A confirmation appears **inside the window** ("Remove the connection from this Google account? ..." with "Yes, remove" and "Keep it"). "Keep it" hides it. "Yes, remove" shows "The connection was removed and sending was stopped."; the Triggers page is empty |             |       |
| C12 | Close                                                                                                                                | The window closes                                                                                                                                                                                                                                                |             |       |

C11 matters: an earlier version used a browser pop-up that Google's window ignores. If the confirmation never appears, or Yes does nothing, report it.

**D. Menu actions that need a saved connection**

| #   | Step                                                                        | Expected result                                                                                                        | Pass / fail | Notes |
| --- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------- | ----- |
| D1  | With no connection saved, **Check connection**                              | Alert "CRM connection": "No Webhook URL is saved yet. Open Initial Setup and paste the Webhook URL from the CRM."      |             |       |
| D2  | With no connection saved, **Send a test row**                               | Alert "Send a test row" with the same sentence                                                                         |             |       |
| D3  | Save a connection (Submit), then **Check connection**                       | Alert: "Connected as <name> (<email>)." "Workspace: <name>" "This key can:" and four lines marked [x]                  |             |       |
| D4  | **Send a test row**                                                         | Alert: "The CRM received the test and saw these columns: Name, Email, Phone"                                           |             |       |
| D5  | Revoke the key in the CRM, then **Check connection**                        | Alert with "The key in your Webhook URL is not valid any more. ..." (the sentence from C10)                            |             |       |
| D6  | In the CRM uninstall the Google Sheets add-on, then Check connection        | Alert: "The Google Sheets add-on is not installed in this workspace. Ask an admin to install it from the Marketplace." |             |       |
| D7  | Reinstall it with fewer permissions (no contacts), Check connection or Push | A sentence ending "Ask an admin to reinstall the add-on and accept its permissions."                                   |             |       |

**E. Triggers**

| #   | Step                                                                                                         | Expected result                                                                                                                  | Pass / fail | Notes |
| --- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ----------- | ----- |
| E1  | Edit B2 (section 6)                                                                                          | D2 reads `created` within 30 seconds; one contact in the CRM                                                                     |             |       |
| E2  | Edit A2 only (not the trigger column)                                                                        | Nothing is sent                                                                                                                  |             |       |
| E3  | Add a row, wait for the hourly trigger (section 7)                                                           | The row is sent by itself within 2 hours; Executions shows a Time-driven `crmScheduledSend` that Completed. Time it took: ______ |             |       |
| E4  | Run the sweep again right after                                                                              | Nothing sent again; no new contacts                                                                                              |             |       |
| E5  | Paste 60 rows into the Leads tab at once with "Send on event" on                                             | The first 50 are sent at once; the rest are sent by the next sweep                                                               |             |       |
| E6  | Delete a row, add one, run `crmScheduledSend`                                                                | No error; only the new row is sent                                                                                               |             |       |
| E7  | Rename the Leads tab, run `crmScheduledSend`                                                                 | Nothing is sent (the add-on watches the sheet by name and does not guess another)                                                |             |       |
| E8  | Submit with Send on event ticked in a second, copied Sheet (File > Make a copy, paste the project there too) | Each Sheet has its own edit trigger on the Triggers page of its own project                                                      |             |       |

**F. Pull, Push, Products**

| #   | Step                                                                                                       | Expected result                                                                                                                                                                                              | Pass / fail | Notes |
| --- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- | ----- |
| F1  | **Pull contacts into a sheet** > Pull contacts                                                             | A sheet "CRM contacts" appears with a frozen header row and your contacts; the sheet becomes the active one. A name that starts with `=` in the CRM shows as text; a phone keeps its `+`                     |             |       |
| F2  | Pull with a search word that matches nothing                                                               | "No contacts matched."                                                                                                                                                                                       |             |       |
| F3  | Go to Leads, **Push contacts from this sheet**, enter a country code such as +91, Push contacts            | A summary "created / updated / unchanged / failed"; the CRM status column holds one result per row                                                                                                           |             |       |
| F4  | Push a sheet whose row 1 has no email or phone heading                                                     | "Row 1 needs a column named email or phone."                                                                                                                                                                 |             |       |
| F5  | Push an empty sheet (headings only)                                                                        | "There are no rows to send. Row 1 is the header row; the contacts start in row 2."                                                                                                                           |             |       |
| F6  | Put `not-an-email` in an Email cell and push                                                               | That row's status: `failed: email: This is not an email address.`; the other rows still go                                                                                                                   |             |       |
| F7  | Go to Products, **Sync products to a shop**, name the shop "Corner Store", currency INR                    | Shop created, the CRM status column says `created` for both rows; the CRM shows the shop and two products                                                                                                    |             |       |
| F8  | Sync products again                                                                                        | `unchanged`, and the shop is remembered                                                                                                                                                                      |             |       |
| F9  | Leave the shop name empty                                                                                  | "Check the form and try again." and "Give the shop a name."                                                                                                                                                  |             |       |
| F10 | Currency `INRR`                                                                                            | "Use a 3-letter currency code such as INR or USD."                                                                                                                                                           |             |       |
| F11 | Try Products on the Leads sheet                                                                            | "Row 1 needs columns named name and price."                                                                                                                                                                  |             |       |
| F12 | Pull / Push / Products with the connection removed                                                         | The window shows the "No Webhook URL" block instead of a form                                                                                                                                                |             |       |
| F13 | Use the key of a role that may only read contacts and run Submit with a trigger column set, then add a row | The row is not created; the CRM status column reads a failed row whose reason is "Your role cannot create contacts." (a whole-call refusal reads "Your role does not allow you to create or edit contacts.") |             |       |

**G. Things that cannot be provoked by hand (auto)**

| #   | Failure message                                                                                        | Covered by                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| G1  | "The request was too large. Send fewer rows at a time." (413)                                          | addon-runtime.spec.ts, addon-sweep.spec.ts (the add-on splits the request instead)           |
| G2  | "Too many requests. Wait N seconds and try again." / "Wait a minute" (429)                             | addon-runtime.spec.ts, addon-real-api.e2e.spec.ts (the real per-key limit of 120 per minute) |
| G3  | "Google's daily limit for web requests from this account is used up. Try again tomorrow."              | addon-runtime.spec.ts (Google's own quota)                                                   |
| G4  | "The add-on could not run. Close this window and try again."                                           | Shown by a dialog when Google itself fails the call                                          |
| G5  | "This window was opened without an action."                                                            | Dialog.html opened without its mode, which no menu entry does                                |
| G6  | "Saved, but Google did not let the add-on create its triggers: ... Allow the add-on and submit again." | addon-runtime.spec.ts (20 triggers, missing scope); try it only if C5 shows it               |
| G7  | "Stopped after N contacts. ..." during a Pull of more than 50,000 contacts                             | Code only (the 100-page cap)                                                                 |

## 10. Add-on test deployment (second pass, optional but recommended before publishing)

A copy pasted into a Sheet is a **container-bound script**. The Marketplace version is an **Editor Add-on**, which behaves differently in three ways the emulator can only guess at. After the pass above, in the Apps Script
editor choose **Deploy > Test deployments**, type **Editor Add-on**, pick the test Sheet and **Execute** (see google-sheets-addon-marketplace.md, step 3), then repeat items A1, B1 to B3, C3, C5, E1 and E3 and write down:

1. Where the menu appears (Extensions > the add-on name), and whether the first `onOpen` shows the menu before authorization.
2. E1: does the edit trigger fire for an edit you make in the Sheet?
3. **E3: does the hourly sweep send anything?** Google gives a time-driven trigger of an add-on no open spreadsheet, so `crmScheduledSend` may find nothing to read and do nothing. The emulator models that and the add-on then
   sends nothing; if it really is so, the "Send on schedule" option does not work for the Marketplace version and the add-on needs a design change (store the spreadsheet id and open it by id, which needs a wider scope).
   This is the most important thing this pass can tell us.

## 11. What the automated suites prove, and what they do not

Proved without Google (all in `apps/api/test`, run in CI):

- The unchanged `Code.gs` runs, end to end, against a faithful emulator of the Apps Script services it uses: the menu build (also when `createAddonMenu` is unavailable), Initial Setup, Send Test, Submit, both
  triggers (installed, replaced, removed, one per spreadsheet), the edit and hourly paths, the hidden state sheet, chunking at 500 and by size, partial failure, 401/403/413/429 and network errors, the key staying in
  the member's own properties, odd cells (formulas, errors, dates, merged cells, 50,000 characters), sheets of 10,000 rows within the execution limit, and the dialogs rendered from the real `.html` files.
- The same unchanged `Code.gs`, over real HTTP, against the real CRM API on real Postgres and Redis: contacts are created once, repeats are `unchanged`, a changed row updates the same contact, 600 rows are
  two requests, a revoked key and the rate limit read as readable messages, Pull and Sync products work.
- The manifest and the dialogs are checked by static tests (the scope list is exactly what the source needs; every `google.script.run` function exists).

**Not proved, and only this page can prove them:**

- Google's real runtime: that the code parses and runs there, and that every Google API behaves as the emulator assumes. The emulator is written from Google's documentation, not recorded from Google, so a method that
  exists in Google with different behaviour would not be caught. (A method the emulator does not model fails the tests loudly, so new API use is noticed; wrong behaviour of a modelled one is not.)
- The authorization flow and the consent screen, including the unverified-app screen, the exact wording of the four permissions, and what a Workspace admin policy does.
- Trigger delivery: how long after an edit the edit trigger runs, when "every hour" actually fires, whether a trigger is skipped or delayed, trigger failure notifications, and the 20-trigger limit across many Sheets.
- Quotas and the execution limit as Google enforces them: the real URL fetch daily quota, the real 6-minute limit and how much real time a 10,000-row sweep needs (the tests use assumed costs per call).
- How the dialogs look and behave in Google's sandboxed iframe (layout, fonts, focus, the absence of browser pop-ups) and in the Sheets mobile app.
- The add-on mode differences listed in section 10.
- Behaviour on a CRM that is slow, behind a proxy that rewrites headers, or that answers with a certificate Google does not trust.

## 12. What to send back

The filled checklist (section 9), the screenshots of the consent screen (B2), the Triggers page (C5, C8) and the Executions page after E3, the date, your Google account type (personal or Workspace), the browser, and
whether you used the bound copy, the test deployment, or both. Do not send the Webhook URL or the key; revoke the test key in the CRM when you are done.
