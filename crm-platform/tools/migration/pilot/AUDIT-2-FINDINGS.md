# Migration audit 2 (demo workspace): findings, fixes and data checks

## F-001 interactive message shows as a plain attachment (fixed in code)
Cause: the payload was kept (`messages.meta.legacy.interactive`, `meta.legacy.response`) but not drawn. A button message with an image header is stored as kind `image`
(`inbox/parse.ts`), and three places only built or drew buttons for kind `interactive`: the loader (`transform/inbox.ts`), the API mapper (`sentInteractiveOf`) and the bubble.
Fix: all three now work for any kind; the bubble draws the header file first, then text and buttons (not links, so non-actionable). `chat-buttons` backfills already-loaded
rows of any kind (dry run by default, `--apply --confirm-org-slug`). Run it on the demo workspace after deploy; no re-import is needed.

## F-002 file cannot be downloaded (needs a data check; one reporting gap closed)
The download route answers one 404 for every refusal (expired token, other user or workspace, key not under `chat/<org id>/`, object missing in the bucket the platform `storage`
setting points at). Chrome's "File wasn't available on site" is that 404. Code path has no defect found; the likely cause is that the copied object and the platform storage
setting disagree (bucket, endpoint or base folder), or the object was never copied (`media_key` is NULL until `copy-files.cjs copy --apply`).
Checks, read-only: `node pilot/files/copy-files.cjs verify --org-slug S --confirm-db-name DB --config files.json` now also prints stored files by kind and
`NO_SOURCE_<KIND>` for media rows with neither an object nor a URL. Then: (1) `SELECT media_key, media_size, media_name, meta->'legacy'->>'sourceUrl' FROM messages WHERE media_name = 'gybyu5_srv_logo.png'`;
(2) HEAD that key in the bucket of Settings > Storage (with the base folder); (3) API log for `GET /v2/media/:token` status. Template media (template headers) is not
covered by copy-files and has no migrated file; confirm whether any exist before promising it.

## F-003 6 conversations in Wabo vs 4 in WaDesk (data check, no code change)
By design the turns of a phone number become ONE thread (many Wabo sessions merge), website chat is quarantined `WEBCHAT_NO_CHANNEL`, and threads of deleted contacts are excluded
(`registry/index.ts`, chathistory entry). A Wabo list of sessions can therefore be larger than the thread list. Check with the run's quarantine/exclusion counts, or:
`SELECT count(DISTINCT meta->'legacy'->>'sessionId') FROM messages WHERE org_id=<id> AND meta->'legacy'->>'src'='waboo'` against `count(*) FROM conversations`, and list the two
Wabo contacts (Aashish, the second one) in `migration.quarantine`.

## WhatsApp number "switched off" (not changed in code, decision needed)
The loader creates the channel `disconnected` with no credentials on purpose (`load/inbox.ts` ensureChannels; `chatbot_misc_config` is registered HIGH RISK, secrets never go
through this tool). Marking it `connected` without a token would only make sends fail. Because the same Meta app is reused, the safe path is the app's own connect flow for
the same phone number id: `WabaChannelLinkService` adopts the existing channel by (org, kind, external_id), keeping the history. What would change on confirmation:
the WABA connection is saved in WaDesk (token encrypted by the app), the channel flips to `connected`, and the Meta webhook callback URL for that app/number is pointed at WaDesk,
which moves live inbound traffic away from Wabo. Nothing is sent to Meta and no webhook is switched until the owner confirms.

## Files from S3 to Cloudflare R2
`copy-files.cjs` already reads each file from its Waboo (S3) address and writes it to whatever S3-compatible store the env names, so R2 needs no code change:
`S3_ENDPOINT=https://<account id>.r2.cloudflarestorage.com`, `S3_REGION=auto`, an R2 API token as `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`, `S3_BUCKET_MEDIA` / `S3_BUCKET_DOCUMENTS` = the R2 buckets.
Order: `plan` (read-only) -> `copy --apply --confirm-org-slug S --max-files N --max-gb G --state f.jsonl` -> `verify`. Then set Settings > Storage (endpoint, bucket, base folder) to the same R2 bucket,
or the app answers 404 for the copied keys. Rows already copied to S3 under `chat/<org>/waboo/...` are not re-read from Waboo: copy those objects bucket-to-bucket first (e.g. `rclone copy s3:bucket r2:bucket`, same keys), then `verify`.

### Flow media (added)
`copy-files` now also finds Waboo-host links inside `flows.flow_data` (media steps), copies each file to `flow-media/<org id>/waboo/<hash>/<name>` in `S3_BUCKET_MEDIA` (R2) and rewrites the step to
`<flowMediaPublicBase>/<object key>`. A flow sends its media by link, so the config needs `"flowMediaPublicBase": "https://<public origin of the R2 bucket>"` (custom domain or r2.dev); `copy --apply` refuses without it.
`verify` lists flow links still on a Waboo host (so you can see when nothing points at S3) and HEADs the rewritten R2 objects. Not covered still: template header media, broadcast / FAQ / knowledge attachments.

### Content-less customer turns
A customer turn with a typed query object but no text, file or reply payload (the 2 EMPTY_MESSAGE rows of the demo workspace) is now imported as an inbound placeholder "(message content not available)" with `meta.legacy.contentUnavailable = true` and a CONTENT_UNAVAILABLE soft issue; the independent check in `reconcile/oracle-chat.ts` follows the same rule. Re-run the chat step (append) to pick up already-quarantined turns; find the placeholders with `meta->'legacy'->>'contentUnavailable' = 'true'`.

### Chat widget images (added)
`copy-files` also copies Waboo-host images of `chatbot_widgets` (`button_image_url`, `body_bg_image_url`, `launcher.avatar`) to `widget-media/<org id>/waboo/...` in the media bucket and rewrites them to
`<flowMediaPublicBase>/<object key>` (same config line as flows; visitors' browsers load these). `verify` counts widget links still on a Waboo host. Checked and needing no copy: broadcast
(`custom_image/video/document` are not carried), templates (media stays with Meta), knowledge file sources (no bytes in the dump: quarantined NEEDS_REUPLOAD, re-upload in WaDesk), contacts (`image_url` null).

### What the staging platform uses (read from the staging database and the Storage screen, secrets masked)
Platform setting `storage`, saved 2026-10-16: enabled, provider Cloudflare R2, endpoint `https://99d54bd9eed7f32cd8a52f36bc843da5.r2.cloudflarestorage.com`, bucket `geta-ai`, path style off, base path empty, region empty, no public/CDN URL, private (signed URLs), connection test passed.
So the app serves media from the R2 bucket `geta-ai` with no base folder: for `copy-files` use `S3_ENDPOINT` = that host, `S3_REGION=auto`, `S3_FORCE_PATH_STYLE=false`, `S3_BUCKET_MEDIA=geta-ai`, and no `--base-folder`.
The demo row for `gybyu5_srv_logo.png` has `media_key = chat/31/waboo/49bc6a257ee60431/gybyu5_srv_logo.png`: F-002 is most likely that this object is not in `geta-ai` (never copied, or under another prefix); a bucket listing for that exact key confirms it, and `copy-files copy --apply` then fixes it.
`flowMediaPublicBase` has no existing public address to reuse (no CDN URL): set it to the custom domain or r2.dev address that fronts `geta-ai`.
