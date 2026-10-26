/**
 * Picks the Docker-free runtime for this machine: `wsl-runtime.ts` on Windows (clusters inside WSL), `native-runtime.ts` on macOS and
 * Linux (clusters from the local Postgres 16 and Redis binaries). The shims and the global setup import only this file.
 */
import * as native from './native-runtime';
import * as wsl from './wsl-runtime';

export type { Handle } from './native-runtime';

const impl = process.platform === 'win32' ? wsl : native;

export const startPostgres = impl.startPostgres;
export const startRedis = impl.startRedis;
export const stop = impl.stop;
export const cleanRun = impl.cleanRun;
