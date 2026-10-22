# file-upload-security (Sheet3 #34)

`bash script-testing/file-upload-security/run.sh --quick` (quick and full are the same, about 3 minutes).

1. `apps/api/test/security/file-upload/file-upload-security.spec.ts`: hostile payloads against `UploadPolicyService`, `sniffMediaType`/`servableMime`, `isSafeSvg`, the brand and invoice-logo SVG sniffers and the zip reader, plus the ratchet: every `FileInterceptor` needs `limits.fileSize` and its file must be listed in `REVIEWED` (add a new upload route there only after checking it calls a shared guard).
2. Live: boots the API on a throwaway database and posts a hostile multipart body, without credentials, to every multipart or upload-named write operation in the OpenAPI document; none may answer 2xx or 5xx.

**Rerun after adding any upload endpoint.** The ratchet fails when a new `FileInterceptor` file is not in the `REVIEWED` list, lacks `limits.fileSize`, calls `policy.validate` instead of `validateScanned`, or sits in a module with no shared guard or scan call. Add the route to `REVIEWED` only after it uses `UploadPolicyService.validateScanned` (or the chat media store).

`file-upload-hardening.spec.ts` covers: GIF/PNG/JPEG/WebP polyglots, pixel limits and decompression-bomb headers (env `UPLOAD_MAX_IMAGE_SIDE` 16384, `UPLOAD_MAX_IMAGE_MEGAPIXELS` 100), the antivirus hook against a fake clamd server (clean, FOUND, timeout and unreachable, fail-open and fail-closed), cross-tenant key ownership for the chat media store, and CSV formula guarding.

Antivirus: `UPLOAD_SCAN_MODE=off|clamd` (default off), `UPLOAD_SCAN_CLAMD_HOST` (127.0.0.1), `UPLOAD_SCAN_CLAMD_PORT` (3310), `UPLOAD_SCAN_TIMEOUT_MS` (5000), `UPLOAD_SCAN_FAIL_CLOSED=true` refuses uploads when the scanner cannot answer. Called from `UploadPolicyService.validateScanned` and the chat media store and team chat.

Exit 0 pass, 1 fail, 2 error. Output: `qa-results/file-upload-security/<timestamp>/result.json`. Uses the shared Postgres and Redis containers read-only (own database, redis db 9).
