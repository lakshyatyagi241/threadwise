#!/usr/bin/env bash
# Memory profiling (Sheet3 #57) end to end: own DB + Redis db, production-mode API+worker, soak --profile, budget check, summary.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; ROOT="$(cd "$HERE/../.." && pwd)"
MODE=full; MINUTES=""; SNAP=0; OUT=""; PORT="${MEM_PORT:-3923}"; REDIS_DB="${MEM_REDIS_DB:-10}"
usage(){ cat <<U
Memory profile: boots API + worker (NODE_ENV=production), runs the soak workload, prints RSS/heapUsed p50/p95/p99 + boot RSS,
per-endpoint heap deltas, then checks perf/memory-budget.json. Needs docker (crm-platform-postgres/redis running), node 22, pnpm.
  --quick        ~2 min profile (1 min warm-up)     --minutes N   override length (default full = 5)
  --snapshots    also run a separate 4 min heap-snapshot step (never with --quick)
  --out DIR      default qa-results/57-memory-profiling/<timestamp>   Exit: 0 PASS, 1 FAIL, 2 ERROR
U
}
while [ $# -gt 0 ]; do case "$1" in
  --quick) MODE=quick;; --minutes) MINUTES="$2"; shift;; --snapshots) SNAP=1;; --out) OUT="$2"; shift;;
  --help|-h) usage; exit 0;; *) echo "unknown option $1"; usage; exit 2;; esac; shift; done
if [ "$MODE" = quick ] && [ "$SNAP" = 1 ]; then echo "--snapshots is never run in --quick"; SNAP=0; fi
if [ -z "$MINUTES" ]; then if [ "$MODE" = quick ]; then MINUTES=2; else MINUTES=5; fi; fi
WARM=2; CALLS=100; if [ "$MODE" = quick ]; then WARM=1; CALLS=40; fi
OUT="${OUT:-$ROOT/qa-results/57-memory-profiling/$(date +%Y%m%d-%H%M%S)}"; mkdir -p "$OUT/logs"
DB="crm_mem_$(openssl rand -hex 4)"; START=$(date +%s); STARTED=$(date -u +%FT%TZ)
export PATH="$HOME/.local/bin:$PATH"
err(){ echo "ERROR: $*" >&2; exit 2; }
SOAKPID=""
cleanup(){ set +e
  [ -n "$SOAKPID" ] && kill "$SOAKPID" 2>/dev/null
  for p in $(pgrep -f "dist/src/(main|worker).js"); do
    if [ "$(readlink /proc/"$p"/cwd)" = "$ROOT/apps/api" ] && tr '\0' '\n' </proc/"$p"/environ | grep -qx "SOAK_DATABASE=$DB"; then kill "$p"; fi
  done
  docker exec crm-platform-postgres psql -U crm -d postgres -qc "DROP DATABASE IF EXISTS $DB WITH (FORCE)" >/dev/null 2>&1
}
trap cleanup EXIT; trap 'exit 130' INT TERM
command -v node >/dev/null && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ] || err "node 22+ missing"
command -v pnpm >/dev/null || err "pnpm missing (corepack enable pnpm)"
docker ps --format '{{.Names}}' | grep -qx crm-platform-postgres || err "container crm-platform-postgres not running (docker compose up -d postgres redis)"
docker ps --format '{{.Names}}' | grep -qx crm-platform-redis || err "container crm-platform-redis not running"
for p in "$PORT" $((PORT+1)); do if ss -ltn | grep -q ":$p "; then err "port $p in use (set MEM_PORT)"; fi; done
[ -f "$ROOT/.env" ] || err "$ROOT/.env missing (copy .env.example)"
cd "$ROOT"
[ -d node_modules ] || pnpm install --frozen-lockfile >"$OUT/logs/install.log" 2>&1 || err "pnpm install failed"
for p in tax contracts db observability; do [ -d "packages/$p/dist" ] || pnpm --filter "@crm/$p" build >"$OUT/logs/build-$p.log" 2>&1 || err "build $p failed"; done
[ -f apps/api/dist/src/main.js ] || pnpm --filter @crm/api build >"$OUT/logs/build-api.log" 2>&1 || err "api build failed"
docker exec crm-platform-postgres psql -U crm -d postgres -qc "CREATE DATABASE $DB OWNER crm" || err "create db"
export MIGRATION_DATABASE_URL="postgres://crm:crm@localhost:5432/$DB"
pnpm db:migrate >"$OUT/logs/migrate.log" 2>&1 || err "migrate failed (see logs/migrate.log)"
pnpm db:seed >"$OUT/logs/seed.log" 2>&1 || err "seed failed"
export NODE_ENV=production CHANNEL_SIMULATOR_ENABLED=false SOAK_DATABASE="$DB" SOAK_REDIS_DB="$REDIS_DB"
JWT_ACCESS_SECRET=$(openssl rand -hex 32); JWT_REFRESH_SECRET=$(openssl rand -hex 32); CREDENTIALS_ENCRYPTION_KEY=$(openssl rand -base64 32)
export JWT_ACCESS_SECRET JWT_REFRESH_SECRET CREDENTIALS_ENCRYPTION_KEY
CMD1="node tools/perf/soak.mjs --profile --minutes $MINUTES --warmup $WARM --interval 5 --calls $CALLS --port $PORT --out $OUT/profile"
echo ">> $CMD1"; SOAKRC=0
$CMD1 >"$OUT/logs/profile.log" 2>&1 & SOAKPID=$!
wait $SOAKPID || SOAKRC=$?; SOAKPID=""
[ -f "$OUT/profile/memory-profile.json" ] || { tail -5 "$OUT/logs/profile.log"; err "no memory-profile.json (soak exit $SOAKRC)"; }
SNAPNOTE=""
if [ "$SNAP" = 1 ]; then
  node tools/perf/soak.mjs --profile --snapshots --minutes 4 --warmup 2 --interval 5 --calls 20 --port "$PORT" --out "$OUT/snapshots" >"$OUT/logs/snapshots.log" 2>&1 || true
  SNAPNOTE="snapshots in $OUT/snapshots"
fi
BRC=0; node tools/perf/memory-budget-check.mjs "$OUT/profile/memory-profile.json" perf/memory-budget.json >"$OUT/logs/budget.log" 2>&1 || BRC=$?
LOAD=$(cut -d' ' -f1-3 /proc/loadavg); CPUS=$(nproc)
OUT="$OUT" MODE="$MODE" BRC="$BRC" STARTED="$STARTED" START="$START" LOAD="$LOAD" CPUS="$CPUS" SNAPNOTE="$SNAPNOTE" CMD1="$CMD1" node - <<'JS'
const fs=require('fs'),e=process.env,o=e.OUT;
const P=JSON.parse(fs.readFileSync(o+'/profile/memory-profile.json','utf8'));
const B=fs.readFileSync(o+'/logs/budget.log','utf8');const rc=+e.BRC;
const f=x=>String(x).padStart(8);
console.log('\n=== Memory profile ('+e.MODE+', '+P.nodeEnv+', '+P.options.minutes+' min, n='+P.loadWindow.api.rssMb.n+' samples) ===');
console.log('process  metric        boot     p50     p95     p99');
for(const p of ['api','worker'])for(const m of ['rssMb','heapUsedMb'])
  console.log(p.padEnd(8),m.padEnd(11),f(P.bootMb[p][m]),f(P.loadWindow[p][m].p50),f(P.loadWindow[p][m].p95),f(P.loadWindow[p][m].p99));
console.log('\nPer-endpoint heapUsed delta after GC ('+P.options.calls+' calls):');
for(const [k,v] of Object.entries(P.endpoints))console.log('  '+k.padEnd(48),(v.heapUsedDeltaMb+' MB').padStart(9),JSON.stringify(v.statuses));
console.log('\nBudget check (perf/memory-budget.json):\n'+B.trim());
if(rc!==0)console.log('\nNOTE: machine load average '+e.LOAD+' on '+e.CPUS+' CPUs. Other processes share this machine; a budget miss under high load may be noise, but it is reported as FAIL.');
const checks=B.split('\n').filter(l=>/^(PASS|FAIL)/.test(l)).map(l=>({name:l.slice(6,40).trim(),status:l.slice(0,4),detail:l.slice(40).trim()}));
const dur=Math.round(Date.now()/1000-+e.START),st=rc===0?'PASS':rc===1?'FAIL':'ERROR';
const failed=checks.filter(c=>c.status==='FAIL').length;
fs.writeFileSync(o+'/result.json',JSON.stringify({id:'57-memory-profiling',sheetItem:57,title:'Memory profiling',mode:e.MODE,status:st,startedAt:e.STARTED,finishedAt:new Date().toISOString(),durationSeconds:dur,loadAvg:e.LOAD,checks,counts:{tests:checks.length,passed:checks.length-failed,failed,knownBaseline:0},artifacts:[o+'/profile/memory-profile.json',o+'/logs'],commands:[e.CMD1,'node tools/perf/memory-budget-check.mjs <profile> perf/memory-budget.json']},null,1));
console.log('\nRESULT: '+st+'  ('+dur+' s)  '+o+'/result.json\nRe-run: script-testing/memory-profiling/run.sh '+(e.MODE==='quick'?'--quick':'')+' '+e.SNAPNOTE);
JS
if [ "$BRC" = 0 ]; then exit 0; fi
exit 1
