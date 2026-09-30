# Reference feature inventory — format spec

Reference (CodeCanyon SaaS, Laravel 12 + a Node/Baileys bridge, v1.7.0) is the **behavioral
reference** for this port. We do not copy its code, assets or copy-deck. We read it, write down
exactly what it does, and rebuild that behavior on this repo's stack (NestJS, Postgres+RLS,
Drizzle, BullMQ, Next.js). The inventory is the contract between "what Reference does" and "what we
build". If a behavior is not written down here, it will not be ported.

One file per domain: `docs/threadwise-port/inventory/<domain-id>.md`.

## Bar for detail

Someone who has never opened Reference must be able to build the feature from the entry alone and
know when it is done. That means, wherever the source shows it:

- exact validation rules (required, min/max, regex, uniqueness scope, allowed enum values, defaults)
- exact permission keys and plan/limit gates that guard the action
- every state a screen can be in (empty, loading, error, partial, limit reached, disabled by plan)
- exact side effects (rows written, jobs queued, webhooks fired, notifications sent, wallet charged)
- ordering, pagination sizes, filters, search fields, bulk actions, export formats
- error and flash messages that carry meaning (paraphrase; keep short literals only when they are identifiers)
- behavior that is surprising or looks like a bug but is relied on (mark `QUIRK:`)

Do not paste code blocks or long text from Reference. Describe behavior in your own words.

## File layout

````markdown
---
domain: <domain-id> # kebab-case, matches file name
code: <CODE> # short uppercase code used in feature ids
title: <Human title>
threadwise_version: '1.7.0'
sources_read: <int> # rough count of source files actually opened
---

# <Human title>

## Overview

What this domain is for, who uses it (super-admin / workspace owner / agent / end-customer /
API client), the main flow end to end, how plan tiers change it, and how it connects to other
domains (name domains by id).

## Feature index

| Id                                         | Feature | Status | Priority | Effort | Depends on |
| ------------------------------------------ | ------- | ------ | -------- | ------ | ---------- |
| (one row per feature, same order as below) |

## Features

### WD-<CODE>-001 — <feature title>

... (see entry template below)

## Data model

Per table owned by this domain: purpose, every column that affects behavior (type, null, default,
enum values, JSON shape), indexes, uniques, FKs, soft-delete/timestamps, row-volume expectations
and which features read/write it.

## Cross-domain contracts

Bullets: what this domain **consumes** from other domains and **exposes** to them (service
methods, events, tables, settings), each naming the other domain id.

## Open questions & quirks

Anything ambiguous, undocumented, dead code, half-built features, docs that advertise something
the code does not do.

## Coverage

```json threadwise-coverage
{ ... see "Coverage block" ... }
```
````

## Entry template (every feature, same headings, same order)

```markdown
### WD-<CODE>-<NNN> — <title>

- **Status:** implemented | partial | docs-only | dead-code | beta
- **Priority:** P0 (product unusable without) | P1 (expected by customers) | P2 (nice to have)
- **Effort:** S (<=2 dev-days) | M (<=1 week) | L (<=2 weeks) | XL (>2 weeks) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** TW ids (other domains allowed)
- **Summary:** 2-4 sentences, what the user gets.
- **Actors & access:** who can do it; permission keys; plan/feature-flag/limit gates; workspace vs platform scope.
- **UX & screens:** each screen/modal/tab (blade path under resources/views), fields, controls, validation, states, empty/error copy meaning, keyboard/realtime behavior.
- **Endpoints:** table of `METHOD uri | route name | Controller@action | middleware | request fields | response/redirect`.
- **Data:** tables/columns read and written; enums; JSON shapes; ordering/pagination.
- **Rules & edge cases:** numbered list. Include limits, defaults, idempotency, race conditions, timezone handling, encryption-at-rest of secrets, phone/locale normalization, dedup rules, what happens on delete.
- **Async & events:** queued work, sweepers, node-bridge calls, schedules, webhooks in and out, broadcast (websocket) events, mails, push, audit-log entries.
- **External systems:** vendor, endpoint used, auth method, credentials location (admin setting / workspace setting / .env), rate limits, failure handling.
- **Settings:** admin/workspace settings and .env keys that change this feature's behavior, with defaults.
- **Acceptance criteria:** Given/When/Then bullets, testable end to end (API + UI). At least 3, more for risky features.
- **Source refs:** paths relative to `reference/app/` (controllers, services, models, views, migrations, node files, docs page).
- **Port notes:** what already exists in this repo (module/table), a suggested home (`apps/api/src/modules/...`, `apps/web/...`), gotchas for the rebuild (RLS, tenant scoping, outbox, provider adapter, worker job).
```

A "feature" is the smallest capability that can be built, demoed and tested on its own — one
screen action or one background behavior, not a whole menu. Expect roughly 10-80 per domain
depending on size. Ids are `WD-<CODE>-<NNN>`, 3-digit, never reused, never renumbered (gap-sweep
additions continue from the highest existing number).

## Status values

- `implemented` — reachable and working in v1.7.0.
- `partial` — reachable but visibly incomplete (say what is missing).
- `docs-only` — advertised in the Reference documentation or UI copy but no working code path.
- `dead-code` — code exists but nothing reaches it (route missing, flag off, unused service).
- `beta` — behind an explicit beta/experimental flag.

## Coverage block

The last section of each file is a fenced block tagged `json threadwise-coverage`. It lists, as exact
strings from the manifests in `_work/manifests/`, everything in Reference this domain accounts for.
It is machine-audited: anything in Reference that no domain lists is reported as an orphan; anything
listed that is not in Reference is reported as a typo.

```json
{
  "routes": ["GET team-inbox", "POST team-inbox/{id}/assign"],
  "controllers": ["app/Http/Controllers/TeamInboxController.php"],
  "services": ["app/Services/Inbox/InboxAssigner.php"],
  "models": ["Conversation"],
  "tables": ["conversations"],
  "views": ["resources/views/user/team-inbox/index.blade.php"],
  "commands": ["inbox:escalate"],
  "permissions": ["inbox.view"],
  "middleware": ["app/Http/Middleware/EnsureTrialActive.php"],
  "node_files": ["node/services/broadcastService.js"],
  "js_assets": ["resources/js/wa-editor.js"],
  "misc_files": ["app/Mail/InvoiceMail.php"],
  "config_files": ["config/version.php"],
  "doc_pages": ["Documentation/pages/messaging/team-inbox.html"],
  "feature_map": { "TW-INBOX-001": ["GET team-inbox"] }
}
```

Rules:

- `routes` are `METHOD uri` exactly as in `routes.json` (`uri` has no leading slash; split multi-method routes into one entry per method; ignore HEAD and OPTIONS). Routes defined as closures count.
- Paths are relative to `reference/app/` (docs pages relative to `reference/`).
- `tables` are names from `tables.txt`; `models` are class basenames from `models.txt`.
- An item may appear in several domains when it is genuinely shared; say so in "Cross-domain contracts". Routes should have one home.
- `feature_map` (optional but preferred) maps feature ids to the routes they own; the parity tracker uses it.
- Files under `resources/views/vendor`, `resources/views/errors`, node `node_modules`, `node/baileys_auth`, and `node/config/.git` are out of scope.

## Ground rules for authors

1. Read the source, not just the docs. `Documentation/` is marketing-grade; use it to find advertised features, then confirm each in code and mark `docs-only` when absent.
2. `reference/` is read-only. Never edit, run migrations against, or delete anything there.
3. Method is static analysis plus read-only inspection of the local reference database (`SHOW CREATE TABLE`, `SELECT` on the seeded `threadwise` MySQL db). Do not start servers, run migrations/seeders/artisan commands that write, or send real messages/payments. Live behavior checks happen later, one feature at a time, with the `threadwise-verify-parity` skill.
4. When two domains touch the same code, write the behavior once in the domain that owns the data and reference it from the other.
5. No invented behavior. If unsure, write it under "Open questions & quirks" instead of asserting it.
