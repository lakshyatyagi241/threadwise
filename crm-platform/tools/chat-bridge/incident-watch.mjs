// Event stream behind `incident-cli watch`: prints ONE line per unowned open incident, so a Claude Code Monitor wakes a session only when
// there is work (no model polling loop). Lines: `NEW <id> <kind>`, `REMIND <id> <kind>` (still open after remindMs), `ERROR <msg>`, `OK ...`.
// Everything printed is built from a validated id and kind; alert text never reaches stdout (it is untrusted and the reader is a model).
const ID = /^[A-Za-z0-9-]{1,64}$/,
  KIND = /^[a-z_]{1,32}$/;

// fetchOpen() returns the open incidents or throws; an error with fatal=true (wrong login/token) ends the watch with exit 1.
export async function watch({
  fetchOpen,
  out,
  sleep,
  now = Date.now,
  stop = () => false,
  pollMs = 20_000,
  remindMs = 30 * 60_000,
  maxPollMs = 120_000,
}) {
  const lastEmit = new Map(); // id -> ms of the last line; kept (not pruned) so a release back to open does not re-announce every poll
  let failing = false,
    delay = pollMs;
  while (!stop()) {
    try {
      const list = await fetchOpen();
      if (failing) {
        out('OK incident API reachable again');
        failing = false;
      }
      delay = pollMs;
      const t = now();
      for (const i of list) {
        if (i.owner || !ID.test(i.id ?? '')) continue;
        const last = lastEmit.get(i.id);
        if (last !== undefined && t - last < remindMs) continue;
        lastEmit.set(i.id, t);
        out(
          `${last === undefined ? 'NEW' : 'REMIND'} ${i.id} ${KIND.test(i.kind ?? '') ? i.kind : 'unknown'}`,
        );
      }
    } catch (e) {
      if (e?.fatal) {
        out(`ERROR ${e.message}`);
        return 1;
      }
      if (!failing) {
        out(`ERROR ${e?.message ?? 'incident API failed'}`);
        failing = true;
      }
      delay = Math.min(delay * 2, maxPollMs);
    }
    await sleep(delay);
  }
  return 0;
}
