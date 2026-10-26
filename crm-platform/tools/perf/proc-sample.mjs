// CPU and RAM of one process, read from /proc (Linux), for the stress report (Sheet4 V-06). No dependency, no child process.
import { readFileSync } from 'node:fs';

const CLK_TCK = 100; // clock ticks per second; 100 on every Linux the stack runs on

/** utime + stime in ticks from the text of /proc/<pid>/stat. The command name sits in brackets and may hold spaces or brackets: cut after the LAST ")". */
export function cpuTicks(stat) {
  const rest = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
  // after the name: state is field 3, utime 14, stime 15 (1-based), so indexes 11 and 12 here
  const ticks = Number(rest[11]) + Number(rest[12]);
  return Number.isFinite(ticks) ? ticks : NaN;
}

/** Resident set size in MB from the text of /proc/<pid>/status (VmRSS is in kB). */
export function rssMb(status) {
  const m = /^VmRSS:\s+(\d+)\s+kB/m.exec(status);
  return m ? Math.round((Number(m[1]) / 1024) * 10) / 10 : NaN;
}

/** One reading of a running process, or null if it is gone. */
export function read(pid) {
  try {
    return {
      at: Date.now(),
      ticks: cpuTicks(readFileSync(`/proc/${pid}/stat`, 'utf8')),
      rssMb: rssMb(readFileSync(`/proc/${pid}/status`, 'utf8')),
    };
  } catch {
    return null;
  }
}

/** CPU percent between two readings: 100 is one full core, so a process on several threads can pass 100. */
export function cpuPct(a, b) {
  const s = (b.at - a.at) / 1000;
  return s > 0 ? Math.round(((b.ticks - a.ticks) / CLK_TCK / s) * 1000) / 10 : NaN;
}

/** Samples `pid` every `everyMs` until stop() is called; stop() returns { cpuAvgPct, cpuMaxPct, rssMaxMb, rssEndMb, samples }. */
export function watch(pid, everyMs = 1000) {
  const first = read(pid);
  const pcts = [];
  const rss = [];
  let last = first;
  const t = setInterval(() => {
    const r = read(pid);
    if (!r || !last) return;
    pcts.push(cpuPct(last, r));
    rss.push(r.rssMb);
    last = r;
  }, everyMs);
  return {
    stop() {
      clearInterval(t);
      const ok = pcts.filter(Number.isFinite);
      const avg = ok.length ? ok.reduce((x, y) => x + y, 0) / ok.length : NaN;
      return {
        cpuAvgPct: Math.round(avg * 10) / 10,
        cpuMaxPct: ok.length ? Math.max(...ok) : NaN,
        rssMaxMb: rss.length ? Math.max(...rss) : NaN,
        rssEndMb: rss.at(-1) ?? NaN,
        samples: ok.length,
      };
    },
  };
}
