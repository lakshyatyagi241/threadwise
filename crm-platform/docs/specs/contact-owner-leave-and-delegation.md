# Contact owner: leave, delegation and auto-assignment (design only)

Status: **phase 1 built (leave, delegate, routing integration); phases 2 and 3 specified below, not built** (backlog BL-112, related BL-013). Written 2026-10-13 next to the owner screens (BL-111), which give every
contact one owner and a manual way to move many contacts at once. This note is about what the product does when the owner is not there.

## 1. The problem

A contact has one owner. Owners go on holiday, fall ill, leave, change team. Today (BL-111):

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
  shortcut BL-111 added on the Owner filter).
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
2. Reassign while on leave with restore (builds on BL-111's endpoint).
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

## 10. Owner decisions (2026-10-14) and what is built

Decisions: (1) reassigning on leave is **manual by default**, with an **optional automatic delegate per person**; (2) a contact keeps a **single owner**
(no team column, no multi-owner); (3) **restore after leave is opt-in per reassign operation** and returns only the contacts that were NOT changed since.
Section 7 questions 1 to 3 are answered by these.

### Phase 1: built
- Tables `member_leaves` (date range in the workspace calendar, open end allowed, reason, status scheduled/active/ended/cancelled, exclusion constraint
  against overlapping leaves of one person, one active row per member) and `member_delegates` (one per member, composite FKs, no self). Differences from the
  sketch in section 3: two tables instead of `user_availability`; the existing `agent_statuses` (online/away/busy/offline) is untouched, "on leave" is
  derived from the dates and combined with it.
- "On leave now" is **derived from the dates** (`starts_on <= today <= ends_on` in the workspace time zone, UTC when none), never from `status`, so routing is
  right between two sweeps; the worker sweep (every 5 min) flips the status and writes `member.leave.started|ended`. `member.delegate.changed` on delegate edits.
- Permissions: `team.leave.read` (all presets), `team.leave.manage` with record scope: `own` for Agent and Viewer (self-service), `all` for Manager and above
  (`team` scope = teammates). The reason is visible to the person and to whoever may manage that person, not to colleagues (answers question 5).
- Delegate: another **active** member of the same workspace, not self, **no cycles** (chain walk), one hop only at use time.
- Routing (`RoutingEngine`, `available()`): people on leave are never picked. A rule that **names** an absent person uses their delegate (active, present,
  can open the inbox) ahead of the rule's teams; otherwise the team pool; otherwise the chat stays unassigned and the leads get `assignment_blocked_by_leave`
  (event `routing.blocked_by_leave`). "Keep returning contacts with their agent" hands an absent owner's contact to the delegate, else falls to the rules.
  A manual assignment to someone on leave stays allowed (the picker greys them: "On leave until <date>"). Unchanged for people not on leave.
- Notice: `member_leave_started` to holders of `team.leave.manage` (scope all), with owned contacts and open chats and a link to `/team-members?member=<id>&reassign=1`.
- Intended differences from the sketch: no read access for the delegate to the absent owner's contacts (section 2.3) and no notification forwarding yet;
  the lightweight cover is routing only. Recorded as follow-ups below.

### Phase 2: reassign on demand with restore (specified, not built)
Design chosen after weighing two ways to know "not changed since": (a) `owner_batch_id` + `owner_changed_at` columns on `contacts` (and `deals`) maintained by a
BEFORE UPDATE trigger that stamps them whenever `owner_id` changes, reading the batch id from a session setting that only the batch code sets; any other path
(single edit, bulk, import, merge, auto-assignment) therefore clears it without needing to be edited; (b) reading the audit trail, rejected because audit rows
can be pruned and not every path writes one. Choose (a). Table `owner_reassign_batches` (who, from user, to user / delegate / team round-robin, subject,
counts, reason, `restore_on`, undo window of 14 days, status, restored counts and `skipped_changed`). Restore sets the owner back to `from_user` for rows with
`owner_batch_id = batch` and `owner_id` still the batch target, one audit row and one event per contact (like `POST /contacts/bulk/owner`), under the caller's
record scope and `assertOwnerWithinScope`; a restore also skips when `from_user` is no longer active. There is no deals bulk-owner path today, so the batch brings its
own set-based deal statement. Test the "changed meanwhile" case.

### Phase 3: auto-assignment for contacts and deals, BL-013 (specified, not built)
Priority-ordered rules (conditions: source, country, lifecycle stage, tag, channel, custom property; actions: fixed user, team round-robin, least busy by owned
open deals/contacts via `agent-picker.ts`), skipping people on leave and optionally offline, per-workspace switch default OFF, never overwrites an explicit owner,
idempotent, audit `contact.auto_assigned` with the rule id, loop guard, dry-run "test this rule", Settings > Automation > Contact assignment. **Found while
reading the code:** `forms-builder` (form-submit.service.ts) and `leads` (lead-ingest.service.ts) already pick owners from a user list; they do not yet skip
people on leave and should call the shared helpers (`common/workspace-calendar.ts`, `common/leave-delegate.ts`) when phase 3 unifies them.
