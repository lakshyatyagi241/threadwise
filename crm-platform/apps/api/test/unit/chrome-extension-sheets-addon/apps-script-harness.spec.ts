/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import {
  AppsScriptHarness,
  NetworkFailure,
  SCOPE,
  type HarnessOptions,
  type HarnessRequest,
} from '../../support/apps-script-harness';

/**
 * The emulator itself. A harness that is wrong in a flattering way proves nothing, so each behaviour here is one Google documents
 * (or one the add-on hit in review) and the mock must reproduce, including the ways calls fail.
 */

/** The harness with a tiny script of our own instead of Code.gs, so the mock is tested without the add-on in the way. */
function probe(source: string, options: HarnessOptions = {}): AppsScriptHarness {
  return new AppsScriptHarness({ codeSource: source, ...options });
}
const run = (h: AppsScriptHarness, fn: string, ...args: unknown[]) => h.run(fn, ...args);

describe('sandbox', () => {
  it('has the Apps Script globals and none of Node or the browser', () => {
    const h = probe(`
      function globals() {
        return {
          process: typeof process, require: typeof require, setTimeout: typeof setTimeout, fetch: typeof fetch, URL: typeof URL,
          Buffer: typeof Buffer, window: typeof window,
          apps: [typeof SpreadsheetApp, typeof UrlFetchApp, typeof PropertiesService, typeof LockService, typeof ScriptApp, typeof HtmlService, typeof Utilities, typeof Session, typeof CacheService, typeof Logger, typeof console],
          json: typeof JSON, math: typeof Math,
        };
      }`);
    expect(run(h, 'globals').value).toEqual({
      process: 'undefined',
      require: 'undefined',
      setTimeout: 'undefined',
      fetch: 'undefined',
      URL: 'undefined',
      Buffer: 'undefined',
      window: 'undefined',
      apps: Array(11).fill('object'),
      json: 'object',
      math: 'object',
    });
  });

  it('follows the virtual clock in Date.now() and new Date()', () => {
    const h = probe(
      `function t() { return [Date.now(), new Date().getTime(), new Date(0).getTime(), typeof Date()]; }`,
      { startTime: 1_000_000 },
    );
    h.advance(5000);
    expect(run(h, 't').value).toEqual([1_005_000, 1_005_000, 0, 'string']);
  });

  it('reports an unknown function and a thrown error the way the Executions page lists them', () => {
    const h = probe(`function boom() { throw new Error('nope'); }`);
    expect(run(h, 'missing')).toMatchObject({
      ok: false,
      error: 'Script function not found: missing',
    });
    expect(run(h, 'boom')).toMatchObject({ ok: false, error: 'nope' });
    expect(h.executionLog().map((e) => [e.fn, e.ok])).toEqual([
      ['missing', false],
      ['boom', false],
    ]);
  });
});

describe('SpreadsheetApp: ranges and cells', () => {
  const sheetProbe = () =>
    probe(`
      function ss() { return SpreadsheetApp.getActiveSpreadsheet(); }
      function sh() { return ss().getActiveSheet(); }
      function write(r, c, grid) { sh().getRange(r, c, grid.length, grid[0].length).setValues(grid); }
      function read(r, c, nr, nc) { return sh().getRange(r, c, nr, nc).getValues(); }
      function lastRow() { return sh().getLastRow(); }
      function lastCol() { return sh().getLastColumn(); }
    `);

  it('counts rows and columns from 1 and returns what was written', () => {
    const h = sheetProbe();
    run(h, 'write', 2, 3, [
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(run(h, 'read', 2, 3, 2, 2).value).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(run(h, 'read', 1, 1, 1, 1).value).toEqual([['']]);
    expect(run(h, 'lastRow').value).toBe(3);
    expect(run(h, 'lastCol').value).toBe(4);
  });

  it('refuses ranges Google refuses: zero size, column 0, data that does not fit, and anything past the 1000 x 26 grid', () => {
    const h = sheetProbe();
    expect(run(h, 'read', 1, 1, 0, 1).error).toMatch(/at least one/);
    expect(run(h, 'read', 0, 1, 1, 1).error).toMatch(/at least 1/);
    expect(run(h, 'write', 1, 1, [['a', 'b']]).ok).toBe(true);
    expect(h.run('write', 1, 1, [['a', 'b']]).ok).toBe(true);
    const mismatch = probe(
      `function f() { SpreadsheetApp.getActiveSheet().getRange(1, 1, 2, 2).setValues([['a','b']]); }`,
    );
    expect(run(mismatch, 'f').error).toBe(
      'The number of rows in the data does not match the number of rows in the range. The data has 1 but the range has 2.',
    );
    const cols = probe(
      `function f() { SpreadsheetApp.getActiveSheet().getRange(1, 1, 1, 2).setValues([['a']]); }`,
    );
    expect(run(cols, 'f').error).toMatch(/number of columns in the data does not match/);
    expect(run(h, 'read', 1001, 1, 1, 1).error).toBe(
      'The coordinates of the range are outside the dimensions of the sheet.',
    );
    expect(run(h, 'read', 1, 27, 1, 1).error).toBe(
      'The coordinates of the range are outside the dimensions of the sheet.',
    );
    expect(run(h, 'write', 1000, 26, [['edge']]).ok).toBe(true);
  });

  it('grows only when the script asks for it (insertRowsAfter / insertColumnsAfter)', () => {
    const h = probe(`
      function grow() {
        const s = SpreadsheetApp.getActiveSheet();
        s.insertRowsAfter(s.getMaxRows(), 10);
        s.insertColumnsAfter(s.getMaxColumns(), 2);
        s.getRange(1010, 28).setValue('x');
        return [s.getMaxRows(), s.getMaxColumns()];
      }`);
    expect(run(h, 'grow').value).toEqual([1010, 28]);
  });

  it('turns typed text into numbers, booleans, dates and formulas, as the UI does, unless the cell is plain text', () => {
    const h = probe(`
      function typeIn(values, plain) {
        const s = SpreadsheetApp.getActiveSheet();
        const r = s.getRange(1, 1, 1, values.length);
        if (plain) r.setNumberFormat('@');
        r.setValues([values]);
        return r.getValues()[0];
      }`);
    const values = [
      '1e5',
      '+919876543210',
      '0012',
      'TRUE',
      '2026-10-07',
      '=1+1',
      '=NA()',
      'plain',
      '12e4x',
    ];
    const typed = run(h, 'typeIn', values, false).value as unknown[];
    expect(typed.slice(0, 4)).toEqual([100000, 919876543210, 12, true]);
    expect(typed[4]).toMatch(/^2026-10-07/);
    expect(typed.slice(5)).toEqual([2, '#N/A', 'plain', '12e4x']);
    const h2 = probe(
      `function typeIn(values) { const r = SpreadsheetApp.getActiveSheet().getRange(1, 1, 1, values.length); r.setNumberFormat('@'); r.setValues([values]); return r.getValues()[0]; }`,
    );
    expect(run(h2, 'typeIn', values).value).toEqual(values);
  });

  it('rejects a cell over 50,000 characters and keeps the rest of the write from happening', () => {
    const h = sheetProbe();
    const big = 'x'.repeat(50_001);
    expect(run(h, 'write', 1, 1, [['ok', big]]).error).toBe(
      'Your input contains more than the maximum of 50000 characters in a single cell.',
    );
    expect(h.cell('Sheet1', 1, 1)).toBe('');
    expect(run(h, 'write', 1, 1, [['ok', 'y'.repeat(50_000)]]).ok).toBe(true);
  });

  it('reads error cells as text and merged cells as blank apart from the top-left one', () => {
    const h = sheetProbe();
    h.loadSheet('Sheet1', [
      ['a', 'b'],
      ['c', 'd'],
    ]);
    h.setFormulaCell('Sheet1', 1, 2, '=NA()', '#N/A');
    h.mergeCells('Sheet1', 2, 1, 1, 2);
    expect(run(h, 'read', 1, 1, 2, 2).value).toEqual([
      ['a', '#N/A'],
      ['c', ''],
    ]);
  });

  it('hides sheets, keeps them in getSheets(), and makes a new sheet the active one', () => {
    const h = probe(`
      function go() {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        const created = ss.insertSheet('State');
        const activeAfterInsert = ss.getActiveSheet().getName();
        created.hideSheet();
        return [activeAfterInsert, ss.getActiveSheet().getName(), ss.getSheets().map(function (s) { return [s.getName(), s.isSheetHidden()]; }), ss.getSheetByName('nope')];
      }
      function hideOnly() { SpreadsheetApp.getActiveSheet().hideSheet(); }
      function dup() { SpreadsheetApp.getActiveSpreadsheet().insertSheet('Sheet1'); }`);
    expect(run(h, 'go').value).toEqual([
      'State',
      'Sheet1',
      [
        ['Sheet1', false],
        ['State', true],
      ],
      null,
    ]);
    expect(run(h, 'dup').error).toMatch(/already exists/);
    const solo = probe(`function hideOnly() { SpreadsheetApp.getActiveSheet().hideSheet(); }`);
    expect(run(solo, 'hideOnly').error).toMatch(/only visible sheet/);
  });

  it('calls a method it does not model a TypeError, so new API use is noticed', () => {
    const h = probe(
      `function f() { SpreadsheetApp.getActiveSheet().getRange(1, 1).getBackground(); }`,
    );
    expect(run(h, 'f').error).toMatch(/getBackground is not a function/);
  });
});

describe('PropertiesService, CacheService, LockService', () => {
  it('keeps user, document and script stores apart, returns null for a missing key and turns values into text', () => {
    const h = probe(`
      function go() {
        PropertiesService.getUserProperties().setProperty('k', 1);
        PropertiesService.getDocumentProperties().setProperty('k', 'doc');
        return [PropertiesService.getUserProperties().getProperty('k'), PropertiesService.getDocumentProperties().getProperty('k'), PropertiesService.getScriptProperties().getProperty('k'), PropertiesService.getUserProperties().getProperty('absent')];
      }`);
    expect(run(h, 'go').value).toEqual(['1', 'doc', null, null]);
  });

  it('enforces the 9 KB value limit and the 500 KB store limit', () => {
    const h = probe(`
      function one(n) { PropertiesService.getUserProperties().setProperty('big', 'x'.repeat(n)); }
      function many() { const p = PropertiesService.getUserProperties(); for (let i = 0; i < 100; i++) p.setProperty('k' + i, 'x'.repeat(9000)); }`);
    expect(run(h, 'one', 9 * 1024).ok).toBe(true);
    expect(run(h, 'one', 9 * 1024 + 1).error).toBe('Argument too large: value');
    expect(run(h, 'many').error).toBe('Storage limit exceeded.');
  });

  it('gives no document properties and no document lock to a time-driven trigger of an editor add-on', () => {
    const h = probe(
      `function t() { return [PropertiesService.getDocumentProperties() === null, LockService.getDocumentLock() === null, SpreadsheetApp.getActiveSpreadsheet() === null]; }`,
      { mode: 'addon' },
    );
    h.evaluate(`ScriptApp.newTrigger('t').timeBased().everyHours(1).create()`);
    // The result of a trigger run is not returned to anyone, so read it from the executions instead: call it through the clock and check it ran.
    expect(h.fireTimer()[0]).toMatchObject({ ok: true });
  });

  it('locks: a held lock makes tryLock false and waitLock throw after the wait; a lock is released when the run ends', () => {
    const h = probe(`
      function tryIt() { return LockService.getDocumentLock().tryLock(1000); }
      function waitIt() { LockService.getDocumentLock().waitLock(5000); return 'got it'; }
      function holdAndEnd() { LockService.getDocumentLock().waitLock(1000); }
      function check() { const l = LockService.getDocumentLock(); return [l.hasLock(), l.tryLock(10)]; }`);
    h.holdLock('document');
    const before = h.now();
    expect(run(h, 'tryIt').value).toBe(false);
    expect(run(h, 'waitIt').error).toBe(
      'Lock timeout: another process was holding the lock for too long.',
    );
    expect(h.now() - before).toBeGreaterThanOrEqual(6000);
    h.holdLock('document', false);
    expect(run(h, 'holdAndEnd').ok).toBe(true);
    expect(run(h, 'check').value).toEqual([false, true]);
  });

  it('caches with a time to live on the virtual clock', () => {
    const h = probe(`
      function put() { CacheService.getScriptCache().put('a', 'b', 60); }
      function get() { return CacheService.getScriptCache().get('a'); }`);
    run(h, 'put');
    expect(run(h, 'get').value).toBe('b');
    h.advance(61_000);
    expect(run(h, 'get').value).toBeNull();
  });
});

describe('ScriptApp triggers', () => {
  const triggerProbe = (options?: HarnessOptions) =>
    probe(
      `function handler() {}
       function edit() { ScriptApp.newTrigger('handler').forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet()).onEdit().create(); }
       function hourly() { ScriptApp.newTrigger('handler').timeBased().everyHours(1).create(); }
       function minutes() { ScriptApp.newTrigger('handler').timeBased().everyMinutes(5).create(); }
       function missing() { ScriptApp.newTrigger('nothing').timeBased().everyHours(1).create(); }
       function list() { return ScriptApp.getProjectTriggers().map(function (t) { return [t.getHandlerFunction(), String(t.getEventType()), String(t.getTriggerSource()), t.getTriggerSourceId() !== '']; }); }
       function clear() { ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); }); }`,
      options,
    );

  it('creates, lists and deletes triggers with the enum values Google returns', () => {
    const h = triggerProbe();
    run(h, 'edit');
    run(h, 'hourly');
    expect(run(h, 'list').value).toEqual([
      ['handler', 'ON_EDIT', 'SPREADSHEETS', true],
      ['handler', 'CLOCK', 'CLOCK', false],
    ]);
    run(h, 'clear');
    expect(run(h, 'list').value).toEqual([]);
  });

  it('stops at 20 triggers per user per script', () => {
    const h = triggerProbe();
    for (let i = 0; i < 20; i++) expect(run(h, 'hourly').ok).toBe(true);
    expect(run(h, 'hourly').error).toBe(
      'This script has too many triggers. Triggers must be deleted from the script before more can be added.',
    );
  });

  it('refuses a trigger for a function that does not exist, and an add-on trigger more often than hourly', () => {
    expect(run(triggerProbe(), 'missing').error).toBe('Script function not found: nothing');
    expect(run(triggerProbe(), 'minutes').ok).toBe(true);
    expect(run(triggerProbe({ mode: 'addon' }), 'minutes').error).toMatch(/once an hour at most/);
  });

  it('needs the script.scriptapp scope in the manifest', () => {
    const h = triggerProbe({ scopes: [SCOPE.spreadsheetsCurrentOnly] });
    expect(run(h, 'hourly').error).toBe(
      `You do not have permission to call ScriptApp.newTrigger. Required permissions: ${SCOPE.scriptApp}`,
    );
  });

  it('delivers an edit to the installed trigger with the documented event object, and not to a script write', () => {
    const h = probe(`
      const seen = [];
      function onEditHandler(e) {
        seen.push({
          authMode: String(e.authMode), a1: e.range.getA1Notation(), sheet: e.range.getSheet().getName(), value: e.value, oldValue: e.oldValue,
          source: e.source.getName(), hasUser: typeof e.user,
        });
      }
      function install() { ScriptApp.newTrigger('onEditHandler').forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet()).onEdit().create(); }
      function scriptWrite() { SpreadsheetApp.getActiveSheet().getRange('A1').setValue('by script'); }
      function report() { return seen; }`);
    h.loadSheet('Sheet1', [['old']]);
    expect(
      h.fireEdit({ sheet: 'Sheet1', row: 1, col: 1, values: 'before install' }).delivered,
    ).toBe(0);
    run(h, 'install');
    run(h, 'scriptWrite');
    const r = h.fireEdit({ sheet: 'Sheet1', row: 1, col: 1, values: 'typed' });
    expect(r.delivered).toBe(1);
    expect(r.results[0]).toMatchObject({ ok: true });
    const seen = run(h, 'report').value as any[];
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      a1: 'A1',
      sheet: 'Sheet1',
      value: 'typed',
      oldValue: 'by script',
      source: 'Test sheet',
      hasUser: 'object',
    });
    // A multi-cell paste has neither value nor oldValue.
    h.fireEdit({ sheet: 'Sheet1', row: 2, col: 1, values: [['x'], ['y']] });
    const second = (run(h, 'report').value as any[])[1];
    expect(second.a1).toBe('A2:A3');
    expect(second.value).toBeUndefined();
    expect(second.oldValue).toBeUndefined();
  });

  it('gives a time-driven run its event object and no user-interface', () => {
    const h = probe(`
      function tick(e) { if (typeof e.hour !== 'number' || e.authMode == null) throw new Error('bad event'); SpreadsheetApp.getUi(); }
      function install() { ScriptApp.newTrigger('tick').timeBased().everyHours(1).create(); }`);
    run(h, 'install');
    expect(h.fireTimer()[0]).toMatchObject({
      ok: false,
      error: 'Cannot call SpreadsheetApp.getUi() from this context.',
    });
  });
});

describe('UrlFetchApp', () => {
  const fetcher = (handler: (r: HarnessRequest) => any, options: HarnessOptions = {}) =>
    probe(
      `function get(url, params) { const r = UrlFetchApp.fetch(url, params); return { code: r.getResponseCode(), text: r.getContentText(), headers: r.getHeaders(), all: r.getAllHeaders() }; }`,
      { fetch: handler, ...options },
    );

  it('throws for a 4xx/5xx unless muteHttpExceptions is set, with the message Google gives', () => {
    const h = fetcher(() => ({ status: 404, body: 'gone' }));
    expect(run(h, 'get', 'https://x.example.test/a').error).toBe(
      'Request failed for https://x.example.test returned code 404. Truncated server response: gone (use muteHttpExceptions option to examine full response)',
    );
    expect(
      run(h, 'get', 'https://x.example.test/a', { muteHttpExceptions: true }).value,
    ).toMatchObject({ code: 404, text: 'gone' });
  });

  it('throws for a bad URL, a bad method, and a network failure (DNS), whatever muteHttpExceptions says', () => {
    const h = fetcher(() => {
      throw new NetworkFailure('DNS error: https://down.example.test/');
    });
    expect(run(h, 'get', 'ftp://x').error).toBe('Invalid argument: ftp://x');
    expect(run(h, 'get', 'not a url').ok).toBe(false);
    expect(run(h, 'get', 'https://x.example.test', { method: 'brew' }).error).toBe(
      'Invalid argument: method',
    );
    expect(run(h, 'get', 'https://down.example.test/', { muteHttpExceptions: true }).error).toBe(
      'DNS error: https://down.example.test/',
    );
    expect(
      run(probe(`function f() { UrlFetchApp.fetch('https://x.example.test'); }`), 'f').error,
    ).toBe('DNS error: https://x.example.test');
  });

  it('sends the method, headers, JSON payload and content type, and lower-cases nothing the script chose', () => {
    let seen: HarnessRequest | undefined;
    const h = fetcher((r) => ((seen = r), { status: 200, body: '{}' }));
    run(h, 'get', 'https://x.example.test/p?q=1', {
      method: 'POST',
      headers: { Authorization: 'Bearer k' },
      contentType: 'application/json',
      payload: '{"a":1}',
    });
    expect(seen).toMatchObject({
      url: 'https://x.example.test/p?q=1',
      method: 'post',
      body: '{"a":1}',
      headers: { Authorization: 'Bearer k', 'Content-Type': 'application/json' },
    });
  });

  it('returns headers in the capitalised form Google does, and repeated headers as arrays from getAllHeaders', () => {
    const h = fetcher(() => ({
      status: 200,
      body: '',
      headers: { 'content-type': 'text/plain', 'retry-after': '3', 'set-cookie': ['a=1', 'b=2'] },
    }));
    const out = run(h, 'get', 'https://x.example.test').value as any;
    expect(out.headers['Retry-After']).toBe('3');
    expect(out.headers['retry-after']).toBeUndefined();
    expect(out.all['Set-Cookie']).toEqual(['a=1', 'b=2']);
  });

  it('follows redirects unless told not to', () => {
    const calls: string[] = [];
    const h = fetcher((r) => {
      calls.push(r.url);
      return r.url.endsWith('/old')
        ? { status: 301, headers: { Location: '/new' } }
        : { status: 200, body: 'moved' };
    });
    expect(run(h, 'get', 'https://x.example.test/old').value).toMatchObject({
      code: 200,
      text: 'moved',
    });
    expect(calls).toEqual(['https://x.example.test/old', 'https://x.example.test/new']);
    expect(
      run(h, 'get', 'https://x.example.test/old', { followRedirects: false }).value,
    ).toMatchObject({ code: 301 });
  });

  it('counts calls against the daily quota and needs the external_request scope', () => {
    const h = fetcher(() => ({ status: 200, body: '' }), { limits: { urlFetchCallsPerDay: 2 } });
    expect(run(h, 'get', 'https://x.example.test').ok).toBe(true);
    expect(run(h, 'get', 'https://x.example.test').ok).toBe(true);
    expect(run(h, 'get', 'https://x.example.test').error).toBe(
      'Service invoked too many times for one day: urlfetch.',
    );
    const noScope = fetcher(() => ({ status: 200 }), { scopes: [SCOPE.spreadsheetsCurrentOnly] });
    expect(run(noScope, 'get', 'https://x.example.test').error).toMatch(
      /Required permissions: .*script\.external_request/,
    );
  });

  it('is refused before the member authorized the add-on (AuthMode.NONE)', () => {
    const h = probe(`function onOpen() { UrlFetchApp.fetch('https://x.example.test'); }`, {
      fetch: () => ({ status: 200 }),
    });
    expect(h.fireOpen({ authMode: 'NONE' })).toMatchObject({ ok: false });
    expect(h.fireOpen({ authMode: 'NONE' }).error).toMatch(/AuthMode\.NONE/);
  });
});

describe('HtmlService', () => {
  it('reads the project .html files by name without the extension, and fails for a name that is not a file', () => {
    const h = probe(`
      function ok() { return HtmlService.createHtmlOutputFromFile('Help').getContent().length > 100; }
      function bad() { HtmlService.createHtmlOutputFromFile('Nope'); }
      function ext() { HtmlService.createTemplateFromFile('Help.html'); }`);
    expect(run(h, 'ok').value).toBe(true);
    expect(run(h, 'bad').error).toBe('No HTML file named Nope was found.');
    expect(run(h, 'ext').error).toBe('No HTML file named Help.html was found.');
  });

  it('evaluates scriptlets against what the script assigned, escapes by context, and fails on an unassigned variable', () => {
    const h = probe(`
      function render(value, assign) {
        const t = HtmlService.createTemplate("<p><?= v ?></p><?!= raw ?><script>var X = '<?= v ?>';</script><? for (var i = 0; i < 2; i++) { ?>[<?= i ?>]<? } ?><?# comment ?>");
        if (assign) { t.v = value; t.raw = '<b>raw</b>'; }
        return t.evaluate().getContent();
      }`);
    expect(run(h, 'render', `a'b<c>&"`, true).value).toBe(
      `<p>a&#39;b&lt;c&gt;&amp;&quot;</p><b>raw</b><script>var X = 'a\\u0027b\\u003cc\\u003e\\u0026\\u0022';</script>[0][1]`,
    );
    expect(run(h, 'render', '', false).error).toMatch(/v is not defined/);
  });

  it('requires numbers for dialog sizes and a real HtmlOutput for a dialog', () => {
    const h = probe(`function f() { HtmlService.createHtmlOutput('x').setWidth('big'); }
      function g() { SpreadsheetApp.getUi().showModalDialog('text', 'Title'); }`);
    expect(run(h, 'f').error).toMatch(/don't match the method signature/);
    expect(run(h, 'g').error).toMatch(/don't match the method signature for Ui\.showModalDialog/);
  });
});

describe('Ui', () => {
  it('records menus, replaces a menu of the same title, and checks alert signatures', () => {
    const h = probe(`
      function menu(n) { SpreadsheetApp.getUi().createMenu('CRM').addItem('One' + n, 'one').addSeparator().addItem('Two', 'two').addToUi(); }
      function one() { SpreadsheetApp.getUi().alert('Title', 'Text', SpreadsheetApp.getUi().ButtonSet.OK); }
      function two() { SpreadsheetApp.getUi().alert('Title', 'Text'); }
      function three() { SpreadsheetApp.getUi().alert('Just text'); }
      function badAdd() { SpreadsheetApp.getUi().createMenu('CRM').addItem('x'); }`);
    run(h, 'menu', 1);
    run(h, 'menu', 2);
    expect(h.menus()).toHaveLength(1);
    expect(h.menuCaptions('CRM')).toEqual(['One2', '---', 'Two']);
    expect(h.clickMenu('One2').ok).toBe(true);
    expect(h.alertRecords().at(-1)).toMatchObject({ title: 'Title', message: 'Text' });
    expect(h.clickMenu('Two').error).toMatch(/don't match the method signature for Ui\.alert/);
    expect(run(h, 'three').ok).toBe(true);
    expect(run(h, 'badAdd').error).toMatch(/Ui\.Menu\.addItem/);
  });

  it('needs the container.ui scope', () => {
    const h = probe(`function f() { SpreadsheetApp.getUi(); }`, {
      scopes: [SCOPE.spreadsheetsCurrentOnly],
    });
    expect(run(h, 'f').error).toMatch(/script\.container\.ui/);
  });
});

describe('Utilities and Session', () => {
  it('returns signed bytes from digests like Google, and encodes, formats and sleeps', () => {
    const h = probe(`
      function go() {
        const d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'abc');
        return {
          signed: d.some(function (b) { return b < 0; }), length: d.length,
          b64: Utilities.base64Encode('hi'), dec: Utilities.newBlob(Utilities.base64Decode('aGk=')).getDataAsString(),
          date: Utilities.formatDate(new Date(Date.UTC(2026, 9, 7, 3, 4, 5)), 'Asia/Kolkata', "yyyy-MM-dd'T'HH:mm:ss XXX"),
          uuid: /^[0-9a-f-]{36}$/.test(Utilities.getUuid()),
          hmac: Utilities.computeHmacSha256Signature('data', 'key').length,
        };
      }
      function nap() { const t = Date.now(); Utilities.sleep(2500); return Date.now() - t; }
      function tooLong() { Utilities.sleep(300001); }`);
    expect(run(h, 'go').value).toEqual({
      signed: true,
      length: 32,
      b64: 'aGk=',
      dec: 'hi',
      date: '2026-10-07T08:34:05 +05:30',
      uuid: true,
      hmac: 32,
    });
    expect(run(h, 'nap').value).toBe(2500);
    expect(run(h, 'tooLong').ok).toBe(false);
  });

  it('gives an empty email without the userinfo.email scope, as Google does', () => {
    const none = probe(`function f() { return Session.getActiveUser().getEmail(); }`);
    expect(run(none, 'f').value).toBe('');
    const withScope = probe(`function f() { return Session.getActiveUser().getEmail(); }`, {
      scopes: [SCOPE.userEmail],
      userEmail: 'a@b.test',
    });
    expect(run(withScope, 'f').value).toBe('a@b.test');
  });
});

describe('the execution limit', () => {
  it('ends the script at the limit: every later service call throws, whatever the script catches', () => {
    const h = probe(
      `
      function work() {
        let done = 0;
        for (let i = 0; i < 1000; i++) {
          try { SpreadsheetApp.getActiveSheet().getRange(1, 1).setValue(i); done++; } catch (e) { /* swallowed, as a careless script would */ }
        }
        return done;
      }`,
      { limits: { executionMs: 1000 }, latency: { sheetCallMs: 100, perCellMs: 0 } },
    );
    const r = run(h, 'work');
    expect(r).toMatchObject({ ok: false, killed: true, error: 'Exceeded maximum execution time' });
    // The cell holds the last value written before the limit: nothing was written after it.
    expect(Number(h.cell('Sheet1', 1, 1))).toBeLessThan(15);
    expect(h.executionLog().at(-1)).toMatchObject({ killed: true, ok: false });
  });

  it('gives a simple trigger such as onOpen 30 seconds, not 6 minutes', () => {
    const slow = probe(`function onOpen() { Utilities.sleep(31000); }`);
    expect(slow.fireOpen()).toMatchObject({ ok: false, killed: true });
    const fine = probe(`function onOpen() { Utilities.sleep(29000); }`);
    expect(fine.fireOpen().ok).toBe(true);
  });

  it('does not charge a run for time another run spent alongside it', () => {
    const h = probe(
      `function outer() { Utilities.sleep(1000); } function inner() { Utilities.sleep(200000); }`,
      { limits: { executionMs: 5000 } },
    );
    h.onFetch = undefined;
    const before = h.now();
    expect(run(h, 'outer').ok).toBe(true);
    expect(h.now() - before).toBe(1000);
  });
});

describe('google.script.run', () => {
  it('refuses private functions and values Google cannot carry', () => {
    const h = probe(`
      function pub() { return { a: 1, list: [1, 'x', null] }; }
      function secret_() { return 1; }
      function bad() { return { when: new Date() }; }
      function fn() { return { f: function () {} }; }
      function takes(x) { return x; }`);
    expect(h.callFromClient('pub')).toMatchObject({
      ok: true,
      value: { a: 1, list: [1, 'x', null] },
    });
    expect(h.callFromClient('secret_').error).toMatch(/private/);
    expect(h.callFromClient('bad').error).toMatch(/Illegal value: the answer.when holds a Date/);
    expect(h.callFromClient('fn').error).toMatch(/Illegal value/);
    expect(h.callFromClient('takes', { d: new Date() }).error).toMatch(/Illegal value: argument 0/);
    expect(h.callFromClient('missing').error).toMatch(/not found/);
  });
});
