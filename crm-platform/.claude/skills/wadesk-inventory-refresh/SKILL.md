---
name: wadesk-inventory-refresh
description: >-
  Regenerate the machine manifests of the WaDesk reference app and audit the
  feature inventory against them: which routes, tables, models, services, views,
  permissions, commands, node files and docs pages are not accounted for by any
  inventory feature, which claims are typos, which feature entries are
  malformed. Use this whenever someone says "is the inventory complete", "audit
  the inventory", "coverage of wadesk", "regenerate manifests", "wadesk was
  updated to a new version", "did we miss any wadesk feature", "lint my
  inventory file", or after editing any file in docs/wadesk-port/inventory.
---

# Inventory coverage audit

`gen_manifests.sh` dumps everything that exists in WaDesk (exact route list from
`php artisan route:list`, all files by category, DB tables, permissions) to
`../_work/manifests/`. `audit_coverage.py` then reads the `wadesk-coverage` JSON
block at the end of every `docs/wadesk-port/inventory/*.md` and diffs it against
those manifests, and lints each feature entry (required fields, valid
status/priority/effort, Given/When/Then acceptance criteria).

Needs the reference app prepared as in the `wadesk-run-reference` skill (PHP 8.2 + the local DB).

```bash
R=.claude/skills/wadesk-inventory-refresh/scripts
bash $R/gen_manifests.sh                          # -> ../_work/manifests  (override with WADESK_MANIFESTS)
python3 $R/audit_coverage.py                      # -> ../_work/reports/coverage.{md,json}
python3 $R/audit_coverage.py --only team-inbox-conversations   # lint one domain file
python3 $R/routes.py --uri team-inbox --ctrl Deals   # query the route manifest (filters OR together)
python3 $R/routes.py --closures                      # routes defined as closures
```

## Reading the report

- **orphans**: exists in WaDesk, claimed by no domain. Every orphan is a feature nobody will
  port. For each: add it to the right domain (new feature id continuing the numbering, add the
  path/route to that file's coverage block) or, if it is genuinely out of scope, say why in the
  domain's "Open questions & quirks" and list it in the coverage block anyway.
- **unknown (typo)**: claimed but not in WaDesk. Fix the string.
- **multi-claimed**: several domains claim it. Fine for genuinely shared files; a route should have one home.
- **lint issues**: fix in the inventory file.

Coverage blocks may claim a whole directory with a trailing `/` (for example `resources/js/charts/`).

## WaDesk version upgrades

WaDesk ships as a base plus update zips (`Update/update_1.2.zip` ... `1.7`). After a new version
lands in the reference app: run migrations there, regenerate manifests, run the audit, and treat
the new orphans as the diff to inventory. Record the new `wadesk_version` in each touched
domain's front matter.
