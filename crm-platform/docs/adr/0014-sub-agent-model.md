# ADR-0014: Sub-agents are their own identity pool, and they read stage live

- **Status:** accepted
- **Date:** 2026-09-16
- **Source:** requirements discussion, 2026-09-15

## Context

The business model has three layers:

```
Institute / college   (the client)
      ↑
Study From UAE        (us — the CRM tenant)
      ↑
Sub-agents            (external partners who source students)
```

What was asked for, concretely:

- each sub-agent gets their own login and their own panel (starting with ~10,
  growing; "channel partners may be multiple in future")
- a lead shows **"Submitted by: \<agent name\>"** on the staff side
- the agent must be able to see what happened to their lead — stage movement,
  interview scheduled, and so on
- **nobody wants to manage that data in two places.** The proposal that was
  agreed: store the contact id against the agent's submission, and when the
  agent opens the lead, call the CRM API and show live detail
- the agent panel runs on its own small host, separate from the CRM
- fixed fields only for now: name, email, mobile, lifecycle stage, college tag

## Decision

### A separate identity pool

`partner_agents`, not a role on `users`. See ADR-0007 for the general rule.

### Mapping only, no copied state

`partner_agent_leads` stores `(org_id, agent_id, contact_id)` plus a verbatim
snapshot of what the agent submitted. **Stage is never copied.** Every view
reads it live:

```sql
SELECT c.name, c.email, c.phone, c.lifecycle_stage, pal.college_tag, c.updated_at
FROM partner_agent_leads pal
JOIN contacts c ON c.org_id = pal.org_id AND c.id = pal.contact_id
WHERE pal.org_id = $1 AND pal.agent_id = $2
```

Served from the read replica (ADR-0013).

### Submission reuses the contact path

`PartnerService.submitLead` calls `ContactsService.create`. An agent-submitted
lead gets the same identity resolution, dedup, audit and outbox treatment as one
typed by staff.

### Attribution is first-come

`contacts.submitted_by_agent_id` is set only when currently null. Two agents
submitting the same person is a real scenario; the second must not silently
steal the attribution, and the duplicate is visible for review.

## Consequences

### Positive

- One source of truth for stage. No sync job to lag, fail or be debugged, and
  no commission dispute where two systems disagree.
- The agent panel is genuinely thin: id mapping plus a few screens.
- The staff side gets attribution without a join.
- The submitted payload is kept verbatim, so "what did the agent actually send"
  survives later staff edits — which is what a commission argument turns on.
- Agents cannot see each other's leads, because every query joins through their
  own mapping rows. There is no filter to forget.

### Negative

- The agent panel is useless when the CRM API is down. Accepted: the panel
  exists to reflect CRM state, and stale-but-visible would be worse than
  honestly unavailable.
- Every lead view is an API round-trip. Mitigated by the replica, an indexed
  lookup, and short client-side caching.
- Lead volume per agent will grow; the list is cursor paginated from day one.

### Neutral

- Commission calculation is not modelled yet. `partner_agents.settings` is the
  place for terms when it is.

## Alternatives considered

### Copy stage into the partner's own store and sync

Rejected explicitly in the discussion: "unnecessary to manage in two places."
A sync job introduces lag, failure modes, and an argument about which number is
right.

### Give the agent an admin login to the CRM

Also discussed, also rejected: it exposes the entire tenant to an external
party, and "20 agents, 20 admins" is not a permission model.

### Agents as `users` with a restricted role

One forgotten filter away from an external agent appearing in an assignment
dropdown or an SLA report.

## Revisit when

Agents ask for more than stage — documents, interview notes, direct messaging
with the candidate. Each of those is a deliberate widening of what an external
party can see, and should be its own decision rather than a gradual drift.
