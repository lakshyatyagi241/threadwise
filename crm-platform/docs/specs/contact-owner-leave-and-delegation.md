# Contact owner: leave, delegation and auto-assignment (design only)

Status: **spec, nothing built** (backlog BL-109, related BL-013). Written 2026-10-13 next to the owner screens (BL-108), which give every
contact one owner and a manual way to move many contacts at once. This note is about what the product does when the owner is not there.

## 1. The problem

A contact has one owner. Owners go on holiday, fall ill, leave, change team. Today (BL-108):

- the contacts of an absent owner keep belonging to them; nobody else is told, a colleague with the `own` or `team` record scope may not see them,
  and a customer who writes in lands on a chat that nobody is watching;
- a manager can move the whole book by hand (Owner filter, select all, Update, Owner), but has to remember to do it, to whom, and to move it back;
- new contacts and deals are created for the creator or for nobody; there is no rule that picks a person (BL-013 asks for a fixed user or a
  team round-robin) and no notion of "not available".

## 2. What it should do (proposal)

### 2.1 Who owns: one owner, optionally a team

- Keep **one owner per contact** (a person), as today. Add an **optional team** per contact (`contacts.team_id`, composite FK to `teams`,
  nullable) so that "belongs to Sales EMEA, looked after by Asha" is expressible and a team lead can see and reassign the team's book.
  The `team` record scope would then also reach contacts whose team the caller belongs to, not only contacts owned by a teammate.
  (Decision 2 below: skip the team column and keep the owner only.)

### 2.2 On leave

- A person gets an **availability status**: `available` (default) or `on_leave`, with `from` and `until` dates (a date range, in the workspace
  time zone; open-ended allowed for a long absence). Stored on the member (`user_availability`: org, user, status, from, until, delegate, note,
  created by), edited by the person themselves and by whoever holds `workspace.members.manage`.
- Visible everywhere a person is picked or shown: a small "On leave until 20 Oct" mark in the owner picker, the Owner column, the profile
  and the assignment screens. Picking a person on leave is allowed (it is a warning, not a block) except by automatic rules.

### 2.3 Delegate

- A person on leave can name a **delegate** (another active member, never themselves, no chains: a delegate on leave is skipped and the next
  rule applies). The delegate gets **read and act access to the absent owner's contacts for the period** (the record scope gains "or owned by
  someone whose delegate I am, while they are on leave"), and the notifications that would go to the owner (new chat, assignment, mention,
  task due) also go to the delegate.
- No data moves: the owner stays the owner. This is the lightweight answer for a short absence.

### 2.4 Reassign on demand, restore at the end

- For a longer absence the manager (or the person, if their scope allows) runs **"Reassign while on leave"**: pick the target (a person, a team
  round-robin, or "unassigned") and the scope (all contacts, only open deals' contacts, only contacts active in the last N days). It uses the
  bulk owner endpoint (`POST /contacts/bulk/owner`) over a filter and, as a new step, **records which contacts moved** (`owner_reassignments`:
  batch id, contact, previous owner, new owner, reason `leave`, at) so that it can be undone.
- **Restore at the end** (or earlier, on demand): put back every contact of the batch that still belongs to the person it was moved to and
  has not been moved since; contacts the delegate meanwhile reassigned on purpose, or that were deleted, are left alone and counted in the
  report. The alternative is **keep** (the new owner keeps them). Which of the two is the default is the owner's decision (question 2).
- Everything is audited as ordinary owner changes (`contact.updated` with `ownerId` and `previousOwnerId`, plus the batch id).

### 2.5 Automatic assignment (shared with BL-013)

- Rules for **new contacts and new deals** (created by import, form, API, lead sources, inbound chat): fixed user, team round-robin, least loaded,
  owner of the company, or "the creator" (today's default). Rules skip anyone who is **on leave**, inactive, or over their cap; if nobody
  qualifies the item falls back to the rule's fallback (unassigned, or the team lead) and a bell row says so.
- The same availability feeds round-robin for the inbox assignment (today manual only), so one concept of "who can take work today" serves
  contacts, deals and chats.
- Auto-assignment never reassigns an existing owner; only reassign-on-leave and a person do that.

## 3. Data (sketch)

| Table / column              | What                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `user_availability`         | one current row per member: `status`, `starts_on`, `ends_on`, `delegate_user_id`, `note`                     |
| `owner_reassignments`       | batch id, contact, from owner, to owner, reason, actor, at; indexed by batch and by contact                  |
| `contacts.team_id` (option) | nullable composite FK to `teams`                                                                             |
| `assignment_rules`          | org, subject (`contact` / `deal` / `chat`), strategy, pool (users or team), cap, fallback, enabled           |
| worker job `leave-sweeper`  | daily: flips `on_leave` back to `available` after `ends_on`; offers or runs the restore; sends the reminders |

All tables get RLS and composite foreign keys like every tenant table; permissions would be `workspace.availability.manage` (others'),
the person's own is always allowed, and `record.contacts.reassign` is not needed because reassignment keeps using `record.contacts.update`
with the record scope rules of `assertOwnerWithinScope`.

## 4. Screens (sketch)

- **Account / Availability** (the person) and **Settings > Team > Availability** (the manager): a list with status, dates, delegate; "Reassign
  their contacts" shortcut on a row, which opens the Contacts hub filtered by that owner with the reassignment dialog already open (the
  shortcut BL-108 added on the Owner filter).
- **Reassign while on leave** dialog: target, scope, "restore on <date>" switch, a preview count, then a result with the batch id and an
  **Undo / Restore now** button.
- **Settings > Assignment rules** for BL-013.

## 5. Edge cases to settle

- Overlapping leaves and a delegate who goes on leave; a delegate who leaves the company.
- A contact moved twice during one leave (restore must not undo a deliberate later move).
- Time zones: dates are the workspace's, the sweeper runs in it.
- Big books: the bulk owner endpoint moves up to 50,000 contacts per request inside one transaction; the leave tool would batch and report.
- The `team` record scope is about owners today; delegation widens it temporarily and must show in the audit trail who acted as whose delegate.
- Privacy: a delegate reads contacts they could not read before; the grant is time-boxed, logged and visible to the absent person.

## 6. Rollout

1. Availability status and the "On leave" marks (read-only information, no behaviour change).
2. Reassign while on leave with restore (builds on BL-108's endpoint).
3. Delegate access and notification forwarding.
4. Assignment rules (BL-013) that honour availability.

## 7. Questions for the owner

1. **Automatic or manual reassign?** When someone goes on leave, should their contacts move by themselves (to the delegate, or to a team
   round-robin) or only when a manager presses the button? (Recommendation: manual first, automatic opt-in per workspace.)
2. **Restore or keep?** After the leave, should the contacts go back to the returning owner automatically, only on request, or never (the
   new owner keeps them)? Does the answer differ for contacts that got a reply or a deal while they were away?
3. **Single owner?** Is one owner per contact enough, or should a contact have a primary owner and a team, or several owners?
   (Recommendation: one owner plus an optional team.)
4. **Delegate versus reassign:** is read-and-act access for a delegate wanted for short absences, or is reassignment the only tool?
5. **Who may set leave** for whom: only the person, their manager, or any admin? Is the reason shown to colleagues?
6. **Customer-facing effect:** should a customer who writes to an absent owner's chat get an automatic note, or be routed to the delegate or the team inbox?
7. **Auto-assignment fairness:** round-robin, least-loaded or weighted; per-person daily cap; business hours and time zones; does a person
   on leave still receive deals already in progress?
8. **Plans:** is any of this plan-gated (for example assignment rules on the higher plans)?
9. **Reporting:** is a "workload by owner" view (contacts, open deals, overdue tasks) needed before reassigning?
