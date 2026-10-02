import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * WD-RBAC-037: a permission key nobody checks documents an intention and changes nothing, which is how WaDesk ended up with 85 dead keys.
 * Every key the workspace-preset migration registers must either be enforced somewhere in `src` or be listed here with the feature that
 * will enforce it. Enforcing one means deleting its line, so this list only ever shrinks.
 */
const AWAITING: Readonly<Record<string, string>> = {
  'inbox.conversation.snooze': 'WD-TIB1 snooze',
  'inbox.conversation.bulk': 'WD-TIB1 bulk actions',
  'inbox.conversation.tag': 'WD-TIB1 labels',
  'inbox.conversation.priority': 'WD-TIB1 priority',
  'inbox.settings.read': 'WD-TIB2 inbox configuration screens',
  'inbox.team.manage': 'WD-TIB2 teams',
  'inbox.tag.manage': 'WD-TIB1 workspace labels',
  'inbox.routing.manage': 'WD-TIB2 routing rules and business hours',
  'inbox.sla.manage': 'WD-TIB2 SLA policies',
  'inbox.savedreply.manage': 'WD-TIB1 saved replies',
  'inbox.integration.manage': 'WD-TIB2 inbox webhooks, AI agents, AI keys',
  'org.delete': 'WD-WSP workspace deletion',
  'billing.manage': 'WD-PLAN / WD-WALLET billing management screens',
};

const root = join(__dirname, '../../..');
const migration = readFileSync(
  join(root, '../../packages/db/migrations/20261013100000_rbac_workspace_presets.sql'),
  'utf8',
);
const registered = [
  ...migration.slice(0, migration.indexOf('ON CONFLICT (key)')).matchAll(/\('([a-z_.]+)',\s*'/g),
].map((m) => m[1]!);

const enforced = (key: string): boolean => {
  try {
    execSync(`grep -rqF "'${key}'" src`, { cwd: root });
    return true;
  } catch {
    return false;
  }
};

describe('workspace permission keys are enforced or awaiting an owner', () => {
  it('registers the keys this test expects', () => {
    expect(registered.length).toBe(18);
  });

  it.each(registered)('%s', (key) => {
    if (AWAITING[key]) {
      expect(enforced(key), `${key} is enforced now: remove it from AWAITING`).toBe(false);
    } else {
      expect(enforced(key), `${key} is registered but nothing checks it`).toBe(true);
    }
  });
});
