import { fork, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import type { Env } from './harness';

export interface RemoteInstance {
  pid: number;
  call<T = unknown>(op: string, ...args: unknown[]): Promise<T>;
  kill(): void;
}

/** Starts one more application process (see instance-proc.ts) on the same Postgres and Redis as `env`. */
export async function spawnInstance(
  env: Pick<Env, 'appUrl' | 'redis'>,
  name: string,
  redisUrl = env.redis.url,
): Promise<RemoteInstance> {
  const child: ChildProcess = fork(resolve(__dirname, 'instance-proc.ts'), [], {
    execArgv: ['--import', 'tsx'],
    env: { ...process.env, CI66_APP_URL: env.appUrl, CI66_REDIS_URL: redisUrl, CI66_NAME: name },
    cwd: resolve(__dirname, '../../..'),
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  let seq = 1;
  const waiting = new Map<number, (m: { ok: boolean; value?: unknown; error?: string }) => void>();
  await new Promise<void>((ok, bad) => {
    const t = setTimeout(() => bad(new Error(`instance ${name} did not start`)), 60_000);
    child.once('exit', (c) => bad(new Error(`instance ${name} exited early (${c})`)));
    child.on('message', (m: { id: number; ok: boolean; value?: unknown; error?: string }) => {
      if (m.id === 0) {
        clearTimeout(t);
        ok();
      } else waiting.get(m.id)?.(m);
    });
  });
  return {
    pid: child.pid!,
    call<T>(op: string, ...args: unknown[]) {
      const id = seq++;
      return new Promise<T>((ok, bad) => {
        waiting.set(id, (m) => {
          waiting.delete(id);
          if (m.ok) ok(m.value as T);
          else bad(new Error(m.error));
        });
        child.send({ id, op, args });
      });
    },
    kill: () => void child.kill('SIGKILL'),
  };
}
