# wadesk-reference (not included in this repository)

Put your own licensed copy of **WaDesk** (CodeCanyon, v1.7.0) here. It is a commercial product, so its source is
deliberately **not** committed to this repository, and `.gitignore` keeps it out. Everything else here only describes its behavior.

Expected layout (the skills look for exactly this):

```
wadesk-reference/
  WaDesk/           the Laravel app (contains artisan, app/, routes/, node/, extension/ ...)
  Documentation/    the HTML docs shipped with the download (index.html, pages/)
  Database/         1.1.sql
  Update/           update_1.2.zip ... update_1.7.zip
```

It is read-only reference: never edit it, and never copy its code, views, assets or text into `crm-platform/`.
Run it locally with the `wadesk-run-reference` skill (`crm-platform/.claude/skills/wadesk-run-reference/SKILL.md`).
You only need it for: the live behavior comparison (`wadesk-verify-parity`), regenerating the manifests, and reading the source refs cited in the inventory.
