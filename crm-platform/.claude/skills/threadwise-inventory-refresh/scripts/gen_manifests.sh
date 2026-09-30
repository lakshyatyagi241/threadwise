#!/usr/bin/env bash
# Regenerate the machine manifests of the Reference reference app (what exists: routes, tables, files...).
# usage: gen_manifests.sh [OUT_DIR]     default OUT_DIR=$THREADWISE_MANIFESTS or <repo>/../_work/manifests
# needs: php >= 8.2, the local reference DB (see threadwise-run-reference), mysql client. Read-only against Reference.
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../../../.." && pwd)"
REF="${THREADWISE_REF:-$repo/../reference/Threadwise}"
M="${1:-${THREADWISE_MANIFESTS:-$repo/../_work/manifests}}"
DBU="${THREADWISE_DB_USER:-threadwise}"; DBP="${THREADWISE_DB_PASS:-threadwise_local_pw}"; DBN="${THREADWISE_DB_NAME:-threadwise}"
[ -f "$REF/artisan" ] || { echo "no Laravel app at $REF (set THREADWISE_REF)" >&2; exit 1; }
mkdir -p "$M"; cd "$REF" || exit 1

php artisan route:list --json > "$M/routes.json" 2> "$M/routes.err"
php artisan schedule:list > "$M/schedule.txt" 2>&1
php artisan list --raw 2>/dev/null | awk '{print $1}' | grep -vE '^(cache|config|db|env|event|help|key|list|make|migrate|model|optimize|package|queue|route|schedule|storage|test|vendor|view|tinker|serve|down|up|clear-compiled|completion|about|inspire|lang|install|channel|notifications|sail|pail|reverb|stub|session|scramble|dompdf|permission)' > "$M/commands.txt"
ls app/Models | sed 's/\.php//' | sort > "$M/models.txt"
find app/Bsp -name '*.php' | sort > "$M/bsp_files.txt"
find app/Services app/Support -name '*.php' | sort > "$M/services.txt"
find app/Http/Controllers -name '*.php' | sort > "$M/controllers.txt"
find app/Http/Middleware -name '*.php' | sort > "$M/middleware.txt"
find resources/views -type f | sort > "$M/views.txt"
ls database/migrations | sort > "$M/migrations.txt"
find app/Events app/Listeners app/Mail app/Policies app/Observers app/Enums app/Contracts app/Casts app/Broadcasting \
     app/Http/Requests app/Http/Resources app/Providers app/Exceptions app/Helpers -name '*.php' 2>/dev/null | sort -u > "$M/events_mail_misc.txt"
ls config | sort > "$M/config_files.txt"
find node -path node/node_modules -prune -o -path node/baileys_auth -prune -o -type f -print | grep -v node_modules | sort > "$M/node_files.txt"
find resources -type f -not -path '*/views/*' | sort > "$M/resources_nonview.txt"
mysql -u"$DBU" -p"$DBP" "$DBN" -N -e "select table_name from information_schema.tables where table_schema='$DBN' order by 1" > "$M/tables.txt" 2>/dev/null
mysql -u"$DBU" -p"$DBP" "$DBN" -N -e "select name from permissions order by 1" > "$M/permissions.txt" 2>/dev/null
wc -l "$M"/*.txt | tail -1
python3 -c "import json;print('routes:', len(json.load(open('$M/routes.json'))))"
