# API: chat media (the storage door for the inbox)

Where inbox attachments and the media a customer sends are stored and read (plan decision 4, Phase 0 stream A2). Code:
`apps/api/src/infra/providers/chat-conversations/media/`. Everything goes through one door, `ChatMediaStore`; no other code writes a file or builds a media URL.

## Writing

```ts
const stored = await media.store({ orgId, filename: file.originalname, buffer: file.buffer }); // an agent's upload
const stored = await media.storeInbound({ orgId, buffer, declaredMime, filename }); // bytes a channel delivered
// -> { key, mime, size, name, sha256, kind }   keep these on the message row; the key is the only locator
```

- **What is allowed** is decided by the platform's `UploadPolicyService` (extension allow-list plus a content signature check; html, svg, php, scripts and
  executables are refused with `AUTH_UPLOAD_REJECTED`), never by the client's Content-Type. `storeInbound` first lets the **content** decide the type
  (`sniffMediaType`: a sender's declared mime only chooses between formats that share a signature, such as video or audio MP4), then runs the same policy.
- **Size limits** by kind, from WhatsApp's own: images 5 MB, audio and video 16 MB, documents 100 MB (`MEDIA_MAX_BYTES_IMAGE|MEDIA|DOCUMENT`).
  A route that accepts uploads should cap the request at `max(...)` and let the store apply the per-kind limit.
- **The key** is generated: `chat/<orgId>/<yyyy>/<mm>/<unix>_<24 hex>.<ext>`. The sender's file name is never part of a path; it is kept for display
  (`name`: path and control characters removed, 120 characters). Keys are stored, never URLs, so a provider change rewrites no data.
- **Where the bytes go**: to the cloud bucket when the platform storage settings enable one (`MediaStorageService.put`), otherwise to local disk under
  `MEDIA_LOCAL_DIR` (default `~/.crm-platform/media`, outside the repository). Never to Postgres. Local disk is for development, tests and small self-hosted
  installs (MinIO is not available locally); `LocalDiskMediaStore` accepts only keys of lower-case segments (no `..`, no `.` prefix, no backslash, no drive letter),
  resolves them under the real root, refuses links, and writes atomically (temp file then rename).

## Reading

`GET /v2/media/:token` (through the web app: `/api/v2/media/:token`). Never a public URL.

1. The server makes a link for one person: `media.accessUrl(key, { orgId, userId }, { name, mime })` returns `/api/v2/media/<token>`. **Call it only after
   checking that person may see the conversation the object belongs to.** The token is the payload sealed with the platform's AES-256-GCM key (the key and the
   workspace id stay hidden, any changed byte fails), with an expiry inside (`MEDIA_TOKEN_TTL_SECONDS`, default 5 minutes). Nothing is stored when a thread of
   fifty images is read.
2. The route needs a staff session. It refuses unless the token is valid, was made for this person and this workspace, and the key is this workspace's. If the
   conversations domain binds a `MEDIA_ACCESS_POLICY` it must also agree (a link made for an agent stops working once the conversation is no longer theirs).
   **Every refusal is the same plain 404.**
3. Headers: the Content-Type is the type the message row recorded **only if it is one this store ever accepts**, otherwise the key's extension, otherwise bytes
   (`text/html` or SVG are never echoed); `Content-Disposition` is `inline` for images, audio, video and PDF and `attachment` for the rest, with the name as
   `filename*=UTF-8''...`; `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, `Cross-Origin-Resource-Policy: same-origin`,
   `Cache-Control: private, max-age=300`. Byte ranges (`bytes=a-` and `bytes=a-b`) answer 206 so audio and video can seek; a range beyond the end is 416.
4. A bucket object is read by the **server** through a link only the server holds (a signed link for a private bucket) and streamed; a browser never sees a
   bucket address.

The web proxy forwards `Range` and returns `Content-Disposition`, `Content-Range` and `Accept-Ranges` (`apps/web/src/lib/auth/proxy.ts`).

## Wiring

`infra` may not import a domain module, so the app wires three ports in `app.module.ts` (`ChatMediaModule.register`): `MEDIA_OBJECT_GATEWAY` to
`MediaStorageService`, `MEDIA_UPLOAD_VALIDATOR` to `UploadPolicyService`, and optionally `MEDIA_ACCESS_POLICY` (not bound yet; the conversations domain provides
it). The module is global, so `ChatMediaStore` and `MediaTokenService` can be injected anywhere in the HTTP app. The worker does not import it yet: the Phase 2
ingest job that downloads provider media must register it there (it also needs the platform settings module for `MediaStorageService`).

## Not built here

An upload route (the inbox's `POST /inbox/media` calls `store`), deleting media with its message (`remove` exists), antivirus scanning, image thumbnails,
voice transcoding, signed links for a bucket that is public (the server reads it anyway).

## Tests

`apps/api/test/unit/chat-conversations/media/` (key safety and path traversal, range reads, token seal / expiry / tamper, the store's policy and limits with a stub bucket,
sniffing, the route's policy hook) and `apps/api/test/e2e/chat-conversations/media/` (the real storage settings and upload policy, local disk under a temp folder, the route's
headers, ranges, and every refusal being the same 404 across people, workspaces, expiry, tampering and traversal).
