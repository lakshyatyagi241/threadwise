/**
 * vitest globalSetup for TEST_NO_DOCKER=1 (see apps/api/vitest.config.ts). Gives the run a tag that every cluster/redis it starts
 * carries in its name (the workers inherit the env), and removes whatever is left of that run in the teardown, even if a worker was
 * killed before its own cleanup ran. A hard kill of the whole run is covered by `pnpm test:nodocker:clean` and the 3 h reaper.
 */
import { randomBytes } from 'node:crypto';
import { cleanRun } from './wsl-runtime';

export default function setup(): () => Promise<void> {
  const tag = `r${randomBytes(3).toString('hex')}`;
  process.env.TEST_NO_DOCKER_RUN = tag;
  return async () => {
    await cleanRun(tag);
  };
}
