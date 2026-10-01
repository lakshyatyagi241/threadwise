---
name: threadwise-inventory-refresh
description: >-
  Regenerate the machine manifests of the Reference reference app and audit the
  feature inventory against them: which routes, tables, models, services, views,
  permissions, commands, node files and docs pages are not accounted for by any
  inventory feature, which claims are typos, which feature entries are
  malformed. Use this whenever someone says "is the inventory complete", "audit
  the inventory", "coverage of threadwise", "regenerate manifests", "threadwise was
  updated to a new version", "did we miss any threadwise feature", "lint my
  inventory file", or after editing any file in docs/threadwise-port/inventory.
---

# Inventory coverage audit

`gen_manifests.sh` dumps everything that exists in Reference (exact route list from
`php artisan route:list`, all files by category, DB tables, permissions) to
`../_work/manifests/`. `audit_coverage.py` then reads the `threadwise-coverage` JSON
block at the end of every `docs/threadwise-port/inventory/*.md` and diffs it against
those manifests, and lints each feature entry (required fields, valid
status/priority/effort, Given/When/Then acceptance criteria).

Needs the reference app prepared as in the `threadwise-run-reference` skill (PHP 8.2 + the local DB).

```bash
R=.claude/skills/threadwise-inventory-refresh/scripts
bash $R/gen_manifests.sh                          # -> ../_work/manifests  (override with THREADWISE_MANIFESTS)
python3 $R/audit_coverage.py                      # -> ../_work/reports/coverage.{md,json}
python3 $R/audit_coverage.py --only team-inbox-conversations   # lint one domain file
python3 $R/routes.py --uri team-inbox --ctrl Deals   # query the route manifest (filters OR together)
python3 $R/routes.py --closures                      # routes defined as closures
```

## Reading the report

- **orphans**: exists in Reference, claimed by no domain. Every orphan is a feature nobody will
  port. For each: add it to the right domain (new feature id continuing the numbering, add the
  path/route to that file's coverage block) or, if it is genuinely out of scope, say why in the
  domain's "Open questions & quirks" and list it in the coverage block anyway.
- **unknown (typo)**: claimed but not in Reference. Fix the string.
- **multi-claimed**: several domains claim it. Fine for genuinely shared files; a route should have one home.
- **lint issues**: fix in the inventory file.

Coverage blocks may claim a whole directory with a trailing `/` (for example `resources/js/charts/`).

## Reference version upgrades

Reference ships as a base plus update zips (`Update/update_1.2.zip` ... `1.7`). After a new version
lands in the reference app: run migrations there, regenerate manifests, run the audit, and treat
the new orphans as the diff to inventory. Record the new `threadwise_version` in each touched
domain's front matter.

## Checklist workbook (Google Sheets)

`build_checklist_xlsx.py` turns the inventory, `ownership.json`, `assignment-input.json` and `showcase-plan.json` into one
workbook: a `Features` tab with one row per `### WD-...` feature (all spec fields, owner, wave, status dropdowns), a `Modules`
tab with live rollups, plus `Today`, `Foundation`, `Decisions` and `Guide`. Nothing is retyped, so no feature can be dropped.

```bash
python3 .claude/skills/threadwise-inventory-refresh/scripts/build_checklist_xlsx.py      # -> ../_work/out/Threadwise-Port-Checklist.xlsx
```

Import it with Drive > New > File upload > Open with Google Sheets. Rebuild after the inventory or the assignment changes, then
copy the status columns across (the generated file starts every row at Not started). `showcase-plan.json` holds the Today and
Decisions rows and is hand-edited.
