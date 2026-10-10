# Authentication audit

One command, one report. It reads the code, attacks the product's own security functions with hostile input, runs the
existing auth tests, scans dependencies and secrets, and (optionally) attacks a running **local** API. It scores the
result against the 100-control standard in `lib/controls.mjs` and writes an HTML and Markdown report with a release
verdict.

```bash
pnpm audit:auth                      # quick: static + runtime probes + auth unit tests + deps + secrets   (~3 min)
pnpm audit:auth -- --install         # same, installing/building the workspace first if it was never done
pnpm audit:auth -- --full            # + integration and e2e suites (Docker Desktop must be running)
pnpm audit:auth -- --live --org <slug> --email <dev-user> --password '<dev-password>'
                                     # + attacks on a running local API (start it first: pnpm dev)
```

Output (nothing here is committed; `reports/` ignores itself):

| File                                    | What                                                              |
| --------------------------------------- | ----------------------------------------------------------------- |
| `reports/auth-audit/latest/report.html` | the report (self-contained, light/dark, filterable control table) |
| `reports/auth-audit/latest/report.md`   | the same, as Markdown (paste into a PR or ticket)                 |
| `findings.json`, `controls.csv`         | machine-readable findings; the 100-control matrix                 |
| `results.json`, `tests.json`            | every check result; test execution + inventory                    |
| `manifest.json`                         | SHA-256 of every artefact + git commit + dirty flag (integrity)   |
| `reports/auth-audit/<timestamp>/`       | the same files for each run (history)                             |

Exit code: `0` GO or CONDITIONAL, `20` NO-GO, `10` CONDITIONAL with `--strict`. That is what a CI gate reads.

## Reading the verdict

- **NO-GO**: an open Critical/High finding, or an existing test fails.
- **CONDITIONAL**: no blockers, but an applicable P0 control is not yet Pass/Accepted, or a test layer did not run.
- **GO**: no open Critical/High, every applicable P0 control Pass or Accepted, every test layer ran.

Control statuses: **Pass** (a check or an executed test supports it) · **Fail** · **Partial** (implemented, weaker
than the standard) · **Needs decision** (works as designed, the standard asks for something different) ·
**Not implemented** (the feature does not exist, e.g. passkeys) · **Not run** (a check exists but could not execute) ·
**Not assessed** (this tool has no check for it: it is _not_ a pass) · **Accepted risk** (a recorded decision).
A check that cannot run reports _why_; it is never counted as a pass.

## Recording decisions

Some findings are choices, not bugs (WaDesk parity, fail-open on Redis errors, default MFA settings). Record the answer once:

```json
// tools/auth-audit/decisions.json   (see decisions.example.json)
{
  "redis-failure-behaviour": {
    "decision": "accepted",
    "reason": "Access tokens are 15 min; an alert on Redis errors pages us; revisit after the Q1 incident drill",
    "by": "lakshya",
    "date": "2026-10-09",
    "expires": "2027-01-09"
  }
}
```

`decision` is `accepted`, `deferred` or `fixed-elsewhere`. `reason`, `by` and `date` are required; an entry without
them is ignored (and listed). When `expires` passes, the finding re-opens. Accepted findings stay visible in the report.

## The public-route baseline

`baseline/public-routes.json` is a snapshot of every `@Public()` route. A new public route fails the audit
(`public-route-drift`) until a human looks at it (does it need login? is it throttled or signed?) and re-records the
baseline: `pnpm audit:auth -- --update-baseline`. Authentication is opt-out in this product, so the list of opt-outs is
the attack surface.

## What runs

| Phase           | What it does                                                                                                                                                                                                                                 |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Static checks   | ~50 checks that read the source (guards, sessions, tokens, MFA, recovery, cookies, CORS, headers, API keys, WebSocket, audit events, CI…)                                                                                                    |
| Runtime probes  | the product's own TOTP, recovery-code, password-policy, IP allow-list, return-URL, crypto and redaction code, plus JWT attacks, fed hostile input; measures Argon2 parameters (`probes/pure.probe.mts`, run through the API package's `tsx`) |
| Existing tests  | executes the auth unit tests (api + web); with `--full` also integration and e2e; maps each test file to controls                                                                                                                            |
| Dependencies    | `pnpm audit --prod`; high/critical advisories in auth-relevant packages block                                                                                                                                                                |
| Secrets         | working-tree scan with high-signal patterns; gitleaks too, if installed (history)                                                                                                                                                            |
| Live (`--live`) | forged JWTs, malformed bodies, header/CORS checks, enumeration and timing parity, lockout, logout and refresh-reuse revocation, WebSocket handshake                                                                                          |

Live probes refuse any non-local host (`--allow-remote` overrides; never point them at production), use only the
credentials you pass, and send a small bounded number of requests. They exercise the login throttle on purpose, so
after a run wait ~5 minutes before running again from the same address.

## Does the audit itself work?

`node tools/auth-audit/selftest/live-mock.mjs` runs the live probes against an in-process mock API twice: a correct
one (every probe must pass) and a deliberately broken one (accepts forged tokens, leaks stack traces, reflects CORS
origins, has no lockout, survives logout, misses refresh reuse, admits anonymous sockets; every probe must notice).
Run it after editing `lib/checks-live.mjs`.

## Adding or changing a check

Checks are plain functions in `lib/checks-static.mjs` (code reading), `lib/checks-runtime.mjs` (execution) and
`lib/checks-live.mjs` (HTTP). A check returns `result({ id, controls: ['AUTH-0nn'], title, status, severity, summary,
evidence, recommendation })`. Rules that keep the audit honest:

1. Derive the verdict from the code, never hard-code `pass`. If the code you expect is gone, return `status: 'error'`.
2. Evidence is `file:line` from the actual source.
3. Say what you did **not** verify in `summary`.
4. Link the check to every control it genuinely supports; unlinked controls show as Not assessed.
5. Map new test files to controls in `lib/inventory.mjs` (`TEST_CONTROL_MAP`) so executed tests count as evidence.

## CI

The workflows live at the repository root (GitHub only runs workflows from there):

- `.github/workflows/auth-audit.yml`: **PR** (quick mode, only when authentication code changed), **nightly** (`--full`, Docker is available on the runner) and manual. NO-GO fails the job; the report is uploaded as an artifact and shown in the job summary.
- `.github/workflows/security-scan.yml`: CodeQL (JavaScript/TypeScript, security-extended) and gitleaks over the whole git history. gitleaks needs a `GITLEAKS_LICENSE` secret on an organisation-owned repository. Also switch on GitHub secret scanning with push protection.
- Pre-release: run `node tools/auth-audit/run.mjs --full --live ... --strict` against a throwaway stack built from the release commit (the same services as `integration.yml`), so CONDITIONAL also blocks.
- Sign the evidence by running `cosign sign-blob` (or your signing tool) over `manifest.json` in the workflow.

## Windows notes

- `@swc/core` (vitest, Nest build) refuses to load when its native-addon cache folder inherits unexpected permissions
  (OneDrive, sandboxed shells) or the path is too long. The audit sets `SWC_NATIVE_BINDING_CACHE` to `%USERPROFILE%\.swc-native`
  for the processes it starts. If you run `vitest` by hand and see `ERR_SWC_NATIVE_CACHE`, set the same variable.

## Limits

An automated run cannot prove the absence of vulnerabilities. Row-level-security data isolation, payment and messaging
flows are out of scope. Narrative numbers in finding summaries (for example "tombstones live 16 minutes") were written
from the code on the analysis date (`lib/analysis.mjs`); the checks verify the properties that matter, but re-read the
summaries when the code changes. Keep a human security review for changes to login, sessions, MFA and recovery.
