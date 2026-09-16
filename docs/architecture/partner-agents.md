# Sub-agents (channel partners)

The business has three layers:

```
Institute / college      the client
        ↑
Study From UAE           us — the CRM tenant
        ↑
Sub-agents               external partners who source students
```

Sub-agents submit leads and want to watch them move. See
[ADR-0014](../adr/0014-sub-agent-model.md) for the reasoning.

## The one rule

**The partner side stores the contact id. Nothing else.**

Name, contact details and lifecycle stage are read **live** from the CRM on
every view. No stage is ever copied into a second store.

That is what makes "what stage is my lead in" have exactly one answer. Copying
stage means a sync job; a sync job means lag, failure modes, and a commission
argument where two systems disagree.

## Data model

```
partner_agents            org_id, id, uuid, code, name, email, phone,
                          password_hash, status, settings, last_login_at

partner_agent_leads       org_id, id, agent_id, contact_id,
                          submitted_payload, college_tag, submitted_at
                          UNIQUE (org_id, agent_id, contact_id)

contacts.submitted_by_agent_id    denormalised attribution for staff lists
```

`submitted_payload` is a verbatim snapshot of what the agent typed. If staff
later correct the contact, this still shows what was originally submitted —
which is what a commission dispute actually turns on.

## Authorisation is structural

Agents have no RBAC grants. Every partner query joins through
`partner_agent_leads` filtered by the agent id in the token:

```sql
FROM partner_agent_leads pal
JOIN contacts c ON c.org_id = pal.org_id AND c.id = pal.contact_id
WHERE pal.org_id = $1 AND pal.agent_id = $2
```

An agent can only name a contact already mapped to them. There is no "can this
agent see this contact" check to forget.

On top of that, `@ActorKinds('partner_agent')` rejects a staff token at the
controller, and `@ActorKinds('user')` rejects an agent token on staff routes.

## Reads go to the replica

Agents poll. That traffic is unbounded and has no business competing with staff
writes on the primary, so `PartnerService` uses `db.txReplica()`.

## Attribution: first-come

```sql
UPDATE contacts SET submitted_by_agent_id = $agent
WHERE org_id = $1 AND id = $2 AND submitted_by_agent_id IS NULL
```

Two agents submitting the same person is a real scenario. The first one owns
the attribution; the second does not silently steal it, and the duplicate
remains visible for review.

## Submission reuses the contact path

`PartnerService.submitLead` calls `ContactsService.create`. An agent-submitted
lead gets the same identity resolution, dedup, audit and outbox handling as one
typed by staff. A parallel "partner lead" write path would drift from the main
one within a month.

A consequence worth knowing: if the person already exists, the agent's
submission **attaches to the existing contact** rather than creating a
duplicate.

## API

```
POST /v1/auth/partner/login   { orgSlug, email, password } -> tokens
POST /v1/partner/leads        submit (Idempotency-Key honoured)
GET  /v1/partner/leads        own leads, cursor paginated
GET  /v1/partner/leads/:id    live view of one lead
```

Response fields are exactly what was agreed: name, email, mobile, lifecycle
stage, college tag, submitted-on, last-updated.

## What agents must never see

Owner, internal notes, conversation history, other agents' leads, anything from
another tenant.

## Not built yet

- Staff-side agent management (invite, suspend, reset password)
- Commission terms and calculation — `partner_agents.settings` is the slot
- Per-agent performance reporting
- The portal UI itself — see `apps/partner/README.md`
