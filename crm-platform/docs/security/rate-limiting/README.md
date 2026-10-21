# Rate limiting (QA sheet 3, item 33)

Target: automated on PR, daily and pre-release; zero Critical or High release blockers.

## How it runs

| When                  | Command                       | What                                                                                  |
| --------------------- | ----------------------------- | ------------------------------------------------------------------------------------- |
| Pull request          | `pnpm qa:rate-limiting:quick` | route audit, tool tests, limiter unit tests, gate on the committed census             |
| Daily and pre-release | `pnpm qa:rate-limiting`       | adds Redis integration, booted API, census of 158 public routes, 10 probes, live gate |
| Any time              | `pnpm audit:rate-limits`      | static inventory plus the gate                                                        |

CI: `.github/workflows/rate-limit.yml`. Script: `script-testing/rate-limiting/`. Tools: `tools/rate-limit/`.

## Method

1. **Audit** reads every controller (2,055 routes, cross-checked against the verb-decorator count) and records who can call it unauthenticated, what abuse it invites (credential guessing, public write, provider callback, public read, costly) and the limiter it declares. Inventory: `route-inventory.json`.
2. **Census** sends a burst to each public route from a unique forged client address with a valid-shaped body, until the first 429 or a cap. A route that never answers 429 is "never limited". Evidence: `census.json`.
3. **Probes** cover limits the census cannot see (silent per-account caps) and the limiter's own properties.
4. **Gate** rules R1 to R7: a new public route needs a census record; an unlimited route needs a decision (severity, rationale, owner, expiry); Critical and High are never accepted; stale decisions are listed; 5xx under flood is High; a failed probe blocks at its declared severity; a deploy file that disables the limiter or trusts every proxy is Critical.

Severity: Critical is unlimited guessing of a low-entropy secret; High is unlimited abuse that costs money or harms third parties; Medium is unlimited attempts on high-entropy tokens or cheap reads; Low is static public content.

## Findings

| Id  | Severity             | Finding                                                                                                                                                                                         | Status                                                                |
| --- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| F1  | Medium               | 429 answers on credential routes had no `Retry-After` header                                                                                                                                    | Fixed in the problem filter                                           |
| F2  | Medium               | The throttle keyed on the raw address: IPv4-mapped IPv6 and plain IPv4 counted separately, and one IPv6 /64 could rotate through unlimited addresses                                            | Fixed: `clientKey`                                                    |
| F3  | Critical (16 routes) | Second-factor sign-in, workspace pick, partner login, password reset, email verification, signup set-password, invitation preview, platform MFA and setup token checks had no per-address limit | Fixed: `@Throttle('auth')` (refresh: 60 a minute, setup: 30 a minute) |
| F4  | Info                 | The auth module's own address counters still use `normalizeIp` without /64 grouping; the account-level guard still protects                                                                     | Follow-up                                                             |

After the fixes the live gate is GO: 88 of 158 public routes are limited, 70 carry a written Medium or Low decision, 0 answered 5xx, 10 of 10 probes pass.

Provider webhooks and OAuth callbacks are deliberately not throttled so real provider traffic is not dropped; they are rejected cheaply without a valid signature, secret or state (see the decisions).

## What this does not prove

Behaviour behind a real reverse proxy or CDN (the hop count is a deployment setting), production traffic shapes, one-time-code guessing across addresses (signup needs a mail domain that resolves), and authenticated per-user limits on routes without a declared limit.
