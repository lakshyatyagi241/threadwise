---
id: privacy-requests
title: Data requests (export and erase)
summary: Answer people who ask what you hold on them: check their identity, export their data, or erase it with a preview and a proof.
area: settings
order: 30
documents: [tile:privacy-requests]
keywords:
  [
    privacy,
    gdpr,
    data request,
    dsar,
    subject access,
    export,
    erase,
    erasure,
    delete personal data,
    right to be forgotten,
    legal hold,
    restricted,
    investigation,
    retention,
    proof,
    sla,
    deadline,
  ]
---

## What it is for

People can ask what data you hold on them, ask for a copy, or ask you to delete it. Each ask is a **data request**. This screen keeps every request in one place with its deadline, the identity check, what was exported or erased, and a proof you can keep. Open **Settings**, then **Data requests** under Security.

## Types of request

- **Access**, **Export** and **Portability** end in a file. You prepare an export and download it.
- **Erasure** deletes the person's data after a preview and a typed confirmation.
- **Rectification**, **Restriction**, **Objection** and **Withdrawal of consent** are handled by hand. Record what you did, then mark the request as completed.

## Starting a request

1. Select **New request**.
2. Find the person by name, phone or email. If they are not saved as a contact, type their phone number or email instead.
3. Choose what they ask for.
4. Pick how the request reached you, add an optional internal note (no personal details), and for an erasure choose what happens to their conversations: delete them, or keep them without the person's identity.
5. Select **Create request**.

You can also start from a contact's page: the **Privacy** menu has **Export this person's data** and **Erase this person**. Both open a request for that contact.

## The deadline

Every request has a deadline, 30 days after it arrives unless you change it. The list shows the days left, or the days overdue in red. Managers can change the number of days under **Settings** on the list (1 to 90).

## Verify the person

Before you export or erase, check that the person asking is who they say they are. On the request, choose how you checked, enter an **evidence reference id** (a ticket number or a message id), and record the outcome: check started, verified, or not verified. Enter a reference id only. Never upload documents or copy personal details into this field. A person who is not verified has their request rejected.

## Legal hold on a request

If you need to pause one request, open it and place a hold with a short reason. While it is on, that request cannot be erased. Release the hold to continue. This pauses the request only; the person's data is not locked.

## Legal holds on people

Erasure is not absolute. If you must keep a person's data for a legal obligation, a claim or dispute, a regulator or law-enforcement request, or an internal investigation, place a **legal hold** on that person. Open **Settings**, then **Data requests**, and use the **Legal holds** tab to see every hold.

### Place a hold

1. Open the contact and choose **Place legal hold...** in the **...** menu, or use **Place legal hold...** on the Legal holds tab and find the person by name, phone or email. Only people who manage data requests see these.
2. Choose why the data is kept, enter your own **case reference** (a court file, a ticket or a regulator letter number), and add a review date and an end date if you know them.
3. Do not write names, numbers or details of the matter in the note.
4. Select **Place hold**.

A banner on the contact reads **Legal hold: erasure and deletion paused**. Only people who can read data requests see it. For everyone else the contact looks as before.

### What a hold does

- The person's erasure is not executed. Their request shows **Restricted: legal hold** and keeps its deadline. If someone confirms the erasure while the hold is on, nothing is erased: the confirmation is kept.
- Deleting the contact, bulk deletes, merging it away as a duplicate, and the automatic clearing of recordings, form answers, lead payloads and scoring logs skip or refuse this person. An import will not overwrite them.
- Marketing messages, AI processing (company briefs, the copilot, lead scoring) and exports of their data are restricted. Opening the contact is logged.
- Normal service goes on: you can answer the person, send service messages, edit the record and take payments.

A hold on **the whole workspace** (choose it in the same dialog) does the same for every person and also stops the removal of a lapsed workspace.

### The answer to the person

A restricted request shows the text to send: it says the data is kept under a legal obligation and will be erased when it ends, and it never says why. Select **Copy text**. Your counsel can replace the wording under **Settings** on the Data requests list. Have counsel confirm the wording for your country.

### Review, extend, release

- **Review** records that you looked at the hold again, and the next review date. Holds past their review date are flagged.
- **Extend** changes the dates or adds a further case reference to the same hold. A person has one hold at a time.
- **Release** ends the hold. Requests waiting on it leave the restricted state, and an erasure someone already confirmed runs by itself within a minute. A hold with an end date is released on that date.
- **Export CSV** saves the register for auditors.

## Export

**Prepare export** builds a ZIP file with the data you hold on the person. When it is ready, select **Download**. The file stays available for 7 days and is then deleted. Nothing is sent to the person: download the file and give it to them through a safe channel.

## Erase

1. Select **Preview**. It lists, module by module and table by table, how many rows would be deleted, anonymised, cascaded, retained or unlinked, and how many stored files would be deleted. Nothing changes.
2. Type the phrase `ERASE` followed by the request reference, exactly as shown (for example `ERASE DSR-3F9A12BC`). The button stays disabled until it matches.
3. Select **Erase now**. This cannot be undone.

Erasure needs the permission to execute erasures, a verified identity, and no legal hold. If the person is under a legal hold, the confirmation is kept and nothing is erased until the hold ends.

### Copies made from the person's records

Temporary copies built from the person's records do not outlive the erasure. Revenue report files that are still available (they are kept 7 days at most) are deleted when a customer is erased, because a file does not record whom it lists, and so are the AI account briefs of the companies the person belongs to. Staff members who are deleted take with them the report files they prepared and the briefs they generated. Invoices and payments are kept for the statutory period with the buyer replaced, and the audit log is kept. Both kinds of copy can be created again from the records that remain.

### The proof

After an erasure the request shows a **proof**: the totals, what was done per table, the registry digest, a SHA-256 and the limits of the erasure, such as backups. Select **Download proof** to save it as a JSON file. The proof contains no personal data.

## Rejecting or completing

Select **Mark as completed** when the person has been answered or the work was done by hand. To refuse a request, give a reason and select **Reject request**.

## Deleting a contact

Deleting a contact from the contacts list or their profile now erases their conversations, messages, media, files, call recordings and call logs as well. Leads, deals, tasks and invoices stay. The confirmation says so, and offers a checkbox, **Keep conversation history without the person identity** (unchecked by default), to keep the conversations while removing the link to the person.

## Permissions

- **privacy.requests.read** lists and opens requests.
- **privacy.requests.manage** creates requests, records verification and holds, prepares and downloads exports, rejects, completes, and changes the deadline.
- **privacy.erase.execute** runs the erasure.

## If something looks wrong

- **No Preview button, only a note**: verify the identity and release any hold on the request first, then open the request again.
- **The request says Restricted: legal hold**: the person's data is kept on purpose. Release the hold from the Legal holds tab when the reason ends.
- **A contact cannot be deleted**: it is protected by a legal hold. People who manage data requests can see the banner on the contact.
- **The export stays on Building**: wait a moment; the list refreshes by itself. If it fails, prepare a new one.
