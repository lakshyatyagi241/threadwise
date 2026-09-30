# ADR-0001: One NestJS application, split by domain module

- **Status:** accepted
- **Date:** 2026-09-16

## Context

The platform is a kernel plus five apps (CRM, Inbox, Broadcast, Billing, Exam
Applications) and a sub-agent portal. They share a database, a tenant model, a
permission model and an event bus.

The team is two engineers. Traffic at launch is modest — around 15–20 leads a
day, growing — with a design target of 2–5 lakh outbound and 1–3 lakh inbound
messages a day.

## Decision

One NestJS application, `apps/api`, with one folder per domain module under
`src/modules/` and a shared `src/kernel/`. It deploys as a single unit. The
worker is the same codebase started from a different entrypoint
(`src/worker.ts`).

Modules talk to each other only through a public `index.ts` barrel, or
asynchronously through the outbox. The boundary is enforced in CI by
dependency-cruiser, not by convention.

## Consequences

### Positive

- One deploy, one log stream, one place to reproduce a bug.
- Cross-module work is a function call, not a network hop with its own failure
  mode, retry policy and tracing problem.
- Transactions actually work. "Write the contact and the outbox event
  atomically" is one `BEGIN`; across services it would be a saga.
- Two engineers can hold it in their heads.

### Negative

- One bad deploy affects everything. Mitigated by the worker running as a
  separate process, so a send storm cannot take down the API.
- One module can degrade another's latency through shared CPU and pool
  contention.
- The module boundaries only stay honest because CI checks them. Without that
  check this becomes a big ball of mud within a year.

### Neutral

- Scaling is horizontal replicas of the whole app rather than per-service.
  At this traffic that is cheaper, not worse.

## Alternatives considered

### Microservices per app

Five services sharing one database is distributed-monolith shape — the worst of
both. Five services with five databases means cross-app joins (contact →
conversation → campaign → application) become API calls, and the contact
timeline that is the product's core value becomes a fan-out. Not with two
engineers.

### Nx monorepo with many libs

Better tooling, more configuration. The generator and affected-graph machinery
earns its keep at a team size we do not have.

## Revisit when

- A single module's resource profile diverges sharply (the message pipeline
  needing 10× the memory of everything else), or
- more than ~8 engineers are blocking each other on one deploy pipeline.

The extraction path is already in place: a module with a clean barrel and
outbox-based integration lifts out without rewriting its callers.
