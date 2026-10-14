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
