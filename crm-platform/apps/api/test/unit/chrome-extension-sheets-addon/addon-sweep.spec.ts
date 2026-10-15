/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { AppsScriptHarness } from '../../support/apps-script-harness';
import {
  FAKE_HOOK_URL,
  FAKE_KEY,
  fromPage,
  leadsSheet,
  newKit,
  submit,
} from '../../support/apps-script-addon-kit';

/**
 * Sending rows: the edit trigger ("Send on event"), the hourly sweep ("Send on schedule"), the hidden state sheet, chunking, partial
 * failure, the execution limit, and the odd cells a real sheet holds. Code.gs is unchanged; Google and the CRM are faked.
 */

const STATE = 'CRM sync state';
const statusColumn = (h: AppsScriptHarness, sheet = 'Leads') => {
  const grid = h.grid(sheet);
  const col = (grid[0] ?? []).indexOf('CRM status');
  return col < 0 ? null : grid.slice(1).map((r) => r[col]);
};
const webhookRows = (crm: ReturnType<typeof newKit>['crm']) => crm.sentRows('/webhook');

describe('Send on event: the edit trigger', () => {
  it('sends the edited row as a contact, writes its result in a CRM status column and remembers it in a hidden state sheet', () => {
    const { h, crm } = newKit();
    leadsSheet(h, 3);
    submit(h, { column: 'B', onEvent: true });
    const edit = h.fireEdit({ sheet: 'Leads', row: 3, col: 2, values: 'new@example.com' });
    expect(edit.delivered).toBe(1);
    expect(edit.results[0]).toMatchObject({ ok: true });

    const call = crm.callsTo('/webhook').at(-1)!;
    expect(call.event).toBe('edit');
    expect(call.body.sheet_name).toBe('Leads');
    expect(call.body.rows).toEqual([
      {
        ref: 3,
        name: 'Person 2',
        email: 'new@example.com',
        values: { Name: 'Person 2', Email: 'new@example.com', Phone: '' },
      },
    ]);
    expect(statusColumn(h)).toEqual(['', 'created', '']);
    expect(h.grid('Leads')[0]).toEqual(['Name', 'Email', 'Phone', 'CRM status']);

    expect(h.sheetNames()).toContain(STATE);
    expect(h.sheetInfo(STATE)!.hidden).toBe(true);
    expect(h.grid(STATE)).toHaveLength(1);
    expect(h.grid(STATE)[0]![0]).toBe('Leads!3');
  });

  it('leaves the member on the sheet they were working in when it creates the hidden state sheet', () => {
    const { h } = newKit();
    h.loadSheet('Notes', [['x']]);
    leadsSheet(h, 2);
    h.loadSheet('Other', [['y']]);
    submit(h, { column: 'B', onEvent: true });
    h.setActiveSheet('Leads');
    h.fireEdit({ sheet: 'Leads', row: 2, col: 2, values: 'q@example.com' });
    expect(h.sheetNames()).toContain(STATE);
    expect(h.activeSheetName()).toBe('Leads');
  });

  it('ignores an edit outside the trigger column, on the header row, on another sheet, and on the state sheet', () => {
    const { h, crm } = newKit();
    leadsSheet(h, 3);
    h.loadSheet('Other', [['Email'], ['x@example.com']]);
    submit(h, { column: 'B', onEvent: true });
    h.fireEdit({ sheet: 'Leads', row: 2, col: 1, values: 'Renamed' });
    h.fireEdit({ sheet: 'Leads', row: 1, col: 2, values: 'Email' });
    h.fireEdit({ sheet: 'Other', row: 2, col: 1, values: 'z@example.com' });
    expect(crm.callsTo('/webhook')).toEqual([]);
    h.fireEdit({ sheet: 'Leads', row: 2, col: 2, values: 'ok@example.com' });
    h.fireEdit({ sheet: STATE, row: 1, col: 1, values: 'tampered' });
    expect(crm.callsTo('/webhook')).toHaveLength(1);
  });

  it('does not send a row whose trigger cell is empty, and sends on any cell when no trigger column is set', () => {
    const { h, crm } = newKit();
    leadsSheet(h, 2);
    submit(h, { column: 'C', onEvent: true });
    h.fireEdit({ sheet: 'Leads', row: 2, col: 3, values: '' });
    expect(crm.callsTo('/webhook')).toEqual([]);
    submit(h, { column: '', onEvent: true });
    h.fireEdit({ sheet: 'Leads', row: 2, col: 1, values: 'Another name' });
    expect(crm.callsTo('/webhook')).toHaveLength(1);
  });

  it('finds the trigger column by its heading, whatever the case, and by a letter', () => {
    const { h, crm } = newKit();
    leadsSheet(h, 2);
    submit(h, { column: 'e-mail', onEvent: true });
    h.fireEdit({ sheet: 'Leads', row: 2, col: 2, values: 'a@example.com' });
    expect(crm.callsTo('/webhook')).toHaveLength(1);
    submit(h, { column: 'c', onEvent: true });
    h.fireEdit({ sheet: 'Leads', row: 2, col: 3, values: '+919876543210' });
    expect(crm.callsTo('/webhook')).toHaveLength(2);
  });

  it('reads a short heading such as "Age" or "ID" as a heading, not as the column letters AGE or ID', () => {
    const { h, crm } = newKit();
    h.loadSheet(
      'Leads',
      [
        ['Name', 'Email', 'Age'],
        ['A', 'a@example.com', 30],
      ],
      { activate: true },
    );
    submit(h, { column: 'Age', onEvent: true });
    h.fireEdit({ sheet: 'Leads', row: 2, col: 3, values: 31 });
    expect(crm.callsTo('/webhook')).toHaveLength(1);
    expect(h.evaluate<number>(`columnIndex_('Age', ['Name', 'Email', 'Age'])`)).toBe(2);
    expect(h.evaluate<number>(`columnIndex_('B', ['Name', 'Email', 'Age'])`)).toBe(1);
    expect(h.evaluate<number>(`columnIndex_('ID', ['Name'])`)).toBeGreaterThan(100);
  });

  it('is not delivered at all until Submit installs the trigger, and not after it is switched off', () => {
    const { h, crm } = newKit();
    leadsSheet(h, 2);
    expect(h.fireEdit({ sheet: 'Leads', row: 2, col: 2, values: 'a@example.com' }).delivered).toBe(
      0,
    );
    submit(h, { onEvent: true });
    expect(h.fireEdit({ sheet: 'Leads', row: 2, col: 2, values: 'b@example.com' }).delivered).toBe(
      1,
    );
    submit(h, { onEvent: false });
    expect(h.fireEdit({ sheet: 'Leads', row: 2, col: 2, values: 'c@example.com' }).delivered).toBe(
      0,
    );
    expect(crm.callsTo('/webhook')).toHaveLength(1);
  });

  it('sends at most 50 rows of one paste (the hourly sweep carries the rest)', () => {
    const { h, crm } = newKit();
    h.loadSheet('Leads', [['Name', 'Email']], { activate: true });
    submit(h, { column: 'B', onEvent: true });
    const paste = Array.from({ length: 120 }, (_, i) => [`N${i}`, `n${i}@example.com`]);
    h.fireEdit({ sheet: 'Leads', row: 2, col: 1, values: paste });
    expect(webhookRows(crm)).toHaveLength(50);
    submit(h, { column: 'B', onEvent: true, onSchedule: true });
    h.fireTimer();
    expect(crm.contacts).toHaveLength(120);
  });

  it('does not throw into the member when the CRM refuses, and writes no state for a row that was not accepted', () => {
    const { h, crm } = newKit();
    leadsSheet(h, 2);
    submit(h, { column: 'B', onEvent: true });
    crm.answerNext({
      status: 401,
      body: JSON.stringify({ ok: false, code: 'EXT_KEY_INVALID', error: 'x' }),
    });
    const r = h.fireEdit({ sheet: 'Leads', row: 2, col: 2, values: 'q@example.com' });
    expect(r.results[0]!.ok).toBe(true);
    expect(h.sheetNames()).not.toContain(STATE);
    expect(statusColumn(h)).toBeNull();
  });

  it('survives a network exception in the middle of an edit', () => {
    const { h, crm } = newKit();
    leadsSheet(h, 2);
    submit(h, { column: 'B', onEvent: true });
    crm.failNextWithNetworkError();
    expect(
      h.fireEdit({ sheet: 'Leads', row: 2, col: 2, values: 'q@example.com' }).results[0]!.ok,
    ).toBe(true);
    expect(h.sheetNames()).not.toContain(STATE);
  });
});

describe('Send on schedule: the hourly sweep', () => {
  it('sends every filled row once, then only rows that are new or changed', () => {
    const { h, crm } = newKit();
    leadsSheet(h, 5);
    submit(h, { column: 'B', onSchedule: true });
    expect(h.fireTimer()[0]).toMatchObject({ ok: true });
    expect(webhookRows(crm).map((r) => r.ref)).toEqual([2, 3, 4, 5, 6]);
    expect(crm.callsTo('/webhook')[0]!.event).toBe('schedule');
    expect(statusColumn(h)).toEqual(['created', 'created', 'created', 'created', 'created']);

    h.fireTimer();
    expect(crm.callsTo('/webhook')).toHaveLength(1);

    h.loadSheet('Leads', [['Changed Name']], { at: [4, 1] });
    h.loadSheet('Leads', [['n@example.com', '']], { at: [7, 2] });
    h.fireTimer();
    expect(crm.callsTo('/webhook')).toHaveLength(2);
    expect(crm.callsTo('/webhook')[1]!.body.rows.map((r: any) => r.ref)).toEqual([4, 7]);
    expect(statusColumn(h)!.slice(0, 5)).toEqual([
      'created',
      'created',
      'updated',
      'created',
      'created',
    ]);
  });

  it('does nothing when "Send on schedule" is off, even if a trigger is still installed', () => {
    const { h, crm } = newKit();
    leadsSheet(h, 2);
    submit(h, { onSchedule: true });
    h.setProperty('document', 'CRM_HOOK_SCHEDULE', 'off');
    h.fireTimer();
    expect(crm.calls.filter((c) => c.path === '/webhook')).toEqual([]);
  });

  it('skips rows that are blank or hold only spaces, and rows whose trigger cell is empty', () => {
    const { h, crm } = newKit();
    h.loadSheet(
      'Leads',
      [
        ['Name', 'Email'],
        ['', ''],
        ['  ', '\t '],
        ['Ann', 'ann@example.com'],
        ['Bob', ''],
        ['', '   '],
        ['Cy', 'cy@example.com'],
      ],
      { activate: true },
    );
    submit(h, { column: 'Email', onSchedule: true });
    h.fireTimer();
    expect(webhookRows(crm).map((r) => r.ref)).toEqual([4, 7]);
    // With no trigger column a row with any cell is sent, but a row of spaces is still nothing.
    submit(h, { column: '', onSchedule: true });
    h.fireTimer();
    expect(webhookRows(crm).map((r) => r.ref)).toEqual([4, 7, 5]);
  });

  it('maps headers however they are written, keeps every column in `values`, and leaves the CRM status column out', () => {
    const { h, crm } = newKit();
    h.loadSheet(
      'Leads',
      [
        [
          'Full Name',
          'E-mail',
          'Mobile Number',
          'attr:City',
          'Notes',
          'CRM status',
          'Email',
          'email',
        ],
        [
          'Asha Rao',
          'ASHA@Example.com',
          9876543210,
          'Pune',
          'vip',
          'old text',
          'second@example.com',
          'third@example.com',
        ],
      ],
      { activate: true },
    );
    submit(h, { onSchedule: true });
    h.fireTimer();
    const row = webhookRows(crm)[0];
    expect(row).toMatchObject({
      ref: 2,
      name: 'Asha Rao',
      email: 'ASHA@Example.com',
      phone: 9876543210,
      attributes: { City: 'Pune' },
    });
    expect(row.values).toEqual({
      'Full Name': 'Asha Rao',
      'E-mail': 'ASHA@Example.com',
      'Mobile Number': 9876543210,
      'attr:City': 'Pune',
      Notes: 'vip',
      Email: 'second@example.com',
      email: 'third@example.com',
    });
    // The status was written in the column that already existed, not in a second one.
    expect(h.grid('Leads')[0]).toHaveLength(8);
    expect(statusColumn(h)).toEqual(['created']);
  });

  it('handles non-Latin headings, which are kept in `values` but cannot be mapped', () => {
    const { h, crm } = newKit();
    h.loadSheet(
      'Leads',
      [
        ['ईमेल', 'Имя', 'Email'],
        ['x', 'y', 'a@example.com'],
      ],
      { activate: true },
    );
    submit(h, { onSchedule: true });
    h.fireTimer();
    expect(webhookRows(crm)[0].values).toEqual({ ईमेल: 'x', Имя: 'y', Email: 'a@example.com' });
    expect(webhookRows(crm)[0].email).toBe('a@example.com');
  });

  it('survives headings that are names of Object properties', () => {
    const { h, crm } = newKit();
    h.loadSheet(
      'Leads',
      [
        ['__proto__', 'constructor', 'Email', 'attr:__proto__', 'toString'],
        ['a', 'b', 'c@example.com', 'd', 'e'],
      ],
      { activate: true },
    );
    submit(h, { onSchedule: true });
    expect(h.fireTimer()[0]).toMatchObject({ ok: true });
    expect(webhookRows(crm)[0].email).toBe('c@example.com');
  });

  it('turns dates into ISO text, keeps numbers and booleans, and sends error cells as the text Sheets shows', () => {
    const { h, crm } = newKit();
    h.loadSheet(
      'Leads',
      [
        ['Name', 'Email', 'Joined', 'Score', 'VIP', 'Lookup'],
        ['A', 'a@example.com', '2026-10-07', 42.5, 'TRUE', ''],
      ],
      { activate: true },
    );
    h.setFormulaCell('Leads', 2, 6, '=NA()', '#N/A');
    submit(h, { onSchedule: true });
    h.fireTimer();
    expect(webhookRows(crm)[0].values).toEqual({
      Name: 'A',
      Email: 'a@example.com',
      Joined: '2026-10-07T00:00:00.000Z',
      Score: 42.5,
      VIP: true,
      Lookup: '#N/A',
    });
  });

  it('marks a row whose identity cell is an error or a formula result the CRM cannot read, and moves on', () => {
    const { h, crm } = newKit();
    h.loadSheet(
      'Leads',
      [
        ['Name', 'Email'],
        ['A', ''],
        ['B', 'b@example.com'],
      ],
      { activate: true },
    );
    h.setFormulaCell('Leads', 2, 2, '=NA()', '#N/A');
    submit(h, { onSchedule: true });
    h.fireTimer();
    expect(statusColumn(h)).toEqual(['failed: email: This is not an email address.', 'created']);
    expect(crm.contacts.map((c) => c.email)).toEqual(['b@example.com']);
  });

  it('handles a merged cell: only its top-left cell holds the value', () => {
    const { h, crm } = newKit();
    h.loadSheet(
      'Leads',
      [
        ['Name', 'Email', 'City'],
        ['A', 'a@example.com', 'Pune'],
        ['B', 'b@example.com', 'Pune'],
      ],
      { activate: true },
    );
    h.mergeCells('Leads', 2, 3, 2, 1);
    submit(h, { onSchedule: true });
    h.fireTimer();
    expect(webhookRows(crm).map((r) => r.values.City)).toEqual(['Pune', '']);
  });

  it('sends rows 51 to 500 of a sheet with extra columns and a CRM status column in the middle', () => {
    const { h, crm } = newKit();
    const rows: unknown[][] = [
      ['Name', 'CRM status', 'Email', ...Array.from({ length: 10 }, (_, i) => `Extra ${i}`)],
    ];
    for (let i = 0; i < 60; i++)
      rows.push([`N${i}`, '', `e${i}@example.com`, ...Array.from({ length: 10 }, () => 'x')]);
    h.loadSheet('Leads', rows, { activate: true });
    submit(h, { column: 'Email', onSchedule: true });
    h.fireTimer();
    expect(crm.contacts).toHaveLength(60);
    expect(statusColumn(h)!.every((s) => s === 'created')).toBe(true);
  });

  it('uses the sheet chosen in Initial Setup, even when another sheet is the active one', () => {
    const { h, crm } = newKit();
    leadsSheet(h, 2);
    h.loadSheet('Other', [['Email'], ['other@example.com']], { activate: true });
    submit(h, { column: 'B', onSchedule: true });
    h.fireTimer();
    expect(webhookRows(crm).map((r) => r.email)).toEqual(['p1@example.com', 'p2@example.com']);
  });

  it('sends nothing, instead of the wrong sheet, when the chosen sheet was deleted or renamed', () => {
    const { h, crm } = newKit();
    leadsSheet(h, 2);
    submit(h, { column: 'B', onSchedule: true });
    h.evaluate(`SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Leads').setName('Renamed')`);
    h.loadSheet('Other', [['Email'], ['other@example.com']], { activate: true });
    h.fireTimer();
    expect(crm.callsTo('/webhook')).toEqual([]);
  });

  it('keeps the row hash stable when a number-like hash such as "1e5" is stored in the state sheet', () => {
    // Sheets turns the text "12e4" into the number 120000 when it is written as plain input, which would make the row look changed every hour.
    const { h, crm } = newKit();
    let name = '';
    for (let i = 0; i < 20000 && !name; i++) {
      const hash = h.evaluate<string>(`rowHash_(['P${i}', 'p${i}@example.com', ''])`);
      if (/^\d+e\d+$/.test(hash)) name = `P${i}`;
    }
    expect(name, 'a row whose hash looks like a number').not.toBe('');
    h.loadSheet(
      'Leads',
      [
        ['Name', 'Email', 'Phone'],
        [name, `${name.toLowerCase()}@example.com`, ''],
      ],
      { activate: true },
    );
    submit(h, { onSchedule: true });
    h.fireTimer();
    h.fireTimer();
    h.fireTimer();
    expect(crm.callsTo('/webhook')).toHaveLength(1);
  });
});

describe('chunking, partial failure and what is retried', () => {
  it('sends 1200 rows as 500 + 500 + 200, in sheet order, each row once', () => {
    const { h, crm } = newKit();
    leadsSheet(h, 1200);
    submit(h, { column: 'B', onSchedule: true });
    expect(h.fireTimer()[0]).toMatchObject({ ok: true, killed: false });
    expect(crm.callsTo('/webhook').map((c) => c.rows)).toEqual([500, 500, 200]);
    expect(webhookRows(crm).map((r) => r.ref)).toEqual(
      Array.from({ length: 1200 }, (_, i) => i + 2),
    );
    expect(crm.contacts).toHaveLength(1200);
    expect(statusColumn(h)!.every((s) => s === 'created')).toBe(true);
    // 1200 sent rows are 1200 lines in the state sheet: more than the 1000 rows a new sheet has.
    expect(h.grid(STATE)).toHaveLength(1200);
    h.fireTimer();
    expect(crm.callsTo('/webhook')).toHaveLength(3);
  });

  it('writes the CRM status column even when the data fills all 26 columns of the sheet', () => {
    const { h, crm } = newKit();
    const headers = ['Email', ...Array.from({ length: 25 }, (_, i) => `C${i}`)];
    h.loadSheet('Leads', [headers, ['a@example.com', ...Array.from({ length: 25 }, () => 'x')]], {
      activate: true,
    });
    expect(h.sheetInfo('Leads')!.maxCols).toBe(26);
    submit(h, { onSchedule: true });
    expect(h.fireTimer()[0]).toMatchObject({ ok: true });
    expect(crm.contacts).toHaveLength(1);
    expect(h.grid('Leads')[0]![26]).toBe('CRM status');
    expect(h.grid('Leads')[1]![26]).toBe('created');
  });

  it('records a row the CRM refused as failed, with the reason, and does not resend it until it changes', () => {
    const { h, crm } = newKit();
    h.loadSheet(
      'Leads',
      [
        ['Name', 'Email'],
        ['A', 'not an email'],
        ['B', 'b@example.com'],
      ],
      { activate: true },
    );
    submit(h, { onSchedule: true });
    h.fireTimer();
    expect(statusColumn(h)).toEqual(['failed: email: This is not an email address.', 'created']);
    h.fireTimer();
    expect(crm.callsTo('/webhook')).toHaveLength(1);
    h.loadSheet('Leads', [['fixed@example.com']], { at: [2, 2] });
    h.fireTimer();
    expect(statusColumn(h)).toEqual(['created', 'created']);
  });

  it('retries a row the CRM could not save for its own reasons at the next sweep', () => {
    const { h, crm } = newKit();
    h.loadSheet(
      'Leads',
      [
        ['Name', 'Email'],
        ['A', 'boom@example.com'],
        ['B', 'b@example.com'],
      ],
      { activate: true },
    );
    submit(h, { onSchedule: true });
    h.fireTimer();
    expect(statusColumn(h)![0]).toMatch(/^failed:/);
    h.fireTimer();
    expect(crm.callsTo('/webhook')).toHaveLength(2);
    expect(crm.callsTo('/webhook')[1]!.body.rows.map((r: any) => r.ref)).toEqual([2]);
  });

  it('stops at the first chunk the CRM refuses, keeps what was sent, and the next sweep sends only the rest', () => {
    const { h, crm } = newKit();
    leadsSheet(h, 1200);
    submit(h, { column: 'B', onSchedule: true });
    crm.queue.push(() => undefined); // chunk 1 is answered normally
    crm.queue.push(() => ({
      status: 500,
      body: JSON.stringify({ ok: false, code: 'INTERNAL', error: 'down' }),
    }));
    h.fireTimer();
    expect(crm.contacts).toHaveLength(500);
    expect(statusColumn(h)!.filter((s) => s === 'created')).toHaveLength(500);
    h.fireTimer();
    expect(crm.contacts).toHaveLength(1200);
    expect(crm.callsTo('/webhook').map((c) => c.rows)).toEqual([500, 500, 500, 200]);
  });

  it('401 from the sweep sends nothing again until the key is fixed', () => {
    const { h, crm } = newKit();
    leadsSheet(h, 3);
    submit(h, { column: 'B', onSchedule: true });
    crm.key = 'wsn_live_' + '9'.repeat(32);
    h.fireTimer();
    expect(crm.contacts).toHaveLength(0);
    expect(h.sheetNames()).not.toContain(STATE);
    crm.key = FAKE_KEY;
    h.fireTimer();
    expect(crm.contacts).toHaveLength(3);
  });

  it('413 on a whole chunk is not a dead end: the rows are split until they fit', () => {
    const { h, crm } = newKit();
    h.loadSheet(
      'Leads',
      [['Name', 'Email'], ...Array.from({ length: 60 }, (_, i) => [`N${i}`, `n${i}@example.com`])],
      { activate: true },
    );
    submit(h, { column: 'Email', onSchedule: true });
    crm.answerNext({
      status: 413,
      body: JSON.stringify({ ok: false, code: 'PAYLOAD_TOO_LARGE', error: 'big' }),
    });
    h.fireTimer();
    expect(crm.contacts).toHaveLength(60);
    expect(crm.callsTo('/webhook').length).toBeGreaterThan(1);
  });

  it('cells of 50,000 characters do not make a request the CRM must refuse: chunks are cut by size as well as by row count', () => {
    const { h, crm } = newKit();
    const big = 'x'.repeat(50_000);
    h.loadSheet(
      'Leads',
      [
        ['Name', 'Email', 'attr:Bio'],
        ...Array.from({ length: 90 }, (_, i) => [`N${i}`, `n${i}@example.com`, big]),
      ],
      { activate: true },
    );
    submit(h, { column: 'Email', onSchedule: true });
    expect(h.fireTimer()[0]).toMatchObject({ ok: true, killed: false });
    expect(crm.contacts).toHaveLength(90);
    for (const call of crm.callsTo('/webhook')) expect(call.bytes).toBeLessThan(2 * 1024 * 1024);
    expect(crm.callsTo('/webhook').length).toBeGreaterThan(1);
  });

  it('a single row that alone is over the limit is marked and skipped, and does not block the rows after it', () => {
    const { h, crm } = newKit();
    const big = 'x'.repeat(50_000);
    const widths = Array.from({ length: 45 }, (_, i) => `attr:Big ${i}`);
    h.loadSheet(
      'Leads',
      [
        ['Name', 'Email', ...widths],
        ['Huge', 'huge@example.com', ...widths.map(() => big)],
        ['Small', 'small@example.com', ...widths.map(() => 'x')],
      ],
      { activate: true },
    );
    submit(h, { column: 'Email', onSchedule: true });
    h.fireTimer();
    expect(crm.contacts.map((c) => c.email)).toEqual(['small@example.com']);
    expect(statusColumn(h)![0]).toMatch(/^failed: .*too large/i);
    expect(statusColumn(h)![1]).toBe('created');
    h.fireTimer();
    expect(
      crm.callsTo('/webhook').filter((c) => c.rows === 1 && c.body.rows[0].ref === 2),
    ).toHaveLength(0);
  });

  it('cuts the raw `values` of a huge cell short, since the CRM keeps only a short sample of them', () => {
    const { h, crm } = newKit();
    h.loadSheet(
      'Leads',
      [
        ['Name', 'Email', 'Bio'],
        ['A', 'a@example.com', 'y'.repeat(50_000)],
      ],
      { activate: true },
    );
    submit(h, { onSchedule: true });
    h.fireTimer();
    expect(webhookRows(crm)[0].values.Bio.length).toBeLessThanOrEqual(500);
  });
});

describe('429 and the network during a sweep', () => {
  it('waits out a short Retry-After and goes on', () => {
    const { h, crm } = newKit();
    leadsSheet(h, 3);
    submit(h, { column: 'B', onSchedule: true });
    crm.answerNext({
      status: 429,
      headers: { 'Retry-After': '3' },
      body: JSON.stringify({ ok: false, code: 'RATE_LIMITED', error: 'slow' }),
    });
    const r = h.fireTimer()[0]!;
    expect(r.ok).toBe(true);
    expect(crm.contacts).toHaveLength(3);
    expect(r.elapsedMs).toBeGreaterThanOrEqual(3000);
  });

  it('stops on a long Retry-After and sends the rest at the next sweep, without sending anything twice', () => {
    const { h, crm } = newKit();
    leadsSheet(h, 1200);
    submit(h, { column: 'B', onSchedule: true });
    crm.queue.push(() => undefined);
    crm.queue.push(() => ({ status: 429, headers: { 'Retry-After': '120' }, body: '{}' }));
    h.fireTimer();
    expect(crm.contacts).toHaveLength(500);
    h.fireTimer();
    expect(crm.contacts).toHaveLength(1200);
    // 500 taken, 500 refused with the 429, then the 500 that were refused and the last 200: no accepted row is sent twice.
    expect(crm.callsTo('/webhook').map((c) => c.rows)).toEqual([500, 500, 500, 200]);
    expect(statusColumn(h)!.every((v) => v === 'created')).toBe(true);
  });

  it('a network exception stops the sweep quietly and the next one sends everything', () => {
    const { h, crm } = newKit();
    leadsSheet(h, 5);
    submit(h, { column: 'B', onSchedule: true });
    crm.failNextWithNetworkError();
    expect(h.fireTimer()[0]).toMatchObject({ ok: true });
    expect(crm.contacts).toHaveLength(0);
    h.fireTimer();
    expect(crm.contacts).toHaveLength(5);
  });

  it('a daily quota error stops the sweep and the next day it resumes', () => {
    const { h, crm } = newKit({ limits: { urlFetchCallsPerDay: 2 } });
    leadsSheet(h, 1200);
    submit(h, { column: 'B', onSchedule: true });
    // submit used one call (the connection check); the first chunk uses the second; the third call hits the quota.
    h.fireTimer();
    expect(crm.contacts).toHaveLength(500);
    h.setUrlFetchCalls(0);
    h.fireTimer();
    expect(crm.contacts.length).toBeGreaterThan(500);
  });
});

describe('the execution limit and large sheets', () => {
  const contacts = (crm: ReturnType<typeof newKit>['crm']) => crm.contacts.length;

  it('sweeps 10,000 rows inside one execution when the CRM answers quickly, and the status and state cover every row', () => {
    const { h, crm } = newKit();
    leadsSheet(h, 10_000);
    submit(h, { column: 'B', onSchedule: true });
    const r = h.fireTimer()[0]!;
    expect(r.killed).toBe(false);
    expect(r.elapsedMs).toBeLessThan(6 * 60 * 1000);
    expect(contacts(crm)).toBe(10_000);
    expect(h.grid(STATE)).toHaveLength(10_000);
    expect(statusColumn(h)!.every((s) => s === 'created')).toBe(true);
  });

  it('reads the sheet in a few calls, not one call per row', () => {
    const { h } = newKit();
    leadsSheet(h, 2_000);
    submit(h, { column: 'B', onSchedule: true });
    h.fireTimer();
    // Each Google call is a network round trip; thousands of them are what ends a script at the limit.
    const exec = h.executionLog().at(-1)!;
    expect(exec.elapsedMs).toBeLessThan(60_000);
  });

  it('stops before the limit when the CRM is slow, writes what it sent, and resumes next hour, sending each row once', () => {
    const { h, crm } = newKit();
    crm.delayMs = 40_000;
    leadsSheet(h, 10_000);
    submit(h, { column: 'B', onSchedule: true });
    const first = h.fireTimer()[0]!;
    expect(first).toMatchObject({ ok: true, killed: false });
    expect(first.elapsedMs).toBeLessThan(6 * 60 * 1000);
    const afterFirst = contacts(crm);
    expect(afterFirst).toBeGreaterThan(0);
    expect(afterFirst).toBeLessThan(10_000);
    let guard = 0;
    while (contacts(crm) < 10_000 && guard++ < 10) {
      const r = h.fireTimer()[0]!;
      expect(r.killed).toBe(false);
    }
    expect(contacts(crm)).toBe(10_000);
    const sent = webhookRows(crm).map((r) => r.ref);
    expect(new Set(sent).size).toBe(sent.length);
    expect(sent).toHaveLength(10_000);
  });

  it('if Google ends the script in the middle of a call anyway, the next sweep sends the rows that were not recorded and nothing is lost', () => {
    const { h, crm } = newKit({ limits: { executionMs: 60_000 } });
    crm.delayMs = 25_000;
    leadsSheet(h, 2000);
    submit(h, { column: 'B', onSchedule: true });
    const r = h.fireTimer()[0]!;
    // Whether or not it was cut, a later run completes the job.
    let guard = 0;
    while (contacts(crm) < 2000 && guard++ < 20) h.fireTimer();
    expect(contacts(crm)).toBe(2000);
    expect(r.elapsedMs).toBeLessThanOrEqual(60_000 + 30_000);
  });
});

describe('concurrent triggers (LockService)', () => {
  it('takes the document lock around the send and gives it back', () => {
    const { h } = newKit();
    leadsSheet(h, 2);
    submit(h, { column: 'B', onEvent: true });
    const before = h.now();
    h.fireEdit({ sheet: 'Leads', row: 2, col: 2, values: 'a@example.com' });
    expect(h.now() - before).toBeLessThan(10_000);
    // A second execution can take the lock straight away: the first one did not leave it held.
    h.fireEdit({ sheet: 'Leads', row: 3, col: 2, values: 'b@example.com' });
    expect(
      h
        .executionLog()
        .filter((e) => e.fn === 'crmOnEditSend')
        .every((e) => e.ok),
    ).toBe(true);
  });

  it('waits for another execution holding the lock, and when it never lets go sends anyway instead of losing the edit', () => {
    const { h, crm } = newKit();
    leadsSheet(h, 2);
    submit(h, { column: 'B', onEvent: true });
    h.holdLock('document');
    const before = h.now();
    const r = h.fireEdit({ sheet: 'Leads', row: 2, col: 2, values: 'a@example.com' });
    expect(r.results[0]!.ok).toBe(true);
    expect(h.now() - before).toBeGreaterThanOrEqual(20_000);
    expect(crm.contacts).toHaveLength(1);
    expect(statusColumn(h)).toEqual(['created', '']);
  });

  it('two edits that overlap (the second arrives while the first waits for the CRM) both end up sent and recorded', () => {
    const { h, crm } = newKit();
    leadsSheet(h, 3);
    submit(h, { column: 'B', onEvent: true });
    let nested = false;
    h.onFetch = (req) => {
      if (nested || !req.url.endsWith('/webhook')) return;
      nested = true;
      h.fireEdit({ sheet: 'Leads', row: 3, col: 2, values: 'second@example.com' });
    };
    h.fireEdit({ sheet: 'Leads', row: 2, col: 2, values: 'first@example.com' });
    expect(crm.contacts.map((c) => c.email).sort()).toEqual([
      'first@example.com',
      'second@example.com',
    ]);
    expect(statusColumn(h)).toEqual(['created', 'created', '']);
    expect(
      h
        .grid(STATE)
        .map((r) => r[0])
        .sort(),
    ).toEqual(['Leads!2', 'Leads!3']);
  });
});

describe('an editor add-on shared by many spreadsheets of the same member', () => {
  it('gives each spreadsheet its own edit trigger instead of treating the first one as everybody s', () => {
    const { h, crm } = newKit({ mode: 'addon' });
    leadsSheet(h, 2);
    submit(h, { column: 'B', onEvent: true });
    const second = h.addSpreadsheet('Second');
    h.useSpreadsheet(second);
    leadsSheet(h, 2);
    submit(h, { column: 'B', onEvent: true });
    const triggers = h.triggerList().filter((t) => t.fn === 'crmOnEditSend');
    expect(triggers.map((t) => t.sourceId).sort()).toEqual(
      [second, h.triggerList()[0]!.sourceId].sort(),
    );
    expect(new Set(triggers.map((t) => t.sourceId)).size).toBe(2);
    expect(h.fireEdit({ sheet: 'Leads', row: 2, col: 2, values: 'x@example.com' }).delivered).toBe(
      1,
    );
    expect(crm.callsTo('/webhook')).toHaveLength(1);
  });

  it('turning sending off in one spreadsheet leaves the other spreadsheet edit trigger alone', () => {
    const { h } = newKit({ mode: 'addon' });
    leadsSheet(h, 2);
    submit(h, { onEvent: true });
    const first = h.spreadsheetId();
    const second = h.addSpreadsheet('Second');
    h.useSpreadsheet(second);
    leadsSheet(h, 2);
    submit(h, { onEvent: true });
    submit(h, { onEvent: false });
    expect(h.triggerList().map((t) => t.sourceId)).toEqual([first]);
  });

  it('documents a limit of Google: an add-on hourly trigger has no spreadsheet to read, so the sweep sends nothing there', () => {
    const { h, crm } = newKit({ mode: 'addon' });
    leadsSheet(h, 2);
    submit(h, { column: 'B', onSchedule: true });
    const r = h.fireTimer()[0]!;
    expect(r.ok).toBe(true);
    expect(crm.callsTo('/webhook')).toEqual([]);
  });

  it('creates its hourly trigger in an editor add-on, where Google allows nothing more often than hourly', () => {
    const { h } = newKit({ mode: 'addon' });
    leadsSheet(h, 1);
    expect(submit(h, { onSchedule: true }).ok).toBe(true);
    expect(h.triggerList().find((t) => t.event === 'CLOCK')).toBeTruthy();
  });
});

describe('Pull and Push dialogs', () => {
  it('Push contacts: reads the active sheet, sends 500 rows per call, and writes each result', () => {
    const { h, crm } = newKit();
    leadsSheet(h, 700);
    submit(h);
    const r = fromPage(h, 'runPush', { countryCode: '+91' });
    expect(r).toMatchObject({ ok: true, created: 700, failed: 0, rows: 700 });
    expect(crm.callsTo('/contacts/sync').map((c) => c.rows)).toEqual([500, 200]);
    expect(crm.callsTo('/contacts/sync')[0]!.body.default_country_code).toBe('+91');
    expect(statusColumn(h)!.every((s) => s === 'created')).toBe(true);
  });

  it('Push contacts: a refused chunk marks the rows that were not sent and says why', () => {
    const { h, crm } = newKit();
    leadsSheet(h, 600);
    submit(h);
    crm.queue.push(() => undefined);
    crm.queue.push(() => ({ status: 413, body: '{}' }));
    const r = fromPage(h, 'runPush', {});
    expect(r).toMatchObject({ ok: false, created: 500, notSent: 100, status: 413 });
    expect(statusColumn(h)!.slice(500)[0]).toBe(
      'not sent: The request was too large. Send fewer rows at a time.',
    );
  });

  it('Push contacts refuses a sheet without an email or phone column, and an empty one', () => {
    const { h } = newKit();
    h.loadSheet('Leads', [['Name'], ['A']], { activate: true });
    submit(h);
    expect(fromPage(h, 'runPush', {})).toMatchObject({
      ok: false,
      code: 'BAD_HEADERS',
      message: 'Row 1 needs a column named email or phone.',
    });
    h.loadSheet('Empty', [['Email']], { activate: true });
    expect(fromPage(h, 'runPush', {})).toMatchObject({ ok: false, code: 'EMPTY_SHEET' });
  });

  it('Pull contacts: writes every contact, even past the 1000 rows a new sheet has, and keeps what looks like a formula or a number as text', () => {
    const { h, crm } = newKit();
    for (let i = 0; i < 1500; i++) {
      crm.contacts.push({
        id: `c${i}`,
        name: i === 0 ? '=HYPERLINK("https://evil.example","click")' : `C${i}`,
        email: `c${i}@example.com`,
        phone: i === 1 ? '+919876543210' : i === 2 ? '0012345' : undefined,
        attributes: i === 3 ? { 'a b': 'x' } : {},
      });
    }
    submit(h);
    const r = fromPage(h, 'runPull', {});
    expect(r).toMatchObject({ ok: true, pulled: 1500, sheet: 'CRM contacts', truncated: false });
    const grid = h.grid('CRM contacts');
    expect(grid).toHaveLength(1501);
    expect(grid[1]![1]).toBe('=HYPERLINK("https://evil.example","click")');
    expect(h.numberFormat('CRM contacts', 2, 2)).toBe('@');
    expect(grid[2]![5]).toBe('+919876543210');
    expect(grid[3]![5]).toBe('0012345');
    expect(h.activeSheetName()).toBe('CRM contacts');
  });

  it('Pull contacts: more custom properties than a new sheet has columns still land', () => {
    const { h, crm } = newKit();
    const attrs: Record<string, string> = {};
    for (let i = 0; i < 30; i++) attrs[`p${String(i).padStart(2, '0')}`] = 'v';
    crm.contacts.push({ id: 'c1', name: 'A', email: 'a@example.com', attributes: attrs });
    submit(h);
    expect(fromPage(h, 'runPull', {})).toMatchObject({ ok: true, pulled: 1 });
    expect(h.grid('CRM contacts')[0]).toHaveLength(10 + 30);
  });

  it('Sync products reports a missing name/price column and an empty form', () => {
    const { h } = newKit();
    h.loadSheet(
      'Products',
      [
        ['name', 'sku'],
        ['Tee', 'T1'],
      ],
      { activate: true },
    );
    submit(h);
    expect(fromPage(h, 'runProductSync', { shopName: 'Shop' })).toMatchObject({
      ok: false,
      code: 'BAD_HEADERS',
    });
    expect(fromPage(h, 'runProductSync', { shopName: '' })).toMatchObject({
      ok: false,
      code: 'VALIDATION_FAILED',
    });
  });
});

describe('the connection survives a pasted URL with another server', () => {
  it('uses the key from the URL against the server in the URL', () => {
    const { h } = newKit();
    expect(fromPage(h, 'saveKey', FAKE_HOOK_URL).ok).toBe(true);
    expect(h.fetchRecords().at(-1)!.url).toBe(
      'https://crm.example.test/api/v1/sheets-addon/health',
    );
  });
});
