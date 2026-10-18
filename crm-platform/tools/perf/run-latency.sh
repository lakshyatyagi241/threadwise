#!/usr/bin/env bash
# QA #50: the whole latency measurement. Three runs of one user (pure latency) and three of twenty (contention), then the ranking.
#   API_URL=http://localhost:3000 PERF_EMAIL=... PERF_PASSWORD=... bash tools/perf/run-latency.sh [outdir]
# Needs k6 on the PATH, the API running, and the organisation filled by tools/perf/seed.sql.
set -euo pipefail
OUT=${1:-perf/results}
RUNS=${RUNS:-3}
DURATION=${DURATION:-30}
mkdir -p "$OUT"
for mode in 1 20; do
  for i in $(seq 1 "$RUNS"); do
    echo "== ${mode} user(s), run $i of $RUNS"
    k6 run perf/latency.js -e VUS="$mode" -e DURATION="$DURATION" -e OUT="$OUT/latency-vus${mode}-run${i}.json" --quiet 2>&1 | grep -v "^$" | grep -E "error|crossed" || true
  done
  node tools/perf/rank.mjs "$OUT"/latency-vus"${mode}"-run*.json --top 20 --out "$OUT/ranked-vus${mode}.md" --budgets perf/budgets.json > /dev/null || true
done
echo "done: $OUT/ranked-vus1.md and $OUT/ranked-vus20.md"
