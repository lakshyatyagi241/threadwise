// Per-request time attribution for the API, with NO change to the application: load it with `node -r <this file> dist/src/main.js`.
//
//   TRACE_OUT      file the records are appended to, one JSON object per finished request
//
// For every HTTP request it records how the wall time was spent, as seen from inside the process:
//   dur   handler-to-response time, the same clock as the app's own request histogram
//   cw    time spent waiting for a pooled connection (`pool.connect`), and cn how many connections the request took
//   q, qms   statements sent and the sum of their round-trip times
//   tx    transactions opened (BEGIN), txw their total wall time, txq the part of it spent inside statements;
//         txw - txq is the time the app held a transaction open while NOT waiting on a statement (JS work or a busy event loop)
//   rc, rms  Redis commands and the sum of their round-trip times
// What is left of `dur` after all of that is JS work and event-loop queueing. It adds a little overhead of its own (an
// AsyncLocalStorage context and two clock reads per statement); it is a diagnosis tool, not something to leave on in production.
'use strict';
const { AsyncLocalStorage } = require('node:async_hooks');
const fs = require('node:fs');
const http = require('node:http');

const out = process.env.TRACE_OUT;
if (!out) throw new Error('trace-preload: TRACE_OUT is required');
const als = new AsyncLocalStorage();
const now = () => performance.now();
const buffer = [];
setInterval(() => {
  if (buffer.length === 0) return;
  fs.appendFileSync(out, buffer.splice(0).join('\n') + '\n');
}, 1000).unref();
process.on('exit', () => {
  if (buffer.length) fs.appendFileSync(out, buffer.splice(0).join('\n') + '\n');
});

// ---- which statements and commands: per route, signature -> {n, ms}, rewritten to <TRACE_OUT>.agg.json every 2 s ----------------
// A signature is the statement's first 80 characters (whitespace collapsed; bind values are never part of the text) or a Redis
// command with its key cut to the first two ':' segments. Values are never recorded.
const agg = { sql: {}, redis: {} };
function note(kind, route, sig, ms) {
  const per = (agg[kind][route] ??= {});
  const e = per[sig] || (Object.keys(per).length < 300 ? (per[sig] = { n: 0, ms: 0 }) : undefined);
  if (e) {
    e.n++;
    e.ms += ms;
  }
}
setInterval(() => {
  try {
    fs.writeFileSync(out + '.agg.json', JSON.stringify(agg));
  } catch {
    /* best effort */
  }
}, 2000).unref();
const sqlSig = (t) => t.replace(/\s+/g, ' ').trim().slice(0, 80);
const keySig = (k) => {
  const s = String(k).split(':');
  return s.slice(0, 2).join(':') + (s.length > 2 ? ':*' : '');
};

// ---- one record per request ---------------------------------------------------------------------------------------------------
const routeOf = (m, url) =>
  `${m} ${(url || '')
    .split('?')[0]
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ':id')
    .replace(/\/\d+/g, '/:n')}`;
const origEmit = http.Server.prototype.emit;
http.Server.prototype.emit = function (event, request, response) {
  if (event !== 'request') return origEmit.apply(this, arguments);
  const rec = {
    route: routeOf(request.method, request.url),
    t0: now(),
    at: Date.now(),
    q: 0,
    qms: 0,
    cn: 0,
    cw: 0,
    tx: 0,
    txw: 0,
    txq: 0,
    rc: 0,
    rms: 0,
  };
  response.once('finish', () => {
    rec.dur = now() - rec.t0;
    rec.status = response.statusCode;
    delete rec.t0;
    // Wall time during which at least one Redis command was in flight: commands sent together overlap, so this is smaller than
    // `rms` (the sum of their individual round trips) exactly when they were pipelined.
    // `rg` is how many separate stretches that was: commands that overlap form one group, so `rg` counts the Redis waits the request
    // really made one after another. It does not depend on how fast the host was, which `rw` and `rms` do.
    rec.rw = 0;
    rec.rg = 0;
    if (rec.rints) {
      const iv = rec.rints.sort((a, b) => a[0] - b[0]);
      let [s, e] = iv[0];
      rec.rg = 1;
      for (const [a, b] of iv.slice(1)) {
        if (a <= e) e = Math.max(e, b);
        else {
          rec.rw += e - s;
          rec.rg++;
          [s, e] = [a, b];
        }
      }
      rec.rw += e - s;
      delete rec.rints;
    }
    for (const k of ['dur', 'qms', 'cw', 'txw', 'txq', 'rms', 'rw'])
      rec[k] = Math.round(rec[k] * 100) / 100;
    buffer.push(JSON.stringify(rec));
  });
  const args = arguments;
  return als.run(rec, () => origEmit.apply(this, args));
};

// ---- Postgres -----------------------------------------------------------------------------------------------------------------------
const patched = new Set();
function patchPg(pg) {
  if (patched.has(pg)) return;
  patched.add(pg);
  const textOf = (a) => (typeof a === 'string' ? a : a && a.text) || '';

  const origQuery = pg.Client.prototype.query;
  pg.Client.prototype.query = function (...args) {
    const rec = als.getStore();
    if (!rec) return origQuery.apply(this, args);
    const t = now();
    const text = textOf(args[0]);
    const isBegin = /^\s*begin/i.test(text);
    const isEnd = /^\s*(commit|rollback)/i.test(text);
    if (isBegin) {
      rec.tx++;
      this.__trace = { start: t, q: 0 };
    }
    const finish = () => {
      const d = now() - t;
      rec.q++;
      rec.qms += d;
      note('sql', rec.route, sqlSig(text), d);
      const tr = this.__trace;
      if (tr) {
        tr.q += d;
        if (isEnd) {
          rec.txw += now() - tr.start;
          rec.txq += tr.q;
          this.__trace = undefined;
        }
      }
    };
    const last = args.length - 1;
    if (typeof args[last] === 'function') {
      const cb = args[last];
      args[last] = function () {
        finish();
        return cb.apply(this, arguments);
      };
      return origQuery.apply(this, args);
    }
    const r = origQuery.apply(this, args);
    if (r && typeof r.then === 'function') r.then(finish, finish);
    return r;
  };

  const origConnect = pg.Pool.prototype.connect;
  pg.Pool.prototype.connect = function (...args) {
    const rec = als.getStore();
    if (!rec) return origConnect.apply(this, args);
    const t = now();
    rec.cn++;
    const done = () => {
      rec.cw += now() - t;
    };
    if (typeof args[0] === 'function') {
      const cb = args[0];
      args[0] = function () {
        done();
        return cb.apply(this, arguments);
      };
      return origConnect.apply(this, args);
    }
    const r = origConnect.apply(this, args);
    if (r && typeof r.then === 'function') r.then(done, done);
    return r;
  };
}

// ---- Redis ---------------------------------------------------------------------------------------------------------------------------
function patchRedis(mod) {
  const Redis = mod.default || mod.Redis || mod;
  const proto = Redis && Redis.prototype;
  if (!proto || !proto.sendCommand || proto.__traced) return;
  proto.__traced = true;
  const orig = proto.sendCommand;
  proto.sendCommand = function (command) {
    const rec = als.getStore();
    const r = orig.apply(this, arguments);
    if (!rec || !r || typeof r.then !== 'function') return r;
    const t = now();
    rec.rc++;
    const sig = `${String(command.name).toLowerCase()} ${command.args && command.args.length ? keySig(command.args[0]) : ''}`;
    const done = () => {
      const end = now();
      const d = end - t;
      rec.rms += d;
      (rec.rints ??= []).push([t, end]);
      note('redis', rec.route, sig, d);
    };
    r.then(done, done);
    return r;
  };
}

// Patch each module the first time it is loaded, whichever copy of it the app resolves.
const Module = require('node:module');
const origLoad = Module._load;
Module._load = function (request) {
  const exported = origLoad.apply(this, arguments);
  if (request === 'pg' && exported && exported.Pool) patchPg(exported);
  if (request === 'ioredis' && exported) patchRedis(exported);
  // A/B switch for measurements only (run-load.mjs --no-prefetch): turns the guard's early Redis reads off, leaving every other
  // behaviour as built, so the same stack can be measured with and without them back to back.
  if (
    process.env.TRACE_NO_PREFETCH === '1' &&
    typeof request === 'string' &&
    /jwt-auth\.guard$/.test(request) &&
    exported &&
    exported.JwtAuthGuard &&
    !exported.JwtAuthGuard.prototype.__noPrefetch
  ) {
    exported.JwtAuthGuard.prototype.__noPrefetch = true;
    exported.JwtAuthGuard.prototype.startPrefetch = function () {};
  }
  return exported;
};
