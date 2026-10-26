---
name: security-review-gate
description: >-
  Mandatory security and code review before any change is called done, ready,
  or opened as a PR. Runs this repo's own audits (tenancy, authz, auth, RLS,
  dependency audit, secret scan) and then the built-in `security-review` and
  `code-review` skills on the diff, and fixes every confirmed finding. Use
  after ANY change to apps/api, apps/web, apps/partner, apps/mobile,
  packages/db, packages/contracts or a worker job, and whenever someone says
  "security review", "is this safe", "review my diff", "audit this", "check
  for vulnerabilities", "open a PR" or "is this ready". Never report a change
  as done on the strength of "the code looks right".
---

# Security review gate (mandatory)

Idea taken from evaluating Anthropic's `oss-scanner`: model-driven review
finds real bugs, but its reports are unreviewed, so every finding must be
checked against the code before acting on it. `oss-scanner` itself is not
used here (it targets public open-source repos and sends code to an
external service; the licensed Reference source must never leave the project).

## Steps, in order

1. **Repo audits** (fast, deterministic; fix every failure first):
   ```bash
   pnpm audit:tenancy && pnpm audit:authz && pnpm audit:auth
   pnpm audit --prod --audit-level high
   ```
   If the diff touches `packages/db/migrations/`, also run the `add-migration`
   skill's `check-rls.sh` against the live database. RLS enabled AND forced,
   `tenant_isolation` policy, composite `(org_id, id)` keys.
2. **Secret scan of the diff.** Look for tokens, keys, passwords, `.env`
   values and provider credentials in added lines. If `gitleaks` is
   installed run `gitleaks detect --no-banner --log-opts "origin/main..HEAD"`.
3. **Invoke the `security-review` skill** (Skill tool) on the current branch.
4. **Invoke the `code-review` skill** (Skill tool, `high` effort, or `xhigh`
   when the diff touches auth, money, messaging, webhooks or RLS).
5. **Triage.** Read the cited code for each finding. Mark it confirmed,
   false positive or needs-owner-decision. Fix confirmed ones, rerun the
   step that found them, and say plainly which findings you dismissed and why.
6. **Record the stamp** (only after steps 1-5 ran on this exact state):
   ```bash
   python3 .claude/skills/security-review-gate/scripts/stamp.py write --status clean|fixed|open-findings|blocked-env \
     --confirmed N --fixed N --dismissed N --note "..."
   ```
   A later edit to a covered file changes the fingerprint, so re-run the gate and stamp again.
7. Then run the `pre-pr` skill.

## The Stop hook

`.claude/settings.json` runs `scripts/stop_gate.py` when a turn ends. If code under `apps/*/src`, `packages/*/src|migrations`,
`tools/`, workflows, Dockerfiles or dependency manifests differs from `main` and no stamp covers its exact state, the turn is
blocked and you must run this skill. It blocks at most twice per state, never loops, and fails open on any error.
Skip only on the user's explicit word: `stamp.py write --status skipped --user-approved "<their words>"`.
`stamp.py status|list|disable|enable` manage it; `SECURITY_GATE=off` disables it for one run.

## Always check by hand (the review tools miss these)

- Every tenant query runs inside the RLS session; no bare `db` handle bypass.
- New routes have a permission via `rbac-permission`; no route is public by accident.
- Inbound webhooks verify signature and are idempotent (`webhook-handler`).
- No bare ids leak across tenants in responses; no PII or tokens in logs.
- Mobile: tokens only in the keychain; see `mobile-quality-review`.

## Report

End with: audits run and result, findings by verdict, what was fixed, and
anything left for the owner. Do not say "secure". Say what was checked.
