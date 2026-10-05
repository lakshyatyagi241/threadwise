import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const WEB = join(__dirname, '..', '..', '..');
type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([k, v]) =>
    typeof v === 'string' ? [`${prefix}${k}`] : flatten(v, `${prefix}${k}.`),
  );
}
const load = (locale: string) =>
  JSON.parse(readFileSync(join(WEB, 'messages', locale, 'shell.json'), 'utf8')) as Tree;

describe('shell messages', () => {
  it('Arabic has exactly the keys English has', () => {
    expect(flatten(load('ar')).sort()).toEqual(flatten(load('en')).sort());
  });

  it('has every key the chrome asks for', () => {
    const keys = new Set(flatten(load('en')));
    const used = [
      'soon',
      'new',
      'locked',
      'comingSoon',
      'openMenu',
      'closeMenu',
      'mainMenu',
      'userMenu',
      'account',
      'balance',
      'notifications',
      'settings',
      'help',
      'language',
      'theme',
      'themeLight',
      'themeDark',
      'logout',
    ];
    expect(used.filter((k) => !keys.has(`shell.${k}`))).toEqual([]);
  });
});
