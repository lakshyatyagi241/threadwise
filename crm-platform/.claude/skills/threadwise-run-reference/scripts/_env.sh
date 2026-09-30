# shared by start/stop/status. Resolves where the Reference reference app lives and where run state is kept.
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../../../.." && pwd)"
REF="${THREADWISE_REF:-$repo/../reference/Threadwise}"
PORT="${THREADWISE_PORT:-8000}"
STATE="${TMPDIR:-/tmp}/threadwise-ref-$(id -un)"
mkdir -p "$STATE"
LOGFILE="$STATE/serve.log"
listener_pid() { ss -ltnpH "sport = :$PORT" 2>/dev/null | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | head -1; }
listening() { [ -n "$(listener_pid)" ]; }
# true only for Laravel's own dev server (php -S ... Foundation/Console/../resources/server.php)
is_laravel_dev_server() { tr '\0' ' ' < "/proc/$1/cmdline" 2>/dev/null | grep -q 'resources/server.php'; }
