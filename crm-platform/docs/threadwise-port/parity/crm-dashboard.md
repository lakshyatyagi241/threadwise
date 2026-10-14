# CRM dashboard parity (reference `/crm`)

Reference: `CrmController@dashboard`, `resources/views/user/crm/dashboard.blade.php`. Inventory: TW-INV-028 (CRM read side), TW-DEAL-039.

## Same

Open pipeline (value, deals), won, collected, outstanding, paid invoices, open tasks, overdue tasks, contacts, receivables aging, recent payments, upcoming tasks (six), plan gate on the sales pipeline, links from the counters into deals, tasks, payments, invoices and contacts.

## Intended differences

1. Period: Reference was fixed to "this month" (won, collected). Ours defaults to this month and adds 7/30/90 days and custom; "Won" and "Collected" follow the period.
2. Money per currency or converted to the workspace/pipeline currency, never summed raw across currencies (Reference summed minor units under one symbol; D-05).
3. Counters are cut in the viewer's time zone (Reference: server zone).
4. Record scopes: every number honours the caller's `own`/`team`/`all` scope per table (Reference had none).
5. Sections the caller may not read are left out; Reference showed the whole workspace to any user on the plan.
6. "Due later today" is added next to overdue.
7. Additions (see product-extensions): funnel with conversion, won/lost trend, lead sources, owner leaderboard, tasks by assignee, recent activity, pipeline/owner/team filters.
8. The "Revenue report" button, `/crm/revenue`, `.csv`, `.pdf` and `/crm/guide` are not on this screen: the revenue report is a separate unit (`blocked`, TW-PAY-017); the guide is the Help center guide `crm-dashboard`.
9. The "Won this month" label is "Won" with the period shown under the title.

## Not verified

No browser run in this session (no visual check, no RTL, mobile or dark-mode layout); render tests cover English and Arabic text only. The reference app was not run side by side.
