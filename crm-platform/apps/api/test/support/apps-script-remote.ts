/**
 * Runs the Apps Script harness in a worker thread, so the UNCHANGED `Code.gs` can call a real HTTP server that lives in the test's own
 * thread (the Nest app of an e2e test).
 *
 * Why a worker: `UrlFetchApp.fetch` is synchronous in Apps Script, but Node's HTTP is not. A synchronous bridge has to block the thread
 * that runs the script, and a blocked thread cannot also serve the HTTP request it is waiting for. So the script runs in a worker; its
 * `fetch` posts the request to the test's thread and blocks in `Atomics.wait` until the test's thread has made the real HTTP call and
 * written the answer back (the same technique `synckit` uses). The test thread stays free, and talks to the worker through the same
 * method names as `AppsScriptHarness`, each returning a promise.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageChannel, Worker } from 'node:worker_threads';
import ts from 'typescript';
import type { AppsScriptHarness, HarnessOptions, HarnessRequest } from './apps-script-harness';

const HARNESS_TS = join(__dirname, 'apps-script-harness.ts');

type RemoteMethods = {
  [
    K in keyof AppsScriptHarness as AppsScriptHarness[K] extends (...args: never[]) => unknown
      ? K
      : never
  ]: AppsScriptHarness[K] extends (...args: infer A) => infer R
    ? (...args: A) => Promise<R>
    : never;
};

export type RemoteAppsScript = RemoteMethods & {
  /** Every real HTTP request the script made (after the host rewrite), with the status the server answered. */
  readonly httpLog: Array<{
    method: string;
    url: string;
    status: number | null;
    body: string | undefined;
  }>;
  stop(): Promise<void>;
};

export interface RemoteOptions extends Omit<HarnessOptions, 'fetch'> {
  /** The real server, e.g. `http://127.0.0.1:41234`. */
  serverUrl: string;
  /** The address the add-on believes it is talking to (what the member pastes), rewritten to `serverUrl`. Default `https://api.example.com`. */
  virtualOrigin?: string;
  /** Added to every request: the e2e harness trusts `x-forwarded-for`, which gives each test its own rate-limit bucket. */
  headers?: Record<string, string>;
}

/** The harness as CommonJS text a worker can `require`, transpiled once per content hash. */
function compiledHarnessPath(): string {
  const source = readFileSync(HARNESS_TS, 'utf8');
  const hash = createHash('sha1').update(source).digest('hex').slice(0, 12);
  const dir = join(tmpdir(), 'crm-apps-script-harness');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `harness-${hash}.cjs`);
  if (!existsSync(file)) {
    const out = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    });
    writeFileSync(file, out.outputText);
  }
  return file;
}

const WORKER_SOURCE = `
const { parentPort, workerData, receiveMessageOnPort } = require('node:worker_threads');
const { AppsScriptHarness, NetworkFailure } = require(workerData.harnessPath);
const flag = new Int32Array(workerData.flag);
const reply = workerData.replyPort;
let seq = 0;
const harness = new AppsScriptHarness({
  ...workerData.options,
  fetch: (request) => {
    const id = ++seq;
    Atomics.store(flag, 0, 0);
    parentPort.postMessage({ type: 'fetch', id, request });
    Atomics.wait(flag, 0, 0);
    const answer = receiveMessageOnPort(reply).message;
    if (answer.networkFailure) throw new NetworkFailure(answer.networkFailure);
    return answer.response;
  },
});
parentPort.on('message', (msg) => {
  try {
    const value = harness[msg.method](...msg.args);
    parentPort.postMessage({ type: 'result', id: msg.id, ok: true, value });
  } catch (error) {
    parentPort.postMessage({ type: 'result', id: msg.id, ok: false, error: String((error && error.message) || error) });
  }
});
parentPort.postMessage({ type: 'ready' });
`;

export async function startRemoteAppsScript(options: RemoteOptions): Promise<RemoteAppsScript> {
  const {
    serverUrl,
    virtualOrigin = 'https://api.example.com',
    headers = {},
    ...harnessOptions
  } = options;
  const flagBuffer = new SharedArrayBuffer(4);
  const flag = new Int32Array(flagBuffer);
  const { port1, port2 } = new MessageChannel();
  const httpLog: RemoteAppsScript['httpLog'] = [];
  const worker = new Worker(WORKER_SOURCE, {
    eval: true,
    workerData: {
      harnessPath: compiledHarnessPath(),
      flag: flagBuffer,
      replyPort: port2,
      options: {
        ...harnessOptions,
        // The compiled harness lives in the temp folder, so its own default for this would be wrong there.
        assetsDir:
          harnessOptions.assetsDir ?? join(__dirname, '..', '..', 'assets', 'google-sheets-addon'),
      },
    },
    transferList: [port2],
  });

  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  let seq = 0;
  let ready!: () => void;
  let failReady!: (e: Error) => void;
  const readyPromise = new Promise<void>((resolve, reject) => {
    ready = resolve;
    failReady = reject;
  });
  let failure: Error | null = null;

  const answerFetch = async (request: HarnessRequest): Promise<void> => {
    let message: Record<string, unknown>;
    let status: number | null = null;
    try {
      if (!request.url.startsWith(virtualOrigin)) throw new Error(`DNS error: ${request.url}`);
      const url = serverUrl + request.url.slice(virtualOrigin.length);
      const res = await fetch(url, {
        method: request.method.toUpperCase(),
        headers: { ...request.headers, ...headers },
        body: request.body,
        redirect: 'manual',
      });
      const text = await res.text();
      const responseHeaders: Record<string, string | string[]> = {};
      res.headers.forEach((value, name) => {
        const prev = responseHeaders[name];
        responseHeaders[name] = prev === undefined ? value : ([] as string[]).concat(prev, value);
      });
      status = res.status;
      message = { response: { status: res.status, body: text, headers: responseHeaders } };
      httpLog.push({ method: request.method, url, status, body: request.body });
    } catch (error) {
      message = { networkFailure: error instanceof Error ? error.message : String(error) };
      httpLog.push({ method: request.method, url: request.url, status: null, body: request.body });
    }
    port1.postMessage(message);
    Atomics.store(flag, 0, 1);
    Atomics.notify(flag, 0);
  };

  worker.on(
    'message',
    (msg: {
      type: string;
      id?: number;
      ok?: boolean;
      value?: unknown;
      error?: string;
      request?: HarnessRequest;
    }) => {
      if (msg.type === 'ready') ready();
      else if (msg.type === 'fetch') void answerFetch(msg.request!);
      else if (msg.type === 'result') {
        const waiter = pending.get(msg.id!);
        pending.delete(msg.id!);
        if (msg.ok) waiter?.resolve(msg.value);
        else waiter?.reject(new Error(msg.error));
      }
    },
  );
  worker.on('error', (error: Error) => {
    failure = error;
    failReady(error);
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  });
  await readyPromise;

  const invoke = (method: string, args: unknown[]) =>
    new Promise<unknown>((resolve, reject) => {
      if (failure) return reject(failure);
      const id = ++seq;
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, method, args });
    });

  return new Proxy({ httpLog } as RemoteAppsScript, {
    get(target, key: string) {
      if (key === 'httpLog') return target.httpLog;
      if (key === 'stop') {
        return async () => {
          port1.close();
          await worker.terminate();
        };
      }
      if (key === 'then') return undefined;
      return (...args: unknown[]) => invoke(key, args);
    },
  });
}
