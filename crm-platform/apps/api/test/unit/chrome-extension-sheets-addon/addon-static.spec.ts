import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AppsScriptHarness, SCOPE } from '../../support/apps-script-harness';
import { FAKE_HOOK_URL, FakeCrm, leadsSheet, submit } from '../../support/apps-script-addon-kit';

/**
 * Static checks of the add-on folder: the manifest, the scopes it asks for against the Google APIs Code.gs actually uses, and the three
 * dialogs against the functions and variables Code.gs gives them. These need no Google and no network.
 */

const DIR = join(__dirname, '..', '..', '..', 'assets', 'google-sheets-addon');
const read = (name: string) => readFileSync(join(DIR, name), 'utf8');
const code = read('Code.gs');
const manifest = JSON.parse(read('appsscript.json')) as {
  timeZone: string;
  dependencies: Record<string, unknown>;
  exceptionLogging: string;
  runtimeVersion: string;
  oauthScopes: string[];
  addOns?: Record<string, unknown>;
  webapp?: unknown;
  urlFetchWhitelist?: string[];
};
const PAGES = ['Dialog', 'Settings', 'Help'] as const;
const html = Object.fromEntries(PAGES.map((p) => [p, read(`${p}.html`)])) as Record<
  (typeof PAGES)[number],
  string
>;

/** Code.gs without comments and string contents, so a word in a sentence does not count as an API call. */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}
const bare = codeOnly(code);

describe('appsscript.json', () => {
  it('is valid JSON for the V8 runtime with a real IANA time zone and no libraries', () => {
    expect(manifest.runtimeVersion).toBe('V8');
    expect(() => new Intl.DateTimeFormat('en', { timeZone: manifest.timeZone })).not.toThrow();
    expect(manifest.timeZone).toMatch(/^[A-Za-z_]+(?:\/[A-Za-z_+\-0-9]+)*$/);
    expect(manifest.dependencies).toEqual({});
    expect(Array.isArray(manifest.oauthScopes)).toBe(true);
  });

  it('logs exceptions nowhere: a failure can quote the member own rows, which must not reach a Cloud project of ours', () => {
    expect(['NONE', 'STACKDRIVER']).toContain(manifest.exceptionLogging);
    expect(manifest.exceptionLogging).toBe('NONE');
  });

  it('declares no web app and no URL allow-list (the CRM address is chosen by the member at paste time)', () => {
    expect(manifest.webapp).toBeUndefined();
    expect(manifest.urlFetchWhitelist).toBeUndefined();
  });

  it('lists each scope once, in the narrow forms, and nothing broader', () => {
    expect(new Set(manifest.oauthScopes).size).toBe(manifest.oauthScopes.length);
    for (const scope of manifest.oauthScopes) {
      expect(scope).toMatch(/^https:\/\/www\.googleapis\.com\/auth\/[a-z_.]+$/);
    }
    // Whole-spreadsheet, Drive, Gmail and "see who you are" scopes are not asked for.
    expect(manifest.oauthScopes).not.toContain(SCOPE.spreadsheets);
    expect(manifest.oauthScopes).not.toContain(SCOPE.userEmail);
    expect(manifest.oauthScopes.join(' ')).not.toMatch(
      /drive|gmail|mail|calendar|documents|userinfo|\.readonly/,
    );
  });

  it('asks for exactly the scopes the Google APIs in Code.gs need, each one justified by a use found in the source', () => {
    // Each rule: a scope, and the API use in Code.gs that requires it.
    const uses: Array<[string, RegExp, string]> = [
      [SCOPE.externalRequest, /\bUrlFetchApp\b/, 'UrlFetchApp.fetch (every call to the CRM)'],
      [
        SCOPE.scriptApp,
        /\bScriptApp\b/,
        'ScriptApp.newTrigger / getProjectTriggers / deleteTrigger (the edit and hourly triggers)',
      ],
      [
        SCOPE.containerUi,
        /\bgetUi\(\)|\bHtmlService\b|showModalDialog|showSidebar/,
        'SpreadsheetApp.getUi (menu, dialogs, alerts)',
      ],
      [
        SCOPE.spreadsheetsCurrentOnly,
        /\bSpreadsheetApp\b/,
        'SpreadsheetApp (the sheet the add-on runs in)',
      ],
    ];
    const needed = uses.filter(([, pattern]) => pattern.test(bare)).map(([scope]) => scope);
    expect([...manifest.oauthScopes].sort()).toEqual([...needed].sort());
    // `currentonly` is enough only while the code never opens another spreadsheet.
    expect(bare).not.toMatch(/\bopenById\b|\bopenByUrl\b|SpreadsheetApp\.create\b/);
    // Services that would need another scope are not used.
    expect(bare).not.toMatch(
      /\b(?:MailApp|GmailApp|DriveApp|DocumentApp|CalendarApp|ContactsApp|FormApp|SlidesApp|GroupsApp|AdminDirectory|DataStudioApp)\b/,
    );
    expect(bare).not.toMatch(
      /Session\.getActiveUser\(\)\.getEmail|Session\.getEffectiveUser\(\)\.getEmail/,
    );
    expect(bare).not.toMatch(/ScriptApp\.getOAuthToken/);
  });

  it('has the menu and install entry points an editor add-on needs, and no addOns block (that is for Workspace card add-ons)', () => {
    expect(code).toMatch(/^function onOpen\(/m);
    expect(code).toMatch(/^function onInstall\(/m);
    if (manifest.addOns) {
      // A Workspace add-on would need a homepage function; this one is menu-based.
      expect(JSON.stringify(manifest.addOns)).toMatch(/homepageTrigger/);
    } else {
      expect(manifest.addOns).toBeUndefined();
    }
  });

  it('is the same list the README tells members the add-on asks for', () => {
    const readme = read('README.md');
    for (const scope of manifest.oauthScopes) {
      expect(readme, scope).toContain(scope.replace('https://www.googleapis.com/auth/', ''));
    }
    expect(readme).toMatch(/four permissions/);
  });

  it('is shown on the consent screen with only the permissions the scopes name: a full run asks for each one and none else', () => {
    const crm = new FakeCrm();
    const h = new AppsScriptHarness({ fetch: crm.handler });
    leadsSheet(h, 3);
    h.fireOpen();
    h.clickMenu('Initial Setup');
    submit(h, { column: 'B', onEvent: true, onSchedule: true });
    h.clickMenu('Send a test row');
    h.clickMenu('Check connection');
    h.callFromClient('testWebhook', FAKE_HOOK_URL, 'B', 'Leads');
    h.fireEdit({ sheet: 'Leads', row: 2, col: 2, values: 'x@example.com' });
    h.fireTimer();
    h.callFromClient('runPush', {});
    h.callFromClient('runPull', {});
    h.callFromClient('clearKey');
    expect(h.scopesUsed()).toEqual([...manifest.oauthScopes].sort());
    for (const record of h.executionLog()) {
      for (const scope of record.scopesUsed) expect(manifest.oauthScopes).toContain(scope);
    }
  });

  it('runs with only the four scopes: removing any one of them breaks something the add-on does', () => {
    for (const removed of manifest.oauthScopes) {
      const crm = new FakeCrm();
      const h = new AppsScriptHarness({
        fetch: crm.handler,
        scopes: manifest.oauthScopes.filter((s) => s !== removed),
      });
      leadsSheet(h, 2);
      const failures = [
        h.fireOpen().ok,
        h.callFromClient('getSettingsState').ok,
        (submit(h, { onEvent: true, onSchedule: true }) as { ok: boolean }).ok,
      ];
      expect(failures.includes(false), `without ${removed}`).toBe(true);
    }
  });
});

describe('Code.gs source rules', () => {
  it('declares CRM_BASE once, on one line, and nothing else rewrites it', () => {
    expect(code.match(/const\s+CRM_BASE\s*=/g)).toHaveLength(1);
    expect(code).toMatch(/^const CRM_BASE = 'https:\/\/api\.example\.com';$/m);
  });

  it('has no Logger or console call, and none of the browser or Node names Apps Script does not have', () => {
    expect(bare).not.toMatch(/\b(?:Logger|console)\./);
    expect(bare).not.toMatch(
      /\b(?:setTimeout|setInterval|require|process|window|document|localStorage|XMLHttpRequest|Buffer|structuredClone)\b/,
    );
    expect(bare).not.toMatch(/\bnew URL\(|(?<![.\w])fetch\(/);
    expect(bare).not.toMatch(/^\s*(?:import|export)\s/m);
    expect(bare).not.toMatch(/\beval\(|new Function\(/);
  });

  it('never puts the key into a document property, a sheet cell, a dialog value or a URL', () => {
    expect(code).not.toMatch(/docProps_\(\)\.setProperty\(PROP_KEY/);
    expect(bare).not.toMatch(/getDocumentProperties\(\)[^;]*PROP_KEY/);
    expect(bare).not.toMatch(/getScriptProperties/);
    // The key goes out in one header and nowhere else.
    expect(code.match(/'Bearer ' \+ key/g)).toHaveLength(1);
    expect(bare).not.toMatch(/\+\s*key\b(?!\s*,)(?<!Bearer ' \+ key)/);
  });

  it('declares every function once (a second declaration silently replaces the first)', () => {
    const names = [...code.matchAll(/^function (\w+)\(/gm)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(40);
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
  });

  it('declares the trigger handlers it installs by name, as public functions', () => {
    for (const [constant, fn] of [
      ['EVENT_HANDLER', 'crmOnEditSend'],
      ['SCHEDULE_HANDLER', 'crmScheduledSend'],
    ]) {
      expect(code).toContain(`const ${constant} = '${fn}';`);
      expect(code).toMatch(new RegExp(`^function ${fn}\\(`, 'm'));
    }
  });

  it('uses only names Apps Script gives it for the Google services', () => {
    const services = new Set([
      'SpreadsheetApp',
      'HtmlService',
      'PropertiesService',
      'LockService',
      'ScriptApp',
      'UrlFetchApp',
      'Utilities',
      'Session',
      'CacheService',
    ]);
    const used = [...bare.matchAll(/\b([A-Z][A-Za-z]+(?:App|Service))\b/g)].map((m) => m[1]!);
    for (const name of used) expect(services.has(name), name).toBe(true);
  });
});

describe('the dialogs against Code.gs', () => {
  const serverCalls = (page: string): string[] => {
    // google.script.run.withSuccessHandler(...).withFailureHandler(...).<serverFunction>(...)
    const names: string[] = [];
    let at = page.indexOf('google.script.run');
    while (at !== -1) {
      let i = at + 'google.script.run'.length;
      for (;;) {
        const m = /^\s*\.\s*([A-Za-z_]\w*)\s*\(/.exec(page.slice(i));
        if (!m) break;
        const name = m[1]!;
        i += m[0].length;
        let depth = 1;
        while (i < page.length && depth > 0) {
          if (page[i] === '(') depth++;
          else if (page[i] === ')') depth--;
          i++;
        }
        if (!['withSuccessHandler', 'withFailureHandler', 'withUserObject'].includes(name)) {
          names.push(name);
          break;
        }
      }
      at = page.indexOf('google.script.run', at + 1);
    }
    return names;
  };

  it('every google.script.run function a page calls is a public global function of Code.gs', () => {
    const declared = new Set([...code.matchAll(/^function (\w+)\(/gm)].map((m) => m[1]));
    for (const page of PAGES) {
      for (const name of serverCalls(html[page])) {
        expect(declared.has(name), `${page}.html calls ${name}`).toBe(true);
        expect(name.endsWith('_'), `${name} is private`).toBe(false);
      }
    }
    // And the pages do call the server (the parser above found something).
    expect(serverCalls(html.Settings)).toEqual(
      expect.arrayContaining(['getSettingsState', 'testWebhook', 'submitSetup', 'clearKey']),
    );
    expect(serverCalls(html.Dialog)).toEqual(
      expect.arrayContaining([
        'getDialogState',
        'runPull',
        'runPush',
        'runProductSync',
        'listShops',
      ]),
    );
  });

  it('every scriptlet variable is one the code supplies to that page, and no page prints unescaped', () => {
    const supplied = new Set([...code.matchAll(/template\.(\w+)\s*=/g)].map((m) => m[1]));
    for (const page of PAGES) {
      expect(html[page], page).not.toMatch(/<\?!=/);
      for (const m of html[page].matchAll(/<\?=\s*([\s\S]*?)\s*\?>/g)) {
        for (const id of m[1]!.match(/[A-Za-z_]\w*/g) ?? []) {
          expect(supplied.has(id), `${page}.html uses <?= ${id} ?>`).toBe(true);
        }
      }
    }
    expect(html.Dialog).toContain('<?= mode ?>');
  });

  it('every template or file name Code.gs opens is one of the HTML files, without the .html', () => {
    const asked = [
      ...code.matchAll(/(?:createTemplateFromFile|createHtmlOutputFromFile)\((\w+|'[^']+')\)/g),
    ].map((m) => m[1]!);
    expect(asked).toEqual(['file']);
    const files = [...code.matchAll(/showDialog_\('(\w+(?:\.\w+)?)'/g)].map((m) => m[1]!);
    expect(files.length).toBeGreaterThanOrEqual(5);
    for (const f of files) expect(PAGES as readonly string[]).toContain(f);
  });

  it('no page writes markup from data, loads outside code, uses a modal the sandbox ignores, or evaluates text', () => {
    for (const page of PAGES) {
      const text = html[page].replace(/<!--[\s\S]*?-->/g, '');
      expect(text, page).not.toMatch(
        /\.innerHTML|\.outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function\(|setTimeout\(\s*['"`]|javascript:/,
      );
      expect(text, page).not.toMatch(
        /<script[^>]+src=|<link[^>]+href=["']?https?:|<iframe|@import|url\(\s*['"]?https?:/,
      );
      expect(text, page).not.toMatch(/\b(?:alert|confirm|prompt)\(/);
      expect(text, page).not.toMatch(/\blocalStorage\b|\bsessionStorage\b|document\.cookie/);
    }
  });

  it('every element id a page script reaches for exists in that page, and every label points at one', () => {
    for (const page of PAGES) {
      const text = html[page];
      const ids = new Set([...text.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]!));
      for (const m of text.matchAll(/(?:\bel|getElementById)\(\s*'([^']+)'\s*\)/g)) {
        expect(ids.has(m[1]!), `${page}.html: element "${m[1]}"`).toBe(true);
      }
      for (const m of text.matchAll(/\bfor="([^"]+)"/g)) {
        expect(ids.has(m[1]!), `${page}.html: label for "${m[1]}"`).toBe(true);
      }
      for (const m of text.matchAll(/\baria-(?:describedby|labelledby)="([^"]+)"/g)) {
        expect(ids.has(m[1]!), `${page}.html: aria "${m[1]}"`).toBe(true);
      }
      const all = [...text.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
      expect(
        all.filter((id, i) => all.indexOf(id) !== i),
        `${page}.html duplicate ids`,
      ).toEqual([]);
    }
  });

  it('every page is a complete document, in English, with a viewport and a title', () => {
    for (const page of PAGES) {
      expect(html[page]).toMatch(/^<!doctype html>/i);
      expect(html[page]).toMatch(/<html lang="en">/);
      expect(html[page]).toMatch(/<meta name="viewport"/);
      expect(html[page]).toMatch(/<title>[^<]+<\/title>/);
    }
  });

  it('opens each page without a scriptlet error and with its mode filled in', () => {
    const h = new AppsScriptHarness({ fetch: new FakeCrm().handler });
    h.loadSheet('Leads', [['Email'], ['a@example.com']], { activate: true });
    for (const fn of [
      'openSetup',
      'openSettings',
      'openHelp',
      'openPull',
      'openPush',
      'openProducts',
    ]) {
      expect(h.run(fn).ok, fn).toBe(true);
    }
    const dialogs = h.dialogHtml();
    expect(dialogs).toHaveLength(6);
    expect(dialogs.map((d) => d.html.match(/var MODE = '(\w*)'/)?.[1])).toEqual([
      undefined,
      undefined,
      undefined,
      'pull',
      'push',
      'products',
    ]);
    for (const d of dialogs) expect(d.html).not.toMatch(/<\?|\?>/);
  });
});
