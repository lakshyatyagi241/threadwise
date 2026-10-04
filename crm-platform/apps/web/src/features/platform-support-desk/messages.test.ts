import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BOARD_COLUMNS,
  NOTE_SEVERITIES,
  PLAYBOOK_ACTIONS,
  PLAYBOOK_TRIGGERS,
  SUPP_INBOX_TABS,
  WORKSPACE_FLAGS,
} from '@crm/contracts';
import { SUPP_OPERATOR_NAV } from './operator-nav';

type Tree = { [key: string]: string | Tree };
const root = (
  JSON.parse(
    readFileSync(join(process.cwd(), 'messages', 'en', 'platform-support-desk.json'), 'utf8'),
  ) as {
    'platform-support-desk': Tree;
  }
)['platform-support-desk'];
const get = (path: string): unknown =>
  path.split('.').reduce<unknown>((n, k) => (n as Tree | undefined)?.[k], root);

describe('platform-support-desk messages', () => {
  it('has a label for every enum the screens render', () => {
    const missing: string[] = [];
    const need = (prefix: string, keys: readonly string[]) =>
      keys.forEach(
        (k) => typeof get(`${prefix}.${k}`) !== 'string' && missing.push(`${prefix}.${k}`),
      );
    need('board.columns', BOARD_COLUMNS);
    need('inbox.severity', NOTE_SEVERITIES);
    need('inbox.tabs', SUPP_INBOX_TABS);
    need('inbox.flags.names', WORKSPACE_FLAGS);
    need('playbooks.actions', PLAYBOOK_ACTIONS);
    need('playbooks.triggers', PLAYBOOK_TRIGGERS);
    expect(missing).toEqual([]);
  });

  it('every menu entry resolves to a label and the entries are unique', () => {
    for (const item of SUPP_OPERATOR_NAV) {
      expect(typeof get(item.labelKey.replace('platform-support-desk.', ''))).toBe('string');
      expect(item.href.startsWith('/admin/')).toBe(true);
    }
    expect(new Set(SUPP_OPERATOR_NAV.map((i) => i.id)).size).toBe(SUPP_OPERATOR_NAV.length);
    expect(SUPP_OPERATOR_NAV.map((i) => i.href)).toEqual(
      expect.arrayContaining([
        '/admin/support',
        '/admin/support/team-inbox',
        '/admin/support/agents',
        '/admin/support/sla',
        '/admin/support/customers',
        '/admin/support/playbooks',
        '/admin/support/reports',
      ]),
    );
  });
});
