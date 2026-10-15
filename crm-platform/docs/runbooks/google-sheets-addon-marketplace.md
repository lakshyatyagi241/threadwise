# Publishing the Google Sheets add-on to the Google Workspace Marketplace

The add-on source is `apps/api/assets/google-sheets-addon/` (six files, see its `README.md`). Until Google approves a public listing, members copy the files into
their own Apps Script project from the setup page (`/google-sheets-addon`). This runbook is for the operator who applies for the listing. It follows Google's
[publishing guide](https://developers.google.com/workspace/marketplace/how-to-publish); check that page and the
[app review requirements](https://developers.google.com/workspace/marketplace/about-app-review) before you start, because Google changes them.

Why one listing can serve every installation: the add-on takes the server address from the **Webhook URL** the member pastes in Initial Setup
(`<api>/api/v1/sheets-addon/webhook/<key>`), so `CRM_BASE` in `Code.gs` is only a fallback for the downloaded copy.

## Before you apply

1. A Google account that will own the project (use a company account, not a personal one), a domain you control, a public **privacy policy** page and **terms** page, a
   **support** page or email, a 128x128 logo and a 96x96 (and 32x32) icon, and 1 to 5 screenshots (1280x800) of the add-on working in a sheet.
2. Run the add-on yourself in a test sheet first and fix what you find (it has been unit tested but never run in a real Google Sheet).
3. State the data use honestly in the privacy policy: the add-on reads the active spreadsheet, sends the rows you choose to your CRM, and stores your Webhook URL in your own
   Google account. The scopes it asks for are in `appsscript.json`: `spreadsheets.currentonly`, `script.container.ui`, `script.external_request` and `script.scriptapp`.
   `script.external_request` and `script.scriptapp` are the ones Google reviews hardest; be ready to explain each in one sentence (call the CRM; create the edit and hourly triggers a member switches on).

## 1. Create the Apps Script project

1. Open script.google.com, **New project**, rename it to the add-on's name.
2. Project Settings: tick **Show "appsscript.json" manifest file in editor**.
3. Paste the six files from `apps/api/assets/google-sheets-addon/` (`Code.gs`, `Settings.html`, `Dialog.html`, `Help.html`, `appsscript.json`; `README.md` is not part of the project).
   Leave `CRM_BASE` as it is. Do not paste a real server address into the published copy.
4. Check `appsscript.json`: `runtimeVersion` is `V8` and the four scopes above are listed, nothing else.

## 2. Link a Google Cloud project

1. In Project Settings, under **Google Cloud Platform (GCP) Project**, **Change project** to a standard Cloud project you own (create one in the Cloud console; note its number).
2. In that Cloud project open **APIs & Services > OAuth consent screen** (Google now calls this **Google Auth Platform**): app name, support email, logo, home page,
   privacy policy and terms links, authorised domain, developer contact. User type **External**.
3. Add the four scopes under **Data Access**. Submit the consent screen for **verification** when you are ready to go public; Google asks for a demo video that shows the
   OAuth grant and each scope in use.

## 3. Deploy a test version

1. In the Apps Script editor choose **Deploy > Test deployments**, type **Editor Add-on**, choose a test spreadsheet and **Execute**.
2. Run **Initial Setup** with a real Webhook URL from your CRM: Send Test, Submit, edit a row with **Send on event** on, and check the contact arrives. Then leave a row change
   for the hourly sweep. This is also where you confirm the add-on menu appears under Extensions (the code falls back to a plain menu if `createAddonMenu` is unavailable).
3. Choose **Deploy > New deployment**, type **Add-on**, add a description. Note the **Deployment ID** and the **version** number.

## 4. Configure the Marketplace SDK

1. In the same Cloud project enable the **Google Workspace Marketplace SDK** (APIs & Services > Library).
2. Open **Google Workspace Marketplace SDK > App Configuration**: choose **Public** (cannot be changed later; a private listing is limited to your Workspace organisation and skips
   Marketplace review), **Individual + admin install**, and tick **Google Sheets** under the Google Workspace integrations. Under **Sheets add-on script** enter the
   **Deployment ID** and **version** from step 3. Add the OAuth scopes exactly as in `appsscript.json`, and the developer details and links.
3. Open **Store Listing**: language, name, short and detailed description, category, icons, screenshots, support and policy links. Keep the description truthful to what the
   add-on does: sends new or changed rows to your CRM as contacts, pulls contacts, syncs products.

## 5. Submit

1. In **Store Listing** choose **Publish**. Google reviews public listings (the OAuth verification and the Marketplace review run side by side). Expect back-and-forth; answer each
   point and resubmit. Review time is not guaranteed.
2. When approved, copy the listing URL into the CRM's `EXT_SHEETS_MARKETPLACE_URL` so the setup page links to it, and tell members they can install from
   **Extensions > Add-ons > Get add-ons**.
3. For each new version: save in Apps Script, **Deploy > Manage deployments > Edit > New version**, then update the version number in the Marketplace SDK App Configuration. Changing
   scopes triggers a new review.

## While you wait

Nothing blocks members: the setup page offers the six files for download, with `CRM_BASE` already set to this installation.

## Verifying without Google, and installing in a real Sheet

Nobody on the team has run this add-on in a real Google Sheet yet, and CI has no Google account. So there are two kinds of evidence, and the listing application above should wait for the
second one.

**1. What the automated suites prove (no Google, runs in CI and on a laptop).** `apps/api/test/support/apps-script-harness.ts` is an emulator of the Apps Script runtime: it loads
the unchanged `Code.gs` in a sandbox that has only the globals Apps Script has, and mocks `SpreadsheetApp` (a real in-memory grid with Google's range rules and limits), `HtmlService`
(it renders the real dialogs and fails for a file name that does not exist), `PropertiesService`, `CacheService`, `LockService`, `ScriptApp` (installable triggers, 20 per user),
`UrlFetchApp`, `Utilities` and `Session`, with the 6-minute execution limit, the scopes in `appsscript.json`, and the simple-trigger 30 second limit. Run them from `crm-platform/apps/api`:

```bash
pnpm exec vitest run --dir test/unit test/unit/chrome-extension-sheets-addon
pnpm exec vitest run --dir test/e2e --testTimeout=120000 test/e2e/chrome-extension-sheets-addon
```

- `addon-runtime.spec.ts`, `addon-sweep.spec.ts`: the menu, Initial Setup, Send Test, Submit, both triggers, the hourly sweep, chunking, failures (401, 403, 413, 429, network, quota), the key never leaving the member's own properties.
- `addon-static.spec.ts`: the manifest (V8, time zone, exactly four scopes and the Google API in `Code.gs` that needs each), and every dialog against `Code.gs` (each `google.script.run` function exists and is public, each `<?= ?>` variable is supplied, no `innerHTML`/`eval`/modal dialogs).
- `apps-script-harness.spec.ts`: the emulator tested against what Google documents.
- `addon-real-api.e2e.spec.ts`: the same unchanged `Code.gs` posting over real HTTP to the real Nest app (Postgres and Redis in containers): Initial Setup with a real Webhook URL, Send Test, Submit, an edit becoming a contact, the same row being `unchanged`, a changed row updating it, 600 rows as two chunks, a revoked key, the per-key 429, Pull and Sync products.
- `sheets-webhook-hardening.e2e.spec.ts`: the receiving endpoint: idempotency, two requests at once, size and row limits, the key stored only as a hash.

**2. What only a real Google account can prove.** Google's real runtime, the authorization flow and the consent screen, how long a trigger takes to fire, real quotas, the real execution limit, and
how the dialogs look and behave in Google's sandboxed iframe are not exercised by any automated test. Follow
[google-sheets-addon-real-sheet-test.md](google-sheets-addon-real-sheet-test.md): a click-by-click procedure (create a test Sheet, paste the five project files, authorize past the
"Google hasn't verified this app" screen, run every menu item and trigger) with a checklist of every menu item and every failure message, and how to read the Executions and Triggers pages.
Attach the filled checklist to the listing application. Run it twice: once as a copy bound to a spreadsheet (what members do today) and once as a test deployment of an Editor Add-on
(step 3 above), because an add-on's hourly trigger has no open spreadsheet and may behave differently (see the "Add-on test deployment" part of that page).
