# Intended deviations from Reference: product extensions requested by the project owner

[PORTING_RULES.md](../PORTING_RULES.md) says features and UI do not change, and that a deviation is allowed only when documented
and approved. Everything below deviates on purpose. Each item was requested by the project owner (Lakshya) in chat on
2026-10-02; the rule text says only the human can waive a rule, in words, per case, so each entry states the words. Status:
**owner-requested, pending sign-off by the domain owner and reviewer**. Nothing here was verified side by side against the
running reference (no `threadwise-playwright-parity` stamp exists for these areas yet).

Standing product direction given by the owner: the product targets small businesses that want one bundled tool, so build what a
small business needs even when Reference does not have it, and make money and tax features country-aware.

| # | Area | Deviation | Why | Owner's words (paraphrased) |
| - | ---- | --------- | --- | --------------------------- |
| 1 | App shell and menu | Icon rail that expands to a grouped panel, light/dark, workspace card, tooltips; group order and labels differ from Reference's sidebar (Overview, Inbox & Chat, CRM, Sales, ...) | Owner supplied two reference menus and asked for grouped menus with icons by default | "group the menus like CRM > Contacts, Deals, Tasks; default shows icons; keep it light" |
| 2 | Contacts list | Contact Hub layout (header band, one toolbar, frozen name column with quick actions, pinned footer with numbered pages and page size, thin scrollbar); cursor paging with numbered pages on top | Owner supplied a reference grid and asked for it | "we need contact pagination fixed like this ... horizontal bar very thin" |
| 3 | Contact stage and status | Status options can be scoped to a stage with a per-stage default; stage change resets an invalid status; won/lost stage flags with a lost reason; required custom properties enforced by the API | Reference's two fields are independent, which lets a contact be Won with a "waiting for quote" status | "Does status and lifecycle stage not inter linked? Should it be like that?" then "finish related stuff without needing approval" |
| 4 | Contact stages and properties screens | New Contact stages and Contact properties settings screens (Reference has no stage editor and no typed properties) | The owner could not add or edit stages or find contact properties | "how can I add the stage for the contact? where do we have contact properties?" |
| 5 | Tasks | Full Tasks hub with tabs, bulk actions, drawer, notifications, mirrored deal timeline tasks (Reference has a minimal first-class tasks page) | Owner asked to build Tasks if missing | "if tasks is not built then build the same too" |
| 6 | Deals | Pipeline and stage editor, lost-reason catalogue, per-column board paging, currency-correct reports (Reference has no editor and mixes currencies) | Spec found the documented editor does not exist and reports are wrong | owner asked to build deals and pipelines |
| 7 | Proposals and estimates | Editable drafts, guarded status machine, eager expiry, signed public accept, revisions, per-line discount and tax (Reference: status-only edits, no audit trail) | Reference's flow is broken from the UI (cannot send, cannot edit) | owner asked to build proposals and estimates |
| 8 | Invoicing | Draft/issued/partially paid/paid/overdue/void lifecycle, payments ledger with refunds and aging, tax rates, business profile, credit notes, recurring invoices, sales orders (Reference invoices are only auto-issued store receipts) | Small businesses cannot run invoicing on Reference's receipts | "why not build features Reference does not have like recurring invoice, sales order etc ... for small business" |
| 9 | Tax engine (`@crm/tax`) | Country-aware totals, rounding and tax presets for 48 country profiles; Reference has per-line free-form percentages | Owner required tax calculation per country | "ensure we have all that tax calculation as per countries" |
| 10 | Notifications | Live bell in the top bar with task notifications | The bell was disabled and tasks had no consumer | follow-up in the same request |

## What is not verified

- No item above was compared with the running Reference reference; the reference had no workspace user for most of this work.
- Plan gating for deals, tasks and sales documents shares the `sales_pipeline` flag; the reference gates these differently.
- Preset tax rates are defaults the user must verify (see `docs/tax-engine.md`).
- Delivery (email, WhatsApp), real payment providers, server-side PDF files and e-invoicing formats are not built.

## Decision for the reviewer

If the team decides the rule "no extra features, same UI" applies in full, items 1-2 and 4-10 are removable behind their menu
entries (each is its own feature folder and route group); item 3 and the API changes in `status-options` and `contacts` would
need to be reverted by migration. The owner asked for them; this file only makes the deviation visible.
