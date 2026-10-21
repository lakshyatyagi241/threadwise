# Script testing (one command per tested area)

Every area that was tested has a folder `script-testing/<test>/` with `run.sh`, `meta.json` and `README.md`. Running the script repeats the whole test (provision, run the exact checks, write `result.json`, clean up) so nobody re-tests by hand.

- Index of all tests (generated from the meta files, never stale): [script-testing/README.md](../../script-testing/README.md)
- Everything: `pnpm qa:script-testing` (full), `pnpm qa:script-testing:quick`, `pnpm qa:script-testing:list`
- One test: `bash script-testing/<test>/run.sh --quick`
- Results: `qa-results/<timestamp>/summary.html` (status chips, durations, the exact re-run command per test), plus `summary.json` and `summary.md`. Exit 0 all PASS, 1 any FAIL, 2 any ERROR.
- Known failures on pristine `main` are listed in `script-testing/_lib/known-failures.json` and reported as "known baseline", not as failures.
- Adding a test: see "Add a test folder" in the index README. CI: `.github/workflows/script-testing.yml` (manual trigger only for now).
