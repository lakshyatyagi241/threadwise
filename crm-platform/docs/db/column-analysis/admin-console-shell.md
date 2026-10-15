# admin-console-shell — column analysis

Tables: 1 · Columns: 6. Generated from the live schema (all migrations applied). Legend and method: [README](README.md).

## `workspace_brand_assets`

**Purpose:** Per-workspace uploaded logo and favicon stored as bytes in Postgres (at most 2 rows per org), served with ETag.

**Linked to:** admin-console-shell workspace-settings.service.ts (upload branding, serve asset, etags list); branding.e2e.spec.ts.

**Facts:** RLS on+forced · plain · created in `20261025090000_ashell_workspace_brand_assets.sql` · Drizzle `packages/db/src/schema/admin-console-shell/tables.ts`

**Design notes:** Binary in the DB (bytea <= 2 MiB) rather than object storage like other media: simple and transactional with RLS, but bloats backups and bypasses CDN. Only two slots, so row count stays tiny. No uuid/created_by.

| Column | Type · null · default | Purpose | Allowed values / format | Best practice | Linked features | Usage | Useful | Evidence |
|---|---|---|---|---|---|---|---|---|
| `org_id` | `bigint` NOT NULL | Tenant (workspace/organization) owner of the row; drives Row-Level Security. | FK to organizations; bigint; set from the request tenant context (app.org_id), never from client input <br>**DB:** `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE` | Correct: NOT NULL, part of composite FKs, RLS tenant_isolation keyed on it. Keep leading column of tenant indexes. | RLS on every query; modules: api:modules/admin-console-shell | USED | YES | set/filtered in queries (e.g. apps/api/src/modules/admin-console-shell/workspace-settings.service.ts) |
| `slot` | `text` NOT NULL | Which brand asset. | logo \| favicon (CHECK); PK part with org_id. <br>**DB:** `CHECK: CHECK ((slot = ANY (ARRAY['logo'::text, 'favicon'::text])))` | Good. | admin-console-shell workspace-settings.service.ts | USED | YES | workspace-settings.service.ts:288 INSERT ... slot |
| `mime` | `text` NOT NULL | Content type of the image. | image/jpeg \| image/png \| image/webp \| image/gif (RASTER allow-list in app; SVG excluded). | Add CHECK on the allow-list. | workspace-settings.service.ts | USED | YES | workspace-settings.service.ts:320 SELECT mime, bytes, etag |
| `bytes` | `bytea` NOT NULL | Image bytes. | bytea NOT NULL, <= 2,097,152 (CHECK). <br>**DB:** `CHECK: CHECK ((octet_length(bytes) <= 2097152))` | Consider object storage + key if sizes grow; TOAST handles 2 MiB fine. | workspace-settings.service.ts | USED | YES | workspace-settings.service.ts:288-289 INSERT bytes |
| `etag` | `text` NOT NULL | Cache validator for the served image. | first 16 hex chars of sha1(bytes); NOT NULL. | Fine; weak 64-bit hash is adequate for caching. Could be GENERATED from bytes. | workspace-settings.service.ts etags() | USED | YES | workspace-settings.service.ts:213 SELECT slot, etag |
| `updated_at` | `timestamp with time zone` NOT NULL default `now()` | When the row was last modified. | timestamptz, default now(), set by touch_row() trigger on every UPDATE; ISO-8601 UTC | Correct: maintained by trigger so no app can forget. Do not set it from the app. | Sync/cache/'last changed' display in api:modules/admin-console-shell | USED | YES | read by app (e.g. apps/api/src/modules/admin-console-shell/workspace-settings.service.ts) |
