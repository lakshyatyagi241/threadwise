# Test runners

One folder per tested area under [script-testing/](../../script-testing/), each with `run.sh`, `meta.json` and `README.md`. The generated index (what each proves and does not prove, quick/full minutes, prerequisites, command, report path) is [script-testing/README.md](../../script-testing/README.md); the one-page overview is [script-testing.md](script-testing.md).

- List: `pnpm qa:script-testing:list`. Run all quick: `pnpm qa:script-testing:quick`. One: `bash script-testing/<test>/run.sh --quick`.
- Results: `qa-results/<timestamp>/summary.{html,md,json}`. Exit 0 all PASS, 1 any FAIL, 2 any ERROR.
- Shared helper: `script-testing/_lib/common.sh` (one file, used by all runners). Baseline of files failing on pristine `main`: `script-testing/known-failures.json`.
- Pending: `alerting` (branch `vedant/ops/alerting-tests`) has a placeholder `meta.json` and is skipped by `run-all.sh` until its runner lands.
