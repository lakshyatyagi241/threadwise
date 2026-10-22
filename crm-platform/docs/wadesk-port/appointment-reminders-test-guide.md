# Appointment reminders: test guide for the deployed site

For the team to verify the reminder report, history, test email, packs and the upgrade-tier gating on the deployed site.

**Honest status: nothing in this guide was run in a browser by the person who wrote the code.** The code was checked by typecheck, unit tests, DOM tests (jsdom) and API
end-to-end specs against a real database with a fake customer messenger. No real Meta template approval, no real WhatsApp message and no real email delivery was seen.
Treat every "expected" below as a claim to confirm, and report what differs.

Operator background and the permission matrix: [docs/api/appointment-reminders-packaging.md](../api/appointment-reminders-packaging.md).

## 0. Set up three workspaces

You need to see the locks, so one workspace must be on a plan WITHOUT the two upgrade flags.

| Workspace | Plan (operator console, Plans, Features tab)                         | Appointments app | Why                                            |
| --------- | --------------------------------------------------------------------- | ---------------- | ---------------------------------------------- |
| **A**     | a plan with `Appointment reminders: Confirm / Reschedule / Cancel buttons` and `Appointment reminders: rebook (recall) steps` both **on** | installed, running | the full upgrade tier                          |
| **B**     | a plan with both of those flags **off** (for example the seeded Starter) | installed, running | sees every lock, still gets the included parts |
| **C**     | any plan                                                              | **not** subscribed/installed | nothing of Appointments is visible             |

How to set the flags in the operator console:

1. Open `/admin/workspace-plans`, find the workspace, and use **Edit**, then **feature overrides**.
2. For **A**: set `appointment_booking`, `appointment_confirm_buttons` and `appointment_rebook_steps` to on.
3. For **B**: set `appointment_booking` to on and `appointment_confirm_buttons` and `appointment_rebook_steps` to **off** (an explicit off override beats the plan, so B shows every lock even on a plan row that has no entry for them).
4. Alternatively give B a real plan without the two flags (Plans, the plan, Features tab, both switched off), and leave the overrides empty. A workspace override always wins over the plan.
5. Reload the app in the workspace after changing an override.

Notes:

- The app flag is `appointment_booking` (the Appointments app in the Marketplace). It must be installed and running in A and B. The app listing grants only `appointment_booking`;
  the two upgrade flags are per-plan switches and are **not** added by subscribing to the app.
- Plans without a catalogue row for the workspace's plan slug lock nothing (everything reads open). Use a plan that really exists in Plans, or a workspace override
  (workspace page, feature overrides) to force `appointment_confirm_buttons` and `appointment_rebook_steps` off in B.
- Platform-owned workspaces have everything on, so do not use one for B.
- Connect a WhatsApp Cloud API number in A to test templates; without one packs create no WhatsApp message and every step uses email. Email: switch email on under
  Appointment settings, Message channels.
- Roles: test as an **Admin**, and once as a user whose role has only `View booking types` (no edit) to check the read-only behaviour.

## 1. What your plan includes (B, as Admin)

1. Open **Settings**, **Appointment settings**, **Reminders and follow-ups**. Open a booking type, select **Add step**.
2. **Expected:** you can add every step. **Rebook message, some days later** is listed with "Upgrade tier: not in your plan". The card of a rebook step says it is part of the Appointments upgrade tier, its **On** switch is disabled, and an **Upgrade your plan** link goes to `/account/plans`.
3. Add or open a **24 hour reminder**, **Message and channels**. **Expected:** the switch "Add Confirm, Reschedule and Cancel buttons (WhatsApp)" is shown **disabled** with the upgrade-tier sentence and the link. "Skip this step if the customer already confirmed" is still usable.
4. Open Help (the question mark), find **Reminder buttons and rebook messages on your plan**. **Expected:** it lists what the app includes and the two upgrade parts. In A the guides **Confirm, Reschedule and Cancel buttons** and **Rebook messages** also show; in B they do not (their plan feature is off), but the plan guide does.

In **A** the same switches are enabled.

## 2. The API says 422 (B)

Optional, for someone with API access. As B's admin, `PATCH /v2/booking-types/<id>` with a reminder `{ "stepKind": "rebook", "kind": "after", "offsetMinutes": 43200, "isActive": true, "channels": ["email"] }`.
**Expected:** 422 with code `PLAN_FEATURE_LOCKED` and a sentence about the Appointments upgrade tier. The same step with `"isActive": false` saves. Same for `buttonsEnabled: true` on a 24 hour reminder.

## 3. Ready-made sequences (B, then A)

1. In B, open a booking type, **Ready-made sequences**, choose **Clinic and doctor**, language **English**.
2. **Expected:** the preview lists steps New/Replaces yours/Already the same. The rebook step shows the upgrade-tier note; the 24 hour reminder shows "buttons left out". Tick **Replace them** if asked, turn **Send the WhatsApp messages to Meta** off, **Apply sequence**.
3. **Expected:** the result says "The sequence is applied" and a box **Left out because of your plan** lists "The Confirm, Reschedule and Cancel buttons of the 24 hour reminder" and "The Rebook message: it is saved switched off", with an **Upgrade your plan** link. In the timeline the rebook step is **Off**.
4. Repeat in A with another booking type, language **Hindi**. **Expected:** the machine-draft warning for Hindi; the result has no "Left out" box. If a WhatsApp number is connected and "send to Meta" is on, each template shows its state (Waiting for Meta approval, later Template approved or Rejected by Meta; **Refresh status** re-reads it).
5. **Not verified anywhere:** Meta's real approval and rejection.

## 4. Test email (A or B)

1. Save the reminders so the step is not new or dirty. Open a step that has email as a channel.
2. Leave **Send the test to** empty and select **Send a test email**. **Expected:** "The test email is on its way to a***@..." and, a moment later, a notification; the mailbox gets a message with `[Test]` in the subject and sample values.
3. Type another address and send. **Expected:** it goes there (masked in the answer).
4. Type `abc@` . **Expected:** the field shows "Enter a complete email address" and the button is disabled.
5. Send eleven in an hour from one workspace. **Expected:** the eleventh answers "try again later" (429).
6. A WhatsApp-only step has no test control; a user without edit rights does not see it.

## 5. Delivery report (A, then B)

1. Make some history: book a few appointments on a booking type with reminders on, wait for reminders to be due (or use a booking made soon, with a 15 minute reminder).
2. **Settings**, **Appointment settings**, scroll to **Reminder report**. **Expected:** per booking type a table with Sent, Delivered, Failed, Sent by another channel, Skipped (with **Why**), and in A the columns Confirmed, Reschedule asked, Cancelled. The line above the table shows the share confirmed/cancelled/no-show.
3. Change **Period** to 7 and 90 days and to **Choose dates** (both dates needed first, up to a year). **Expected:** the report reloads; an empty period says no reminder was due.
4. In B. **Expected:** the three button columns are **absent** and one note says they belong to the upgrade tier, with a link to the plans.
5. Stop the API (or block the request) and **Refresh**. **Expected:** an error with **Try again**.
6. **Expected everywhere:** no names, phone numbers, addresses or message text.

## 6. History on an appointment

1. Open an appointment whose WhatsApp reminder could not be delivered (no consent, or template not approved) and went by email.
2. **Expected:** under that reminder, "Sent by Email because the first channel could not deliver it", "Channels tried, in order" with each channel and the reason, and for a WhatsApp message that was delivered "WhatsApp reported it as delivered".
3. After a customer taps a button on a real reminder (A), **Expected:** "Replies with the buttons: Tapped Confirm · <time>"; the appointment also shows as confirmed.

## 7. Buttons end to end (A, needs a real approved template with buttons)

1. Apply a pack in A with WhatsApp connected and the **24 hour** template approved. Book an appointment far enough ahead and wait for the reminder (or move it so it is due).
2. On the customer's WhatsApp, tap **Confirm**. **Expected:** a reply "confirmed" in the thread, the appointment confirmed, the report's Confirmed count +1. Tap again: the same reply, no second change.
3. Tap **Reschedule**: a reply with the manage link, nothing changes. Tap **Cancel**: the appointment is cancelled and the host is notified.
4. Not verified in a browser or on a phone.

## 8. Downgrade (A to B)

1. In A, with a booking type that has buttons on and a rebook step on, move the workspace to the plan without the two flags (or set the override off).
2. **Expected:** nothing is deleted. The settings screen shows the buttons switch and the rebook step locked; you can still switch them off. The next 24 hour reminder goes without working buttons; a rebook run shows "Not sent" with the reason that your plan does not include this step. A button on a message sent earlier still works. Move back: the same rules send again.

## 9. Permissions

- A user with only **View booking types**: sees steps, packs list and the report; cannot save, apply a pack or send a test email.
- A user without **View booking types** and without the app: sees none of it (C sees nothing).
- Help: a guide shows only where the screen and plan feature exist.

## 10. Report back

For each section: what you did, what you saw, a screenshot for anything that differs, and the workspace/plan. Known untested areas: Meta approval, real WhatsApp delivery and the Meta handling of a template that keeps its buttons after a downgrade, real email delivery, RTL languages (Arabic, Hebrew, Urdu) of the new screens, and phones.
