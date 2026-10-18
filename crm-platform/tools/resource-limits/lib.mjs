// Pure helpers for the resource-limits check: a small compose reader and the budget arithmetic. No dependencies, so the check runs
// before `pnpm install`. The reader understands only what our compose files use: block maps, `- item` lists, `&anchor` / `<<: *anchor`
// merges and `|` block scalars (skipped). Anything else is kept as a plain string.

const MIB = 1024 * 1024;

/** "1g", "768m", "1536M", "192mb", "2GiB" -> bytes. Returns undefined when it is not a size. */
export function parseSize(value) {
  if (value === undefined || value === null) return undefined;
  const m = String(value)
    .trim()
    .match(/^(\d+(?:\.\d+)?)\s*(b|k|kb|kib|m|mb|mib|g|gb|gib)?$/i);
  if (!m) return undefined;
  const n = Number(m[1]);
  const unit = (m[2] ?? 'b').toLowerCase();
  const mult = {
    b: 1,
    k: 1024,
    kb: 1024,
    kib: 1024,
    m: MIB,
    mb: MIB,
    mib: MIB,
    g: 1024 * MIB,
    gb: 1024 * MIB,
    gib: 1024 * MIB,
  }[unit];
  return Math.round(n * mult);
}

const stripQuotes = (s) => s.replace(/^(['"])(.*)\1$/, '$2');

/** Indentation-based read of a compose file into plain objects. Lists become arrays of strings. */
export function parseCompose(text) {
  const lines = text.split(/\r?\n/);
  const root = {};
  const anchors = {};
  // stack of { indent, node, key } where node receives children of the line that opened it
  const stack = [{ indent: -1, node: root }];
  let skipBelow = null; // block scalar: skip lines indented deeper than this
  for (const raw of lines) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const indent = raw.length - raw.trimStart().length;
    if (skipBelow !== null) {
      if (indent > skipBelow) continue;
      skipBelow = null;
    }
    const line = raw.trim();
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].node;
    if (line.startsWith('- ')) {
      const owner = stack[stack.length - 1];
      if (!Array.isArray(owner.node) && owner.holder) {
        owner.holder[owner.holderKey] = [];
        owner.node = owner.holder[owner.holderKey];
      }
      if (Array.isArray(owner.node)) owner.node.push(stripQuotes(line.slice(2).trim()));
      continue;
    }
    const m = line.match(/^(<<|[^:\s][^:]*?):(?:\s+(.*))?$/);
    if (!m) continue;
    const key = stripQuotes(m[1].trim());
    let rest = (m[2] ?? '').replace(/\s+#.*$/, '').trim();
    if (key === '<<') {
      const name = rest.replace(/^\*/, '');
      if (anchors[name])
        for (const [k, v] of Object.entries(anchors[name])) if (!(k in parent)) parent[k] = v;
      continue;
    }
    let anchorName = null;
    const am = rest.match(/^&(\S+)\s*(.*)$/);
    if (am) {
      anchorName = am[1];
      rest = am[2];
    }
    if (rest === '|' || rest === '>' || rest === '|-' || rest === '>-') {
      parent[key] = '<block>';
      skipBelow = indent;
      continue;
    }
    if (rest === '') {
      const child = {};
      parent[key] = child;
      if (anchorName) anchors[anchorName] = child;
      // a following `- item` line turns this into a list
      stack.push({ indent, node: child, holder: parent, holderKey: key });
    } else {
      parent[key] = stripQuotes(rest);
    }
  }
  return root;
}

/** Memory limit of a service in bytes: `mem_limit`, else `deploy.resources.limits.memory`. */
export function serviceMemLimit(svc) {
  return parseSize(svc.mem_limit) ?? parseSize(svc.deploy?.resources?.limits?.memory);
}
export function serviceCpuLimit(svc) {
  const v = svc.cpus ?? svc.deploy?.resources?.limits?.cpus;
  return v === undefined ? undefined : Number(v);
}
export function servicePidsLimit(svc) {
  const v = svc.pids_limit ?? svc.deploy?.resources?.limits?.pids;
  return v === undefined ? undefined : Number(v);
}
export const serviceEnv = (svc) =>
  svc.environment && !Array.isArray(svc.environment) ? svc.environment : {};

export function heapLimitBytes(nodeOptions) {
  const m = String(nodeOptions ?? '').match(/--max-old-space-size[= ](\d+)/);
  return m ? Number(m[1]) * MIB : undefined;
}

/** Postgres/Redis flags from a `command:` list: ['-c','max_connections=100'] or ['--maxmemory','192mb']. */
export function commandFlag(command, name) {
  const list = Array.isArray(command) ? command : [];
  for (let i = 0; i < list.length; i++) {
    const item = String(list[i]).replace(/^\[|\]$/g, '');
    const eq = item.match(new RegExp(`^${name}=(.+)$`));
    if (eq) return eq[1];
    if (item === `--${name}` && list[i + 1] !== undefined) return String(list[i + 1]);
  }
  return undefined;
}

/** Redis/PG flags written as an inline flow list `[ 'redis-server', '--maxmemory', '192mb' ]`, possibly over several lines. */
export function flowListFlag(rawCommand, name) {
  const s = String(rawCommand ?? '');
  const m = s.match(new RegExp(`['"]--${name}['"]\\s*,\\s*['"]([^'"]+)['"]`));
  return m ? m[1] : undefined;
}

/**
 * Sum of the `concurrency` values of every `@Processor(QUEUES.X, { ... })` in the given source texts. A processor with no
 * concurrency counts 1 (BullMQ default) and is listed in `implicit`.
 */
export function processorConcurrency(sources) {
  const found = [];
  const implicit = [];
  for (const [file, text] of sources) {
    for (const m of text.matchAll(
      /@Processor\(\s*QUEUES\.([A-Z0-9_]+)\s*(?:,\s*\{([\s\S]*?)\}\s*)?\)/g,
    )) {
      const c = m[2]?.match(/concurrency\s*:\s*(\d+)/);
      if (!c) implicit.push({ queue: m[1], file });
      found.push({ queue: m[1], file, concurrency: c ? Number(c[1]) : 1 });
    }
  }
  return { processors: found, total: found.reduce((a, p) => a + p.concurrency, 0), implicit };
}

/** The checks. `facts` is built by check.mjs from the repo; `registry` is the version-controlled policy. */
export function evaluate(facts, registry) {
  const results = [];
  const add = (id, res, status, summary, detail = {}) =>
    results.push({ id, res, status, summary, ...detail });
  const gib = (b) => (b / 1024 ** 3).toFixed(2);
  const p = registry.thresholds;

  for (const dep of facts.deployments) {
    const tag = dep.name;
    // RES-011: every long-running service has a memory ceiling.
    const noMem = dep.services
      .filter((s) => !s.oneShot && s.memLimit === undefined)
      .map((s) => s.name);
    add(
      `${tag}:mem-limit`,
      ['RES-011'],
      noMem.length ? 'FAILED' : 'PASSED',
      noMem.length
        ? `no memory limit: ${noMem.join(', ')}`
        : 'every long-running service has a memory limit',
      { services: noMem },
    );
    // RES-012, RES-016: CPU and PID ceilings.
    const noCpu = dep.services
      .filter((s) => !s.oneShot && s.cpuLimit === undefined)
      .map((s) => s.name);
    add(
      `${tag}:cpu-limit`,
      ['RES-012'],
      noCpu.length ? 'FAILED' : 'PASSED',
      noCpu.length
        ? `no CPU limit: ${noCpu.join(', ')}`
        : 'every long-running service has a CPU limit',
      { services: noCpu },
    );
    const noPid = dep.services
      .filter((s) => !s.oneShot && s.pidsLimit === undefined)
      .map((s) => s.name);
    add(
      `${tag}:pids-limit`,
      ['RES-016'],
      noPid.length ? 'FAILED' : 'PASSED',
      noPid.length
        ? `no PID limit: ${noPid.join(', ')}`
        : 'every long-running service has a PID limit',
      { services: noPid },
    );
    const noLog = dep.services.filter((s) => !s.logging).map((s) => s.name);
    add(
      `${tag}:log-cap`,
      ['RES-066'],
      noLog.length ? 'FAILED' : 'PASSED',
      noLog.length
        ? `log size not capped: ${noLog.join(', ')}`
        : 'every service caps its log files',
      { services: noLog },
    );

    // RES-022/023: V8 heap must leave room for the rest of the process.
    const heapBad = dep.services
      .filter((s) => s.heapLimit && s.memLimit && s.heapLimit > s.memLimit * p.heapToMemoryMax)
      .map((s) => `${s.name}: heap ${gib(s.heapLimit)} GiB of ${gib(s.memLimit)} GiB`);
    add(
      `${tag}:heap-headroom`,
      ['RES-022', 'RES-023'],
      heapBad.length ? 'FAILED' : 'PASSED',
      heapBad.length
        ? `V8 heap above ${p.heapToMemoryMax * 100}% of the container: ${heapBad.join('; ')}`
        : `V8 heap is at most ${p.heapToMemoryMax * 100}% of the container limit`,
      { services: heapBad },
    );
    const noHeap = dep.services
      .filter((s) => s.runsNode && s.memLimit && !s.heapLimit)
      .map((s) => s.name);
    add(
      `${tag}:heap-set`,
      ['RES-022'],
      noHeap.length ? 'FAILED' : 'PASSED',
      noHeap.length
        ? `Node service without --max-old-space-size: ${noHeap.join(', ')}`
        : 'every Node service sets a heap limit',
      { services: noHeap },
    );

    // RES-005/006: memory budget. Steady = one slot, overlap = both slots during a release.
    const sum = (list) => list.reduce((a, s) => a + (s.memLimit ?? 0), 0);
    const steady = sum(dep.services.filter((s) => !s.oneShot && !s.slot2));
    const overlap = sum(dep.services.filter((s) => !s.oneShot));
    const host = registry.hosts?.[dep.name]?.memoryBytes ?? null;
    if (host === null || host === undefined) {
      add(
        `${tag}:host-budget`,
        ['RES-002', 'RES-005'],
        'BLOCKED',
        `host RAM is not recorded (steady limits ${gib(steady)} GiB, release overlap ${gib(overlap)} GiB); fill hosts.${dep.name}.memoryBytes from the real host`,
        { steady, overlap },
      );
    } else {
      const usable = host * (1 - p.hostHeadroom);
      add(
        `${tag}:host-budget`,
        ['RES-005', 'RES-006'],
        overlap > usable ? 'FAILED' : 'PASSED',
        `limits ${gib(overlap)} GiB at release overlap (${gib(steady)} steady) against ${gib(usable)} GiB usable of ${gib(host)} GiB`,
        { steady, overlap, host },
      );
    }

    // RES-031/032: database connections.
    const pg = dep.services.find((s) => s.maxConnections);
    if (pg) {
      const apps = dep.services.filter((s) => s.dbPoolMax);
      const need = apps.reduce((a, s) => a + s.dbPoolMax * (s.poolsPerProcess ?? 1), 0);
      const budget = Math.floor(pg.maxConnections * (1 - p.dbConnectionReserve));
      add(
        `${tag}:db-connections`,
        ['RES-031', 'RES-032'],
        need > budget ? 'FAILED' : 'PASSED',
        `${apps.map((s) => `${s.name} ${s.dbPoolMax}x${s.poolsPerProcess ?? 1}`).join(' + ')} = ${need} connections at release overlap, budget ${budget} of max_connections ${pg.maxConnections}`,
        { need, budget },
      );
    }

    // RES-041/042: Redis.
    const redis = dep.services.find((s) => s.redisMaxMemory !== undefined || s.isRedis);
    if (redis) {
      if (!redis.redisMaxMemory) {
        add(
          `${tag}:redis-maxmemory`,
          ['RES-041'],
          'FAILED',
          'Redis has no maxmemory: a queue backlog grows until the container is OOM-killed (AOF and queue state lost with it)',
        );
      } else if (redis.memLimit && redis.redisMaxMemory > redis.memLimit * p.redisToMemoryMax) {
        add(
          `${tag}:redis-maxmemory`,
          ['RES-041'],
          'FAILED',
          `maxmemory ${gib(redis.redisMaxMemory)} GiB leaves less than ${(1 - p.redisToMemoryMax) * 100}% of the ${gib(redis.memLimit)} GiB container for the AOF rewrite fork and buffers`,
        );
      } else {
        add(
          `${tag}:redis-maxmemory`,
          ['RES-041'],
          'PASSED',
          `maxmemory ${gib(redis.redisMaxMemory)} GiB inside a ${redis.memLimit ? gib(redis.memLimit) : '?'} GiB container`,
        );
      }
      add(
        `${tag}:redis-eviction`,
        ['RES-042'],
        redis.redisPolicy === 'noeviction' ? 'PASSED' : 'FAILED',
        `eviction policy is ${redis.redisPolicy ?? 'default (noeviction only by default when no maxmemory)'}; queue state must use noeviction`,
      );
    }

    // RES-019: graceful stop.
    const shortStop = dep.services
      .filter(
        (s) =>
          s.stopGraceSeconds !== undefined &&
          s.name.match(/worker/) &&
          s.stopGraceSeconds < p.workerStopGraceMinSeconds,
      )
      .map((s) => s.name);
    add(
      `${tag}:worker-stop-grace`,
      ['RES-019'],
      shortStop.length ? 'FAILED' : 'PASSED',
      shortStop.length
        ? `worker stop grace under ${p.workerStopGraceMinSeconds}s: ${shortStop.join(', ')}`
        : `worker stop grace is at least ${p.workerStopGraceMinSeconds}s`,
    );
  }

  // RES-047: worker concurrency against the worker's pool.
  const w = facts.workerConcurrency;
  const pool = facts.workerPoolMax;
  add(
    'worker:concurrency-vs-pool',
    ['RES-031', 'RES-047', 'RES-078'],
    pool && w.total > pool * p.workerConcurrencyPerPoolSlot ? 'FAILED' : 'PASSED',
    `${w.processors.length} processors, summed concurrency ${w.total}, worker pool ${pool}; ratio ${(w.total / (pool || 1)).toFixed(1)} (limit ${p.workerConcurrencyPerPoolSlot})`,
    { total: w.total, pool },
  );
  add(
    'worker:explicit-concurrency',
    ['RES-047'],
    w.implicit.length ? 'FAILED' : 'PASSED',
    w.implicit.length
      ? `processors with no explicit concurrency: ${w.implicit.map((i) => i.queue).join(', ')}`
      : 'every processor sets concurrency',
  );
  return results;
}

/**
 * Compares results with the accepted gaps in the registry. A FAILED or BLOCKED result that is listed (by id) is "accepted"; one that
 * is not listed is a regression and fails the check; a listed id that now passes is stale and fails too, so the list only shrinks.
 */
export function applyAccepted(results, accepted) {
  const acc = new Map((accepted ?? []).map((a) => [a.id, a]));
  const regressions = [];
  const stale = [];
  const expired = [];
  const today = new Date().toISOString().slice(0, 10);
  for (const r of results) {
    const bad = r.status === 'FAILED' || r.status === 'BLOCKED';
    const a = acc.get(r.id);
    if (bad && !a) regressions.push(r);
    if (!bad && a) stale.push(r.id);
    if (bad && a?.expires && a.expires < today) expired.push(r.id);
  }
  for (const id of acc.keys()) if (!results.some((r) => r.id === id)) stale.push(id);
  return { regressions, stale: [...new Set(stale)], expired };
}
