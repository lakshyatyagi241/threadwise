# Google Sheets add-on source: the contract for this folder

The Apps Script project members copy into their own Google account (`GET /v2/extension/sheets/files/:name`). The API serves exactly
these six names from this folder, and nothing else:

`Code.gs`, `Dialog.html`, `Settings.html`, `Help.html`, `appsscript.json`, `README.md`

`Code.gs` must declare the API address on one line, written exactly like this, because the download rewrites it to this installation's
`APP_URL`:

```js
const CRM_BASE = 'https://api.example.com';
```

The add-on talks to `<CRM_BASE>/api/v1/sheets-addon/...` with `Authorization: Bearer <the member's Sheets key>`. The contract is in
`docs/api/chrome-extension-sheets-addon.md`. Until the source is added here the setup page lists each file as not available and a
download answers 404.
