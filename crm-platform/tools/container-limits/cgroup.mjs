// Reads what a container's cgroup (v2) says it used, and judges it against the limits it was given (Sheet4 V-05).
// Pure functions over the text of the cgroup files, so they are tested without Docker; the runner feeds them `docker exec <c> cat ...`.

/** "key value" lines (cpu.stat, memory.events) to an object of numbers. */
export function parseKeyValue(text) {
  const out = {};
  for (const line of String(text).split('\n')) {
    const m = /^(\S+)\s+(-?\d+)\s*$/.exec(line);
    if (m) out[m[1]] = Number(m[2]);
  }
  return out;
}

/** A file holding one number ("max" is no limit). */
export const parseNumber = (text) => {
  const t = String(text).trim();
  return t === 'max' ? Infinity : Number(t);
};

/**
 * What the run cost the container, from two cpu.stat readings and the single-value files.
 * throttledPct is the share of CPU periods in which the container hit its cap and was held back.
 */
export function usage({
  cpuStart,
  cpuEnd,
  memoryPeak,
  memoryEvents,
  pidsPeak,
  pidsCurrent,
  seconds,
}) {
  const periods = (cpuEnd.nr_periods ?? 0) - (cpuStart.nr_periods ?? 0);
  const throttled = (cpuEnd.nr_throttled ?? 0) - (cpuStart.nr_throttled ?? 0);
  const cpuUsec = (cpuEnd.usage_usec ?? 0) - (cpuStart.usage_usec ?? 0);
  return {
    cpuAvgCores: seconds > 0 ? Math.round((cpuUsec / 1e6 / seconds) * 100) / 100 : NaN,
    throttledPeriods: throttled,
    periods,
    throttledPct: periods > 0 ? Math.round((throttled / periods) * 1000) / 10 : 0,
    throttledSeconds:
      Math.round(((cpuEnd.throttled_usec ?? 0) - (cpuStart.throttled_usec ?? 0)) / 1e4) / 100,
    memoryPeakMb: Math.round((memoryPeak / 1048576) * 10) / 10,
    oomKills: memoryEvents.oom_kill ?? 0,
    pidsPeak: pidsPeak ?? pidsCurrent,
  };
}

/**
 * The limits a run is judged against, and the verdict: [{ name, ok, detail }]. Throttling fails only when the cap is the bottleneck, more than
 * half of the CPU periods held back: a saturated server is held back in some periods by design (the API sat at 10 to 15% with a 2 core cap and
 * served the same requests per second as with 1.5), but a web server at a 1 core cap was held back in 98% and took twice as long.
 */
export function judge(
  u,
  limits,
  budgets = { throttledPct: 50, memoryOfLimit: 0.9, pidsOfLimit: 0.5 },
) {
  const mem = limits.memoryBytes ? (u.memoryPeakMb * 1048576) / limits.memoryBytes : 0;
  const pids = limits.pids ? u.pidsPeak / limits.pids : 0;
  return [
    { name: 'no-oom-kill', ok: u.oomKills === 0, detail: `${u.oomKills} kills` },
    {
      name: 'memory-peak',
      ok: mem <= budgets.memoryOfLimit,
      detail: `${u.memoryPeakMb} MB = ${Math.round(mem * 100)}% of the limit (budget ${budgets.memoryOfLimit * 100}%)`,
    },
    {
      name: 'pids-peak',
      ok: pids <= budgets.pidsOfLimit,
      detail: `${u.pidsPeak} of ${limits.pids} = ${Math.round(pids * 100)}% (budget ${budgets.pidsOfLimit * 100}%)`,
    },
    {
      name: 'cpu-throttling',
      ok: u.throttledPct <= budgets.throttledPct,
      detail: `${u.throttledPct}% of periods throttled, ${u.throttledSeconds} s held back, average ${u.cpuAvgCores} cores of ${limits.cpus}`,
    },
  ];
}

/** An image-size budget: the size must stay at or under `maxBytes`. */
export const sizeCheck = (bytes, maxBytes) => ({
  name: 'image-size',
  ok: bytes <= maxBytes,
  detail: `${Math.round(bytes / 1e6)} MB as docker lists it, budget ${Math.round(maxBytes / 1e6)} MB`,
});

/** `docker image ls` prints sizes as "479MB", "1.2GB", "92.4kB" (decimal units); bytes, or NaN. */
export function parseDockerSize(text) {
  const m = /^\s*([\d.]+)\s*(B|kB|KB|MB|GB|TB)\s*$/.exec(String(text));
  if (!m) return NaN;
  const mult = { B: 1, kB: 1e3, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12 }[m[2]];
  return Math.round(Number(m[1]) * mult);
}
