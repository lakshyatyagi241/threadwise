---
name: threadwise-playwright-parity
description: >-
  Automatic Playwright twin test after ANY feature is built or changed, small or
  big: run the same scenarios on the Reference reference and on our new app, compare
  UI, UX and functionality with the full set of edge cases (validation and
  boundaries, empty/error/offline states, permissions, keyboard, responsive,
  a11y, double submit, XSS), report every difference as same / intended / defect,
  then spawn fix sub-agents for the defects and re-run until clean. It runs by
  itself: a Stop hook blocks the end of a turn while feature files changed and no
  parity run covers them, and threadwise-port-feature calls it. Also use it when
  someone says "parity test", "compare with threadwise in the browser", "playwright
  compare", "test the feature on both", "did I miss anything vs threadwise", "what is
  missing from this feature", "edge cases against threadwise", "verify the feature
  automatically", or right after finishing, porting or changing any screen,
  endpoint, contract, migration or worker job. Never tell the user a feature is
  done without it.
---

# Playwright twin test: Reference vs our build

The same scenarios run on the **running Reference** (the oracle) and on **our app**, in Playwright, then a comparator reports every difference in behaviour, structure and robustness. Defects go to fix sub-agents; the run repeats until clean. `threadwise-verify-parity` is the manual version of this; this skill does it automatically, with far more cases than anyone writes by hand.

Paths below are relative to `crm-platform/`. One wrapper does everything: `bash .claude/skills/threadwise-playwright-parity/scripts/parity.sh <command>` (called `parity.sh` below).

## When it runs (you do not wait to be asked)

- **Stop hook** (`scripts/stop_gate.py`, wired in `.claude/settings.json`): when feature files differ from the base branch (api modules and providers, web, partner, contracts, db schema/migrations/seeds, excluding tests/docs) and no stamp covers that exact content, the turn cannot end. The message tells you to invoke this skill. It blocks at most twice per state and never when `stop_hook_active` is set.
- **`threadwise-port-feature`** step 3 invokes it explicitly. Do not leave it for the hook.
- **By request** or whenever a feature, screen or endpoint was finished, ported or changed in this conversation.
- Opt out only on the user's word: `stamp.py write --status skipped --user-approved "<their words>"`; for the whole clone `stamp.py disable`; `PARITY_GATE=off` for one command.

## Hard rules

1. **Behaviour only.** Never copy Reference code, markup, copy text, images or migrations. Run artifacts (screenshots, snapshots, traces) live in `${TMPDIR:-/tmp}/threadwise-parity-$USER/<run>/`, never in the repo. What goes into `docs/` is paraphrased behaviour.
2. **Reference is read-only.** Only normal app use, with test data tagged by the run prefix and removed again. No real provider sessions, messages or payments.
3. **Delete only what this run created.** Cleanup goes through `c.deleteOwned` / `c.isMine`. An API that de-duplicates answers a create with an existing row; deleting that row destroys seed data (this happened once: a seeded contact was deleted and had to be restored).
4. **Never fuzz credential forms** (login, reset, MFA). Page probes only there.
5. **Honest results.** Environment blocked is `blocked-env`, not a pass. `skipped`, `spec-issue`, `review` and `open-defects` are reported as such.
6. **Never make it green by weakening it**: no editing the harness, the spec's expectations or `intended[]` to hide a finding. A wrong finding is a spec fix or a recorded `intended` with a reason.
7. Nothing is committed or pushed unless the user asks.

## Procedure

### 0. Scope

```bash
python3 .claude/skills/threadwise-playwright-parity/scripts/detect_scope.py --text      # JSON without --text
```

It lists the feature files, layers, domains, TW ids (from the branch name, commits, tracker), derived API/web routes, whether the change has a comparable `surface`, existing twin specs and the stamp state.

- `surface: false` (module wiring, barrels only): `detect_scope.py --stamp-if-trivial`, one line to the user, done.
- No TW id found: search the inventory for a counterpart (`threadwise-feature-lookup`: route/table/keyword). Still nothing: it is a platform-only feature, use `adhoc:<slug>`; run with `--sides ours` later (judged against absolute expectations: no console/page errors, no a11y or keyboard regressions, no XSS, no 5xx).
- Several features: one spec per feature (or one spec when they share screens).

### 1. Environment

```bash
bash .claude/skills/threadwise-playwright-parity/scripts/parity.sh ready
```

Installs the pinned harness (Playwright 1.60.0 + axe-core into `harness/node_modules`; never touches the pnpm workspace), checks for the matching Chromium and starts what is missing: Reference (via `threadwise-run-reference`), the infra containers, **this checkout's** API on a free port (never another clone's server: it may run other code) and the web app when `apps/web` has a `dev` script. Exit 3 = Chromium missing: ask the user before `bootstrap.sh --install-browsers` (about 150 MB). If Reference or our API cannot start, stop, stamp `blocked-env` with the reason and tell the user.

`apps/web` not built yet is a legitimate state: UI scenarios on our side report `missing UI`, which is a defect to build (`threadwise-frontend-port`), unless the feature has no UI. API-level scenarios still run.

### 2. Learn the behaviour

Read the inventory entry (`find_feature.py TW-XXX-NNN`): UX & screens, Rules & edge cases, Acceptance criteria, every `QUIRK:`. Look at the real screens with the same lens the comparator uses:

```bash
parity.sh explore threadwise /contacts --click "add contact" --root "#form"      # fields, kinds, labels, limits, buttons
parity.sh explore ours /contacts
parity.sh explore ours /login --anonymous
```

### 3. Write or refresh the twin spec

`apps/web/e2e/<domain>/parity/<TW-ID>.twin.mjs` (format: `references/spec-format.md`; start from `harness/specs/example.*`). Declare the pages, forms, lists and deletes the feature has; the harness generates the matrix. Then walk `references/scenario-catalog.md` top to bottom: every line is generated, written as a custom scenario, or skipped with a real reason. Check the size before running:

```bash
parity.sh list apps/web/e2e/<domain>/parity/TW-XXX-NNN.twin.mjs
```

Add `intended[]` entries only for decisions that exist (an inventory `QUIRK` you deliberately fix or keep), each with a reason. Do not add them to silence findings.

### 4. Run

```bash
parity.sh run apps/web/e2e/<domain>/parity/TW-XXX-NNN.twin.mjs --depth full      # quick | standard | full
```

Budget about 2 to 4 seconds per scenario per side, divided by `--workers` (default 2). A long run: start it detached and poll the log (the shell tool gives up after 10 minutes):

```bash
OUT=$(mktemp -d); ( setsid nohup bash .claude/skills/threadwise-playwright-parity/scripts/parity.sh run <spec> --depth full >"$OUT/run.log" 2>&1 & )
until grep -qE "VERDICT|ENVIRONMENT NOT READY|invalid twin spec" "$OUT/run.log"; do sleep 5; done; tail -20 "$OUT/run.log"
```

The run prints a VERDICT and the report paths. Exit codes: 0 clean, 1 defects or review items, 2 bad spec or usage, 3 environment not ready. Use `--only 'regex'` / `--only tag:xss` while iterating.

### 5. Triage (you, not an agent)

Open `report.md`. For each row:

| What you see                                           | Decision                                                                                                                  |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| defect, behaviour really differs                       | real: goes to a fix agent                                                                                                 |
| defect `missing` / locator not found on ours           | check with `explore ours`: really absent (build it) or wrong locator (fix the spec)                                       |
| difference the repo decided (ADR, CONTRIBUTING, QUIRK) | `intended[]` with the reason and reference; architecture rules are matched automatically                                  |
| ours stricter or better than Reference                    | still a difference: record it as `intended` (a deliberate fix of a Reference bug) with the reason, or revert                 |
| `review` structure items                               | look at `gallery.html` / `shots/` (read the PNGs); a missing element is a defect, otherwise ignore or `severity` override |
| `spec-issue`                                           | the test is wrong: fix the spec and re-run; never touch the app                                                           |

Architectural decisions that are not yet written down (a new rule, a deliberate behaviour change) go to the user, with an ADR via `write-adr`, before they become `intended`.

### 6. Fix with sub-agents

Follow `references/fix-agent-brief.md`: one `general-purpose` agent per cluster in `clusters.json`, ordered by layer (db, contracts, api, web), disjoint clusters in parallel (at most four), each with the brief. After they return, re-run only what they touched and compare:

```bash
parity.sh rerun <runDir> <spec> '^(scenario\.id\.one|scenario\.id\.two)$'
parity.sh compare <runDir>
```

At most three rounds. Still failing after that: `open-defects`, reported with evidence. An agent that needs a kernel change, another owner's zone or a decision returns `blocked`; you report it and mark the tracker row `blocked`.

### 7. Record and close

1. `docs/threadwise-port/parity/<domain>.md`: the final rows from `<runDir>/parity-rows.md` under `## TW-XXX-NNN — title` (template in `threadwise-verify-parity`). Same / intended with reasons only; no open defect stays as history; no screenshots, no Reference text.
2. Keep the twin spec with the feature (it is code in the domain's e2e zone and the regression test for the next change).
3. Stamp what happened:

```bash
python3 .claude/skills/threadwise-playwright-parity/scripts/stamp.py write --status clean|fixed|open-defects|blocked-env|skipped \
  --report <runDir>/report.md --features TW-XXX-NNN --domains <domain> --defects <open count> --note "<one line>"
```

4. Tracker: `tracker.py set TW-XXX-NNN verified --pr N` only for `clean`/`fixed` with every `review` item decided and nothing env-blocked; otherwise leave `done` (or `blocked`) with a note.
5. `bash .claude/skills/threadwise-playwright-parity/scripts/env.sh down` stops only what `env.sh up` started (our API, our web app); Reference and the containers keep running.
6. Run the repo gate (`pre-pr`) when fix agents changed code.

Final message to the user: the verdict line, counts (same / intended / defects found / fixed / open / review), what the sub-agents changed, what could not be compared and why, and the paths (`report.md`, `gallery.html`, parity doc).

## Files

| Path                                                                   | What                                                                                                          |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `scripts/parity.sh`                                                    | wrapper: ready, list, run, rerun, compare, explore, selftest                                                  |
| `scripts/env.sh`, `scripts/bootstrap.sh`                               | bring the apps up / install the harness                                                                       |
| `scripts/stop_gate.py`, `detect_scope.py`, `stamp.py`, `parity_lib.py` | the automatic trigger, scope detection, stamps (state in `<git-dir>/threadwise-parity/`)                          |
| `scripts/test_scripts.py`                                              | tests for the three scripts above (throwaway git repo)                                                        |
| `harness/run.mjs`, `compare.mjs`, `explore.mjs`                        | twin run, report rebuild, screen explorer                                                                     |
| `harness/lib/`                                                         | sides (Reference, ours), probes (page, form, list, delete), value catalogues, comparator, intended rules, report |
| `harness/selftest.mjs`, `lib/mutants.mjs`                              | proves the comparator: no false alarms on Reference-vs-Threadwise, every planted defect found                        |
| `references/`                                                          | `spec-format.md`, `scenario-catalog.md`, `comparison-rules.md`, `fix-agent-brief.md`                          |

Environment overrides: `PARITY_WEB_URL`, `PARITY_API_URL`, `THREADWISE_URL`, credentials (`THREADWISE_EMAIL/PASSWORD`, `PARITY_ORG/EMAIL/PASSWORD`; defaults are the local seeded test accounts), `PARITY_DEPTH`, `PARITY_WORKERS`, `PARITY_OUT`, `PARITY_HEADED=1`, `PARITY_CONFIG=<json>`.

## Verified, and not

Run against this repo and the live Reference: the harness selftest (Reference against itself: zero defects; 7 planted defects all found), a twin run of Reference against this checkout's API (contact creation, 26 scenarios), a page-level twin run against the web app of another clone (login and contacts screens, with our UI login), the hook script and scope detection under test. **Not exercised here:** starting `apps/web` from `env.sh` (this checkout has none yet; the command is built from `PARITY_WEB_CMD`/the `dev` script), the sub-agent loop (it is orchestration you perform, there is nothing to run), and the hook firing inside a fresh Claude Code session (needs a restart to load `.claude/settings.json`).
