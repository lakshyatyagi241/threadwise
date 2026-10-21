# file-upload-security (Sheet3 #34)

`bash script-testing/file-upload-security/run.sh --quick` (quick and full are the same, about 3 minutes).

1. `apps/api/test/security/file-upload/file-upload-security.spec.ts`: hostile payloads against `UploadPolicyService`, `sniffMediaType`/`servableMime`, `isSafeSvg`, the brand and invoice-logo SVG sniffers and the zip reader, plus the ratchet: every `FileInterceptor` needs `limits.fileSize` and its file must be listed in `REVIEWED` (add a new upload route there only after checking it calls a shared guard).
2. Live: boots the API on a throwaway database and posts a hostile multipart body, without credentials, to every multipart or upload-named write operation in the OpenAPI document; none may answer 2xx or 5xx.

Exit 0 pass, 1 fail, 2 error. Output: `qa-results/file-upload-security/<timestamp>/result.json`. Uses the shared Postgres and Redis containers read-only (own database, redis db 9).
