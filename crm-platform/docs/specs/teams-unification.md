# Teams, managers and access across chat and CRM: one model (design only)

Status: **proposal, nothing built** (backlog BL-380 to BL-386). Written 2026-10-19 from a read-only pass over `origin/main` plus a vendor study. Docs only: no code,
no migration, no behaviour change comes with this note. Every "today" statement names the file or table it was read in.

Owner direction: the product is **one package that fuses a CRM and a conversation product** (Freshsales and Freshchat are two products; ours is one). What a
workspace sees must be decided by **plan, add-on and persona**, not by the code being two products. A workspace that buys only the chat side must not meet CRM
words, and one that buys only the CRM side must not meet inbox words. Teams, managers and groups must work for both and for the mix, and the same team must be
usable for **conversation routing and for contact, company and deal assignment**.

## 1. Short answer

1. The owner's reading is **half right**. `team_members` is already the one membership table and the CRM record scope `team` already reads it (contacts, companies,
   deals, tasks, invoices, sales documents, appointments, forms, call logs, CRM dashboards). But everything a person can **manage or see about teams** (the Teams
   screen, its permission key `inbox.team.manage`, its copy, routing, SLA, business hours, analytics) is framed around the inbox.
2. There are **two different meanings of "team" scope** behind one dropdown label ("Team records"): the inbox means "assigned to me or to my team, or unassigned"; the CRM
   means "owned by anyone who shares a team with me". The same person sees different things for the same setting.
3. A team cannot own a record, and there is no manager or reporting line. `deals.owner_team_id` exists with no reader or writer.
4. **Proposal:** keep ONE `teams` entity and ONE membership table; give a team a small set of **capability flags**, an optional **parent team** and a **lead/manager**;
   define **one scope resolver** with four named scopes; stamp each record with its **owning team** (the owner's primary team at assignment time) for reporting; keep
   plan, add-on and persona as the three layers that decide what is **available**, **visible** and **allowed**. Territory is a later, rule-based object.

## 2. What exists today (evidence)

### 2.1 Data

| Concept | Where | Note |
| --- | --- | --- |
| Team | `teams(org_id, id, uuid, name)` plus `slug, color, description, default_assignee_id, assignment_strategy, business_hours, timezone, device_ids, is_default, sort` (migrations `0003_foundation.sql`, `20261001102500_wsp_threadwise_schema.sql`) | Several columns are never read (see 2.3) |
| Membership | `team_members(org_id, team_id, user_id, is_lead, capacity)` | `is_lead` and `capacity` are returned and never edited or used |
| Role and scope | `roles`, `user_roles`, `role_grants(permission_key, effect, record_scope)`, enum `record_scope ('all','team','own')`, presets Owner, Admin, Manager, Agent, Viewer | Scope is chosen per permission key in the Roles matrix |
| Where a team sits on a record | only `conversations.assignee_team_id`; `deals.owner_team_id` has no FK and no code | Every other record has a person only (`owner_id`, `assignee_id`, host `user_id`) |
| Pools in rules | `routing_rules.actions` (JSON), `assignment_rules.team_ids` (JSON, no FK), `segment_shares.team_id` (FK), `owner_reassign_batches.to_team_id` | Team uuids in JSON are never cleaned when a team is deleted |
| Absent | manager or reporting line, department, territory, queue, channel access list, per-team SLA, per-team business hours | Searched; none exist |

Not to be confused with "team": team chat (`team_chat_*`), WhatsApp groups (`waba_groups`), the video provider `teams`, partner agents, platform operator roles.

### 2.2 Where teams are enforced

| Area | Uses team membership | Rule |
| --- | --- | --- |
| Inbox assignment, routing, notifications | Yes | `routing-engine.service.ts` expands teams in a rule into available members and picks (specific, round robin, least busy). Plan gate `inbox_routing`. |
| Conversation visibility, scope `team` | Yes | Assigned to me, or `assignee_team_id` in my teams, or **unassigned** (`realtime/audience/conversation-visibility.ts`, `team-inbox-conversations/visibility-sql.ts`) |
| Contacts, companies, deals, tasks, invoices, sales documents, appointments, forms, call logs, segments, CRM dashboards, revenue by team | Yes | Scope `team` = the owner or assignee shares **at least one team** with me; an owner of NULL is never visible. The same self-join is **copied by hand in 17 files** (`contact-conditions.ts`, `deals.repository.ts`, `tasks.repository.ts`, `appointments.repository.ts`, ...). `own` also differs: tasks, appointments and forms count `created_by`, contacts and deals do not. |
| Record assignment rules | Yes, as a pool of people | The engine expands `teamIds` into members; it checks active, not on leave, not offline. It does **not** check that the person can open the record. Design note in `contracts/src/crm/contact-assignment.ts:218`: "a team is a pool of people, records do not belong to a team". |
| Lead sources, Meta lead forms, forms | No | People-only owner rule (`LeadOwnerRule`) with its own small round robin |
| Flows | Inbox only | The Assign node hands a conversation to a user or team; Create deal takes a user |
| Appointments | No | One host per booking type; no team calendar or round robin |
| SLA | No | One workspace default policy; no team link |
| Business hours | No | Workspace-wide; `teams.business_hours` is unread |
| Analytics | Per agent | The CRM dashboard team filter is the only team-keyed report; revenue groups through `team_members`, so a person on two teams counts twice |

### 2.3 Settings and web

Settings > Team and permissions has three tiles: **Team members** (`admin.user.manage`, no teams column), **Roles and permissions** (`admin.role.manage`; scope dropdown
"All records / Team records / Own records"), **Teams** (`/teams`, no read gate, `inbox.team.manage` to write). The Teams screen edits name, colour, an "auto-assignment
strategy" select and members; copy: "Group your agents by department. Conversations can be auto-assigned by team via routing rules." It hides devices, and has no
description, lead flag, capacity, business hours, timezone, default assignee or manager. Deleting a team warns about conversations only, but it also removes CRM scope
reach. Team pickers exist in routing rules, inbox filters and bulk bar, record assignment, segment sharing, leave and reassign, and the CRM dashboard filters; there is
none on the contacts list, deals, tasks, lead sources, forms, booking types or campaigns.

### 2.4 Plans, add-ons, personas

- Plan features (`catalogue.ts`): chat side `inbox_routing, inbox_sla, inbox_kanban, team_performance, team_chat, calling, waba_groups, chatbot_widgets, extra_channels, sms,
  email_channel`; CRM side `sales_pipeline, invoicing, lead_sources, form_builder, appointment_booking, record_assignment, lead_scoring, ai_crm_copilot`; platform `automation,
  analytics, marketplace, public_api, ...`. Limits include `users` (seats). **There is no `teams` limit, no feature for custom roles or scoped permissions.**
- Add-ons: plans of kind `addon` merge into entitlements; Marketplace apps (`appointments, forms, email, lead-scoring, sms, ai-crm-copilot, ...`) grant plan features while installed.
- Persona: P0 and P1 built (the hide mechanism, generic persona only); no Business type tile, no console. Hidden never bypasses entitlement; entitlement wins and shows a lock.
- **Chat cannot be separated from CRM today**: contacts are always on and back conversations; `deals.conversation_id` links the two; routing reads the contact owner; the inbox
  contact panel needs `record.contacts.read`; appointments, forms, tasks and segments hang off contacts.

## 3. Ranked gaps

| # | Gap | Evidence |
| --- | --- | --- |
| 1 | Two meanings of `team` scope under one label | `conversation-visibility.ts` vs `contact-conditions.ts`, `permission-matrix.tsx` |
| 2 | Records cannot belong to a team; `deals.owner_team_id` is an orphan | `deals-pipelines/tables.ts:109`, inventory note "unused" |
| 3 | The scope SQL is copied in 17 files and `own` differs by module | repositories listed in 2.2 |
| 4 | Deactivating a member deletes their `team_members` rows and does not reassign their records; reactivation does not restore membership | `members.repository.ts:deactivate`, `members.service.ts:443` |
| 5 | No manager or reporting line; `is_lead` and `capacity` unused | `teams.mapper.ts`, `contracts/.../teams.ts:30` |
| 6 | Teams screen, key and copy are inbox-only; Manager has `crm.assignment.manage` but not `inbox.team.manage` | `messages/en/workspaces-teams-tenancy.json`, presets migration |
| 7 | Stored team settings nothing reads (business hours, timezone, default assignee, strategy, devices) | `assignees.service.ts:90`, `assignment.service.ts` "later phase" |
| 8 | Three owner-assignment systems (conversation routing, record rules, lead source rules) with duplicated team and leave handling | BL-345 "not built" |
| 9 | Record assignment can give a record to someone who cannot see or work it | `contact-assignment.repository.ts:candidates` |
| 10 | The inbox contact panel ignores contact scope (an `own` agent sees a contact owned by someone else) | `inbox-conversations.service.ts:~400` |
| 11 | Scope flags on keys nothing reads (`broadcast.campaign.read`, `exam.application.*`, `partner.lead.read`) | `0008_seed_permission_defs.sql` |
| 12 | Plans have no team or role dimension: no `teams` limit, no gate for custom roles or scoped permissions | `catalogue.ts` |
| 13 | No clean chat-only or CRM-only edition: only `generic` persona, contacts always on | persona spec section 15 |
| 14 | Team deletion leaves stale ids in rules; `team.deleted` has no subscriber | `teams.service.ts` |
| 15 | Appointments and calls have no team concept | `appointments.repository.ts`, `call-logs.repository.ts` |
| 16 | Two members screens, no teams column, ungated Teams tile | `/settings/team`, `/team-members` |
| 17 | The `deals` menu entry has no `sales_pipeline` gate while the API refuses reads | `deals-pipelines/nav.ts`, `crm/deals/deals-plan.ts` |

## 4. What other products do (summary; sources in the research notes)

| Product | Team-like objects | One concept for chat and CRM? |
| --- | --- | --- |
| HubSpot | Team (main plus extra), permission sets, seats; nested teams on Enterprise | **Yes**, one team entity; seats and tier decide tools. Known complaint: a person has only one *main* team, and extra-team members drop out of routing and reports |
| Freshworks | Freshsales: team (no data effect), territory (scope), role; Freshchat and Freshdesk: groups shared across the support products | **No**: CRM teams and territories are separate from chat groups; the docs do not map one to the other (not confirmed) |
| Zoho | CRM: role tree, profile, group (sharing target only), territory (rule based); Desk and SalesIQ: departments | No: separate per product |
| Pipedrive | Visibility groups and permission sets; sub-groups from Premium | CRM only; group count rises with tier |
| Salesforce | Role tree, territories, queues, public groups | Queues (routing) kept apart from roles and territories (visibility) |
| Intercom, respond.io, WATI, Interakt, AiSensy | Teams and team inboxes; Interakt teams exist only in its Sales CRM layer, with Lead and Member | Conversation first; little record ownership |

Patterns worth taking: separate **pool** (who can receive work) from **scope** (what a person may see); seats decide tools and permissions decide actions; rule-based
territory is a different object from a team; hierarchy is wanted on every plan. Patterns to avoid: two lists edited in two places (Freshworks redirects to Freshdesk to edit
membership), a team that carries no data effect while a second object does, a single primary team that drops people from routing, routing that runs once and never retries,
and hiding basic routing behind a top tier.

## 5. Proposal

### 5.1 One entity, flags instead of kinds

Keep `teams` and `team_members`. Add to `teams`:

- `parent_team_id` (nullable, same workspace, no cycles): the optional hierarchy.
- `lead_user_id`, plus `team_members.role` (`member` or `lead`) replacing the unused `is_lead`: the manager.
- capability flags: `receives_conversations`, `receives_records`, `is_scope_boundary` (all default true for existing teams, so nothing changes), so a "Support" team can be
  hidden from record assignment pickers and a "Sales west" team from the inbox pickers without two lists.
- `team_members.is_primary` (exactly one true per user, nullable if none): reporting and owning-team stamping only. Routing, assignment and scope use **all** memberships, so
  nobody drops out of anything (the HubSpot complaint).
- Stored settings that nothing reads (`business_hours`, `timezone`, `default_assignee_id`, `assignment_strategy`, `device_ids`) are either **implemented** as team overrides
  (business hours and timezone for routing and SLA; default assignee as the fallback when no one is available) or **dropped** in the same release; no silent dead columns.

Naming: **Team** (most vendors). **Territory** is reserved for the later rule-based object. Not "group" (ambiguous with WhatsApp groups and permission groups) and not
"department".

### 5.2 One scope resolver, four named scopes

A single `ScopeResolver` (API) answers "which owners may this actor see" and "may this actor act on this record", used by every repository; the 17 hand copies go.

| Scope (stored) | Meaning |
| --- | --- |
| `own` | Records I own or am assigned; `created_by` counts the same way in every module (decision D1) |
| `team` | Records owned by me or by any member of any team I belong to (today's CRM meaning, extended to conversations by also counting `assignee_team_id`) |
| `team_and_below` (new) | `team` plus members of descendant teams; given to managers; available only when hierarchy is enabled |
| `all` | Everything |

Conversations keep one extra, separate, named permission instead of overloading the scope: `inbox.conversation.read_unassigned` (the "unassigned stays visible" rule that
makes the inbox work today). The Roles matrix label becomes "My records / My team's records / My team and sub-teams / All records", and a role editor warns when a role with
`team` scope has no team membership. Existing roles keep their behaviour: `team` stays the CRM meaning, and for conversations the migration grants the new unassigned permission
wherever `inbox.conversation.read` had scope `team` (D2).

### 5.3 Records and the owning team

Records keep a **person** owner (contacts, companies, deals, tasks, appointments). New: `owning_team_id` on contacts, companies, deals and tasks, stamped when the owner is set
(the owner's primary team at that moment, refreshed on reassignment; HubSpot does the same). It is for reporting ("by team" counts each record once), filters and the team
picker in lists, **not** for access (access stays person plus scope). `deals.owner_team_id` becomes this column (with a real FK). A record whose owner has no team has none.

Later (not in the first release): assigning a record **to a team without a person** (a "team queue", like a conversation today), claimed by a member; this is the one place
where a team truly owns a record, so it is designed but off by default.

### 5.4 One assignment engine for the pool

Conversation routing and record assignment already share `common/agent-picker.ts`. The proposal finishes that merge:

1. record assignment candidates must hold the permission and scope needed to open the record (gap 9);
2. lead source, Meta lead form and form owner rules are folded into the record assignment rules as the first matching source condition (BL-345's "folded in");
3. team-level fallbacks (default assignee, team business hours) apply to both;
4. a team strategy is a real setting used by both engines (specific, round robin, least busy), shown once on the Team.

### 5.5 Settings and wording (Settings > Team and permissions)

- **Team members** gets a Teams column, a Manager column and a team filter; the second members screen is removed in favour of redirecting to it.
- **Teams** loses inbox-only copy: "Teams group people for conversations, assignments and reports." Fields: name, colour, description, **lead**, **parent**, members (with lead flag),
  **Can receive** (conversations, records), and, where the plan allows, business hours and default assignee. A **delete preview** lists every use (routing rules, assignment rules,
  segment shares, scope reach for N people) and offers "move records and rules to ...".
- New permission `team.manage` replaces `inbox.team.manage` for editing teams (the old key is kept as an alias for one release); Manager gets it. `team.read` is added and the
  Teams tile is gated by it.
- Deactivating a member asks what happens to their records and open conversations (reassign to a person, to their team lead, or leave), and **keeps** their membership history so
  reactivation restores it (gap 4).

### 5.6 Splitting chat and CRM: plan, add-on and persona

Three layers with different jobs, as the persona spec already says:

| Layer | Question it answers | Mechanism |
| --- | --- | --- |
| Plan and add-on | What may this workspace **use** | plan features and limits; add-ons and Marketplace apps grant features |
| Persona | What does this workspace **see** | module ids hidden or shown; hidden never bypasses plan |
| Permission and scope | What may this person **do or see** | roles, `role_grants`, the four scopes |

Additions:

1. **Product line metadata** on each plan feature key (`chat`, `crm`, `platform`) in `PLAN_FEATURE_DEFS`, so editions are data: a "Chat" plan turns the `crm` keys off, a "Sales CRM"
   plan turns the `chat` keys off, "Business" has both. No code branches on plan names.
2. **Contacts are the shared core** (a customer directory) in every edition. In a chat-only edition the contact page shows the conversation side only (no deals, tasks, assignment
   tabs); in a CRM-only edition the inbox entries and inbox wording disappear. This is a persona and edition concern, not a data split.
3. **Teams packaging** (decision D4): a `teams` limit key (0 means solo, no teams) and two plan features, `team_hierarchy` (parent teams, managers, `team_and_below`) and
   `custom_roles` (custom roles and per-key scopes). Recommended default: flat teams in every paid plan; hierarchy and custom roles on higher plans or in a "Teams and permissions"
   add-on, as the owner suggested. Vendors gate hierarchy at top tiers and users complain, so keep at least flat teams wide.
4. **Seat types** (decision D6, later): a chat seat and a sales seat (HubSpot style), where the seat decides which side a person sees and permissions decide actions. Not needed
   for the first release; the product-line metadata keeps the door open.
5. **Persona presets** "Chat team", "Sales team", "Both" (persona spec 11.4) select the edition view and the starter roles: Chat team gets the inbox presets (Viewer, Agent) and the
   Teams screen in routing mode; Sales team gets owner, assignment and visibility wording.

## 6. Phased plan

| Phase | Content | Size | Visible change |
| --- | --- | --- | --- |
| T0 | `ScopeResolver` extracted behind the existing semantics (the 17 copies replaced, tests per module, `own` rules unified per D1); fix gaps 9, 10 and 17; delete-preview and `team.deleted` consumer (gap 14) | M | none except the three fixes |
| T1 | Teams v2: parent, lead, `is_primary`, capability flags, `team.manage` and `team.read`, neutral Teams screen and members columns, deactivation prompt that keeps membership | L | Teams and Members screens |
| T2 | Scope semantics: `team_and_below`, the unassigned conversation permission and role migration, new matrix labels, `owning_team_id` on records and reports by team | L | Roles matrix, reports |
| T3 | Packaging: product-line metadata, `teams` limit, `team_hierarchy` and `custom_roles` features, plan editor and paywalls, persona presets Chat, Sales, Both | M | plan editor, paywall |
| T4 | One assignment engine: fold lead source and form owner rules, team fallbacks and strategy, team business hours in routing and SLA | L | assignment screens |
| T5 | Later: territory (rule-based record pools), team queues for records, team hosts and round robin for booking types, call queues, seat types | L each | new |

Each phase ships its Help guide, wiring map and tests; T1 and T2 need a data migration of existing teams (all flags true, no parent, no primary until chosen) and existing roles
(no change in what anyone sees).

## 7. Open owner decisions (recommended default first)

| # | Decision | Recommended default | Alternative |
| --- | --- | --- | --- |
| D1 | Does `own` include records a person created? | Yes in every module (today only tasks, appointments, forms do) | No in every module |
| D2 | Conversations: keep "unassigned stays visible" for `team` scope? | Yes, as the separate permission `inbox.conversation.read_unassigned`, granted by migration to today's `team` roles | Drop it (unassigned would be invisible to team-scoped roles) |
| D3 | Name | **Team** (territory reserved for later) | Group, Department |
| D4 | Teams packaging | Flat teams on every paid plan; hierarchy and custom roles on higher plans or a "Teams and permissions" add-on | Teams only as an add-on; teams in all plans including hierarchy |
| D5 | Hierarchy | Optional parent team plus lead; `team_and_below` for managers | Flat only, no manager scope |
| D6 | Seat types | Later; one seat type now | Chat and sales seats from T3 |
| D7 | Unused team columns (`business_hours`, `timezone`, `default_assignee_id`, `assignment_strategy`, `device_ids`) | Implement business hours, timezone, default assignee and strategy; drop `device_ids` | Drop all |
| D8 | `owning_team_id` on records | Add it (owner's primary team at assignment), reporting and filters only | No stamp; report through `team_members` as today |
| D9 | Team queues for records | Designed, off by default, built in T5 | Not planned |
| D10 | Deactivation | Prompt to reassign; keep membership history | Reassign automatically to the team lead |

## 8. Risks

- Changing scope meaning touches every list and permission check: T0 must land first with per-module tests, and T2 ships behind a per-workspace check that reports the
  difference in who sees what before it is switched on.
- A person on two teams counts twice in team reports today; `owning_team_id` fixes that but old reports need a note.
- Splitting editions can hide a screen that a role still needs (for example a chat-only edition and the contact panel). The persona rule stands: hidden is never locked and never
  removes API access.
- Vendor pricing, tier names and some Freshworks cross-product details came from help-center pages and search summaries; they are marked unconfirmed in the notes and are not a
  basis for our own pricing.
