# Rate-limiting test

`bash script-testing/rate-limiting/run.sh [--quick] [--out DIR]` (exit 0 PASS, 1 FAIL, 2 ERROR; writes `result.json` and `logs/`).

- **Quick** (PR, about a minute, no boot): route audit (every controller route, its declared limiter), tool tests, limiter and bypass unit tests, the gate against the committed census.
- **Full** (daily, pre-release, about 3 minutes): adds integration specs on real Redis (concurrency across three limiters, clock skew at a window edge, counter expiry, Redis outage and recovery), a booted API on its own database, a census of every public route (a burst from a forged client address until the first 429), and ten probes: silent limits, distributed login guessing, `Retry-After`, atomic bursts, path and address-spelling variants, a forged `X-Forwarded-For` from an untrusted peer, response shape, counter expiry. The gate then judges everything.
- The gate (`tools/rate-limit/gate.mjs`) fails on any unresolved Critical or High: an unlimited public route needs a written decision in `tools/rate-limit/policy/decisions.json` (Medium or Low only, with owner and expiry); Critical and High must be fixed.
- `RL_UPDATE_EVIDENCE=1` copies the census to `docs/security/rate-limiting/census.json`. Do that after a deliberate change, with the new decision file, in the same commit.
- Uses an empty Redis db (10 to 15, 8, 7) so stale lockouts of earlier runs cannot affect it, and a throwaway database that is dropped on exit. Never touches the shared `crm` database. Local only.

Method, findings and limits: `docs/security/rate-limiting/README.md`.
