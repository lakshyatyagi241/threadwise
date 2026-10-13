import { describe, expect, it } from 'vitest';
import {
  AGENT_SAVED_REPLIES_BUDGET,
  AGENT_SAVED_REPLIES_MAX,
  AGENT_SAVED_REPLY_CHARS,
  buildSavedRepliesSection,
} from '../../../src/modules/ai-agents-training/agent-saved-replies';
import {
  columnIndexes,
  guardFormula,
  parseRow,
  savedRepliesCsv,
  unguardFormula,
} from '../../../src/modules/team-inbox-conversations/saved-replies/saved-replies-csv';
import { parseCsv } from '../../../src/modules/crm/contact-import/csv-parser';
import {
  decodeRepliesUpload,
  parseImportOptions,
} from '../../../src/modules/team-inbox-conversations/saved-replies/saved-replies-transfer.service';

const idx = columnIndexes(['Title', 'Shortcut', 'Body', 'Category', 'Language', 'Channel'])!;
const row = (cells: string[]) => parseRow({ line: 2, cells }, idx);

describe('CSV export', () => {
  it('writes the six columns and guards a formula, but only at the start of a cell', () => {
    const csv = savedRepliesCsv([
      {
        title: '=cmd()',
        shortcut: 'hi',
        body: 'a - b, "quoted"\nline two',
        category: null,
        language: 'en',
        channelKinds: ['whatsapp_cloud', 'email'],
      },
    ]);
    const parsed = parseCsv(csv).records;
    expect(parsed[0]!.cells).toEqual([
      'title',
      'shortcut',
      'body',
      'category',
      'language',
      'channel',
    ]);
    expect(parsed[1]!.cells).toEqual([
      "'=cmd()",
      'hi',
      'a - b, "quoted"\nline two',
      '',
      'en',
      'whatsapp_cloud|email',
    ]);
  });
  it('every leading formula character is guarded and the import undoes exactly that', () => {
    for (const c of ['=', '+', '-', '@', '\t', '\r']) {
      const v = `${c}x`;
      expect(guardFormula(v)).toBe(`'${v}`);
      expect(unguardFormula(guardFormula(v))).toBe(v);
    }
    expect(guardFormula('plain')).toBe('plain');
    expect(unguardFormula("'quoted")).toBe("'quoted");
  });
  it('a body that starts with a dash survives export then import', () => {
    const csv = savedRepliesCsv([
      {
        title: 't',
        shortcut: 's',
        body: '- first\n- second',
        category: null,
        language: null,
        channelKinds: [],
      },
    ]);
    const rec = parseCsv(csv).records[1]!;
    const r = row(rec.cells);
    expect(r.ok && r.row.body).toBe('- first\n- second');
  });
});

describe('CSV import rows', () => {
  it('needs the title, shortcut and body columns, in any order and case', () => {
    expect(columnIndexes(['body', 'SHORTCUT', 'Title'])).toMatchObject({
      body: 0,
      shortcut: 1,
      title: 2,
    });
    expect(columnIndexes(['shortcut', 'body'])).toBeNull();
    expect(columnIndexes(['FEFFtitle', 'shortcut', 'body'])).not.toBeNull();
  });
  it('normalises the shortcut and reads the optional columns', () => {
    const r = row([
      'Hello',
      '/Thank You',
      'Hi there',
      'Sales',
      'pt-BR',
      'whatsapp_cloud| email ,telegram',
    ]);
    expect(r).toEqual({
      ok: true,
      row: {
        line: 2,
        shortcut: 'thank_you',
        title: 'Hello',
        body: 'Hi there',
        category: 'Sales',
        language: 'pt-BR',
        channelKinds: ['whatsapp_cloud', 'email', 'telegram'],
      },
    });
  });
  it.each([
    [['T', '', 'b', '', '', ''], 'missing_shortcut'],
    [['T', '///', 'b', '', '', ''], 'shortcut_invalid'],
    [['', 's', 'b', '', '', ''], 'missing_title'],
    [['x'.repeat(129), 's', 'b', '', '', ''], 'title_too_long'],
    [['T', 's', '', '', '', ''], 'missing_body'],
    [['T', 's', 'x'.repeat(4001), '', '', ''], 'body_too_long'],
    [['T', 's', 'a\u0007b', '', '', ''], 'control_characters'],
    [['T', 's', 'b', 'c'.repeat(65), '', ''], 'category_too_long'],
    [['T', 's', 'b', '', 'english please', ''], 'language_invalid'],
    [['T', 's', 'b', '', '', 'fax'], 'channel_unknown'],
  ])('%j is %s', (cells, issue) => {
    const r = row(cells as string[]);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.issue).toBe(issue);
  });
});

describe('upload and options', () => {
  it('refuses a missing file, a binary file and a wrong type', () => {
    expect(() => decodeRepliesUpload(undefined)).toThrow();
    expect(() =>
      decodeRepliesUpload({ originalname: 'a.csv', buffer: Buffer.from([0x50, 0, 0x4b]) }),
    ).toThrow();
    expect(() =>
      decodeRepliesUpload({
        originalname: 'a.pdf',
        mimetype: 'application/pdf',
        buffer: Buffer.from('x'),
      }),
    ).toThrow();
    expect(
      decodeRepliesUpload({ originalname: 'a.csv', buffer: Buffer.from('title,shortcut,body') }),
    ).toBe('title,shortcut,body');
  });
  it('options default to skip and a real run, and refuse nonsense', () => {
    expect(parseImportOptions(undefined)).toEqual({ duplicatePolicy: 'skip', dryRun: false });
    expect(parseImportOptions('{"duplicatePolicy":"overwrite","dryRun":true}')).toEqual({
      duplicatePolicy: 'overwrite',
      dryRun: true,
    });
    expect(() => parseImportOptions('{"duplicatePolicy":"merge"}')).toThrow();
    expect(() => parseImportOptions('not json')).toThrow();
  });
});

describe('the AI agent prompt section (BL-105)', () => {
  const facts = { workspaceName: 'Acme', today: '2026-10-13' };
  it('has the most used replies first, with the title and the first 280 characters', () => {
    const out = buildSavedRepliesSection(
      [
        { title: 'Greeting', body: 'Welcome to {{workspace_name}}!' },
        { title: 'Long', body: 'w'.repeat(500) },
      ],
      facts,
    );
    expect(out.included).toBe(2);
    expect(out.text).toContain('- Greeting: Welcome to Acme!');
    expect(out.text).toContain(`- Long: ${'w'.repeat(AGENT_SAVED_REPLY_CHARS)}\n`.trimEnd());
    expect(out.text).not.toContain('w'.repeat(AGENT_SAVED_REPLY_CHARS + 1));
  });
  it('never includes a reply with a variable that cannot be filled here', () => {
    const out = buildSavedRepliesSection(
      [
        { title: 'Hi', body: 'Hi {{first_name}}' },
        { title: 'Agent', body: 'This is {{agent_name}}' },
        { title: 'Typo', body: 'Hi {{nope}}' },
        { title: 'Ok', body: 'Today is {{today}}' },
      ],
      facts,
    );
    expect(out.included).toBe(1);
    expect(out.skippedForVariables).toBe(3);
    expect(out.text).not.toContain('{{');
    expect(out.text).toContain('Today is 2026-10-13');
  });
  it('is empty when nothing qualifies', () => {
    expect(buildSavedRepliesSection([], facts).text).toBe('');
    expect(buildSavedRepliesSection([{ title: 'x', body: '{{name}}' }], facts).text).toBe('');
  });
  it('keeps at most 15 replies and stays inside the budget', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      title: `T${i}`,
      body: `b${i} `.repeat(30),
    }));
    const out = buildSavedRepliesSection(many, facts);
    expect(out.included).toBeLessThanOrEqual(AGENT_SAVED_REPLIES_MAX);
    expect(out.text.length).toBeLessThan(AGENT_SAVED_REPLIES_BUDGET + 300);
    const big = Array.from({ length: 15 }, (_, i) => ({ title: `T${i}`, body: 'z'.repeat(2000) }));
    const capped = buildSavedRepliesSection(big, facts);
    expect(capped.text.length).toBeLessThan(AGENT_SAVED_REPLIES_BUDGET + 300);
    expect(capped.included).toBeLessThan(15);
  });
});
