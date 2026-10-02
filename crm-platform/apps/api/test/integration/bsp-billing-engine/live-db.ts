import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The BSP tests run against the database this worktree already owns (`crm_bsp`, from the worktree's .env) instead of a
 * testcontainer: the swarm rules forbid starting containers, and the schema under test is the real migrated one either way.
 * They arrange data with the owner connection and always remove what they created.
 */
export function loadEnv(): Record<string, string> {
  const text = readFileSync(resolve(__dirname, '../../../../../.env'), 'utf8');
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (m) out[m[1]!] = m[2]!.replace(/^["']|["']$/g, '');
  }
  return out;
}

export const env = loadEnv();
export const OWNER_URL = env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL!;
/**
 * The owner connection, running as the restricted application role (`options=-c role=...` switches the session's current_user, which is
 * what row-level security judges). The .env's own application login does not authenticate on this machine, and a superuser would
 * make every isolation assertion vacuous; this keeps the assertions real without another credential.
 */
export const APP_URL = `${OWNER_URL}${OWNER_URL.includes('?') ? '&' : '?'}options=-c%20role%3Dcrm_app_user`;
