# Runbook: lead portal setup, per customer (support guide)

For support and customer success. What a customer does, portal by portal, to bring their enquiries into the workspace through the Marketplace
(Marketplace > Lead sources), what we see on our side, and how to fix the usual problems. The research behind it, with sources, is
[docs/specs/lead-portals-feasibility.md](../specs/lead-portals-feasibility.md) (checked 2026-10-04); how the connectors work is in
[docs/api/marketplace.md](../api/marketplace.md); how a recipe is written is in [marketplace-publish-listing.md](marketplace-publish-listing.md), section 9.

**Read this first.** Nothing here has run against a real portal account: the connectors follow what each portal documents (or what other CRM vendors
document) and are tested against fakes of them. Every step below carries one of these marks, and you should say the same to the customer:

| Mark           | Meaning                                                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **VERIFIED**   | the portal's own help page or developer document says it (read 2026-10-04)                                                                                    |
| **REPORTED**   | CRM vendors (LeadSquared, Kylas, NeoDove, 365CRM, Sell.do, Odoo and others) document it; the portal's own text was not seen                                   |
| **UNVERIFIED** | nothing usable was found, or it is our assumption; it is written in the step so nobody mistakes a guess for a fact. Ask the customer to tell us what they see |

## What the customer sees, and what it means

| Where                              | What it shows                                                                                                                                                                                                              |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Marketplace card and app page      | **Beta** or **Needs portal setup** and one sentence of what that means. IndiaMART carries neither badge (documented by IndiaMART); its sentence still names the add-on and the 48 hour rule                                |
| Install                            | the permission list ("Add leads"), then the fields the portal needs (a key) or none (JustDial and the other push portals), then the address                                                                                |
| The private address (push portals) | shown **once**, with a copy button and a ready-made message for the portal's account manager. It is also the connection's password. Lost: Manage > **Create a new address** (the old one stops at once)                    |
| Manage > Connection                | status (active, paused, error), health, last sync, next poll and "fetched up to" (polling portals), counters (received, accepted, duplicates, failed), last error, **Sync now**, **Test connection**, **Send sample lead** |
| Manage > Recent events             | one line per lead: when, outcome (accepted, duplicate, failed), the portal's lead id, the reason                                                                                                                           |
| Waiting for the first lead         | a push portal that has not delivered anything yet: the portal's team has not switched it on (or it is not yet sending). The connection is fine                                                                             |

**Health** `healthy`: the last poll or delivery worked. `degraded`: three failures in a row, or the portal is slow or refusing for now (the message says which);
nothing to do unless it lasts. `needs_reauth`: the portal refused our key; enter a new one (Manage > Credentials) and the connection restarts at once.
`error`: something that retrying cannot fix; the message says what.

**Counters.** `received` counts leads that came in, `accepted` the ones added to the workspace, `duplicates` a lead the connection had already (a push sender that
retried), `failed` leads we could not read or store, with the reason. A lead the scheduled read fetches again because the windows overlap is not counted again.

## IndiaMART (push and pull, one listing)

**The customer needs** (VERIFIED, `help.indiamart.com`): a paid seller account with IndiaMART's leads API ("IM Leads API") switched on. It is an add-on to the plan
and cannot be bought alone; only paid sellers can generate a key. A search summary said it is free on Leader and Star plans: UNVERIFIED, ask their IndiaMART
representative. IndiaMART's technical team gives no hand-holding: the customer does this themselves.

1. **Install** the IndiaMART listing. It asks for the **CRM key**.
2. **Generate the key** (VERIFIED): sign in to IndiaMART, Lead Manager, the CRM API page (`seller.indiamart.com/leadmanager/crmapi`), Generate Key, paste it into the CRM key
   field. Warn them: generating a **new** key later stops the old one (we then show "key rejected": enter the new one), and a key not used for 7 days expires (we use it
   every 15 minutes, so this only happens if the connection stays paused).
3. **Turn on real-time delivery** (VERIFIED): after installing, copy the private address that is shown once. In IndiaMART: Lead Manager, the three-dots menu, **Import/Export
   Leads**, **Push API**, choose a CRM from the list or **Other**, paste the address, confirm with the OTP sent to the registered mobile number. From then on IndiaMART
   POSTs each enquiry (JSON, answered within 10 seconds) and retries until we accept it.
4. **Test**: Manage > **Test connection** makes one real request to IndiaMART (it counts toward IndiaMART's own limit of one request per key every 5 minutes: do not press it
   repeatedly). **Send sample lead** shows how an enquiry maps. IndiaMART also has a test tool and a test listener for the Push API (see the research doc); not needed for us.

**What we read.** Every 15 minutes (IndiaMART allows one request every 5 minutes; a key used more than 5 times in a minute is blocked for 15 minutes) we ask for the leads of
the window since the last read, up to 6 days at a time (IndiaMART's limit is 7), in IST. The first read after installing goes back one day: IndiaMART's Push API has no
history before it is switched on, so older enquiries are not imported. Enquiry types: direct (W), buy lead (B), call (P), catalog view (BIZ), WhatsApp (WA). IndiaMART leaves out
unconnected call attempts, catalog views within 7 days of an active conversation, replies and callbacks (VERIFIED).

| Symptom                                          | Cause and what to do                                                                                                                                                                                     |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "IndiaMART refused the CRM key" (`needs_reauth`) | the key was regenerated or never valid. Generate a new key, Manage > Credentials, enter it. The connection restarts by itself                                                                            |
| "Expired because it was not used for 7 days"     | the connection was paused for a week. Same fix                                                                                                                                                           |
| "Blocked the CRM key for 15 minutes"             | the key was used too often (another tool with the same key, or Test pressed repeatedly). We wait 15 minutes by ourselves                                                                                 |
| Push delivers nothing, the poll works            | the address was not saved in IndiaMART (the OTP step), or Push was switched off after 48 hours of failures. Re-enter it in Lead Manager; check Recent events                                             |
| IndiaMART says Push is deactivated               | it deactivates after 48 hours in a row of refusals (VERIFIED). We always answer at once, so look for a paused or killed connection, or an address pasted wrongly or from before a "Create a new address" |
| Name shows empty                                 | IndiaMART sends the placeholder "IndiaMART Buyer" when it does not know the name; we treat it as no name                                                                                                 |
| A lead is missing                                | check the type (excluded by IndiaMART, above). Press **Sync now**; leads before the key was generated are available only 24 hours after generation (VERIFIED)                                            |

UNVERIFIED for IndiaMART: that error answers keep HTTP 200 with the status in the body (we read both), the exact wrapper of a pulled list (a `RESPONSE` array), and latency.
IndiaMART's terms prohibit scraping the seller panel (VERIFIED, section VI): we use only its two official APIs, and never scrape.

## Housing.com (pull, signed)

**The customer needs** (VERIFIED, Housing.com's "Developer's CRM Integration Document", a third-party-hosted copy whose samples date from 2016): an **ID** and a **secret key**
that Housing.com issues when it registers the builder for lead delivery. There is no self-service page: ask the **Housing.com account manager**.

1. Ask the account manager for the ID and the secret key for CRM integration (their document calls it "Developer's CRM Integration Document").
2. **Install** the Housing.com listing and enter the ID and the secret key.
3. **Test connection**.

**What we read.** Every 30 minutes, with a signature: Housing.com wants the current time and the HMAC-SHA256 of it with the key, and refuses a request whose time is more than 15
minutes from its own clock (VERIFIED). A lead carries the name, phone, email (may be empty), the project (id and name), the project's locality and the date; **there is no message
and no lead id**: we recognise a lead by phone, project and date. Housing.com's locality is the project's, not the buyer's city, so the city stays empty.

| Symptom                           | Cause and what to do                                                                                                         |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| "Housing.com refused the request" | wrong ID or key (ask the account manager again), or **this server's clock is off by more than 15 minutes**: tell engineering |
| Nothing arrives, no error         | check **Fetched up to** moves on; Housing.com may have registered the account for another project list                       |
| The same buyer twice              | two enquiries on different times are two leads (by design); a repeat with the same phone, project and time is one            |

UNVERIFIED: whether the 2016 document is still current (ask Housing.com), any rate limit (none is stated), the shape of the answer (the document lists the fields; we read a bare list
or an object holding one list), and whether a lead id exists now. Housing.com also pushes to a CRM's address when its team configures it (REPORTED by LeadSquared, NeoDove, Sell.do,
Anarock); there is no push listing for it yet (backlog BL-082).

## TradeIndia (pull, beta)

**The customer needs** (REPORTED by LeadSquared and Kylas): the three values of their own **My Inquiry API** page: My Account, Inquiries, My Inquiry API shows the **User ID**, the **Profile
ID** and the **API key**. TradeIndia's own help page about inquiries mentions no API at all (VERIFIED absence), so tell the customer it is a beta.

1. **Install** the TradeIndia listing and enter the three values. 2. **Test connection**. If it fails or the leads look wrong, collect the message and one example and send it to engineering:
   the mapping is adjusted from it.

**What we read.** Every 15 minutes, whole days in Indian time (`from_date`, `to_date` as `YYYY-MM-DD`: **UNVERIFIED**, the format is our assumption), each inquiry with an id (`rfi_id`), name,
mobile, email, company, city, state, product and message (REPORTED, from a vendor sheet that was partly garbled: re-check against the first real answer). No inquiry time was found, so a lead is dated with
the time we received it.

## JustDial, 99acres, MagicBricks, Shiksha, Sulekha (push, set up by the portal's own team)

These portals have no setting the customer can change and publish no developer documents: **their account manager (or backend team) adds the customer's CRM address on the portal's side**
and chooses what to send (REPORTED by every integrator; the portals' own text was not read). So the work is a request, and then waiting.

1. **Install** the listing. It asks for nothing. Copy the **private address** shown once (with the copy button) and the message to the account manager (the page has a button for it).
2. **Send the message** to the portal's account manager, using the template below. Keep the customer's copy.
3. The connection page says **Waiting for the first lead**. It does not mean we are broken. Typical waits are days (REPORTED); ask the customer to chase their account manager, not us.
4. When the portal sends a **test lead**, it appears in Recent events. Check name, phone, email and message landed in the right place (Contacts, the lead). If a field is missing or wrong,
   **ask the customer for the sample** (the raw message or a screenshot of the test lead from the portal) and send it to engineering: the mapping is adjusted from a real example.
5. Press **Send sample lead** only to see how a typical lead looks: it is our sample, not the portal's.

| Portal      | Method and format (REPORTED)                                                                              | What to put in the email besides the address                                                                        | Field names we read (PROPOSED, check with a real lead)                                                                   |
| ----------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| JustDial    | **GET** with a query string (LeadSquared: "must be configured using the GET method"); we also accept POST | "deliver leads with GET"; ask for a sample lead and a test lead                                                     | `leadid`, `name`, `mobile`, `email`, `company`, `city`, `brancharea`, `pincode`, `category`; no time field was found     |
| 99acres     | the sender is configured by the account manager; JSON, a form or XML are accepted                         | the **project names and the 99acres project ids** to include; **never** the customer's 99acres username or password | `name`, `email`, `phone` with `country_code`, `project_name`, `project_id`, `city`, `locality`, `remarks`; no time field |
| MagicBricks | the account manager issues a sender per CRM; POST or GET, JSON, a form or a query string                  | the customer's **MagicBricks Login ID**, "PUSH integration", the CRM address                                        | `name`, `mobile`, `email`, `remark`, `project`, `pid`, `source`, `responsetype`, `account` (from one vendor); no time    |
| Shiksha     | **POST** (LeadSquared: "must be configured using the POST method"); JSON or a form                        | "deliver leads with POST"; ask for a test lead                                                                      | not published; `name`, `email`, `mobile`, `city`, `course` are read if present                                           |
| Sulekha     | the account manager configures it (method not stated); JSON, a form, a query string or XML are accepted   | ask for a test lead                                                                                                 | not published                                                                                                            |

**Email template** (the page offers it with the address filled in):

> Subject: Please send my leads to my CRM
>
> Hello, I use a CRM and would like my leads from your portal (account: `<account or Login ID>`) delivered to this private web address:
> `<the address>`. Please use the `<GET / POST>` method and send each lead as it arrives. Could you also send one test lead, and tell me which fields you send (a sample would be
> ideal)? Thank you.

**Email alerts are not read.** JustDial, Shiksha and Sulekha also email alerts (REPORTED), and 99acres and MagicBricks may; reading alert emails needs the Email channel, which does not exist yet
(`email_parse` is not available). If a portal's team will not set up the address, the customer has to wait for that channel or ask the portal for another route; do not forward emails to us.

| Symptom                                         | Cause and what to do                                                                                                                                                    |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Waiting for the first lead for days             | the portal's team has not added it. Check the customer sent the address (not the page URL); ask them to confirm with the portal                                         |
| The portal says the address is not working      | ours answers 200 to a delivery with the right secret, and 401 without it. A GET without the secret segment is refused: the address must be complete, with the last part |
| Recent events show failures                     | open the reason. "not valid XML/JSON": the portal sends something we do not read (ask for a sample). "unreadable": the same                                             |
| Leads arrive without a time                     | expected for these portals (no time field found): the lead carries the receive time and a flag saying so                                                                |
| Everything stopped after "Create a new address" | the portal still has the old address. Send the new one to the account manager                                                                                           |

## Before a portal goes to real customers, per portal

This is what each connector still needs (the backlog items BL-080 onward have the detail): a **pilot customer** whose account manager sends a real test lead, so the first live payload is captured
(with the customer's consent) and the proposed mapping is replaced by a real one; a **terms-of-use review** (only IndiaMART's terms were read: it prohibits scraping, and we do not scrape);
the **opt-in text** by which the customer authorises us to receive the portal's leads (the consent step lists the permission "Add leads"); and for **Housing.com and TradeIndia** a real account to check the
signature, the date format and the answer shape. Until a portal has produced a real lead through the connector, say "beta" or "needs portal setup" to the customer, as the listing does.

## What we never do

We never ask for or store a portal username or password (99acres' pull works that way for other CRMs; we do not use it). We never scrape a portal's pages or its seller panel. We never
read a customer's mailbox. A key a customer gives us is sealed, never shown again and never in a log or an audit row.
