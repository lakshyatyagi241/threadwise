import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ReleaseInfo } from '@crm/contracts';
import type { InstEnv } from '../../config/domains/install-update-licensing.env';

/** The API's own package.json, found by walking up (the compiled layout is one level deeper than the source's). */
export function readPackageVersion(from: string = __dirname): string {
  let dir = from;
  for (let i = 0; i < 8; i += 1) {
    const candidate = join(dir, 'package.json');
    if (existsSync(candidate)) {
      try {
        const pkg = JSON.parse(readFileSync(candidate, 'utf8')) as {
          name?: string;
          version?: string;
        };
        if (pkg.name === '@crm/api' && pkg.version) return pkg.version;
      } catch {
        // an unreadable package.json is not the one we want; keep walking
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return '0.0.0';
}

export function buildReleaseInfo(
  env: InstEnv,
  nodeEnv: ReleaseInfo['environment'],
  version: string = readPackageVersion(),
): ReleaseInfo {
  return {
    version,
    gitSha: env.GIT_SHA ?? null,
    buildNumber: env.BUILD_NUMBER ?? null,
    builtAt: env.BUILT_AT ?? null,
    environment: nodeEnv,
    demoMode: env.DEMO_MODE,
  };
}
