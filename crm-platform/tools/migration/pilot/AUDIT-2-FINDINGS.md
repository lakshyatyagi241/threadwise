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
