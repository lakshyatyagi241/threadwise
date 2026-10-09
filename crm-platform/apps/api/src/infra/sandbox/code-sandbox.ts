import { Worker } from 'node:worker_threads';

/**
 * The sandbox behind the flow's Code node (TW-FLR-033): the author's JavaScript runs in a `node:vm` context inside a worker thread.
 *
 * What it gives: no `require`, `process`, `fs`, network, `Buffer` or timers (the context has only the language's own intrinsics); the
 * inputs go in as a JSON string parsed INSIDE the context and the result comes out as a JSON string, so no host object or host
 * constructor chain is ever reachable (`constructor.constructor('return process')()` finds the context's own `Function`, whose global
 * has no `process`); a wall-clock limit on synchronous code (`vm` timeout, with microtasks run inside it) and a hard kill of the worker
 * a second after that; a heap cap per worker (`resourceLimits`), so a runaway allocation kills the worker and not the API.
 *
 * What it does NOT give (the honest ceiling): `node:vm` is not a security boundary against a determined attacker (a V8 escape would
 * land in the worker, which shares the process, the filesystem and the network of the API; it holds no secrets and no database
 * handle, but it is not a container). A worker is started per run (tens of milliseconds), so a flow with a Code node in a hot loop
 * pays that each time. The upgrade path is `isolated-vm` (separate V8 isolate) or a sandbox process with no network, behind this
 * same function.
 */
export interface SandboxResult {
  ok: boolean;
  error: string | null;
  result: unknown;
}

export interface SandboxOptions {
  timeoutMs?: number;
  memoryMb?: number;
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(Math.max(n, lo), hi);

/** The author's code is the body of a function: `return` the value. Inputs are the three names Reference gave it. */
const wrap = (code: string): string => `
  (function () {
    var __ctx = JSON.parse(__inputs);
    var previousResponse = __ctx.previousResponse;
    var allResponses = __ctx.allResponses;
    var functionArgs = __ctx.functionArgs;
    var __run = function () { ${code}
    };
    var __out = __run();
    return JSON.stringify(__out === undefined ? null : __out);
  })()
`;

/** The worker's whole program, evaluated as a string so it needs no file next to the compiled output. */
const WORKER_SOURCE = `
  const vm = require('node:vm');
  const { parentPort, workerData } = require('node:worker_threads');
  try {
    const sandbox = Object.create(null);
    sandbox.__inputs = String(workerData.inputsJson);
    const context = vm.createContext(sandbox, {
      codeGeneration: { strings: true, wasm: false },
      microtaskMode: 'afterEvaluate',
    });
    const script = new vm.Script(String(workerData.wrapped), { filename: 'flow-code-node.js' });
    const out = script.runInContext(context, { timeout: workerData.timeoutMs, breakOnSigint: true });
    parentPort.postMessage({ ok: true, out });
  } catch (e) {
    parentPort.postMessage({ ok: false, error: String((e && e.message) || e || 'sandbox error') });
  }
`;

export function runUserCode(
  code: string,
  inputs: Record<string, unknown>,
  options: SandboxOptions = {},
): Promise<SandboxResult> {
  const timeoutMs = clamp(Math.trunc(options.timeoutMs ?? 2000) || 2000, 100, 10_000);
  const memoryMb = clamp(Math.trunc(options.memoryMb ?? 16) || 16, 8, 128);
  if (code.trim() === '') return Promise.resolve({ ok: true, error: null, result: null });

  let inputsJson: string;
  try {
    inputsJson = JSON.stringify(inputs);
  } catch {
    return Promise.resolve({ ok: false, error: 'Inputs could not be serialised', result: null });
  }

  return new Promise<SandboxResult>((resolve) => {
    let settled = false;
    let worker: Worker | undefined;
    const done = (r: SandboxResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      void worker?.terminate();
      resolve(r);
    };
    const fail = (message: string) =>
      done({ ok: false, error: message.slice(0, 300), result: null });
    const killTimer = setTimeout(
      () => fail('Code execution exceeded time limit'),
      timeoutMs + 1000,
    );
    try {
      worker = new Worker(WORKER_SOURCE, {
        eval: true,
        workerData: { wrapped: wrap(code), inputsJson, timeoutMs },
        resourceLimits: {
          maxOldGenerationSizeMb: memoryMb,
          maxYoungGenerationSizeMb: Math.max(2, Math.floor(memoryMb / 4)),
        },
        env: {},
        stdout: false,
        stderr: false,
      });
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e));
      return;
    }
    worker.on('message', (m: { ok: boolean; out?: string; error?: string }) => {
      if (!m.ok) return fail(m.error ?? 'sandbox error');
      let result: unknown = null;
      try {
        result = JSON.parse(String(m.out));
      } catch {
        result = m.out ?? null;
      }
      done({ ok: true, error: null, result });
    });
    worker.on('error', (e) => fail(e instanceof Error ? e.message : String(e)));
    worker.on('exit', (exit) => {
      if (!settled) fail(`Code sandbox terminated (exit ${exit}): memory limit exceeded`);
    });
  });
}
