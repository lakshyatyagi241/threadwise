#!/usr/bin/env bash
# Security fuzz runner (sheet item 38, PR #667): tools/quality/fuzz.mjs plus the three fuzz unit specs.
SEC_NAME=security-fuzz; SEC_SHEET=38; SEC_TITLE="Security fuzz testing"
sec_help() { cat <<'H'
Security fuzz (sheet 38): seeded fuzz of schemas/parsers (and HTTP routes in full), plus fuzz-engine, fuzz-ci, fuzz-regressions specs.
  run.sh [--quick] [--seed N] [--out DIR]
  quick: fuzz.mjs --profile ci --no-http (20,000 inputs, ~10 s).  full: --profile full (about 1.3 million inputs + 9,000 HTTP requests, about 3 min).
  The seed is random per run unless --seed is given; the replay command is printed.
Needs: node 22, pnpm, dependencies. Exit 0 PASS, 1 FAIL, 2 ERROR.
H
}
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../_lib" && pwd)/common.sh"
sec_init "$@"
sec_prereq node22 pnpm
sec_build_packages
sec_vitest fuzz-unit-specs api test/unit/security/fuzz-engine.spec.ts test/unit/security/fuzz-ci.spec.ts test/unit/security/fuzz-regressions.spec.ts
SEED="${SEC_SEED:-$(( (RANDOM<<15 | RANDOM) ))}"
if [ "$SEC_MODE" = quick ]; then PROFILE=ci; EXTRA=(--no-http); else PROFILE=full; EXTRA=(); fi
SEC_CMDS+=("node tools/quality/fuzz.mjs --profile $PROFILE --seed $SEED ${EXTRA[*]:-}")
S=$(date +%s.%N); rc=0
(cd "$CRM_ROOT" && node tools/quality/fuzz.mjs --profile "$PROFILE" --seed "$SEED" "${EXTRA[@]}" --out "$SEC_OUT/fuzz-report.json") >"$SEC_OUT/logs/fuzz.log" 2>&1 || rc=$?
E=$(date +%s.%N)
INPUTS=$(grep -oiE '[0-9][0-9,]* (pure )?inputs' "$SEC_OUT/logs/fuzz.log" | tail -1 | tr -d ',' | grep -oE '^[0-9]+' || true)
THR=$(awk -v n="${INPUTS:-0}" -v s="$S" -v e="$E" 'BEGIN{d=e-s; if(d>0) printf "%d", n/d; else print 0}')
if [ "$rc" -eq 0 ]; then sec_check "fuzz-$PROFILE" PASS "seed=$SEED inputs=${INPUTS:-unknown} throughput=${THR}/s"
else sec_check "fuzz-$PROFILE" FAIL "exit $rc seed=$SEED, see logs/fuzz.log (it prints a shrunk input)"; fi
echo "  replay: node crm-platform/tools/quality/fuzz.mjs --seed $SEED --profile $PROFILE"
sec_finish
