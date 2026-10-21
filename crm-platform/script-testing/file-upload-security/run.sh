#!/usr/bin/env bash
# File-upload security runner (sheet item 34).
SEC_NAME=file-upload-security; SEC_SHEET=34; SEC_TITLE="File-upload security"
sec_help() { cat <<'H'
File-upload security (sheet 34): in-process hostile-payload specs for the shared upload guards plus the ratchet over every upload route
(api test/security/file-upload), then a LIVE check: boots the API (own database, redis db 9) and sends a hostile multipart body to every upload-named or
multipart operation in the OpenAPI document WITHOUT credentials; each must answer 401/403/404/422 (never 2xx, never 5xx).
  run.sh [--quick] [--out DIR]
  quick and full run the same checks (~3 min; the first run also builds the API). Ports: API 3931 upward.
Needs: node 22, pnpm, docker, curl, crm-platform-postgres and crm-platform-redis running. Exit 0 PASS, 1 FAIL, 2 ERROR.
H
}
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../_lib" && pwd)/common.sh"
sec_init "$@"
sec_prereq node22 pnpm docker curl postgres redis
sec_vitest upload-guards-and-ratchet api test/security/file-upload/file-upload-security.spec.ts
sec_boot_api
curl -s --max-time 20 "$SEC_API/docs-json" -o "$SEC_OUT/openapi.json"
# operations that declare multipart, plus write operations whose path names an upload (the spec does not declare every @UseInterceptors upload)
OPS=$(node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1]));const re=/upload|avatar|media|import|attachment|logo|asset|proof|recording|picture|icon|favicon|theme|csv|file/i;for(const[p,o]of Object.entries(d.paths))for(const[m,op]of Object.entries(o))if(["post","put","patch"].includes(m)&&(JSON.stringify(op).includes("multipart/form-data")||re.test(p)))console.log(m.toUpperCase()+" "+p.replace(/\{[^}]+\}/g,"00000000-0000-4000-8000-000000000000"))' "$SEC_OUT/openapi.json" | sort -u)
N=0; BAD=0
printf '<script>alert(1)</script>' >"$SEC_OUT/evil.png"
while read -r M P; do
  [ -z "$P" ] && continue; N=$((N+1))
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 -X "$M" -F "file=@$SEC_OUT/evil.png;type=image/png;filename=../../evil.html" "$SEC_API$P")
  case "$code" in 401|403|404|422|400) ;; *) BAD=$((BAD+1)); sec_check "noauth-$M-$P" FAIL "HTTP $code";; esac
done <<<"$OPS"
[ "$N" -gt 0 ] || sec_check multipart-operations-found FAIL "none in OpenAPI"
[ "$BAD" = 0 ] && [ "$N" -gt 0 ] && sec_check "unauthenticated-multipart-refused" PASS "$N multipart operations, none accepted"
sec_finish
