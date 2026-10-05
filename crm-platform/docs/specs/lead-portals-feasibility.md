# Lead portals: how each one delivers leads (feasibility research)

Date checked: **2026-10-04** (all sources read on that date; re-check before building, portals change quietly).
Scope: research only. Nothing here was tested against a live portal account. No code was changed.
Context: `marketplace-mini-apps-and-integrations.md` (section 6.3 connector types, 6.4 the portal question) and `email-channel-and-social-leads.md` (lead pipeline L-01: `source`, `external_id`, `received_at`, `fields{}`, `attribution{platform, campaign, adset, ad, form}`, `raw`).

Our connector types used below: **PUSH** (portal posts to a webhook URL we give the customer), **PULL** (we poll the portal with the customer's key), **EMAIL_PARSE**, **OAUTH**, **WEBHOOK_RELAY** (Zapier/Make/Pabbly style).

## How to read the confidence column

| Rating | Meaning |
| --- | --- |
| **high** | The portal's own help page or its own developer document was read (including a copy of it hosted elsewhere, flagged where that applies). |
| **medium** | A CRM/integration vendor documents it (LeadSquared, Kylas, NeoDove, Sell.do, Anarock, Leadrat, 365CRM, Pabbly, Odoo app store, Greenhouse). The vendor depends on the portal, but we did not see the portal's own text. |
| **low** | A search snippet, a forum, or a document I could only partly read. Treat as a lead to verify, not a fact. |
| **unverified / not found** | Nothing usable found. Written as "not found". Nothing was guessed. |

Honesty notes that apply to the whole document:
- Real-estate, education and JustDial portals publish **no open developer docs**. Their mechanism is "give the webhook URL to your account manager", so payload field lists exist only in partner-held docs. Where a field list below comes from a CRM vendor, it is marked.
- I could not open the terms of use of JustDial (page returned 403 / only a title), MagicBricks (search crawler blocked), 99acres, Housing.com or Shiksha. **Only IndiaMART's terms were read.** "Terms: not verified" below means exactly that. This is research, not legal advice.
- Two PDFs (Housing.com developer doc, a CRM vendor's "marketplace to CRM" sheet) had broken text layers. I decoded them myself from the embedded font maps. The Housing.com PDF decoded cleanly; the CRM vendor sheet decoded with some garbled letters, so field names taken from it are marked low/medium and must be re-checked.

---

## (a) Summary table

| Portal | Best mechanism | Alternative | Auth | Approval / partner needed | Payload documented? | Confidence | Recommended connector | Effort | Risks |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **IndiaMART** | Push API (real-time) | Pull API (CRM key; backfill, reconcile) | Push: none documented (secret goes in our URL path). Pull: `glusr_crm_key` | Paid "IM Leads API" add-on (see note); seller self-serves in Lead Manager; OTP on mobile for push. No partner agreement | **Yes, official** (field list + example) | **high** | PUSH + PULL (both) | S (push) + S/M (pull) | Pull is capped at 5 calls/min, 7-day window; push auto-disables after 48 h of failures; DIY, no vendor hand-holding; add-on cost on lower plans |
| **JustDial** | Push (JustDial backend configures our URL, GET) | Email alerts (format not found); relay via Pabbly | URL token only (we choose) | **Yes: JustDial account manager / backend team must add the URL**; paid plans on integrator side | Partly (one integrator sheet lists fields), no official doc | **medium** (mechanism), **low** (fields) | PUSH (+ EMAIL_PARSE fallback) | S build, but slow to onboard each customer | Dependent on an account manager per customer; no retry/latency docs; payload unofficial; ToS not verified |
| **99acres** | Push to a URL (account manager configures) | Pull API with username + password + key (XML) | Push: our URL token. Pull: portal username/password (bad) | **Yes: account manager** adds URL or issues pull credentials; project ids mapped | No official doc; partial via vendors | **medium** (mechanism), **low** (fields) | PUSH first; PULL only if 99acres issues a proper API key | S (push) / M (pull) | Pull wants the customer's portal password; XML format; per-project mapping; ToS not verified |
| **MagicBricks** | Push (account manager configures) | Pull API key (XML download, 5-30 min polling by vendors) | Push: our URL token. Pull: "PULL API key" | **Yes: account manager** issues key / adds URL | Partial (365CRM push params; pull fields low) | **medium** / **low** | PUSH (+ PULL when customer has the key) | S / M | Payload only from vendors; ToS not verified; blocked to my crawler, so no official page read |
| **Housing.com** | Pull API (documented, HMAC signed) | Push (account manager configures) | Account `id` + secret key; HMAC-SHA256 hash of timestamp | Yes: Housing.com issues id + key on registration | **Yes (their own developer doc, 3 pages)**; note: no lead id in response | **high** (doc copy is old, hosted by a third party) | PULL | M | Doc looks dated (sample epochs are from 2016); no rate limit stated; need a derived dedupe key |
| **Shiksha** | Push (Shiksha account manager configures, POST) | Email alerts (leads are "emailed to you") | URL token only | **Yes: account manager** | Not found | **medium** (mechanism) | PUSH (+ EMAIL_PARSE fallback) | S | No payload spec anywhere; need a real sample from the customer |
| **Sulekha** | Push (account manager configures) | Email alert | URL token | **Yes: account manager** | Not found | **medium** | PUSH (+ EMAIL_PARSE) | S | Same as Shiksha |
| **TradeIndia** | Pull "My Inquiry API" (self-serve credentials) | Email alerts (not verified) | `userid` + `profile_id` + `key` | None stated; customer finds the credentials in their own account | Partial (integrator sheet fields, decoded) | **medium** (mechanism), **low** (fields) | PULL | S/M | TradeIndia's own help page does not mention the API; response fields from a garbled sheet |
| **Collegedunia** | Not found | Dashboard / email (not verified) | Not found | Not found | Not found | **unverified** | WEBHOOK_RELAY / EMAIL_PARSE until a sample exists | n/a | Only marketing mentions by NeoDove |
| **NoBroker** | Not found | n/a | Not found | Not found | Not found | **unverified** | none | n/a | Nothing found |
| **Quikr (QuikrHomes)** | Not found; LeadSquared dropped its connector | Generic webhook | Not found | Not found | Not found | **low** | none | n/a | A major CRM vendor deprecated the connector |
| **CarDekho** | Not found | NeoDove lists it; mechanism unstated | Not found | Not found | Not found | **low** | none until proven | n/a | Marketing page only |
| **Naukri (employer)** | Partner ATS integration (Zwayam Amplify) | n/a | Amplify API key from Naukri | **Yes: paid subscription + Naukri team (amplify@zwayam.com)** | Candidate fields only, no spec | **medium** | out of scope (candidates, not leads) | L | Partner-gated, not a lead feed |

Note on the IndiaMART add-on: the official page says the LMS Leads API "cannot be purchased or used as a standalone offering" and is a paid feature. A search-engine summary said it is free for Leader and Star plans; the page I fetched did not say that, so treat "free on Leader/Star" as **low confidence** and ask the customer.

---

## (b) One section per portal

### 1. IndiaMART

Date checked 2026-10-04. Best-documented portal by a wide margin.

**Ways a customer can get leads out**
1. **Push API (real-time)**. Seller opens Lead Manager > Import/Export Leads > Push API, picks a CRM from a list or "Other", enters a webhook URL, confirms an OTP sent to the registered mobile. Confidence **high**. https://help.indiamart.com/knowledge-base/integration-of-indiamarts-lead-manager-crm-push-api-with-third-party-crms-real-time-push-of-leads
2. **Pull API (scheduled)**. `https://mapi.indiamart.com/wservce/crm/crmListing/v2/` with `glusr_crm_key`, optional `start_time`, `end_time`. Confidence **high**. https://help.indiamart.com/knowledge-base/lms-crm-integration-v2 (key generated at `https://seller.indiamart.com/leadmanager/crmapi`)
3. **Native CRM plugins**: Zoho plugin, which IndiaMART says is "currently being phased out and will not be supported". **high**. https://help.indiamart.com/article-categories/selling-on-indiamart/lead-manager/crm-integration
4. **CSV/Excel export: not offered.** The help article says there is no provision to export enquiries to a spreadsheet. **high**. https://help.indiamart.com/knowledge-base/export-enquiry
5. **Email alerts**: not found in IndiaMART's own docs; do not plan on them.
6. **Relay**: Pabbly Connect has an IndiaMART trigger using the pull CRM key (medium) https://www.pabbly.com/how-to-send-indiamart-leads-to-other-applications-using-api-by-pabbly-connect/ . A Zapier IndiaMART app: not found.

**Approval / plan**
- "IM Leads API" is an add-on, not sellable standalone; "Only paid sellers can generate keys"; provided DIY, "IndiaMART's Technical Team won't do any hand-holding". **high**. https://help.indiamart.com/knowledge-base/im-lms-leads-api and the two pages above.
- No signed partner agreement, no IP whitelist documented (push page: "IP whitelisting requirements not documented"). **high** (absence in an official page).
- LeadSquared's page says to ask the IndiaMART account representative for the "v2 CRM key"; so in practice a rep may be needed on some plans. **medium**. https://help.leadsquared.com/integrate-indiamart-with-leadsquared/

**Pull API limits (official)**: max window 7 days; min 5 minutes between calls; max 5 requests per minute (exceeding blocks the key for 15 minutes); history up to 365 days from key generation; data before key generation available after 24 h; key expires after 7 days of inactivity; generating a new key invalidates the old one; times in IST; formats `DD-MON-YYYY` or `DD-MM-YYYYHH:MM:SS` (no space, as printed in the doc). Errors: 429 (limit), 401 (bad/expired key), 204 (no leads), 400 (missing dates / window > 7 days), 500. IndiaMART recommends 10-15 minute polling and recommends Push for real time. **high**. https://help.indiamart.com/knowledge-base/lms-crm-integration-v2
No pagination is documented (the 7-day window is the paging mechanism).

**Push API behaviour (official)**: HTTPS URL required; optional identifier path `https://abc.com/indiamart/{Identifier}` (this is where our per-connection secret goes); IndiaMART POSTs JSON with `Content-Type: application/json`, 10 s timeout; HTTP 200 means delivered; "Leads will be retried at regular intervals until successfully transferred"; the API **deactivates if the CRM does not accept leads for more than 48 hours continuously**; failure logs visible in the seller dashboard; no history before activation (use Pull for backfill); a test tool (`https://indiamartpushtest.stoplight.io/docs/indiamart-lms-push-api-teting/`) and sample listener (`https://seller.indiamart.com/testwebhooklistener`) exist. No signature or secret header is documented, so authenticity must come from an unguessable URL path plus payload shape checks. **high**.

**Documented payload** (push example; pull uses the same field names with a `UNIQUE_QUERY_ID` etc.): body = `{CODE: 200, STATUS: "SUCCESS", RESPONSE: {...}}` where RESPONSE holds:
`UNIQUE_QUERY_ID` (dedupe key), `QUERY_TYPE` (W direct enquiry, B buy-lead, P PNS call, BIZ catalog view, WA WhatsApp), `QUERY_TIME` (e.g. `2024-04-10 11:17:14`), `SENDER_NAME` (defaults to "IndiaMART Buyer"), `SENDER_MOBILE` (e.g. `+91-9999999999`), `SENDER_EMAIL`, `SUBJECT`, `QUERY_MESSAGE`, `SENDER_COMPANY`, `SENDER_ADDRESS`, `SENDER_CITY`, `SENDER_STATE`, `SENDER_PINCODE`, `SENDER_COUNTRY_ISO`, `QUERY_PRODUCT_NAME`, `QUERY_MCAT_NAME`, plus optional `SENDER_MOBILE_ALT`, `SENDER_PHONE`, `SENDER_PHONE_ALT`, `SENDER_EMAIL_ALT`, `CALL_DURATION`, `RECEIVER_MOBILE`. Always present: `UNIQUE_QUERY_ID`, `QUERY_TYPE`, `QUERY_TIME`, `SENDER_NAME`, one of mobile/email, `SENDER_COUNTRY_ISO`. `QUERY_MESSAGE` may contain escape sequences like `\n`, `\t`. **high**. (I did not capture the exact wrapper of the pull response; read the pull page's example during the build.)
Excluded from the API: unconnected call attempts, catalog views within 7 days of an active conversation, message replies, callbacks, GST/trust info. **high**.

**Timeliness / reliability**: push is described as real-time; no latency number published. Pull inherently lags the polling interval. Known risks come from the limits above (5-minute floor, key invalidation if the customer regenerates the key, 7-day inactivity expiry). **high** for what is documented; no outage history found.

**Terms**: IndiaMART Terms of Use (last updated 20 Feb 2026), Section VI, prohibit systematic retrieval of site content into a collection or database "whether through robots, spiders, automatic devices or manual processes" without written permission. The official Push/Pull APIs are the sanctioned route, so **we must not scrape the seller panel**. **high**. https://www.indiamart.com/terms-of-use.html

### 2. JustDial

Date checked 2026-10-04.

**Ways to get leads out**
1. **Push to a customer-specific URL, configured by JustDial's side, not by the customer.** Every integrator says the same: the JustDial UI has no field for a webhook URL; you send the URL to your JustDial account manager / backend team, who add it. LeadSquared adds: "The API must be configured in Justdial using the GET method." Confidence **medium** (several independent integrators agree; JustDial's own text not found). https://help.leadsquared.com/integrate-justdial-with-leadsquared/ ; https://support.kylas.io/portal/en/kb/articles/how-to-integrate-justdial-to-get-leads-in-kylas-crm ; https://kylas.io/crm-productivity/sales-crm/justdial-lead-integration-in-kylas-everything-you-need-to-know ; https://www.pabbly.com/automatically-add-justdial-leads-to-your-crm/
2. **Pull API: not found.**
3. **CSV export / email alerts**: not found in any source I could read (no JustDial help page found for either).
4. **Relay**: Pabbly Connect (webhook URL from Pabbly goes to the JustDial account manager). medium.

**Approval**: account manager / backend team involvement is required per customer. LeadSquared marks its connector as a paid feature; Kylas needs paid plans on both sides and the Elevate plan. Whether JustDial charges for it: **not found**. No partner agreement or IP whitelist mentioned. **medium**.

**Payload**: no official field list found. One CRM vendor's "marketplace to CRM" sheet (decoded PDF, third-party) maps these JustDial fields: `leadid` (their uniqueness key), `name`, `mobile`, `email`, `company`, `city`, `brancharea`, `pincode`, `category`. Confidence **low-medium** (one vendor, one document, and I had to decode its PDF). https://assets.skool.com/f/c4611084c2ce4f41ac3ed0262e49531c/a57e17d0fac84f49a1912504fb3dcb3430bedcc4abbd4442a7a6df2694e19bbf . LeadSquared, Kylas and Pabbly publish **no** field list, method detail or sample. A blog snippet says missed calls are also pushed as leads (low). Date/time field names, lead type, and phone format: **not found**.
Dedupe: Kylas support text says to dedupe on `lead_id` when a delivery was retried (a generic troubleshooting page, so low for JustDial specifically).

**Timeliness / reliability**: described as real-time by integrators; no latency, retry or failure behaviour documented by JustDial. Kylas exposes a "Failed Leads" tab (their own parse failures). **low**.

**Terms**: could not read (justdial.com terms returned 403 / an empty shell). **Not verified.** Scraping routes (Apify scrapers) exist but target public listings, not the customer's own lead stream, and we will not use them.

**Build note**: because JustDial's side is configured by a human, the real gating item is a **customer onboarding checklist** ("email your JustDial account manager this URL, ask for GET delivery, ask for a sample payload and a test lead"), and a receiver that accepts GET query strings.

### 3. 99acres

Date checked 2026-10-04. No official 99acres developer doc found. 99acres's own site search returned only articles and a forum question about whether an API exists (no answer read). https://www.99acres.com/lmsSearch (lead search tool, not an API)

**Ways to get leads out**
1. **Push**: LeadSquared generates a webhook URL and the customer must "reach out to your account manager from 99acres" to set it up; NeoDove says "Your integration will be activated by the 99 Acres team" and the 99acres team sends leads to the CRM API; Pabbly says the same (account manager adds the URL, no UI field). **medium**. https://help.leadsquared.com/integrate-99acres-with-leadsquared/ ; https://docs.neodove.com/admin-portal/integrations/99acres-integration
2. **Pull**: LeadSquared's periodic mode logs in with the customer's 99acres **User Name and Password** every 15 minutes by default; manual sync up to 4,000 leads and a 7-day window. **medium**. Same LeadSquared page. A CRM vendor sheet shows a 99acres pull URL with an opaque key segment plus `user_name`, `password`, `start_date`, `end_date`; a Scribd file titled "99acres API Integration Guide" describes request/response in **XML** (I could only see its description, not the content). **low**. https://www.scribd.com/document/736665708/99Acre-Pull-API
3. **CSV / email alerts**: not found.
4. **Indirect evidence on how portals push**: Anarock and Sell.do each publish their *own receiving endpoint* (`POST https://marketing.anarock.com/api/v0/:channel/push-lead?api_key=...`, `POST https://app.sell.do/api/leads/create_leads` form-data) and the portal's team configures its sender to match it, after 99acres shares the project names/ids. So the sender adapts to the receiver, not the other way round. **medium**. https://support.anarock.com/support/solutions/articles/35000226722-99acres-push-integration (via search result text; the page itself failed to load for me with an SSL error) ; Sell.do 99acres page (search result text; page 404 for me).

**Approval**: account manager (push) or credential issue (pull); project name + project id mapping with the CRM team; paid on integrator side (LeadSquared "paid feature"). **medium**.

**Payload**: not officially documented. What vendors imply, all **low-medium**:
- Anarock's receiver (which 99acres is configured to feed): `name`, `email`, `phone`, `country_code`, `project_name`, `project_id`, optional `city`, `locality`, min/max budget, `remarks`. This is Anarock's own contract, **not** a 99acres contract.
- CRM vendor sheet for the pull: `QueryId` (unique id), `Name`, `Email`, `Phone`, `QryInfo` (query text). Garbled decode; re-check.

**Timeliness**: push "real-time" per integrators; pull minimum 15 minutes in LeadSquared. No SLA found.

**Terms**: not verified. **We must not use the username/password pull unless 99acres confirms it as an official partner method**, because it stores a customer's portal login in our database; ask for a keyed API instead.

### 4. MagicBricks

Date checked 2026-10-04. MagicBricks's own site is blocked to my search tool, so **no official page was read**.

**Ways to get leads out**
1. **Push**: LeadSquared: generate webhook, "reach out to your account manager from MagicBricks" (real-time, no pull option); NeoDove: copy details, send to the Magic Bricks team, who activate; 365CRM: send MagicBricks your Login ID, "PUSH integration", CRM provider; Sell.do: MagicBricks needs the project names, sell.do gives a base URL plus API key, a "pusher cron" is created on the portal side. **medium**. https://help.leadsquared.com/integrate-magicbricks-with-leadsquared/ ; https://docs.neodove.com/admin-portal/integrations/magicbricks-integration.md ; https://www.365crm.io/magicbricks ; Sell.do MagicBricks page (via search result text).
2. **Pull**: an Odoo app asks for "your PULL API Key... you can get it from Magicbricks" and polls every 30 minutes. **medium**. https://apps.odoo.com/apps/modules/16.0/sp_crm_magicbricks_integration . A CRM vendor sheet shows a pull URL on `rating.magicbricks.com/mbRating/download.xml` with `startDate`, `endDate`, polled every 5 minutes (**low**, decoded sheet; a search for the host found nothing else, so treat as unverified).
3. CSV / email alerts: not found.

**Approval**: account manager every time. Paid integrator side. No partner agreement or IP whitelist mentioned. **medium**.

**Payload** (not official):
- Push params at 365CRM's receiver: `name`, `mobile`, `email`, `remark`, `project`, `pid` (property id), `source`, `responsetype` ("lead"), `account` (account email). **medium** (one vendor).
- Pull response per the sheet: `id` (unique), `name`, `mobile`, `email`, `msg`, `address`, `city`, `subject`. **low**.
- Push at a sheet-described generic receiver: `Name`, `Phone`, `Email`, `Message`. **low**.
The different field sets confirm that MagicBricks's sender is configured per receiving CRM.

**Timeliness**: real-time claimed (Zoho marketplace listing: "delivered in real time"). No SLA. **low-medium**.
**Terms**: not verified.

### 5. Housing.com

Date checked 2026-10-04.

**Ways to get leads out**
1. **Pull API, officially documented.** "Developer's CRM Integration Document" (Housing.com's own document, copy hosted on a CRM vendor's site): `GET https://leads.housing.com/api/v0/get-builder-leads`. Confidence **high** for content, with the caveats that the copy is third-party hosted and its sample timestamps are from 2016, so it may be outdated. https://fivecorner.in/resource/lead_images/127/CRM%20API%20Documentation.pdf
2. **Push**: LeadSquared (webhook URL to set in the Housing.com account), NeoDove (PUSH, Housing.com team activates by email), Sell.do and Anarock ("Housing push integration"). **medium**. https://help.leadsquared.com/integrate-housing-com-with-leadsquared/ ; https://docs.neodove.com/integrations/housing.com-integration
3. LeadSquared's page also shows the pull as "Housing Id" + "Housing Secret Key", default every 3 hours, manual 7-day / 4,000 leads. **medium**. Leadrat says Housing.com "require[s] pull-type integration using username, password, and user ID", which contradicts the official doc (key + hash). The official doc wins; Leadrat is **low**. https://apidocs.leadrat.com/index.php/docs/technical-documentation-for-crm-api-integration-with-third-party-providers/
4. CSV / email alerts: not found.

**Auth (official doc)**: Housing.com issues a non-secret account `id` and a secret key K. Each request sends `hash` = HMAC-SHA256(key K, message = current epoch timestamp T as a string) hex digest, and `current_time` = T. A request is denied (401) if the hash is wrong or T is more than 15 minutes older than arrival. Request params: `start_date`, `end_date` (epoch seconds, mandatory), `current_time`, `hash`, `id`. Responses: 200 with leads, 422 for missing/badly formatted params, 401 unauthorised or delayed. No rate limit, pagination, window limit or retry rule is stated. **high**.

**Documented response fields (official doc)**: `lead_name` (string), `lead_phone` (string; example `987654321`, no country code shown), `lead_email` (string, may be empty or null), `project_id` (integer), `project_name`, `locality`, `lead_date` (epoch seconds). **There is no lead id.** **high**.

**Approval**: Housing.com issues id and key "on registration"; the document says to call them for help. A partner-style onboarding, no public self-serve. **high**.

**Timeliness**: pull only (poll interval ours). **Terms**: not verified.

### 6. Shiksha

Date checked 2026-10-04.

**Ways to get leads out**
- **Push**: LeadSquared: "Leads are obtained via webhook push from Shiksha.com"; the customer's Shiksha account manager sets the URL on Shiksha's side; "The API must be configured in Shiksha.com using the POST method". Paid feature on LeadSquared's side. **medium**. https://help.leadsquared.com/?p=16747
- **Email**: LeadSquared's marketing page says leads "that are emailed to you" are captured with no manual step, so an email alert exists. **low-medium**. https://www.leadsquared.com/shiksha-integration/ . Email format: not found.
- Pull API, CSV export, official Shiksha help page: **not found.**
- LeadsBridge lists Shiksha but the page is a waiting list (not available). Don't count it.

**Payload**: not found (LeadSquared lists default mappings but not the names). Meritto's field names that appeared in a search (`name`, `email`, `mobile`, `city`, `course`) are **Meritto's own receiving API**, not Shiksha's, and must not be assumed to be what Shiksha sends.
**Approval**: account manager. **Terms**: not verified.

### 7. Sulekha (if time allows: done at summary level)

- **Push**: LeadSquared generates the URL; customer asks the Sulekha account manager to configure it (method not specified). **medium**. https://help.leadsquared.com/integrate-sulekha-with-leadsquared/ ; corefactors/Teleduce guide says to "Send this displayed URL to the Sulekha team for configuration". **medium**. https://www.corefactors.ai/blogs/sulekha-crm-integration
- **Email**: an email alert exists for each enquiry (LeadSquared marketing text). Format: not found. **low**.
- Payload: **not found**. Pull / CSV: not found. Terms: not verified.

### 8. TradeIndia (if time allows)

- **Pull**: customer's own "My Inquiry API" (My Account > Inquiries > My Inquiry API) shows `User ID`, `Profile ID`, `API key`. LeadSquared and Kylas both pull with exactly those three. **medium**. https://help.leadsquared.com/integrate-tradeindia-with-leadsquared/ ; https://support.kylas.io/portal/en/kb/articles/how-to-integrate-kylas-crm-with-your-trade-india-account-to-capture-leads
- Endpoint and params (search result text, integrator): `https://www.tradeindia.com/utils/my_inquiry.html?` with `userid`, `profile_id`, `key`, `from_date`, `to_date`, 15-minute polling. **medium-low**. Response fields from the decoded vendor sheet: `rfi_id` (unique id), `sender_name`, `sender_mobile`, `sender_email`, `sender_city`, `sender_state`, `sender_co`, `product_name`, `message`. **low** (garbled decode).
- LeadSquared limits: default 15 minutes, manual 7-day / 4,000 leads. **medium**.
- TradeIndia's own help page on "My Inquiries" mentions no API, no export, no CRM integration, so the API is not described in the help centre I could read. **high** for that absence. https://www.tradeindia.com/about-us/help/my-tradeindia/my-inquiries/
- Approval: none stated. Terms: not verified.

### 9. Collegedunia, NoBroker, Quikr, CarDekho, Naukri (summary level)

- **Collegedunia**: no official or integrator mechanism found. NeoDove's marketing mentions an integration; no docs. **unverified**.
- **NoBroker**: nothing found. **unverified**.
- **Quikr / QuikrHomes**: LeadSquared "no longer support[s] the existing QuikrHomes connector" and points to its generic custom-source route. Leadrat lists "Quicker Homes" among supported portals without details. **low**. https://help.leadsquared.com/integrate-quikrhomes-with-leadsquared/
- **CarDekho**: NeoDove lists a CarDekho integration; the page text is generic and does not state push/pull. **low**.
- **Naukri (employer side)**: Greenhouse's official article documents a partner ATS integration: Naukri pushes job and candidate stage changes through four webhooks and Greenhouse pulls applications; requires a paid Naukri subscription with an integration module, a Zwayam Amplify API key from Naukri, and coordination with Naukri (amplify@zwayam.com). **medium-high** (Greenhouse doc). These are candidate applications, not sales leads. https://support.greenhouse.io/hc/en-us/articles/16297968058651-Naukri-integration . Not a fit for this connector set.

---

## (c) Recommended build order

The pattern across every portal except IndiaMART, Housing.com and TradeIndia is the same: **the portal's own team configures a sender toward a URL we give, and they choose the payload.** So the first thing to build is a very tolerant, authenticated inbound endpoint, then the three documented pull/push portals, then everything else as thin recipes on the same endpoint.

1. **Hardened generic PUSH receiver** (framework, not a portal). Accepts JSON, form-data, urlencoded and GET query strings (JustDial uses GET; Shiksha POST; Sell.do uses form-data), optional XML; per-connection unguessable token in the path (IndiaMART explicitly allows `/{Identifier}`); store raw body and headers first; always answer 200 fast and process async (IndiaMART times out at 10 s and deactivates after 48 h of failures); idempotent on `(source, external_id)`. Unlocks JustDial, 99acres, MagicBricks, Housing.com, Shiksha, Sulekha, and Collegedunia-class unknowns the moment a real sample payload exists.
2. **IndiaMART PUSH + PULL** (highest value, only fully documented, self-serve). Push for real time, Pull (every 10-15 min, 7-day windows, below the 5-per-minute cap) for backfill after activation and reconciliation when push is down.
3. **Housing.com PULL** (documented, signed pull; derive a dedupe key because there is no lead id).
4. **JustDial PUSH** (largest SMB demand; blocked on JustDial account managers, so start the customer checklist and capture a real payload from a pilot customer before freezing the mapping).
5. **TradeIndia PULL** (self-serve credentials, but verify the response against a real account first).
6. **MagicBricks and 99acres PUSH** (account-manager gated; capture real samples; add MagicBricks PULL if the customer holds a key). Skip 99acres username/password pull unless 99acres blesses it.
7. **Shiksha and Sulekha PUSH** (same receiver; need real samples).
8. **EMAIL_PARSE templates** for any portal where the account manager route stalls: build only from real alert emails supplied by customers. No public sample emails were found for any portal.
9. **Not now**: Collegedunia, NoBroker, Quikr, CarDekho (no mechanism found; route customers to the generic webhook or a relay and ask the portal's account manager what they offer), Naukri (candidate ATS partnership, different product).

---

## (d) What we need before building each

| Portal | From the customer | From us |
| --- | --- | --- |
| Generic PUSH receiver | n/a | Per-connection token generation and rotation, raw-event store, replay tool, test sender, setup instructions text |
| IndiaMART | Active paid seller account with the LMS Leads API add-on enabled (confirm plan inclusion with their rep); for Push: a registered mobile to receive the OTP, the ability to open Lead Manager > Import/Export Leads > Push API and paste our URL; for Pull: the CRM key from `seller.indiamart.com/leadmanager/crmapi` (sealed storage; warn them that regenerating the key breaks us) | A sandbox seller account if obtainable; use IndiaMART's Stoplight test tool and test listener; scheduler that respects 5 min / 5 per minute and 7-day windows; alert if push is silent for hours (48 h auto-deactivation) |
| JustDial | The JustDial account manager's contact; an email to them requesting that **our webhook URL be added with GET delivery**, plus a **sample payload / test lead**; a statement of which listing(s) | Customer-facing email template; a "waiting for JustDial to activate" status in the connector; test lead capture screen; confirm payload fields with a pilot before freezing the mapping |
| 99acres | Account manager contact; project names and project ids to map; a decision push vs pull | Ask 99acres (via a pilot customer's manager) for the official sender spec, a keyed pull option and the payload format; no storing portal passwords |
| MagicBricks | Account manager; MagicBricks Login ID; optional PULL API key | Same as 99acres; confirm the field names (`pid`, `project`, `remark`, `msg`, etc.) from a live test lead |
| Housing.com | Housing.com `id` and secret key (from their rep); confirmation the doc version still applies | HMAC-SHA256 signer with epoch clock sync (15 min tolerance); a derived dedupe key; ask Housing.com for current rate limits and whether a lead id exists now |
| Shiksha | Account manager request to POST leads to our URL; a sample lead | Sample payload before building the mapping; fallback email template if only email is offered |
| Sulekha | Account manager request; sample | As Shiksha |
| TradeIndia | `User ID`, `Profile ID`, API key from My Inquiry API | Verify the real response schema with a live account before building; polling every 15 min |
| Collegedunia / NoBroker / Quikr / CarDekho | A written answer from each portal's account manager on how leads can be exported (webhook, API, email, dashboard) | Do not build until that exists |
| Naukri | Out of scope | n/a |

Common to all: a **pilot customer per portal** who will forward a real alert / test lead and let us capture the first live payload; a **ToS review of each portal's terms** (only IndiaMART's has been read) before launch; opt-in consent text so the customer authorises us to receive their portal leads.

---

## (e) Proposed NormalisedLead mapping per portal

Target shape (from lead pipeline L-01): `externalId`, `receivedAt`, `fields{name, email, phone, message, city, product}`, `attribution{platform, campaign, form}`, `raw`.
Status labels: **DOCUMENTED** = field names come from the portal's own document. **PROPOSED** = field names come from integrator docs or are unconfirmed; they must be verified against a real payload before shipping.
Phones: normalise to E.164 using a per-connection default country code (+91) when the portal sends no country code. Times: convert to UTC; assume IST (+05:30) where the portal publishes no zone and say so in the connector settings.

### IndiaMART (field names DOCUMENTED; the mapping itself is our design)

| NormalisedLead | Source | Notes |
| --- | --- | --- |
| externalId | `UNIQUE_QUERY_ID` | Same id in push and pull; use for dedupe across both |
| receivedAt | `QUERY_TIME` | e.g. `2024-04-10 11:17:14`; pull docs say IST; push doc does not state a zone, assume IST |
| name | `SENDER_NAME` | "IndiaMART Buyer" is the placeholder when unknown; treat as no name |
| email | `SENDER_EMAIL` | At least one of mobile/email always present; alt: `SENDER_EMAIL_ALT` |
| phone | `SENDER_MOBILE` | Example `+91-9999999999`; strip hyphen; fall back to `SENDER_PHONE`, `SENDER_MOBILE_ALT` |
| message | `QUERY_MESSAGE` (+ `SUBJECT`) | Un-escape `\n`, `\t` |
| city | `SENDER_CITY` | Also keep `SENDER_STATE`, `SENDER_PINCODE`, `SENDER_COUNTRY_ISO` as extra fields |
| product | `QUERY_PRODUCT_NAME` (fallback `QUERY_MCAT_NAME`) | |
| attribution.platform | constant `indiamart` | |
| attribution.campaign | `QUERY_TYPE` mapped W=direct enquiry, B=buy-lead, P=PNS call, BIZ=catalog view, WA=WhatsApp | PROPOSED use of this field as "campaign"; alternative is a separate `leadType` |
| attribution.form | `QUERY_MCAT_NAME` | PROPOSED |
| extra | `SENDER_COMPANY`, `SENDER_ADDRESS`, `CALL_DURATION`, `RECEIVER_MOBILE` | Keep in `raw`; promote company to the contact's organisation |

### JustDial (PROPOSED: fields from one integrator sheet, no official doc)

| NormalisedLead | Source | Notes |
| --- | --- | --- |
| externalId | `leadid` | Verify it is stable per lead and not per call |
| receivedAt | not found (a date/time field was not documented) | Use **our receive time** and flag `receivedAtApproximate` until a real payload shows a timestamp |
| name | `name` | |
| email | `email` | |
| phone | `mobile` | Phone format and country code unknown |
| message | not found | JustDial leads may carry no free text; `category` is the closest context |
| city | `city` (also `brancharea`, `pincode`) | |
| product | `category` | |
| attribution.platform | constant `justdial` | |
| attribution.campaign / form | not found | Leave empty; `company` is the customer's own business name, do not use |

### 99acres (PROPOSED: no official payload; two vendor shapes shown)

| NormalisedLead | Source A (push to an Anarock-style receiver, `low-medium`) | Source B (pull sheet, `low`) |
| --- | --- | --- |
| externalId | none documented in push; derive hash of phone + `project_id` + time | `QueryId` |
| receivedAt | not found; use our receive time | not found; use our receive time |
| name | `name` | `Name` |
| email | `email` | `Email` |
| phone | `country_code` + `phone` | `Phone` |
| message | `remarks` | `QryInfo` |
| city | `city` (also `locality`) | not found |
| product | `project_name` (with `project_id`) | not found |
| attribution | platform `99acres`; form = `project_id` | platform `99acres` |

### MagicBricks (PROPOSED)

| NormalisedLead | Push params at 365CRM (`medium`) | Pull sheet (`low`) |
| --- | --- | --- |
| externalId | none documented; derive hash of mobile + `pid` + receive time | `id` |
| receivedAt | not found; use our receive time | not found |
| name | `name` | `name` |
| email | `email` | `email` |
| phone | `mobile` | `mobile` |
| message | `remark` | `msg` (+ `subject`) |
| city | not found | `city` (+ `address`) |
| product | `project` | not found |
| attribution | platform `magicbricks`; form = `pid` (property id); `source`, `responsetype`, `account` into `raw` | platform `magicbricks` |

### Housing.com (field names DOCUMENTED in Housing.com's own doc; mapping is ours)

| NormalisedLead | Source | Notes |
| --- | --- | --- |
| externalId | **none provided** | PROPOSED: `sha256(lead_phone + project_id + lead_date)` |
| receivedAt | `lead_date` | Epoch seconds, so unambiguous; convert to UTC |
| name | `lead_name` | |
| email | `lead_email` | May be empty or null |
| phone | `lead_phone` | Example has no country code; apply +91 default |
| message | not provided | |
| city | `locality` is the project's locality, not the buyer's city; PROPOSED: map to a `locality` extra, leave city empty | |
| product | `project_name` (and `project_id`) | |
| attribution | platform `housing`; form = `project_id` | PROPOSED |

### Shiksha, Sulekha, Collegedunia, NoBroker, Quikr, CarDekho

**Not mappable yet: no payload found.** Proposed handling: store the raw event, show a field-mapping screen driven by the first real payload (the generic receiver can offer "pick which key is the name/phone"), and ship the recipe only after a pilot customer supplies a sample. For Shiksha and Sulekha, attribution.platform would be constants `shiksha` and `sulekha`; for Shiksha the course the lead asked about is expected to map to `product` and the campaign to the course/institute (PROPOSED, unconfirmed).

### TradeIndia (PROPOSED: field names from a decoded vendor sheet)

| NormalisedLead | Source |
| --- | --- |
| externalId | `rfi_id` |
| receivedAt | not found in my read; use our receive time until confirmed |
| name | `sender_name` |
| email | `sender_email` |
| phone | `sender_mobile` |
| message | `message` |
| city | `sender_city` (+ `sender_state`) |
| product | `product_name` |
| attribution | platform `tradeindia`; company `sender_co` into extras |

---

## Cross-cutting findings that change the design

1. **No portal documents a signature header for push.** IndiaMART documents none; others are unknown. Authenticity = unguessable per-connection URL path, payload-shape validation, and optionally the sender's IP once a portal tells us (nobody documented IP ranges).
2. **Idempotency**: only IndiaMART (`UNIQUE_QUERY_ID`), JustDial (`leadid`, unverified), TradeIndia (`rfi_id`, unverified), MagicBricks pull (`id`, unverified) and 99acres pull (`QueryId`, unverified) show an id. Housing.com's official response has none, so a derived key is mandatory. Default to a derived hash when no id is present.
3. **Timestamps are the weak spot**: JustDial and the real-estate pushes show no timestamp field in anything I read. Store both `receivedAt` (portal) when present and our own receive time.
4. **Human gating**: JustDial, 99acres, MagicBricks, Housing.com push, Shiksha, Sulekha all need the customer to ask an account manager. Build the status states "URL shared / waiting for portal / first lead received" so the customer can see progress.
5. **Scraping is never the only route for the six core portals**: each has an official push or pull route (even if gated). We do not use scrapers, unofficial endpoints, or stored portal passwords. For Collegedunia, NoBroker, Quikr and CarDekho no official route was found; the fallback is the portal's manual dashboard export (the customer uploads a file) or whatever their account manager offers. Do not scrape their dashboards.
6. **Pull windows are small**: IndiaMART 7 days max (and 365 days history), LeadSquared's pulls for 99acres, Housing.com and TradeIndia cap manual syncs at 7 days / 4,000 leads. Design the poller around windows (cursor = last end time minus overlap), not pagination.

---

## Sources (all fetched 2026-10-04)

Portal-owned:
- https://help.indiamart.com/knowledge-base/lms-crm-integration-v2
- https://help.indiamart.com/knowledge-base/integration-of-indiamarts-lead-manager-crm-push-api-with-third-party-crms-real-time-push-of-leads
- https://help.indiamart.com/knowledge-base/im-lms-leads-api
- https://help.indiamart.com/knowledge-base/export-enquiry
- https://help.indiamart.com/article-categories/selling-on-indiamart/lead-manager/crm-integration
- https://www.indiamart.com/terms-of-use.html
- https://fivecorner.in/resource/lead_images/127/CRM%20API%20Documentation.pdf (Housing.com's developer document, third-party-hosted copy)
- https://www.tradeindia.com/about-us/help/my-tradeindia/my-inquiries/ (no API mentioned)
- https://www.99acres.com/lmsSearch (not an API)

Integrator / vendor:
- LeadSquared help: JustDial https://help.leadsquared.com/integrate-justdial-with-leadsquared/ ; 99acres https://help.leadsquared.com/integrate-99acres-with-leadsquared/ ; MagicBricks https://help.leadsquared.com/integrate-magicbricks-with-leadsquared/ ; Housing https://help.leadsquared.com/integrate-housing-com-with-leadsquared/ ; Shiksha https://help.leadsquared.com/?p=16747 ; Sulekha https://help.leadsquared.com/integrate-sulekha-with-leadsquared/ ; TradeIndia https://help.leadsquared.com/integrate-tradeindia-with-leadsquared/ ; IndiaMART https://help.leadsquared.com/integrate-indiamart-with-leadsquared/ ; QuikrHomes https://help.leadsquared.com/integrate-quikrhomes-with-leadsquared/
- Kylas: https://support.kylas.io/portal/en/kb/articles/how-to-integrate-justdial-to-get-leads-in-kylas-crm ; https://support.kylas.io/portal/en/kb/articles/how-to-integrate-kylas-crm-with-your-trade-india-account-to-capture-leads ; https://kylas.io/crm-productivity/sales-crm/justdial-lead-integration-in-kylas-everything-you-need-to-know ; https://kylas.io/integrations/leadgeneration
- NeoDove: https://docs.neodove.com/admin-portal/integrations/99acres-integration ; https://docs.neodove.com/admin-portal/integrations/magicbricks-integration.md ; https://docs.neodove.com/integrations/housing.com-integration
- 365CRM: https://www.365crm.io/magicbricks ; https://www.365crm.io/just-dial ; https://www.365crm.io/tradeindia
- Anarock (own receiver specs, via search text): https://support.anarock.com/support/solutions/articles/35000226722-99acres-push-integration ; https://github.com/anarock/leads
- Sell.do (via search text; pages 404 for me): https://support.sell.do/support/solutions/articles/6000068700-99acres-integration ; https://support.sell.do/support/solutions/articles/6000068690-magicbricks-integration ; https://support.sell.do/support/solutions/articles/6000164906-housing-integration
- Leadrat: https://apidocs.leadrat.com/index.php/docs/technical-documentation-for-crm-api-integration-with-third-party-providers/
- Odoo MagicBricks app: https://apps.odoo.com/apps/modules/16.0/sp_crm_magicbricks_integration
- Pabbly: https://www.pabbly.com/automatically-add-justdial-leads-to-your-crm/ ; https://www.pabbly.com/how-to-send-indiamart-leads-to-other-applications-using-api-by-pabbly-connect/ ; https://www.pabbly.com/integrating-magicbricks-leads-into-zoho-crm-using-pabbly-connect-a-step-by-step-guide/
- Sulekha: https://www.corefactors.ai/blogs/sulekha-crm-integration
- Naukri: https://support.greenhouse.io/hc/en-us/articles/16297968058651-Naukri-integration
- CRM vendor "Marketplace to CRM" sheet (decoded, low): https://assets.skool.com/f/c4611084c2ce4f41ac3ed0262e49531c/a57e17d0fac84f49a1912504fb3dcb3430bedcc4abbd4442a7a6df2694e19bbf
- 99acres pull guide (title only readable): https://www.scribd.com/document/736665708/99Acre-Pull-API

Could not be read (so nothing is claimed from them): JustDial terms of use, MagicBricks site, 99acres Q&A page (403), Anarock support pages (SSL failure), Sell.do support pages (404), Zapier IndiaMART app page (404).
