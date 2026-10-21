# script-testing

One folder per test. Each folder has its own `run.sh`, `meta.json` and `README.md`. Running a folder's `run.sh` repeats that test end to end (provisions what it needs, runs the exact checks that were run when the area was tested, writes `result.json`, cleans up), so nobody has to test by hand again.

## Run

```bash
bash script-testing/run-all.sh --list                  # all tests, heavy flag, minutes, needs (PENDING ones included)
bash script-testing/run-all.sh --quick                 # every test, small real profile
bash script-testing/run-all.sh --full --skip heavy     # everything except heavy tests
bash script-testing/run-all.sh --only ssrf,cache-hit-rate --jobs 2
bash script-testing/<test>/run.sh --quick              # one test
bash script-testing/run-all.sh --self-test             # the master checked against two fake tests
```

Options: `--only a,b` (folder names or sheet item numbers), `--skip heavy,name`, `--quick|--full` (default full), `--jobs N` (light tests in parallel, default 2; heavy tests always run alone, last), `--out DIR` (default `qa-results/<timestamp>`), `--fail-fast`. A pre-check of the union of every selected test's `needs` (docker, node22, pnpm, free ports) runs first and exits 2 with the missing items.

Results: `qa-results/<timestamp>/<test>/result.json` and `runner.log` per test, plus `summary.json`, `summary.md` and a self-contained `summary.html` (status chips, durations chart, exact re-run command per test). `qa-results/` is git-ignored.

Exit codes (master and every `run.sh`): `0` PASS, `1` FAIL (the area's checks failed), `2` ERROR (could not run: prerequisite or infra). The master exits 2 if any test errored, else 1 if any failed, else 0.

Known-baseline policy: test files that fail on pristine `main` are listed in `_lib/known-failures.json`. A runner compares its failing files with `node script-testing/_lib/known-baseline.mjs <vitest-json-or-log>` and reports them as `knownBaseline`, never as its own failures. Remove an entry when main is fixed.

## Add a test folder

1. `script-testing/<name>/` with `run.sh` (source `../_lib/common.sh`; supports `--help`, `--quick`, `--full`, `--out DIR`; exit 0/1/2; cleans up with a trap), `meta.json`, `README.md`.
2. `meta.json`: `{"id","sheetItem","title","script":"run.sh","estMinutes":{"quick":N,"full":N},"heavy":bool,"needs":["docker","node22","pnpm","postgres","redis"],"ports":[...],"proves","doesNotProve","report"}`. A folder with `"status":"pending"` and a `note` is listed but skipped.
3. `run.sh` writes `<out>/result.json`: `{"id","title","mode","status":"PASS|FAIL|ERROR","startedAt","finishedAt","durationSeconds","checks":[{"name","status","detail"}],"counts":{"tests","passed","failed","knownBaseline"},"artifacts":[],"commands":[]}`.
4. Run `node script-testing/_lib/gen-index.mjs` to refresh the table below. Never touch another test's folder.

`_lib/common.sh` is the documented shared helper (logging, prerequisite checks, result.json writer, cleanup trap). `_lib/common-security.sh` and `_lib/common-integration.sh` stay until merged.

## All tests (generated from the meta files, do not edit by hand)

<!-- GENERATED:START -->
| Test | Title | Heavy | Min quick / full | Needs | Command | Proves | Does not prove | Report |
|---|---|---|---|---|---|---|---|---|
| [vapt](vapt/) | VAPT baseline | PENDING | - | - | - | runner to be added from branch vedant/security/vapt-baseline | - | - |
| [memory-profiling](memory-profiling/) | Memory profiling | PENDING | - | - | - | runner to be added from branch vedant/perf/memory-profiling | - | - |
| [alerting](alerting/) | Alerting rules tests | PENDING | - | - | - | runner to be added from branch vedant/ops/alerting-tests | - | - |
| [monitoring-dashboards](monitoring-dashboards/) | Monitoring stack: Prometheus, rules and every Grafana panel | no | 6 / 10 | docker, node22, pnpm, postgres, redis | `bash script-testing/monitoring-dashboards/run.sh --quick` | Real API, worker and probe expose /metrics; a private Prometheus (v2.55.0) scrapes them with the repo's own prometheus.yml and rule files; all targets are UP, no rule has health=err, every Grafana (11.3.0) dashboard loads and the query of every panel runs without error against live data. | Alert delivery (no Alertmanager), the web server job (not started), behaviour under production load, panels that need authenticated sockets, 5xx errors or release history (see expected-empty-panels.json). | `qa-results/<timestamp>/monitoring-dashboards/panels.json and screenshots/` |
<!-- GENERATED:END -->
