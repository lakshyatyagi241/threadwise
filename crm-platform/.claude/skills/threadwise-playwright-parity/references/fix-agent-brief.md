# Fix sub-agents

After triage, every real defect (and every `review` item you confirmed as a missing element) is fixed by a sub-agent, not by you inline. One agent owns one cluster from `clusters.json`: defects with the same cause, in the same layer.

## Orchestration

1. **Order by layer**, the same order a feature is built: db, contracts, api (modules, providers, worker), web. A web fix may depend on an API fix, so finish a layer before starting the next. Inside one layer, clusters about different screens or resources run in parallel (one message, several `Agent` calls, at most four); clusters that could touch the same files run one after the other.
2. **Agent type:** `general-purpose` (it needs every tool: edit, run, skills). No worktree isolation: the twin run needs the live stack of this checkout, and the agent verifies against it.
3. **Give each agent the brief below**, filled in from `clusters.json`, the report and the inventory entry. Do not paste Reference text or markup into it: describe the behaviour ("Reference rejects a name of 192 characters; the limit is 191") and name the scenarios.
4. **Wait, then verify yourself:** re-run only the affected scenarios (`parity.sh rerun <runDir> <spec> '<regex>'`), then `parity.sh compare <runDir>`. An agent saying "fixed" is a claim; the re-run is the evidence.
5. **At most three rounds.** Still-failing clusters after round three become `open-defects`: say so, with the evidence, and mark the tracker row `blocked` (or leave it `done` without `verified`). Never loop forever and never lower the bar to get green.
6. **If you are yourself a sub-agent and cannot spawn agents**, fix the clusters one by one in this same order, following the same rules.

## Statuses an agent may return

| Status     | Meaning                                                                                    | You do                                                                             |
| ---------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `fixed`    | change made, its own re-run is clean                                                       | verify with your re-run                                                            |
| `partial`  | some scenarios fixed, the rest named with the reason                                       | next round for the rest                                                            |
| `disputed` | the agent believes the finding is a false positive or the right behaviour; gives evidence  | re-triage: fix the spec (spec-issue), record `intended` with a reason, or overrule |
| `blocked`  | needs a kernel change, another owner's zone, an ADR, a decision, or an unavailable service | report it, mark the tracker row `blocked` with the id/owner it waits for           |

## The brief (fill the placeholders)

```text
You are fixing parity defects between Reference (the reference product we are porting) and our new platform, found by the Playwright twin test of <feature id and title>. Fix ONLY your cluster, then prove it.

Rules that override everything else
- Reference is behaviour reference only. Never copy its code, markup, CSS, images, copy text or migrations into this repo. Read the inventory entry and the evidence below, then build our own version in this repo's patterns. Evidence screenshots and snapshots are for understanding behaviour; do not paste their text into code, messages, tests or docs.
- Follow this repo's rules (CLAUDE.md, CONTRIBUTING.md, the ADRs) and use the repo's skills for each kind of change instead of writing from memory: add-migration, contracts-change, new-module, rbac-permission, outbox-event, worker-job, provider-adapter, webhook-handler, threadwise-frontend-port, frontend-api-call.
- Stay inside the zones of domain <domain> (<list of zone globs from docs/threadwise-port/ownership.json or detect_scope.py>). A fix that needs the shared kernel, another domain's files, a new dependency or an architectural decision is not yours to make: stop, return status `blocked`, say exactly what and who.
- Do NOT edit the twin spec, the harness, the inventory or the `intended` list to make a finding disappear. If you believe a finding is wrong, return `disputed` with evidence.
- Do not commit or push. Do not touch Reference (read-only). Never delete or change data that this run did not create (test data carries the prefix <tag base>).

Your cluster <C#>: <title>   severity <sev>   layer <layer>
What differs (Reference -> ours), per scenario:
- <scenario id>: <key>: <Reference value> -> <our value>
...
Behaviour description from the inventory entry (<inventory file>, <feature id>): <the relevant Rules & edge cases / UX bullets, paraphrased>
Evidence: run directory <runDir>; report <runDir>/report.md; screenshots <runDir>/shots/<scenario>/; raw observations <runDir>/results/{threadwise,ours}/<scenario>.json

How to work
1. Reproduce: <parity.sh rerun command for these scenarios>. Confirm you see the same difference.
2. Find the cause in our code and fix it properly (root cause, not the symptom the test happens to check).
3. Run the checks for the layers you touched: pnpm --filter <pkg> test (unit), typecheck, and the repo gate pieces that apply.
4. Re-run the same scenarios (parity.sh rerun ...). They must now be `same` or a legitimately `intended` difference that you describe (the orchestrator decides intended).

Return, as the last message, exactly:
status: fixed | partial | disputed | blocked
files changed: <paths>
scenarios now passing: <ids>
still failing / not addressed: <ids and why>
needs from others: <kernel change / owner / ADR / decision, or none>
notes: <one short paragraph, behaviour terms only>
```

## After the loop

Write the final state, not the history: the parity rows for `docs/threadwise-port/parity/<domain>.md` come from `<runDir>/parity-rows.md` after the last compare (same / intended with reasons; no open defect stays in the file as "history"). Then stamp (`stamp.py write --status fixed|clean|open-defects ...`). If a sub-agent changed inventory-relevant behaviour you learned about Reference, correct the inventory entry (you own your domain's file).
