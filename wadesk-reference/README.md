# wadesk-reference

The original **WaDesk** (CodeCanyon, v1.7.0) download, kept in this repository as the behavior reference for the port.
It is a commercial, licensed product: keep this repository **private** and share it only with people covered by the license.

```
wadesk-reference/
  WaDesk/           the Laravel app (artisan, app/, routes/, node/, extension/ ...)
  Documentation/    the HTML docs shipped with the download (index.html, pages/)
  Database/         1.1.sql
  Update/           update_1.2.zip ... update_1.7.zip
```

Read-only reference: never edit it, and never copy its code, views, assets or text into `crm-platform/`.
Run it locally with the `wadesk-run-reference` skill (`crm-platform/.claude/skills/wadesk-run-reference/SKILL.md`).

## What is tracked and what is not

Tracked: the product source exactly as downloaded. Not tracked (listed in the root `.gitignore`): everything installing or running it
creates, namely `.env` files, `vendor/`, `node_modules/`, `public/build/`, the local sqlite database, `node/baileys_auth/` (WhatsApp
session credentials), uploads, and runtime logs and caches. After a fresh clone, install it as the `wadesk-run-reference` skill describes.
