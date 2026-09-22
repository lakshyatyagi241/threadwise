# apps/partner — sub-agent portal

**Slot, not yet populated.** A small, separate Next.js app for channel partners
(sub-agents) who submit leads and watch them move.

## Why this is a separate app and not a route in `apps/web`

1. **Different audience, different blast radius.** Sub-agents are external. A
   bug in the staff CRM must not be reachable from their portal, and vice
   versa.
2. **Different deploy.** It is small enough to run on a $5–10/month host, and
   it should be deployable without touching the staff app.
3. **Different auth.** It uses `partner_agent` tokens, which the API refuses on
   staff routes at the controller level.

## The one design rule

**Store the contact id. Nothing else.**

The portal keeps the agent → lead mapping and reads name, contact details and
current stage live from the API on every view. It never caches a stage.

That is what makes "what stage is my lead in" have exactly one answer. Copying
stage into a second store means a sync job, and a sync job means a commission
argument with two systems disagreeing.

## API surface

```
POST /v2/auth/partner/login     { orgSlug, email, password } -> tokens
POST /v2/partner/leads          submit a lead
GET  /v2/partner/leads          this agent's leads (cursor paginated)
GET  /v2/partner/leads/:id      live view of one lead
```

Every read is served from the database read replica, so agent polling never
competes with staff writes on the primary.

## Screens (minimum viable)

1. **Login** — org slug + email + password
2. **Submit lead** — name, email, mobile, college tag, programme, notes
3. **My leads** — table with current stage, cursor "load more"
4. **Lead detail** — live stage + submitted-on date

## What agents must never see

Owner, internal notes, conversation history, other agents' leads, anything
about other tenants. The API enforces this structurally: every partner query
joins through `partner_agent_leads` filtered by the agent id in the token, so
there is no filter to forget.
