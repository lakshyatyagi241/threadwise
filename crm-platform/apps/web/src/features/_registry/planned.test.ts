import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hasNavIcon } from '@/components/shell/nav-icons';
import { PLANNED_NAV } from './planned';
import { NAV_GROUPS } from './types';

const WEB = join(__dirname, '..', '..', '..');
type Tree = { [key: string]: string | Tree };
const shell = (locale: string) =>
  (JSON.parse(readFileSync(join(WEB, 'messages', locale, 'shell.json'), 'utf8')) as Tree)
    .shell as Tree;

describe('planned screens', () => {
  it('have unique ids and unique addresses', () => {
    const ids = PLANNED_NAV.map((i) => i.id);
    const hrefs = PLANNED_NAV.map((i) => i.href);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it('use a known group, an absolute address and a drawn icon', () => {
    for (const i of PLANNED_NAV) {
      expect(NAV_GROUPS as readonly string[], i.id).toContain(i.group);
      expect(i.href.startsWith('/'), i.id).toBe(true);
      expect(hasNavIcon(i.icon), `${i.id} icon`).toBe(true);
    }
  });

  it('add the CRM and Sales entries in menu order', () => {
    const ids = (g: string) =>
      PLANNED_NAV.filter((i) => i.group === g)
        .sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
        .map((i) => i.id);
    expect(ids('audience')).toEqual(['lead-finder', 'pipelines', 'companies', 'email-templates']);
    expect(ids('sales')).toEqual(['crm-dashboard']);
  });

  it('cover the WaDesk groups the real screens do not', () => {
    const groups = new Set<string>(PLANNED_NAV.map((i) => i.group));
    for (const g of ['inbox', 'campaigns', 'automation', 'sales', 'store', 'help']) {
      expect(groups.has(g), g).toBe(true);
    }
  });

  it('hold no configuration screen: those are Settings tiles', () => {
    const ids = new Set(PLANNED_NAV.map((i) => i.id));
    for (const gone of [
      'channels',
      'telegram',
      'sms',
      'line',
      'viber',
      'wechat',
      'email',
      'wa-links',
      'integrations',
      'rest-api',
      'webhooks',
      'activity-log',
      'team-members',
      'auto-reply',
      'chat-widget',
    ]) {
      expect(ids.has(gone), gone).toBe(false);
    }
    expect(
      PLANNED_NAV.some(
        (i) => (i.group as string) === 'channels' || (i.group as string) === 'developer',
      ),
    ).toBe(false);
  });

  it('have a label in English and Arabic, and every group has a heading', () => {
    for (const locale of ['en', 'ar']) {
      const nav = shell(locale).nav as Tree;
      for (const i of PLANNED_NAV) {
        expect(i.labelKey.startsWith('shell.nav.'), i.id).toBe(true);
        expect(typeof nav[i.labelKey.slice('shell.nav.'.length)], `${locale} ${i.id}`).toBe(
          'string',
        );
      }
      const groups = shell(locale).groups as Tree;
      for (const g of NAV_GROUPS) expect(typeof groups[g], `${locale} group ${g}`).toBe('string');
    }
  });
});
